import { describe, expect, it } from "vitest";
import {
  CONTINUATION_OBSERVED,
  CONTINUATION_PENALTIES,
  MIN_CONTINUATION_STEPS,
  benchmarkContinuation as benchmarkContinuationRaw,
  compareContinuationPenalty,
  judgeContinuationStep as judgeContinuationStepRaw,
  type ContinuationBenchmarkMetrics,
  type ContinuationObserved,
  type ContinuationReplayStep,
  type ContinuationStepVerdict
} from "../../../src/shared/runtime-intelligence/continuation-benchmark";
import { DEFAULT_CONTINUATION_POLICY, continuationPolicyHash } from "../../../src/shared/runtime-intelligence/continuation-evaluator";

/**
 * Every step below declares what its shadow assessment was allowed to see, because the temporal
 * guard refuses to judge a step whose advice cannot be shown to be at-decision-time.
 */
const DECLARED_INPUT = { fields: ["stepIndex", "unresolvedCount", "completedCount", "tokensConsumed", "elapsedMs"], label: "the shadow advice" } as const;

function withDeclaration(entry: ContinuationReplayStep): ContinuationReplayStep {
  return entry.inputDeclaration === undefined ? { ...entry, inputDeclaration: DECLARED_INPUT } : entry;
}

const judgeContinuationStep = (entry: ContinuationReplayStep): ContinuationStepVerdict => judgeContinuationStepRaw(withDeclaration(entry));
const benchmarkContinuation = (steps: readonly ContinuationReplayStep[], options?: { minimum?: number }): ContinuationBenchmarkMetrics => benchmarkContinuationRaw(steps.map(withDeclaration), options);
import { evaluateContinuation } from "../../../src/shared/runtime-intelligence/continuation-evaluator";
import type { ContinuationAssessment, ContinuationDecision, ContinuationSignals } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase K. The plan's rule is that a wrong STOP is the expensive error, so the tests assert
 * the asymmetry itself, assert that an obvious false stop is priced as severe, and assert that
 * a step nobody observed is neither counted as support nor as an error.
 */

const AT = "2026-01-01T00:00:00.000Z";

function assessment(decision: ContinuationDecision, overrides: Partial<ContinuationAssessment> = {}): ContinuationAssessment {
  return {
    schemaVersion: 1,
    kind: "CONTINUATION_ASSESSMENT",
    assessmentId: `cont-${decision}`,
    taskId: "task-1",
    modelKey: "m",
    mode: "SHADOW_ONLY",
    decision,
    confidence: 0.6,
    factors: [],
    wouldActAtStep: 3,
    counterfactual: "shadow only",
    policyId: DEFAULT_CONTINUATION_POLICY,
    policyHash: continuationPolicyHash(DEFAULT_CONTINUATION_POLICY),
    createdAt: AT,
    ...overrides
  };
}

/** An assessment produced by the BASELINE policy, for the false-stop controls. */
function baselineAssessment(decision: ContinuationDecision): ContinuationAssessment {
  return assessment(decision, { policyId: "continuation-policy-v0", policyHash: continuationPolicyHash("continuation-policy-v0") });
}

function step(overrides: Partial<ContinuationReplayStep> & { decision: ContinuationDecision }): ContinuationReplayStep {
  return {
    taskId: "task-1",
    step: 1,
    assessment: assessment(overrides.decision),
    observed: "CONTINUED",
    taskComplete: false,
    inputDeclaration: DECLARED_INPUT,
    ...overrides
  };
}

function repeats(count: number, overrides: Omit<Partial<ContinuationReplayStep>, "decision"> & { decision: ContinuationDecision }): ContinuationReplayStep[] {
  return Array.from({ length: count }, (_, index) => step({ ...overrides, step: index + 1, taskId: `task-${index}` }));
}

