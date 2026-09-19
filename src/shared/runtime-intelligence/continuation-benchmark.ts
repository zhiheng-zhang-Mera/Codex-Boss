/**
 * Runtime Intelligence Plane — continuation replay benchmark.
 *
 * Phase K. For every recorded step it compares what the shadow ContinuationEvaluator advised
 * with what the loop actually did, and prices the disagreement asymmetrically — because the
 * plan's rule is that a wrong STOP is worse than a wasted extra round:
 *
 *     false stop cost > unnecessary continue cost
 *
 * `CONTINUATION_PENALTIES` states that ordering as data, so the weighting is reviewable
 * rather than buried in a formula, and a test asserts the ordering directly.
 *
 * The measure the plan asks for by name is `FALSE_STOP_RATE`: of the steps where the shadow
 * advice was STOP, how many were wrong about the task being finished. It is `undefined`, not
 * `0`, when the advice never said STOP — no stops is not a perfect record, it is no record.
 *
 * A step with no observed behaviour is `INCONCLUSIVE` and fires no flag, so an unrecorded
 * step can never be counted as the advice being right.
 */

import type { ContinuationAssessment, ContinuationDecision } from "./contracts";

export const CONTINUATION_OBSERVED = ["CONTINUED", "STOPPED", "SWITCHED", "UNKNOWN"] as const;
export type ContinuationObserved = (typeof CONTINUATION_OBSERVED)[number];

/**
 * The cost of each kind of disagreement.
 *
 * A false stop leaves work undone and can require a human to notice, which is the most
 * expensive failure this evaluator can produce; an unnecessary continue costs one call.
 * The asymmetry is the whole reason this benchmark exists before any execution authority is
 * discussed.
 */
export const CONTINUATION_PENALTIES = {
  falseStop: 5,
  unnecessaryContinue: 1,
  unnecessarySwitch: 2,
  missedDecomposition: 2,
  unnecessaryReview: 1
} as const;

/** Steps needed before the aggregate is called evidence. */
export const MIN_CONTINUATION_STEPS = 10;

export interface ContinuationReplayStep {
  taskId: string;
  /** The step the assessment was made at. */
  step: number;
  assessment: ContinuationAssessment;
  /** What the real loop did after this step. */
  observed: ContinuationObserved;
  /** Whether the task was actually finished at this step. */
  taskComplete: boolean;
  /** Whether the task eventually succeeded. Absent when that was never recorded. */
  taskSucceeded?: boolean;
  /** Whether the loop decomposed the task after this step. */
  decomposed?: boolean;
}

export interface ContinuationStepVerdict {
  taskId: string;
  step: number;
  decision: ContinuationDecision;
  observed: ContinuationObserved;
  judged: boolean;
  /** The plan's named error: the advice said STOP while work remained. */
  falseStop: boolean;
  falseContinue: boolean;
  unnecessarySwitch: boolean;
  missedDecomposition: boolean;
  unnecessaryReview: boolean;
  /** Following a correct STOP would have saved the remaining calls. */
  savedCalls: number;
  penalty: number;
  note: string;
}

/**
 * Judges one step.
 *
 * Every flag needs positive evidence. `taskComplete` alone decides a false stop; an
 * unnecessary switch additionally needs the loop to have succeeded without it, so a switch
 * the loop ignored and then failed on is not called unnecessary.
 */
