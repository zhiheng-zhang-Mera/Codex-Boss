import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ASSISTED_EXECUTION_GATES,
  EVALUATION_METRIC_KEYS,
  EVALUATION_REPORT_SCHEMA_VERSION,
  MAX_FALSE_STOP_RATE_FOR_ASSISTED,
  buildEvaluationReport,
  type AssistedExecutionGate,
  type EvaluationGateResult,
  type EvaluationInput,
  type EvaluationMetricKey,
  type EvaluationQuestion,
  type EvaluationReport,
  type IngestionStats,
  type MetricValue,
  type PlaneStorageStats
} from "../../../src/shared/runtime-intelligence/evaluation-report";
import { RuntimeIntelligenceService, type EvaluationBundle, type EvaluationBundleInput } from "../../../electron/runtime-intelligence/runtime-intelligence-service";
import { benchmarkScheduler as benchmarkSchedulerRaw, type ReplayCase } from "../../../src/shared/runtime-intelligence/scheduler-benchmark";
import { benchmarkContinuation as benchmarkContinuationRaw, type ContinuationReplayStep } from "../../../src/shared/runtime-intelligence/continuation-benchmark";
import { replaySkillLoadout, replaySkillLoadouts } from "../../../src/shared/runtime-intelligence/skill-replay";
import { createObservation } from "../../../src/shared/runtime-intelligence/telemetry";
import type { ContinuationAssessment, RuntimeObservation, SchedulingRecommendation, SkillCard, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase 12. The report is the round's deliverable, so the tests check the two properties that
 * matter: it answers every question the plan names, and it refuses to claim readiness from data
 * it does not have.
 */

const AT = "2026-01-01T00:00:00.000Z";

/**
 * Cases in this suite declare what their advice saw, because the temporal guard refuses to score
 * an undeclared case. Declaring is the default here so each test states only what it is about.
 */
const DECLARED_INPUT = { fields: ["stepIndex", "unresolvedCount", "provider", "runtimeId"], label: "the test advice" } as const;

function benchmarkScheduler(cases: readonly ReplayCase[], options?: { minimum?: number }) {
  return benchmarkSchedulerRaw(
    cases.map((entry) => (entry.inputDeclaration === undefined ? { ...entry, inputDeclaration: DECLARED_INPUT } : entry)),
    options
  );
}

function benchmarkContinuation(steps: readonly ContinuationReplayStep[], options?: { minimum?: number }) {
  return benchmarkContinuationRaw(
    steps.map((entry) => (entry.inputDeclaration === undefined ? { ...entry, inputDeclaration: DECLARED_INPUT } : entry)),
    options
  );
}

const boundary: EvaluationInput["boundary"] = {
  rootTrustTouched: false,
  qualificationTouched: false,
  ownerReviewPaths: [],
  authorityDecision: "ALLOW",
  changeClass: "PRIVILEGED_NON_ROOT_CHANGE (1)"
};

function observation(taskId: string, modelKey: string, outcome: "SUCCESS" | "FAILED", skills: { actual: string[]; used: string[] }): RuntimeObservation {
  return createObservation({
    observationId: `obs-${taskId}`,
    traceId: `trace-${taskId}`,
    recommendationId: `rec-${taskId}`,
    task: { taskId, role: "coder", taskKind: "coding" },
    model: { modelKey, provider: "vendor", family: modelKey, version: "1", basis: "RECOMMENDED" },
    node: { nodeId: "node-a", basis: "RECOMMENDED" },
    skills: { recommended: skills.actual, actual: skills.actual, used: skills.used },
    execution: { outcome, ...(outcome === "FAILED" ? { failureDomain: "MODEL" as const } : {}) },
    createdAt: AT
  });
}

function recommendation(taskId: string, modelKey: string, confidence: number): SchedulingRecommendation {
  return {
    schemaVersion: 1,
    kind: "SCHEDULING_RECOMMENDATION",
    recommendationId: `rec-${taskId}`,
    taskId,
    createdAt: AT,
    authority: "ADVISORY_ONLY",
    preferredNode: { nodeId: "node-a", score: 0.8, reasons: ["measured"] },
    preferredModel: { modelKey, score: 0.9, confidence, reasons: ["capability"] },
    preferredSkillLoadout: [],
    reasoningFactors: [],
    confidence,
    estimatedRisk: "low",
    blocked: [],
    productionRoutingAuthority: false,
    qualificationHostSelection: false
  };
}

function card(skillId: string, contextTokens = 500): SkillCard {
  return { schemaVersion: 1, skillId, name: skillId, providesCapabilities: ["coding"], contextTokens, baseLatencyMs: 100, tags: [] };
}

function task(taskId: string): TaskProfile {
  return { taskId, role: "coder", taskKind: "coding", requiredCapabilities: ["coding"], contextScale: "small", externalEffect: false, risk: "low", createdAt: AT };
}

function assessment(decision: ContinuationAssessment["decision"]): ContinuationAssessment {
  return { schemaVersion: 1, kind: "CONTINUATION_ASSESSMENT", assessmentId: "c", taskId: "task-1", modelKey: "m", mode: "SHADOW_ONLY", decision, confidence: 0.6, factors: [], wouldActAtStep: 1, counterfactual: "shadow", policyId: "continuation-policy-v1", policyHash: "0".repeat(64), createdAt: AT };
}

/** A corpus good enough to clear every gate. */
function readyInput(): EvaluationInput {
  const cases = Array.from({ length: 25 }, (_, index) => {
    const taskId = `task-${index}`;
    if (index < 20) {
      // Twenty runs followed the advice on m-good: sixteen succeeded, four failed on the model.
      return { taskId, recommendation: recommendation(taskId, "m-good", 0.8), observation: observation(taskId, "m-good", index < 16 ? "SUCCESS" : "FAILED", { actual: ["a", "b"], used: ["a"] }) };
    }
    // Five runs ignored it, used another model, and failed: that is what makes following the
    // advice measurably better than the average run.
    return { taskId, recommendation: recommendation(taskId, "m-good", 0.8), observation: observation(taskId, "m-other", "FAILED", { actual: [], used: [] }) };
  });
  const scheduler = benchmarkScheduler(cases);
  const continuation = benchmarkContinuation([
    ...Array.from({ length: 11 }, (_, index) => ({ taskId: `c-${index}`, step: index, assessment: assessment("CONTINUE"), observed: "CONTINUED" as const, taskComplete: false })),
    ...Array.from({ length: 25 }, (_, index) => ({ taskId: `s-${index}`, step: index, assessment: assessment("STOP"), observed: "STOPPED" as const, taskComplete: true }))
  ]);
  const skillReplay = replaySkillLoadouts(
    Array.from({ length: 6 }, (_, index) => replaySkillLoadout({ task: task(`skill-${index}`), originalSkillIds: ["a", "b"], usedSkillIds: ["a"], cards: [card("a"), card("b")] }))
  );
  return {
    generatedAt: AT,
    ingestion: { considered: 40, ingested: 40, charged: 20, refused: 20, domains: { MODEL: 20, NETWORK: 10, TOOL: 5, UNKNOWN: 5 }, degraded: [], sources: [{ name: "telemetry", present: true, records: 40 }] },
    scheduler,
    continuation,
    skillReplay,
    nodeTelemetry: { rawSamples: 30, afterCompaction: 6, suppressedSamples: 120, archivedEntries: 0, bytes: { samples: 9000, archive: 0, index: 200 }, nodes: ["node-a"], coverageByNode: [{ nodeId: "node-a", coverage: 0.55, absentKeys: ["gpu.devices", "plugins"] }] },
    storage: { observations: 40, recommendations: 20, models: 2, contextRecords: 0, skillTelemetry: 0, bytes: { "observations.jsonl": 40000, "models.json": 2000 } },
    continuationReplayPossible: true,
    boundary
  };
}

describe("the report answers every question the plan names", () => {
  const report: EvaluationReport = buildEvaluationReport(readyInput());
  const ids = report.questions.map((question) => question.id);

  it("exposes the shapes a caller needs, and the service can build the same report", () => {
    const ingestion: IngestionStats = { considered: 2, ingested: 2, charged: 1, refused: 1, domains: { MODEL: 1, NETWORK: 1 }, degraded: [], sources: [] };
    const storage: PlaneStorageStats = { observations: 2, recommendations: 1, models: 1, contextRecords: 0, skillTelemetry: 0, bytes: { "observations.jsonl": 10 } };
    const input: EvaluationInput = { generatedAt: AT, ingestion, storage, boundary };
    const built = buildEvaluationReport(input);
    const gate: EvaluationGateResult | undefined = built.gates[0];
    expect(gate?.gate).toBe("scheduler-beats-baseline");
    const named: AssistedExecutionGate = gate!.gate;
    expect(ASSISTED_EXECUTION_GATES).toContain(named);
    const question: EvaluationQuestion = built.questions[0];
    expect(question.id).toBe("ledger-calibration");
    const value: MetricValue = built.metrics.TASKS_REPLAYED;
    expect(value).toBe("NOT_MEASURED");

    // The service assembles the same report from its own store, with no data root.
    const service = new RuntimeIntelligenceService({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "boss-eval-")), now: () => AT });
    const bundleInput: EvaluationBundleInput = { boundary };
    const bundle: EvaluationBundle = service.evaluate(bundleInput);
    expect(bundle.report.kind).toBe("RUNTIME_INTELLIGENCE_EVALUATION_REPORT");
    expect(bundle.report.grantsExecutionAuthority).toBe(false);
    expect(bundle.report.readiness).toBe("INSUFFICIENT_EVIDENCE");
    expect(bundle.scheduler.cases).toBe(0);
    expect(bundle.skillReplay.replays).toBe(0);
  });

  it("covers all nine questions exactly once", () => {
    expect(ids).toEqual([
      "ledger-calibration",
      "scheduler-success",
      "skills-mounted-unused",
      "context-injected-without-contribution",
      "continuation-calls-saved",
      "continuation-false-stops",
      "overconfident-advice",
      "unknown-nodes",
      "enough-data"
    ]);
    for (const question of report.questions) {
      expect(question.question.length).toBeGreaterThan(0);
      expect(question.answer.length).toBeGreaterThan(0);
      expect(question.evidence.length).toBeGreaterThan(0);
    }
  });

  it("answers the questions it has data for with numbers", () => {
    const byId = new Map(report.questions.map((question) => [question.id, question.answer]));
    expect(byId.get("scheduler-success")).toContain("success precision");
    expect(byId.get("skills-mounted-unused")).toContain("mounted-but-unused");
    expect(byId.get("skills-mounted-unused")).toContain("b (6x)");
    expect(byId.get("continuation-false-stops")).toContain("false stop(s)");
    expect(byId.get("continuation-calls-saved")).toContain("25 call(s)");
    expect(byId.get("unknown-nodes")).toContain("node-a");
    expect(byId.get("unknown-nodes")).toContain("gpu.devices");
    expect(byId.get("enough-data")).toContain("40 real outcome(s)");
  });

  it("says NOT_MEASURED rather than inventing the context-contribution answer", () => {
    const answer = report.questions.find((question) => question.id === "context-injected-without-contribution")!.answer;
    expect(answer).toContain("NOT_MEASURED");
    expect(answer).toContain("no outcome is attributed back to an individual context record");
  });

  it("names the miscalibrated source when one is overconfident", () => {
    const skewed = readyInput();
    skewed.scheduler = benchmarkScheduler(
      Array.from({ length: 20 }, (_, index) => {
        const taskId = `t-${index}`;
        return { taskId, recommendation: recommendation(taskId, "m", 0.95), observation: observation(taskId, "m", index < 2 ? "SUCCESS" : "FAILED", { actual: [], used: [] }) };
      })
    );
    const answer = buildEvaluationReport(skewed).questions.find((question) => question.id === "overconfident-advice")!.answer;
    expect(answer).toContain("scheduler");
    expect(answer).toContain("OVERCONFIDENT");
  });
});

