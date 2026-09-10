/**
 * Root Authority contracts (Update-Plan/Isolation-Finalization.md §4, §5, §7,
 * §11, §13). Pure and shareable: no fs, no electron, no DOM.
 *
 * The Root invariant this module encodes:
 *
 *   Boss may autonomously evolve its capabilities, but may never autonomously
 *   redefine, bypass, revoke, impersonate, or supersede the Root Owner or the
 *   controls that enforce Root Owner authority.
 *
 * `RootDecision` is the single vocabulary every Root-sensitive call site speaks.
 * It is deliberately three-valued and ordered by strictness:
 *
 *   DENY  <  ...  no:  ALLOW (0) < REQUIRE_OWNER (1) < DENY (2)
 *
 * Composing two decisions always yields the stricter one, so a permissive
 * sub-decision can never launder a stricter one. `ROOT_OPERATION_FLOOR` is the
 * immutable floor: no run mode, no policy file and no future execution profile
 * may ever loosen it (§4: "OWNER_RESULT / AUTONOMOUS / 任何未来模式都不得把
 * DENY 转成 ALLOW").
 */

/** The unified Root permission result (§4). */
export type RootDecision = "ALLOW" | "REQUIRE_OWNER" | "DENY";

export const ROOT_DECISIONS: readonly RootDecision[] = ["ALLOW", "REQUIRE_OWNER", "DENY"];

export function isRootDecision(value: unknown): value is RootDecision {
  return value === "ALLOW" || value === "REQUIRE_OWNER" || value === "DENY";
}

const ROOT_DECISION_RANK: Readonly<Record<RootDecision, number>> = { ALLOW: 0, REQUIRE_OWNER: 1, DENY: 2 };

/** Returns the stricter of two decisions (DENY beats REQUIRE_OWNER beats ALLOW). */
export function strictestRootDecision(a: RootDecision, b: RootDecision): RootDecision {
  return ROOT_DECISION_RANK[a] >= ROOT_DECISION_RANK[b] ? a : b;
}

/** Folds a set of decisions into the strictest one; the empty set is ALLOW. */
export function foldRootDecisions(decisions: readonly RootDecision[]): RootDecision {
  return decisions.reduce<RootDecision>((worst, next) => strictestRootDecision(worst, next), "ALLOW");
}

/** Strictness comparison, exposed so callers can assert "never loosened". */
export function rootDecisionRank(decision: RootDecision): number {
  return ROOT_DECISION_RANK[decision];
}

/** True when `candidate` is at least as strict as `floor`. */
export function isAtLeastAsStrict(candidate: RootDecision, floor: RootDecision): boolean {
  return ROOT_DECISION_RANK[candidate] >= ROOT_DECISION_RANK[floor];
}

/**
 * Every operation the Root Authority classifies (§4). The split between the
 * three groups below is the whole permission model, so the list is exhaustive
 * and the floors are declared next to it rather than derived from a string
 * heuristic.
 */
export type RootOperation =
  // ---- ALLOW: ordinary autonomous evolution work (§4 ALLOW) ----
  | "candidate.workspace.read"
  | "candidate.workspace.write"
  | "candidate.create"
  | "candidate.build"
  | "candidate.test"
  | "candidate.git.inspect"
  | "evidence.write"
  | "review.role"
  | "promotion.evaluate"
  | "promotion.execute"
  | "candidate.rollback"
  | "candidate.abort"
  // ---- REQUIRE_OWNER: Boss may propose, Owner must approve (§4 REQUIRE_OWNER) ----
  | "protected.surface.mutate"
  | "ci.gate.mutate"
  | "root.authority.mutate"
  | "root.policy.mutate"
  | "credential.boundary.mutate"
  | "promotion.gate.mutate"
  | "stable.candidate.boundary.mutate"
  | "emergency.control.mutate"
  | "root.invariant.test.mutate"
  | "owner.identity.mutate"
  // ---- DENY: absolute, mode-independent (§4 DENY) ----
  | "self.elevation"
  | "owner.credential.use"
  | "owner.credential.scan"
  | "repository.administration"
  | "main.direct.push"
  | "git.force.push"
  | "required.check.bypass"
  | "ruleset.self.rewrite"
  | "main.protection.disable"
  | "emergency.stop.disable"
  | "stale.sha.promotion"
  | "stable.worktree.write"
  | "stable.runtime.write"
  | "shell.arbitrary"
  | "workspace.escape"
  | "gate.self.rewrite";

