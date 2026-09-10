/**
 * Engine Phase 1 — provider outcome contracts (pure, platform-neutral).
 *
 * The Engine book (§5) requires a hard separation between two questions:
 *
 *   RuntimeOutcome : did the CALL work?   (SUCCESS / TIMEOUT / AUTH_REQUIRED …)
 *   SemanticOutcome: did the OUTPUT actually fulfil the goal?
 *                    (FULL_COMPLETION / HARD_REFUSAL / GOAL_DRIFT …)
 *
 * A runtime-layer fault (auth, timeout, page change) must never be recorded as a
 * model capability/restriction signal, and an explicit provider refusal inside a
 * perfectly successful call must never be recorded as a runtime failure.
 *
 * Everything here is deterministic and dependency-free so it is safe to share
 * with the renderer and to replay historically.
 */

/** Runtime-layer status vocabulary (unchanged from RuntimeResult). */
export type RuntimeStatus = "SUCCESS" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE" | "CANCELLED";

/** Runtime-layer failure codes that are NOT evidence about the model. */
export const NON_SEMANTIC_RUNTIME_CODES = [
  "TIMEOUT",
  "AUTH_REQUIRED",
  "PAGE_CHANGED",
  "RATE_LIMITED",
  "BUDGET_EXHAUSTED",
  "USER_ACTION_REQUIRED",
  "UNSUPPORTED",
  "DOWN",
  "BUSY",
  "UNKNOWN"
] as const;

export type NonSemanticRuntimeCode = (typeof NON_SEMANTIC_RUNTIME_CODES)[number];

export type SemanticOutcome =
  | "FULL_COMPLETION"
  | "PARTIAL_COMPLETION"
  | "GOAL_DRIFT"
  | "SOFT_RESTRICTION"
  | "HEAVY_SANITIZATION"
  | "PARTIAL_REFUSAL"
  | "HARD_REFUSAL"
  | "BAD_QUALITY"
  | "FORMAT_FAILURE"
  | "VERIFICATION_FAILURE"
  | "UNCLASSIFIED";

export const SEMANTIC_OUTCOMES: readonly SemanticOutcome[] = [
  "FULL_COMPLETION",
  "PARTIAL_COMPLETION",
  "GOAL_DRIFT",
  "SOFT_RESTRICTION",
  "HEAVY_SANITIZATION",
  "PARTIAL_REFUSAL",
  "HARD_REFUSAL",
  "BAD_QUALITY",
  "FORMAT_FAILURE",
  "VERIFICATION_FAILURE",
  "UNCLASSIFIED"
] as const;

/** Continuous behaviour axes (Engine book §6) — never a single boolean. */
export interface BehaviourAxes {
  completion: number; // 0..1
  goalFidelity: number; // 0..1
  restrictionImpact: number; // 0..1
  sanitizationImpact: number; // 0..1
  pipelineBlocking: number; // 0..1
  quality?: number; // 0..1 | undefined
  verificationScore?: number; // 0..1 | undefined
}

export interface SemanticEvaluation {
  evaluatorVersion: string;
  outcome: SemanticOutcome;
  axes: BehaviourAxes;
  confidence: number; // 0..1
  reasons: string[];
  /**
   * True when the outcome is explained by the runtime/host layer rather than the
   * model's behaviour. Such evaluations MUST NOT feed restriction/capability
   * aggregates (Engine book §5, acceptance A05/A06/A07).
   */
  runtimeAttributable: boolean;
  /** Explicit gate for profile builders: false ⇒ exclude from semantic profiles. */
  penalizesSemanticProfile: boolean;
}

/** What the evaluator observes. Signals are optional: unknown stays UNCLASSIFIED. */
export interface OutcomeEvaluationInput {
  runtimeStatus: RuntimeStatus;
  runtimeFailureCode?: string;
  /** Extracted response text (when the call produced one). */
  content?: string;
  signals?: {
    /** The provider explicitly refused the request. */
    refusal?: boolean;
    /** The provider partially refused / partially answered. */
    partialRefusal?: boolean;
    /** Response is a soft (hedged) restriction rather than a refusal. */
    softRestriction?: boolean;
    /** Response was heavily sanitized / stripped. */
    heavySanitization?: boolean;
    /** Output format did not match the requested contract. */
    formatOk?: boolean | null;
    /** Deterministic verification (tests/gates) pass/fail. */
    verificationPassed?: boolean | null;
    /** Fraction of requested deliverables actually covered (0..1). */
    deliverablesCovered?: number;
    /** Evidence produced by drift detection. */
    driftEvidence?: string[];
    /** Observed answer quality (0..1) from a deterministic checker. */
    quality?: number;
    /** Answer was produced but is judged unusable. */
    badQuality?: boolean;
  };
}

