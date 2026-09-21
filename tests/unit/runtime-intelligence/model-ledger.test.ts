import { describe, expect, it } from "vitest";
import {
  ANOMALY_DOWNWEIGHT,
  ANOMALY_FAILURE_CLASS_FLOOR,
  ANOMALY_LATENCY_MULTIPLE,
  CONFIDENCE_CAP,
  CONFIDENCE_K,
  DECLARED_CAPABILITY_NUDGE,
  DEFAULT_CAPABILITY_PRIOR,
  DEFAULT_FAMILY_PRIORS,
  DEFAULT_PRIOR_STRENGTH,
  TASK_KIND_DIMENSIONS,
  applyModelOutcome,
  capabilityEstimate,
  confidenceFor,
  createModelRecord,
  dominantFailureClass,
  observedMean,
  priorShare,
  reviewAgreementRate,
  usableCapability,
  warmStartScores,
  type CapabilityPriorTable,
  type CreateModelRecordInput,
  type ModelOutcomeApplication,
  type ModelOutcomeInput,
  type OutcomeAttribution,
  type WarmStartInput
} from "../../../src/shared/runtime-intelligence/model-ledger";
import { MODEL_CAPABILITY_DIMENSIONS, type ModelCapabilityRecord } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase A. The four claims the plan makes about a capability ledger are each asserted
 * against a real ledger here: a new model does not start at zero, a low-sample estimate
 * has low confidence, history progressively overrides the prior, and an anomalous failure
 * neither destroys nor permanently lowers a score.
 */

const AT = "2026-01-01T00:00:00.000Z";

function newRecord(overrides: Partial<CreateModelRecordInput> = {}): ModelCapabilityRecord {
  const input: CreateModelRecordInput = { provider: "vendor", family: "unknown-family", at: AT, ...overrides };
  return createModelRecord(input);
}

function outcome(overrides: Partial<ModelOutcomeInput> = {}): ModelOutcomeInput {
  return {
    observationId: "obs-1",
    taskId: "task-1",
    nodeId: "node-a",
    role: "coder",
    taskKind: "coding",
    success: true,
    at: AT,
    ...overrides
  };
}

function applyMany(record: ModelCapabilityRecord, count: number, overrides: Partial<ModelOutcomeInput> = {}, sequence = 1): ModelOutcomeApplication {
  let current = record;
  let last: ModelOutcomeApplication | undefined;
  for (let index = 0; index < count; index += 1) {
    last = applyModelOutcome(current, outcome({ observationId: `obs-${sequence + index}`, ...overrides }));
    current = last.record;
  }
  if (!last) throw new Error("applyMany requires at least one outcome");
  return { ...last, record: current };
}

describe("a new model is warm-started, never zero", () => {
  it("seeds every dimension from the global prior when the family is unknown", () => {
    const scores = warmStartScores({ provider: "vendor", family: "never-seen", at: AT });
    for (const dimension of MODEL_CAPABILITY_DIMENSIONS) {
      expect(scores.scores[dimension].score).toBe(DEFAULT_CAPABILITY_PRIOR);
      expect(scores.scores[dimension].score).toBeGreaterThan(0);
      expect(scores.scores[dimension].samples).toBe(0);
      expect(scores.scores[dimension].priorWeight).toBe(DEFAULT_PRIOR_STRENGTH);
    }
    expect(scores.sources).toContain("GLOBAL_PRIOR");
    expect(scores.sources).not.toContain("FAMILY_PRIOR");
  });

  it("uses a family prior and says so, distinguishing it from the global default", () => {
    const scores = warmStartScores({ provider: "vendor", family: "gpt", at: AT });
    expect(scores.scores.coding.score).toBe(DEFAULT_FAMILY_PRIORS.gpt?.coding);
    expect(scores.sources).toContain("FAMILY_PRIOR");
    // A dimension the family prior does not name stays on the global default, not the family's best.
    expect(scores.scores.review.score).toBe(DEFAULT_CAPABILITY_PRIOR);
  });

  it("nudges only the dimensions a declared capability names, and records the source", () => {
    const scores = warmStartScores({ provider: "vendor", family: "never-seen", declaredCapabilities: ["coding"], at: AT });
    expect(scores.scores.coding.score).toBeCloseTo(DEFAULT_CAPABILITY_PRIOR + DECLARED_CAPABILITY_NUDGE, 6);
    expect(scores.scores.review.score).toBe(DEFAULT_CAPABILITY_PRIOR);
    expect(scores.sources).toContain("DECLARED_CAPABILITY");
  });

  it("builds a record marked warmStarted with no outcomes and no invented version", () => {
    const record = newRecord();
    expect(record.warmStarted).toBe(true);
    expect(record.scores.coding.score).toBeGreaterThan(0);
    expect(record.history).toEqual([]);
    expect(record.version).toBe("unknown");
    expect(record.taskTypePerformance).toEqual({});
    expect(record.failureClasses).toEqual({});
    expect(record.latency.samples).toBe(0);
    expect(record.cost.samples).toBe(0);
    expect(record.reviewAgreement.samples).toBe(0);
    expect(record.modelKey).toBe("vendor:unknown-family:unknown");
  });

  it("accepts an injected prior table, so measured priors replace the placeholder without a code change", () => {
    const table: CapabilityPriorTable = { "my-family": { coding: 0.52 } };
    const input: WarmStartInput = { provider: "v", family: "my-family", priorTable: table, priorStrength: 3, at: AT };
    const scores = warmStartScores(input);
    expect(scores.scores.coding.score).toBe(0.52);
    expect(scores.scores.coding.priorWeight).toBe(3);
  });
});

