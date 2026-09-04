import type { BudgetManager } from "./budget-manager";
import type { RecoveryScheduler } from "./recovery-scheduler";
import { ProviderSessionRegistry } from "./provider-session-registry";
import type { ResourceController } from "./resource-controller";
import { randomUUID } from "node:crypto";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../runtimes/runtime";
import { Scheduler } from "./scheduler";
import { TaskLedger } from "./task-ledger";
import { classifyInterruption, recoveryFor } from "./interruption";
import { reviewResponse } from "../../src/shared/execution";

export class ExecutionSupervisor {
  private readonly active = new Map<string, Promise<RuntimeResult>>();
  constructor(readonly ledger: TaskLedger, private readonly scheduler = new Scheduler(), private readonly resources?: ResourceController, private readonly recovery?: RecoveryScheduler, private readonly budgets?: BudgetManager) {}
  execute(request: RuntimeRequest, candidates: RuntimeAdapter[]): Promise<RuntimeResult> {
    const key = `${request.taskId}/${request.jobId}`;
    const existing = this.active.get(key); if (existing) return existing;
    const running = this.run(request, candidates).finally(() => this.active.delete(key));
    this.active.set(key, running); return running;
  }
  private async run(request: RuntimeRequest, candidates: RuntimeAdapter[]): Promise<RuntimeResult> {
    let state = this.ledger.load(request.taskId) ?? this.ledger.create(request.taskId, request.prompt);
    const fingerprint = TaskLedger.fingerprint({ prompt: request.prompt, role: request.role, context: request.context });
    const old = state.jobs[request.jobId];
    if (old && old.fingerprint !== fingerprint) throw new Error("Job identity reused with different input");
    if (old?.state === "COMPLETED" && old.result) return old.result;
    if (old && old.state !== "COMPLETED" && ["VERIFY_SIDE_EFFECT", "HUMAN_REQUIRED"].includes(state.nextAction)) return this.defer(request, "Human reconciliation remains required", "USER_ACTION_REQUIRED");
    if (old?.state === "RUNNING" && !request.replaySafe) return this.defer(request, "Prior side effect must be verified before replay", "USER_ACTION_REQUIRED");
    if (old?.retryAt && old.retryAt > Date.now()) return this.defer(request, "Waiting for retry deadline", "RATE_LIMITED");
    const compatible = candidates.filter((runtime) => runtime.capabilities.roles.includes(request.role) && (!this.budgets || this.budgets.eligible(runtime.id)));
    if (!compatible.length) return this.defer(request, "No compatible backend", "UNSUPPORTED");
    for (let index = 0; index < compatible.length; index++) {
      state = this.ledger.load(request.taskId)!;
      const attempts = state.jobs[request.jobId]?.attempts ?? 0;
      if (attempts >= 3 || state.usage.modelCalls >= state.limits.modelCalls || state.usage.retries >= state.limits.retries) {
        this.ledger.update(request.taskId, "budget exhausted", (value) => { value.mode = "DETERMINISTIC"; value.nextAction = "DEFER_OR_NATIVE_TOOL"; });
        return this.defer(request, "Task operational budget exhausted", "BUDGET_EXHAUSTED");
      }
      const runtime = compatible[index];
      const modelCalls = runtime.capabilities.consumesModel === false ? 0 : 1;
      const session = new ProviderSessionRegistry(this.ledger).forRuntime(request.taskId, runtime.id) ?? { id: randomUUID(), taskId: request.taskId, provider: runtime.id, checkpoint: state.revision, health: "AVAILABLE", resumeStrategy: "RECONSTRUCT" as const };
      this.ledger.update(request.taskId, "step started", (value) => {
        if (!value.sessions.some((item) => item.id === session.id)) value.sessions.push(session);
        value.activeProvider = runtime.id; value.sessionId = session.id; value.currentStep = request.jobId; value.nextAction = "WAIT_FOR_RESPONSE";
        value.usage.modelCalls += modelCalls; value.usage.estimatedInputTokens += Math.ceil((request.prompt.length + (request.context?.length ?? 0)) / 4);
        if (attempts) value.usage.retries++;
        value.jobs[request.jobId] = { id: request.jobId, fingerprint, state: "RUNNING", sessionId: session.id, attempts: attempts + 1 };
      });
      const result = await this.scheduler.dispatch({ request: { ...request, sessionId: session.id }, candidates: [runtime] }, { maxParallel: 1, maxRetries: 0, timeoutMs: request.timeoutMs ?? 180000, allowFallback: false, requireAll: true });
      this.resources?.record(runtime.id, result.status === "SUCCESS", modelCalls, result.metrics?.durationMs ?? 0);
      const review = reviewResponse({ taskId: request.taskId, workerId: runtime.id, responseId: request.jobId, content: result.content ?? result.artifact?.content ?? "", outcome: result.status === "SUCCESS" ? "SUCCESS" : "RETRYABLE_FAILURE" });
      if (result.status === "SUCCESS" && review.status === "PASS") {
        this.budgets?.observeSuccess(runtime.id);
        this.ledger.update(request.taskId, "step completed", (value) => {
          value.jobs[request.jobId].state = "COMPLETED"; value.jobs[request.jobId].result = result;
          value.completedSteps = [...new Set([...value.completedSteps, request.jobId])]; value.currentStep = null; value.nextAction = "NEXT_STEP"; value.mode = "NORMAL";
          value.usage.estimatedOutputTokens += Math.ceil((result.content?.length ?? 0) / 4); value.usage.workerRuntimeMs += result.metrics?.durationMs ?? 0;
        });
        return result;
      }
      const interruption = classifyInterruption(result.failure?.code ?? "UNKNOWN", result.failure?.message ?? review.retry_reason ?? "No verified response", result.failure?.retryAt);
      const recovery = recoveryFor(interruption, attempts + 1, !request.replaySafe);
      this.budgets?.observeFailure(runtime.id, interruption.message, interruption.retryAt ? new Date(interruption.retryAt).toISOString() : undefined);
      this.ledger.update(request.taskId, "worker interrupted", (value) => {
        value.failureHistory.push(interruption); value.jobs[request.jobId].state = "WAITING";
        value.jobs[request.jobId].result = result; value.jobs[request.jobId].retryAt = recovery.retryAt;
        value.nextAction = recovery.action; value.sessions.find((item) => item.id === session.id)!.health = interruption.kind;
        value.mode = ["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT", "DEFER"].includes(recovery.action) ? "PAUSED" : "LIGHTWEIGHT";
      });
      if (result.status === "CANCELLED" || ["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT"].includes(recovery.action) || !request.replaySafe) return result;
      if (index + 1 < compatible.length && recovery.action !== "WAIT") continue;
      if (this.recovery && recovery.retryAt && request.replaySafe && ["WAIT", "RETRY"].includes(recovery.action)) {
        this.recovery.schedule({ id: "runtime:" + request.taskId + ":" + request.jobId, taskId: request.taskId, kind: "runtime", retryAt: recovery.retryAt, payload: { request, runtimeIds: compatible.map((item) => item.id) } });
        return result;
      }
      if (["RETRY", "RECONSTRUCT"].includes(recovery.action) && attempts + 1 < 3) {
        const delay = Math.max(0, (recovery.retryAt ?? Date.now()) - Date.now());
        if (delay <= 60000) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          this.ledger.update(request.taskId, "recovery attempted", (value) => { value.usage.providerWaitMs += delay; });
          index--; continue;
        }
      }
      return result.status === "SUCCESS" ? this.defer(request, review.retry_reason ?? "Review failed", "UNKNOWN") : result;
    }
    return this.defer(request, "No backend remains", "UNSUPPORTED");
  }
  private defer(request: RuntimeRequest, message: string, code: "USER_ACTION_REQUIRED" | "RATE_LIMITED" | "UNSUPPORTED" | "BUDGET_EXHAUSTED" | "UNKNOWN"): RuntimeResult {
    return { runtimeId: "supervisor", jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code, message, retryable: false } };
  }
}
