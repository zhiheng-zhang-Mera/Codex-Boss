import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainEventBus } from "../../../electron/commander/event-bus";
import { TaskLedger } from "../../../electron/commander/task-ledger";
import {
  EVIDENCE_RECORD_KINDS,
  LIVE_CAPTURE_SCHEMA_VERSION,
  LIVE_FUTURE_FIELD_CHECK,
  NO_SKILL_RUNTIME_SIGNAL,
  continuationAdviceOf,
  dispatchRecordsOf,
  finalOutcomeOf,
  headlineCaptureMetrics,
  isTerminalCaptureStatus,
  latencyOf,
  liveEventId,
  providerEventOf,
  schedulerAdviceOf,
  skillSignalOf,
  stepObservationOf,
  usageOf,
  type ContinuationAdviceCapture,
  type EvidenceRecordKind,
  type FinalOutcomeEvidence,
  type HeadlineCaptureMetrics,
  type LiveDispatchRecord,
  type LiveLatencyRecord,
  type LiveLedgerFacts,
  type LiveSkillRecord,
  type LiveStepObservation,
  type LiveUsageRecord,
  type ProspectiveProviderEvent,
  type SchedulerAdviceCapture,
  type StepObservationResult
} from "../../../src/shared/runtime-intelligence/live-capture";
import {
  CAPTURE_EVENT_ID_LIMIT,
  PROSPECTIVE_WINDOW_SCHEMA_VERSION,
  appendProspectiveObservation,
  appendProviderEvent,
  deriveWindowOutcome,
  markCaptureEvent,
  openProspectiveRecord,
  prospectiveHeadline,
  prospectivePolicyIdentity,
  type ProspectivePolicyIdentity,
  type ProspectiveWindowRecord
} from "../../../src/shared/runtime-intelligence/prospective-window";
import { frozenContinuationPolicy } from "../../../src/shared/runtime-intelligence/policy-registry";

/**
 * The live shadow capture.
 *
 * Three kinds of test, and the third is the one that matters most:
 *
 *   - the pure derivations, pinned field by field on real-shaped ledger facts;
 *   - the adapter against a real `TaskLedger` on a temporary root, so the observation path is the
 *     ledger's own write path rather than a fixture;
 *   - failure injection, where the capture is broken on purpose and the assertion is that the
 *     LEDGER still wrote its checkpoint. `CAPTURE_FAILS` and `EXECUTION_CONTINUES` are one test,
 *     not two, because the second is worthless without the first.
 */

const AFTER_FREEZE = "2026-09-20T00:00:00.000Z";
const BEFORE_FREEZE = "2026-09-01T00:00:00.000Z";
const AT = "2026-09-20T10:00:00.000Z";