describe("low samples mean low confidence, and a prior-only estimate is not usable evidence", () => {
  it("gives zero confidence to a prior-only estimate even though the score is non-zero", () => {
    const record = newRecord();
    expect(record.scores.coding.score).toBeGreaterThan(0);
    expect(record.scores.coding.confidence).toBe(0);
    expect(confidenceFor(0)).toBe(0);
  });

  it("grows confidence with samples and caps it below certainty", () => {
    expect(confidenceFor(1)).toBeLessThan(0.2);
    expect(confidenceFor(CONFIDENCE_K)).toBeCloseTo(0.5, 6);
    expect(confidenceFor(10_000)).toBe(CONFIDENCE_CAP);
    expect(CONFIDENCE_CAP).toBeLessThan(1);
  });

  it("refuses to treat a warm-started estimate as usable, naming the reason", () => {
    const record = newRecord();
    const verdict = usableCapability({ record, dimension: "coding" });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toContain("no coding evidence");
    expect(verdict.priorShare).toBe(1);
  });

  it("treats a low-confidence estimate as unusable and a sampled one as usable", () => {
    const fresh = newRecord();
    expect(usableCapability({ record: fresh, dimension: "coding" }).usable).toBe(false);
    const trained = applyMany(fresh, 10).record;
    const verdict = usableCapability({ record: trained, dimension: "coding" });
    expect(verdict.usable).toBe(true);
    expect(verdict.confidence).toBeGreaterThan(0.5);
    expect(verdict.reason).toContain("prior share");
  });
});

describe("observed history progressively overrides the prior", () => {
  it("moves the score towards the observed value and spends the prior down", () => {
    const fresh = newRecord();
    const share0 = priorShare(fresh.scores.coding);
    const after1 = applyModelOutcome(fresh, outcome()).record;
    const after10 = applyMany(fresh, 10).record;
    const after20 = applyMany(fresh, 20).record;

    expect(share0).toBe(1);
    expect(priorShare(after1.scores.coding)).toBeLessThan(1);
    expect(priorShare(after10.scores.coding)).toBeLessThan(0.3);
    expect(priorShare(after20.scores.coding)).toBeLessThan(0.1);
    // A success rate of 1.0 pulls the estimate up, monotonically.
    expect(after1.scores.coding.score).toBeGreaterThan(fresh.scores.coding.score);
    expect(after10.scores.coding.score).toBeGreaterThan(after1.scores.coding.score);
    expect(after20.scores.coding.score).toBeGreaterThan(after10.scores.coding.score);
    expect(after20.scores.coding.score).toBeGreaterThan(0.9);
    expect(after20.scores.coding.samples).toBe(20);
    // `coding` itself is no longer prior-dominated...
    expect(priorShare(after20.scores.coding)).toBeLessThan(0.1);
    // ...but the record stays warm-started overall, because dimensions this task kind
    // never exercised (review, latency, cost) are still prior-only. Collapsing those two
    // facts into one flag is what would let an unmeasured dimension look measured.
    expect(after20.warmStarted).toBe(true);
    expect(after20.scores.review.samples).toBe(0);
    expect(priorShare(after20.scores.review)).toBe(1);
  });

  it("pulls a warm-started high prior back down when the model actually fails", () => {
    const fresh = newRecord({ family: "gpt" });
    const start = fresh.scores.coding.score;
    const trained = applyMany(fresh, 12, { success: false, failureClass: "TIMEOUT" }).record;
    expect(trained.scores.coding.score).toBeLessThan(start);
    expect(trained.scores.coding.score).toBeLessThan(0.3);
  });

  it("records the observed mean separately from the blended score", () => {
    const trained = applyMany(newRecord(), 4).record;
    const estimate = capabilityEstimate(trained, "coding");
    expect(estimate).toBeDefined();
    expect(observedMean(estimate!)).toBe(1);
    expect(estimate!.score).toBeLessThan(1);
    expect(estimate!.observedWeight).toBe(4);
  });

  it("keeps the prior score and the observed score as separate, readable facts", () => {
    const fresh = newRecord({ family: "gpt" });
    const prior = fresh.scores.coding.priorScore;
    expect(prior).toBe(DEFAULT_FAMILY_PRIORS.gpt?.coding);
    expect(fresh.scores.coding.score).toBe(prior);
    // Observations all at 1.0: the observed mean is 1.0, the prior stays where it was,
    // and the blended score sits between them.
    const trained = applyMany(fresh, 6).record;
    const estimate = capabilityEstimate(trained, "coding")!;
    expect(estimate.priorScore).toBe(prior);
    expect(observedMean(estimate)).toBe(1);
    expect(estimate.score).toBeGreaterThan(prior);
    expect(estimate.score).toBeLessThan(1);
    // Failures pull the observed mean down without rewriting the prior.
    const failing = applyMany(fresh, 6, { success: false, failureClass: "TIMEOUT" }).record;
    expect(failing.scores.coding.priorScore).toBe(prior);
    expect(observedMean(failing.scores.coding)).toBe(0);
  });
});