describe("the asymmetric penalty is stated as data", () => {
  it("prices a false stop above an unnecessary continue", () => {
    expect(CONTINUATION_PENALTIES.falseStop).toBeGreaterThan(CONTINUATION_PENALTIES.unnecessaryContinue);
    expect(CONTINUATION_PENALTIES.falseStop).toBeGreaterThan(CONTINUATION_PENALTIES.unnecessarySwitch);
  });

  it("costs one false stop five times one unnecessary continue", () => {
    const falseStop: ContinuationStepVerdict = judgeContinuationStep(step({ decision: "STOP", taskComplete: false, observed: "CONTINUED" }));
    const falseContinue: ContinuationStepVerdict = judgeContinuationStep(step({ decision: "CONTINUE", taskComplete: true, observed: "STOPPED" }));
    expect(falseStop.falseStop).toBe(true);
    expect(falseStop.penalty).toBe(CONTINUATION_PENALTIES.falseStop);
    expect(falseContinue.falseContinue).toBe(true);
    expect(falseContinue.penalty).toBe(CONTINUATION_PENALTIES.unnecessaryContinue);
    expect(falseStop.penalty / falseContinue.penalty).toBe(5);
  });
});

describe("an obvious false stop is counted as a severe error", () => {
  it("flags a STOP on a task with work left, and says why it is the worst error", () => {
    const verdict = judgeContinuationStep(step({ decision: "STOP", taskComplete: false, observed: "CONTINUED" }));
    expect(verdict.judged).toBe(true);
    expect(verdict.falseStop).toBe(true);
    expect(verdict.falseContinue).toBe(false);
    expect(verdict.note).toContain("FALSE STOP");
    expect(verdict.note).toContain("most expensive error");
  });

  it("does not flag a STOP on a finished task, and counts the call it saved", () => {
    const verdict = judgeContinuationStep(step({ decision: "STOP", taskComplete: true, observed: "STOPPED" }));
    expect(verdict.falseStop).toBe(false);
    expect(verdict.savedCalls).toBe(1);
    expect(verdict.penalty).toBe(0);
    expect(verdict.note).toContain("where the saving comes from");
  });

  it("reports the false-stop RATE over the steps where STOP was advised", () => {
    const steps = [...repeats(3, { decision: "STOP", taskComplete: false, observed: "CONTINUED" }), ...repeats(1, { decision: "STOP", taskComplete: true, observed: "STOPPED" })];
    const metrics: ContinuationBenchmarkMetrics = benchmarkContinuation(steps);
    expect(metrics.stopsAdvised).toBe(4);
    expect(metrics.falseStopCount).toBe(3);
    expect(metrics.falseStopRate).toBe(0.75);
    expect(metrics.penaltyByKind.falseStop).toBe(3 * CONTINUATION_PENALTIES.falseStop);
    expect(metrics.weightedPenalty).toBe(15);
    expect(metrics.estimatedCallsSaved).toBe(1);
    expect(metrics.notes.join(" ")).toContain("3 false stop(s)");
  });

  it("returns no false-stop rate when the advice never said STOP", () => {
    const metrics = benchmarkContinuation(repeats(12, { decision: "CONTINUE" }));
    expect(metrics.stopsAdvised).toBe(0);
    expect(metrics.falseStopCount).toBe(0);
    expect(metrics.falseStopRate).toBeUndefined();
    expect(metrics.notes.join(" ")).toContain("never said STOP");
  });
});

