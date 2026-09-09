import { decide, HeuristicPolicy, type PolicyOptimizer } from "../../src/shared/policy";
import type { TaskLedger, TaskLedgerRecord } from "./task-ledger";

export type PlanComplexity = "L0" | "L1" | "L2" | "L3";

/**
 * Policy decision recording (plan §29 wiring half). Records the chosen
 * HeuristicPolicy decision on the task ledger when a plan is compiled, so
 * degradation selection consumes the per-complexity worker count / context
 * budget / verification level instead of fixed per-mode constants.
 *
 * Idempotent: re-entering (recovery resume, replan) with the same complexity
 * does not churn new checkpoint generations.
 */
export function applyTaskPolicy(
  ledger: TaskLedger,
  taskId: string,
  complexity: PlanComplexity,
  optimizer: PolicyOptimizer = new HeuristicPolicy(),
): TaskLedgerRecord["policy"] {
  const record = ledger.load(taskId);
  if (!record) return undefined;
  if (record.policy?.complexity === complexity) return record.policy;
  const decision = decide({ complexity, runtimeStats: [], nativeAvailable: false }, optimizer);
  const policy = { complexity, decision, optimizer: optimizer.constructor.name, decidedAt: new Date().toISOString() };
  ledger.update(taskId, "policy decision recorded", (value) => { value.policy = policy; });
  return policy;
}
