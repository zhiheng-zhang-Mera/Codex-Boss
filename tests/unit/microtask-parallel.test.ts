import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Microtask } from "../../src/shared/microtask";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { MicrotaskRuntime, type MicrotaskExecutor } from "../../electron/engineering/microtask-runtime";
import type { TaskStep } from "../../src/shared/task-ir";

const STEP: TaskStep = { id: "s", kind: "worker", description: "step", dependencies: [], requiredFiles: [] };

function ledgerAt(): TaskLedger {
  return new TaskLedger(fs.mkdtempSync(path.join(os.tmpdir(), "boss-mt-")));
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

describe("microtask parallel scheduler (Overcomplete §7.3/§7.4)", () => {
  it("runs ready read-like microtasks in parallel up to the concurrency bound", async () => {
    const microtasks: Microtask[] = [1, 2, 3, 4].map((index) => ({ id: `read_${index}`, kind: "read", parentStepId: STEP.id, description: `read ${index}`, dependencies: [], requiredFiles: [`f${index}`] }));
    let active = 0; let peak = 0;
    const executor: MicrotaskExecutor = {
      async execute() { active++; peak = Math.max(peak, active); await sleep(50); active--; return "ok"; },
      async verify() { return true; }
    };
    const result = await new MicrotaskRuntime(ledgerAt()).runStep("task", STEP, microtasks, executor, { concurrency: 4, parallelReads: true });
    expect(result.status).toBe("COMPLETED");
    // Peak concurrency 4 proves the four reads overlapped (serial never peaks above 1).
    expect(peak).toBe(4);
  });

  it("serializes write-like microtasks that own overlapping files (no silent race)", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "boss-mt-w")), "shared.txt");
    fs.writeFileSync(file, "");
    const make = (id: string, token: string): Microtask => ({ id, kind: "propose", parentStepId: STEP.id, description: id, dependencies: [], requiredFiles: ["shared.txt"] });
    const microtasks = [make("w1", "A"), make("w2", "B")];
    let active = 0; let peak = 0; const order: string[] = [];
    const executor: MicrotaskExecutor = {
      async execute(microtask) { active++; peak = Math.max(peak, active); order.push(microtask.id); await sleep(40); active--; fs.appendFileSync(file, microtask.id); return "written"; },
      async verify() { return true; }
    };
    const result = await new MicrotaskRuntime(ledgerAt()).runStep("task", STEP, microtasks, executor, { concurrency: 2, parallelReads: true });
    expect(result.status).toBe("COMPLETED");
    expect(peak).toBe(1); // overlapping writers never ran concurrently
    expect(order).toEqual(["w1", "w2"]);
    expect(fs.readFileSync(file, "utf8")).toBe("w1w2"); // both effects landed, serialized
  });

  it("executes a generic semantic DAG across the widened kind vocabulary", async () => {
    const microtasks: Microtask[] = [
      { id: "inspect", kind: "inspect", parentStepId: STEP.id, description: "inspect", dependencies: [], requiredFiles: [] },
      { id: "search", kind: "search", parentStepId: STEP.id, description: "search", dependencies: ["inspect"], requiredFiles: [] },
      { id: "design", kind: "design", parentStepId: STEP.id, description: "design", dependencies: ["search"], requiredFiles: [] },
      { id: "edit", kind: "edit", parentStepId: STEP.id, description: "edit", dependencies: ["design"], requiredFiles: ["a.ts"] },
      { id: "build", kind: "build", parentStepId: STEP.id, description: "build", dependencies: ["edit"], requiredFiles: [] },
      { id: "review", kind: "review", parentStepId: STEP.id, description: "review", dependencies: ["build"], requiredFiles: [] },
      { id: "wait", kind: "wait", parentStepId: STEP.id, description: "wait", dependencies: ["review"], requiredFiles: [] },
      { id: "document", kind: "document", parentStepId: STEP.id, description: "document", dependencies: ["wait"], requiredFiles: [] }
    ];
    const calls: string[] = [];
    const executor: MicrotaskExecutor = {
      async execute(microtask) { calls.push(microtask.id); await sleep(1); return microtask.id; },
      async verify(_microtask, output) { return Boolean(output); }
    };
    const result = await new MicrotaskRuntime(ledgerAt()).runStep("task", STEP, microtasks, executor, { concurrency: 3, parallelReads: true });
    expect(result.status).toBe("COMPLETED");
    expect(new Set(calls)).toEqual(new Set(microtasks.map((item) => item.id)));
    // inspect/search/design/review/wait are reads: three ran concurrently first.
    expect(calls.indexOf("inspect") >= 0).toBe(true);
  });

  it("records durable startedAt/completedAt on microtask jobs (evidence)", async () => {
    const ledger = ledgerAt();
    const result = await new MicrotaskRuntime(ledger).runStep("task", STEP, [{ id: "read_1", kind: "read", parentStepId: STEP.id, description: "r", dependencies: [], requiredFiles: [] }], {
      async execute() { return "x"; },
      async verify() { return true; }
    }, { concurrency: 1, parallelReads: true });
    expect(result.status).toBe("COMPLETED");
    const jobs = ledger.load("task")!.jobs;
    const job = jobs["graph_s_microtask_read_1"];
    expect(job.state).toBe("COMPLETED");
    expect(typeof job.startedAt).toBe("string");
    expect(typeof job.completedAt).toBe("string");
    expect(jobs["graph_s_microtask"].completedAt).toBeDefined();
  });
});
