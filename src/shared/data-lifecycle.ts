/**
 * Data lifecycle L0–L4 (plan §17). Pure and shareable.
 *
 * State.json arrays (tasks/runs/artifacts/councils/evidence/finalResponses/
 * checkpoints/events) grow without bound; AP17 requires a tier vocabulary, TTL
 * and bounded retention that never touches active work. This module supplies
 * the deterministic tier classifier and budget policy; the electron side
 * applies it to the real AppSnapshot arrays.
 */

export type DataTier = "L0" | "L1" | "L2" | "L3" | "L4";
export const DATA_TIERS: readonly DataTier[] = ["L0", "L1", "L2", "L3", "L4"];

/** Tier purpose per plan §17 (L0 temporary … L4 cold archive). */
export interface TierRule {
  tier: DataTier;
  label: string;
  /** Default TTL in days; 0 = keep until budget/prune decides. */
  ttlDays: number;
}

export const DEFAULT_TIER_RULES: readonly TierRule[] = [
  { tier: "L0", label: "temporary (queued/prepared state)", ttlDays: 1 },
  { tier: "L1", label: "hot raw (recent runs/artifacts/events)", ttlDays: 14 },
  { tier: "L2", label: "warm summary (final responses, evidence)", ttlDays: 90 },
  { tier: "L3", label: "knowledge/experience", ttlDays: 365 },
  { tier: "L4", label: "cold archive", ttlDays: 0 }
];

/** Classifies a durable record by family + lifecycle. Deterministic. */
export function classifyRecord(input: { family: string; updatedAt: string; terminal?: boolean; now?: number }): DataTier {
  const ageMs = (input.now ?? Date.now()) - Date.parse(input.updatedAt || new Date(0).toISOString());
  const ageDays = Math.max(0, ageMs) / 86400000;
  const rule = (tier: DataTier) => DEFAULT_TIER_RULES.find((item) => item.tier === tier)!;
  switch (input.family) {
    case "task": return input.terminal === false ? "L0" : ageDays <= rule("L1").ttlDays ? "L1" : ageDays <= rule("L2").ttlDays ? "L2" : "L4";
    case "run":
    case "artifact": return ageDays <= rule("L1").ttlDays ? "L1" : ageDays <= rule("L2").ttlDays ? "L2" : "L4";
    case "evidence":
    case "final-response": return ageDays <= rule("L2").ttlDays ? "L2" : "L4";
    case "checkpoint": return input.terminal === false ? "L0" : "L1";
    case "event": return "L1";
    default: return "L1";
  }
}

/** Whether a record is still within its tier TTL (0 = always keep). */
export function withinTtl(updatedAt: string, tier: DataTier, rules: readonly TierRule[] = DEFAULT_TIER_RULES, now = Date.now()): boolean {
  const rule = rules.find((item) => item.tier === tier);
  if (!rule) return false;
  if (rule.ttlDays <= 0) return true;
  return (now - Date.parse(updatedAt || new Date(0).toISOString())) / 86400000 <= rule.ttlDays;
}

export interface StorageBudgetPolicy {
  /** Per-conversation cap of completed terminal tasks kept; older are pruned. 0 = unlimited. */
  maxCompletedTasksPerConversation: number;
  /** Cap on raw runs kept per retained task. 0 = unlimited. */
  maxRunsPerTask: number;
  /** Drop records beyond their tier TTL? (events always capped independently.) */
  enforceTtl: boolean;
  /** When enforced, families in this list are never pruned (e.g. ledger-backed tasks). */
  protectedFamilies?: string[];
  /**
   * U1 P1 (§13 hard rule): destructive pruning removes completed-task history
   * (runs/artifacts/evidence/final responses). Boss must NEVER delete that
   * history automatically for cleanup/space/completion reasons — only an
   * explicit user action with confirmation may. `userAuthorizedDelete` is the
   * only flag that enables destructive pruning; it must be set by a caller
   * that just received explicit user consent. Absent/false = no-op.
   */
  userAuthorizedDelete?: boolean;
}

export const DEFAULT_STORAGE_BUDGET: StorageBudgetPolicy = { maxCompletedTasksPerConversation: 0, maxRunsPerTask: 0, enforceTtl: false };

export interface LifecyclePruneReport {
  removed: { family: string; count: number }[];
  retainedTasks: number;
}

export function validateBudgetPolicy(policy: StorageBudgetPolicy): void {
  if (!Number.isInteger(policy.maxCompletedTasksPerConversation) || policy.maxCompletedTasksPerConversation < 0) throw new Error("maxCompletedTasksPerConversation must be a non-negative integer");
  if (!Number.isInteger(policy.maxRunsPerTask) || policy.maxRunsPerTask < 0) throw new Error("maxRunsPerTask must be a non-negative integer");
}

export function emptyPruneReport(): LifecyclePruneReport {
  return { removed: [], retainedTasks: 0 };
}
