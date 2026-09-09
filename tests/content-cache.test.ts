import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentCache } from "../electron/cache/content-cache";
import { cachedScanRepo, repoScanSignature } from "../electron/engineering/cached-repo-scan";
import { scanRepo } from "../electron/engineering/repo-inspector";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-cache-")); dirs.push(dir); return dir; }
function write(root: string, relative: string, content = "") { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

describe("content cache", () => {
  it("stores and invalidates by dependency scope", () => {
    const cache = new ContentCache<string>();
    const key = cache.key("s", { kind: "test", version: 1 }, { a: 1 });
    cache.put(key, "value", { kind: "test", version: 1 }, ["scope:repo"], () => 0);
    expect(cache.get(key)).toBe("value");
    cache.invalidate("scope:repo");
    expect(cache.get(key)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("keys differ when the input hash changes and versions are part of the key", () => {
    const cache = new ContentCache<string>();
    const a = cache.key("s", { kind: "k", version: 1 }, { x: 1 });
    const b = cache.key("s", { kind: "k", version: 1 }, { x: 2 });
    const v2 = cache.key("s", { kind: "k", version: 2 }, { x: 1 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(v2);
  });

  it("persists and reloads entries and fails closed on corruption", () => {
    const file = path.join(root(), "cache.json");
    const cache = new ContentCache<string>(file);
    const key = cache.key("s", { kind: "k", version: 1 }, 1);
    cache.put(key, "v", { kind: "k", version: 1 }, [], () => 0);
    expect(new ContentCache<string>(file).get(key)).toBe("v");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new ContentCache<string>(file)).toThrow(/Invalid/);
  });
});

describe("cached repo scan", () => {
  it("returns the cached snapshot when the tree has not changed", () => {
    const dir = root();
    write(dir, "src/a.ts", "a");
    write(dir, "src/b.test.ts", "test");
    const cache = new ContentCache<ReturnType<typeof scanRepo>>();
    const first = cachedScanRepo(dir, cache);
    expect(first.fromCache).toBe(false);
    const second = cachedScanRepo(dir, cache);
    expect(second.fromCache).toBe(true);
    expect(second.snapshot).toEqual(first.snapshot);
  });

  it("scans again when a file changes (signature miss + scope invalidation)", () => {
    const dir = root();
    write(dir, "src/a.ts", "one");
    const cache = new ContentCache<ReturnType<typeof scanRepo>>();
    cachedScanRepo(dir, cache);
    // Content change with a different size guarantees a signature miss even if
    // the mtime resolution is coarse.
    write(dir, "src/a.ts", "three words changed");
    const before = repoScanSignature(scanRepo(dir));
    const again = cachedScanRepo(dir, cache);
    expect(again.fromCache).toBe(false);
    expect(repoScanSignature(scanRepo(dir))).toBe(before); // still deterministic
    expect(again.snapshot.files).toEqual(["src/a.ts"]);
  });

  it("explicit invalidation drops repo-index entries", () => {
    const dir = root();
    write(dir, "a.ts", "");
    const cache = new ContentCache<ReturnType<typeof scanRepo>>();
    const scope = `repo:${path.resolve(dir)}`;
    cachedScanRepo(dir, cache);
    expect(cache.size()).toBe(1);
    cache.invalidate(scope);
    expect(cache.size()).toBe(0);
    expect(cachedScanRepo(dir, cache).fromCache).toBe(false);
  });
});
