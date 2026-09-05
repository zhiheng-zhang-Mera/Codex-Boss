import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepo } from "../electron/engineering/repo-inspector";
import { affectedTests, dependencyClosure, importEdges, targetedTestsForChanged } from "../electron/engineering/semantic-slice";
import { requiredEngineeringChecks } from "../electron/engineering/verification-policy";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-slice-")); dirs.push(dir); return dir; }
function write(root: string, relative: string, content = "") { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

describe("semantic code slice", () => {
  it("builds import edges for relative imports only", () => {
    const dir = root();
    write(dir, "src/a.ts", "import { b } from './b';");
    write(dir, "src/b.ts", "export const b = 1;");
    write(dir, "src/c.ts", "import x from 'pkg-pkg'; export { a } from '../src/a';");
    const snapshot = scanRepo(dir);
    const edges = importEdges(snapshot);
    expect(edges.get("src/a.ts")).toEqual(["src/b.ts"]);
    expect(edges.get("src/b.ts")).toEqual([]);
    // Non-relative import is skipped; relative re-export is resolved.
    expect(edges.get("src/c.ts")).toEqual(["src/a.ts"]);
  });

  it("finds affected tests through the import graph and reports a deterministic subset", () => {
    const dir = root();
    write(dir, "src/a.ts", "export const a = 1;");
    write(dir, "src/b.ts", "export const b = 2;");
    write(dir, "src/a.test.ts", "import { a } from './a'; test('a', () => a);");
    write(dir, "src/b.test.ts", "import { b } from './b'; test('b', () => b);");
    write(dir, "unrelated.test.ts", "test('other', () => {});");
    const snapshot = scanRepo(dir);
    const forA = affectedTests(snapshot, ["src/a.ts"]);
    expect(forA).toContain("src/a.test.ts");
    expect(forA).not.toContain("src/b.test.ts");
    expect(forA).not.toContain("unrelated.test.ts");
    // Subset of the full discovered suite and stable ordering.
    const all = Object.values(snapshot.testMap).flat().sort();
    expect(forA.every((file) => all.includes(file))).toBe(true);
    expect(affectedTests(snapshot, ["src/a.ts"])).toEqual(forA);
  });

  it("computes a bounded dependency closure", () => {
    const dir = root();
    write(dir, "x.ts", "import './y'; import './z';");
    write(dir, "y.ts", "import './w';");
    write(dir, "z.ts", "");
    write(dir, "w.ts", "");
    const snapshot = scanRepo(dir);
    expect(dependencyClosure(snapshot, ["x.ts"]).sort()).toEqual(["w.ts", "x.ts", "y.ts", "z.ts"]);
  });

  it("convenience helper scans and selects targeted tests for changed files", () => {
    const dir = root();
    write(dir, "lib/util.ts", "export const u = 1;");
    write(dir, "lib/util.test.ts", "import { u } from './util'; test('u', () => u);");
    write(dir, "lib/other.ts", "");
    const tests = targetedTestsForChanged(dir, ["lib/util.ts"]);
    expect(tests).toEqual(["lib/util.test.ts"]);
  });
});

describe("verification policy targeted test adoption", () => {
  it("runs only affected tests when they exist and falls back to the full suite otherwise", () => {
    const dir = root();
    write(dir, "sum.cjs", "module.exports = (a,b) => a+b;");
    write(dir, "sum.test.cjs", "const assert = require('node:assert/strict'); assert.equal(require('./sum.cjs')(2,3),5);");
    write(dir, "unrelated.cjs", "module.exports = 0;");
    write(dir, "unrelated.test.cjs", "const assert = require('node:assert/strict'); assert.equal(require('./unrelated.cjs'),0);");
    const checks = requiredEngineeringChecks(dir, ["sum.cjs"]);
    const testCheck = checks.find((check) => check.kind === "test") as { kind: "test"; files?: string[] };
    expect(testCheck.files).toEqual(["sum.test.cjs"]); // dependency-aware: only the affected test
    const allChecks = requiredEngineeringChecks(dir, ["unrelated.cjs"]);
    const fullCheck = allChecks.find((check) => check.kind === "test") as { kind: "test"; files?: string[] };
    expect(fullCheck.files).toEqual(["unrelated.test.cjs"]);
    const rootTests = requiredEngineeringChecks(dir, ["missing-file.cjs"]);
    const rootCheck = rootTests.find((check) => check.kind === "test") as { kind: "test"; files?: string[] };
    expect(rootCheck.files).toEqual(["sum.test.cjs", "unrelated.test.cjs"]); // fallback to full suite
  });
});
