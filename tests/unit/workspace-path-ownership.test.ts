import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_OWNED_PATHS } from "../../electron/runtime-paths";
import { availableWorkspace, persistedWorkspaceAvailable, workspaceForRequest } from "../../electron/workspace/task-workspace";
import { researchDeliverablesPath, researchTopicSlug } from "../../electron/research/research-output";
import { canonicalRealPathSync, WorkspacePathError } from "../../electron/workspace/path-utils";

/**
 * Update-Plan/cleaning.md §5 — workspace, output and runtime-path ownership.
 *
 * The real repository is the fixture for the pollution guard: a declared runtime
 * root that git would not ignore, or that already owns a tracked file, fails
 * here rather than silently shipping untracked files into a user's checkout.
 */

const PROJECT = process.cwd();

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ownership-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function git(args: string[]): { code: number; stdout: string } {
  try {
    return { code: 0, stdout: execFileSync("git", args, { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
  } catch (error) {
    return { code: (error as { status?: number }).status ?? 1, stdout: String((error as { stdout?: string }).stdout ?? "") };
  }
}

describe("§5 step 4 — runtime paths never pollute the source tree", () => {
  it("declares at least the app data root, the scratch root and the acceptance root", () => {
    expect(RUNTIME_OWNED_PATHS).toContain("runtime-data/");
    expect(RUNTIME_OWNED_PATHS).toContain(".cache/");
    expect(RUNTIME_OWNED_PATHS).toContain("artifacts/");
    expect(new Set(RUNTIME_OWNED_PATHS).size).toBe(RUNTIME_OWNED_PATHS.length);
  });

  it("every declared runtime path is ignored by git", () => {
    const notIgnored = RUNTIME_OWNED_PATHS.filter((relative) => git(["check-ignore", "-q", `${relative}placeholder`]).code !== 0);
    expect(notIgnored).toEqual([]);
  });

  it("no declared runtime path owns a tracked file", () => {
    const tracked = RUNTIME_OWNED_PATHS.filter((relative) => git(["ls-files", "--", relative]).stdout.trim() !== "");
    expect(tracked).toEqual([]);
  });

  it("no declared runtime path is inside a tracked source directory", () => {
    const sourceRoots = ["src/", "electron/", "tests/", "scripts/", "trust-policy/", "docs/", ".github/"];
    const inside = RUNTIME_OWNED_PATHS.filter((relative) => sourceRoots.some((source) => relative.startsWith(source)));
    expect(inside).toEqual([]);
  });

  it("the repository still has its source directories intact (the guard is testing something real)", () => {
    for (const source of ["src", "electron", "tests", "scripts"]) {
      expect(fs.existsSync(path.join(PROJECT, source))).toBe(true);
      expect(git(["ls-files", "--", `${source}/`]).stdout.trim()).not.toBe("");
    }
  });
});

describe("§5 step 2/3 — one resolution of a request workspace", () => {
  it("canonicalizes an explicitly requested workspace", () => {
    const root = makeTree();
    const resolved = workspaceForRequest({ requested: ` ${root.replace(/\\/g, "/")} `, fallback: PROJECT });
    expect(resolved).toBe(canonicalRealPathSync(root));
  });

  it("refuses an unusable requested workspace with an explicit code and never falls back", () => {
    const root = makeTree();
    const missing = path.join(root, "gone");
    try {
      workspaceForRequest({ requested: missing, fallback: PROJECT });
      throw new Error("expected workspaceForRequest to refuse a missing directory");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspacePathError);
      expect((error as WorkspacePathError).code).toBe("PATH_NOT_FOUND");
    }
    expect(() => workspaceForRequest({ requested: ".\\repo", fallback: PROJECT })).toThrow(WorkspacePathError);
    const file = path.join(root, "README.md");
    fs.writeFileSync(file, "# x");
    expect(() => workspaceForRequest({ requested: file, fallback: PROJECT })).toThrow(/NOT_A_DIRECTORY/);
  });

  it("uses the fallback only when the request named no workspace at all", () => {
    expect(workspaceForRequest({ fallback: PROJECT })).toBe(PROJECT);
    expect(workspaceForRequest({ requested: "   ", fallback: PROJECT })).toBe(PROJECT);
  });

  it("lets a materialized repository win over the requested path", () => {
    const root = makeTree();
    expect(workspaceForRequest({ requested: "C:\\does-not-exist", repositoryLocalPath: root, fallback: PROJECT })).toBe(root);
  });
});

describe("§5 step 2 — a persisted workspace is resolved, not required", () => {
  it("returns the canonical path while the remembered directory still exists", () => {
    const root = makeTree();
    expect(availableWorkspace({ workspacePath: root }, PROJECT)).toBe(canonicalRealPathSync(root));
    expect(persistedWorkspaceAvailable({ workspacePath: root })).toBe(true);
  });

  it("falls back instead of throwing when the remembered directory is gone", () => {
    const root = makeTree();
    const gone = path.join(root, "deleted-after-remembering");
    expect(availableWorkspace({ workspacePath: gone }, PROJECT)).toBe(PROJECT);
    expect(persistedWorkspaceAvailable({ workspacePath: gone })).toBe(false);
  });

  it("falls back for a remembered path that is now a file, a relative path or absent", () => {
    const root = makeTree();
    const file = path.join(root, "file.txt");
    fs.writeFileSync(file, "x");
    expect(availableWorkspace({ workspacePath: file }, PROJECT)).toBe(PROJECT);
    expect(availableWorkspace({ workspacePath: ".\\relative" }, PROJECT)).toBe(PROJECT);
    expect(availableWorkspace({}, PROJECT)).toBe(PROJECT);
    expect(availableWorkspace({ workspacePath: "  " }, PROJECT)).toBe(PROJECT);
  });
});

describe("§5 step 3 — the default output root is deterministic", () => {
  it("puts research deliverables under <workspace>/Research/<topic>", () => {
    const workspace = "C:\\Projects\\demo";
    const destination = researchDeliverablesPath(workspace, "Does a latency guard reduce timeouts?");
    expect(destination).toBe(path.join(workspace, "Research", "does-a-latency-guard-reduce-timeouts"));
  });

  it("is stable for one question and different for a different one", () => {
    const workspace = "C:\\Projects\\demo";
    const question = "Does a latency guard reduce timeouts?";
    expect(researchDeliverablesPath(workspace, question)).toBe(researchDeliverablesPath(workspace, question));
    expect(researchDeliverablesPath(workspace, question)).not.toBe(researchDeliverablesPath(workspace, "Another question entirely"));
  });

  it("never puts a timestamp in the path and never yields an empty topic", () => {
    const slug = researchTopicSlug("Does a latency guard reduce timeouts?");
    expect(slug).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10,}/);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(researchTopicSlug("研究：延迟守卫")).toBe("research");
    expect(researchTopicSlug("")).toBe("research");
  });

  it("stays inside the workspace it was given", () => {
    const workspace = makeTree();
    const destination = researchDeliverablesPath(workspace, "Topic with spaces & symbols!");
    expect(path.resolve(destination).startsWith(path.resolve(workspace) + path.sep)).toBe(true);
  });
});
