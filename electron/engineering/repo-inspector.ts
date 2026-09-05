import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Development-plane repo inspector (plan AP04 / §13.3 incremental everything).
 * A bounded, deterministic scan of a workspace that produces a test map and a
 * change fingerprint — the base every later dev-plane tool (symbol/dependency
 * index, semantic slices, targeted test selection) builds on.
 */

export interface RepoSnapshot {
  schemaVersion: 1;
  scannedAt: string;
  root: string;
  /** Relative paths of every tracked file, sorted. */
  files: string[];
  /** Test files (relative), grouped by their directory. */
  testMap: Record<string, string[]>;
  skippedDirectories: number;
  /** sha256 over the sorted file list; changes when the index must refresh. */
  fingerprint: string;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "artifacts", "dist", "dist-electron", "runtime-data", "history", "coverage", ".git", ".cache", ".codex-boss", ".codex-controller"]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_ENTRIES = 50000;

/** Platform-independent relative path so inventories/fingerprints are stable. */
function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

export function discoverTestFiles(root: string): string[] {
  const snapshot = scanRepo(root);
  return Object.values(snapshot.testMap).flat();
}

/**
 * Targeted test selection seed (plan AP04): given changed files, return the
 * tests that live in the same directory or any of its subdirectories. When a
 * changed file has no co-located tests, nothing is returned so the caller can
 * decide whether to widen to the full map.
 */
export function selectTestsForFiles(snapshot: RepoSnapshot, changedFiles: string[]): string[] {
  const candidates = new Set<string>();
  for (const file of changedFiles) {
    const dir = path.posix.dirname(file.replace(/\\/g, "/"));
    for (const [testDir, tests] of Object.entries(snapshot.testMap)) {
      if (testDir === dir || testDir.startsWith(dir === "." ? "" : dir + "/")) for (const test of tests) candidates.add(test);
    }
  }
  return [...candidates].sort((a, b) => a.localeCompare(b));
}

/** Bounded recursive walk; symlinks and hidden/dependency trees are skipped. */
export function scanRepo(root: string, now = Date.now): RepoSnapshot {
  const realRoot = fs.realpathSync(root);
  const files: string[] = [];
  const testMap: Record<string, string[]> = {};
  let entries = 0;
  let skippedDirectories = 0;

  const visit = (relative: string) => {
    let directoryEntries: fs.Dirent[];
    try {
      directoryEntries = fs.readdirSync(path.join(realRoot, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of directoryEntries) {
      if (++entries > MAX_ENTRIES) throw new Error("Repo scan exceeds entry budget");
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) { skippedDirectories += 1; continue; }
        visit(relative ? path.join(relative, entry.name) : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      const joined = relative ? path.join(relative, entry.name) : entry.name;
      const file = toPosix(joined);
      files.push(file);
      if (TEST_FILE_PATTERN.test(entry.name)) {
        const dir = toPosix(relative || ".");
        (testMap[dir] ??= []).push(file);
      }
    }
  };
  visit(".");

  files.sort((a, b) => a.localeCompare(b));
  for (const key of Object.keys(testMap)) testMap[key].sort((a, b) => a.localeCompare(b));
  const fingerprint = createHash("sha256").update(files.join("\n"), "utf8").digest("hex");
  return { schemaVersion: 1, scannedAt: new Date(now()).toISOString(), root: realRoot, files, testMap, skippedDirectories, fingerprint };
}
