import type { RuntimeAdapter } from "../runtimes/runtime";
import type { BudgetManager } from "./budget-manager";
import type { TaskLedger } from "./task-ledger";
import type { DegradedMode } from "./resource-controller";
import { capacityFor, type PhysicalBudget } from "../../src/shared/resource-model";
export interface DegradationState {
  mode: DegradedMode; reason: string; runtimeIds: string[]; maxWorkers: number; maxContextChars: number; updatedAt: string;
  /** Policy-chosen verification/parallelism (plan §29), present when a task policy was recorded. */
  verificationLevel?: "fast" | "standard" | "full";
  parallelism?: number;
}
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
    // Policy decision recorded at plan compile (plan §29): FULL mode honors the
    // chosen worker count + context budget; degraded tiers keep their tighter caps.
    const policy = task.policy?.decision;
    const fullDesired = policy ? Math.min(policy.workerCount, eligible.length) : Math.min(3, eligible.length);
    const desired = mode === "FULL" ? Math.max(1, fullDesired) : 1;
    const capacity = capacityFor({ requestedWorkers: desired }, this.physical, 3);
    const next: DegradationState = {
      mode,
      reason: capacity.reason === "physical_cap" ? reason + "; physical budget caps workers" : reason,
      runtimeIds: eligible.map((runtime) => runtime.id),
      maxWorkers: capacity.allowedWorkers,
      maxContextChars: mode === "FULL" ? (policy?.contextBudgetChars ?? 24000) : mode === "REDUCED" ? 16000 : 8000,
      verificationLevel: mode === "FULL" ? (policy?.verificationLevel ?? "standard") : undefined,
      parallelism: mode === "FULL" ? Math.min(policy ? Math.max(1, policy.parallelism) : desired, desired) : undefined,
      updatedAt: new Date().toISOString()
    };
    const old = task.degradation;
    const changed = !old || old.mode !== next.mode || old.reason !== next.reason || old.runtimeIds.join() !== next.runtimeIds.join()
      || old.maxWorkers !== next.maxWorkers || old.maxContextChars !== next.maxContextChars
      || old.verificationLevel !== next.verificationLevel || old.parallelism !== next.parallelism;
    if (changed) this.ledger.update(taskId, "runtime mode changed", (state) => { state.degradation = next; });
    return next;
  }
  get(taskId: string): DegradationState | undefined { return this.ledger.load(taskId)?.degradation; }
}
