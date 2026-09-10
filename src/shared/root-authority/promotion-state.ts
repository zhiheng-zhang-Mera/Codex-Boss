/**
 * Promotion state machine and exact-SHA evidence contract
 * (Update-Plan/Isolation-Finalization.md §4, §11, §14 RT-14..RT-17). Pure and
 * shareable: no fs, no electron.
 *
 * Promotion is not "the model said it is done". It is a host evidence contract:
 * a Candidate reaches `PROMOTED` only from `PROMOTING`, a promotion only starts
 * from `PROMOTABLE` or from an Owner-approved `WAITING_FOR_ROOT_OWNER`, and both
 * of those require the *same* SHA to have been validated by CI, to be the PR
 * head, and to be the SHA being promoted.
 *
 *     candidateHeadSha == ciValidatedSha == prHeadSha == promotionSha
 *
 * A worker `DONE`, a reviewer "looks good" and local green tests are all
 * necessary inputs and none of them is a promotion.
 */

export type PromotionState =
  | "CREATED"
  | "WORKING"
  | "VERIFYING"
  | "REVIEWING"
  | "READY_FOR_PR"
  | "WAITING_FOR_CI"
  | "WAITING_FOR_ROOT_OWNER"
  | "PROMOTABLE"
  | "PROMOTING"
  | "PROMOTED"
  | "REJECTED"
  | "ROLLED_BACK"
  | "BLOCKED_EXTERNAL";

export const PROMOTION_STATES: readonly PromotionState[] = [
  "CREATED",
  "WORKING",
  "VERIFYING",
  "REVIEWING",
  "READY_FOR_PR",
  "WAITING_FOR_CI",
  "WAITING_FOR_ROOT_OWNER",
  "PROMOTABLE",
  "PROMOTING",
  "PROMOTED",
  "REJECTED",
  "ROLLED_BACK",
  "BLOCKED_EXTERNAL"
];

/**
 * Legal transitions. The table is the whole safety argument for "worker DONE
 * never becomes PROMOTED": no edge from WORKING/REVIEWING/VERIFYING reaches
 * PROMOTED, and PROMOTED has exactly one inbound edge (from PROMOTING).
 */
const TRANSITIONS: Readonly<Record<PromotionState, readonly PromotionState[]>> = {
  CREATED: ["WORKING", "REJECTED"],
  WORKING: ["VERIFYING", "REJECTED"],
  VERIFYING: ["REVIEWING", "REJECTED"],
  REVIEWING: ["READY_FOR_PR", "REJECTED"],
  READY_FOR_PR: ["WAITING_FOR_CI", "REJECTED", "BLOCKED_EXTERNAL"],
  WAITING_FOR_CI: ["WAITING_FOR_ROOT_OWNER", "PROMOTABLE", "REJECTED", "BLOCKED_EXTERNAL"],
  // Owner approval releases the ceiling and the run becomes promotable; it still
  // has to pass through the ordinary begin/complete promotion steps.
  WAITING_FOR_ROOT_OWNER: ["PROMOTABLE", "REJECTED", "BLOCKED_EXTERNAL"],
  PROMOTABLE: ["PROMOTING", "REJECTED", "BLOCKED_EXTERNAL"],
  PROMOTING: ["PROMOTED", "REJECTED", "BLOCKED_EXTERNAL"],
  PROMOTED: ["ROLLED_BACK"],
  REJECTED: [],
  ROLLED_BACK: [],
  // External unavailability is recoverable without redoing local work (§FI-04):
  // once the credential/remote appears the run may resume its gate evaluation.
  BLOCKED_EXTERNAL: ["WAITING_FOR_CI", "WAITING_FOR_ROOT_OWNER", "PROMOTABLE", "PROMOTING", "REJECTED"]
};

export const TERMINAL_PROMOTION_STATES: readonly PromotionState[] = ["REJECTED", "ROLLED_BACK"];

export function isPromotionState(value: unknown): value is PromotionState {
  return typeof value === "string" && (PROMOTION_STATES as readonly string[]).includes(value);
}

