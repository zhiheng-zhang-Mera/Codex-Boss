/**
 * checkpoint-1 §6.1 — the host-side world model builder.
 *
 * The builder has to be honest about two things: what it actually observed (git
 * state, CI, workspaces, generated surfaces) and what it deliberately did not
 * read (the byte/file caps). These cases pin both, plus the import/export
 * extraction the dependency graph depends on.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_MODEL_LIMITS,
  WorldModelStore,
  buildWorldModel,
  buildWorldModelWithGraph,
  extractExportedSymbols,
  extractImportSpecifiers,
  readGitState,
  resolveSpecifier
} from "../../electron/engineering/world-model";
import { buildDependencyGraph, impactOf } from "../../src/shared/repo-world-model";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-world-model-"));

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
});

function fixtureRepo(name: string): string {
  const workspace = path.join(ROOT, name);
  fs.mkdirSync(path.join(workspace, "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "tests", "unit", "core"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
    name: "fixture-app",
    private: true,
    workspaces: ["packages/*"],
    scripts: { build: "tsc -p tsconfig.json", test: "vitest run", typecheck: "tsc --noEmit" },
    dependencies: { react: "19.0.0" },
    devDependencies: { electron: "44.0.0", vite: "8.0.0" }
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.writeFileSync(path.join(workspace, "tsconfig.json"), "{\"compilerOptions\":{}}", "utf8");
  fs.writeFileSync(path.join(workspace, "vite.config.mjs"), "export default {};\n", "utf8");
  fs.writeFileSync(path.join(workspace, "index.html"), "<html><body><div id=\"root\"></div></body></html>", "utf8");
  fs.writeFileSync(path.join(workspace, ".gitignore"), "node_modules\ndist\n", "utf8");
  fs.writeFileSync(path.join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
  fs.writeFileSync(path.join(workspace, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\n", "utf8");
  fs.writeFileSync(path.join(workspace, "src", "core", "engine.ts"), [
    "import { helper } from './helper.js';",
    "import yaml from 'yaml';",
    "import fs from 'node:fs';",
    "export class Engine { start() { return helper(); } }",
    "export const ENGINE_VERSION = '1';",
    ""
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, "src", "core", "helper.ts"), "export function helper() { return 1; }\n", "utf8");
  fs.writeFileSync(path.join(workspace, "tests", "unit", "core", "engine.test.ts"), "import '../../src/core/engine.js';\n", "utf8");
  fs.mkdirSync(path.join(workspace, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "node_modules", "dep", "index.js"), "module.exports = {};\n", "utf8");
  fs.mkdirSync(path.join(workspace, "dist"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "dist", "bundle.js"), "console.log(1);\n", "utf8");
  return workspace;
}

describe("§6.1 world model on a fixture repository", () => {
  const workspace = fixtureRepo("app");
  const model = buildWorldModel(workspace, { now: () => "2026-01-01T00:00:00.000Z", git: () => ({ is_repository: false, reason: "fixture" }) });

  it("identifies package managers, build system, runtimes and CI", () => {
    expect(model.package_managers).toEqual(["npm", "pnpm"]);
    expect(model.build_system.map((entry) => entry.tool)).toContain("tsc");
    expect(model.build_system.map((entry) => entry.tool)).toContain("vite");
    expect(model.build_system.map((entry) => entry.tool)).toContain("npm-scripts");
    expect(model.runtimes).toEqual(["browser", "electron", "node"]);
    expect(model.ci).toEqual([{ provider: "github-actions", files: [".github/workflows/ci.yml"] }]);
  });

  it("lists languages, entry points and tests from the real tree", () => {
    expect(model.languages.map((entry) => entry.language)).toContain("TypeScript");
    expect(model.entry_points).toContain("index.html");
    expect(model.tests).toEqual(["tests/unit/core/engine.test.ts"]);
  });

  it("reports generated surfaces and ignore files as observations", () => {
    const present = model.generated_surfaces.filter((entry) => entry.present).map((entry) => entry.path);
    expect(present).toContain("node_modules");
    expect(present).toContain("dist");
    expect(model.generated_surfaces.find((entry) => entry.path === "dist")?.reason).toContain("build output");
    expect(model.ignore_files).toEqual([".gitignore"]);
  });

  it("detects a monorepo boundary from workspace markers", () => {
    expect(model.workspace.kind).toBe("MONOREPO");
    expect(model.workspace.evidence).toEqual(expect.arrayContaining(["pnpm-workspace.yaml", "package.json#workspaces"]));
  });

  it("excludes generated trees from the module list", () => {
    expect(model.modules.some((module) => module.path.startsWith("node_modules/"))).toBe(false);
    expect(model.modules.some((module) => module.path.startsWith("dist/"))).toBe(false);
  });

  it("extracts imports and exports from real source", () => {
    const engine = model.modules.find((module) => module.path === "src/core/engine.ts")!;
    expect(engine.imports.map((entry) => entry.specifier)).toEqual(["./helper.js", "yaml", "node:fs"]);
    expect(engine.imports.find((entry) => entry.specifier === "yaml")?.external).toBe(true);
    expect(engine.imports.find((entry) => entry.specifier === "node:fs")?.builtin).toBe(true);
    expect(engine.exports).toEqual(["Engine", "ENGINE_VERSION"]);
  });

  it("resolves relative specifiers through extensions and index files", () => {
    const files = new Set(["src/core/helper.ts", "src/core/index.ts", "src/util.js"]);
    expect(resolveSpecifier("src/core/engine.ts", "./helper.js", files)).toBe("src/core/helper.ts");
    expect(resolveSpecifier("src/core/engine.ts", "./", files)).toBe("src/core/index.ts");
    expect(resolveSpecifier("src/core/engine.ts", "../util", files)).toBe("src/util.js");
    expect(resolveSpecifier("src/core/engine.ts", "yaml", files)).toBeUndefined();
  });

  it("marks the scan partial when the module cap is reached", () => {
    const capped = buildWorldModel(workspace, { now: () => "2026-01-01T00:00:00.000Z", git: () => ({ is_repository: false }), limits: { moduleFiles: 1 } });
    expect(capped.truncated).toBe(true);
    expect(capped.modules).toHaveLength(1);
    // Priority means the retained module is still the one discovery needs.
    expect(capped.modules[0].path).toBe("index.html");
  });

  it("keeps styles and UI components inside the model when it truncates", () => {
    const workspaceWithCss = fixtureRepo("app-css");
    fs.mkdirSync(path.join(workspaceWithCss, "src", "renderer"), { recursive: true });
    fs.writeFileSync(path.join(workspaceWithCss, "src", "renderer", "styles.css"), ".desktop-shell { color: #fff; }\n", "utf8");
    fs.writeFileSync(path.join(workspaceWithCss, "src", "renderer", "App.tsx"), "export const App = () => null;\n", "utf8");
    const capped = buildWorldModel(workspaceWithCss, { now: () => "2026-01-01T00:00:00.000Z", git: () => ({ is_repository: false }), limits: { ...DEFAULT_WORLD_MODEL_LIMITS, moduleFiles: 2 } });
    expect(capped.modules.map((module) => module.path)).toContain("src/renderer/styles.css");
    expect(capped.modules.length).toBeLessThanOrEqual(2);
  });
});

describe("§6.1 git state and durable store", () => {
  it("reports an honest failure instead of pretending a directory is a repository", () => {
    const state = readGitState(path.join(ROOT, "definitely-not-a-repository"));
    expect(state.is_repository).toBe(false);
    expect(state.reason).toContain("git");
    expect(state.head).toBeUndefined();
  });

  it("reads head, branch and dirty count from a real repository", () => {
    const workspace = fixtureRepo("app-git");
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    execFileSync("git", ["config", "user.email", "smoke@example.com"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", "Smoke"], { cwd: workspace });
    execFileSync("git", ["add", "."], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: workspace });
    const state = readGitState(workspace);
    expect(state.is_repository).toBe(true);
    expect(state.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state.branch).toMatch(/^(master|main)$/);
    expect(state.dirty_files).toBe(0);
    fs.appendFileSync(path.join(workspace, "package.json"), "\n", "utf8");
    expect(readGitState(workspace).dirty_files).toBe(1);
  });

  it("persists models and points `latest` at the newest one", () => {
    const workspace = fixtureRepo("app-store");
    const store = new WorldModelStore(path.join(workspace, ".boss", "world-model"));
    const built = buildWorldModelWithGraph(workspace, { now: () => "2026-01-01T00:00:00.000Z", git: () => ({ is_repository: false }) });
    store.put(built.model);
    expect(store.list()).toEqual([`${built.model.id}.json`]);
    expect(store.get(built.model.id)?.fingerprint).toBe(built.model.fingerprint);
    expect(store.latest()?.id).toBe(built.model.id);
    expect(store.get("wm-missing")).toBeUndefined();
  });

  it("derives the dependency graph and impact from the built model", () => {
    const workspace = fixtureRepo("app-graph");
    const built = buildWorldModelWithGraph(workspace, { now: () => "2026-01-01T00:00:00.000Z", git: () => ({ is_repository: false }) });
    expect(built.graph.nodes).toContain("src/core/engine.ts");
    expect(built.graph.edges).toContainEqual({ from: "src/core/engine.ts", to: "src/core/helper.ts", kind: "relative" });
    const impact = impactOf(built.graph, ["src/core/helper.ts"]);
    expect(impact.affected_modules).toContain("src/core/engine.ts");
    expect(built.summary.modules).toBe(built.model.modules.length);
    expect(buildDependencyGraph(built.model).edges.length).toBe(built.graph.edges.length);
  });

  it("extracts nothing dangerous from odd source text", () => {
    expect(extractImportSpecifiers("const x = 1; // import 'nope'", 10)).toEqual([]);
    expect(extractImportSpecifiers("import a from 'x'; import b from 'y';", 1)).toEqual(["x"]);
    expect(extractExportedSymbols("module.exports.thing = 1; exports.other = 2;")).toEqual(["other", "thing"]);
  });
});
