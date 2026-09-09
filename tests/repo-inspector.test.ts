import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepo, selectTestsForFiles } from "../electron/engineering/repo-inspector";
import { requiredEngineeringChecks } from "../electron/engineering/verification-policy";
import { PlanCompiler, needsPlanning } from "../electron/commander/plan-compiler";
import { canonicalJson, canonicalSections } from "../src/shared/context-fingerprint";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-repo-inspect-")); dirs.push(dir); return dir; }
function write(root: string, relative: string, content = "") { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

describe("repo inspector", () => {
  it("indexes files and groups tests per directory with a change fingerprint", () => {
    const dir = root();
    write(dir, "src/lib.ts", "export const a = 1");
    write(dir, "src/lib.test.ts", "test");
    write(dir, "src/deep/util.spec.js");
    write(dir, "package.json", "{}");
    write(dir, "node_modules/dep/dep.js", "skip me");
    write(dir, ".cache/cache.bin", "skip me");
    const snapshot = scanRepo(dir);
    expect(snapshot.files).toContain("src/lib.ts");
    expect(snapshot.files).toContain("package.json");
    expect(snapshot.files.some((file) => file.startsWith("node_modules") || file.startsWith(".cache"))).toBe(false);
    expect(snapshot.testMap["src"]).toContain("src/lib.test.ts");
    expect(snapshot.testMap["src/deep"]).toEqual(["src/deep/util.spec.js"]);
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.skippedDirectories).toBeGreaterThan(0);
  });

  it("changes the fingerprint when a file is added and selects co-located tests", () => {
    const dir = root();
    write(dir, "src/lib.ts");
    write(dir, "src/lib.test.ts", "test");
    const before = scanRepo(dir);
    write(dir, "src/extra.ts");
    const after = scanRepo(dir);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(selectTestsForFiles(after, ["src/lib.ts"])).toEqual(["src/lib.test.ts"]);
    expect(selectTestsForFiles(after, ["docs/readme.md"])).toEqual([]);
  });
});

describe("repo inspector adoption", () => {
  it("discovers tests for engineering verification through the inspector", () => {
    const dir = root();
    write(dir, "sum.cjs", "module.exports = (a,b) => a+b;");
    write(dir, "sum.test.cjs", "test");
    write(dir, "tsconfig.json", "{}");
    const checks = requiredEngineeringChecks(dir, ["sum.cjs"]);
    const testCheck = checks.find((check) => check.kind === "test");
    expect(testCheck?.kind).toBe("test");
    if (testCheck && "files" in testCheck) expect((testCheck as { files?: string[] }).files).toContain("sum.test.cjs");
    expect(() => requiredEngineeringChecks(root(), ["sum.cjs"])).toThrow(/No test files discovered/);
  });

  it("keeps the planner inventory from the repo index instead of a shallow listing", async () => {
    const dir = root();
    write(dir, "tasks.md", "Read a then summarize");
    write(dir, "src/one.ts", "export = 1");
    write(dir, "src/two.ts", "export = 2");
    write(dir, "src/deep/three.ts", "export = 3");
    const goal = "按照 tasks.md 重构项目并测试";
    let prompt = "";
    const compiler = new PlanCompiler(async (input) => { prompt = input; return JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [{ id: "a", kind: "worker", description: "a", dependencies: [], requiredFiles: [] }] }); });
    await compiler.compile(goal, dir);
    expect(prompt).toContain("tasks.md");
    expect(prompt).toContain("src/deep/three.ts");
    expect(prompt).not.toContain("node_modules");
    expect(needsPlanning("First compare options then choose a policy and write it to a file")).toBe(true);
  });
});

describe("canonical context sections", () => {
  it("renders deterministic, undefined-free JSON for hashing", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: [1, 2] })).toBe('{"a":1,"c":[1,2]}');
    const one = canonicalSections({ objective: "x" }, ["a", "b"]);
    const two = canonicalSections({ objective: "x" }, ["a", "b"]);
    expect(one).toBe(two);
  });
});