describe("an anomalous failure is down-weighted, not fatal", () => {
  it("folds a never-before-seen failure class in with a reduced weight and records why", () => {
    const established = applyMany(newRecord(), 20).record;
    const before = established.scores.coding.score;
    const application = applyModelOutcome(established, outcome({ success: false, failureClass: "NEVER_SEEN_BEFORE" }));
    expect(application.anomaly).toBe(true);
    expect(application.weight).toBe(ANOMALY_DOWNWEIGHT);
    expect(application.reasons.join(" ")).toContain("NEVER_SEEN_BEFORE");
    // A single anomaly moves an established estimate by well under 5%.
    expect(before - application.record.scores.coding.score).toBeLessThan(0.05);
    // It is recorded rather than discarded: "seen and counted for little" is a fact.
    expect(application.record.failureClasses.NEVER_SEEN_BEFORE).toBe(1);
    expect(application.record.history).toHaveLength(21);
    expect(application.record.history.at(-1)?.weight).toBe(ANOMALY_DOWNWEIGHT);
  });

  it("lets later successes fully recover the estimate, so no single outcome is permanent", () => {
    // A mid-range record, because a model that has only ever succeeded sits at the
    // ceiling and nothing could recover above it.
    let mixed = newRecord();
    for (let index = 0; index < 20; index += 1) {
      mixed = applyModelOutcome(mixed, outcome({ observationId: `mixed-${index}`, success: index % 2 === 0, failureClass: index % 2 === 0 ? undefined : "TIMEOUT" })).record;
    }
    const before = mixed.scores.coding.score;
    expect(before).toBeGreaterThan(0.3);
    expect(before).toBeLessThan(0.9);

    const afterAnomaly = applyModelOutcome(mixed, outcome({ success: false, failureClass: "NEVER_SEEN_BEFORE" })).record;
    const recovered = applyMany(afterAnomaly, 10, {}, 100).record;
    expect(afterAnomaly.scores.coding.score).toBeLessThan(before);
    expect(recovered.scores.coding.score).toBeGreaterThan(before);
  });

  it("treats a repeated failure class as ordinary evidence once it is no longer rare", () => {
    let record = applyMany(newRecord(), 20).record;
    record = applyModelOutcome(record, outcome({ success: false, failureClass: "TIMEOUT" })).record;
    // The first occurrence was rare on an established model.
    expect(record.history.at(-1)?.weight).toBe(ANOMALY_DOWNWEIGHT);
    record = applyModelOutcome(record, outcome({ success: false, failureClass: "TIMEOUT" })).record;
    record = applyModelOutcome(record, outcome({ success: false, failureClass: "TIMEOUT" })).record;
    // By the third occurrence the class is known, so it counts in full.
    expect(record.failureClasses.TIMEOUT).toBe(3);
    expect(record.history.at(-1)?.weight).toBe(1);
    expect(ANOMALY_FAILURE_CLASS_FLOOR).toBe(2);
  });

  it("down-weights a latency outlier instead of letting it dominate the latency score", () => {
    let record = applyMany(newRecord(), 6, { latencyMs: 1000, expectedLatencyMs: 1000 }).record;
    const meanBefore = record.latency.meanMs;
    const latencyBefore = record.scores.latency.score;
    const application = applyModelOutcome(record, outcome({ latencyMs: meanBefore * ANOMALY_LATENCY_MULTIPLE + 1, expectedLatencyMs: 1000 }));
    expect(application.anomaly).toBe(true);
    expect(application.weight).toBe(ANOMALY_DOWNWEIGHT);
    expect(application.reasons.join(" ")).toContain("running mean");
    expect(latencyBefore - application.record.scores.latency.score).toBeLessThan(0.05);
    record = application.record;
    expect(record.latency.maxMs).toBeGreaterThan(meanBefore);
  });
});

