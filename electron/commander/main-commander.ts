import { randomUUID } from "node:crypto";
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

export interface CommanderTaskInput { title: string; objective: string; providerIds: ProviderId[]; mode?: TaskMode; appMode?: AppMode; transports?: Record<ProviderId, RunTransport>; conversationId?: string; constraints?: string[]; }

export class MainCommander {
  readonly stateMachine = new TaskStateMachine();
  constructor(
    private readonly store: StateStore,
    readonly registry: RuntimeRegistry,
    readonly scheduler: Scheduler,
    readonly router: RoleRouter,
    readonly budgets: BudgetManager,
    readonly contexts: ContextManager,
    readonly executionGate: ExecutionGate
  ) {}

  createTask(input: CommanderTaskInput): BossTask {
    const task = this.store.createTask(input.title, input.objective, input.providerIds, input.mode, input.appMode, input.transports, input.conversationId);
    const context: TaskContext = { taskId: task.id, objective: input.objective, constraints: input.constraints ?? [], currentProtocol: task.mode, currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] };
    this.contexts.save(context);
    return task;
  }

  startTask(taskId: string): void { this.transition(taskId, "running"); }
  pauseTask(taskId: string): void { this.transition(taskId, "paused"); }
  cancelTask(taskId: string): void { this.transition(taskId, "cancelled"); }

  async dispatchRole(taskId: string, role: RoleId, prompt: string, routing: Omit<RoleRoutingRequest, "role"> = {}, policy: Partial<DispatchPolicy> = {}): Promise<RuntimeResult> {
    const candidates = this.router.route({ role, ...routing }).map((candidate) => this.registry.get(candidate.runtimeId)).filter((runtime) => runtime !== undefined);
    const request: RuntimeRequest = { jobId: randomUUID(), taskId, role: role === "planner" ? "planning" : role === "researcher" ? "research" : role === "reviewer" ? "review" : role === "synthesizer" ? "synthesis" : role === "coder" ? "coding" : role === "validator" ? "validation" : "critique", prompt, context: this.contexts.assemble(taskId, role, `Perform the ${role} role. Runtime output is advisory and cannot mutate task state.`) };
    const result = await this.scheduler.dispatch({ request, candidates }, { maxParallel: 1, timeoutMs: 180000, maxRetries: 0, allowFallback: true, requireAll: true, ...policy });
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
