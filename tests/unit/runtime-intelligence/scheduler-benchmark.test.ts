import { describe, expect, it } from "vitest";
import {
  BENCHMARK_VERDICTS,
  CONFIDENT_THRESHOLD,
  MIN_BENCHMARK_CASES,
  benchmarkScheduler,
  judgeReplayCase,
  recommendationFactors,
  type BenchmarkVerdict,
  type EstimateError,
  type MeanEstimateError,
  type ReplayCase,
  type ReplayCaseVerdict,
  type SchedulerBenchmarkMetrics
} from "../../../src/shared/runtime-intelligence/scheduler-benchmark";
import { createObservation } from "../../../src/shared/runtime-intelligence/telemetry";
import { adviseScheduling } from "../../../src/shared/runtime-intelligence/scheduling-advisor";
import { applyModelOutcome, createModelRecord } from "../../../src/shared/runtime-intelligence/model-ledger";
import type { RuntimeObservation, SchedulingRecommendation, ModelCapabilityRecord, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase J. The benchmark is a measuring instrument, so the tests are controls rather than
 * assertions about a number: a corpus produced by a correct advisor and a corpus produced by
 * a deliberately wrong one must be told apart, and a corpus the advisor had nothing to do
 * with must be inconclusive rather than scored.
 */

const AT = "2026-01-01T00:00:00.000Z";

function observation(input: { taskId: string; modelKey: string; outcome: "SUCCESS" | "FAILED" | "UNKNOWN"; domain?: RuntimeObservation["execution"]["failureDomain"]; nodeId?: string; latencyMs?: number; costUsd?: number; skills?: string[] }): RuntimeObservation {
  return createObservation({
    observationId: `obs-${input.taskId}`,
    traceId: `trace-${input.taskId}`,
    task: { taskId: input.taskId, role: "coder", taskKind: "coding" },
    model: { modelKey: input.modelKey, provider: "vendor", family: input.modelKey, version: "1", basis: "RECOMMENDED" },
    node: { nodeId: input.nodeId ?? "node-a", basis: "RECOMMENDED" },
    skills: { recommended: input.skills ?? [], actual: input.skills ?? [], used: input.skills ?? [] },
    execution: {
      outcome: input.outcome,
      ...(input.domain === undefined ? {} : { failureDomain: input.domain }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd })
    },
    createdAt: AT
  });
}

function recommendation(input: { taskId: string; modelKey: string; confidence?: number; risk?: SchedulingRecommendation["estimatedRisk"]; nodeId?: string; fallbackModelKey?: string; estimatedLatencyMs?: number; estimatedCostUsd?: number }): SchedulingRecommendation {
  return {
    schemaVersion: 1,
    kind: "SCHEDULING_RECOMMENDATION",
    recommendationId: `rec-${input.taskId}`,
    taskId: input.taskId,
    createdAt: AT,
    authority: "ADVISORY_ONLY",
    preferredNode: { nodeId: input.nodeId ?? "node-a", score: 0.8, reasons: ["measured"] },
    preferredModel: { modelKey: input.modelKey, score: 0.9, confidence: input.confidence ?? 0.8, reasons: ["capability"] },
    ...(input.fallbackModelKey === undefined ? {} : { fallbackModel: { modelKey: input.fallbackModelKey, score: 0.5, confidence: 0.4, reasons: ["fallback"] } }),
    preferredSkillLoadout: [],
    reasoningFactors: [{ factor: "capability.coding", weight: 0.5, detail: "coding estimate", evidence: [] }],
    confidence: input.confidence ?? 0.8,
    ...(input.estimatedLatencyMs === undefined ? {} : { estimatedLatencyMs: input.estimatedLatencyMs }),
    ...(input.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: input.estimatedCostUsd }),
    estimatedRisk: input.risk ?? "low",
    blocked: [],
    productionRoutingAuthority: false,
    qualificationHostSelection: false
  };
}

/** A corpus where following the advice is associated with success. */
function goodCorpus(): ReplayCase[] {
  const cases: ReplayCase[] = [];
  for (let index = 0; index < 14; index += 1) {
    const taskId = `good-${index}`;
    cases.push({ taskId, recommendation: recommendation({ taskId, modelKey: "m-good" }), observation: observation({ taskId, modelKey: "m-good", outcome: "SUCCESS" }) });
  }
  for (let index = 0; index < 6; index += 1) {
    const taskId = `bad-${index}`;
    // The advisor wanted m-good; the loop used m-bad and failed. NOT_FOLLOWED, not a contradiction.
    cases.push({ taskId, recommendation: recommendation({ taskId, modelKey: "m-good" }), observation: observation({ taskId, modelKey: "m-bad", outcome: "FAILED", domain: "MODEL" }) });
  }
  return cases;
}

