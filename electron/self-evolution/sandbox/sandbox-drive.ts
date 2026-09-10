import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Drive-letter mapping for the Windows hard sandbox.
 *
 * A standard user cannot write a discretionary ACL on a volume root, and a
 * Windows AppContainer token ignores `BUILTIN\Users`, so the loader's `lstat`
 * walk (which node performs up to the volume root when it resolves a module)
 * cannot be satisfied on an ordinary `D:\...` path. A `subst` drive removes the
 * problem without weakening anything: the Candidate tree is reached as
 * `X:\<runId>\workspace`, whose only ancestor is the mapped root itself, and
 * that root is a directory this host owns and can therefore ACL.
 *
 * The mapping is a *path alias*, never a permission: the AppContainer identity
 * is still granted access only to the Candidate subtree.
 */

const PREFERRED_LETTERS = ["X", "Y", "Z", "W", "V", "U", "T", "S", "R", "Q", "P", "O", "N", "M", "L", "K", "J", "I", "H", "G"];

export interface DriveMapping {
  /** Host path that was mapped. */
  hostRoot: string;
  /** Sandbox-visible path, e.g. `X:\`. */
  driveRoot: string;
  letter: string;
  /** True when this call created the mapping and is responsible for removing it. */
  created: boolean;
}

function existingSubsts(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const output = execFileSync("subst.exe", [], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    for (const line of output.split(/\r?\n/)) {
      const match = /^([A-Za-z]):\s*=>\s*(.+?)\s*$/.exec(line.trim());
      if (match) result.set(`${match[1].toUpperCase()}:`, path.resolve(match[2]));
    }
  } catch {
    // `subst` with no arguments exits non-zero on some hosts; an empty map is fine.
  }
  return result;
}

/** `subst` the host root onto a dedicated drive letter, reusing one when present. */
export function ensureDriveMapping(hostRoot: string): DriveMapping {
  const resolved = path.resolve(hostRoot);
  const existing = existingSubsts();
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  for (const [letter, target] of existing) {
    const targetNormalized = process.platform === "win32" ? target.toLowerCase() : target;
    if (targetNormalized === normalized) {
      return { hostRoot: resolved, driveRoot: `${letter}\\`, letter, created: false };
    }
  }
  const taken = new Set(existing.keys());
  for (const letter of PREFERRED_LETTERS) {
    const candidate = `${letter}:`;
    if (taken.has(candidate)) {
      // A mapping whose target has been deleted is dead weight: reclaim it.
      const target = existing.get(candidate)!;
      if (fs.existsSync(target)) continue;
    }
    if (!taken.has(candidate) && fs.existsSync(`${candidate}\\`)) continue;
    if (taken.has(candidate)) {
      try {
        execFileSync("subst.exe", [candidate, "/D"], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
      } catch {
        continue;
      }
    }
    try {
      execFileSync("subst.exe", [candidate, resolved], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
    } catch {
      continue;
    }
    if (fs.existsSync(`${candidate}\\`)) {
      return { hostRoot: resolved, driveRoot: `${candidate}\\`, letter, created: true };
    }
  }
  throw new Error(`could not map a drive letter for the sandbox root ${resolved}`);
}

/** Removes a mapping previously created by `ensureDriveMapping`. */
export function removeDriveMapping(mapping: DriveMapping): void {
  if (!mapping.created) return;
  try {
    execFileSync("subst.exe", [`${mapping.letter}:`, "/D"], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
  } catch {
    // A stale mapping is inert; the next run reuses it.
  }
}

/** Rewrites a host path into its sandbox-visible alias, when one applies. */
export function toSandboxPath(mapping: DriveMapping, value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(mapping.hostRoot, resolved);
  if (relative === "") return mapping.driveRoot;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return value;
  return path.join(mapping.driveRoot, relative);
}

/** Rewrites a sandbox alias back to the host path. */
export function toHostPath(mapping: DriveMapping, value: string): string {
  if (!value.toUpperCase().startsWith(`${mapping.letter}:`)) return value;
  return path.join(mapping.hostRoot, value.slice(3));
}

/** A stable synthetic identity for evidence: never the mapped path itself. */
export function mappingFingerprint(mapping: DriveMapping): string {
  return crypto.createHash("sha256").update(`${mapping.letter}:${mapping.hostRoot}`).digest("hex").slice(0, 16);
}
