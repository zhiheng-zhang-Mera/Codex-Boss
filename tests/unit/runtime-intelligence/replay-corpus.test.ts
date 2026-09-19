import { describe, expect, it } from "vitest";
import {
  AFTER_DECISION_ONLY_FIELDS,
  AT_DECISION_TIME_FIELDS,
  REPLAY_CORPUS_GUARANTEES,
  REPLAY_CORPUS_KIND,
  REPLAY_CORPUS_SCHEMA_VERSION,
  appendReplayRecords,
  createReplayCorpus,
  splitCorpusRecords,
  summariseReplayCorpus,
  validateReplayCorpus,
  type AfterDecision,
  type AtDecisionTime,
  type CorpusSplit,
  type ReplayCorpus,
  type ReplayCorpusRecord,
  type ReplayCorpusSummary,
  type ReplayProvenance,
  type ReplayProvenanceKind,
  type StepCompletionObservation
} from "../../../src/shared/runtime-intelligence/replay-corpus";
import {
  TEMPORAL_VERDICTS,
  assertNoFutureInformation,
  checkCorpus,
  checkCorpusRecord,
  checkInputForFutureInformation,
  checkReplayInput,
  type ReplayInputDeclaration,
  type TemporalCheck,
  type TemporalVerdict
} from "../../../src/shared/runtime-intelligence/temporal-guard";
import { measured, notMeasured, unavailable, unknown, type Measurement } from "../../../src/shared/runtime-intelligence/measurement";
import type { FailureDomain } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phases N3 and N7. The corpus contract carries absences instead of zeros, and the temporal
 * guard has to catch leakage three ways: a forbidden key in the input, a shared object
 * between the two sections, and an undeclared or dishonest input declaration.
 */

const AT = "2026-01-01T00:00:00.000Z";

const provenance: ReplayProvenance = {
  kind: "SANITIZED_EXPORT",
  sourceHost: "test-host",
  sourceRoot: "/data",
  exportedAt: AT,
  exporter: "test-exporter/1",
  sanitized: true,
  redactedFields: ["objective", "inputPrompt"]
};

function atDecisionTime(overrides: Partial<AtDecisionTime> = {}): AtDecisionTime {
  return {
    stepIndex: 3,
    unresolvedCount: 2,
    completedCount: 1,
    provider: measured("chatgpt", "test", AT),
    runtimeId: measured("web:chatgpt", "test", AT),
    modelKey: unknown("web transport does not expose a model id"),
    nodeId: unknown("no node profiler in this export"),
    mountedSkills: [],
    usedSkills: [],
    contextInjected: [],
    tokensConsumed: 15,
    toolCalls: 0,
    browserActions: 0,
    elapsedMs: 1000,
    ...overrides
  };
}

function afterDecision(overrides: Partial<AfterDecision> = {}): AfterDecision {
  return {
    finalOutcome: measured("SUCCESS", "task-store", AT),
    reviewOutcome: measured("NOT_RUN", "checkpoint", AT),
    taskComplete: false,
    continuedAfterStep: true,
    taskSucceeded: true,
    measuredLatencyMs: notMeasured("the loop did not record a duration"),
    measuredCostUsd: unavailable("cost is not exposed by a web transport"),
    failureDomain: notMeasured("the run did not fail"),
    ...overrides
  };
}

function record(overrides: Partial<ReplayCorpusRecord> = {}): ReplayCorpusRecord {
  return {
    schemaVersion: REPLAY_CORPUS_SCHEMA_VERSION,
    recordId: "rec-1",
    taskId: "task-1",
    taskKind: "other",
    role: unknown("the export does not record a role"),
    sourceTimestamp: AT,
    atDecisionTime: atDecisionTime(),
    afterDecision: afterDecision(),
    completionEvidence: measured("checkpoint revision 3", "checkpoint", AT),
    ...overrides
  };
}

