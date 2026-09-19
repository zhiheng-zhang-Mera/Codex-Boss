import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  continuationStepsFromCorpus,
  schedulerCasesFromCorpus,
  type ContinuationStepsFromCorpus,
  type SchedulerCasesFromCorpus
} from "../../../electron/runtime-intelligence/replay-cases";
import { benchmarkContinuation } from "../../../src/shared/runtime-intelligence/continuation-benchmark";
import { benchmarkScheduler } from "../../../src/shared/runtime-intelligence/scheduler-benchmark";
import { exportReplayCorpus, locateRealDataRoots } from "../../../electron/runtime-intelligence/replay-corpus-io";
import { createReplayCorpus, type ReplayCorpus, type ReplayCorpusRecord } from "../../../src/shared/runtime-intelligence/replay-corpus";
import { measured, notMeasured, unknown, type Measurement } from "../../../src/shared/runtime-intelligence/measurement";
import type { FailureDomain, TaskKind } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase N9. The adapters are where real behaviour meets the benchmarks, so the properties that
 * matter are that the walk-forward never sees a future outcome, that the model identity is
 * derived once for both sides of a comparison, and that the real corpus actually produces cases.
 */

const AT = "2026-01-01T00:00:00.000Z";

function record(overrides: {
  recordId: string;
  taskId?: string;
  step: number;
  at: string;
  provider?: Measurement<string>;
  runtimeId?: Measurement<string>;
  pending?: number;
  completed?: number;
  outcome?: Measurement<"SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "CANCELLED">;
  domain?: Measurement<FailureDomain>;
  taskComplete?: boolean;
  continued?: boolean;
  taskSucceeded?: boolean;
  tokens?: number;
  /** Worker-session providers recorded at this step, which is the direct attribution evidence. */
  sessions?: string[];
}): ReplayCorpusRecord {
  return {
    schemaVersion: 1,
    recordId: overrides.recordId,
    taskId: overrides.taskId ?? "task-a",
    taskKind: "other" as TaskKind | "unknown",
    role: unknown("not recorded"),
    sourceTimestamp: overrides.at,
    atDecisionTime: {
      stepIndex: overrides.step,
      unresolvedCount: overrides.pending ?? 1,
      completedCount: overrides.completed ?? 0,
      provider: overrides.provider ?? measured("chatgpt", "state.json", overrides.at),
      runtimeId: overrides.runtimeId ?? measured("web:chatgpt", "state.json", overrides.at),
      modelKey: unknown("no model id"),
      nodeId: unknown("no node"),
      mountedSkills: [],
      usedSkills: [],
      contextInjected: [],
      workerSessions: overrides.sessions ?? [],
      tokensConsumed: overrides.tokens ?? 10,
      toolCalls: 0,
      browserActions: 0,
      elapsedMs: 100
    },
    afterDecision: {
      finalOutcome: overrides.outcome ?? measured("SUCCESS", "state.json runs[].outcome", overrides.at),
      reviewOutcome: measured("NOT_RUN", "checkpoint", overrides.at),
      taskComplete: overrides.taskComplete ?? false,
      continuedAfterStep: overrides.continued ?? true,
      taskSucceeded: overrides.taskSucceeded ?? true,
      measuredLatencyMs: notMeasured("not recorded"),
      measuredCostUsd: notMeasured("a web transport records no cost"),
      failureDomain: overrides.domain ?? notMeasured("no failure recorded")
    },
    completionEvidence: measured(`revision ${overrides.step}`, "checkpoint", overrides.at)
  };
}

function corpusOf(records: ReplayCorpusRecord[]): ReplayCorpus {
  const provenance = { kind: "CONTROL_FIXTURE" as const, sourceHost: "test", sourceRoot: "/test", exportedAt: AT, exporter: "test/1", sanitized: true, redactedFields: [] };
  return { ...createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), records };
}

/** Two tasks, the second later, so ordering and the walk are both exercised. */
function syntheticCorpus(): ReplayCorpus {
  return corpusOf([
    record({ recordId: "a:1", step: 1, at: "2026-01-01T00:00:00.000Z", pending: 0, completed: 0, continued: true, taskComplete: false }),
    record({ recordId: "a:2", step: 2, at: "2026-01-01T00:01:00.000Z", pending: 2, completed: 0, continued: true, taskComplete: false }),
    record({ recordId: "a:3", step: 3, at: "2026-01-01T00:02:00.000Z", pending: 0, completed: 2, continued: false, taskComplete: true }),
    record({ recordId: "b:1", taskId: "task-b", step: 1, at: "2026-01-01T00:03:00.000Z", provider: measured("qwen", "state.json", "2026-01-01T00:03:00.000Z"), runtimeId: measured("web:qwen", "state.json", "2026-01-01T00:03:00.000Z"), pending: 1, completed: 0, continued: false, taskComplete: false, outcome: notMeasured("never finished") })
  ]);
}

