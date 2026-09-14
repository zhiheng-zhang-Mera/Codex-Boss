import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RepoManifestStore, statWorkspace } from "../../electron/input/repo-manifest";

/**
 * Phase H — the workspace index does not lose entries quietly.
 *
 * Two failures of the same class as the rest of Phase H, both in this module:
 *
 *  - a manifest that EXISTS but cannot be parsed read as "never scanned", which is
 *    the ordinary state of a fresh install — so an unusable index looked normal;
 *  - an entry the walk could not stat (or a directory it could not list) vanished
 *    from the index entirely. That is worse than a missing row: the file is then
 *    reported as REMOVED on the next scan, so "what changed" is wrong in the
 *    under-reporting direction while looking complete.
 *
 * The `sha256: "unreadable"` marker on the hashing step was already honest and is
 * deliberately untouched.
 */

const dirs: string[] = [];
function makeTree(prefix = "boss-manifest-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function workspace(files: Record<string, string>): string {
  const root = makeTree();
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return root;
}

describe("Phase H — the repo manifest", () => {
  it("distinguishes a manifest that is not there from one that cannot be used", () => {
    const root = workspace({ "a.txt": "one" });
    // The index lives under the data root and the workspace is a different tree —
    // putting it inside the scanned root would make it a row of its own.
    const fresh = new RepoManifestStore(path.join(makeTree(), "manifest.json"));
    expect(fresh.current()).toBeUndefined();
    expect(fresh.restoreDiagnostic()).toBeUndefined();

    const file = path.join(makeTree(), "manifest.json");
    fs.writeFileSync(file, "{ truncated", "utf8");
    const corrupt = new RepoManifestStore(file);
    expect(corrupt.current()).toBeUndefined();
    expect(corrupt.restoreDiagnostic()).toBeTruthy();

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, files: [] }), "utf8");
    const wrongSchema = new RepoManifestStore(file);
    expect(wrongSchema.current()).toBeUndefined();
    expect(wrongSchema.restoreDiagnostic()).toContain("schemaVersion 1");
    expect(root.length).toBeGreaterThan(0);
  });

  it("reads a manifest it wrote, without a diagnostic", () => {
    const root = workspace({ "a.txt": "one", "src/b.ts": "two" });
    const file = path.join(makeTree(), "manifest.json");
    const first = new RepoManifestStore(file);
    const delta = first.scan(root);
    expect(delta.changed.sort()).toEqual(["a.txt", "src/b.ts"]);
    const reopened = new RepoManifestStore(file);
    expect(reopened.restoreDiagnostic()).toBeUndefined();
    expect(reopened.current()?.files.length).toBe(2);
    expect(reopened.hashFor("a.txt")).toBe(first.hashFor("a.txt"));
    // A second scan of an untouched workspace reports no changes at all.
    expect(reopened.scan(root).changed).toEqual([]);
  });

  it("reports an entry it could not stat instead of dropping it", () => {
    const root = workspace({ "a.txt": "one", "b.txt": "two" });
    const skipped: { path: string; reason: string }[] = [];
    const rows = statWorkspace(root, {
      onSkip: (entry) => skipped.push(entry),
      // The seam exists so this path is exercised rather than asserted by
      // inspection: one file cannot be stat-ed, the other can.
      statFile: (file) => {
        if (file.endsWith("b.txt")) throw new Error("EPERM: operation not permitted");
        return fs.statSync(file);
      }
    });
    expect(rows.map((row) => row.path)).toEqual(["a.txt"]);
    expect(skipped.map((entry) => entry.path)).toEqual(["b.txt"]);
    expect(skipped[0].reason).toContain("EPERM");
  });

  it("reports nothing on a healthy workspace, so the report means something", () => {
    const root = workspace({ "a.txt": "one", "src/b.ts": "two" });
    const skipped: { path: string; reason: string }[] = [];
    const rows = statWorkspace(root, { onSkip: (entry) => skipped.push(entry) });
    expect(skipped).toEqual([]);
    expect(rows.length).toBe(2);
  });

  it("carries the skips in the scan result instead of turning them into removals", () => {
    // The consequence the fix is for: without this, a file the scan could not read
    // is absent from `files`, so a later scan calls it removed while the index
    // looks complete.
    const root = workspace({ "a.txt": "one", "b.txt": "two" });
    const store = new RepoManifestStore(path.join(makeTree(), "manifest.json"));
    expect(store.scan(root).skipped).toEqual([]);
    expect(store.current()?.files.map((row) => row.path)).toEqual(["a.txt", "b.txt"]);

    const statFile = (target: string) => {
      if (target.endsWith("b.txt")) throw new Error("EBUSY: resource busy");
      return fs.statSync(target);
    };
    const skipped: { path: string; reason: string }[] = [];
    const rows = statWorkspace(root, { onSkip: (entry) => skipped.push(entry), statFile });
    expect(skipped.length).toBe(1);
    expect(skipped[0]).toMatchObject({ path: "b.txt" });
    expect(rows.map((row) => row.path)).toEqual(["a.txt"]);
    // The previous manifest still names both files, which is why "what changed"
    // stays truthful rather than reporting a deletion that did not happen.
    expect(store.current()?.files.map((row) => row.path)).toEqual(["a.txt", "b.txt"]);
  });
});
