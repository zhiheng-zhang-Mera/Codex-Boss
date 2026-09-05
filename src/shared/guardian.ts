/**
 * Guardian boundary (plan §28). Pure and shareable.
 *
 * Three tiers, fail-closed at the boundary:
 *  - mutable:  tunable at runtime with no token (UI, worker prompts, routing
 *              and scheduler heuristics, knowledge retrieval).
 *  - protected: requires a Guardian token (verification rules, rollback,
 *              permission system, security classifier, migration rules,
 *              promotion gates).
 *  - guardian: §28 Guardian-root tier (root policy, production signing,
 *              backup deletion, classification downgrade, core security
 *              boundary). Also token-gated in this pack; the real-world
 *              ceremonies (signing, key custody) arrive with AP28b
 *              hardware-backed secrets.
 *
 * Unknown areas are mutable by default: the mutable tier in §28 is an open
 * list, and restricting an area means listing it in the protected or
 * guardian vocabulary. Every denial reason is a first-class string so
 * callers surface why an action was refused.
 */

export type GuardianGuard = "mutable" | "protected" | "guardian";

export const GUARDIAN_MUTABLE = new Set<string>([
  "ui", "worker.prompts", "routing.heuristics",
  "scheduler.heuristics", "knowledge.retrieval"
]);

export const GUARDIAN_PROTECTED = new Set<string>([
  "verification.rules", "rollback", "permission.system", "security.classifier",
  "migration.rules", "promotion.gate", "approval.policy"
]);

export const GUARDIAN_ROOT = new Set<string>([
  "root.policy", "production.signing", "backup.deletion",
  "classification.downgrade", "core.security.boundary"
]);

export interface GuardianVerdict {
  allowed: boolean;
  reason: string;
}

/** Root policy: map a concrete change area to its Guardian tier. */
export function classifyArea(area: string): GuardianGuard {
  if (GUARDIAN_MUTABLE.has(area)) return "mutable";
  if (GUARDIAN_PROTECTED.has(area)) return "protected";
  if (GUARDIAN_ROOT.has(area)) return "guardian";
  return "mutable";
}

/** Changing a protected/guardian area requires a Guardian token; else denied. */
export function changeAllowed(area: string, guardToken: boolean, scope: string): GuardianVerdict {
  const guard = classifyArea(area);
  if (guard === "mutable") return { allowed: true, reason: `mutable area ${area} in ${scope}` };
  if (!guardToken) return { allowed: false, reason: `Guardian denial: ${area} is ${guard} in ${scope}` };
  return { allowed: true, reason: `Guardian approved ${guard} area ${area} in ${scope}` };
}