describe("the corpus carries absences rather than zeros", () => {
  it("declares its guarantees literally, so a corpus cannot be read as a way into production", () => {
    expect(REPLAY_CORPUS_GUARANTEES).toEqual({
      mutatesProductionTaskHistory: false,
      mutatesProviderState: false,
      mutatesCredentials: false,
      mutatesTrustEvidence: false,
      mutatesModelLedger: false
    });
    expect(REPLAY_CORPUS_KIND).toBe("RUNTIME_INTELLIGENCE_REPLAY_CORPUS");
    expect(REPLAY_CORPUS_SCHEMA_VERSION).toBe(1);
    const kind: ReplayProvenanceKind = provenance.kind;
    expect(kind).toBe("SANITIZED_EXPORT");
  });

  it("carries the loop's own step completion as a first-class part of the record", () => {
    const completion: StepCompletionObservation = { stepIndex: 3, taskComplete: false, unresolvedCount: 2, terminationReason: "CONTINUE", continuedAfterStep: true, finalOutcomeKnown: true };
    expect(completion.continuedAfterStep).toBe(true);
    expect(completion.unresolvedCount).toBe(2);
  });

  it("separates the input vocabulary from the post-decision vocabulary with no overlap", () => {
    for (const field of AT_DECISION_TIME_FIELDS) expect(AFTER_DECISION_ONLY_FIELDS).not.toContain(field);
    expect(AFTER_DECISION_ONLY_FIELDS).toContain("finalOutcome");
    expect(AT_DECISION_TIME_FIELDS).toContain("unresolvedCount");
  });

  it("accepts a well-formed corpus", () => {
    const corpus = createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance });
    const appended = appendReplayRecords(corpus, [record()]);
    const result = validateReplayCorpus(appended.corpus);
    expect(result.problems).toEqual([]);
    expect(result.corpus?.records).toHaveLength(1);
  });

  it("rejects an unknown schema version and a wrong kind", () => {
    expect(validateReplayCorpus({ schemaVersion: 99, kind: REPLAY_CORPUS_KIND }).problems[0]).toContain("schemaVersion");
    expect(validateReplayCorpus({ schemaVersion: 1, kind: "SOMETHING_ELSE" }).problems[0]).toContain("kind");
  });

  it("requires a reason on every absent measurement", () => {
    const broken = { ...record(), afterDecision: { ...afterDecision(), measuredLatencyMs: { status: "NOT_MEASURED" } } };
    const corpus = appendReplayRecords(createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), [broken as unknown as ReplayCorpusRecord]).corpus;
    const problems = validateReplayCorpus(corpus).problems;
    expect(problems.join(" ")).toContain("NOT_MEASURED without a reason");
  });

  it("rejects a field that is absent without a status at all", () => {
    const broken = { ...record(), afterDecision: { ...afterDecision(), failureDomain: 0 } };
    const corpus = appendReplayRecords(createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), [broken as unknown as ReplayCorpusRecord]).corpus;
    expect(validateReplayCorpus(corpus).problems.join(" ")).toContain("failureDomain must be a measurement object");
  });

  it("requires provenance, because a corpus without it is not evidence", () => {
    const corpus = { schemaVersion: 1, kind: REPLAY_CORPUS_KIND, corpusId: "c", createdAt: AT, records: [] };
    const problems = validateReplayCorpus(corpus).problems;
    expect(problems.join(" ")).toContain("provenance is missing");
  });

  it("appends idempotently by record id, so a re-import cannot inflate a sample count", () => {
    const corpus = createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance });
    const first = appendReplayRecords(corpus, [record(), record({ recordId: "rec-2" })]);
    expect(first.added).toBe(2);
    const second = appendReplayRecords(first.corpus, [record(), record({ recordId: "rec-3" })]);
    expect(second.added).toBe(1);
    expect(second.skippedDuplicates).toEqual(["rec-1"]);
    expect(second.corpus.records).toHaveLength(3);
  });

  it("summarises by observed state, keeping unmeasured outcomes visible", () => {
    const corpus = appendReplayRecords(createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), [
      record(),
      record({
        recordId: "rec-2",
        taskId: "task-2",
        afterDecision: afterDecision({ finalOutcome: notMeasured("the run never finished"), failureDomain: measured<FailureDomain>("NETWORK", "reason", AT) }),
        completionEvidence: notMeasured("no checkpoint survives")
      })
    ]).corpus;
    const summary: ReplayCorpusSummary = summariseReplayCorpus(corpus);
    expect(summary.records).toBe(2);
    expect(summary.tasks).toBe(2);
    expect(summary.recordsWithOutcome).toBe(1);
    expect(summary.recordsWithCompletionEvidence).toBe(1);
    expect(summary.outcomes).toEqual({ SUCCESS: 1, NOT_MEASURED: 1 });
    expect(summary.failureDomains).toEqual({ NETWORK: 1, NOT_MEASURED: 1 });
    expect(summary.redactedFields).toEqual(["objective", "inputPrompt"]);
  });

  it("validates a record whose completion evidence is absent", () => {
    const corpus = appendReplayRecords(createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), [record({ completionEvidence: notMeasured("no checkpoints for this task") })]).corpus;
    expect(validateReplayCorpus(corpus).problems).toEqual([]);
  });
});

