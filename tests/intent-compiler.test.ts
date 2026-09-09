import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileIntent, shouldReplan, validateGraph } from "../src/shared/task-ir";
import { executeNative, workspacePath } from "../electron/engineering/native-tools";
describe("progressive intent compilation", () => {
  it("keeps simple tasks at L0/L1 without planner calls", () => {
    const tasks = ["git status", "查看 git 状态", "list files", "read file README.md", "解释这段代码", "修复按钮", "summarize this", "write an email draft", "implement a parser", "review the answer"];
    expect(tasks.map((task) => compileIntent(task).estimatedComplexity).every((level) => ["L0", "L1"].includes(level))).toBe(true);
    expect(compileIntent("git status && delete files").estimatedComplexity).toBe("L1");
    expect(compileIntent("publish release").riskLevel).toBe("high");
    expect(shouldReplan("response")).toBe(false); expect(shouldReplan("step_failed", 2)).toBe(true);
  });
  it("bounds parallelism and rejects malformed dependency graphs", () => {
    const steps = ["a", "b", "c", "d"].map((id) => ({ id, kind: "worker" as const, description: id, dependencies: [], requiredFiles: [] }));
    expect(compileIntent("implement", { steps, allowParallel: true }).maxWorkers).toBe(3);
    expect(compileIntent("implement", { steps }).estimatedComplexity).toBe("L2");
    expect(() => validateGraph([{ ...steps[0], dependencies: ["a"] }])).toThrow("Cyclic");
    expect(() => validateGraph([{ ...steps[0], dependencies: ["missing"] }])).toThrow("Missing");
  });
  it("lets a wider Work pool raise the engineering worker cap while defaulting to 3 (U3 §35)", () => {
    const steps = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, kind: "worker" as const, description: id, dependencies: [], requiredFiles: [] }));
    // Default (no explicit cap) stays 3 for compatibility…
    expect(compileIntent("implement", { steps, allowParallel: true }).maxWorkers).toBe(3);
    // …but a 5-AI intensive pool may widen L3 parallelism up to 5.
    expect(compileIntent("implement", { steps, allowParallel: true, maxWorkers: 5 }).maxWorkers).toBe(5);
    // Caps are validated/clamped: out-of-range values cannot widen arbitrarily.
    expect(compileIntent("implement", { steps, allowParallel: true, maxWorkers: 8 }).maxWorkers).toBe(5);
    expect(compileIntent("implement", { steps, allowParallel: true, maxWorkers: 0 }).maxWorkers).toBe(1);
    // Single-worker / L1 plans stay 1 regardless of a wider cap.
    expect(compileIntent("hello", { maxWorkers: 5 }).maxWorkers).toBe(1);
  });
  it("executes native reads with no model call and confines paths", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-native-"));
    try { fs.writeFileSync(path.join(dir, "file.txt"), "known content"); expect(await executeNative(dir, { kind: "read_file", path: "file.txt" })).toMatchObject({ output: "known content", modelCalls: 0, verified: true }); expect(() => workspacePath(dir, "../escape")).toThrow(); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
