import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileIntent } from "../../src/shared/task-ir";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { EngineeringRuntime } from "../../electron/engineering/engineering-runtime";
import { applyScopedChanges, digest, verifyAndRepair } from "../../electron/engineering/verification";
describe("engineering evidence and isolation", () => {
  it("runs three independent scopes, verifies and resumes without repetition", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-graph-"));
    try {
      const plan = compileIntent("work", { allowParallel: true, steps: ["a", "b", "c"].map((id) => ({ id, kind: "worker", description: id, dependencies: [], requiredFiles: [id] })) });
      let active = 0; let peak = 0; let calls = 0;
      const executor = { async execute() { calls++; active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; return "evidence"; }, async verify(_step: unknown, output: string) { return output === "evidence"; } };
      const runtime = new EngineeringRuntime(new TaskLedger(root));
      expect((await runtime.run("task", plan, executor)).status).toBe("COMPLETED");
      expect(peak).toBe(3); await runtime.run("task", plan, executor); expect(calls).toBe(3);
      expect((await runtime.run("task", plan, { ...executor, async verify() { return false; } })).status).toBe("FAILED");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("applies hash-bound scoped changes and repairs a real syntax failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-repair-"));
    try {
      const file = path.join(root, "app.js"); fs.writeFileSync(file, "const broken = ;");
      expect(() => applyScopedChanges(root, [{ path: "app.js", expectedSha256: "stale", content: "" }], ["app.js"])).toThrow("Source changed");
      let repairs = 0;
      const evidence = await verifyAndRepair(root, [{ kind: "syntax", file: "app.js" }], async () => { repairs++; applyScopedChanges(root, [{ path: "app.js", expectedSha256: digest(fs.readFileSync(file, "utf8")), content: "const fixed = 1;" }], ["app.js"]); });
      expect(repairs).toBe(1); expect(evidence[0].passed).toBe(true);
      expect(() => applyScopedChanges(root, [{ path: "../bad", expectedSha256: null, content: "" }], ["app.js"])).toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("does not complete on a worker's self-report", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-failed-"));
    try { const result = await new EngineeringRuntime(new TaskLedger(root)).run("task", compileIntent("implement"), { async execute() { return "done"; }, async verify() { return false; } }); expect(result.status).toBe("FAILED"); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