export function judgeContinuationStep(input: ContinuationReplayStep): ContinuationStepVerdict {
  const decision = input.assessment.decision;
  const base = { taskId: input.taskId, step: input.step, decision, observed: input.observed, falseStop: false, falseContinue: false, unnecessarySwitch: false, missedDecomposition: false, unnecessaryReview: false, savedCalls: 0, penalty: 0 };

  if (input.observed === "UNKNOWN") {
    return { ...base, judged: false, note: "the loop's behaviour after this step was not recorded, so the advice is not judged" };
  }

  const falseStop = decision === "STOP" && !input.taskComplete;
  const falseContinue = decision === "CONTINUE" && input.taskComplete;
  const unnecessarySwitch = decision === "SWITCH_MODEL" && input.observed === "CONTINUED" && input.taskSucceeded === true;
  const missedDecomposition = decision === "DECOMPOSE_TASK" && input.decomposed !== true && input.taskSucceeded === false;
  const unnecessaryReview = decision === "ASK_REVIEWER" && input.taskSucceeded === true;
  const savedCalls = decision === "STOP" && input.taskComplete ? 1 : 0;

  const penalty =
    (falseStop ? CONTINUATION_PENALTIES.falseStop : 0) +
    (falseContinue ? CONTINUATION_PENALTIES.unnecessaryContinue : 0) +
    (unnecessarySwitch ? CONTINUATION_PENALTIES.unnecessarySwitch : 0) +
    (missedDecomposition ? CONTINUATION_PENALTIES.missedDecomposition : 0) +
    (unnecessaryReview ? CONTINUATION_PENALTIES.unnecessaryReview : 0);

  const note = falseStop
    ? "FALSE STOP: the advice was to stop while work remained, which the plan prices as the most expensive error"
    : falseContinue
      ? "the advice was to continue a task that was already finished, which cost one call"
      : unnecessarySwitch
        ? "the advice was to switch models but the loop stayed and succeeded"
        : missedDecomposition
          ? "the advice was to decompose and the loop neither decomposed nor succeeded"
          : unnecessaryReview
            ? "the advice was to ask a reviewer on a task that succeeded"
            : savedCalls > 0
              ? "the advice was to stop a finished task, which is where the saving comes from"
              : "the advice agreed with what the loop did";

  return { ...base, judged: true, falseStop, falseContinue, unnecessarySwitch, missedDecomposition, unnecessaryReview, savedCalls, penalty, note };
}

export interface ContinuationBenchmarkMetrics {
  steps: number;
  judgedSteps: number;
  decisions: Record<ContinuationDecision, number>;
  /** Steps where the shadow advice was STOP. The denominator of the false-stop rate. */
  stopsAdvised: number;
  falseStopCount: number;
  /** `undefined` when the advice never said STOP: no stops is not a perfect record. */
  falseStopRate: number | undefined;
  falseContinueCount: number;
  unnecessaryContinueRate: number | undefined;
  unnecessarySwitchCount: number;
  /** `undefined` when the advice never said SWITCH_MODEL. */
  switchModelErrorRate: number | undefined;
  missedDecompositionCount: number;
  falseReviewCount: number;
  /** The asymmetric cost of every disagreement, summed. */
  weightedPenalty: number;
  /** The independent costs, so a reader can see which one is driving the total. */
  penaltyByKind: { falseStop: number; unnecessaryContinue: number; unnecessarySwitch: number; missedDecomposition: number; unnecessaryReview: number };
  /** Steps where following a correct STOP would have saved a call. */
  estimatedCallsSaved: number;
  reason: "OK" | "INSUFFICIENT_EVIDENCE";
  notes: string[];
}

function emptyDecisions(): Record<ContinuationDecision, number> {
  return { CONTINUE: 0, STOP: 0, SWITCH_MODEL: 0, ASK_REVIEWER: 0, DECOMPOSE_TASK: 0, RETRY_WITH_CONTEXT: 0 };
}

/**
 * Benchmarks a continuation replay.
 *
 * A false stop is reported both as a count and as a rate, and the weighted penalty is
 * reported alongside the per-kind breakdown so the asymmetry is visible in the output rather
 * than only in this file's constants.
 */
