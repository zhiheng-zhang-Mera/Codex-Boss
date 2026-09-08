import path from "node:path";
import { createHash } from "node:crypto";
import type { TaskIR, TaskStep } from "../../src/shared/task-ir";
import { validateGraph } from "../../src/shared/task-ir";
import type { Microtask } from "../../src/shared/microtask";
import { TaskLedger } from "../commander/task-ledger";
import { MicrotaskRuntime } from "./microtask-runtime";
import { GraphDeferred } from "./deferred";
export { GraphDeferred } from "./deferred";
export interface StepEvidence { deferred?: boolean; stepId: string; passed: boolean; output: string; sha256: string; }
export interface GraphResult { status: "COMPLETED" | "FAILED" | "WAITING"; evidence: StepEvidence[]; }
export interface GraphExecutor {
  readOnly?: boolean;
  parallelism?: () => number;
  execute(step: TaskStep): Promise<string>;
  verify(step: TaskStep, output: string): Promise<boolean>;
  /**
   * Optional recursive microtask mode (plan AP12): when declared, eligible
   * steps run as a bounded read → propose → verify micro-DAG through the
   * MicrotaskRuntime instead of the single-step path. The step's output is the
   * joined microtask outputs; persisted jobs and revalidation are handled by
   * the runtime. Executors that do not declare `microtasks` keep the exact
   * single-step behavior.
   */
  microtasks?: {
    /** Return the micro-DAG for the step, or undefined to keep the single-step path. */
    decompose(step: TaskStep): Microtask[] | undefined;
    execute(microtask: Microtask): Promise<string>;
    verify(microtask: Microtask, output: string): Promise<boolean>;
    /**
     * Optional aggregation of a step's microtask outputs. When absent, outputs
     * are concatenated (historical behavior). The joined text becomes the
     * step's evidence and is revalidated by the outer executor.verify.
     */
    join?(outputs: Record<string, string>): Promise<string> | string;
  };
}
// The caller supplies executors for an authorized graph; model text is never an executor.
export class EngineeringRuntime {
  private readonly running = new Set<string>();
  constructor(private readonly ledger: TaskLedger) {}
  async run(taskId: string, plan: TaskIR, executor: GraphExecutor): Promise<GraphResult> {
    validateGraph(plan.steps);
    // Worker cap 1..5 (plan §6.4/§35): a 5-AI Work pool may widen engineering
    // parallelism; 3 remains the default compiled cap when the goal does not
    // request a wider pool.
    if (!Number.isInteger(plan.maxWorkers) || plan.maxWorkers < 1 || plan.maxWorkers > 5) throw new Error("Invalid worker limit");
    if (this.running.has(taskId)) throw new Error("Graph already executing");
    this.running.add(taskId);
    try { return await this.execute(taskId, plan, executor); } finally { this.running.delete(taskId); }
  }
  private async execute(taskId: string, plan: TaskIR, executor: GraphExecutor): Promise<GraphResult> {
    const saved = this.ledger.load(taskId) ?? this.ledger.create(taskId, plan.goal, plan.constraints);
    const planKey = `graph_${TaskLedger.fingerprint(plan)}`;
    if (saved.jobs.graph && saved.jobs.graph.fingerprint !== planKey) throw new Error("Graph changed; explicit replan required");
    if (!saved.jobs.graph) this.ledger.update(taskId, "plan created", (state) => { state.jobs.graph = { id: "graph", fingerprint: planKey, state: "RUNNING", sessionId: taskId, attempts: 1 }; state.pendingSteps = plan.steps.map((step) => step.id); });
    const evidence: StepEvidence[] = [];
    const completed = new Set<string>();
    for (const step of plan.steps) {
      const previous = this.ledger.load(taskId)!.jobs[`graph_${step.id}`];
      if (previous?.state === "COMPLETED" && previous.result?.content !== undefined) {
        const output = previous.result.content;
        // Revalidate persisted evidence against the current workspace before skipping work.
        if (await executor.verify(step, output)) { completed.add(step.id); evidence.push(this.evidence(step.id, output, true)); }
        else return { status: "FAILED", evidence: [...evidence, this.evidence(step.id, output, false)] };
      } else if (previous?.state === "RUNNING" && !executor.readOnly) throw new Error(`Interrupted step ${step.id} requires side-effect reconciliation`);
    }
    const width = plan.estimatedComplexity === "L3" ? Math.max(1, Math.min(plan.maxWorkers, 5)) : 1;
    while (completed.size < plan.steps.length) {
      const ready = plan.steps.filter((step) => !completed.has(step.id) && step.dependencies.every((id) => completed.has(id)));
      // Concurrent workers must own disjoint file scopes. Unknown scope is serialized.
      const batch: TaskStep[] = []; const owned = new Set<string>();
      for (const step of ready) {
        if (batch.length >= Math.max(1, Math.min(width, executor.parallelism?.() ?? width))) break;
        if (!executor.readOnly && batch.length && (!step.requiredFiles.length || batch.some((item) => !item.requiredFiles.length) || step.requiredFiles.some((file) => [...owned].some((other) => { const a = path.resolve(file).toLowerCase(); const b = path.resolve(other).toLowerCase(); return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep); })))) continue;
        batch.push(step); step.requiredFiles.forEach((file) => owned.add(file));
      }
      if (!batch.length) return { status: "FAILED", evidence };
      const results = await Promise.all(batch.map(async (step) => {
        const key = `graph_${step.id}`;
        this.ledger.update(taskId, "step started", (state) => { state.currentStep = step.id; state.jobs[key] = { id: key, fingerprint: TaskLedger.fingerprint(step), state: "RUNNING", sessionId: `${taskId}_${step.id}`, attempts: (state.jobs[key]?.attempts ?? 0) + 1, startedAt: new Date().toISOString() }; });
        let output = ""; let passed = false; let deferred = false;
        try {
          if (executor.microtasks) {
            const micro = executor.microtasks.decompose(step);
            if (micro?.length) {
              const runtime = new MicrotaskRuntime(this.ledger);
              const result = await runtime.runStep(taskId, step, micro, { execute: executor.microtasks.execute, verify: executor.microtasks.verify }, { concurrency: Math.max(1, Math.min(plan.maxWorkers, 5)), parallelReads: true });
              if (result.status === "WAITING") { deferred = true; output = "Microtask graph waiting for runtime"; }
              else if (result.status === "FAILED") { output = `Microtask ${result.failedMicrotask ?? "?"} failed`; }
              else { output = executor.microtasks.join ? await executor.microtasks.join(result.outputs) : Object.values(result.outputs).join("\n"); passed = await executor.verify(step, output); }
            } else {
              output = await executor.execute(step); passed = await executor.verify(step, output);
            }
          } else { output = await executor.execute(step); passed = await executor.verify(step, output); }
        } catch (error) { output = String(error); deferred = error instanceof GraphDeferred; }
        const item = { ...this.evidence(step.id, output, passed), ...(deferred ? { deferred: true } : {}) };
        this.ledger.update(taskId, "verification finished", (state) => {
          state.jobs[key].state = passed ? "COMPLETED" : deferred ? "WAITING" : "FAILED";
          state.jobs[key].result = { runtimeId: "engineering", jobId: step.id, status: passed ? "SUCCESS" : "PERMANENT_FAILURE", content: output };
          if (passed || deferred) state.jobs[key].completedAt = new Date().toISOString();
          if (passed) { state.completedSteps = [...new Set([...state.completedSteps, step.id])]; state.pendingSteps = state.pendingSteps.filter((id) => id !== step.id); }
          state.verificationState = passed ? "PASS" : "FAILED";
        }); return item;
      }));
      evidence.push(...results);
      if (results.some((item) => item.deferred)) { this.ledger.update(taskId, "graph waiting for runtime", (state) => { state.nextAction = "WAIT"; }); return { status: "WAITING", evidence }; }
      if (results.some((item) => !item.passed)) { this.ledger.update(taskId, "verification failed", (state) => { state.verificationState = "FAILED"; state.nextAction = "REPAIR_OR_REPLAN"; }); return { status: "FAILED", evidence }; }
      results.forEach((item) => completed.add(item.stepId));
    }
    this.ledger.update(taskId, "task completed", (state) => { state.jobs.graph.state = "COMPLETED"; state.jobs.graph.completedAt = new Date().toISOString(); state.currentStep = null; state.nextAction = "REPORT_EVIDENCE"; state.verificationState = "PASS"; });
    return { status: "COMPLETED", evidence };
  }
  private evidence(stepId: string, output: string, passed: boolean): StepEvidence { return { stepId, output, passed, sha256: createHash("sha256").update(output).digest("hex") }; }
}
