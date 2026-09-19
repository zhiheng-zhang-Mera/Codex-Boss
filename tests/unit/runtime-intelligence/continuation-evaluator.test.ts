import { describe, expect, it } from "vitest";
import * as continuation from "../../../src/shared/runtime-intelligence/continuation-evaluator";
import {
  CONTINUATION_MODE,
  CONTINUATION_POLICIES,
  CONTINUATION_POLICY_FALLBACK,
  CONTINUATION_THRESHOLDS,
  DEFAULT_CONTINUATION_POLICY,
  compareContinuationShadow,
  continuationPolicyHash,
  evaluateContinuation,
  keepsCurrentModel,
  type ContinuationShadowComparison
} from "../../../src/shared/runtime-intelligence/continuation-evaluator";
import type { ContinuationAssessment, ContinuationSignals } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase E. Three claims are asserted:
 *
 *   - obvious repetition is recognised (`SWITCH_MODEL`) rather than continued;
 *   - an obviously unfinished task is not reported as complete — a `STOP` requires
 *     nothing left unresolved;
 *   - every assessment is a SHADOW decision, and the module has no export that could
 *     stop, abort or restart anything.
 */

const AT = "2026-01-01T00:00:00.000Z";

function signals(overrides: Partial<ContinuationSignals> = {}): ContinuationSignals {
  return {
    taskId: "task-1",
    modelKey: "vendor:family:1",
    progress: 0.5,
    outputNovelty: 0.5,
    unresolvedItems: 2,
    resolvedItems: 3,
    tokensConsumed: 1000,
    elapsedMs: 60_000,
    repeatRate: 0.1,
    selfContradictions: 0,
    reviewerDisagreements: 0,
    reviewerReviews: 0,
    toolProgress: "PROGRESSING",
    stepsCompleted: 2,
    ...overrides
  };
}

function assess(overrides: Partial<ContinuationSignals> = {}): ContinuationAssessment {
  return evaluateContinuation({ signals: signals(overrides), at: AT });
}

describe("obvious repetition is recognised", () => {
  it("advises SWITCH_MODEL when the model repeats itself with no new output", () => {
    const assessment = assess({ repeatRate: 0.95, outputNovelty: 0.02 });
    expect(assessment.decision).toBe("SWITCH_MODEL");
    expect(assessment.factors.find((factor) => factor.factor === "continuation.repetition")?.weight).toBeGreaterThan(0);
    expect(assessment.factors.find((factor) => factor.factor === "continuation.repetition")?.detail).toContain("repeat rate 0.95");
  });

  it("does not switch on repetition alone when the output is still novel", () => {
    const assessment = assess({ repeatRate: 0.95, outputNovelty: 0.8 });
    expect(assessment.decision).not.toBe("SWITCH_MODEL");
  });

  it("quotes the threshold it applied", () => {
    expect(CONTINUATION_THRESHOLDS.repetitionRate).toBe(0.8);
    expect(CONTINUATION_THRESHOLDS.stalledNovelty).toBe(0.1);
  });
});