/** A corpus where the advice itself is what failed. */
function wrongCorpus(): ReplayCase[] {
  const cases: ReplayCase[] = [];
  for (let index = 0; index < 14; index += 1) {
    const taskId = `good-${index}`;
    cases.push({ taskId, recommendation: recommendation({ taskId, modelKey: "m-bad" }), observation: observation({ taskId, modelKey: "m-good", outcome: "SUCCESS" }) });
  }
  for (let index = 0; index < 6; index += 1) {
    const taskId = `bad-${index}`;
    cases.push({ taskId, recommendation: recommendation({ taskId, modelKey: "m-bad" }), observation: observation({ taskId, modelKey: "m-bad", outcome: "FAILED", domain: "MODEL" }) });
  }
  return cases;
}

describe("a single case is judged against its advice", () => {
  it("supports advice that was followed and succeeded", () => {
    const verdict: ReplayCaseVerdict = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m" }), observation: observation({ taskId: "t", modelKey: "m", outcome: "SUCCESS" }) });
    expect(verdict.verdict).toBe("SUPPORTED");
    expect(verdict.modelAgreement).toBe(true);
    expect(verdict.observedSuccess).toBe(true);
  });

  it("contradicts advice that was followed and failed on the model's own account", () => {
    const verdict = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m" }), observation: observation({ taskId: "t", modelKey: "m", outcome: "FAILED", domain: "MODEL" }) });
    expect(verdict.verdict).toBe("CONTRADICTED");
    expect(verdict.attributedToModel).toBe(true);
  });

  it("does NOT blame the advice for an environment failure", () => {
    const verdict = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m" }), observation: observation({ taskId: "t", modelKey: "m", outcome: "FAILED", domain: "NETWORK" }) });
    expect(verdict.verdict).toBe("INCONCLUSIVE");
    expect(verdict.attributedToModel).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("not evidence about the choice");
  });

  it("reports NOT_FOLLOWED rather than a contradiction when another model ran", () => {
    const verdict = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m1" }), observation: observation({ taskId: "t", modelKey: "m2", outcome: "FAILED", domain: "MODEL" }) });
    expect(verdict.verdict).toBe("NOT_FOLLOWED");
    expect(verdict.modelAgreement).toBe(false);
  });

  it("treats the fallback as followed, and says so", () => {
    const verdict = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m1", fallbackModelKey: "m2" }), observation: observation({ taskId: "t", modelKey: "m2", outcome: "SUCCESS" }) });
    expect(verdict.verdict).toBe("SUPPORTED");
    expect(verdict.usedFallback).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("fallback");
  });

  it("is INCONCLUSIVE with no recorded advice, and with no observed outcome", () => {
    const noAdvice = judgeReplayCase({ taskId: "t", observation: observation({ taskId: "t", modelKey: "m", outcome: "SUCCESS" }) });
    expect(noAdvice.verdict).toBe("INCONCLUSIVE");
    expect(noAdvice.confidence).toBeUndefined();
    const noOutcome = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m" }), observation: observation({ taskId: "t", modelKey: "m", outcome: "UNKNOWN" }) });
    expect(noOutcome.verdict).toBe("INCONCLUSIVE");
    expect(noOutcome.observedSuccess).toBeUndefined();
  });

  it("measures the estimation error only when both sides were measured", () => {
    const both = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m", estimatedLatencyMs: 1000, estimatedCostUsd: 0.02 }), observation: observation({ taskId: "t", modelKey: "m", outcome: "SUCCESS", latencyMs: 1500, costUsd: 0.01 }) });
    expect(both.latencyEstimate?.absoluteRelativeError).toBeCloseTo(0.3333, 3);
    expect(both.costEstimate?.absoluteRelativeError).toBeCloseTo(1, 3);
    const oneSided = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m", estimatedLatencyMs: 1000 }), observation: observation({ taskId: "t", modelKey: "m", outcome: "SUCCESS" }) });
    expect(oneSided.latencyEstimate).toBeUndefined();
  });

  it("compares the recommended loadout with the executed one", () => {
    const agreement = judgeReplayCase({ taskId: "t", recommendation: recommendation({ taskId: "t", modelKey: "m" }), observation: observation({ taskId: "t", modelKey: "m", outcome: "SUCCESS", skills: ["a", "b"] }) });
    expect(agreement.skillLoadoutAgreement).toBe(true);
    const shared = observation({ taskId: "u", modelKey: "m", outcome: "SUCCESS", skills: ["a"] });
    const verdict = judgeReplayCase({ taskId: "u", recommendation: recommendation({ taskId: "u", modelKey: "m" }), observation: { ...shared, skills: { recommended: ["a", "b"], actual: ["a"], used: ["a"] } } });
    expect(verdict.skillLoadoutAgreement).toBe(false);
  });
});