describe("the temporal guard catches leakage three ways", () => {
  it("passes a clean input and a clean record", () => {
    expect(checkInputForFutureInformation({ stepIndex: 3, unresolvedCount: 2, provider: measured("p", "t", AT) }).verdict).toBe("NO_FUTURE_INFORMATION");
    expect(checkCorpusRecord(record()).verdict).toBe("NO_FUTURE_INFORMATION");
    const check: TemporalCheck = checkReplayInput({ fields: ["stepIndex", "unresolvedCount"] });
    expect(check.verdict).toBe("NO_FUTURE_INFORMATION");
    expect(check.leakedFields).toEqual([]);
  });

  it("catches a post-decision key in the input, at any depth", () => {
    const shallow = checkInputForFutureInformation({ stepIndex: 1, finalOutcome: "SUCCESS" });
    expect(shallow.verdict).toBe("INVALID_REPLAY_CASE");
    expect(shallow.leakedFields).toEqual(["finalOutcome"]);
    expect(shallow.reasons.join(" ")).toContain("cannot predict it");
    // Wrapped in an array, which a naive top-level check would miss.
    const deep = checkInputForFutureInformation({ stepIndex: 1, context: [{ nested: { taskSucceeded: true } }] });
    expect(deep.verdict).toBe("INVALID_REPLAY_CASE");
    expect(deep.leakedFields).toEqual(["taskSucceeded"]);
  });

  it("catches a shared object between the input and the target", () => {
    const shared = { finalOutcome: "SUCCESS" };
    const tainted = { ...record(), atDecisionTime: { ...atDecisionTime(), context: shared } as unknown as AtDecisionTime, afterDecision: { ...afterDecision() } };
    // The input does not NAME a post-decision field, but it reaches one by reference.
    const byReference = { ...tainted, atDecisionTime: { ...atDecisionTime(), carried: shared } as unknown as AtDecisionTime, afterDecision: { ...afterDecision(), finalOutcome: shared } as unknown as AfterDecision };
    const check = checkCorpusRecord(byReference as ReplayCorpusRecord);
    // `finalOutcome` appears as a key inside the input too, so it is caught either way.
    expect(check.verdict).toBe("INVALID_REPLAY_CASE");
    expect(check.leakedFields).toContain("finalOutcome");
  });

  it("catches reference leakage even when no forbidden key name is present", () => {
    const carried = { note: "shared" };
    const recordWithReference = {
      ...record(),
      atDecisionTime: { ...atDecisionTime(), carried } as unknown as AtDecisionTime,
      afterDecision: { ...afterDecision(), extra: carried } as unknown as AfterDecision
    };
    const check = checkCorpusRecord(recordWithReference as ReplayCorpusRecord);
    expect(check.verdict).toBe("INVALID_REPLAY_CASE");
    expect(check.reasons.join(" ")).toContain("share an object");
    expect(check.leakedFields).toEqual([]);
  });

  it("treats an undeclared input as unproven rather than clean", () => {
    const check = checkReplayInput(undefined);
    expect(check.verdict).toBe("INVALID_REPLAY_CASE");
    expect(check.reasons.join(" ")).toContain("cannot be shown to be at-decision-time");
  });

  it("catches a declaration that admits to using the outcome", () => {
    const declaration: ReplayInputDeclaration = { fields: ["stepIndex", "finalOutcome"], label: "the advice" };
    const check = checkReplayInput(declaration);
    expect(check.verdict).toBe("INVALID_REPLAY_CASE");
    expect(check.leakedFields).toEqual(["finalOutcome"]);
    expect(check.reasons.join(" ")).toContain("the advice declared");
  });

  it("catches a declaration whose sample object carries the outcome", () => {
    const check = checkReplayInput({ fields: ["stepIndex"], sample: { nested: { measuredCostUsd: 1 } } });
    expect(check.verdict).toBe("INVALID_REPLAY_CASE");
    expect(check.leakedFields).toEqual(["measuredCostUsd"]);
  });

  it("separates valid records from invalid ones so one bad export cannot poison a benchmark", () => {
    const tainted = { ...record({ recordId: "bad" }), atDecisionTime: { ...atDecisionTime(), taskComplete: true } as unknown as AtDecisionTime };
    const result = checkCorpus([record(), tainted as ReplayCorpusRecord]);
    expect(result.valid.map((entry) => entry.recordId)).toEqual(["rec-1"]);
    expect(result.invalid[0].recordId).toBe("bad");
    expect(result.invalid[0].check.verdict).toBe("INVALID_REPLAY_CASE");
  });

  it("throws rather than emitting a tainted record", () => {
    expect(() => assertNoFutureInformation({ stepIndex: 1, continuedAfterStep: true }, "the case")).toThrow(/temporal leakage/);
    expect(() => assertNoFutureInformation({ stepIndex: 1 })).not.toThrow();
  });

  it("declares its two verdicts", () => {
    expect(TEMPORAL_VERDICTS).toEqual(["NO_FUTURE_INFORMATION", "INVALID_REPLAY_CASE"]);
    const verdict: TemporalVerdict = "INVALID_REPLAY_CASE";
    expect(TEMPORAL_VERDICTS).toContain(verdict);
  });

  it("does not treat a measured allowance as leakage: unresolvedCount is known at decision time", () => {
    const fact: Measurement<number> = measured(2, "checkpoint", AT);
    expect(checkInputForFutureInformation({ unresolvedCount: fact }).verdict).toBe("NO_FUTURE_INFORMATION");
  });
});