export function isTerminalPromotionState(state: PromotionState): boolean {
  return TERMINAL_PROMOTION_STATES.includes(state);
}

/** True when the run is durably parked on the Root Owner (§15 FI-05). */
export function isWaitingForRootOwner(state: PromotionState): boolean {
  return state === "WAITING_FOR_ROOT_OWNER";
}

export function canTransition(from: PromotionState, to: PromotionState): boolean {
  if (!isPromotionState(from) || !isPromotionState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export class PromotionTransitionError extends Error {
  constructor(readonly from: PromotionState, readonly to: PromotionState) {
    super(`Illegal promotion transition ${from} -> ${to}`);
    this.name = "PromotionTransitionError";
  }
}

/** Throws rather than silently coercing, so an illegal edge cannot be "fixed". */
export function assertTransition(from: PromotionState, to: PromotionState): void {
  if (!canTransition(from, to)) throw new PromotionTransitionError(from, to);
}

/**
 * Emergency control (§13) may drive any non-terminal run to REJECTED, including
 * mid-`PROMOTING`. It may never drive anything to PROMOTED.
 */
export function allowedTransitionsFrom(state: PromotionState, options: { emergencyStop?: boolean } = {}): readonly PromotionState[] {
  if (options.emergencyStop && !isTerminalPromotionState(state)) {
    const withStop = new Set<PromotionState>([...TRANSITIONS[state], "REJECTED"]);
    withStop.delete("PROMOTED");
    withStop.delete("PROMOTING");
    return [...withStop];
  }
  return TRANSITIONS[state];
}

// ---------------------------------------------------------------------------
// Exact SHAs
// ---------------------------------------------------------------------------

/** The four SHAs that must agree before promotion (§11.2). */
export interface ExactShaBinding {
  /** HEAD of the Candidate branch as the worker left it. */
  candidateHeadSha: string | null;
  /** The SHA that the required CI `validate` check actually validated. */
  ciValidatedSha: string | null;
  /** The head SHA of the pull request, as reported by the remote. */
  prHeadSha: string | null;
  /** The SHA about to be promoted into Stable. */
  promotionSha: string | null;
}

export interface ExactShaVerdict {
  ok: boolean;
  /** Stable machine reason; never a log sentence. */
  code:
    | "EXACT_SHA_OK"
    | "SHA_MISSING"
    | "SHA_MALFORMED"
    | "SHA_MISMATCH";
  detail: string;
  /** The agreed SHA, only when `ok`. */
  sha?: string;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Requires all four SHAs to be present, well-formed, and equal. Anything else
 * invalidates the earlier PASS outright: §11.2 "任一变化：重新 validation；
 * 旧 PASS 作废."
 */
export function evaluateExactShaBinding(binding: ExactShaBinding): ExactShaVerdict {
  const entries: [keyof ExactShaBinding, string | null][] = [
    ["candidateHeadSha", binding.candidateHeadSha],
    ["ciValidatedSha", binding.ciValidatedSha],
    ["prHeadSha", binding.prHeadSha],
    ["promotionSha", binding.promotionSha]
  ];
  const missing = entries.filter(([, value]) => value === null || value === undefined || value === "").map(([key]) => key);
  if (missing.length) return { ok: false, code: "SHA_MISSING", detail: `unbound: ${missing.join(", ")}` };

  const malformed = entries.filter(([, value]) => !SHA.test(String(value))).map(([key]) => key);
  if (malformed.length) return { ok: false, code: "SHA_MALFORMED", detail: `not a full 40-hex commit id: ${malformed.join(", ")}` };

  const distinct = [...new Set(entries.map(([, value]) => String(value)))];
  if (distinct.length !== 1) {
    return { ok: false, code: "SHA_MISMATCH", detail: `bound SHAs differ: ${entries.map(([key, value]) => `${key}=${String(value).slice(0, 12)}`).join(", ")}` };
  }
  return { ok: true, code: "EXACT_SHA_OK", detail: `all four SHAs agree on ${distinct[0]}`, sha: distinct[0] };
}

/**
 * §11.2 invalidation: a previously validated SHA stops being evidence the moment
 * the head moves. Returns true when the CI result must be discarded.
 */
export function ciEvidenceInvalidated(ciValidatedSha: string | null, currentHeadSha: string | null): boolean {
  return !ciValidatedSha || !currentHeadSha || ciValidatedSha !== currentHeadSha;
}

// ---------------------------------------------------------------------------
// Promotion decision
// ---------------------------------------------------------------------------

export interface PromotionEvidence {
  candidateHeadSha: string | null;
  ciValidatedSha: string | null;
  prHeadSha: string | null;
  promotionSha: string | null;
  /** Host-selected required checks (CI `validate`) all reported PASS. */
  requiredChecksPassed: boolean;
  /** Branch is up to date with the base branch (strict up-to-date check). */
  branchUpToDate: boolean;
  /** Independent reviewer produced no HIGH / significant-MEDIUM finding. */
  reviewerClean: boolean;
  /** Owner emergency control is engaged (§13). */
  emergencyStopEngaged: boolean;
  /** The candidate change set touches at least one Root Surface path. */
  protectedSurfaceTouched: boolean;
  /** Explicit Root Owner approval exists for this exact SHA. */
  rootOwnerApproved: boolean;
  /**
   * Set when a required external capability is genuinely unavailable
   * (dedicated Boss GitHub credential missing, GitHub unreachable). Never set
   * to paper over a local failure.
   */
  externalBlocker?: string | null;
}

export type PromotionOutcomeState = "PROMOTABLE" | "WAITING_FOR_ROOT_OWNER" | "WAITING_FOR_CI" | "BLOCKED_EXTERNAL" | "REJECTED";

export interface PromotionOutcome {
  state: PromotionOutcomeState;
  reasons: string[];
  /** The exact SHA the outcome is bound to, when one could be established. */
  sha?: string;
}

/**
 * The single deterministic promotion decision. Ordered most-restrictive first
 * so a later green signal can never outrank an earlier red one.
 */
export function decidePromotion(evidence: PromotionEvidence): PromotionOutcome {
  // 1. Owner emergency control outranks everything (§13, RT-20/RT-21).
  if (evidence.emergencyStopEngaged) return { state: "REJECTED", reasons: ["emergency-stop-engaged"] };

  // 2. A genuinely missing external capability is BLOCKED_EXTERNAL, never a
  //    fake PASS and never an Owner-credential fallback (§9.3, RT-22).
  if (evidence.externalBlocker) return { state: "BLOCKED_EXTERNAL", reasons: [`external:${evidence.externalBlocker}`] };

  // 3. Exact SHA before any green signal is trusted (RT-14/RT-15).
  const exact = evaluateExactShaBinding(evidence);
  if (!exact.ok) return { state: "REJECTED", reasons: [`${exact.code}: ${exact.detail}`] };
  const sha = exact.sha;

  // 4. Required checks / independent review (§11.1, RT-16/RT-17).
  if (!evidence.requiredChecksPassed) return { state: "REJECTED", reasons: ["required-checks-not-passed"], sha };
  if (!evidence.reviewerClean) return { state: "REJECTED", reasons: ["reviewer-finding-not-reflowed"], sha };

  // 5. Up-to-date branch is a CI precondition, not a rejection (§11.3).
  if (!evidence.branchUpToDate) return { state: "WAITING_FOR_CI", reasons: ["branch-not-up-to-date"], sha };

  // 6. Root Surface is a ceiling, not a floor: even a fully green Candidate
  //    stops here without explicit Owner approval (§11.4, RT-09..RT-13).
  if (evidence.protectedSurfaceTouched && !evidence.rootOwnerApproved) {
    return { state: "WAITING_FOR_ROOT_OWNER", reasons: ["protected-surface-requires-root-owner"], sha };
  }

  return { state: "PROMOTABLE", reasons: [], sha };
}