describe("continuation steps come from the real evaluator and the loop's own state", () => {
  it("builds one judged step per record and derives progress from the work list", () => {
    const result: ContinuationStepsFromCorpus = continuationStepsFromCorpus(syntheticCorpus());
    expect(result.steps).toHaveLength(4);
    expect(result.skipped).toEqual([]);
    expect(result.steps.map((step) => step.step)).toEqual([1, 2, 3, 1]);
    expect(result.steps.every((step) => step.assessment.mode === "SHADOW_ONLY")).toBe(true);
  });

  it("declares its inputs, so the guard has something to check", () => {
    for (const step of continuationStepsFromCorpus(syntheticCorpus()).steps) {
      expect(step.inputDeclaration?.fields.length).toBeGreaterThan(0);
      expect(step.inputDeclaration?.fields).not.toContain("taskComplete");
    }
  });

  it("names the signals the corpus cannot supply rather than defaulting them to zero", () => {
    const result = continuationStepsFromCorpus(syntheticCorpus());
    expect(result.unavailableSignals).toContain("outputNovelty");
    expect(result.unavailableSignals).toContain("repeatRate");
    const factors = result.steps[1].assessment.factors.map((factor) => factor.factor);
    expect(factors).toContain("continuation.uncertainty-not-measured");
  });

  it("skips a record that does not carry both work counts instead of inventing a zero", () => {
    const withoutCounts = corpusOf([{ ...record({ recordId: "x:1", step: 1, at: AT }), atDecisionTime: { ...record({ recordId: "x:1", step: 1, at: AT }).atDecisionTime, unresolvedCount: undefined, completedCount: undefined } }]);
    const result = continuationStepsFromCorpus(withoutCounts);
    expect(result.steps).toHaveLength(0);
    expect(result.skipped[0].reason).toContain("does not carry both the open and the completed work counts");
  });

  it("reads the observed behaviour from the target section, not the input", () => {
    const result = continuationStepsFromCorpus(syntheticCorpus());
    expect(result.steps[2].observed).toBe("STOPPED");
    expect(result.steps[2].taskComplete).toBe(true);
    expect(result.steps[0].observed).toBe("CONTINUED");
  });

  it("feeds the benchmark with steps it can judge", () => {
    const metrics = benchmarkContinuation(continuationStepsFromCorpus(syntheticCorpus()).steps);
    expect(metrics.steps).toBe(4);
    expect(metrics.judgedSteps).toBe(4);
    expect(metrics.invalidCases).toBe(0);
  });
});