/** Axis table: outcome → continuous axes (book §6). Configurable, not gospel. */
export const OUTCOME_AXES: Record<SemanticOutcome, BehaviourAxes> = {
  FULL_COMPLETION: { completion: 1, goalFidelity: 1, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0 },
  PARTIAL_COMPLETION: { completion: 0.5, goalFidelity: 0.6, restrictionImpact: 0.05, sanitizationImpact: 0.05, pipelineBlocking: 0.2 },
  GOAL_DRIFT: { completion: 0.3, goalFidelity: 0.2, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0.5 },
  SOFT_RESTRICTION: { completion: 0.7, goalFidelity: 0.8, restrictionImpact: 0.2, sanitizationImpact: 0.1, pipelineBlocking: 0.1 },
  HEAVY_SANITIZATION: { completion: 0.6, goalFidelity: 0.5, restrictionImpact: 0.5, sanitizationImpact: 0.7, pipelineBlocking: 0.2 },
  PARTIAL_REFUSAL: { completion: 0.25, goalFidelity: 0.3, restrictionImpact: 0.75, sanitizationImpact: 0.2, pipelineBlocking: 0.7 },
  HARD_REFUSAL: { completion: 0, goalFidelity: 0, restrictionImpact: 1, sanitizationImpact: 0.1, pipelineBlocking: 1 },
  BAD_QUALITY: { completion: 0.4, goalFidelity: 0.6, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0.3, quality: 0.2 },
  FORMAT_FAILURE: { completion: 0.2, goalFidelity: 0.5, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0.6, quality: 0.3 },
  VERIFICATION_FAILURE: { completion: 0.5, goalFidelity: 0.7, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0.7, verificationScore: 0 },
  // Unknown ⇒ NO penalty: neutral impact axes, zero confidence, excluded downstream.
  UNCLASSIFIED: { completion: 0, goalFidelity: 0, restrictionImpact: 0, sanitizationImpact: 0, pipelineBlocking: 0 }
};

export const OUTCOME_EVALUATOR_VERSION = "semantic-evaluator-1.0.0";

function unclassified(reason: string, evaluatorVersion: string, extraReasons: string[] = []): SemanticEvaluation {
  return {
    evaluatorVersion,
    outcome: "UNCLASSIFIED",
    axes: { ...OUTCOME_AXES.UNCLASSIFIED },
    confidence: 0,
    reasons: [reason, ...extraReasons],
    runtimeAttributable: true,
    penalizesSemanticProfile: false
  };
}

/** Is this runtime code a host/runtime problem rather than model behaviour? */
export function isNonSemanticRuntimeCode(code: string | undefined): boolean {
  if (!code) return false;
  return (NON_SEMANTIC_RUNTIME_CODES as readonly string[]).includes(code);
}

/**
 * Deterministic classification. Order matters:
 *  1. runtime-layer faults ⇒ UNCLASSIFIED (no semantic penalty)
 *  2. deterministic verification/format failures (not provider restriction)
 *  3. explicit refusal / partial refusal / restriction / sanitization
 *  4. goal drift
 *  5. partial vs full completion
 */