const dirs: string[] = [];
function makeRoot(prefix = "boss-live-capture-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** A checkpoint as the task ledger really writes it, with the fields the capture reads. */
function ledgerFacts(overrides: Partial<LiveLedgerFacts> = {}): LiveLedgerFacts {
  return {
    taskId: "task-1",
    revision: 3,
    completedSteps: ["step-a"],
    pendingSteps: ["step-b"],
    nextAction: "DISPATCHING",
    checkpointReason: "task/run transition",
    activeProvider: "web:chatgpt",
    verificationState: "NOT_RUN",
    sessions: [{ id: "run-1", provider: "web:chatgpt", checkpoint: 3, health: "SUCCESS" }],
    jobs: { "job-1": { id: "job-1", state: "COMPLETED", attempts: 1, sessionId: "run-1", startedAt: "2026-09-20T09:59:00.000Z", completedAt: "2026-09-20T09:59:30.000Z" } },
    usage: { modelCalls: 1, providerInputTokens: 120, providerOutputTokens: 30, estimatedInputTokens: 480, estimatedOutputTokens: 90, toolCalls: 2, browserActions: 1, retries: 0, workerRuntimeMs: 0, providerWaitMs: 0 },
    ...overrides
  };
}

function build(overrides: Partial<LiveLedgerFacts> = {}, extra: { capturedAt?: string; previousCapturedAt?: string } = {}): LiveStepObservation {
  const result = stepObservationOf({
    facts: ledgerFacts(overrides),
    capturedAt: extra.capturedAt ?? AT,
    ...(extra.previousCapturedAt === undefined ? {} : { previousCapturedAt: extra.previousCapturedAt }),
    sourceClass: "REAL_USER_TASK"
  });
  if (result.observation === undefined) throw new Error(`the observation was refused: ${result.problems.join("; ")}`);
  return result.observation;
}


/**
 * RI-03: the prospective vocabulary, on real-shaped facts.
 *
 * This is the pure-module half of the capture suite. The host half — the ledger wrapper, the bus
 * attachment, the failure injection and the smoke walk — belongs to the capture layer and is added
 * by RI-04, which carries the reference branch's file verbatim.
 */

describe("a live decision record carries only what the loop knew at the time", () => {
  it("derives the completion statement from the counts rather than receiving it", () => {
    const midTask = build();
    expect(midTask.objectiveComplete).toBe(false);
    expect(midTask.recordKind).toBe("DECISION_TIME_RECORD");
    expect(midTask.derivedFrom).not.toContain("taskComplete");
    expect(midTask.derivedFrom).not.toContain("finalOutcome");
    expect(midTask.temporalVerdict).toBe("NO_FUTURE_INFORMATION");
    // The counts and the reason are the evidence, and they are in the record verbatim.
    expect(midTask.completedCount).toBe(1);
    expect(midTask.pendingCount).toBe(1);
    expect(midTask.completionEvidence).toContain("pending 1, completed 1");

    const finished = build({ completedSteps: ["step-a", "step-b"], pendingSteps: [], nextAction: "REPORT_EVIDENCE" });
    expect(finished.objectiveComplete).toBe(true);
  });

  it("does not read the compile checkpoint as completion", () => {
    const compile = build({ revision: 1, completedSteps: [], pendingSteps: [], nextAction: "COMPILE", checkpointReason: "task compiled", sessions: [], jobs: {} });
    expect(compile.objectiveComplete).toBe(false);
    expect(compile.completionEvidence).toContain("compile step");
  });

  it("refuses a snapshot that carries a post-decision field, and names it", () => {
    // A caller cannot make the advisor see the outcome: the snapshot is scanned before anything
    // is computed, and a leaked name produces a refusal rather than a tainted record.
    const tainted = { ...ledgerFacts(), finalOutcome: "SUCCESS" } as unknown as LiveLedgerFacts;
    const result = stepObservationOf({ facts: tainted, capturedAt: AT, sourceClass: "REAL_USER_TASK" });
    expect(result.ok).toBe(false);
    expect(result.observation).toBeUndefined();
    expect(result.problems.join(" ")).toContain("carries post-decision field(s): finalOutcome");

    const leakedCompletion = { ...ledgerFacts(), taskComplete: true } as unknown as LiveLedgerFacts;
    expect(stepObservationOf({ facts: leakedCompletion, capturedAt: AT, sourceClass: "REAL_USER_TASK" }).problems.join(" ")).toContain("taskComplete");
  });

  it("refuses a checkpoint with no task or no integer revision", () => {
    expect(stepObservationOf({ facts: ledgerFacts({ taskId: "  " }), capturedAt: AT, sourceClass: "REAL_USER_TASK" }).problems.join(" ")).toContain("names no task");
    expect(stepObservationOf({ facts: ledgerFacts({ revision: 1.5 }), capturedAt: AT, sourceClass: "REAL_USER_TASK" }).problems.join(" ")).toContain("not an integer");
  });

  it("carries the frozen policy identity and the continuation advice", () => {
    const observation = build();
    expect(observation.continuationAdvice.policyId).toBe("continuation-policy-v1");
    expect(observation.continuationAdvice.policyHash).toBe(frozenContinuationPolicy().policyHash);
    expect(observation.continuationAdvice.decision).toBe("CONTINUE");
    expect(observation.continuationAdvice.adviceAt).toBe(AT);
    expect(observation.continuationAdvice.derivedFrom).toContain("unresolvedCount");
  });
});

describe("dispatch, usage and latency are measured or absent, never defaulted", () => {
  it("attributes the dispatch directly from the checkpoint's own session and job", () => {
    const [dispatch] = dispatchRecordsOf(ledgerFacts(), AT);
    expect(dispatch.attribution).toBe("DIRECT_CHECKPOINT");
    expect(dispatch.provider).toEqual(expect.objectContaining({ status: "MEASURED", value: "web:chatgpt" }));
    expect(dispatch.runId).toEqual(expect.objectContaining({ value: "job-1" }));
    expect(dispatch.dispatchAt).toEqual(expect.objectContaining({ value: "2026-09-20T09:59:00.000Z" }));
    expect(dispatch.state).toEqual(expect.objectContaining({ value: "COMPLETED" }));
  });

  it("reports an unsessioned job and a jobless session as absent, with the reason", () => {
    const [orphan] = dispatchRecordsOf(ledgerFacts({ sessions: [{ id: "run-9", provider: "web:qwen" }], jobs: {} }), AT);
    expect(orphan.provider).toEqual(expect.objectContaining({ value: "web:qwen" }));
    expect(orphan.dispatchAt.status).toBe("NOT_MEASURED");
    expect(orphan.dispatchAt.status === "NOT_MEASURED" ? orphan.dispatchAt.reason : "").toContain("no job on this task names the session");
    const [nameless] = dispatchRecordsOf(ledgerFacts({ sessions: [{ id: "run-1" }], jobs: {} }), AT);
    expect(nameless.provider.status).toBe("NOT_MEASURED");
  });

  it("separates provider-reported usage from the platform's own estimate", () => {
    const usage = usageOf(ledgerFacts(), AT);
    expect(usage.inputTokens).toEqual(expect.objectContaining({ status: "MEASURED", value: 120 }));
    expect(usage.outputTokens).toEqual(expect.objectContaining({ value: 30 }));
    expect(usage.platformEstimatedInputTokens).toEqual(expect.objectContaining({ value: 480 }));
    expect(usage.platformEstimatedInputTokens.status === "MEASURED" ? usage.platformEstimatedInputTokens.source : "").toContain("platform estimate");
    // The provider reported no total and no cost: both stay absent rather than being summed or priced.
    expect(usage.totalTokens.status).toBe("NOT_MEASURED");
    expect(usage.reportedCostUsd.status).toBe("NOT_MEASURED");
    expect(usage.reportedCostUsd.status === "NOT_MEASURED" ? usage.reportedCostUsd.reason : "").toContain("price table is not a measurement");
  });

  it("does not promote a zero counter into evidence that nothing happened", () => {
    const usage = usageOf(ledgerFacts({ usage: { toolCalls: 0, browserActions: 0, retries: 0 } }), AT);
    expect(usage.toolCalls.status).toBe("NOT_MEASURED");
    expect(usage.toolCalls.status === "NOT_MEASURED" ? usage.toolCalls.reason : "").toContain("initial value");
    expect(usage.browserActions.status).toBe("NOT_MEASURED");
    expect(usage.retries.status).toBe("NOT_MEASURED");
  });

  it("derives a provider runtime from a job's own interval and a step duration from two captures", () => {
    const latency = latencyOf({ facts: ledgerFacts(), capturedAt: AT, previousCapturedAt: "2026-09-20T09:58:00.000Z", at: AT });
    expect(latency.providerRuntimeMs).toEqual(expect.objectContaining({ status: "MEASURED", value: 30000 }));
    expect(latency.totalStepMs).toEqual(expect.objectContaining({ status: "MEASURED", value: 120000 }));
    // The checkpoint's own counters are zero on this host, which is not a measurement of zero.
    expect(latency.providerWaitMs.status).toBe("NOT_MEASURED");
    expect(latency.workerRuntimeMs.status).toBe("NOT_MEASURED");

    const noPrevious = latencyOf({ facts: ledgerFacts({ jobs: {} }), capturedAt: AT, at: AT });
    expect(noPrevious.totalStepMs.status).toBe("NOT_MEASURED");
    expect(noPrevious.totalStepMs.status === "NOT_MEASURED" ? noPrevious.totalStepMs.reason : "").toContain("no previous checkpoint");
    expect(noPrevious.providerRuntimeMs.status).toBe("NOT_MEASURED");
    const zeroLength = latencyOf({ facts: ledgerFacts({ jobs: { j: { startedAt: AT, completedAt: AT } } }), capturedAt: AT, at: AT });
    expect(zeroLength.providerRuntimeMs.status).toBe("NOT_MEASURED");
  });
});

describe("a skill signal is named if it exists and never invented", () => {
  it("reports NO_SKILL_RUNTIME_SIGNAL for a real-shaped ledger record", () => {
    const skills = skillSignalOf(ledgerFacts());
    // The real record was searched, not assumed empty: the finding is that no field exists.
    expect(skills.signal).toBe(NO_SKILL_RUNTIME_SIGNAL);
    expect(skills.reason).toContain("emits no skill telemetry");
    expect(skills.selected).toEqual([]);
    expect(skills.invocationCount).toBe(0);
  });

  it("names skill-shaped fields when the runtime starts emitting them", () => {
    const withSkills = skillSignalOf({ ...ledgerFacts(), jobs: { j: { id: "j", mountedSkills: ["write-tests"] } } } as unknown as LiveLedgerFacts);
    expect(withSkills.signal).toBe("SKILL_SIGNAL_PRESENT");
    expect(withSkills.fields).toContain("jobs.j.mountedSkills");
  });
});

describe("closure and the bus event vocabulary", () => {
  it("derives a final outcome only from a terminal status", () => {
    expect(finalOutcomeOf({ taskStatus: "completed" }).finalOutcome).toBe("SUCCESS");
    expect(finalOutcomeOf({ taskStatus: "failed" }).finalOutcome).toBe("FAILURE");
    expect(finalOutcomeOf({ taskStatus: "cancelled" }).finalOutcome).toBe("CANCELLED");
    const running = finalOutcomeOf({ taskStatus: "running" });
    expect(running.finalOutcome).toBe("UNKNOWN");
    expect(running.reason).toContain("not a terminal one");
    expect(finalOutcomeOf({ taskStatus: undefined }).reason).toContain("no status");
    for (const status of ["completed", "failed", "failed_permanent", "cancelled"]) expect(isTerminalCaptureStatus(status)).toBe(true);
    for (const status of ["running", "queued", undefined]) expect(isTerminalCaptureStatus(status)).toBe(false);
  });

  it("records a run outcome as an OUTCOME record that cannot close a window", () => {
    const event = providerEventOf({ eventType: "WORKER_FAILED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-1", at: AT });
    expect(event.recordKind).toBe("OUTCOME_RECORD");
    expect(event.closesWindow).toBe(false);
    expect(event.outcome).toEqual(expect.objectContaining({ value: "FAILURE" }));
    expect(event.attribution).toBe("DIRECT_BUS_EVENT");
    expect(event.eventId).toBe(providerEventOf({ eventType: "WORKER_FAILED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-1", at: "2026-09-20T11:00:00.000Z" }).eventId);
    expect(providerEventOf({ eventType: "WORKER_COMPLETED", taskId: "task-1", jobId: "job-2", at: AT }).outcome).toEqual(expect.objectContaining({ value: "SUCCESS" }));
    const anonymous = providerEventOf({ eventType: "WORKER_COMPLETED", taskId: "task-1", at: AT });
    expect(anonymous.runtimeId.status).toBe("NOT_MEASURED");
    expect(liveEventId({ taskId: "task-1", kind: "PROVIDER_OUTCOME", identity: "x" })).toBe("task-1:PROVIDER_OUTCOME:x");
  });

  it("leaves the scheduler advice UNAVAILABLE while the model ledger is empty", () => {
    const advice = schedulerAdviceOf({ taskId: "task-1", taskKind: "coding", models: [], at: AT, sequence: 3 });
    expect(advice.status).toBe("UNAVAILABLE");
    expect(advice.reason).toContain("no candidate to rank");
    expect(advice.policyId).toBe("scheduler-policy-v0");
    expect(advice.policyHash.length).toBe(64);
  });
});
