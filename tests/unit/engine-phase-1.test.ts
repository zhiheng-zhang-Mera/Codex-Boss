/**
 * Engine Phase 1 evidence test — semantic outcome foundation.
 *
 * Runtime/semantic decoupling (book §5): a successful call can still be a
 * refusal, and a failed call (timeout/auth/page-change) is never model
 * evidence. Acceptance: A02, A03, A04, A05, A06, A07, A08, A36.
 */
import { describe, expect, it } from "vitest";
import {
  OUTCOME_AXES,
  SEMANTIC_OUTCOMES,
  createEvaluationRevision,
  deriveSemanticEvaluation,
  detectGoalDrift,
  isNonSemanticRuntimeCode,
  type OutcomeEvaluationInput
} from "../../src/shared/provider-outcome";
import { OutcomeEvaluator } from "../../electron/learning/outcome-evaluator";
import { DEFAULT_ADAPTIVE_FLAGS, resolveAdaptiveFlags } from "../../src/shared/adaptive-flags";

const ok = (signals: OutcomeEvaluationInput["signals"] = {}, content = "a usable answer"): OutcomeEvaluationInput => ({
  runtimeStatus: "SUCCESS",
  content,
  signals
});

describe("Phase 1 — outcome vocabulary", () => {
  it("covers all 11 semantic outcomes with a continuous axis mapping", () => {
    expect(SEMANTIC_OUTCOMES).toHaveLength(11);
    for (const outcome of SEMANTIC_OUTCOMES) {
      const axes = OUTCOME_AXES[outcome];
      for (const key of ["completion", "goalFidelity", "restrictionImpact", "sanitizationImpact", "pipelineBlocking"] as const) {
        expect(axes[key]).toBeGreaterThanOrEqual(0);
        expect(axes[key]).toBeLessThanOrEqual(1);
      }
    }
    // book §6 examples hold
    expect(OUTCOME_AXES.FULL_COMPLETION.completion).toBe(1);
    expect(OUTCOME_AXES.HARD_REFUSAL.restrictionImpact).toBe(1);
    expect(OUTCOME_AXES.PARTIAL_REFUSAL.restrictionImpact).toBeGreaterThan(OUTCOME_AXES.SOFT_RESTRICTION.restrictionImpact);
    expect(OUTCOME_AXES.HEAVY_SANITIZATION.sanitizationImpact).toBeGreaterThan(OUTCOME_AXES.HEAVY_SANITIZATION.restrictionImpact);
  });
});