describe("an unmeasured dimension is not updated, and a semantic refusal is not instability", () => {
  it("skips latency and cost when nothing was measured, and says why", () => {
    const application = applyModelOutcome(newRecord(), outcome());
    expect(application.skipped.map((entry) => entry.dimension)).toContain("latency");
    expect(application.skipped.map((entry) => entry.dimension)).toContain("cost");
    expect(application.updated).not.toContain("latency");
    expect(application.record.scores.latency.samples).toBe(0);
    expect(application.record.scores.latency.score).toBe(DEFAULT_CAPABILITY_PRIOR);
  });

  it("skips dimensions the task kind does not exercise", () => {
    const application = applyModelOutcome(newRecord(), outcome({ taskKind: "other" }));
    expect(application.updated).not.toContain("coding");
    expect(application.skipped).toContainEqual({ dimension: "coding", reason: "other tasks do not exercise coding" });
    expect([...application.updated].sort()).toEqual(["reliability", "stability"]);
    expect(TASK_KIND_DIMENSIONS.coding).toContain("coding");
  });

  it("adds long_context only when the task was actually context-heavy", () => {
    const light = applyModelOutcome(newRecord(), outcome({ taskKind: "reasoning" }));
    expect(light.updated).not.toContain("long_context");
    const heavy = applyModelOutcome(newRecord(), outcome({ taskKind: "reasoning", contextScale: "large" }));
    expect(heavy.updated).toContain("long_context");
  });

  it("does not move stability on a semantically attributed refusal", () => {
    const attribution: OutcomeAttribution = "SEMANTIC";
    const application = applyModelOutcome(newRecord(), outcome({ success: false, failureClass: "HARD_REFUSAL", attribution }));
    expect(application.updated).not.toContain("stability");
    expect(application.updated).toContain("reliability");
    expect(application.skipped).toContainEqual({ dimension: "stability", reason: "a semantic refusal is not evidence of instability" });
    expect(application.record.scores.stability.samples).toBe(0);
  });

  it("moves stability on a runtime-attributed failure", () => {
    const application = applyModelOutcome(newRecord(), outcome({ success: false, failureClass: "TIMEOUT", attribution: "RUNTIME" }));
    expect(application.updated).toContain("stability");
    expect(application.record.scores.stability.score).toBeLessThan(DEFAULT_CAPABILITY_PRIOR);
  });
});

describe("the record tracks task-type performance, failure classes and review agreement", () => {
  it("counts attempts, successes and failures per task kind", () => {
    let record = applyMany(newRecord(), 3, { taskKind: "coding" }).record;
    record = applyModelOutcome(record, outcome({ taskKind: "coding", success: false, failureClass: "TIMEOUT" })).record;
    record = applyModelOutcome(record, outcome({ taskKind: "review" })).record;
    expect(record.taskTypePerformance.coding).toEqual({ attempts: 4, successes: 3, failures: 1 });
    expect(record.taskTypePerformance.review).toEqual({ attempts: 1, successes: 1, failures: 0 });
    expect(dominantFailureClass(record)).toEqual({ failureClass: "TIMEOUT", count: 1 });
  });

  it("reports no dominant failure class for a model that never failed, rather than a zero count", () => {
    const record = applyMany(newRecord(), 3).record;
    expect(dominantFailureClass(record)).toBeUndefined();
  });

  it("reports no agreement rate until a review actually happened", () => {
    const unreviewed = applyMany(newRecord(), 3).record;
    expect(reviewAgreementRate(unreviewed)).toBeUndefined();
    const reviewed = applyMany(newRecord(), 2, { reviewerAgreed: true }).record;
    const mixed = applyModelOutcome(reviewed, outcome({ reviewerAgreed: false })).record;
    expect(reviewAgreementRate(mixed)).toBeCloseTo(2 / 3, 6);
    expect(mixed.reviewAgreement).toEqual({ samples: 3, agreements: 2 });
  });

  it("bounds the history it keeps", () => {
    const record = applyMany(newRecord(), 210, { taskKind: "other" }).record;
    expect(record.history.length).toBeLessThanOrEqual(200);
    expect(record.history.at(-1)?.observationId).toBe("obs-210");
  });
});
