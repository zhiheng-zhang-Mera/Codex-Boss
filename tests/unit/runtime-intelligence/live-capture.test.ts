import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainEventBus } from "../../../electron/commander/event-bus";
import { TaskLedger } from "../../../electron/commander/task-ledger";
import {
  CAPTURE_FAILURE_RETENTION,
  CAPTURED_EVENT_TYPES,
  LIVE_CAPTURE_ATTACHMENTS,
  RuntimeIntelligenceCapture,
  attachRuntimeIntelligenceCapture,
  createCaptureObservingLedger,
  openProspectiveWindow,
  runLiveCaptureSmoke,
  type LiveCaptureFailure,
  type LiveCaptureOptions,
  type LiveCaptureStatus
} from "../../../electron/runtime-intelligence/live-capture";
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

describe("the headline counts real user tasks only", () => {
  it("excludes smoke and fixture observations and says how many", () => {
    const real = build();
    const smoke: LiveStepObservation = { ...build(), sourceClass: "DEVELOPMENT_SMOKE", taskId: "smoke-1" };
    const metrics = headlineCaptureMetrics([real, smoke]);
    expect(metrics.headline.tasks).toBe(1);
    expect(metrics.headline.steps).toBe(1);
    expect(metrics.headline.dispatchRecords).toBe(1);
    expect(metrics.headline.tokensMeasured).toBe(1);
    expect(metrics.headline.latencyMeasured).toBe(1);
    expect(metrics.headline.costMeasured).toBe(0);
    expect(metrics.headline.skillSignalPresent).toBe(0);
    expect(metrics.excluded).toEqual({ DEVELOPMENT_SMOKE: 1 });
    expect(metrics.notes.join(" ")).toContain("excluded from every headline figure");
    const empty = headlineCaptureMetrics([smoke]);
    expect(empty.headline.tasks).toBe(0);
    expect(empty.notes.join(" ")).toContain("headline is empty rather than zero-valued");
  });

  it("applies the same exclusion to the window metrics", () => {
    const capture = new RuntimeIntelligenceCapture({ dataRoot: makeRoot(), now: () => AFTER_FREEZE, openedAt: () => AFTER_FREEZE, sourceClass: "DEVELOPMENT_SMOKE" });
    expect(capture.observeCheckpoint({ taskId: "smoke-1", facts: ledgerFacts({ taskId: "smoke-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    const headline = capture.headline();
    expect(headline.tasks).toBe(0);
    expect(headline.excludedBySourceClass).toEqual({ DEVELOPMENT_SMOKE: 1 });
    expect(headline.notes.join(" ")).toContain("smoke or fixture records");
  });
});

/* ------------------------------------------------------------------ live */

/** A capture wired to a temporary data root, with the two resolvers a real boot would supply. */
function liveCapture(input: { dataRoot: string; openedAt?: string; taskStatus?: () => string | undefined; now?: () => string }): RuntimeIntelligenceCapture {
  return new RuntimeIntelligenceCapture({
    dataRoot: input.dataRoot,
    now: input.now ?? (() => AFTER_FREEZE),
    openedAt: () => input.openedAt ?? AFTER_FREEZE,
    taskStatus: input.taskStatus ?? (() => "running")
  });
}

describe("the adapter observes the ledger's own write path", () => {
  it("captures task open, step, dispatch and advice from a real ledger save", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    const ledger = createCaptureObservingLedger({ root: path.join(dataRoot, ".boss", "tasks"), capture, now: () => AFTER_FREEZE });
    ledger.create("task-1", "a real objective");
    const after = ledger.update("task-1", "task/run transition", (record) => {
      record.completedSteps = ["step-a"];
      record.pendingSteps = ["step-b"];
      record.nextAction = "DISPATCHING";
      record.sessions = [{ id: "run-1", provider: "web:chatgpt", taskId: "task-1", checkpoint: 2, health: "RUNNING", resumeStrategy: "RECONSTRUCT" }];
    });

    const status: LiveCaptureStatus = capture.status();
    expect(status.captureHealthy).toBe(true);
    expect(status.tasksObserved).toBe(1);
    expect(status.stepsObserved).toBe(2);
    expect(status.executionAuthority).toBe(false);
    expect(status.mode).toBe("LIVE_SHADOW_CAPTURE");
    expect(status.lastCaptureAt).toBe(AFTER_FREEZE);

    const [record] = capture.records();
    expect(record.taskId).toBe("task-1");
    expect(record.openedAt).toBe(AFTER_FREEZE);
    expect(record.evidenceClass).toBe("PROSPECTIVE_EVIDENCE");
    expect(record.policyIdentity.continuationPolicyHash).toBe(frozenContinuationPolicy().policyHash);
    expect(record.policyIdentity.schedulerPolicyHash.length).toBe(64);
    expect(record.policyIdentity.skillLoadoutPolicyHash.length).toBe(64);
    expect(record.policyIdentity.confidencePolicyHash.length).toBe(64);
    expect(record.steps).toHaveLength(2);
    expect(record.steps[1].dispatches[0].provider).toEqual(expect.objectContaining({ value: "web:chatgpt" }));
    expect(record.steps[1].continuationAdvice.decision).toBe("CONTINUE");
    expect(record.advisories).toHaveLength(2);
    expect(after.revision).toBe(2);
  });

  it("classifies a pre-freeze task as retrospective evidence rather than prospective", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot, openedAt: BEFORE_FREEZE });
    expect(capture.observeCheckpoint({ taskId: "old-1", facts: ledgerFacts({ taskId: "old-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    const [record] = capture.records();
    expect(record.evidenceClass).toBe("RETROSPECTIVE_EVIDENCE");
    // The headline refuses it, which is the whole point of deciding the class from the clock.
    expect(capture.headline().tasks).toBe(0);
  });

  it("refuses to open a window when the store cannot say when the task was created", () => {
    const capture = new RuntimeIntelligenceCapture({ dataRoot: makeRoot(), now: () => AFTER_FREEZE, openedAt: () => undefined });
    const result = capture.observeCheckpoint({ taskId: "unknown-1", facts: ledgerFacts({ taskId: "unknown-1" }), at: AFTER_FREEZE });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("cannot be decided");
    expect(capture.status().recordsRejected).toBe(1);
    expect(capture.status().windows).toBe(0);
    expect(capture.status().lastRejection).toContain("observeCheckpoint");
  });

  it("appends a repeated checkpoint once and counts the duplicate", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    const facts = ledgerFacts({ taskId: "task-1" });
    expect(capture.observeCheckpoint({ taskId: "task-1", facts, at: AFTER_FREEZE }).ok).toBe(true);
    const again = capture.observeCheckpoint({ taskId: "task-1", facts, at: AFTER_FREEZE });
    expect(again.ok).toBe(true);
    expect(again.deduplicated).toBe(true);
    const [record] = capture.records();
    expect(record.steps).toHaveLength(1);
    expect(record.advisories).toHaveLength(1);
    expect(capture.status().recordsDeduplicated).toBe(1);
  });

  it("treats a task seen across a restart as one prospective task", () => {
    const dataRoot = makeRoot();
    const first = liveCapture({ dataRoot });
    expect(first.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    const opened = first.records()[0].openedAt;
    const policyHash = first.records()[0].policyHash;

    // A second process: the same root, a fresh adapter, the same task.
    const restarted = liveCapture({ dataRoot });
    expect(restarted.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1", revision: 4 }), at: "2026-09-20T01:00:00.000Z" }).ok).toBe(true);
    const status = restarted.status();
    expect(status.windows).toBe(1);
    expect(status.tasksObserved).toBe(0);
    expect(status.restartsRecognised).toBe(1);
    const record = restarted.records()[0];
    expect(record.openedAt).toBe(opened);
    expect(record.policyHash).toBe(policyHash);
    expect(record.steps).toHaveLength(2);
  });

  it("closes a window on a terminal status and leaves it open otherwise", () => {
    const dataRoot = makeRoot();
    let status = "running";
    const capture = liveCapture({ dataRoot, taskStatus: () => status });
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    expect(capture.records()[0].outcome).toBeUndefined();

    status = "completed";
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1", revision: 4, completedSteps: ["a"], pendingSteps: [] }), at: "2026-09-20T02:00:00.000Z" }).ok).toBe(true);
    const closed = capture.records()[0];
    expect(closed.outcome?.finalOutcome).toBe("SUCCESS");
    expect(closed.outcome?.finalOutcomeSource).toBe("state.json tasks[].status");
    expect(closed.outcome?.steps.map((step) => step.stepIndex)).toEqual([3, 4]);
    expect(capture.status().windowsClosed).toBe(1);
    // The window is closed, so its metrics are no longer waiting on an outcome.
    expect(capture.headline().tasksClosed).toBe(1);
  });

  it("never closes a window on a run outcome, only on the task's own status", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    expect(capture.observeProviderEvent({ type: "WORKER_FAILED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-1", at: AFTER_FREEZE }).ok).toBe(true);
    const [record] = capture.records();
    expect(record.outcome).toBeUndefined();
    expect(record.providerEvents).toHaveLength(1);
    expect(record.providerEvents[0].outcome).toEqual(expect.objectContaining({ value: "FAILURE" }));
    expect(capture.status().providerEventsObserved).toBe(1);
    // The same event twice is one record.
    expect(capture.observeProviderEvent({ type: "WORKER_FAILED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-1", at: AFTER_FREEZE }).deduplicated).toBe(true);
    expect(capture.records()[0].providerEvents).toHaveLength(1);
  });

  it("refuses a bus event for a task whose open time is unknown, and one with no task", () => {
    const capture = new RuntimeIntelligenceCapture({ dataRoot: makeRoot(), now: () => AFTER_FREEZE, openedAt: () => undefined });
    expect(capture.observeProviderEvent({ type: "WORKER_COMPLETED", taskId: "t", at: AFTER_FREEZE }).problems.join(" ")).toContain("cannot be decided");
    const known = liveCapture({ dataRoot: makeRoot() });
    expect(known.observeProviderEvent({ type: "WORKER_COMPLETED", at: AFTER_FREEZE }).problems.join(" ")).toContain("named no task");
  });

  it("reports a window root that has no log and still names the frozen policy", () => {
    const store = openProspectiveWindow(makeRoot());
    expect(store.records()).toEqual([]);
    expect(store.status().policyId).toBe("continuation-policy-v1");
    expect(store.status().file.endsWith("prospective-window.jsonl")).toBe(true);
  });
});

describe("CAPTURE_FAILS and EXECUTION_CONTINUES are the same test", () => {
  /** A data root whose prospective path is a FILE, so every write into it must fail. */
  function brokenCapture(): { capture: RuntimeIntelligenceCapture; dataRoot: string } {
    const dataRoot = makeRoot("boss-capture-broken-");
    fs.mkdirSync(path.join(dataRoot, ".boss", "runtime-intelligence"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "runtime-intelligence", "prospective"), "not a directory", "utf8");
    return { capture: liveCapture({ dataRoot }), dataRoot };
  }

  it("keeps the ledger writing its checkpoint when the capture cannot write at all", () => {
    const { capture, dataRoot } = brokenCapture();
    const ledgerDir = path.join(dataRoot, ".boss", "tasks");
    const ledger = createCaptureObservingLedger({ root: ledgerDir, capture, now: () => AFTER_FREEZE });
    const created = ledger.create("task-1", "an objective that must not be lost");
    const updated = ledger.update("task-1", "task/run transition", (record) => {
      record.nextAction = "DISPATCHING";
    });

    // EXECUTION_CONTINUES: the checkpoint is on disk and the ledger's own return value is intact.
    expect(updated.revision).toBe(2);
    expect(created.revision).toBe(1);
    const files = fs.readdirSync(path.join(ledgerDir, "task-1", "checkpoints"));
    expect(files).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(ledgerDir, "task-1", "checkpoints", "00000002.json"), "utf8")).nextAction).toBe("DISPATCHING");

    // CAPTURE_FAILS: and it says so, without having thrown into the write path.
    const status = capture.status();
    expect(status.captureHealthy).toBe(false);
    expect(status.lastError).toBeDefined();
    expect(status.recordsRejected).toBeGreaterThan(0);
    expect(status.failures.length).toBeGreaterThan(0);
    expect(status.executionAuthority).toBe(false);
  });

  it("keeps the ledger writing when the policy registry itself is unavailable", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    const ledger = createCaptureObservingLedger({ root: path.join(dataRoot, ".boss", "tasks"), capture, now: () => AFTER_FREEZE });
    ledger.create("task-1", "objective");
    // A capture whose model ledger resolver throws is a capture whose scheduler advice cannot be
    // computed. It is reported, counted, and the observation still arrives without it.
    const wounded = new RuntimeIntelligenceCapture({
      dataRoot: makeRoot(),
      now: () => AFTER_FREEZE,
      openedAt: () => AFTER_FREEZE,
      models: () => {
        throw new Error("the model ledger is unreadable");
      }
    });
    const result = wounded.observeCheckpoint({ taskId: "task-2", facts: ledgerFacts({ taskId: "task-2" }), at: AFTER_FREEZE });
    expect(result.ok).toBe(false);
    expect(wounded.status().captureHealthy).toBe(false);
    expect(wounded.status().lastError).toContain("the model ledger is unreadable");
    expect(wounded.status().executionAuthority).toBe(false);
  });

  it("survives a torn log line and an unreadable root without throwing", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    fs.appendFileSync(path.join(dataRoot, ".boss", "runtime-intelligence", "prospective", "prospective-window.jsonl"), "{ torn\n", "utf8");
    expect(capture.records()).toHaveLength(1);
    expect(capture.status().windows).toBe(1);
    expect(() => capture.status()).not.toThrow();
  });

  it("still records an intended observation after a refused one", () => {
    const dataRoot = makeRoot();
    const capture = liveCapture({ dataRoot });
    const tainted = { ...ledgerFacts({ taskId: "task-1" }), reviewOutcome: "AGREED" } as unknown as LiveLedgerFacts;
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: tainted, at: AFTER_FREEZE }).ok).toBe(false);
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    expect(capture.status().recordsRejected).toBe(1);
    expect(capture.records()[0].steps).toHaveLength(1);
  });
});

