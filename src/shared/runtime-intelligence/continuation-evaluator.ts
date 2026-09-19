/**
 * Runtime Intelligence Plane — the continuation evaluator.
 *
 * The plan's requirement is that this judges whether calling the current model again is
 * still worth it, and that it does so in SHADOW: the real loop keeps its own stopping
 * rule, and this module records what it would have advised and where. There is therefore
 * no exported function here that can stop, abort or restart anything, and `mode` is the
 * literal `"SHADOW_ONLY"` on every assessment.
 *
 * The rules are ordered and deterministic, and every assessment names the signals it
 * considered. The three cases the plan calls out are covered directly: obvious repetition
 * (`SWITCH_MODEL`), obviously-still-unfinished work (`DECOMPOSE_TASK` rather than a
 * premature `STOP`), and the reverse error — stopping only when there is genuinely
 * nothing left unresolved.
 *
 * A signal that was not measured is not treated as a zero. An absent `uncertainty` cannot
 * trigger or veto anything, and the factors list records the absence so a reader can see
 * which rule could not be applied.
 */

import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  stableId,
  type ContinuationAssessment,
  type ContinuationDecision,
  type ContinuationSignals,
  type ReasoningFactor
} from "./contracts";
import { sha256Hex } from "../hash";


/** The only mode this evaluator has. */
export const CONTINUATION_MODE = "SHADOW_ONLY" as const;

/**
 * The continuation policies, so a result can be attributed to a version.
 *
 * `v0` is the policy the first real replay measured: STOP is what happens when no rule fires.
 * `v1` is the correction — STOP requires positive evidence and the no-signal fallback is
 * CONTINUE. Both are kept runnable because the comparison between them on the SAME corpus is
 * the evidence that the correction helped, and a baseline that can only be remembered cannot
 * be re-measured.
 */
export const CONTINUATION_POLICIES = ["continuation-policy-v0", "continuation-policy-v1"] as const;
export type ContinuationPolicyId = (typeof CONTINUATION_POLICIES)[number];

/** The policy a caller gets when it does not name one. */
export const DEFAULT_CONTINUATION_POLICY: ContinuationPolicyId = "continuation-policy-v1";

/**
 * What each policy decides when no rule fires.
 *
 * v0: STOP — the defect. The most expensive decision available was the default, so a state the
 * evaluator could not see produced it.
 * v1: CONTINUE — an absent signal is not a completion signal. `UNKNOWN != COMPLETE` and
 * `NO_SIGNAL != STOP`, and the measured penalty asymmetry (5 against 1) makes continuing the
 * cheaper error to be wrong about.
 */
export const CONTINUATION_POLICY_FALLBACK: Readonly<Record<ContinuationPolicyId, ContinuationDecision>> = {
  "continuation-policy-v0": "STOP",
  "continuation-policy-v1": "CONTINUE"
};

/** What each policy requires before it may say STOP. */
export const CONTINUATION_POLICY_STOP_EVIDENCE: Readonly<Record<ContinuationPolicyId, "PROGRESS_OR_UNRESOLVED" | "TASK_COMPLETE">> = {
  // v0 stopped on "nothing unresolved and progress at 1", which a step with an empty work list
  // satisfies trivially.
  "continuation-policy-v0": "PROGRESS_OR_UNRESOLVED",
  // v1 requires the loop to say the objective is finished.
  "continuation-policy-v1": "TASK_COMPLETE"
};

