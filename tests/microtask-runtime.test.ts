import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileIntent } from "../src/shared/task-ir";
import { singleMicrotask } from "../src/shared/microtask";
import { TaskLedger } from "../electron/commander/task-ledger";
import { EngineeringRuntime } from "../electron/engineering/engineering-runtime";
import { MicrotaskRuntime } from "../electron/engineering/microtask-runtime";

function rootDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "boss-microtask-")); }

const EDIT_STEP = { id: "edit_step", kind: "edit" as const, description: "refactor module", dependencies: [], requiredFiles: ["src/a.ts", "src/b.ts"], operation: undefined };

describe("singleFileScope microtask decomposition", () => {
  it("expands an edit step into read → propose → verify with the parent scope", () => {
    const micro = singleMicrotask(EDIT_STEP);
    expect(micro.map((item) => item.kind)).toEqual(["read", "propose", "verify"]);
    expect(micro[0].dependencies).toEqual([]);
    expect(micro[1].dependencies).toEqual([micro[0].id]);
    expect(micro[2].dependencies).toEqual([micro[1].id]);
    expect(micro.every((item) => item.parentStepId === "edit_step")).toBe(true);
    expect(micro.every((item) => item.requiredFiles.includes("src/a.ts"))).toBe(true);
  });
});

describe("MicrotaskRuntime durable execution", () => {
  it("executes a micro-DAG, persists per-microtask jobs and reuses verified evidence across restart", async () => {
    const root = rootDir();
    try {
      const ledger = new TaskLedger(root);
      const micro = singleMicrotask(EDIT_STEP);
      let executes = 0; let verifies = 0;
      const executor = {
        async execute(item: { id: string; kind: string }) { executes++; return item.kind === "verify" ? "ok" : `evidence-${item.id}`; },
        async verify(_item: unknown, output: string) { verifies++; return output.startsWith("evidence-") || output === "ok"; }
      };
      const runtime = new MicrotaskRuntime(ledger);
      const first = await runtime.runStep("task", EDIT_STEP, micro, executor);
      expect(first.status).toBe("COMPLETED");
      expect(Object.keys(first.outputs)).toHaveLength(3);
      // Per-microtask jobs persisted under the step microtask scope.
      expect(ledger.load("task")!.jobs["graph_edit_step_microtask_edit_step_read_0"]?.state).toBe("COMPLETED");
      expect(ledger.load("task")!.jobs["graph_edit_step_microtask_edit_step_verify"]?.state).toBe("COMPLETED");
      const callsAfterFirst = executes;
      // Restart: persisted evidence is revalidated, not re-executed.
      const second = await runtime.runStep("task", EDIT_STEP, micro, executor);
      expect(second.status).toBe("COMPLETED");
      expect(executes).toBe(callsAfterFirst);
      expect(verifies).toBeGreaterThan(callsAfterFirst);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a changed micro-DAG on the same task and surfaces failures/deferreds", async () => {
    const root = rootDir();
    try {
      const ledger = new TaskLedger(root);
      const micro = singleMicrotask(EDIT_STEP);
      const okExecutor = { async execute(item: { kind: string }) { return item.kind === "verify" ? "ok" : "evidence"; }, async verify(_item: unknown, output: string) { return output === "ok" || output === "evidence"; } };
      const runtime = new MicrotaskRuntime(ledger);
      await runtime.runStep("task", EDIT_STEP, micro, okExecutor);
      // A changed DAG must fail closed instead of reusing stale jobs.
      await expect(runtime.runStep("task", { ...EDIT_STEP }, [{ ...micro[0], id: "different" }], okExecutor)).rejects.toThrow(/changed/);
      // A failing verify propagates FAILED with the failing microtask.
      const failing = await runtime.runStep("task2", EDIT_STEP, micro, { async execute() { return "bad"; }, async verify() { return false; } });
      expect(failing.status).toBe("FAILED");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("wires into EngineeringRuntime via the executor microtask mode", async () => {
    const root = rootDir();
    try {
      const ledger = new TaskLedger(root);
      const plan = compileIntent("refactor module", { steps: [EDIT_STEP], allowParallel: false });
      let microtaskExecutes = 0;
      const executor = {
        async execute() { throw new Error("single-step path must not run"); },
        async verify() { return true; },
        microtasks: {
          decompose() { return singleMicrotask(EDIT_STEP); },
          async execute(item: { kind: string }) { microtaskExecutes++; return item.kind === "verify" ? "verified" : "proposal"; },
          async verify(item: { kind: string }, output: string) { return (item.kind === "verify" ? output === "verified" : output === "proposal"); }
        }
      };
      const runtime = new EngineeringRuntime(ledger);
      const result = await runtime.run("task", plan, executor);
      expect(result.status).toBe("COMPLETED");
      expect(microtaskExecutes).toBeGreaterThanOrEqual(3);
      // Re-run reuses the persisted microtask evidence (no re-execution).
      const before = microtaskExecutes;
      await runtime.run("task", plan, executor);
      expect(microtaskExecutes).toBe(before);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
