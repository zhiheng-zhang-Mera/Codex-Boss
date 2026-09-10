import { ADAPTIVE_POLICY_VERSION } from "../../../src/shared/adaptive-routing";

/**
 * Engine Phase 10 — routing policy candidates (book §14 loop C).
 *
 * Boss may evolve its own routing policy, but ONLY through a gated path:
 *
 *   candidate → historical replay → regression check → shadow evaluation →
 *   controlled trial → promotion
 *
 * The "AI says the new formula is better ⇒ replace the router" shortcut is
 * explicitly forbidden. Every promoted policy keeps its parent version and a
 * rollback pointer so a broken policy can always be undone.
 */

export type PolicyCandidateStatus =
  | "DRAFT"
  | "REPLAY_FAILED"
  | "REPLAY_PASSED"
  | "SHADOW_FAILED"
  | "SHADOW_PASSED"
  | "TRIAL_FAILED"
  | "READY_FOR_PROMOTION"
  | "PROMOTED"
  | "REJECTED"
  | "ROLLED_BACK";

export interface AdaptivePolicyParams {
  /** Exploration probability (Phase 9). */
  epsilon: number;
  uncertaintyBonus: number;
  avoidBelowUtility: number;
  competitivenessMargin: number;
  /** Minimum profile samples before a runtime profile is trusted. */
  minSamplesPerProfile: number;
}

export interface AdaptivePolicy {
  policyVersion: string;
  parentVersion?: string;
  params: AdaptivePolicyParams;
}

/** The deterministic reference policy: no exploration, conservative floors. */
export const STABLE_POLICY_VERSION = "stable-1.0.0";

export const STABLE_POLICY: AdaptivePolicy = {
  policyVersion: STABLE_POLICY_VERSION,
  params: {
    epsilon: 0,
    uncertaintyBonus: 0,
    avoidBelowUtility: -0.1,
    competitivenessMargin: 0.35,
    minSamplesPerProfile: 3
  }
};

export interface EvaluationSummary {
  tasksEvaluated: number;
  stableMean: number;
  candidateMean: number;
  delta: number;
  regressions: number;
  notes: string[];
}

export interface PolicyCandidate {
  schemaVersion: 1;
  policy: AdaptivePolicy;
  status: PolicyCandidateStatus;
  createdAt: string;
  updatedAt: string;
  /** Stage evidence: replay → shadow → controlled trial. */
  replay?: EvaluationSummary;
  shadow?: EvaluationSummary;
  trial?: EvaluationSummary;
  promotedAt?: string;
  rollbackPointer?: string;
  rejectionReason?: string;
}

export function newPolicyCandidate(policy: AdaptivePolicy, parentVersion: string, at: string): PolicyCandidate {
  return {
    schemaVersion: 1,
    policy: { ...policy, parentVersion },
    status: "DRAFT",
    createdAt: at,
    updatedAt: at
  };
}

/** Policy version naming helper (candidate policies are numbered, not free-form). */
export function candidateVersion(sequence: number): string {
  return `candidate-${String(sequence).padStart(3, "0")}`;
}

export { ADAPTIVE_POLICY_VERSION };
