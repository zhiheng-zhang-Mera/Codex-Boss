import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  selectWorkspaceDirectory,
  workspacePickerOptions,
  WORKSPACE_PICKER_TITLE,
  type DirectoryPicker
} from "../../electron/workspace/workspace-picker";
import { canonicalRealPathSync, WorkspacePathError } from "../../electron/workspace/path-utils";

/**
 * Update-Plan/cleaning.md §4 — the native workspace picker.
 *
 * Electron's `dialog` cannot run in a unit test, so it is injected. Everything
 * that decides what a selection *means* is the production code under test here:
 * the dialog options, the cancel contract (null, never "") and the requirement
 * that a picked path is canonicalized by the same model a typed path uses.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-picker-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A picker that answers with a fixed selection and records the options it got. */
function pickerReturning(result: { canceled: boolean; filePaths: string[] }): { pick: DirectoryPicker; seen: Array<{ title: string; properties: string[] }> } {
  const seen: Array<{ title: string; properties: string[] }> = [];
  const pick: DirectoryPicker = async (options) => {
    seen.push({ title: options.title, properties: [...options.properties] });
    return result;
  };
  return { pick, seen };
}

describe("§4 step 1 — the picker is a native folder chooser", () => {
  it("asks Electron for openDirectory through the one documented options shape", () => {
    expect(workspacePickerOptions()).toEqual({ title: WORKSPACE_PICKER_TITLE, properties: ["openDirectory"] });
  });
});

describe("§4 step 2/3 — selection and cancellation behaviour", () => {
  it("returns the canonical path of the picked directory", async () => {
    const root = makeTree();
    const { pick, seen } = pickerReturning({ canceled: false, filePaths: [root.replace(/\\/g, "/")] });
    const selected = await selectWorkspaceDirectory(pick);
    expect(selected).toBe(canonicalRealPathSync(root));
    expect(seen).toEqual([{ title: WORKSPACE_PICKER_TITLE, properties: ["openDirectory"] }]);
  });

  it("returns null on cancel — never an empty string that would clear the workspace", async () => {
    const { pick } = pickerReturning({ canceled: true, filePaths: [] });
    const selected = await selectWorkspaceDirectory(pick);
    expect(selected).toBeNull();
    expect(selected).not.toBe("");
  });

  it("treats an uncancelled dialog with no path as a cancel", async () => {
    const { pick } = pickerReturning({ canceled: false, filePaths: [] });
    expect(await selectWorkspaceDirectory(pick)).toBeNull();
  });

  it("ignores extra paths and takes the first selection", async () => {
    const first = makeTree();
    const second = makeTree();
    const { pick } = pickerReturning({ canceled: false, filePaths: [second, first] });
    const selected = await selectWorkspaceDirectory(pick);
    expect(selected).toBe(canonicalRealPathSync(second));
  });

  it("fails closed when the OS hands back a path that cannot be a workspace", async () => {
    const root = makeTree();
    const file = path.join(root, "not-a-directory.txt");
    fs.writeFileSync(file, "x");
    const { pick } = pickerReturning({ canceled: false, filePaths: [file] });
    await expect(selectWorkspaceDirectory(pick)).rejects.toBeInstanceOf(WorkspacePathError);
    try {
      await selectWorkspaceDirectory(pickerReturning({ canceled: false, filePaths: [path.join(root, "gone")] }).pick);
      throw new Error("expected the picker to refuse a missing directory");
    } catch (error) {
      expect((error as WorkspacePathError).code).toBe("PATH_NOT_FOUND");
    }
  });
});

describe("§4 step 4/5/6 — one model behind picker and typed input", () => {
  it("gives the picked path and the typed path the same canonical value", async () => {
    const root = makeTree();
    const { validateWorkspacePath, resolveWorkspacePath } = await import("../../electron/workspace/path-utils");
    const picked = await selectWorkspaceDirectory(pickerReturning({ canceled: false, filePaths: [root] }).pick);
    // Both entries end at the same canonical identity — the picker through
    // `requireWorkspacePath`, the typed path through the same validation and
    // resolution. A different spelling of one directory cannot produce two
    // workspaces (the comparison is on the canonical value, not the raw text:
    // on Windows the OS spelling of `C:\Users\RUNNER~1\...` is the long form).
    const typed = validateWorkspacePath(`  ${root.replace(/\\/g, "/")}  `);
    expect(typed.ok).toBe(true);
    expect(picked).toBe(canonicalRealPathSync(root));
    expect(picked).toBe((await resolveWorkspacePath(root)).canonicalPath);
  });

  it("typed valid and typed invalid paths are answered with explicit codes", async () => {
    const { validateWorkspacePath } = await import("../../electron/workspace/path-utils");
    const root = makeTree();
    expect(validateWorkspacePath(root).code).toBe("OK");
    expect(validateWorkspacePath(path.join(root, "nope")).code).toBe("PATH_NOT_FOUND");
    expect(validateWorkspacePath(".\\repo").code).toBe("NOT_ABSOLUTE");
    expect(validateWorkspacePath("   ").code).toBe("EMPTY_PATH");
  });
});