/** Thresholds the rules are stated in. Exported so a report can quote the rule it applied. */
export const CONTINUATION_THRESHOLDS = {
  /** A repeat rate at or above this, with novelty at or below `stalledNovelty`, means the model is looping. */
  repetitionRate: 0.8,
  stalledNovelty: 0.1,
  /** Reviewer disagreement at or above this share needs a human or a second reviewer. */
  reviewerDisagreementRate: 0.5,
  /** Self-contradictions needed before a reviewer is asked. */
  selfContradictionsForReview: 2,
  /** Uncertainty at or above this, with work left, needs a reviewer. */
  uncertaintyForReview: 0.7,
  /** Steps after which low progress with low novelty looks like a task that needs splitting. */
  decomposeAfterSteps: 4,
  decomposeProgress: 0.25,
  decomposeNovelty: 0.2,
  /** Progress at or above this with nothing unresolved is complete. */
  completeProgress: 1
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Formats a signal that may not have been measured.
 *
 * `detail` runs for every rule, including the ones that did not fire, so a signal real data does
 * not carry must render as "not measured" rather than crashing the assessment.
 */
function signalText(value: number | undefined): string {
  return value === undefined ? "not measured" : value.toFixed(2);
}

/**
 * Comparisons over possibly-absent signals.
 *
 * An absent signal makes every comparison FALSE, which is the module's stated rule: an
 * unmeasured signal neither triggers nor vetoes a rule. Writing it as a helper rather than a
 * `?? 0` default is the point — a default of zero would silently assert "no repetition
 * observed" about data nobody observed.
 */
function atLeast(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value >= threshold;
}

function atMost(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value <= threshold;
}

function below(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value < threshold;
}

interface Rule {
  decision: ContinuationDecision;
  confidence: number;
  /** Whether the rule's own precondition was met. `false` puts the reason in the factors as considered-and-not-fired. */
  matches: (signals: ContinuationSignals, policy: ContinuationPolicyId) => boolean;
  detail: (signals: ContinuationSignals) => string;
  factor: string;
}

/**
 * The rules, most decisive first.
 *
 * Ordering is the design: "nothing left to do" outranks every other signal, and a
 * budget exhaustion outranks the softer judgements about quality. A rule that fires
 * records its own evidence, and the rules that did not fire are recorded too, so the
 * assessment shows what was ruled out rather than only the winner.
 */
const RULES: readonly Rule[] = [
  {
    decision: "STOP",
    confidence: 0.9,
    factor: "continuation.objective-complete",
    /**
     * The rule that decides whether a STOP is allowed, and it is policy-dependent.
     *
     * v1 requires `taskComplete === true`: the loop's own statement that the objective is done.
     * v0 accepted "nothing unresolved and progress at 1", which a step whose work list does not
     * exist yet satisfies — the measured cause of five false stops.
     */
    matches: (signals, policy) =>
      signals.unresolvedItems === 0 &&
      (CONTINUATION_POLICY_STOP_EVIDENCE[policy] === "TASK_COMPLETE" ? signals.taskComplete === true : atLeast(signals.progress, CONTINUATION_THRESHOLDS.completeProgress)),
    detail: (signals) => `progress ${signalText(signals.progress)} with 0 unresolved items and taskComplete ${signals.taskComplete === undefined ? "not measured" : String(signals.taskComplete)}`,
  },
  {
    decision: "STOP",
    confidence: 0.8,
    factor: "continuation.budget-exhausted",
    matches: (signals) => signals.tokenBudget !== undefined && signals.tokenBudget > 0 && signals.tokensConsumed >= signals.tokenBudget,
    detail: (signals) => `${signals.tokensConsumed} tokens consumed against a budget of ${signals.tokenBudget}`,
  },
  {
    decision: "SWITCH_MODEL",
    confidence: 0.75,
    factor: "continuation.repetition",
    matches: (signals) => atLeast(signals.repeatRate, CONTINUATION_THRESHOLDS.repetitionRate) && atMost(signals.outputNovelty, CONTINUATION_THRESHOLDS.stalledNovelty),
    detail: (signals) => `repeat rate ${signalText(signals.repeatRate)} with output novelty ${signalText(signals.outputNovelty)}`,
  },
  {
    decision: "ASK_REVIEWER",
    confidence: 0.7,
    factor: "continuation.self-contradiction",
    matches: (signals) => atLeast(signals.selfContradictions, CONTINUATION_THRESHOLDS.selfContradictionsForReview),
    detail: (signals) => `${signals.selfContradictions ?? "not measured"} self-contradiction(s) observed`,
  },
  {
    decision: "ASK_REVIEWER",
    confidence: 0.7,
    factor: "continuation.reviewer-disagreement",
    matches: (signals) =>
      signals.reviewerReviews !== undefined && signals.reviewerReviews > 0 && atLeast((signals.reviewerDisagreements ?? 0) / signals.reviewerReviews, CONTINUATION_THRESHOLDS.reviewerDisagreementRate),
    detail: (signals) => `${signals.reviewerDisagreements ?? "not measured"} disagreement(s) across ${signals.reviewerReviews ?? "not measured"} review(s)`,
  },
  {
    decision: "RETRY_WITH_CONTEXT",
    confidence: 0.65,
    factor: "continuation.tool-stalled",
    matches: (signals) => signals.toolProgress === "STALLED" && signals.unresolvedItems > 0,
    detail: (signals) => `tool progress is STALLED with ${signals.unresolvedItems} item(s) still unresolved`,
  },
  {
    decision: "DECOMPOSE_TASK",
    confidence: 0.65,
    factor: "continuation.plan-exhausted",
    matches: (signals) =>
      signals.expectedSteps !== undefined && signals.stepsCompleted >= signals.expectedSteps && signals.unresolvedItems > 0,
    detail: (signals) => `${signals.stepsCompleted} of ${signals.expectedSteps} planned step(s) used with ${signals.unresolvedItems} item(s) unresolved`,
  },
  {
    decision: "DECOMPOSE_TASK",
    confidence: 0.6,
    factor: "continuation.no-progress",
    matches: (signals) =>
      below(signals.progress, CONTINUATION_THRESHOLDS.decomposeProgress) &&
      signals.stepsCompleted >= CONTINUATION_THRESHOLDS.decomposeAfterSteps &&
      atMost(signals.outputNovelty, CONTINUATION_THRESHOLDS.decomposeNovelty) &&
      signals.unresolvedItems > 0,
    detail: (signals) => `${signals.stepsCompleted} step(s) produced progress ${signalText(signals.progress)} and novelty ${signalText(signals.outputNovelty)}`,
  },
  {
    decision: "ASK_REVIEWER",
    confidence: 0.6,
    factor: "continuation.high-uncertainty",
    matches: (signals) =>
      signals.uncertainty !== undefined && signals.uncertainty >= CONTINUATION_THRESHOLDS.uncertaintyForReview && signals.unresolvedItems > 0,
    detail: (signals) => `uncertainty ${signalText(signals.uncertainty)} with ${signals.unresolvedItems} item(s) unresolved`,
  },
  {
    decision: "CONTINUE",
    confidence: 0.5,
    factor: "continuation.work-remaining",
    matches: (signals) => signals.unresolvedItems > 0,
    detail: (signals) => `${signals.unresolvedItems} item(s) remain and no stop condition was met`,
  }
];

/**
 * Evaluates continuation and returns a shadow assessment.
 *
 * When no rule fires — nothing unresolved, but the objective does not report complete
 * either — the advice is `STOP` with an explicit "the signals do not support continuing"
 * reason and a low confidence, rather than a `CONTINUE` that would spend more tokens on a
 * task with nothing left to do.
 */
export function evaluateContinuation(input: { signals: ContinuationSignals; at: string; sequence?: number; policy?: ContinuationPolicyId }): ContinuationAssessment {
  const { signals } = input;
  const policy: ContinuationPolicyId = input.policy ?? DEFAULT_CONTINUATION_POLICY;
  const factors: ReasoningFactor[] = [];
  const fired = RULES.find((rule) => rule.matches(signals, policy));

  for (const rule of RULES) {
    const matched = rule === fired;
    factors.push({
      factor: rule.factor,
      weight: matched ? rule.confidence : 0,
      detail: matched ? `${rule.detail(signals)} -> ${rule.decision}` : `considered and did not fire: ${rule.detail(signals)}`,
      evidence: matched ? [`decision:${rule.decision}`] : []
    });
  }

  if (signals.uncertainty === undefined) {
    factors.push({
      factor: "continuation.uncertainty-not-measured",
      weight: 0,
      detail: "uncertainty was not measured, so it neither triggered nor vetoed any rule",
      evidence: []
    });
  }
  if (signals.tokenBudget === undefined) {
    factors.push({
      factor: "continuation.budget-not-declared",
      weight: 0,
      detail: "no token budget was declared, so the budget rule could not apply",
      evidence: []
    });
  }
  if (signals.expectedSteps === undefined) {
    factors.push({
      factor: "continuation.plan-not-declared",
      weight: 0,
      detail: "no expected step count was declared, so plan exhaustion could not be detected",
      evidence: []
    });
  }
  if (signals.toolProgress === "UNKNOWN") {
    factors.push({
      factor: "continuation.tool-progress-unknown",
      weight: 0,
      detail: "tool progress was not measured, so a stalled tool could not be detected",
      evidence: []
    });
  }

  const decision: ContinuationDecision = fired?.decision ?? CONTINUATION_POLICY_FALLBACK[policy];
  const confidence = round(clamp01(fired?.confidence ?? 0.3));
  const remainingSteps = signals.expectedSteps === undefined ? undefined : signals.expectedSteps - signals.stepsCompleted;

  if (fired === undefined) {
    factors.push({
      factor: "continuation.no-positive-evidence",
      weight: CONTINUATION_POLICY_FALLBACK[policy] === decision ? 0.3 : 0,
      detail:
        CONTINUATION_POLICY_FALLBACK[policy] === "STOP"
          ? "no rule fired, and this policy stops when it has no evidence"
          : "no rule fired and no completion evidence was observed, so this policy continues rather than stopping: STOP requires positive evidence",
      evidence: [`policy:${policy}`]
    });
  }

  const counterfactual = fired
    ? `following this advice would have applied ${decision} at step ${signals.stepsCompleted} with ${signals.unresolvedItems} item(s) unresolved and ${signals.tokensConsumed} tokens spent`
    : decision === "STOP"
      ? `following this advice would have stopped at step ${signals.stepsCompleted} with no completion evidence, which is what this policy does when no rule fires${remainingSteps === undefined ? "" : ` (${remainingSteps} planned step(s) unused)`}`
      : `following this advice would have continued at step ${signals.stepsCompleted}: nothing was unresolved but no completion evidence was observed either, so STOP was not justified${remainingSteps === undefined ? "" : ` (${remainingSteps} planned step(s) unused)`}`;

  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "CONTINUATION_ASSESSMENT",
    assessmentId: stableId("cont", [signals.taskId, signals.modelKey, signals.stepsCompleted, input.sequence ?? 0, policy]),
    taskId: signals.taskId,
    modelKey: signals.modelKey,
    mode: CONTINUATION_MODE,
    decision,
    confidence,
    factors,
    wouldActAtStep: signals.stepsCompleted,
    counterfactual,
    policyId: policy,
    policyHash: continuationPolicyHash(policy),
    createdAt: input.at
  };
}

