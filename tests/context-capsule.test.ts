import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileContextCapsule } from "../src/shared/context-capsule";
import { ContextManager } from "../electron/commander/context-manager";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-capsule-")); dirs.push(dir); return dir; }

describe("context capsule compiler", () => {
  it("compiles a C0 capsule from role + objective when no files are needed", () => {
    const capsule = compileContextCapsule({ role: "coder", objective: "implement a parser", maxChars: 24000 });
    expect(capsule.level).toBe("C0");
    expect(capsule.chars).toBeGreaterThan(0);
    expect(capsule.fingerprint).toMatch(/^\[/); // canonical JSON starts with an array
  });

  it("promotes to C1 when files are in scope and prunes past the budget", () => {
    const big = "x".repeat(2000);
    const capsule = compileContextCapsule({
      role: "coder", objective: "fix bug",
      files: { "src/a.ts": big, "src/b.ts": big },
      dependencies: { "src/lib.ts": big },
      maxChars: 2600
    });
    expect(capsule.level).toBe("C1");
    expect(capsule.chars).toBeLessThanOrEqual(2600 + 2000); // at most one file beyond the budget break
    expect(capsule.sections.length).toBeGreaterThan(1);
  });

  it("produces a deterministic fingerprint and a different one when content changes", () => {
    const a = compileContextCapsule({ role: "reviewer", objective: "audit", files: { "a.md": "one" } });
    const b = compileContextCapsule({ role: "reviewer", objective: "audit", files: { "a.md": "one" } });
    const c = compileContextCapsule({ role: "reviewer", objective: "audit", files: { "a.md": "two" } });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it("stays C0 when no file layers exist even with a large budget", () => {
    const capsule = compileContextCapsule({ role: "planner", objective: "hello", maxChars: 100000 });
    expect(capsule.level).toBe("C0");
    expect(capsule.sections).toHaveLength(1);
  });
});

describe("ContextManager capsule adoption", () => {
  it("builds a fingerprint capsule from stored task context and file scope", () => {
    const file = path.join(root(), "contexts.json");
    const manager = new ContextManager(file);
    manager.save({ taskId: "task", objective: "fix bug", constraints: [], currentProtocol: "direct", currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [{ id: "s", text: "summary", createdAt: new Date(0).toISOString() }], executionHistory: [] });
    const a = manager.capsule("task", "coder", { "src/a.ts": "code v1" });
    const b = manager.capsule("task", "coder", { "src/a.ts": "code v2" });
    const withoutFiles = manager.capsule("task", "coder");
    expect(a.level).toBe("C1");
    expect(a.fingerprint).not.toBe(b.fingerprint);
    // Dependencies (disputes/summaries) always promote to C1; adding files grows the capsule.
    expect(withoutFiles.level).toBe("C1");
    expect(a.sections.length).toBeGreaterThan(withoutFiles.sections.length);
  });
});
