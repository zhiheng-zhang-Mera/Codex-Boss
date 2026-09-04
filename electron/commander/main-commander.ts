import type { RecoveryScheduler } from "./recovery-scheduler";
import { compileIntent } from "../../src/shared/task-ir";
import { ResourceController } from "./resource-controller";
import { EngineeringRuntime } from "../engineering/engineering-runtime";
import { executeNative } from "../engineering/native-tools";
import { TaskLedger } from "./task-ledger";
import { ExecutionSupervisor } from "./execution-supervisor";
import type { ReviewPolicy } from "../../src/shared/execution";
import type { AppMode, BossTask, ProviderId, RunTransport, TaskMode, TaskStatus } from "../../src/shared/contracts";
import type { RuntimeRequest, RuntimeResult } from "../runtimes/runtime";
import type { StateStore } from "../store";
import { BudgetManager } from "./budget-manager";
import { ContextManager, type TaskContext } from "./context-manager";
import { ExecutionGate, type ExecutionProposal, type ExecutionRecord } from "./execution-gate";
import { RoleRouter, type RoleId, type RoleRoutingRequest } from "./role-router";
import { RuntimeRegistry } from "./runtime-registry";
import { Scheduler, type DispatchPolicy } from "./scheduler";
import { TaskStateMachine } from "./task-state-machine";

export interface CommanderTaskInput { reviewPolicy?: ReviewPolicy; title: string; objective: string; providerIds: ProviderId[]; mode?: TaskMode; appMode?: AppMode; transports?: Record<ProviderId, RunTransport>; conversationId?: string; constraints?: string[]; }

export class MainCommander {
  readonly supervisor?: ExecutionSupervisor;
  readonly stateMachine = new TaskStateMachine();
  constructor(
    private readonly store: StateStore,
    readonly registry: RuntimeRegistry,
    readonly scheduler: Scheduler,
    readonly router: RoleRouter,
    readonly budgets: BudgetManager,
    readonly contexts: ContextManager,
    readonly executionGate: ExecutionGate,
    readonly ledger?: TaskLedger,
    readonly resources?: ResourceController,
    readonly recovery?: RecoveryScheduler
  ) { if (ledger) this.supervisor = new ExecutionSupervisor(ledger, scheduler, resources, recovery, budgets);
    recovery?.register("runtime", async (record) => {
      const payload = record.payload as { request: RuntimeRequest; runtimeIds: string[] };
      const task = this.store.snapshot().tasks.find((item) => item.id === record.taskId);
      if (task && ["cancelled", "paused"].includes(task.status)) return { done: false, error: "Task stopped by user" };
      const candidates = payload.runtimeIds.map((id) => this.registry.get(id)).filter((runtime) => runtime !== undefined);
      await this.registry.refreshHealth();
      const result = await this.supervisor!.execute(payload.request, candidates);
      const job = this.ledger?.load(record.taskId)?.jobs[payload.request.jobId];
      return result.status === "SUCCESS" ? { done: true } : { done: false, retryAt: job?.retryAt, error: result.failure?.message };
    }); }