describe("the corpus splits by task, not by step", () => {
  function multiTaskCorpus(taskCount: number, stepsPerTask: number): ReplayCorpus {
    const records: ReplayCorpusRecord[] = [];
    for (let task = 1; task <= taskCount; task += 1) {
      for (let step = 1; step <= stepsPerTask; step += 1) {
        records.push(record({ recordId: `t${task}:rev${step}`, taskId: `task-${task}`, atDecisionTime: { ...atDecisionTime({ stepIndex: step }) } }));
      }
    }
    return appendReplayRecords(createReplayCorpus({ corpusId: "c", createdAt: AT, provenance }), records).corpus;
  }

  it("keeps whole tasks together, so no task is on both sides", () => {
    const split: CorpusSplit = splitCorpusRecords(multiTaskCorpus(5, 4).records, { devTaskCount: 3 });
    expect(split.strategy).toBe("BY_TASK");
    expect(split.devTaskIds).toEqual(["task-1", "task-2", "task-3"]);
    expect(split.holdoutTaskIds).toEqual(["task-4", "task-5"]);
    const devTasks = new Set(split.dev.map((entry) => entry.taskId));
    const holdoutTasks = new Set(split.holdout.map((entry) => entry.taskId));
    for (const taskId of devTasks) expect(holdoutTasks.has(taskId)).toBe(false);
    expect(split.note).toContain("holdout outcomes were not read");
  });

  it("is deterministic and splits by default at about sixty per cent", () => {
    const records = multiTaskCorpus(10, 2).records;
    const first = splitCorpusRecords(records);
    const second = splitCorpusRecords(records);
    expect(first.devTaskIds).toEqual(second.devTaskIds);
    expect(first.devTaskIds).toHaveLength(6);
    expect(first.holdoutTaskIds).toHaveLength(4);
  });

  it("always leaves at least one task in the holdout, and one in development", () => {
    const split = splitCorpusRecords(multiTaskCorpus(3, 1).records, { devTaskCount: 99 });
    expect(split.devTaskIds).toHaveLength(2);
    expect(split.holdoutTaskIds).toHaveLength(1);
  });

  it("says so when a corpus is too small to hold anything out", () => {
    const single = splitCorpusRecords(multiTaskCorpus(1, 3).records);
    expect(single.strategy).toBe("SINGLE_TASK_ONLY");
    expect(single.holdout).toEqual([]);
    expect(single.note).toContain("one task");
    const empty = splitCorpusRecords([]);
    expect(empty.strategy).toBe("SINGLE_TASK_ONLY");
    expect(empty.note).toContain("no records");
  });
});

describe("a corpus round-trips through JSON without losing an absence", () => {
  it("survives serialisation and validation", () => {
    const corpus: ReplayCorpus = appendReplayRecords(createReplayCorpus({ corpusId: "c1", createdAt: AT, provenance }), [
      record({ afterDecision: afterDecision({ measuredCostUsd: notMeasured("web transport exposes no cost"), failureDomain: measured<FailureDomain>("NETWORK", "run reason", AT) }) })
    ]).corpus;
    const text = JSON.stringify(corpus);
    const parsed = JSON.parse(text) as unknown;
    const result = validateReplayCorpus(parsed);
    expect(result.problems).toEqual([]);
    const restored = result.corpus!.records[0];
    expect(restored.afterDecision.measuredCostUsd.status).toBe("NOT_MEASURED");
    expect(restored.afterDecision.measuredCostUsd).not.toEqual(measured(0, "x", AT));
    expect(restored.afterDecision.failureDomain).toEqual(measured("NETWORK", "run reason", AT));
    expect(checkCorpusRecord(restored).verdict).toBe("NO_FUTURE_INFORMATION");
  });
});