export function deriveSemanticEvaluation(input: OutcomeEvaluationInput, evaluatorVersion: string = OUTCOME_EVALUATOR_VERSION): SemanticEvaluation {
  const reasons: string[] = [];
  const signals = input.signals ?? {};

  // 1. Runtime-layer faults: never model evidence (A05/A06/A07).
  if (input.runtimeStatus !== "SUCCESS") {
    const code = input.runtimeFailureCode ?? input.runtimeStatus;
    return unclassified(`runtime did not succeed (${code}); no semantic conclusion`, evaluatorVersion, [
      isNonSemanticRuntimeCode(input.runtimeFailureCode) ? "runtime-layer fault excluded from semantic evidence" : "runtime failure excluded from semantic evidence"
    ]);
  }
  if (isNonSemanticRuntimeCode(input.runtimeFailureCode)) {
    return unclassified(`runtime reported ${input.runtimeFailureCode}; not model behaviour`, evaluatorVersion);
  }

  const content = (input.content ?? "").trim();

  // 2. Deterministic checks first: format / verification failures are OUR
  //    contract violations, not provider restriction evidence.
  if (signals.verificationPassed === false) {
    return build("VERIFICATION_FAILURE", evaluatorVersion, ["deterministic verification failed"], 0.9);
  }
  if (signals.formatOk === false) {
    return build("FORMAT_FAILURE", evaluatorVersion, ["response did not match the requested format"], 0.8);
  }

  // 3. Provider behaviour signals.
  if (signals.refusal === true) {
    return build("HARD_REFUSAL", evaluatorVersion, ["explicit refusal observed inside a successful call"], 0.85);
  }
  if (signals.partialRefusal === true) {
    return build("PARTIAL_REFUSAL", evaluatorVersion, ["partial refusal observed"], 0.7);
  }
  if (signals.heavySanitization === true) {
    return build("HEAVY_SANITIZATION", evaluatorVersion, ["heavy sanitization observed"], 0.6);
  }
  if (signals.softRestriction === true) {
    return build("SOFT_RESTRICTION", evaluatorVersion, ["soft restriction observed"], 0.6);
  }

  // 4. Goal drift (A08).
  if (signals.driftEvidence?.length) {
    return build("GOAL_DRIFT", evaluatorVersion, ["goal drift evidence recorded", ...signals.driftEvidence], 0.7);
  }

  // 5. Completion coverage.
  const covered = signals.deliverablesCovered;
  if (typeof covered === "number" && covered < 1) {
    if (signals.badQuality === true || (typeof signals.quality === "number" && signals.quality < 0.35)) {
      return build("BAD_QUALITY", evaluatorVersion, [`deliverables covered ${covered}`, "quality below threshold"], 0.6);
    }
    return build("PARTIAL_COMPLETION", evaluatorVersion, [`deliverables covered ${covered}`], 0.7);
  }
  if (signals.badQuality === true) {
    return build("BAD_QUALITY", evaluatorVersion, ["content judged unusable by deterministic checker"], 0.6);
  }
  if (typeof signals.quality === "number" && signals.quality < 0.35) {
    return build("BAD_QUALITY", evaluatorVersion, [`quality ${signals.quality}`], 0.5);
  }

  if (!content) {
    return unclassified("call succeeded but produced no content to evaluate", evaluatorVersion);
  }

  reasons.push("no refusal/restriction/format/verification/drift signal observed");
  return build("FULL_COMPLETION", evaluatorVersion, reasons, 0.7);
}

function build(outcome: SemanticOutcome, evaluatorVersion: string, reasons: string[], confidence: number): SemanticEvaluation {
  return {
    evaluatorVersion,
    outcome,
    axes: { ...OUTCOME_AXES[outcome] },
    confidence,
    reasons,
    runtimeAttributable: false,
    penalizesSemanticProfile: true
  };
}

/** Deterministic goal-drift detection (Engine §3): the output must serve the
 *  Canonical Goal, so scope changes / dropped deliverables are recorded rather
 *  than silently accepted. */export interface GoalDriftInput {
  deliverables?: string[];
  constraints?: string[];
}

export interface GoalDriftResult {
  drifted: boolean;
  evidence: string[];
}

const SCOPE_CHANGE_MARKERS = [
  /instead of (?:the )?(?:requested|original)/i,
  /rather than (?:the )?(?:requested|original)/i,
  /i (?:changed|altered|replaced) the (?:goal|objective|requirement|scope)/i,
  /(?:改为|改成了|换成了|替换了(?:目标|需求|范围))/,
  /(?:不按|未按)(?:原|用户)(?:要求|目标)/
];

/** Marker + coverage based drift evidence. Never rewrites the goal — only reports. */
export function detectGoalDrift(goal: GoalDriftInput, output: string): GoalDriftResult {
  const evidence: string[] = [];
  const text = output ?? "";
  for (const marker of SCOPE_CHANGE_MARKERS) {
    if (marker.test(text)) evidence.push(`scope-change marker: ${marker.source}`);
  }
  for (const deliverable of goal.deliverables ?? []) {
    const tokens = deliverable
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{4,}/gu)
      ?.slice(0, 3) ?? [];
    if (tokens.length && !tokens.some((token) => text.toLocaleLowerCase().includes(token))) {
      evidence.push(`deliverable not addressed: ${deliverable}`);
    }
  }
  return { drifted: evidence.length > 0, evidence };
}

/**
 * Evaluator revision (Engine §10): a later, better evaluator may re-judge an
 * episode, but the original response/artifact and the original evaluation are
 * never overwritten — the revision is appended and carries the audit reference.
 */
export interface SemanticEvaluationRevision {
  schemaVersion: 1;
  episodeId: string;
  originalEvaluatorVersion: string;
  originalOutcome: SemanticOutcome;
  revised: SemanticEvaluation;
  reason: string;
  revisedAt: string;
}

export function createEvaluationRevision(input: {
  episodeId: string;
  original: SemanticEvaluation;
  revised: SemanticEvaluation;
  reason: string;
  revisedAt: string;
}): SemanticEvaluationRevision {
  return {
    schemaVersion: 1,
    episodeId: input.episodeId,
    originalEvaluatorVersion: input.original.evaluatorVersion,
    originalOutcome: input.original.outcome,
    revised: input.revised,
    reason: input.reason,
    revisedAt: input.revisedAt
  };
}
