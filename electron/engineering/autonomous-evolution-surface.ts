/**
 * Update-Plan/self-evlo.md §3/§4 — the Root Trust Surface inventory, hashed in a
 * machine-independent way.
 *
 * A trust-epoch anchor is committed to the repository and verified on a different
 * machine (CI). Raw working-tree bytes are not a stable identity there: the same
 * commit checks out with LF on one host and CRLF on another (this repository has
 * `core.autocrlf=true` locally and a mixed working tree). The surface hash therefore
 * normalises CRLF to LF before hashing, which is deterministic on every platform and
 * still changes if any content byte inside a line changes.
 *
 * The blessing step (`scripts/acceptance-evolution-bless.cjs`) and the graduation
 * command both use these functions, so "the epoch the run certifies under" and "the
 * surface the run hashes" can never disagree about how a file is measured.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { classifySurface, ROOT_SURFACE_HASH_EXCLUSIONS, type RootSurfaceFile } from "../../src/shared/autonomous-evolution-trust";

const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", "dist-electron", "artifacts", ".git", "runtime-data", ".cache", "history", "coverage"]);

/** §3: CRLF-normalised SHA-256 of a file, or "" when it cannot be read. */
export function normalizedFileHash(file: string): string {
  try {
    const bytes = fs.readFileSync(file);
    // Normalise the line endings without decoding: a text file that differs only in
    // its newline convention is the same content on every checkout.
    const normalized = Buffer.allocUnsafe(bytes.length);
    let written = 0;
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 0x0d && bytes[index + 1] === 0x0a) continue;
      normalized[written++] = byte;
    }
    return createHash("sha256").update(normalized.subarray(0, written)).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Every file in the repository that the policy classifies as Root Trust Surface,
 * with its normalised hash. The self-referential epoch file is excluded by the
 * policy (an `h = H(…, file containing h)` has no fixed point).
 */
export function collectRootSurfaceEntries(root: string): RootSurfaceFile[] {
  const entries: RootSurfaceFile[] = [];
  const walk = (directory: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(dirent.name)) continue;
        walk(path.join(directory, dirent.name));
        continue;
      }
      if (!dirent.isFile()) continue;
      const absolute = path.join(directory, dirent.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (ROOT_SURFACE_HASH_EXCLUSIONS.includes(relative)) continue;
      if (classifySurface(relative) !== "ROOT_TRUST_SURFACE") continue;
      const sha256 = normalizedFileHash(absolute);
      if (sha256 === "") continue;
      entries.push({ path: relative, sha256 });
    }
  };
  walk(root);
  return entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