describe("the benchmark tells a good advisor from a wrong one", () => {
  it("reports a positive lift when following the advice is associated with success", () => {
    const metrics: SchedulerBenchmarkMetrics = benchmarkScheduler(goodCorpus());
    expect(metrics.cases).toBe(20);
    expect(metrics.reason).toBe("OK");
    expect(metrics.verdicts.SUPPORTED).toBe(14);
    expect(metrics.verdicts.NOT_FOLLOWED).toBe(6);
    expect(metrics.verdicts.CONTRADICTED).toBe(0);
    expect(metrics.followedSuccessRate).toBe(1);
    expect(metrics.overallSuccessRate).toBeCloseTo(0.7, 4);
    expect(metrics.successLiftOverOverall).toBeCloseTo(0.3, 4);
    expect(metrics.successPrecision).toBe(1);
    expect(metrics.successPrecisionSamples).toBe(14);
  });

  it("reports a negative lift when the advice itself is what failed", () => {
    const metrics = benchmarkScheduler(wrongCorpus());
    expect(metrics.verdicts.CONTRADICTED).toBe(6);
    expect(metrics.verdicts.NOT_FOLLOWED).toBe(14);
    expect(metrics.followedSuccessRate).toBe(0);
    expect(metrics.successLiftOverOverall).toBeLessThan(0);
    expect(metrics.successPrecision).toBe(0);
    expect(metrics.successPrecisionSamples).toBe(6);
  });

  it("separates them on the lift even though both agree with reality equally often", () => {
    const good = benchmarkScheduler(goodCorpus());
    const wrong = benchmarkScheduler(wrongCorpus());
    // The discriminating metric is the lift, not agreement: a wrong advisor that always named
    // the model that then failed agrees with reality perfectly on those cases.
    expect(good.successLiftOverOverall).toBeGreaterThan(0);
    expect(wrong.successLiftOverOverall).toBeLessThan(0);
    expect(good.successPrecision).toBeGreaterThan(wrong.successPrecision!);
  });

  it("scores a random advisor naming an uninvolved model at zero agreement", () => {
    const corpus = goodCorpus().map((entry) => ({ ...entry, recommendation: recommendation({ taskId: entry.taskId, modelKey: "m-random" }) }));
    const metrics = benchmarkScheduler(corpus);
    expect(metrics.modelAgreementRate).toBe(0);
    expect(metrics.verdicts.NOT_FOLLOWED).toBe(20);
    expect(metrics.verdicts.SUPPORTED).toBe(0);
    expect(metrics.successPrecisionSamples).toBe(0);
    expect(metrics.successPrecision).toBeUndefined();
    expect(metrics.notes.join(" ")).toContain("measure the loop rather than the advisor");
  });

  it("reports the majority-model baseline so agreement alone cannot flatter the advisor", () => {
    const metrics = benchmarkScheduler(goodCorpus());
    expect(metrics.majorityModelKey).toBe("m-good");
    expect(metrics.majorityAgreementRate).toBeCloseTo(0.7, 4);
    expect(metrics.agreementLiftOverMajority).toBeDefined();
  });

  it("fires the wrong-advisor control: the lift for the wrong corpus is strictly lower", () => {
    const good = benchmarkScheduler(goodCorpus()).successLiftOverOverall!;
    const wrong = benchmarkScheduler(wrongCorpus()).successLiftOverOverall!;
    expect(good - wrong).toBeGreaterThan(0.5);
  });
});