describe("readiness is granted only from measured data that clears every gate", () => {
  it("declares every gate by name and passes them for a corpus that clears them", () => {
    const report = buildEvaluationReport(readyInput());
    expect(report.gates.map((gate) => gate.gate)).toEqual([...ASSISTED_EXECUTION_GATES]);
    const unmet = report.gates.filter((gate) => !gate.passed).map((gate) => `${gate.gate}: ${gate.detail}`);
    expect(unmet.join(" | ")).toBe("");
    expect(report.readiness).toBe("READY_FOR_ASSISTED_EXECUTION_PROPOSAL");
  });

  it("never grants execution authority, whatever the readiness says", () => {
    const ready = buildEvaluationReport(readyInput());
    expect(ready.grantsExecutionAuthority).toBe(false);
    expect(ready.authority).toBe("ADVISORY_ONLY");
    expect(ready.readiness).toBe("READY_FOR_ASSISTED_EXECUTION_PROPOSAL");
  });

  it("is INSUFFICIENT_EVIDENCE with no data at all, and says which gate failed", () => {
    const report = buildEvaluationReport({ generatedAt: AT, boundary });
    expect(report.readiness).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.gates.every((gate) => !gate.passed)).toBe(true);
    expect(report.notes.join(" ")).toContain("gate not met");
    // Every metric exists and none of them claims a number.
    for (const key of EVALUATION_METRIC_KEYS) expect(report.metrics[key]).toBeDefined();
    expect(report.metrics.TASKS_REPLAYED).toBe("NOT_MEASURED");
    expect(report.metrics.FALSE_STOP_RATE).toBe("NOT_MEASURED");
    expect(report.metrics.CONFIDENCE_CALIBRATION_ERROR).toBe("NOT_MEASURED");
  });

  it("refuses readiness when the false-stop rate is above the gate", () => {
    const input = readyInput();
    // One false stop in ten STOPs is 10%, far above the 2% gate.
    input.continuation = benchmarkContinuation([
      ...Array.from({ length: 40 }, (_, index) => ({ taskId: `n-${index}`, step: index, assessment: assessment("CONTINUE"), observed: "CONTINUED" as const, taskComplete: false })),
      { taskId: "false", step: 99, assessment: assessment("STOP"), observed: "CONTINUED" as const, taskComplete: false },
      ...Array.from({ length: 9 }, (_, index) => ({ taskId: `ok-${index}`, step: index, assessment: assessment("STOP"), observed: "STOPPED" as const, taskComplete: true }))
    ]);
    const report = buildEvaluationReport(input);
    expect(input.continuation.falseStopRate).toBe(0.1);
    expect(report.gates.find((gate) => gate.gate === "false-stop-rate-low")?.passed).toBe(false);
    expect(report.readiness).toBe("INSUFFICIENT_EVIDENCE");
    expect(MAX_FALSE_STOP_RATE_FOR_ASSISTED).toBeLessThan(0.1);
  });

  it("refuses readiness when a replay would have dropped an invoked skill", () => {
    const input = readyInput();
    const broken = { ...replaySkillLoadout({ task: task("x"), originalSkillIds: ["a", "b"], usedSkillIds: ["a", "b"], cards: [card("a"), card("b")] }), droppedUsedSkillIds: ["b"], riskOfUnderLoading: "HIGH" as const };
    input.skillReplay = replaySkillLoadouts([broken, broken, broken, broken, broken]);
    const report = buildEvaluationReport(input);
    expect(report.gates.find((gate) => gate.gate === "loadout-no-underload-risk")?.passed).toBe(false);
    expect(report.readiness).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses readiness when the scheduler does not beat the majority baseline", () => {
    const input = readyInput();
    input.scheduler = benchmarkScheduler(
      Array.from({ length: 20 }, (_, index) => {
        const taskId = `m-${index}`;
        // Advice that is followed and fails half the time: no lift.
        return { taskId, recommendation: recommendation(taskId, "m-bad", 0.9), observation: observation(taskId, "m-bad", index < 10 ? "SUCCESS" : "FAILED", { actual: [], used: [] }) };
      })
    );
    const report = buildEvaluationReport(input);
    // The lift is zero here (followed rate equals overall rate), which the gate rejects.
    expect(input.scheduler.successLiftOverOverall).toBe(0);
    expect(report.gates.find((gate) => gate.gate === "scheduler-beats-baseline")?.passed).toBe(false);
    expect(report.readiness).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("the required metrics are all present and honest", () => {
  it("emits every named metric", () => {
    const metrics = buildEvaluationReport(readyInput()).metrics;
    const keys = Object.keys(metrics) as EvaluationMetricKey[];
    expect(keys.sort()).toEqual([...EVALUATION_METRIC_KEYS].sort());
    expect(metrics.MODEL_OUTCOMES_INGESTED).toBe(40);
    expect(metrics.SCHEDULER_SUPPORTED).toBe(16);
    expect(metrics.SCHEDULER_CONTRADICTED).toBe(4);
    expect(metrics.NODE_SNAPSHOTS_RAW).toBe(30);
    expect(metrics.NODE_SNAPSHOTS_AFTER_COMPACTION).toBe(6);
    expect(metrics.SKILL_LOADOUT_REPLAYS).toBe(6);
    expect(metrics.ESTIMATED_SKILL_OVERHEAD_REDUCTION).toBe(6 * 500);
    expect(metrics.TELEMETRY_STORAGE_GROWTH).toBe(42000);
    expect(EVALUATION_REPORT_SCHEMA_VERSION).toBe(1);
  });

  it("reports the boundary facts, which is how the safety claims are checked", () => {
    const metrics = buildEvaluationReport(readyInput()).metrics;
    expect(metrics.ROOT_TRUST_TOUCHED).toBe("NO");
    expect(metrics.QUALIFICATION_TOUCHED).toBe("NO");
    expect(metrics.OWNER_REVIEW_PATHS).toBe("none");
    const touched = buildEvaluationReport({ generatedAt: AT, boundary: { ...boundary, rootTrustTouched: true, qualificationTouched: true, ownerReviewPaths: ["trust-policy/trust-epoch.json"], authorityDecision: "REQUIRE_OWNER" } });
    expect(touched.metrics.ROOT_TRUST_TOUCHED).toBe("YES");
    expect(touched.metrics.QUALIFICATION_TOUCHED).toBe("YES");
    expect(touched.metrics.OWNER_REVIEW_PATHS).toBe("trust-policy/trust-epoch.json");
    expect(touched.notes.join(" ")).toContain("REQUIRE_OWNER");
  });

  it("reports the sample counts behind every claim", () => {
    const report = buildEvaluationReport(readyInput());
    expect(report.samples).toMatchObject({ ingestedOutcomes: 40, schedulerCases: 25, schedulerCasesWithOutcome: 25, skillReplays: 6, skillReplaysWithUsage: 6, nodeSamples: 30, calibrationSamples: 20 });
  });

  it("records that a real continuation replay is impossible from the recorded data", () => {
    const report = buildEvaluationReport({ ...readyInput(), continuation: undefined, continuationReplayPossible: false });
    expect(report.notes.join(" ")).toContain("per-step completion state is not recorded");
    expect(report.metrics.FALSE_STOP_RATE).toBe("NOT_MEASURED");
    expect(report.readiness).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("reports ingestion degradation instead of hiding it", () => {
    const input = readyInput();
    input.ingestion = { considered: 10, ingested: 5, charged: 2, refused: 3, domains: { MODEL: 2 }, degraded: ["telemetry could not be read: bad row"], sources: [{ name: "telemetry", present: true, records: 5, degradedReason: "bad row" }] };
    const report = buildEvaluationReport(input);
    expect(report.notes.join(" ")).toContain("ingestion was degraded");
  });
});