export const ROOT_OPERATIONS: readonly RootOperation[] = [
  "candidate.workspace.read",
  "candidate.workspace.write",
  "candidate.create",
  "candidate.build",
  "candidate.test",
  "candidate.git.inspect",
  "evidence.write",
  "review.role",
  "promotion.evaluate",
  "promotion.execute",
  "candidate.rollback",
  "candidate.abort",
  "protected.surface.mutate",
  "ci.gate.mutate",
  "root.authority.mutate",
  "root.policy.mutate",
  "credential.boundary.mutate",
  "promotion.gate.mutate",
  "stable.candidate.boundary.mutate",
  "emergency.control.mutate",
  "root.invariant.test.mutate",
  "owner.identity.mutate",
  "self.elevation",
  "owner.credential.use",
  "owner.credential.scan",
  "repository.administration",
  "main.direct.push",
  "git.force.push",
  "required.check.bypass",
  "ruleset.self.rewrite",
  "main.protection.disable",
  "emergency.stop.disable",
  "stale.sha.promotion",
  "stable.worktree.write",
  "stable.runtime.write",
  "shell.arbitrary",
  "workspace.escape",
  "gate.self.rewrite"
];

export function isRootOperation(value: unknown): value is RootOperation {
  return typeof value === "string" && (ROOT_OPERATIONS as readonly string[]).includes(value);
}

/**
 * The immutable floor. A policy file may only ever move an operation *towards*
 * DENY relative to this table; `applyPolicyFloor` in root-policy.ts enforces it.
 * `shell.arbitrary`, `workspace.escape` and `gate.self.rewrite` exist here so a
 * future execution profile cannot re-introduce them by accident.
 */
export const ROOT_OPERATION_FLOOR: Readonly<Record<RootOperation, RootDecision>> = {
  "candidate.workspace.read": "ALLOW",
  "candidate.workspace.write": "ALLOW",
  "candidate.create": "ALLOW",
  "candidate.build": "ALLOW",
  "candidate.test": "ALLOW",
  "candidate.git.inspect": "ALLOW",
  "evidence.write": "ALLOW",
  "review.role": "ALLOW",
  "promotion.evaluate": "ALLOW",
  "promotion.execute": "ALLOW",
  "candidate.rollback": "ALLOW",
  "candidate.abort": "ALLOW",
  "protected.surface.mutate": "REQUIRE_OWNER",
  "ci.gate.mutate": "REQUIRE_OWNER",
  "root.authority.mutate": "REQUIRE_OWNER",
  "root.policy.mutate": "REQUIRE_OWNER",
  "credential.boundary.mutate": "REQUIRE_OWNER",
  "promotion.gate.mutate": "REQUIRE_OWNER",
  "stable.candidate.boundary.mutate": "REQUIRE_OWNER",
  "emergency.control.mutate": "REQUIRE_OWNER",
  "root.invariant.test.mutate": "REQUIRE_OWNER",
  "owner.identity.mutate": "REQUIRE_OWNER",
  "self.elevation": "DENY",
  "owner.credential.use": "DENY",
  "owner.credential.scan": "DENY",
  "repository.administration": "DENY",
  "main.direct.push": "DENY",
  "git.force.push": "DENY",
  "required.check.bypass": "DENY",
  "ruleset.self.rewrite": "DENY",
  "main.protection.disable": "DENY",
  "emergency.stop.disable": "DENY",
  "stale.sha.promotion": "DENY",
  "stable.worktree.write": "DENY",
  "stable.runtime.write": "DENY",
  "shell.arbitrary": "DENY",
  "workspace.escape": "DENY",
  "gate.self.rewrite": "DENY"
};

/** The Root Owner as seen by the product. Never a credential, only an identity. */
export interface RootIdentity {
  /** GitHub login of the single Root Owner. Exactly one, by construction. */
  login: string;
  /** Human-facing display name; never used for authorization. */
  displayName?: string;
}

/** Why a decision was reached — durable evidence, not a log string (§16). */
export interface RootDecisionReason {
  /** Stable machine code, e.g. `floor:DENY`, `policy:REQUIRE_OWNER`, `path:protected`. */
  code: string;
  /** Human-readable explanation. Never contains secret material. */
  detail: string;
}

/** One durable Root decision record (§7.3). */
export interface RootDecisionRecord {
  timestamp: string;
  runId: string;
  actor: string;
  operation: RootOperation | string;
  target: string;
  decision: RootDecision;
  reason: string;
  candidateSha: string | null;
}

/** The same record with structured reasons, as produced in-process. */
export interface RootClassification {
  operation: RootOperation;
  decision: RootDecision;
  reasons: readonly RootDecisionReason[];
  /** Repo-relative paths that drove the decision (already normalized). */
  protectedPaths: readonly string[];
}

/**
 * Advisory label for the *mode* a call arrived under. This exists purely so the
 * audit ledger can attribute a decision; it can never change the outcome
 * (see `classifyRootOperation`, which ignores mode for DENY floors).
 */
export type RootRequestMode = "ASSISTED" | "AUTONOMOUS" | "OWNER_RESULT" | "EVOLUTION" | "UNKNOWN";

/** Execution profiles. Only EVOLUTION may run candidate construction (§10). */
export type ExecutionProfile = "INTERACTIVE" | "ENGINEERING" | "EVOLUTION";

export function isExecutionProfile(value: unknown): value is ExecutionProfile {
  return value === "INTERACTIVE" || value === "ENGINEERING" || value === "EVOLUTION";
}
