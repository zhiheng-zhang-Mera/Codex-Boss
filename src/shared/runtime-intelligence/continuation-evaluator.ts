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

/** The only mode this evaluator has. */
export const CONTINUATION_MODE = "SHADOW_ONLY" as const;

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
  matches: (signals: ContinuationSignals) => boolean;
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
    matches: (signals) => signals.unresolvedItems === 0 && atLeast(signals.progress, CONTINUATION_THRESHOLDS.completeProgress),
    detail: (signals) => `progress ${signalText(signals.progress)} with 0 unresolved items`,
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
export function evaluateContinuation(input: { signals: ContinuationSignals; at: string; sequence?: number }): ContinuationAssessment {
  const { signals } = input;
  const factors: ReasoningFactor[] = [];
  const fired = RULES.find((rule) => rule.matches(signals));

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

  const decision: ContinuationDecision = fired?.decision ?? "STOP";
  const confidence = round(clamp01(fired?.confidence ?? 0.3));
  const remainingSteps = signals.expectedSteps === undefined ? undefined : signals.expectedSteps - signals.stepsCompleted;

  const counterfactual = fired
    ? `following this advice would have applied ${decision} at step ${signals.stepsCompleted} with ${signals.unresolvedItems} item(s) unresolved and ${signals.tokensConsumed} tokens spent`
    : `following this advice would have stopped at step ${signals.stepsCompleted} because nothing was unresolved and no signal supported continuing${remainingSteps === undefined ? "" : ` (${remainingSteps} planned step(s) unused)`}`;

  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "CONTINUATION_ASSESSMENT",
    assessmentId: stableId("cont", [signals.taskId, signals.modelKey, signals.stepsCompleted, input.sequence ?? 0]),
    taskId: signals.taskId,
    modelKey: signals.modelKey,
    mode: CONTINUATION_MODE,
    decision,
    confidence,
    factors,
    wouldActAtStep: signals.stepsCompleted,
    counterfactual,
    createdAt: input.at
  };
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