describe("unfinished work is not reported as complete", () => {
  it("never advises STOP while items remain unresolved", () => {
    const assessment = assess({ unresolvedItems: 4, progress: 0.99 });
    expect(assessment.decision).not.toBe("STOP");
    expect(assessment.decision).toBe("CONTINUE");
  });

  it("advises DECOMPOSE_TASK when the declared plan is exhausted with work left", () => {
    const assessment = assess({ expectedSteps: 6, stepsCompleted: 6, unresolvedItems: 3 });
    expect(assessment.decision).toBe("DECOMPOSE_TASK");
    expect(assessment.factors.find((factor) => factor.factor === "continuation.plan-exhausted")?.detail).toContain("6 of 6");
  });

  it("advises DECOMPOSE_TASK when many steps produce neither progress nor novelty", () => {
    const assessment = assess({ stepsCompleted: 8, progress: 0.05, outputNovelty: 0.05, unresolvedItems: 5 });
    expect(assessment.decision).toBe("DECOMPOSE_TASK");
  });

  it("advises STOP only when the objective is complete and nothing is unresolved", () => {
    const assessment = assess({ progress: 1, unresolvedItems: 0, taskComplete: true });
    expect(assessment.decision).toBe("STOP");
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("does NOT stop on progress alone, because progress is not completion evidence", () => {
    // This is the measured defect: `progress === 1` with nothing unresolved was satisfied by a
    // step whose work list did not exist yet, and the policy stopped a task with work left.
    const assessment = assess({ progress: 1, unresolvedItems: 0, taskComplete: false });
    expect(assessment.decision).toBe("CONTINUE");
    expect(assessment.factors.find((factor) => factor.factor === "continuation.no-positive-evidence")?.detail).toContain("STOP requires positive evidence");
  });

  it("does not stop when the loop did not say whether the task is complete", () => {
    const assessment = assess({ progress: 1, unresolvedItems: 0 });
    expect(assessment.decision).toBe("CONTINUE");
    const factor = assessment.factors.find((entry) => entry.factor === "continuation.objective-complete");
    expect(factor?.detail).toContain("taskComplete not measured");
  });

  it("defaults to CONTINUE with low confidence when no rule fires, and says why", () => {
    const assessment = assess({ progress: 0.5, unresolvedItems: 0 });
    expect(assessment.decision).toBe("CONTINUE");
    expect(assessment.confidence).toBeLessThan(0.5);
    expect(assessment.counterfactual).toContain("STOP was not justified");
    expect(assessment.factors.map((factor) => factor.factor)).toContain("continuation.no-positive-evidence");
  });

  it("keeps the baseline policy's STOP fallback runnable, so the defect can be re-measured", () => {
    const baseline = evaluateContinuation({ signals: signals({ progress: 0.5, unresolvedItems: 0 }), at: AT, policy: "continuation-policy-v0" });
    const candidate = evaluateContinuation({ signals: signals({ progress: 0.5, unresolvedItems: 0 }), at: AT });
    expect(baseline.decision).toBe("STOP");
    expect(candidate.decision).toBe("CONTINUE");
    expect(baseline.policyId).toBe("continuation-policy-v0");
    expect(candidate.policyId).toBe("continuation-policy-v1");
    expect(baseline.policyHash).not.toBe(candidate.policyHash);
    expect(DEFAULT_CONTINUATION_POLICY).toBe("continuation-policy-v1");
    expect(CONTINUATION_POLICY_FALLBACK["continuation-policy-v0"]).toBe("STOP");
    expect(CONTINUATION_POLICY_FALLBACK["continuation-policy-v1"]).toBe("CONTINUE");
  });

  it("names its policy and a stable hash on every assessment", () => {
    const assessment = assess({ unresolvedItems: 2 });
    expect(CONTINUATION_POLICIES).toContain(assessment.policyId);
    expect(assessment.policyHash).toHaveLength(64);
    expect(continuationPolicyHash("continuation-policy-v1")).toBe(assessment.policyHash);
    expect(continuationPolicyHash("continuation-policy-v0")).not.toBe(assessment.policyHash);
  });

  it("stops on an exhausted budget even with work left, and says which rule fired", () => {
    const assessment = assess({ tokenBudget: 1000, tokensConsumed: 1000, unresolvedItems: 5 });
    expect(assessment.decision).toBe("STOP");
    expect(assessment.factors.find((factor) => factor.factor === "continuation.budget-exhausted")?.weight).toBeGreaterThan(0);
  });

  it("documents the replaced behaviour: the baseline policy stopped with nothing unresolved", () => {
    // Kept as a policy-parameterised case rather than deleted, because this IS the defect the
    // real corpus measured and the comparison needs it reproducible.
    const baseline = evaluateContinuation({ signals: signals({ progress: 0.5, unresolvedItems: 0 }), at: AT, policy: "continuation-policy-v0" });
    expect(baseline.decision).toBe("STOP");
    expect(baseline.confidence).toBeLessThan(0.5);
    expect(baseline.counterfactual).toContain("no completion evidence");
  });
});

describe("the remaining decisions are reachable", () => {
  it("asks a reviewer after repeated self-contradiction", () => {
    expect(assess({ selfContradictions: 2 }).decision).toBe("ASK_REVIEWER");
    expect(assess({ selfContradictions: 1 }).decision).not.toBe("ASK_REVIEWER");
  });

  it("asks a reviewer when the reviewers themselves disagree", () => {
    expect(assess({ reviewerReviews: 4, reviewerDisagreements: 3 }).decision).toBe("ASK_REVIEWER");
    expect(assess({ reviewerReviews: 4, reviewerDisagreements: 1 }).decision).not.toBe("ASK_REVIEWER");
  });

  it("retries with context when a tool has stalled with work left", () => {
    expect(assess({ toolProgress: "STALLED", unresolvedItems: 2 }).decision).toBe("RETRY_WITH_CONTEXT");
    expect(assess({ toolProgress: "STALLED", unresolvedItems: 0, progress: 0.4 }).decision).not.toBe("RETRY_WITH_CONTEXT");
  });

  it("asks a reviewer under high measured uncertainty with work left", () => {
    expect(assess({ uncertainty: 0.9, unresolvedItems: 1 }).decision).toBe("ASK_REVIEWER");
    expect(assess({ uncertainty: 0.9, unresolvedItems: 0, progress: 0.4 }).decision).not.toBe("ASK_REVIEWER");
  });

  it("continues when there is measured work left and no stop condition", () => {
    expect(assess({ unresolvedItems: 3 }).decision).toBe("CONTINUE");
    expect(keepsCurrentModel(assess({ unresolvedItems: 3 }))).toBe(true);
  });
});

describe("unmeasured signals neither trigger nor veto a rule", () => {
  it("records that uncertainty was not measured", () => {
    const assessment = assess();
    expect(assessment.factors.find((factor) => factor.factor === "continuation.uncertainty-not-measured")?.detail).toContain("neither triggered nor vetoed");
  });

  it("records an undeclared budget, plan and tool progress as not applicable", () => {
    const factors = assess({ toolProgress: "UNKNOWN" }).factors.map((factor) => factor.factor);
    expect(factors).toContain("continuation.budget-not-declared");
    expect(factors).toContain("continuation.plan-not-declared");
    expect(factors).toContain("continuation.tool-progress-unknown");
  });

  it("records every rule it considered, including the ones that did not fire", () => {
    const factors = assess({ unresolvedItems: 3 }).factors;
    expect(factors.length).toBeGreaterThan(3);
    const notFired = factors.filter((factor) => factor.detail.startsWith("considered and did not fire"));
    expect(notFired.length).toBeGreaterThan(0);
    for (const factor of notFired) expect(factor.weight).toBe(0);
  });
});

describe("every assessment is a shadow decision", () => {
  it("declares SHADOW_ONLY whatever the decision is", () => {
    const cases: Array<Partial<ContinuationSignals>> = [
      { progress: 1, unresolvedItems: 0 },
      { repeatRate: 0.95, outputNovelty: 0 },
      { toolProgress: "STALLED" },
      { selfContradictions: 3 },
      { unresolvedItems: 1 },
      {}
    ];
    for (const overrides of cases) {
      const assessment = assess(overrides);
      expect(assessment.mode).toBe(CONTINUATION_MODE);
      expect(assessment.mode).toBe("SHADOW_ONLY");
      expect(assessment.kind).toBe("CONTINUATION_ASSESSMENT");
    }
  });

  it("exports nothing that could stop, abort, restart or otherwise act", () => {
    const acting = Object.keys(continuation).filter((name) => /^(stop|abort|kill|cancel|terminate|restart|apply|execute|enforce)/i.test(name));
    expect(acting, `this module must only advise: ${acting.join(", ")}`).toEqual([]);
  });

  it("fires that control: an acting export WOULD be caught", () => {
    const probe = { stopTask: () => undefined, executeDecision: () => undefined, evaluateContinuation: () => undefined };
    const acting = Object.keys(probe).filter((name) => /^(stop|abort|kill|cancel|terminate|restart|apply|execute|enforce)/i.test(name));
    expect(acting).toEqual(["stopTask", "executeDecision"]);
  });

  it("carries the step it would have acted at and a counterfactual", () => {
    const assessment = assess({ stepsCompleted: 7, unresolvedItems: 2 });
    expect(assessment.wouldActAtStep).toBe(7);
    expect(assessment.counterfactual).toContain("step 7");
    expect(assessment.counterfactual).toContain("would have applied");
  });

  it("names an id derived from the task, model and step", () => {
    const assessment = assess({ stepsCompleted: 3 });
    expect(assessment.assessmentId.startsWith("cont-")).toBe(true);
    expect(assessment.assessmentId).toBe(evaluateContinuation({ signals: signals({ stepsCompleted: 3 }), at: AT }).assessmentId);
    expect(assessment.assessmentId).not.toBe(evaluateContinuation({ signals: signals({ stepsCompleted: 4 }), at: AT }).assessmentId);
  });
});

describe("the shadow decision can be compared with what actually happened", () => {
  it("reports agreement when the loop continued and the advice was to continue", () => {
    const comparison: ContinuationShadowComparison = compareContinuationShadow({ assessment: assess({ unresolvedItems: 2 }), observed: "CONTINUED" });
    expect(comparison.agreed).toBe(true);
    expect(comparison.note).toContain("keep the current model");
  });

  it("reports disagreement when the loop continued after advice to leave the path", () => {
    const comparison = compareContinuationShadow({ assessment: assess({ repeatRate: 0.95, outputNovelty: 0 }), observed: "CONTINUED" });
    expect(comparison.agreed).toBe(false);
    expect(comparison.decision).toBe("SWITCH_MODEL");
  });

  it("does not count an unobserved loop as agreement", () => {
    const comparison = compareContinuationShadow({ assessment: assess(), observed: "UNKNOWN" });
    expect(comparison.agreed).toBe(false);
    expect(comparison.note).toContain("not agreement and not disagreement");
  });
});
