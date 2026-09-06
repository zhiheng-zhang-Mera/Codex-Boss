/**
 * Repo manifest (plan 9-7 §22/§23). A content-hashed workspace index that
 * answers "what changed since last time" without re-reading unchanged files:
 * the first scan hashes everything; later scans stat each file and only
 * re-hash rows whose size or mtime changed. Unchanged files keep their prior
 * hash, so summaries/artifacts keyed on a hash are never rebuilt (§24 dedup).
 *
 * Layout per plan §23: <dataRoot>/.boss/workspace-index/manifest.json
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ManifestRow {
  path: string;      // posix relative path
  sha256: string;    // content hash (or unchanged-carried hash)
  size: number;
  mtimeMs: number;
}

export interface RepoManifest {
  schemaVersion: 1;
  root: string;
  scannedAt: string;
  files: ManifestRow[];
}

export interface ManifestDelta {
  changed: string[];   // paths whose content hash changed or is new
  removed: string[];   // paths that disappeared
  unchanged: string[]; // paths present before and with identical hash
}

const SKIP = new Set(["node_modules", ".git", "dist", "dist-electron", "artifacts", "runtime-data", "history", "coverage", ".cache", ".codex-boss"]);

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** Walks a workspace collecting (posixPath, size, mtimeMs); skips heavy dirs. */
export function statWorkspace(root: string, maxFiles = 20000): Array<{ path: string; size: number; mtimeMs: number }> {
  const realRoot = fs.realpathSync(root);
  const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const visit = (relative: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(realRoot, relative), { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const rel = relative ? toPosix(path.join(relative, entry.name)) : entry.name;
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        visit(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(path.join(realRoot, relative, entry.name));
        out.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* skip unreadable */ }
    }
  };
  visit("");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export class RepoManifestStore {
  private readonly file: string;
  private manifest?: RepoManifest;

  constructor(filePath: string) {
    this.file = filePath;
    this.restore();
  }

  private restore(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as RepoManifest;
      if (raw.schemaVersion === 1 && Array.isArray(raw.files)) this.manifest = raw;
    } catch {
      this.manifest = undefined;
    }
  }

  /** Current manifest (undefined before the first scan). */
  current(): RepoManifest | undefined {
    return this.manifest ? structuredClone(this.manifest) : undefined;
  }

  /**
   * Incremental scan: hash only stat-changed files, keep prior hashes for
   * unchanged rows, persist the new manifest and return the delta.
   */
  scan(root: string, nowMs = Date.now()): ManifestDelta {
    const realRoot = fs.realpathSync(root);
    const rows = statWorkspace(realRoot);
    const previous = new Map((this.manifest?.files ?? []).map((row) => [row.path, row]));
    const next: ManifestRow[] = [];
    const changed: string[] = [];
    for (const row of rows) {
      const prior = previous.get(row.path);
      if (prior && prior.size === row.size && Math.trunc(prior.mtimeMs) === Math.trunc(row.mtimeMs)) {
        next.push({ ...row, sha256: prior.sha256 }); // unchanged: reuse hash, no re-read
        continue;
      }
      try {
        next.push({ ...row, sha256: sha256File(path.join(realRoot, row.path)) });
        changed.push(row.path);
      } catch {
        next.push({ ...row, sha256: "unreadable" });
        changed.push(row.path);
      }
    }
    const removed = [...previous.keys()].filter((file) => !rows.some((row) => row.path === file));
    this.manifest = { schemaVersion: 1, root: realRoot, scannedAt: new Date(nowMs).toISOString(), files: next };
    this.persist();
    return { changed, removed, unchanged: [...previous.keys()].filter((file) => !changed.includes(file) && !removed.includes(file)) };
  }

  /** sha256 of one workspace file by relative path (undefined when absent). */
  hashFor(relativePath: string): string | undefined {
    return this.manifest?.files.find((row) => row.path === relativePath)?.sha256;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.manifest, null, 2), "utf8");
    try { fs.renameSync(temporary, this.file); }
    catch {
      try { fs.copyFileSync(temporary, this.file); } catch { fs.writeFileSync(this.file, JSON.stringify(this.manifest, null, 2), "utf8"); }
      fs.rmSync(temporary, { force: true });
    }
  }
}