/**
 * A stable fingerprint of a policy's identity: its id, its fallback decision and its STOP
 * evidence rule, plus the thresholds those rules read.
 *
 * A result is only comparable with another if both name the policy that produced them, and a
 * hash over the rule identity is what makes "the policy changed" detectable rather than
 * remembered.
 */
export function continuationPolicyHash(policy: ContinuationPolicyId): string {
  const text = [
    "continuation-policy-1",
    policy,
    `fallback:${CONTINUATION_POLICY_FALLBACK[policy]}`,
    `stop-evidence:${CONTINUATION_POLICY_STOP_EVIDENCE[policy]}`,
    ...Object.entries(CONTINUATION_THRESHOLDS).map(([key, value]) => `${key}=${value}`),
    ...RULES.map((rule) => `${rule.factor}:${rule.decision}:${rule.confidence}`)
  ].join("\n");
  return sha256Hex(text);
}

/** Whether the assessment would leave the current model in place. */
export function keepsCurrentModel(assessment: ContinuationAssessment): boolean {
  return assessment.decision === "CONTINUE" || assessment.decision === "ASK_REVIEWER";
}

/**
 * Compares a shadow assessment with what the real loop actually did, so the advice can be
 * judged later. This is the whole point of shadow mode: the advice becomes evidence
 * instead of an action.
 */
export interface ContinuationShadowComparison {
  assessmentId: string;
  decision: ContinuationDecision;
  /** What the real loop did instead: "CONTINUED" | "STOPPED" | "SWITCHED" | "UNKNOWN". */
  observed: "CONTINUED" | "STOPPED" | "SWITCHED" | "UNKNOWN";
  agreed: boolean;
  note: string;
}

export function compareContinuationShadow(input: {
  assessment: ContinuationAssessment;
  observed: ContinuationShadowComparison["observed"];
}): ContinuationShadowComparison {
  const { assessment, observed } = input;
  const wouldKeepGoing = keepsCurrentModel(assessment);
  const loopKeptGoing = observed === "CONTINUED";
  const agreed = observed === "UNKNOWN" ? false : wouldKeepGoing === loopKeptGoing;
  const note = observed === "UNKNOWN"
    ? "the real loop's behaviour was not observed, so the advice cannot be judged — this is not agreement and not disagreement"
    : `advice was ${assessment.decision} (${wouldKeepGoing ? "keep the current model" : "leave the current path"}); the loop ${observed.toLowerCase()}`;
  return { assessmentId: assessment.assessmentId, decision: assessment.decision, observed, agreed, note };
}