describe("a step nobody observed is neither support nor error", () => {
  it("leaves an unrecorded step unjudged and fires no flag", () => {
    const verdict: ContinuationStepVerdict = judgeContinuationStep(step({ decision: "CONTINUE", observed: "UNKNOWN", taskComplete: true }));
    expect(verdict.judged).toBe(false);
    expect(verdict.falseContinue).toBe(false);
    expect(verdict.falseStop).toBe(false);
    expect(verdict.savedCalls).toBe(0);
    expect(verdict.penalty).toBe(0);
    expect(verdict.note).toContain("not recorded");
  });

  it("never claims an unobserved step supported the advice", () => {
    const metrics = benchmarkContinuation(repeats(12, { decision: "STOP", observed: "UNKNOWN", taskComplete: false }));
    expect(metrics.steps).toBe(12);
    expect(metrics.judgedSteps).toBe(0);
    expect(metrics.falseStopCount).toBe(0);
    expect(metrics.falseStopRate).toBeUndefined();
    expect(metrics.weightedPenalty).toBe(0);
    expect(metrics.reason).toBe("INSUFFICIENT_EVIDENCE");
    expect(metrics.notes.join(" ")).toContain("no recorded behaviour");
  });

  it("excludes only the unobserved steps from a mixed corpus", () => {
    const steps = [...repeats(10, { decision: "CONTINUE", observed: "CONTINUED", taskComplete: false }), ...repeats(2, { decision: "CONTINUE", observed: "UNKNOWN" })];
    const metrics = benchmarkContinuation(steps);
    expect(metrics.steps).toBe(12);
    expect(metrics.judgedSteps).toBe(10);
    expect(metrics.reason).toBe("OK");
    expect(metrics.notes.join(" ")).toContain("2 step(s) had no recorded behaviour");
  });
});

