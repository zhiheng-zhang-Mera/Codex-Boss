import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalRealPathSync,
  isInsideWorkspace,
  isSameDirectory,
  normalizeWorkspacePath,
  requireWorkspacePath,
  requireWorkspacePathSync,
  resolveWorkspacePath,
  resolveWorkspacePathSync,
  validateWorkspacePath,
  WorkspacePathError
} from "../../electron/workspace/path-utils";

/**
 * Update-Plan/cleaning.md §3 — the single path model.
 *
 * These tests cover the five steps the plan names: Windows slash forms,
 * whitespace handling, relative paths, a non-existent path and a file used as a
 * workspace. They run against the real filesystem (real temp directories, real
 * `fs.statSync`) rather than a mocked one, because the point of the module is to
 * agree with Windows about what exists.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-path-utils-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("normalizeWorkspacePath — Windows slash forms (§3 step 1)", () => {
  it("gives C:\\repo, C:/repo and C:\\\\repo one canonical Windows form", () => {
    const root = makeTree();
    const expected = normalizeWorkspacePath(root);
    expect(expected).toMatch(/^[A-Z]:\\/);
    const forward = root.replace(/\\/g, "/");
    const doubled = root.replace(/\\/g, "\\\\");
    expect(normalizeWorkspacePath(forward)).toBe(expected);
    expect(normalizeWorkspacePath(doubled)).toBe(expected);
    expect(forward).not.toBe(expected); // the raw spellings really do differ
  });

  it("keeps Windows executable semantics — a canonical path is never rewritten to /", () => {
    const normalized = normalizeWorkspacePath("c:/repo");
    expect(normalized).toBe("C:\\repo");
    expect(normalized).not.toContain("/");
  });

  it("upper-cases the drive letter and collapses repeated separators", () => {
    expect(normalizeWorkspacePath("c:\\repo\\\\sub")).toBe("C:\\repo\\sub");
    expect(normalizeWorkspacePath("C://repo//sub")).toBe("C:\\repo\\sub");
  });

  it("drops a trailing separator but keeps a drive root", () => {
    expect(normalizeWorkspacePath("C:\\repo\\")).toBe("C:\\repo");
    expect(normalizeWorkspacePath("C:\\")).toBe("C:\\");
    expect(normalizeWorkspacePath("C:/")).toBe("C:\\");
  });

  it("preserves a UNC prefix instead of collapsing it into a rooted path", () => {
    expect(normalizeWorkspacePath("\\\\server\\share\\repo")).toBe("\\\\server\\share\\repo");
    expect(normalizeWorkspacePath("//server/share/repo")).toBe("\\\\server\\share\\repo");
  });

  it("is total: a non-string or whitespace-only input normalizes to the empty string", () => {
    expect(normalizeWorkspacePath(undefined as unknown as string)).toBe("");
    expect(normalizeWorkspacePath(null as unknown as string)).toBe("");
    expect(normalizeWorkspacePath("   ")).toBe("");
    expect(normalizeWorkspacePath("\t\r\n")).toBe("");
  });
});

describe("normalizeWorkspacePath — whitespace handling (§3 step 2)", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeWorkspacePath("  C:\\repo  ")).toBe("C:\\repo");
    expect(normalizeWorkspacePath("\tC:\\repo\n")).toBe("C:\\repo");
  });

  it("never changes a legal space inside a directory name", () => {
    expect(normalizeWorkspacePath("  C:\\my project\\a b  ")).toBe("C:\\my project\\a b");
    const root = makeTree();
    const spaced = path.join(root, "my project");
    fs.mkdirSync(spaced);
    const validation = validateWorkspacePath(`  ${spaced}  `);
    expect(validation.ok).toBe(true);
    expect(validation.normalizedPath).toBe(normalizeWorkspacePath(spaced));
    expect(validation.normalizedPath).toContain("my project");
  });
});

describe("validateWorkspacePath — relative paths (§3 step 3)", () => {
  it("refuses a relative path with an explicit code, not a vague message", () => {
    const validation = validateWorkspacePath(".\\repo");
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("NOT_ABSOLUTE");
    expect(validation.reason).toMatch(/absolute Windows path/);
  });

  it("refuses a bare relative name and a root-relative path", () => {
    expect(validateWorkspacePath("repo").code).toBe("NOT_ABSOLUTE");
    expect(validateWorkspacePath("\\repo").code).toBe("NOT_ABSOLUTE");
    expect(validateWorkspacePath("..\\repo").code).toBe("NOT_ABSOLUTE");
  });

  it("refuses a drive-relative path (C:repo) that could silently resolve against the ambient cwd", () => {
    const validation = validateWorkspacePath("C:repo");
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("NOT_ABSOLUTE");
    expect(validation.reason).toContain("names a drive but is not rooted");
  });

  it("refuses an empty or whitespace-only path with EMPTY_PATH", () => {
    expect(validateWorkspacePath("").code).toBe("EMPTY_PATH");
    expect(validateWorkspacePath("   ").code).toBe("EMPTY_PATH");
  });

  it("refuses a NUL byte as INVALID_PATH", () => {
    expect(validateWorkspacePath("C:\\repo\u0000x").code).toBe("INVALID_PATH");
  });
});

describe("validateWorkspacePath — existence and shape (§3 steps 4/5)", () => {
  it("reports PATH_NOT_FOUND for a directory that is not there", () => {
    const root = makeTree();
    const missing = path.join(root, "does-not-exist");
    const validation = validateWorkspacePath(missing);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("PATH_NOT_FOUND");
    expect(validation.reason).toBe(`"${normalizeWorkspacePath(missing)}" does not exist`);
    expect(validation.reason).not.toBe("invalid input");
  });

  it("reports PATH_NOT_FOUND for an entire drive that is not mounted", () => {
    // A removable/network volume that is currently absent must be a refusal, not a crash.
    const validation = validateWorkspacePath("Q:\\definitely-not-mounted\\project");
    expect(validation.ok).toBe(false);
    expect(["PATH_NOT_FOUND", "PATH_NOT_ACCESSIBLE"]).toContain(validation.code);
  });

  it("reports NOT_A_DIRECTORY when a file is used as the workspace", () => {
    const root = makeTree();
    const file = path.join(root, "README.md");
    fs.writeFileSync(file, "# not a workspace\n");
    const validation = validateWorkspacePath(file);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("NOT_A_DIRECTORY");
    expect(validation.reason).toContain("is a file, not a directory");
  });

  it("accepts a real directory and returns the canonical path", () => {
    const root = makeTree();
    const validation = validateWorkspacePath(` ${root.replace(/\\/g, "/")} `);
    expect(validation.ok).toBe(true);
    expect(validation.code).toBe("OK");
    expect(validation.normalizedPath).toBe(normalizeWorkspacePath(root));
  });
});

describe("resolveWorkspacePath — canonical identity", () => {
  it("resolves a real directory to its on-disk canonical path", async () => {
    const root = makeTree();
    const resolved = await resolveWorkspacePath(root.replace(/\\/g, "/"));
    expect(resolved.ok).toBe(true);
    expect(resolved.code).toBe("OK");
    // The reference is the OS-canonical spelling the module itself uses, not
    // `fs.realpathSync`: on Windows the JS implementation keeps 8.3 short names
    // (`C:\Users\RUNNER~1\...`) that the native one expands, and comparing
    // against it would fail on exactly the machines this code exists to handle.
    expect(resolved.canonicalPath).toBe(canonicalRealPathSync(root));
  });

  it("gives the same canonical path for every accepted spelling of one directory", async () => {
    const root = makeTree();
    const spellings = [root, root.replace(/\\/g, "/"), ` ${root} `, root.replace(/\\/g, "\\\\")];
    const canonical = await Promise.all(spellings.map(async (spelling) => (await resolveWorkspacePath(spelling)).canonicalPath));
    expect(new Set(canonical).size).toBe(1);
  });

  it("fails closed with the validation code instead of returning an unresolved path", async () => {
    const root = makeTree();
    const missing = await resolveWorkspacePath(path.join(root, "gone"));
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("PATH_NOT_FOUND");
    expect(missing.canonicalPath).toBeUndefined();

    const relative = await resolveWorkspacePath(".\\repo");
    expect(relative.ok).toBe(false);
    expect(relative.code).toBe("NOT_ABSOLUTE");

    const asFile = path.join(root, "a.txt");
    fs.writeFileSync(asFile, "x");
    expect((await resolveWorkspacePath(asFile)).code).toBe("NOT_A_DIRECTORY");
  });

  it("agrees with its synchronous counterpart", () => {
    const root = makeTree();
    const sync = resolveWorkspacePathSync(root);
    expect(sync.ok).toBe(true);
    expect(sync.canonicalPath).toBe(canonicalRealPathSync(root));
    expect(resolveWorkspacePathSync(path.join(root, "gone")).code).toBe("PATH_NOT_FOUND");
  });
});

describe("isInsideWorkspace — containment across two spellings of one directory", () => {
  /**
   * The failure this reproduces is the one the cloud runner found: the root is
   * canonicalized to one spelling while the candidate keeps another, and a purely
   * lexical compare then walks out of a directory that IS the root. A junction
   * produces exactly that disagreement on any Windows machine (an 8.3 short name
   * does the same on the runner), so the rule is testable without one.
   */
  function junction(linkPath: string, target: string): boolean {
    try { fs.symlinkSync(target, linkPath, "junction"); return true; } catch { return false; }
  }

  it("accepts a candidate spelled through a junction that points at the root", () => {
    const root = makeTree();
    const linked = path.join(root, "linked");
    fs.mkdirSync(linked);
    const link = path.join(makeTree(), "alias");
    if (!junction(link, linked)) return; // environment cannot create junctions; covered on CI
    expect(canonicalRealPathSync(link).toLowerCase()).not.toBe(link.toLowerCase()); // the two spellings really differ
    expect(isInsideWorkspace(linked, path.join(link, "child.txt"))).toBe(true);
    expect(isInsideWorkspace(linked, link)).toBe(true);
    expect(isInsideWorkspace(link, path.join(linked, "child.txt"))).toBe(true);
  });

  it("still refuses a candidate that is genuinely outside", () => {
    const root = makeTree();
    const inside = path.join(root, "inside");
    const outside = makeTree();
    fs.mkdirSync(inside);
    expect(isInsideWorkspace(root, path.join(inside, "child.txt"))).toBe(true);
    expect(isInsideWorkspace(root, path.join(outside, "child.txt"))).toBe(false);
    expect(isInsideWorkspace(root, root)).toBe(true);
    // A sibling whose name shares a prefix is not inside.
    const sibling = `${root}-sibling`;
    fs.mkdirSync(sibling);
    dirs.push(sibling);
    expect(isInsideWorkspace(root, path.join(sibling, "child.txt"))).toBe(false);
  });

  it("refuses traversal out of the root and accepts a relative candidate inside it", () => {
    const root = makeTree();
    fs.mkdirSync(path.join(root, "src"));
    expect(isInsideWorkspace(root, path.join("src", "file.ts"))).toBe(true);
    expect(isInsideWorkspace(root, path.join("..", "escape.ts"))).toBe(false);
  });
});

