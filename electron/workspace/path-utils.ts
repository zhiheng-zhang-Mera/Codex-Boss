import fs from "node:fs";
import path from "node:path";
import type { ResolvedWorkspace, WorkspacePathCode, WorkspacePathValidation } from "../../src/shared/workspace-path";

export type { ResolvedWorkspace, WorkspacePathCode, WorkspacePathValidation };

/**
 * Canonical workspace path model (Update-Plan/cleaning.md §2/§3).
 *
 * One place owns path *semantics* for the whole application:
 *
 *   normalize → validate → resolve → (persist | dispatch)
 *
 * Every entry point a user or a script can reach — the native directory picker,
 * the editable text field, an automated test passing a raw string — must end up
 * here. The renderer never implements path rules of its own; it renders the
 * `reason` this module produces.
 *
 * Windows is the target platform, so the canonical form is a Windows path:
 * backslash separators and an upper-case drive letter. The rules are written as
 * explicit Windows rules rather than delegated to the platform default, so a
 * test running on any host observes exactly the behaviour Windows users get, and
 * a POSIX-shaped string can never be silently reinterpreted as a rooted path on
 * whatever drive the process happens to run from.
 *
 * A canonical workspace path must be either
 *   - `C:\...`  — a drive-absolute path, or
 *   - `\\server\share\...` — a UNC path,
 * and it must exist and be a directory. Relative paths, drive-relative paths
 * (`C:repo`) and root-relative paths (`\repo`) are refused: Boss has no notion
 * of a workspace relative to an ambient working directory.
 */

/**
 * Thrown by `requireWorkspacePath`. Carries the machine code so an IPC boundary
 * can translate it into a precise message instead of a generic failure.
 */
export class WorkspacePathError extends Error {
  readonly code: WorkspacePathCode;
  readonly normalizedPath?: string;
  constructor(validation: WorkspacePathValidation) {
    super(`[${validation.code}] ${validation.reason ?? "invalid workspace path"}${validation.normalizedPath ? ` (${validation.normalizedPath})` : ""}`);
    this.name = "WorkspacePathError";
    this.code = validation.code;
    if (validation.normalizedPath !== undefined) this.normalizedPath = validation.normalizedPath;
  }
}

/** `C:\` or `C:\dir\...` — drive-absolute. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:\\/;
/** `\\server\share` — UNC. A bare `\\server` is not a usable workspace root. */
const UNC_ABSOLUTE = /^\\\\[^\\/]+\\[^\\/]+/;
/** `C:dir` — drive-relative: the drive is named but the directory is not rooted. */
const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;

/** Characters Windows forbids in a file or directory name. `:` is handled by the drive rules. */
const INVALID_NAME_CHARS = /[<>"|?*\u0000-\u001f]/;

/**
 * Canonical text form of a workspace path (pure: no filesystem access).
 *
 * - surrounding whitespace is dropped, interior whitespace is preserved
 *   (`"  C:\my repo  "` → `C:\my repo`);
 * - `/` is accepted as a separator and rewritten to `\` (Windows execution
 *   semantics are kept — a Windows path never becomes `/`);
 * - repeated separators collapse, but a leading UNC `\\` is preserved;
 * - trailing separators are dropped except for a drive root (`C:\`);
 * - the drive letter is upper-cased.
 *
 * An input that is not a string, or that is only whitespace, normalizes to "".
 * This function never throws and never rejects: refusal is `validateWorkspacePath`'s job.
 */
export function normalizeWorkspacePath(input: string): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  const slashed = trimmed.replace(/\//g, "\\");
  const hasUncPrefix = slashed.startsWith("\\\\");
  // Collapse runs of separators, then restore the UNC prefix the collapse ate.
  let collapsed = slashed.replace(/\\{2,}/g, "\\");
  if (hasUncPrefix && !collapsed.startsWith("\\\\")) collapsed = `\\${collapsed}`;
  const driveRoot = /^[A-Za-z]:\\+$/.test(collapsed);
  let normalized = collapsed.replace(/\\+$/, "");
  if (driveRoot) normalized = `${normalized.slice(0, 2)}\\`;
  if (normalized === "\\") return "\\";
  if (/^[A-Za-z]:/.test(normalized)) normalized = normalized[0]!.toUpperCase() + normalized.slice(1);
  return normalized;
}

function failure(code: WorkspacePathCode, reason: string, normalizedPath?: string): WorkspacePathValidation {
  return normalizedPath === undefined ? { ok: false, code, reason } : { ok: false, code, normalizedPath, reason };
}

/**
 * Full validation of a candidate workspace path: syntax, existence, directory-ness.
 *
 * Reasons are explicit (`PATH_NOT_FOUND` is never reported as "invalid input"),
 * because the UI shows them and the tests assert on them.
 */
export function validateWorkspacePath(input: string): WorkspacePathValidation {
  if (typeof input !== "string" || !input.trim()) {
    return failure("EMPTY_PATH", "workspace path is empty");
  }
  if (input.includes("\u0000")) {
    return failure("INVALID_PATH", "workspace path contains a NUL byte");
  }
  const normalized = normalizeWorkspacePath(input);
  if (!normalized) return failure("EMPTY_PATH", "workspace path is empty");

  const driveAbsolute = DRIVE_ABSOLUTE.test(normalized);
  const uncAbsolute = UNC_ABSOLUTE.test(normalized);
  if (!driveAbsolute && !uncAbsolute) {
    const shape = DRIVE_RELATIVE.test(normalized)
      ? `"${normalized}" names a drive but is not rooted on it`
      : `"${normalized}" is relative (or lacks a drive)`;
    return failure("NOT_ABSOLUTE", `${shape}; a workspace must be an absolute Windows path such as C:\\repo or \\\\server\\share\\repo`, normalized);
  }
  if (INVALID_NAME_CHARS.test(normalized.slice(driveAbsolute ? 2 : 0))) {
    return failure("INVALID_PATH", `"${normalized}" contains a character Windows does not allow in a path`, normalized);
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(normalized);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return failure("PATH_NOT_ACCESSIBLE", `"${normalized}" exists but is not readable (${code})`, normalized);
    }
    return failure("PATH_NOT_FOUND", `"${normalized}" does not exist`, normalized);
  }
  if (!stats.isDirectory()) {
    return failure("NOT_A_DIRECTORY", `"${normalized}" is a file, not a directory`, normalized);
  }
  return { ok: true, code: "OK", normalizedPath: normalized, reason: `"${normalized}" is an existing directory` };
}