describe("the scheduler replay walks forward and derives one identity", () => {
  it("advises from earlier records only, never from the record's own outcome", () => {
    const result: SchedulerCasesFromCorpus = schedulerCasesFromCorpus(syntheticCorpus());
    expect(result.cases).toHaveLength(4);
    // The first case's candidate ledger cannot contain evidence, because nothing preceded it.
    const firstRecommendation = result.cases[0].recommendation;
    expect(firstRecommendation?.preferredModel?.confidence).toBe(0);
    // By the last case, earlier outcomes have been folded in, so the ledger has samples.
    expect(result.ledger.some((model) => Object.values(model.scores).some((estimate) => estimate.samples > 0))).toBe(true);
    expect(result.notes.join(" ")).toContain("only after advising on it");
  });

  it("uses one identity for both the recommendation and the actual model", () => {
    const result = schedulerCasesFromCorpus(syntheticCorpus());
    const first = result.cases[0];
    expect(first.observation.model.modelKey).toBe("chatgpt:web:chatgpt:unknown");    // The advisor's candidate list is keyed the same way, so agreement is a real comparison:
    // three of the four cases agree, and the fourth is the qwen dispatch whose run never
    // finished — it is INCONCLUSIVE rather than scored, and the disagreement is visible in the
    // agreement rate.
    expect(result.ledger.map((model) => model.modelKey)).toContain("chatgpt:web:chatgpt:unknown");
    const metrics = benchmarkScheduler(result.cases);
    expect(metrics.modelAgreementRate).toBe(0.75);
    expect(metrics.verdicts.SUPPORTED).toBe(3);
    expect(metrics.verdicts.INCONCLUSIVE).toBe(1);
    expect(metrics.verdicts.NOT_FOLLOWED).toBe(0);
  });

  it("marks every case with a declaration the guard accepts", () => {
    const metrics = benchmarkScheduler(schedulerCasesFromCorpus(syntheticCorpus()).cases);
    expect(metrics.invalidCases).toBe(0);
  });

  it("leaves an unfinished run's outcome unmeasured rather than scored as a failure", () => {
    const result = schedulerCasesFromCorpus(syntheticCorpus());
    const forTaskB = result.cases.find((entry) => entry.taskId.startsWith("task-b"));
    expect(forTaskB?.observation.execution.outcome).toBe("UNKNOWN");
    expect(forTaskB?.observation.execution.failureDomain).toBeUndefined();
  });

  it("falls back to a task-level attribution and says so, rather than dropping the step", () => {
    const noSessions = corpusOf([record({ recordId: "a:1", step: 1, at: AT, sessions: [] })]);
    const result = schedulerCasesFromCorpus(noSessions);
    expect(result.cases).toHaveLength(1);
    expect(result.attributions[0].attributionSource).toBe("TASK_FALLBACK");
    expect(result.census.bySource.TASK_FALLBACK).toBe(1);
    expect(result.census.directCount).toBe(0);
    expect(result.census.notes.join(" ")).toContain("must not be reported as per-dispatch evidence");
    expect(result.directCases).toHaveLength(0);
  });

  it("produces direct attribution from the step's own worker sessions", () => {
    const withSessions = corpusOf([record({ recordId: "a:1", step: 1, at: AT, sessions: ["web:chatgpt", "web:qwen", "web:grok"] })]);
    const result = schedulerCasesFromCorpus(withSessions);
    // Three worker sessions are three dispatch decisions, not one ambiguous one.
    expect(result.cases).toHaveLength(3);
    expect(result.census.bySource.DIRECT_CHECKPOINT).toBe(3);
    expect(result.census.directCount).toBe(3);
    expect(result.census.providers).toEqual(["web:chatgpt", "web:grok", "web:qwen"]);
    expect(result.directCases).toHaveLength(3);
  });

  it("records UNKNOWN when a step names no provider at all", () => {
    const nothing = corpusOf([record({ recordId: "a:1", step: 1, at: AT, provider: notMeasured("no provider"), runtimeId: notMeasured("no runtime"), sessions: [] })]);
    const result = schedulerCasesFromCorpus(nothing);
    expect(result.cases).toHaveLength(0);
    expect(result.census.bySource.UNKNOWN).toBe(1);
    expect(result.notes.join(" ")).toContain("no dispatched provider at all");
  });

  it("processes records in source-timestamp order regardless of array order", () => {
    const shuffled = corpusOf([
      record({ recordId: "a:3", step: 3, at: "2026-01-01T00:02:00.000Z", pending: 0, completed: 2, continued: false, taskComplete: true }),
      record({ recordId: "a:1", step: 1, at: "2026-01-01T00:00:00.000Z", pending: 1, completed: 0 }),
      record({ recordId: "a:2", step: 2, at: "2026-01-01T00:01:00.000Z", pending: 1, completed: 0 })
    ]);
    const result = schedulerCasesFromCorpus(shuffled);
    expect(result.cases.map((entry) => entry.observation.observationId)).toEqual(["corpus:a:1", "corpus:a:2", "corpus:a:3"]);
  });
});

describe("the real corpus produces real replay cases", () => {
  const survey = locateRealDataRoots({ repositoryRoot: path.resolve(__dirname, "..", "..", "..") });

  it("replays this host's real corpus when one exists", () => {
    if (survey.recommended === undefined) {
      expect(survey.explanation).toContain("no root holds");
      return;
    }
    const exported = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    const continuation = continuationStepsFromCorpus(exported.corpus);
    const scheduler = schedulerCasesFromCorpus(exported.corpus);
    expect(continuation.steps.length).toBeGreaterThan(0);
    expect(scheduler.cases.length).toBeGreaterThan(0);

    const continuationMetrics = benchmarkContinuation(continuation.steps);
    const schedulerMetrics = benchmarkScheduler(scheduler.cases);
    // Whatever the numbers are, the pipeline must produce judged cases with nothing invalid and
    // nothing leaked — that is the property this test exists for.
    expect(continuationMetrics.invalidCases).toBe(0);
    expect(schedulerMetrics.invalidCases).toBe(0);
    expect(continuationMetrics.judgedSteps).toBe(continuation.steps.length);
    expect(continuationMetrics.falseStopRate === undefined || continuationMetrics.falseStopRate >= 0).toBe(true);
  });
});