describe("isSameDirectory — path identity is not string equality", () => {  it("recognises one directory through different spellings", () => {
    const root = makeTree();
    fs.mkdirSync(path.join(root, "sub"));
    expect(isSameDirectory(root, root.replace(/\\/g, "/"))).toBe(true);
    expect(isSameDirectory(root, path.join(root, "sub", ".."))).toBe(true);
    expect(isSameDirectory(root, root.toUpperCase())).toBe(true);
    expect(isSameDirectory(root, canonicalRealPathSync(root))).toBe(true);
  });

  it("separates a directory from the one that contains it", () => {
    const root = makeTree();
    const nested = path.join(root, "sub");
    fs.mkdirSync(nested);
    expect(isSameDirectory(root, nested)).toBe(false);
    expect(isSameDirectory(nested, root)).toBe(false);
  });

  it("separates two unrelated directories, and refuses nonsense", () => {
    const first = makeTree();
    const second = makeTree();
    expect(isSameDirectory(first, second)).toBe(false);
    expect(isSameDirectory(first, path.join(first, "missing"))).toBe(false);
    expect(isSameDirectory("", first)).toBe(false);
    expect(isSameDirectory(undefined as unknown as string, first)).toBe(false);
  });

  it("is false for a file that shares a directory's name prefix", () => {
    const root = makeTree();
    const file = path.join(root, "note.txt");
    fs.writeFileSync(file, "x");
    expect(isSameDirectory(root, file)).toBe(false);
  });
});

describe("requireWorkspacePath — the fail-loud boundary", () => {
  it("throws a WorkspacePathError carrying the machine code", async () => {
    const root = makeTree();
    await expect(requireWorkspacePath(path.join(root, "gone"))).rejects.toBeInstanceOf(WorkspacePathError);
    try {
      requireWorkspacePathSync(path.join(root, "gone"));
      throw new Error("expected requireWorkspacePathSync to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspacePathError);
      expect((error as WorkspacePathError).code).toBe("PATH_NOT_FOUND");
      expect((error as WorkspacePathError).message).toContain("[PATH_NOT_FOUND]");
    }
  });

  it("returns the resolved workspace for a valid directory", async () => {
    const root = makeTree();
    const resolved = await requireWorkspacePath(root);
    expect(resolved.canonicalPath).toBe(canonicalRealPathSync(root));
  });
});
