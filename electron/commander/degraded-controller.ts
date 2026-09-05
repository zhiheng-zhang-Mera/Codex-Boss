import type { RuntimeAdapter } from "../runtimes/runtime";
import type { BudgetManager } from "./budget-manager";
import type { TaskLedger } from "./task-ledger";
import type { DegradedMode } from "./resource-controller";
import { capacityFor, type PhysicalBudget } from "../../src/shared/resource-model";
export interface DegradationState { mode: DegradedMode; reason: string; runtimeIds: string[]; maxWorkers: number; maxContextChars: number; updatedAt: string; }
export class DegradedController {
  constructor(private readonly ledger: TaskLedger, private readonly budgets: BudgetManager, private readonly physical?: PhysicalBudget) {}
  evaluate(taskId: string, candidates: RuntimeAdapter[], nativeAvailable = false): DegradationState {
    const task = this.ledger.load(taskId); if (!task) throw new Error("Unknown degradation task");
    const eligible = candidates.filter((runtime) => this.budgets.eligible(runtime.id));
    const remaining = task.limits.modelCalls - task.usage.modelCalls;
    let mode: DegradedMode; let reason: string;
    if (remaining <= 0 || !eligible.length) { mode = nativeAvailable ? "DETERMINISTIC" : "PAUSED"; reason = remaining <= 0 ? "Task model-call budget exhausted" : "No eligible runtime supports this step"; }
    else if (remaining <= 2 || eligible.every((runtime) => this.budgets.get(runtime.id).state === "LOW")) { mode = "LIGHTWEIGHT"; reason = "Limited observed runtime or task budget"; }
    else if (eligible.length === 1) { mode = "REDUCED"; reason = "One compatible runtime remains"; }
    else { mode = "FULL"; reason = "Multiple compatible runtimes available"; }
    // Physical/logical backpressure (AP14): logical FULL concurrency is further
    // bounded by the host physical budget when one is supplied.
    const desired = mode === "FULL" ? Math.min(3, eligible.length) : 1;
    const capacity = capacityFor({ requestedWorkers: desired }, this.physical, 3);
    const next: DegradationState = { mode, reason: capacity.reason === "physical_cap" ? reason + "; physical budget caps workers" : reason, runtimeIds: eligible.map((runtime) => runtime.id), maxWorkers: capacity.allowedWorkers, maxContextChars: mode === "FULL" ? 24000 : mode === "REDUCED" ? 16000 : 8000, updatedAt: new Date().toISOString() };
    const old = task.degradation;
    if (!old || old.mode !== next.mode || old.reason !== next.reason || old.runtimeIds.join() !== next.runtimeIds.join()) this.ledger.update(taskId, "runtime mode changed", (state) => { state.degradation = next; });
    return next;
  }
  get(taskId: string): DegradationState | undefined { return this.ledger.load(taskId)?.degradation; }
}