export function benchmarkContinuation(steps: readonly ContinuationReplayStep[], options: { minimum?: number } = {}): ContinuationBenchmarkMetrics {
  const minimum = options.minimum ?? MIN_CONTINUATION_STEPS;
  const decisions = emptyDecisions();
  const penaltyByKind = { falseStop: 0, unnecessaryContinue: 0, unnecessarySwitch: 0, missedDecomposition: 0, unnecessaryReview: 0 };
  let judgedSteps = 0;
  let stopsAdvised = 0;
  let falseStopCount = 0;
  let falseContinueCount = 0;
  let unnecessarySwitchCount = 0;
  let missedDecompositionCount = 0;
  let falseReviewCount = 0;
  let weightedPenalty = 0;
  let estimatedCallsSaved = 0;
  let switchesAdvised = 0;

  for (const step of steps) {
    decisions[step.assessment.decision] += 1;
    const verdict = judgeContinuationStep(step);
    if (!verdict.judged) continue;
    judgedSteps += 1;
    weightedPenalty += verdict.penalty;
    estimatedCallsSaved += verdict.savedCalls;
    if (step.assessment.decision === "STOP") stopsAdvised += 1;
    if (step.assessment.decision === "SWITCH_MODEL") switchesAdvised += 1;
    if (verdict.falseStop) {
      falseStopCount += 1;
      penaltyByKind.falseStop += CONTINUATION_PENALTIES.falseStop;
    }
    if (verdict.falseContinue) {
      falseContinueCount += 1;
      penaltyByKind.unnecessaryContinue += CONTINUATION_PENALTIES.unnecessaryContinue;
    }
    if (verdict.unnecessarySwitch) {
      unnecessarySwitchCount += 1;
      penaltyByKind.unnecessarySwitch += CONTINUATION_PENALTIES.unnecessarySwitch;
    }
    if (verdict.missedDecomposition) {
      missedDecompositionCount += 1;
      penaltyByKind.missedDecomposition += CONTINUATION_PENALTIES.missedDecomposition;
    }
    if (verdict.unnecessaryReview) {
      falseReviewCount += 1;
      penaltyByKind.unnecessaryReview += CONTINUATION_PENALTIES.unnecessaryReview;
    }
  }

  const rate = (numerator: number, denominator: number): number | undefined => (denominator === 0 ? undefined : Math.round((numerator / denominator) * 10000) / 10000);
  const notes: string[] = [];
  if (judgedSteps < minimum) notes.push(`${judgedSteps} judged step(s) is below the ${minimum} needed for a benchmark verdict`);
  if (steps.length > judgedSteps) notes.push(`${steps.length - judgedSteps} step(s) had no recorded behaviour and are excluded`);
  if (stopsAdvised === 0 && steps.length > 0) notes.push("the shadow advice never said STOP in this corpus, so no false-stop rate exists");
  if (falseStopCount > 0) notes.push(`${falseStopCount} false stop(s) at a cost of ${CONTINUATION_PENALTIES.falseStop} each`);

  return {
    steps: steps.length,
    judgedSteps,
    decisions,
    stopsAdvised,
    falseStopCount,
    falseStopRate: rate(falseStopCount, stopsAdvised),
    falseContinueCount,
    unnecessaryContinueRate: rate(falseContinueCount, judgedSteps),
    unnecessarySwitchCount,
    switchModelErrorRate: rate(unnecessarySwitchCount, switchesAdvised),
    missedDecompositionCount,
    falseReviewCount,
    weightedPenalty,
    penaltyByKind,
    estimatedCallsSaved,
    reason: judgedSteps >= minimum ? "OK" : "INSUFFICIENT_EVIDENCE",
    notes
  };
}

/**
 * A like-for-like comparison of two continuation policies over the SAME steps.
 *
 * This is how the benchmark avoids grading the evaluator against itself: the shadow policy is
 * scored against the cost of what actually happened, and a deliberately worse or better
 * policy is scored over the identical corpus. The asymmetric penalties are what make the
 * comparison faithful to the plan's rule.
 */
export function compareContinuationPenalty(left: readonly ContinuationReplayStep[], right: readonly ContinuationReplayStep[]): { left: number; right: number; difference: number } {
  const leftMetrics = benchmarkContinuation(left);
  const rightMetrics = benchmarkContinuation(right);
  return { left: leftMetrics.weightedPenalty, right: rightMetrics.weightedPenalty, difference: leftMetrics.weightedPenalty - rightMetrics.weightedPenalty };
}