  createTask(input: CommanderTaskInput): BossTask {
    const plan = compileIntent(input.objective, { constraints: input.constraints });
    const task = this.store.createTask(input.title, input.objective, plan.estimatedComplexity === "L0" ? ["native:tools"] : input.providerIds, input.mode, input.appMode, input.transports, input.conversationId);
    this.store.setTaskPlan(task.id, plan);
    if (input.reviewPolicy) this.store.setReviewPolicy(task.id, input.reviewPolicy);
    const context: TaskContext = { taskId: task.id, objective: input.objective, constraints: input.constraints ?? [], currentProtocol: task.mode, currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] };
    this.contexts.save(context);
    this.ledger?.create(task.id, input.objective, input.constraints);
    return task;
  }

  async executeDeterministic(taskId: string, workspace: string): Promise<boolean> {
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    const operation = task?.plan?.estimatedComplexity === "L0" ? task.plan.steps[0].operation : undefined;
    if (!task || !operation) return false;
    this.store.setTaskStatus(taskId, "running");
    const evidence = await executeNative(workspace, operation);
    if (this.ledger && task.plan) {
      const result = await new EngineeringRuntime(this.ledger).run(taskId, task.plan, {
        async execute() { return JSON.stringify(evidence); },
        async verify(_step, output) { const previous = JSON.parse(output); const current = await executeNative(workspace, operation); return previous.output === current.output && previous.verified === true; }
      });
      if (result.status !== "COMPLETED") { this.store.setTaskStatus(taskId, "failed"); throw new Error("Native verification failed"); }
    }
    const checkpoint = this.store.beginDispatch(taskId, 1, task.providerIds).checkpoint;
    this.store.markDispatchCollecting(checkpoint.id, task.providerIds);
    for (const run of this.store.runsForTask(taskId)) this.store.captureArtifact(run.id, evidence.output || "Operation completed; empty result.", "local:native");
    this.ledger?.update(taskId, "native verification completed", (value) => { value.verificationState = "PASS"; value.usage.toolCalls++; value.nextAction = "REPORT_EVIDENCE"; });
    return true;
  }

  startTask(taskId: string): void { this.transition(taskId, "running"); }
  pauseTask(taskId: string): void { this.transition(taskId, "paused"); }
  cancelTask(taskId: string): void { this.transition(taskId, "cancelled"); }

  async dispatchRole(taskId: string, role: RoleId, prompt: string, routing: Omit<RoleRoutingRequest, "role"> = {}, policy: Partial<DispatchPolicy> = {}): Promise<RuntimeResult> {
    await this.registry.refreshHealth();
    const snapshot = this.store.snapshot();
    const controls = snapshot.runtimeStatuses;
    const configured = snapshot.roleRoutes.find((route) => route.role === role);
    const candidates = this.router.route({ preferredRuntimes: configured?.runtimeIds, allowFallback: configured?.fallback, role, ...routing }).filter((candidate) => controls.find((control) => control.runtimeId === candidate.runtimeId)?.enabled !== false).map((candidate) => this.registry.get(candidate.runtimeId)).filter((runtime) => runtime !== undefined);
    const request: RuntimeRequest = { replaySafe: true, jobId: TaskLedger.fingerprint({ role, prompt }).slice(0, 32), taskId, role: role === "planner" ? "planning" : role === "researcher" ? "research" : role === "reviewer" ? "review" : role === "synthesizer" ? "synthesis" : role === "coder" ? "coding" : role === "validator" ? "validation" : "critique", prompt, context: this.contexts.assemble(taskId, role, `Perform the ${role} role. Runtime output is advisory and cannot mutate task state.`) };
    const result = this.supervisor ? await this.supervisor.execute(request, candidates) : await this.scheduler.dispatch({ request, candidates }, { maxParallel: 1, timeoutMs: 180000, maxRetries: 0, allowFallback: true, requireAll: true, ...policy });
    if (!this.supervisor && result.runtimeId !== "none") this.resources?.record(result.runtimeId, result.status === "SUCCESS", 1, result.metrics?.durationMs ?? 0);
    if (result.failure) this.budgets.observeFailure(result.runtimeId, result.failure.message);
    return result;
  }

  runProtocolStep(taskId: string, role: RoleId, prompt: string): Promise<RuntimeResult> { return this.dispatchRole(taskId, role, prompt); }
  reconcileRun(taskId: string): void { this.store.setTaskStatus(taskId, "waiting"); }
  commitRound(taskId: string, round: number): void { this.store.commitDispatchForRound(taskId, round); }
  requestExecution(proposal: ExecutionProposal): ExecutionRecord { return this.executionGate.propose(proposal); }

  private transition(taskId: string, status: TaskStatus): void {
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    this.store.setTaskStatus(taskId, this.stateMachine.transition(task.status, status));
  }
}