describe("Phase 1 — classification", () => {
  it("A02: runtime SUCCESS + normal completion ⇒ FULL_COMPLETION", () => {
    const evaluation = deriveSemanticEvaluation(ok({ deliverablesCovered: 1 }));
    expect(evaluation.outcome).toBe("FULL_COMPLETION");
    expect(evaluation.axes.completion).toBe(1);
    expect(evaluation.runtimeAttributable).toBe(false);
    expect(evaluation.penalizesSemanticProfile).toBe(true);
  });

  it("A03: runtime SUCCESS + explicit refusal ⇒ HARD_REFUSAL without being a runtime failure", () => {
    const evaluation = deriveSemanticEvaluation(ok({ refusal: true }, "I can't help with that."));
    expect(evaluation.outcome).toBe("HARD_REFUSAL");
    expect(evaluation.runtimeAttributable).toBe(false); // NOT a runtime crash
    expect(evaluation.axes.restrictionImpact).toBe(1);
    expect(evaluation.axes.completion).toBe(0);
  });

  it("A04: partial completion and partial refusal are distinguishable", () => {
    const partialCompletion = deriveSemanticEvaluation(ok({ deliverablesCovered: 0.5 }));
    const partialRefusal = deriveSemanticEvaluation(ok({ partialRefusal: true }));
    expect(partialCompletion.outcome).toBe("PARTIAL_COMPLETION");
    expect(partialRefusal.outcome).toBe("PARTIAL_REFUSAL");
    expect(partialRefusal.axes.restrictionImpact).toBeGreaterThan(partialCompletion.axes.restrictionImpact);
  });

  it("A05: runtime TIMEOUT ⇒ UNCLASSIFIED with no restriction penalty", () => {
    const evaluation = deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT" });
    expect(evaluation.outcome).toBe("UNCLASSIFIED");
    expect(evaluation.axes.restrictionImpact).toBe(0);
    expect(evaluation.axes.goalFidelity).toBe(0);
    expect(evaluation.confidence).toBe(0);
    expect(evaluation.runtimeAttributable).toBe(true);
    expect(evaluation.penalizesSemanticProfile).toBe(false);
    expect(evaluation.reasons.join(" ")).toContain("no semantic conclusion");
  });

  it("A06: AUTH_REQUIRED ⇒ no capability/restriction penalty", () => {
    const evaluation = deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "AUTH_REQUIRED" });
    expect(evaluation.outcome).toBe("UNCLASSIFIED");
    expect(evaluation.axes.restrictionImpact).toBe(0);
    expect(evaluation.penalizesSemanticProfile).toBe(false);
  });

  it("A07: PAGE_CHANGED ⇒ no semantic negative evidence", () => {
    const evaluation = deriveSemanticEvaluation({ runtimeStatus: "PERMANENT_FAILURE", runtimeFailureCode: "PAGE_CHANGED" });
    expect(evaluation.outcome).toBe("UNCLASSIFIED");
    expect(evaluation.penalizesSemanticProfile).toBe(false);
    expect(evaluation.axes.completion).toBe(0);
    expect(evaluation.axes.restrictionImpact).toBe(0);
  });

  it("A08: goal drift is recorded when the worker silently changes scope", () => {
    const drift = detectGoalDrift({ deliverables: ["migration report", "rollback plan"] }, "Instead of the requested migration report I produced a short summary.");
    expect(drift.drifted).toBe(true);
    const evaluation = deriveSemanticEvaluation(ok({ driftEvidence: drift.evidence }));
    expect(evaluation.outcome).toBe("GOAL_DRIFT");
    expect(evaluation.axes.goalFidelity).toBeLessThan(0.5);
  });

  it("format failure is distinguished from provider restriction", () => {
    const format = deriveSemanticEvaluation(ok({ formatOk: false }));
    const restriction = deriveSemanticEvaluation(ok({ refusal: true }));
    expect(format.outcome).toBe("FORMAT_FAILURE");
    expect(format.axes.restrictionImpact).toBe(0); // our contract issue, not the model's
    expect(restriction.axes.restrictionImpact).toBeGreaterThan(0);
  });

  it("deterministic verification failure outranks provider behaviour signals", () => {
    const evaluation = deriveSemanticEvaluation(ok({ verificationPassed: false, softRestriction: true }));
    expect(evaluation.outcome).toBe("VERIFICATION_FAILURE");
  });

  it("an unobservable success is UNCLASSIFIED rather than a fabricated completion", () => {
    const evaluation = deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "   " });
    expect(evaluation.outcome).toBe("UNCLASSIFIED");
    expect(evaluation.penalizesSemanticProfile).toBe(false);
  });

  it("classifies runtime codes as non-semantic", () => {
    for (const code of ["TIMEOUT", "AUTH_REQUIRED", "PAGE_CHANGED", "RATE_LIMITED"]) expect(isNonSemanticRuntimeCode(code)).toBe(true);
    expect(isNonSemanticRuntimeCode("SOME_MODEL_REFUSAL")).toBe(false);
    expect(isNonSemanticRuntimeCode(undefined)).toBe(false);
  });
});

describe("Phase 1 — evaluator service", () => {
  it("A36: semantic evaluation with learning disabled produces no evaluation", () => {
    const evaluator = new OutcomeEvaluator({ flags: () => DEFAULT_ADAPTIVE_FLAGS });
    expect(evaluator.enabled()).toBe(false);
    expect(evaluator.evaluate(ok())).toBeUndefined();
  });

  it("evaluates when the flag capability is on, and revises without overwriting", () => {
    const evaluator = new OutcomeEvaluator({ flags: () => resolveAdaptiveFlags({ adaptiveProviderLearning: true, semanticOutcomeEvaluation: true }) });
    const original = evaluator.evaluate(ok({ deliverablesCovered: 0.5 }))!;
    expect(original.outcome).toBe("PARTIAL_COMPLETION");
    const revision = evaluator.revise({
      episodeId: "ep-1",
      original,
      input: ok({ deliverablesCovered: 1 }),
      reason: "higher-version evaluator sees the missing deliverable as covered",
      revisedAt: "2026-09-10T00:00:00.000Z"
    });
    expect(revision.originalOutcome).toBe("PARTIAL_COMPLETION");
    expect(revision.revised.outcome).toBe("FULL_COMPLETION");
    expect(revision.originalEvaluatorVersion).toBe(original.evaluatorVersion);
    expect(createEvaluationRevision({ episodeId: "ep-1", original, revised: revision.revised, reason: "x", revisedAt: "2026-09-10T00:00:00.000Z" }).schemaVersion).toBe(1);
  });
});
