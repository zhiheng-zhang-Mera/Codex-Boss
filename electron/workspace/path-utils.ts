import fs from "node:fs";

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
 * backslash separators and an upper-case drive letter. The rules are written
 * against `path.win32` explicitly (not the platform default) so that a test
 * running on any host observes exactly the behaviour Windows users get, and so
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

/** Machine-readable outcome of a path decision. Branch on this, never on `reason`. */
export type WorkspacePathCode =
  | "OK"
  | "EMPTY_PATH"
  | "INVALID_PATH"
  | "NOT_ABSOLUTE"
  | "PATH_NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "PATH_NOT_ACCESSIBLE"
  | "UNRESOLVABLE";

export interface WorkspacePathValidation {
  ok: boolean;
  /** Machine code; `OK` exactly when `ok` is true. */
  code: WorkspacePathCode;
  /** Canonical Windows form (present whenever the input had any content). */
  normalizedPath?: string;
  /** Human-readable explanation. Display only. */
  reason?: string;
}

export interface ResolvedWorkspace {
  ok: boolean;
  code: WorkspacePathCode;
  /** Canonical Windows form of the input (separators, drive case, no trailing separator). */
  normalizedPath?: string;
  /** Canonical identity: real path with symlinks/junctions resolved and case corrected. */
  canonicalPath?: string;
  reason?: string;
}

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
    const canonicalPath = await fs.promises.realpath(normalizedPath);
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
    // `realpathSync.native` applies the on-disk casing on Windows; the JS
    // implementation returns the input spelling, which would keep a stale
    // drive-letter case alive in the durable record.
    const canonicalPath = typeof fs.realpathSync.native === "function" ? fs.realpathSync.native(normalizedPath) : fs.realpathSync(normalizedPath);
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