/**
 * OS-canonical real path: the spelling the operating system itself reports.
 *
 * On Windows, `fs.realpathSync` (the JavaScript implementation) does **not**
 * expand 8.3 short names, while `fs.realpathSync.native` does. That difference is
 * not cosmetic: a machine whose temp or profile directory is reached through a
 * short name (`C:\Users\RUNNER~1\AppData\Local\Temp`) would otherwise produce two
 * "canonical" strings for one directory, and every identity comparison built on
 * them — is this the repository root? is this the remembered workspace? — would
 * answer "no" for a directory that is exactly the one asked about.
 *
 * Anything that compares two paths for identity, or persists one, must use this.
 */
export function canonicalRealPathSync(target: string): string {
  return typeof fs.realpathSync.native === "function" ? fs.realpathSync.native(target) : fs.realpathSync(target);
}

/**
 * Async counterpart of `canonicalRealPathSync`.
 *
 * It deliberately delegates to the synchronous native call rather than
 * `fs.promises.realpath`: the promise form has no `.native` variant in the
 * typings, and two canonicalizers would be free to disagree — which is the whole
 * failure mode this module exists to prevent. Resolving one path is cheap.
 */
export async function canonicalRealPath(target: string): Promise<string> {
  return canonicalRealPathSync(target);
}

/**
 * True when two paths name the **same directory** on this machine.
 *
 * Used wherever two path strings must be proven identical rather than assumed
 * identical — "is this workspace the repository root git just reported?". String
 * equality is not enough on Windows: one directory can be spelled through its
 * 8.3 short name (`C:\Users\RUNNER~1\...`), with different case, or through a
 * junction, and different producers return different spellings (Node's own
 * `fs.realpathSync` keeps a short name alive while `realpathSync.native` and git
 * both expand it).
 *
 * The canonical spelling is compared first because it is free; when the strings
 * differ the directory's file identity (volume + file index, which Node fills
 * from `BY_HANDLE_FILE_INFORMATION` on Windows) decides. Two genuinely different
 * directories never share an identity, and a spelling difference never changes
 * one.
 */