describe("the other disagreement kinds are distinguished", () => {
  it("flags an unnecessary switch only when the loop stayed and succeeded", () => {
    const unnecessary = judgeContinuationStep(step({ decision: "SWITCH_MODEL", observed: "CONTINUED", taskSucceeded: true }));
    expect(unnecessary.unnecessarySwitch).toBe(true);
    expect(unnecessary.penalty).toBe(CONTINUATION_PENALTIES.unnecessarySwitch);
    const justified = judgeContinuationStep(step({ decision: "SWITCH_MODEL", observed: "CONTINUED", taskSucceeded: false }));
    expect(justified.unnecessarySwitch).toBe(false);
    const applied = judgeContinuationStep(step({ decision: "SWITCH_MODEL", observed: "SWITCHED", taskSucceeded: true }));
    expect(applied.unnecessarySwitch).toBe(false);
  });

  it("flags a missed decomposition only when the loop neither decomposed nor succeeded", () => {
    const missed = judgeContinuationStep(step({ decision: "DECOMPOSE_TASK", observed: "CONTINUED", decomposed: false, taskSucceeded: false }));
    expect(missed.missedDecomposition).toBe(true);
    const applied = judgeContinuationStep(step({ decision: "DECOMPOSE_TASK", observed: "CONTINUED", decomposed: true, taskSucceeded: false }));
    expect(applied.missedDecomposition).toBe(false);
    const unnecessary = judgeContinuationStep(step({ decision: "DECOMPOSE_TASK", observed: "CONTINUED", decomposed: false, taskSucceeded: true }));
    expect(unnecessary.missedDecomposition).toBe(false);
  });

  it("flags an unnecessary review on a task that succeeded", () => {
    const verdict = judgeContinuationStep(step({ decision: "ASK_REVIEWER", observed: "CONTINUED", taskSucceeded: true }));
    expect(verdict.unnecessaryReview).toBe(true);
    expect(verdict.penalty).toBe(CONTINUATION_PENALTIES.unnecessaryReview);
  });

  it("counts the switch error rate over the switches advised", () => {
    const steps = [...repeats(2, { decision: "SWITCH_MODEL", observed: "CONTINUED", taskSucceeded: true }), ...repeats(2, { decision: "SWITCH_MODEL", observed: "SWITCHED", taskSucceeded: true })];
    const metrics = benchmarkContinuation(steps);
    expect(metrics.decisions.SWITCH_MODEL).toBe(4);
    expect(metrics.unnecessarySwitchCount).toBe(2);
    expect(metrics.switchModelErrorRate).toBe(0.5);
  });

  it("counts every decision, including the ones with no error", () => {
    const steps = [...repeats(2, { decision: "CONTINUE" }), ...repeats(2, { decision: "RETRY_WITH_CONTEXT" })];
    const metrics = benchmarkContinuation(steps);
    expect(metrics.decisions.CONTINUE).toBe(2);
    expect(metrics.decisions.RETRY_WITH_CONTEXT).toBe(2);
    expect(metrics.weightedPenalty).toBe(0);
  });

  it("reports undefined rates rather than zero for an empty corpus", () => {
    const metrics = benchmarkContinuation([]);
    expect(metrics.steps).toBe(0);
    expect(metrics.falseStopRate).toBeUndefined();
    expect(metrics.unnecessaryContinueRate).toBeUndefined();
    expect(metrics.switchModelErrorRate).toBeUndefined();
    expect(metrics.reason).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("needs enough judged steps before it will call itself evidence", () => {
    expect(benchmarkContinuation(repeats(MIN_CONTINUATION_STEPS - 1, { decision: "CONTINUE" })).reason).toBe("INSUFFICIENT_EVIDENCE");
    expect(benchmarkContinuation(repeats(MIN_CONTINUATION_STEPS, { decision: "CONTINUE" })).reason).toBe("OK");
  });
});

describe("the benchmark scores the real evaluator's own output", () => {
  function signals(overrides: Partial<ContinuationSignals> = {}): ContinuationSignals {
    return {
      taskId: "task-1",
      modelKey: "m",
      progress: 0.5,
      outputNovelty: 0.5,
      unresolvedItems: 2,
      resolvedItems: 1,
      tokensConsumed: 100,
      elapsedMs: 1000,
      repeatRate: 0.1,
      selfContradictions: 0,
      reviewerDisagreements: 0,
      reviewerReviews: 0,
      toolProgress: "PROGRESSING",
      stepsCompleted: 2,
      ...overrides
    };
  }

  it("prices a real repeating-loop assessment that the loop ignored", () => {
    // The evaluator says SWITCH_MODEL because the model is looping; the loop stayed and failed.
    const real = evaluateContinuation({ signals: signals({ repeatRate: 0.95, outputNovelty: 0, stepsCompleted: 4 }), at: AT });
    expect(real.decision).toBe("SWITCH_MODEL");
    const verdict = judgeContinuationStep({ taskId: "task-1", step: 4, assessment: real, observed: "CONTINUED", taskComplete: false, taskSucceeded: false });
    expect(verdict.unnecessarySwitch).toBe(false);
    expect(verdict.penalty).toBe(0);
    expect(verdict.judged).toBe(true);
  });

  it("prices a real STOP on an unfinished task as the expensive error", () => {
    // Produced by the BASELINE policy, which stopped when it had no evidence — the measured
    // defect. The candidate policy would not stop here at all, which is the correction.
    const real = evaluateContinuation({ signals: signals({ progress: 1, unresolvedItems: 0 }), at: AT, policy: "continuation-policy-v0" });
    expect(real.decision).toBe("STOP");
    expect(real.policyId).toBe("continuation-policy-v0");
    const verdict = judgeContinuationStep({ taskId: "task-1", step: 6, assessment: real, observed: "CONTINUED", taskComplete: false });
    expect(verdict.falseStop).toBe(true);
    expect(verdict.penalty).toBe(CONTINUATION_PENALTIES.falseStop);
  });

  it("does not produce that false stop under the candidate policy", () => {
    const candidate = evaluateContinuation({ signals: signals({ progress: 1, unresolvedItems: 0 }), at: AT });
    expect(candidate.decision).toBe("CONTINUE");
    expect(candidate.policyId).toBe(DEFAULT_CONTINUATION_POLICY);
    const verdict = judgeContinuationStep({ taskId: "task-1", step: 6, assessment: candidate, observed: "CONTINUED", taskComplete: false });
    expect(verdict.falseStop).toBe(false);
    expect(verdict.penalty).toBe(0);
  });

  it("compares two policies over the same corpus and reports the difference", () => {
    const good = repeats(12, { decision: "CONTINUE", observed: "CONTINUED", taskComplete: false });
    const bad = repeats(12, { decision: "STOP", observed: "CONTINUED", taskComplete: false });
    const comparison = compareContinuationPenalty(good, bad);
    expect(comparison.left).toBe(0);
    expect(comparison.right).toBe(12 * CONTINUATION_PENALTIES.falseStop);
    expect(comparison.difference).toBeLessThan(0);
    expect(CONTINUATION_OBSERVED).toContain<ContinuationObserved>("UNKNOWN");
  });
});
