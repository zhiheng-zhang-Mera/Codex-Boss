import { createHash } from "node:crypto";
import type { Microtask } from "../../src/shared/microtask";
import { readyMicrotasks, validateMicrotasks } from "../../src/shared/microtask";
import { TaskLedger } from "../commander/task-ledger";
import type { TaskStep } from "../../src/shared/task-ir";

/**
 * Recursive microtask runtime (plan AP12 wiring half). A caller-facing step
 * expands into a bounded read → propose → verify micro-DAG (microtask.ts); this
 * runtime executes it with the same durability contract as EngineeringRuntime:
 * persisted ledger jobs `graph_<stepId>_<microtaskId>`, fingerprint-keyed reuse,
 * revalidation of persisted evidence before skipping, and GraphDeferred waiting.
 */

export class GraphDeferred extends Error {}

export interface MicrotaskExecutor {
  /** Runs one microtask and returns its textual output/evidence. */
  execute(microtask: Microtask): Promise<string>;
  /** Revalidates persisted output against the current reality before reuse. */
  verify(microtask: Microtask, output: string): Promise<boolean>;
}

export interface MicrotaskResult {
  status: "COMPLETED" | "FAILED" | "WAITING";
  outputs: Record<string, string>;
  failedMicrotask?: string;
}

export class MicrotaskRuntime {
  constructor(private readonly ledger: TaskLedger) {}

  /** Executes a step's expanded micro-DAG; idempotent across restarts (fingerprint + revalidate). */
  async runStep(taskId: string, step: TaskStep, microtasks: Microtask[], executor: MicrotaskExecutor): Promise<MicrotaskResult> {
    validateMicrotasks(microtasks);
    const saved = this.ledger.load(taskId);
    if (!saved) this.ledger.create(taskId, step.description, []);
    const scopeKey = `graph_${step.id}_microtask`;
    const planFingerprint = this.ledger.load(taskId)?.jobs[scopeKey]?.fingerprint ?? "";
    const dagFingerprint = TaskLedger.fingerprint(microtasks);
    if (planFingerprint && planFingerprint !== dagFingerprint) throw new Error("Microtask DAG changed; explicit replan required");

    const outputs: Record<string, string> = {};
    const completed = new Set<string>();
    // Reuse already-completed microtask jobs whose persisted evidence still verifies.
    for (const microtask of microtasks) {
      const job = this.ledger.load(taskId)?.jobs[`${scopeKey}_${microtask.id}`];
      if (job?.state === "COMPLETED" && job.result?.content !== undefined) {
        if (await executor.verify(microtask, job.result.content)) { completed.add(microtask.id); outputs[microtask.id] = job.result.content; }
        else return { status: "FAILED", outputs, failedMicrotask: microtask.id };
      } else if (job?.state === "RUNNING") {
        throw new Error(`Interrupted microtask ${microtask.id} requires side-effect reconciliation`);
      }
    }

    // Durable DAG marker + per-microtask jobs under the step microtask scope.
    if (!planFingerprint) {
      this.ledger.update(taskId, "microtask dag created", (state) => {
        state.jobs[scopeKey] = { id: scopeKey, fingerprint: dagFingerprint, state: "RUNNING", sessionId: taskId, attempts: 1 };
      });
    }

    while (completed.size < microtasks.length) {
      const ready = readyMicrotasks(microtasks, completed);
      if (!ready.length) return { status: "FAILED", outputs, failedMicrotask: "deadlock" };
      for (const microtask of ready) {
        const key = `${scopeKey}_${microtask.id}`;
        this.ledger.update(taskId, "microtask started", (state) => {
          state.jobs[key] = { id: key, fingerprint: TaskLedger.fingerprint(microtask), state: "RUNNING", sessionId: `${taskId}_${microtask.id}`, attempts: (state.jobs[key]?.attempts ?? 0) + 1 };
        });
        let output: string; let passed = false; let deferred = false;
        try { output = await executor.execute(microtask); passed = await executor.verify(microtask, output); }
        catch (error) { output = String(error); deferred = error instanceof GraphDeferred; }
        this.ledger.update(taskId, "microtask verification finished", (state) => {
          state.jobs[key].state = passed ? "COMPLETED" : deferred ? "WAITING" : "FAILED";
          state.jobs[key].result = { runtimeId: "engineering", jobId: microtask.id, status: passed ? "SUCCESS" : "PERMANENT_FAILURE", content: output };
        });
        if (deferred) return { status: "WAITING", outputs };
        if (!passed) return { status: "FAILED", outputs, failedMicrotask: microtask.id };
        completed.add(microtask.id); outputs[microtask.id] = output;
      }
    }
    this.ledger.update(taskId, "microtask dag completed", (state) => { state.jobs[scopeKey].state = "COMPLETED"; });
    return { status: "COMPLETED", outputs };
  }

  /** Stable per-microtask evidence fingerprint for provenance (plan §10). */
  static evidence(microtask: Microtask, output: string): { sha256: string; microtaskId: string } {
    return { microtaskId: microtask.id, sha256: createHash("sha256").update(output).digest("hex") };
  }
}