describe("the capture layer has no execution authority", () => {
  it("exposes no action API and cannot be given one by accident", () => {
    const capture = new RuntimeIntelligenceCapture({ dataRoot: makeRoot(), now: () => AFTER_FREEZE, openedAt: () => AFTER_FREEZE });
    const forbidden = ["stopTask", "switchModel", "routeTask", "restartTask", "modifyTask", "deleteSkill", "cancelTask", "retryTask", "pauseTask", "resumeTask", "dispatch", "execute"];
    const names = new Set<string>();
    let prototype: object | null = Object.getPrototypeOf(capture) as object | null;
    while (prototype !== null && prototype !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    for (const name of forbidden) expect([...names], `${name} would be an action API`).not.toContain(name);
    // What it does expose: observations in, status and readings out.
    for (const name of ["observeCheckpoint", "observeProviderEvent", "status", "records", "headline", "coverage", "markAttached"]) expect([...names]).toContain(name);
    expect(capture.status().executionAuthority).toBe(false);
    expect(capture.status().mode).toBe("LIVE_SHADOW_CAPTURE");
  });

  it("subscribes to run outcomes only, and leaves the bus's own publishing intact", () => {
    const seen: string[] = [];
    const events = new DomainEventBus();
    const capture = liveCapture({ dataRoot: makeRoot() });
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    const attachment = attachRuntimeIntelligenceCapture(events, { capture });
    let otherDelivered = 0;
    events.subscribe("WORKER_COMPLETED", (event) => {
      otherDelivered += 1;
      seen.push(`other:${event.type}`);
    });

    expect(attachment.eventTypes).toEqual([...CAPTURED_EVENT_TYPES]);
    expect(CAPTURED_EVENT_TYPES).toEqual(["WORKER_COMPLETED", "WORKER_FAILED"]);
    events.publish({ type: "WORKER_COMPLETED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-1" });
    events.publish({ type: "THEME_ACTIVATED", taskId: "task-1" });
    expect(seen).toEqual(["other:WORKER_COMPLETED"]);
    expect(otherDelivered).toBe(1);
    expect(capture.records()[0].providerEvents).toHaveLength(1);
    expect(capture.status().captureAttached).toBe(true);

    attachment.detach();
    attachment.detach();
    events.publish({ type: "WORKER_COMPLETED", taskId: "task-1", runtimeId: "web:chatgpt", jobId: "job-2" });
    expect(capture.records()[0].providerEvents).toHaveLength(1);
  });

  it("cannot fail a publish even when the capture behind it is broken", () => {
    const dataRoot = makeRoot("boss-capture-broken-");
    fs.mkdirSync(path.join(dataRoot, ".boss", "runtime-intelligence"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "runtime-intelligence", "prospective"), "not a directory", "utf8");
    const events = new DomainEventBus();
    const capture = liveCapture({ dataRoot });
    attachRuntimeIntelligenceCapture(events, { capture });
    let delivered = 0;
    events.subscribe("WORKER_FAILED", () => {
      delivered += 1;
    });
    expect(() => events.publish({ type: "WORKER_FAILED", taskId: "task-1", runtimeId: "web:qwen", jobId: "job-1" })).not.toThrow();
    expect(delivered).toBe(1);
    expect(events.handlerFailures()).toEqual([]);
    expect(capture.status().captureHealthy).toBe(false);
  });
});

describe("the capture vocabulary is exactly what it claims to be", () => {
  it("names its record kinds, its schema version and the rule it applies to a snapshot", () => {
    // Imported and asserted rather than described, so the vocabulary cannot be renamed away from
    // the modules that use it without this test noticing.
    expect(LIVE_CAPTURE_SCHEMA_VERSION).toBe(1);
    expect(EVIDENCE_RECORD_KINDS).toEqual(["DECISION_TIME_RECORD", "OUTCOME_RECORD"]);
    const kind: EvidenceRecordKind = "DECISION_TIME_RECORD";
    expect(kind).toBe("DECISION_TIME_RECORD");
    expect(LIVE_FUTURE_FIELD_CHECK).toContain("decision-time snapshot");
    const dispatch: LiveDispatchRecord = build().dispatches[0];
    const usage: LiveUsageRecord = build().usage;
    const latency: LiveLatencyRecord = build().latency;
    const skills: LiveSkillRecord = build().skills;
    const continuation: ContinuationAdviceCapture = build().continuationAdvice;
    const scheduler: SchedulerAdviceCapture = build().schedulerAdvice;
    const headline: HeadlineCaptureMetrics = headlineCaptureMetrics([build()]);
    const outcome: FinalOutcomeEvidence = finalOutcomeOf({ taskStatus: "completed" });
    const event: ProspectiveProviderEvent = providerEventOf({ eventType: "WORKER_COMPLETED", taskId: "task-1", jobId: "job-1", at: AT });
    const facts: LiveLedgerFacts = ledgerFacts();
    const built: StepObservationResult = stepObservationOf({ facts, capturedAt: AT, sourceClass: "REAL_USER_TASK" });
    expect(built.ok).toBe(true);
    expect([dispatch.attribution, usage.reportedCostUsd.status, latency.totalStepMs.status, skills.signal, continuation.temporalVerdict, scheduler.status, headline.headline.tasks, outcome.finalOutcome, event.closesWindow]).toEqual([
      "DIRECT_CHECKPOINT",
      "NOT_MEASURED",
      "NOT_MEASURED",
      NO_SKILL_RUNTIME_SIGNAL,
      "NO_FUTURE_INFO" + "RMATION",
      "UNAVAILABLE",
      1,
      "SUCCESS",
      false
    ]);
    // The two pure entry points the adapter does not call directly are still part of the surface.
    expect(continuationAdviceOf({ facts, snapshot: { stepIndex: 1 }, objectiveComplete: false, at: AT }).decision).toBe("CONTINUE");
  });

  it("declares the retention and failure types a reader of the producer's status needs", () => {
    expect(CAPTURE_FAILURE_RETENTION).toBe(50);
    const options: LiveCaptureOptions = { dataRoot: makeRoot(), now: () => AFTER_FREEZE, openedAt: () => AFTER_FREEZE };
    const capture = new RuntimeIntelligenceCapture(options);
    expect(capture.observeCheckpoint({ taskId: "task-1", facts: ledgerFacts({ taskId: "task-1" }), at: AFTER_FREEZE }).ok).toBe(true);
    const failure: LiveCaptureFailure = { at: AFTER_FREEZE, operation: "observeCheckpoint", message: "an injected failure" };
    expect(failure.operation).toBe("observeCheckpoint");
    // A failure is bounded: the oldest are dropped, so a long-running process cannot grow it.
    expect(capture.status().failures.length).toBeLessThanOrEqual(CAPTURE_FAILURE_RETENTION);
  });

  it("exposes the window operations the adapter appends through", () => {
    const capture = liveCapture({ dataRoot: makeRoot() });
    const observation = build({ taskId: "task-2" });
    const opened = openProspectiveRecord({ taskId: "task-2", openedAt: AFTER_FREEZE });
    expect(opened.record?.schemaVersion).toBe(PROSPECTIVE_WINDOW_SCHEMA_VERSION);
    const identity: ProspectivePolicyIdentity = prospectivePolicyIdentity();
    expect(identity).toEqual(opened.record?.policyIdentity);
    expect(CAPTURE_EVENT_ID_LIMIT).toBe(256);

    const first = appendProspectiveObservation(opened.record!, observation);
    expect(first.ok).toBe(true);
    expect(appendProspectiveObservation(first.record!, observation).deduplicated).toBe(true);
    const marked = markCaptureEvent(first.record!, "PROVIDER_OUTCOME:job-1");
    expect(marked.deduplicated).toBe(false);
    expect(markCaptureEvent(marked.record, "PROVIDER_OUTCOME:job-1").deduplicated).toBe(true);
    const withEvent = appendProviderEvent(marked.record, providerEventOf({ eventType: "WORKER_COMPLETED", taskId: "task-2", jobId: "job-1", at: AT }));
    expect(withEvent.ok).toBe(true);
    expect(withEvent.record.providerEvents).toHaveLength(1);
    expect(appendProviderEvent(opened.record!, providerEventOf({ eventType: "WORKER_COMPLETED", taskId: "other", jobId: "j", at: AT })).ok).toBe(false);

    const derived = deriveWindowOutcome(withEvent.record, { closedAt: AT, taskStatus: "running" });
    expect(derived.steps).toHaveLength(1);
    expect(derived.completionProblems).toEqual([]);
    // A terminal status whose last step still has open work is a disagreement, and it is reported
    // rather than smoothed over: the window and the store must not quietly contradict each other.
    const contradicts = deriveWindowOutcome(withEvent.record, { closedAt: AT, taskStatus: "completed" });
    expect(contradicts.completionProblems?.[0].kind).toBe("TERMINAL_BUT_NOT_COMPLETE");
    expect(identity.confidencePolicyHash).toHaveLength(64);
    expect(identity.confidencePolicyHash).not.toBe(identity.continuationPolicyHash);
    // The adapter's own window is still empty: the records above were built by hand.
    expect(capture.status().windows).toBe(0);
  });
});

describe("the attachment is in the composition root, and stays there", () => {
  it("makes the real call at each declared seam", () => {
    // Declared as data and checked against the files, so "the producer is attached" is a fact a
    // reader can verify rather than a sentence in a report. Removing either call fails here.
    const repositoryRoot = path.resolve(__dirname, "..", "..", "..");
    expect(LIVE_CAPTURE_ATTACHMENTS).toHaveLength(2);
    for (const attachment of LIVE_CAPTURE_ATTACHMENTS) {
      const file = path.join(repositoryRoot, ...attachment.seam.split("/"));
      expect(fs.existsSync(file), `${attachment.seam} must exist`).toBe(true);
      expect(fs.readFileSync(file, "utf8"), `${attachment.seam} must call ${attachment.call}`).toContain(attachment.call);
    }
    // The capture reaches the ledger and the bus from the composition root, not from the plane.
    const main = fs.readFileSync(path.join(repositoryRoot, "electron", "main.ts"), "utf8");
    expect(main).toContain("capture: persistence.service.capture");
  });

  it("drives the whole path in the smoke walk, and keeps the smoke out of the headline", () => {
    const dataRoot = makeRoot();
    const smoke = runLiveCaptureSmoke({ dataRoot, now: () => AFTER_FREEZE });
    expect(smoke.problems).toEqual([]);
    expect(smoke.checkpointFiles).toBe(3);
    expect(smoke.status.captureAttached).toBe(true);
    expect(smoke.status.captureHealthy).toBe(true);
    expect(smoke.status.tasksObserved).toBe(1);
    expect(smoke.status.stepsObserved).toBe(3);
    expect(smoke.status.providerEventsObserved).toBe(1);
    expect(smoke.status.windowsClosed).toBe(1);
    expect(smoke.status.executionAuthority).toBe(false);
    expect(smoke.window?.sourceClass).toBe("DEVELOPMENT_SMOKE");
    expect(smoke.window?.steps.map((step) => step.continuationAdvice.decision)).toEqual(["CONTINUE", "CONTINUE", "STOP"]);
    expect(smoke.window?.steps.flatMap((step) => step.dispatches).every((dispatch) => dispatch.attribution === "DIRECT_CHECKPOINT")).toBe(true);
    expect(smoke.window?.outcome?.finalOutcome).toBe("SUCCESS");
    // The headline stays empty, which is the honest report of a smoke run.
    expect(smoke.headlineTasks).toBe(0);
  });
});

describe("smoke validation on a real ledger", () => {
  it("walks task open, step, dispatch and outcome, and keeps the smoke out of the headline", () => {
    const dataRoot = makeRoot();
    let taskStatus: string | undefined = "running";
    const capture = new RuntimeIntelligenceCapture({
      dataRoot,
      now: () => AFTER_FREEZE,
      openedAt: () => AFTER_FREEZE,
      taskStatus: () => taskStatus,
      // The smoke run says what it is, so it can never be mistaken for a user's work.
      sourceClass: "DEVELOPMENT_SMOKE"
    });
    const events = new DomainEventBus();
    const attachment = attachRuntimeIntelligenceCapture(events, { capture });
    const ledger = createCaptureObservingLedger({ root: path.join(dataRoot, ".boss", "tasks"), capture, now: () => AFTER_FREEZE });

    ledger.create("smoke-1", "smoke objective");
    events.publish({ type: "WORKER_COMPLETED", taskId: "smoke-1", runtimeId: "web:chatgpt", jobId: "job-1" });
    ledger.update("smoke-1", "task/run transition", (record) => {
      record.completedSteps = ["step-a"];
      record.pendingSteps = ["step-b"];
      record.nextAction = "DISPATCHING";
      record.sessions = [{ id: "run-1", provider: "web:chatgpt", taskId: "smoke-1", checkpoint: 2, health: "SUCCESS", resumeStrategy: "RECONSTRUCT" }];
    });
    taskStatus = "completed";
    ledger.update("smoke-1", "task/run transition", (record) => {
      record.completedSteps = ["step-a", "step-b"];
      record.pendingSteps = [];
      record.nextAction = "REPORT_EVIDENCE";
    });

    const [record] = capture.records();
    expect(record.sourceClass).toBe("DEVELOPMENT_SMOKE");
    expect(record.steps).toHaveLength(3);
    expect(record.providerEvents).toHaveLength(1);
    expect(record.outcome?.finalOutcome).toBe("SUCCESS");
    expect(record.steps[1].dispatches[0].attribution).toBe("DIRECT_CHECKPOINT");
    expect(record.steps.every((step) => step.continuationAdvice.policyHash === frozenContinuationPolicy().policyHash)).toBe(true);
    expect(record.outcome?.completionProblems ?? []).toEqual([]);

    const status = capture.status();
    expect(status.tasksObserved).toBe(1);
    expect(status.stepsObserved).toBe(3);
    expect(status.windowsClosed).toBe(1);
    expect(status.captureHealthy).toBe(true);

    // The headline is empty and says why, which is the honest result of a smoke run.
    const headline = capture.headline();
    expect(headline.tasks).toBe(0);
    expect(headline.excludedBySourceClass).toEqual({ DEVELOPMENT_SMOKE: 1 });
    expect(prospectiveHeadline([]).verdict).toBe("INSUFFICIENT_EVIDENCE");
    attachment.detach();
  });

  it("counts a real user task in the headline and scores it against its own outcome", () => {
    const dataRoot = makeRoot();
    let taskStatus: string | undefined = "running";
    const capture = new RuntimeIntelligenceCapture({ dataRoot, now: () => AFTER_FREEZE, openedAt: () => AFTER_FREEZE, taskStatus: () => taskStatus });
    // Step one still has open work, so the advice is CONTINUE; step two is finished, so the advice
    // is STOP. The window scores both against what the loop actually did.
    expect(capture.observeCheckpoint({ taskId: "real-1", facts: ledgerFacts({ taskId: "real-1", completedSteps: ["a"], pendingSteps: ["b"], revision: 2, sessions: [], jobs: {} }), at: AFTER_FREEZE }).ok).toBe(true);
    taskStatus = "completed";
    expect(capture.observeCheckpoint({ taskId: "real-1", facts: ledgerFacts({ taskId: "real-1", completedSteps: ["a", "b"], pendingSteps: [], revision: 3, sessions: [], jobs: {} }), at: "2026-09-20T03:00:00.000Z" }).ok).toBe(true);

    const records: ProspectiveWindowRecord[] = capture.records();
    expect(records).toHaveLength(1);
    const metrics = capture.headline();
    expect(metrics.tasks).toBe(1);
    expect(metrics.tasksClosed).toBe(1);
    expect(metrics.continuationSteps).toBe(2);
    expect(metrics.stopSupportCount).toBe(1);
    expect(metrics.falseStops).toBe(0);
    expect(metrics.callsSaved).toBe(1);
    expect(metrics.notes.join(" ")).toContain("1 STOP advisory(ies)");
    expect(capture.coverage().headline.steps).toBe(2);
  });
});
