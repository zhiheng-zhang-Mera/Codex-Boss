import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal toolchain materialization for the AppContainer sandbox.
 *
 * ## The problem this solves
 *
 * The sandbox must let the AppContainer read the executable it launches. It did that by granting `read`
 * on `readOnlyRoots` — in practice `dirname(process.execPath)`, i.e. the machine-owned Node install
 * (`D:\Node_JS`). Granting an AppContainer identity read means writing a DACL entry on that directory, and
 * a non-elevated user cannot write a DACL on `D:\Node_JS`: its ACL is
 * `BUILTIN\Users:(OI)(CI)(RX)`, `Administrators:(F)`, `SYSTEM:(F)`, so `SetAccessControl` fails with
 * `UnauthorizedAccessException` before `CreateProcessW` is ever reached. The measured result was
 * `sandboxed: false` on every case, with the AppContainer profile and SID created successfully — the
 * sandbox failed closed rather than claiming isolation it had not obtained.
 *
 * ## What it does instead
 *
 * It copies the SMALLEST set of files the child actually needs into a **user-owned** cache inside the
 * Candidate tree — which is already a granted root — and the AppContainer is granted `read` on that copy
 * only. The machine-owned root is never ACL'd.
 *
 * ## Why the set is small
 *
 * `node.exe` imports only system DLLs (`KERNEL32`, `ADVAPI32`, `CRYPT32`, `WS2_32`, `USERENV`, ...), all of
 * which an AppContainer already reaches through `ALL APPLICATION PACKAGES`. It needs no sibling runtime
 * DLLs. So the materialized set is the executable, plus any file the caller explicitly declares. Copying a
 * whole Node installation would widen the containment surface for nothing, which is why it is not done.
 *
 * ## Identity, so a copy cannot go stale
 *
 * Each entry is keyed by the source file's size and SHA-256, and the cache directory is named after a
 * digest of the whole manifest. A source toolchain that changes therefore produces a different cache
 * directory rather than silently reusing an old copy, and a partially written cache is detectable.
 */

/** One file to place in the materialized toolchain. */
interface ToolchainFile {
  /** Absolute host path of the source file. */
  source: string;
  /** Path relative to the materialized root. */
  relative: string;
  /** Whether the child must be able to execute it. */
  executable: boolean;
}

/** The materialized result: where it lives and what identifies it. */
export interface MaterializedToolchain {
  /** Absolute host path of the materialized root (inside the candidate tree). */
  root: string;
  /** Stable identity of the materialized content. */
  digest: string;
  /** Files actually placed, as `relative -> sha256`. */
  files: Record<string, string>;
  /** True when an existing, valid cache was reused. */
  reused: boolean;
}

/** What a caller needs to know about the source before materializing. */
interface ToolchainSourcePlan {
  files: ToolchainFile[];
  /** Why materialization is being attempted, for the capability record. */
  reason: string;
}

const MANIFEST_FILE = "toolchain-manifest.json";

/** SHA-256 of a file, read in a stream so a large executable does not have to be held in memory. */
function fileDigest(file: string): string {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

/**
 * The minimal set for a Node executable, plus any extra file the caller names.
 *
 * Deliberately not a directory walk. `node.exe` is self-contained (its imports are system DLLs only), and
 * a generated Candidate script that the sandbox runs uses Node's built-ins. A caller that genuinely needs
 * more must say so through `extra`, so the containment surface only ever grows on an explicit decision.
 */
export function planNodeToolchain(executable: string, extra: readonly ToolchainFile[] = []): ToolchainSourcePlan {
  const files: ToolchainFile[] = [{ source: executable, relative: path.basename(executable), executable: true }];
  for (const file of extra) files.push(file);
  return { files, reason: "the launched executable must be readable by the AppContainer without ACL-ing its machine-owned source directory" };
}

/** Digest over the sorted `relative:sha256:size` manifest. Stable across machines and runs. */
function manifestDigest(entries: ReadonlyArray<{ relative: string; sha256: string; size: number }>): string {
  const canonical = [...entries]
    .sort((a, b) => a.relative.localeCompare(b.relative))
    .map((entry) => `${entry.relative}:${entry.sha256}:${entry.size}`)
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Materialize `plan` under `cacheParent`, returning the root the AppContainer should be granted.
 *
 * Reuse is content-addressed: the cache directory is `<cacheParent>/<digest12>`, and it is only reused when
 * its manifest matches the manifest recomputed from the SOURCE files. A source toolchain that was updated
 * therefore cannot be masked by a stale copy; it lands in a new directory. A cache whose manifest is
 * missing or whose files do not match is rebuilt in place.
 */
export function materializeToolchain(cacheParent: string, plan: ToolchainSourcePlan): MaterializedToolchain {
  const entries = plan.files.map((file) => {
    const stat = fs.statSync(file.source);
    return { relative: file.relative.split(path.sep).join("/"), sha256: fileDigest(file.source), size: stat.size, executable: file.executable, source: file.source };
  });
  const digest = manifestDigest(entries);
  const root = path.join(cacheParent, digest.slice(0, 12));

  const manifestPath = path.join(root, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { digest?: string; files?: Record<string, string> };
      const complete = existing.digest === digest
        && existing.files !== undefined
        && entries.every((entry) => {
          const target = path.join(root, entry.relative.split("/").join(path.sep));
          return fs.existsSync(target) && fs.statSync(target).size === entry.size;
        });
      if (complete) {
        return { root, digest, files: existing.files!, reused: true };
      }
    } catch {
      // An unreadable manifest is treated as a cache miss; the copy below replaces it.
    }
  }

  // Build into a staging directory, then swap, so a concurrent or crashed materialization cannot leave a
  // half-populated cache that a later run would trust.
  const staging = `${root}.staging-${process.pid}-${Date.now().toString(36)}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const target = path.join(staging, entry.relative.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.source, target);
    // The AppContainer carries no write capability, but a read-only copy is the honest expression of what
    // this directory is. chmod is a no-op on Windows for the ACL, so the grant is what enforces it.
    if (entry.executable) fs.chmodSync(target, 0o755);
    files[entry.relative] = entry.sha256;
  }
  fs.writeFileSync(path.join(staging, MANIFEST_FILE), `${JSON.stringify({ digest, files }, null, 2)}\n`, "utf8");

  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.renameSync(staging, root);
  return { root, digest, files, reused: false };
}

/** The directory materialized toolchains live in, given the Candidate root. */
export function toolchainCacheRoot(candidateRoot: string): string {
  return path.join(candidateRoot, "toolchain");
}
