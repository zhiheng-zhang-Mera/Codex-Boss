import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ContentCache } from "../cache/content-cache";
import { scanRepo, type RepoSnapshot } from "./repo-inspector";

/**
 * Incremental repo scan through the content-addressed cache (plan §13.3/§13.4).
 * A cheap change signature (path + size + mtimeMs of every scanned file) is the
 * cache key: an edit changes the signature and naturally misses; an unchanged
 * tree reuses the previous full scan, so repeated plan/verification passes do
 * not re-read the whole workspace.
 */
export function repoScanSignature(snapshot: RepoSnapshot): string {
  // Snapshot.files are sorted; stat each file once (no content reads).
  const rows = snapshot.files.map((file) => {
    let stat: fs.Stats;
    try { stat = fs.statSync(path.join(snapshot.root, file)); } catch { return `${file}:missing`; }
    return `${file}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  });
  return createHash("sha256").update(rows.join("\n"), "utf8").digest("hex");
}

export function cachedScanRepo(root: string, cache: ContentCache<RepoSnapshot>, now = Date.now): { snapshot: RepoSnapshot; fromCache: boolean } {
  const full = scanRepo(root, now);
  const signature = repoScanSignature(full);
  const scope = `repo:${path.resolve(root)}`;
  const cacheKey = cache.key(scope, { kind: "repo-index", version: 1 }, signature);
  const hit = cache.get(cacheKey);
  if (hit) return { snapshot: hit, fromCache: true };
  cache.put(cacheKey, full, { kind: "repo-index", version: 1 }, [scope], now);
  return { snapshot: full, fromCache: false };
}