export function isSameDirectory(left: string, right: string): boolean {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false;
  // Canonicalizing can fail (a path that does not exist); that is "not the same
  // directory", never an exception — this predicate sits inside fail-closed
  // guards whose only two answers may be "yes" and "no".
  const canonical = (value: string): string | undefined => {
    try { return canonicalRealPathSync(value); } catch { return undefined; }
  };
  const leftCanonical = canonical(left);
  const rightCanonical = canonical(right);
  if (leftCanonical !== undefined && rightCanonical !== undefined && leftCanonical.toLowerCase() === rightCanonical.toLowerCase()) return true;
  try {
    const a = fs.statSync(left);
    const b = fs.statSync(right);
    if (!a.isDirectory() || !b.isDirectory()) return false;
    // Some filesystems report no usable index; then the identity check would
    // compare 0 with 0 and call unrelated directories equal.
    if (a.ino === 0 && b.ino === 0) return false;
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/**
 * True when `candidate` is `root` itself or lives underneath it.
 *
 * This is the ONE containment predicate. It used to exist six times
 * (`workbook-dispatch`, `root-authority/execution-profile`, `self-evolution/mutation-context`,
 * `stable-candidate/runtime-isolation`, `emergency-control/evolution-kill-switch`,
 * `engineering/native-tools`) in five subtly different spellings, which is how a
 * boundary quietly develops a hole.
 *
 * Two questions are answered here and the difference matters:
 *
 * - **lexical** (default): the candidate, resolved against the root, stays inside
 *   it as a path. This is the check for a file that does not exist yet.
 * - **symlink-aware** (`followSymlinks`): the deepest *existing* ancestor of the
 *   candidate is canonicalized and must still be inside the canonical root, so a
 *   junction or symlink that points out of the workspace cannot be used to write
 *   outside it.
 *
 * Both sides are canonicalized with `canonicalRealPathSync` where they exist, so
 * a Windows 8.3 short name or a junction cannot smuggle a path past either check.
 * A candidate that is not a string, or an unusable root, is `false` — never a throw.
 */
export function isInsideWorkspace(root: string, candidate: string, options: { followSymlinks?: boolean } = {}): boolean {
  if (typeof root !== "string" || typeof candidate !== "string" || !root || !candidate) return false;
  const base = resolveForContainment(root);
  if (!base) return false;
  const target = path.resolve(base, candidate);
  if (!lexicallyInside(base, target)) return false;
  if (!options.followSymlinks) return true;
  const existing = deepestExistingAncestor(target);
  if (!existing) return false;
  const canonicalBase = resolveForContainment(base);
  const canonicalExisting = resolveForContainment(existing);
  return canonicalBase !== undefined && canonicalExisting !== undefined && lexicallyInside(canonicalBase, canonicalExisting);
}

/** Canonical form when the path exists, absolute form when it does not. */
function resolveForContainment(value: string): string | undefined {
  try {
    return canonicalRealPathSync(value);
  } catch {
    const normalized = normalizeWorkspacePath(value);
    return normalized ? path.resolve(normalized) : undefined;
  }
}

function lexicallyInside(base: string, target: string): boolean {
  if (base.toLowerCase() === target.toLowerCase()) return true;
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The closest ancestor of `target` (or `target` itself) that exists on disk. */
export function deepestExistingAncestor(target: string): string | undefined {
  let current = path.resolve(target);
  for (;;) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Validates and then resolves the canonical identity of a workspace.
 *
 * `normalizedPath` is the canonical text form; `canonicalPath` additionally has
 * symlinks/junctions resolved and the on-disk casing applied — that is the value
 * worth persisting and comparing, because two spellings of the same directory
 * must not become two workspaces.
 */
export async function resolveWorkspacePath(input: string): Promise<ResolvedWorkspace> {
  const validation = validateWorkspacePath(input);
  if (!validation.ok) {
    return validation.normalizedPath === undefined
      ? { ok: false, code: validation.code, reason: validation.reason }
      : { ok: false, code: validation.code, normalizedPath: validation.normalizedPath, reason: validation.reason };
  }
  const normalizedPath = validation.normalizedPath!;
  try {
    const canonicalPath = await canonicalRealPath(normalizedPath);
    return { ok: true, code: "OK", normalizedPath, canonicalPath, reason: validation.reason };
  } catch (error) {
    // The directory passed `statSync` a moment ago; a failure here means the
    // volume went away or the path cannot be canonicalized. Fail closed, never
    // fall back to the un-resolved spelling.
    return {
      ok: false,
      code: "UNRESOLVABLE",
      normalizedPath,
      reason: `"${normalizedPath}" could not be resolved: ${(error as Error).message}`
    };
  }
}

/**
 * Synchronous counterpart of `resolveWorkspacePath` for call sites that already
 * hold the canonical value (validation happens once, at the boundary).
 */
export function resolveWorkspacePathSync(input: string): ResolvedWorkspace {
  const validation = validateWorkspacePath(input);
  if (!validation.ok) {
    return validation.normalizedPath === undefined
      ? { ok: false, code: validation.code, reason: validation.reason }
      : { ok: false, code: validation.code, normalizedPath: validation.normalizedPath, reason: validation.reason };
  }
  const normalizedPath = validation.normalizedPath!;
  try {
    const canonicalPath = canonicalRealPathSync(normalizedPath);
    return { ok: true, code: "OK", normalizedPath, canonicalPath, reason: validation.reason };
  } catch (error) {
    return { ok: false, code: "UNRESOLVABLE", normalizedPath, reason: `"${normalizedPath}" could not be resolved: ${(error as Error).message}` };
  }
}

/** `resolveWorkspacePath`, but a refusal throws a `WorkspacePathError`. */
export async function requireWorkspacePath(input: string): Promise<ResolvedWorkspace> {
  const resolved = await resolveWorkspacePath(input);
  if (!resolved.ok) throw new WorkspacePathError({ ok: false, code: resolved.code, ...(resolved.normalizedPath ? { normalizedPath: resolved.normalizedPath } : {}), ...(resolved.reason ? { reason: resolved.reason } : {}) });
  return resolved;
}

/** `requireWorkspacePath` without the promise, for synchronous call sites. */
export function requireWorkspacePathSync(input: string): ResolvedWorkspace {
  const resolved = resolveWorkspacePathSync(input);
  if (!resolved.ok) throw new WorkspacePathError({ ok: false, code: resolved.code, ...(resolved.normalizedPath ? { normalizedPath: resolved.normalizedPath } : {}), ...(resolved.reason ? { reason: resolved.reason } : {}) });
  return resolved;
}

