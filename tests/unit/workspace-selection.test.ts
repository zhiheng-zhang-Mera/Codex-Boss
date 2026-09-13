import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceSelectionStore } from "../../electron/workspace/workspace-selection";
import { canonicalRealPathSync } from "../../electron/workspace/path-utils";
import { restoreWorkspaceField } from "../../src/shared/workspace-selection";

/**
 * Update-Plan/cleaning.md §6 — remembered workspace / persistence.
 *
 * The three things the plan asks to be true are asserted against real files and
 * real directories: only a canonical validated path is persisted, a remembered
 * path that has since disappeared reads as STALE without throwing, and restoring
 * that stale value into the field is a display decision that starts nothing.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-selection-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function storeFor(root: string): { store: WorkspaceSelectionStore; file: string } {
  const file = path.join(root, ".boss", "workspace-selection.json");
  return { store: new WorkspaceSelectionStore(file), file };
}

describe("§6 step 1 — only a canonical validated path is persisted", () => {
  it("starts UNSET when nothing was ever remembered", async () => {
    const root = makeTree();
    const { store, file } = storeFor(root);
    expect(await store.current()).toEqual({ status: "UNSET" });
    expect(fs.existsSync(file)).toBe(false);
    expect(store.persistedPath()).toBeUndefined();
  });

  it("persists the canonical path of a validated directory", async () => {
    const root = makeTree();
    const workspace = path.join(root, "my project");
    fs.mkdirSync(workspace);
    const { store, file } = storeFor(root);

    const state = await store.remember(`  ${workspace.replace(/\\/g, "/")}  `);
    expect(state.status).toBe("AVAILABLE");
    expect(state.path).toBe(canonicalRealPathSync(workspace));

    const written = JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion: number; workspacePath: string };
    expect(written.schemaVersion).toBe(1);
    expect(written.workspacePath).toBe(state.path);
    expect(fs.existsSync(written.workspacePath)).toBe(true);
  });

  it("refuses an invalid path and writes nothing", async () => {
    const root = makeTree();
    const { store, file } = storeFor(root);

    const missing = await store.remember(path.join(root, "never-existed"));
    expect(missing.status).toBe("REJECTED");
    expect(missing.code).toBe("PATH_NOT_FOUND");
    expect(fs.existsSync(file)).toBe(false);

    const relative = await store.remember(".\\repo");
    expect(relative.status).toBe("REJECTED");
    expect(relative.code).toBe("NOT_ABSOLUTE");

    const asFile = path.join(root, "README.md");
    fs.writeFileSync(asFile, "# x");
    expect((await store.remember(asFile)).code).toBe("NOT_A_DIRECTORY");
    expect(fs.existsSync(file)).toBe(false);
    expect(await store.current()).toEqual({ status: "UNSET" });
  });

  it("never overwrites a good record with a bad one", async () => {
    const root = makeTree();
    const workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    const { store } = storeFor(root);
    await store.remember(workspace);
    await store.remember(path.join(root, "gone"));
    expect(store.persistedPath()).toBe(canonicalRealPathSync(workspace));
    expect((await store.current()).status).toBe("AVAILABLE");
  });

  it("forgets only when asked", async () => {
    const root = makeTree();
    const workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    const { store, file } = storeFor(root);
    await store.remember(workspace);
    expect(fs.existsSync(file)).toBe(true);
    store.forget();
    expect(fs.existsSync(file)).toBe(false);
    expect(await store.current()).toEqual({ status: "UNSET" });
  });
});

describe("§6 step 1 — a deleted remembered directory", () => {
  it("reads as STALE without throwing and keeps the remembered value visible", async () => {
    const root = makeTree();
    const workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    const { store } = storeFor(root);
    const remembered = await store.remember(workspace);
    expect(remembered.status).toBe("AVAILABLE");

    // The Owner deletes the directory between two launches.
    fs.rmSync(workspace, { recursive: true, force: true });

    const state = await store.current();
    expect(state.status).toBe("STALE");
    expect(state.code).toBe("PATH_NOT_FOUND");
    expect(state.path?.toLowerCase()).toBe(remembered.path?.toLowerCase());
    expect(store.persistedPath()).toBe(remembered.path); // the record is preserved for display
  });

  it("still reports STALE after a restart (a new store over the same file)", async () => {
    const root = makeTree();
    const workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    const { store, file } = storeFor(root);
    await store.remember(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });

    const restarted = new WorkspaceSelectionStore(file);
    expect((await restarted.current()).status).toBe("STALE");
  });
});

describe("§6 step 2 — an unavailable drive or network share", () => {
  it("does not crash when the remembered drive is not mounted", async () => {
    const root = makeTree();
    const { store, file } = storeFor(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, workspacePath: "Q:\\project", updatedAt: new Date().toISOString() }));

    const state = await store.current();
    expect(state.status).toBe("STALE");
    expect(["PATH_NOT_FOUND", "PATH_NOT_ACCESSIBLE"]).toContain(state.code);
    expect(state.path).toBe("Q:\\project");
  });

  it("does not crash when the remembered path is a file, a relative path or nonsense", async () => {
    const root = makeTree();
    const { store, file } = storeFor(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const value of ["C:\\somewhere\\file.txt", "relative\\repo", "", "   "]) {
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, workspacePath: value, updatedAt: "" }));
      const state = await store.current();
      expect(["STALE", "UNSET"]).toContain(state.status);
    }
  });

  it("reads corrupt or unsupported state as UNSET instead of refusing to start", async () => {
    const root = makeTree();
    const { store, file } = storeFor(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(file, "{ this is not json");
    expect(await store.current()).toEqual({ status: "UNSET" });

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, workspacePath: root }));
    expect(await store.current()).toEqual({ status: "UNSET" });

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1 }));
    expect(await store.current()).toEqual({ status: "UNSET" });
  });
});

describe("§6 startup behaviour — restoring the field starts nothing", () => {
  it("restores an available workspace as usable", () => {
    const restore = restoreWorkspaceField({ status: "AVAILABLE", path: "C:\\repo" });
    expect(restore).toEqual({ value: "C:\\repo", usable: true });
  });

  it("shows a stale workspace but marks it unusable, with the reason", () => {
    const restore = restoreWorkspaceField({ status: "STALE", path: "C:\\repo", code: "PATH_NOT_FOUND", reason: '"C:\\repo" does not exist' });
    expect(restore.value).toBe("C:\\repo");
    expect(restore.usable).toBe(false);
    expect(restore.notice).toContain("目录不存在");
    expect(restore.notice).toContain("C:\\repo");
  });

  it("restores nothing for UNSET, undefined or a rejected write", () => {
    expect(restoreWorkspaceField({ status: "UNSET" })).toEqual({ value: "", usable: false });
    expect(restoreWorkspaceField(undefined)).toEqual({ value: "", usable: false });
    expect(restoreWorkspaceField(null)).toEqual({ value: "", usable: false });
    expect(restoreWorkspaceField({ status: "REJECTED", code: "PATH_NOT_FOUND", reason: "x" })).toEqual({ value: "", usable: false });
  });

  it("never claims a stale path is usable, whatever its code", () => {
    for (const code of ["EMPTY_PATH", "INVALID_PATH", "NOT_ABSOLUTE", "PATH_NOT_FOUND", "NOT_A_DIRECTORY", "PATH_NOT_ACCESSIBLE", "UNRESOLVABLE"] as const) {
      expect(restoreWorkspaceField({ status: "STALE", path: "C:\\repo", code, reason: "x" }).usable).toBe(false);
    }
  });
});