describe("the benchmark refuses to score what it cannot see", () => {
  it("is INSUFFICIENT_EVIDENCE below the case minimum, while still reporting the counts", () => {
    const metrics = benchmarkScheduler(goodCorpus().slice(0, MIN_BENCHMARK_CASES - 1));
    expect(metrics.reason).toBe("INSUFFICIENT_EVIDENCE");
    expect(metrics.cases).toBe(MIN_BENCHMARK_CASES - 1);
    expect(metrics.notes.join(" ")).toContain(`below the ${MIN_BENCHMARK_CASES}`);
  });

  it("excludes cases with no observed outcome from every rate", () => {
    const corpus = [...goodCorpus(), { taskId: "unknown", recommendation: recommendation({ taskId: "unknown", modelKey: "m-good" }), observation: observation({ taskId: "unknown", modelKey: "m-good", outcome: "UNKNOWN" }) }];
    const metrics = benchmarkScheduler(corpus);
    expect(metrics.cases).toBe(21);
    expect(metrics.casesWithOutcome).toBe(20);
    expect(metrics.verdicts.INCONCLUSIVE).toBe(1);
    expect(metrics.notes.join(" ")).toContain("no observed outcome");
  });

  it("returns undefined rather than zero for every rate with an empty denominator", () => {
    const metrics = benchmarkScheduler([]);
    expect(metrics.cases).toBe(0);
    expect(metrics.modelAgreementRate).toBeUndefined();
    expect(metrics.nodeAgreementRate).toBeUndefined();
    expect(metrics.successPrecision).toBeUndefined();
    expect(metrics.failurePrecision).toBeUndefined();
    expect(metrics.followedSuccessRate).toBeUndefined();
    expect(metrics.successLiftOverOverall).toBeUndefined();
    expect(metrics.agreementLiftOverMajority).toBeUndefined();
    expect(metrics.latencyEstimation).toBeUndefined();
    expect(metrics.costEstimation).toBeUndefined();
    expect(metrics.fallback.rate).toBeUndefined();
    expect(metrics.reason).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("measures risk precision against the failures that actually happened", () => {
    const corpus: ReplayCase[] = [
      { taskId: "r1", recommendation: recommendation({ taskId: "r1", modelKey: "m", risk: "high" }), observation: observation({ taskId: "r1", modelKey: "m", outcome: "FAILED", domain: "MODEL" }) },
      { taskId: "r2", recommendation: recommendation({ taskId: "r2", modelKey: "m", risk: "high" }), observation: observation({ taskId: "r2", modelKey: "m", outcome: "FAILED", domain: "MODEL" }) },
      { taskId: "r3", recommendation: recommendation({ taskId: "r3", modelKey: "m", risk: "low" }), observation: observation({ taskId: "r3", modelKey: "m", outcome: "SUCCESS" }) }
    ];
    const metrics = benchmarkScheduler(corpus);
    expect(metrics.failurePrecisionSamples).toBe(2);
    expect(metrics.failurePrecision).toBe(1);
  });

  it("measures the estimation errors it can and ignores the rest", () => {
    const corpus: ReplayCase[] = [
      { taskId: "e1", recommendation: recommendation({ taskId: "e1", modelKey: "m", estimatedLatencyMs: 100, estimatedCostUsd: 1 }), observation: observation({ taskId: "e1", modelKey: "m", outcome: "SUCCESS", latencyMs: 200, costUsd: 2 }) },
      { taskId: "e2", recommendation: recommendation({ taskId: "e2", modelKey: "m", estimatedLatencyMs: 100 }), observation: observation({ taskId: "e2", modelKey: "m", outcome: "SUCCESS", latencyMs: 50 }) }
    ];
    const metrics = benchmarkScheduler(corpus);
    const latency: MeanEstimateError | undefined = metrics.latencyEstimation;
    expect(latency?.samples).toBe(2);
    // |100-200|/200 = 0.5 and |100-50|/50 = 1.0, so the mean is 0.75.
    expect(latency?.meanAbsoluteRelativeError).toBeCloseTo(0.75, 4);
    expect(latency?.worstAbsoluteRelativeError).toBe(1);
    expect(metrics.costEstimation?.samples).toBe(1);
    const single: EstimateError | undefined = judgeReplayCase(corpus[0]).latencyEstimate;
    expect(single?.estimated).toBe(100);
    expect(single?.actual).toBe(200);
  });

  it("counts how useful the fallback was", () => {
    const corpus: ReplayCase[] = [
      { taskId: "f1", recommendation: recommendation({ taskId: "f1", modelKey: "m1", fallbackModelKey: "m2" }), observation: observation({ taskId: "f1", modelKey: "m2", outcome: "SUCCESS" }) },
      { taskId: "f2", recommendation: recommendation({ taskId: "f2", modelKey: "m1", fallbackModelKey: "m2" }), observation: observation({ taskId: "f2", modelKey: "m2", outcome: "FAILED", domain: "MODEL" }) }
    ];
    const metrics = benchmarkScheduler(corpus);
    expect(metrics.fallback).toEqual({ used: 2, succeeded: 1, rate: 0.5 });
  });

  it("feeds only FOLLOWED cases to the calibration report", () => {
    const metrics = benchmarkScheduler(goodCorpus());
    // Fourteen followed cases at confidence 0.8, all of which succeeded: the advice held up
    // more often than it claimed, so the bias is negative. The six ignored cases are excluded,
    // because the advice was never exercised on them.
    expect(metrics.calibration.samples).toBe(14);
    expect(metrics.calibration.meanPredicted).toBeCloseTo(0.8, 4);
    expect(metrics.calibration.observedSupportRate).toBe(1);
    expect(metrics.calibration.bias).toBeCloseTo(-0.2, 4);
    // Fourteen is below the calibration minimum, so the numbers are reported and the verdict
    // is withheld rather than asserted from too little.
    expect(metrics.calibration.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(metrics.calibration.reasons.join(" ")).toContain("below the 20");
    expect(metrics.calibration.bySource.scheduler.samples).toBe(14);
  });

  it("does not let ignored advice make the advisor look overconfident", () => {
    // The same 20 observations, but the advisor named a model the loop never used, so its
    // confidence was never tested. No calibration sample exists.
    const ignored = goodCorpus().map((entry) => ({ ...entry, recommendation: recommendation({ taskId: entry.taskId, modelKey: "m-elsewhere", confidence: 0.99 }) }));
    const metrics = benchmarkScheduler(ignored);
    expect(metrics.calibration.samples).toBe(0);
    expect(metrics.calibration.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("reports underconfidence when the advice is right far more often than it claims", () => {
    const corpus = goodCorpus().map((entry) => ({ ...entry, recommendation: recommendation({ taskId: entry.taskId, modelKey: entry.observation.model.modelKey === "m-good" ? "m-good" : "m-good", confidence: 0.2, fallbackModelKey: "m-bad" }) }));
    const metrics = benchmarkScheduler(corpus);
    expect(metrics.calibration.meanPredicted).toBeCloseTo(0.2, 4);
    expect(metrics.calibration.verdict).toBe("UNDERCONFIDENT");
    expect(metrics.calibration.reasons.join(" ")).toContain("underconfident");
  });
});

describe("the real advisor's own output flows through the benchmark", () => {
  function trained(key: string, successes: number): ModelCapabilityRecord {
    let record = createModelRecord({ provider: "vendor", family: key, version: "1", at: AT });
    for (let index = 0; index < successes; index += 1) {
      record = applyModelOutcome(record, { observationId: `${key}-${index}`, taskId: "t", nodeId: "n", role: "coder", taskKind: "coding", success: true, at: AT }).record;
    }
    record = { ...record, modelKey: key };
    return record;
  }

  it("judges advice produced by adviseScheduling rather than a hand-built record", () => {
    const task: TaskProfile = { taskId: "task-1", role: "coder", taskKind: "coding", requiredCapabilities: [], contextScale: "small", externalEffect: false, risk: "low", createdAt: AT };
    const recommendationFromAdvisor = adviseScheduling({ task, models: [trained("m-strong", 12), trained("m-weak", 12)], nodes: [], createdAt: AT });
    expect(recommendationFromAdvisor.preferredModel?.modelKey).toBe("m-strong");
    const verdict = judgeReplayCase({ taskId: "task-1", recommendation: recommendationFromAdvisor, observation: observation({ taskId: "task-1", modelKey: "m-strong", outcome: "SUCCESS" }) });
    expect(verdict.verdict).toBe("SUPPORTED");
    expect(verdict.modelAgreement).toBe(true);
    expect(recommendationFactors(recommendationFromAdvisor).length).toBeGreaterThan(0);
    expect(CONFIDENT_THRESHOLD).toBeGreaterThan(0);
    expect(BENCHMARK_VERDICTS).toContain<BenchmarkVerdict>("SUPPORTED");
  });

  it("records NOT_FOLLOWED when the loop took a different model than the advisor named", () => {
    const task: TaskProfile = { taskId: "task-2", role: "coder", taskKind: "coding", requiredCapabilities: [], contextScale: "small", externalEffect: false, risk: "low", createdAt: AT };
    const recommendationFromAdvisor = adviseScheduling({ task, models: [trained("m-strong", 12)], nodes: [], createdAt: AT });
    const verdict = judgeReplayCase({ taskId: "task-2", recommendation: recommendationFromAdvisor, observation: observation({ taskId: "task-2", modelKey: "m-other", outcome: "SUCCESS" }) });
    expect(verdict.verdict).toBe("NOT_FOLLOWED");
  });
});
