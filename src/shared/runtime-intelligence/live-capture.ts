/**
 * Runtime Intelligence Plane — the live shadow capture vocabulary.
 *
 * Everything in this module is a pure transformation over facts the running loop already has.
 * Nothing here reads a clock, a file or a bus: the host module supplies the instant and the
 * snapshot, and this module decides what may be recorded about it.
 *
 * Two rules shape every function:
 *
 *   1. **A decision record is written before the outcome exists, and says what it was derived
 *      from.** `stepObservationOf` takes the checkpoint's own at-decision-time facts, runs the
 *      real temporal guard over the object the advisor is given, and only then produces the
 *      shadow advice. A caller that hands it an object carrying `finalOutcome`, `taskComplete` or
 *      any other post-decision name produces NOTHING: the observation is refused, with the leaked
 *      field named, rather than recorded with a leak in it.
 *   2. **An absent fact is absent.** Every measurement here is a `Measurement<T>` from the
 *      plane's own fail-closed vocabulary, so a counter the ledger records as `0` is not
 *      promoted into evidence that nothing happened, and a timestamp that is not there yields
 *      `NOT_MEASURED` rather than a zero duration.
 *
 * The corpus's own field names are reused where they exist (`completedCount`, `pendingCount`,
 * `tokensConsumed`, `toolCalls`, `elapsedMs`, `workerSessions`), so live evidence and replayed
 * evidence are the same vocabulary and can be compared without a translation layer.
 */

import { measured, notMeasured, type Measurement } from "./measurement";
import { checkInputForFutureInformation } from "./temporal-guard";
import { continuationPolicyHash, evaluateContinuation, type ContinuationPolicyId } from "./continuation-evaluator";
import { adviseScheduling } from "./scheduling-advisor";
import { frozenContinuationPolicy, policyIdentity } from "./policy-registry";
import type { ModelCapabilityRecord, TaskKind, TaskProfile } from "./contracts";

export const LIVE_CAPTURE_SCHEMA_VERSION = 1;

/**
 * What produced a capture record.
 *
 * The headline prospective figures count `REAL_USER_TASK` only. A smoke run and a fixture are
 * useful for proving the wiring works and are worthless as evidence about a policy, so the
 * distinction is part of the record rather than a convention in a report.
 */
export const CAPTURE_SOURCE_CLASSES = ["REAL_USER_TASK", "DEVELOPMENT_SMOKE", "TEST_FIXTURE"] as const;
export type CaptureSourceClass = (typeof CAPTURE_SOURCE_CLASSES)[number];

/**
 * The two halves of an append-only evidence trail.
 *
 * A decision record may not contain what happened after it, and an outcome record may not change
 * the decision it follows. Keeping the kind on every record is what lets a reader see the order
 * rather than trust it.
 */
export const EVIDENCE_RECORD_KINDS = ["DECISION_TIME_RECORD", "OUTCOME_RECORD"] as const;
export type EvidenceRecordKind = (typeof EVIDENCE_RECORD_KINDS)[number];

/**
 * Recorded when the running Boss exposes no skill selection, load or invocation at all.
 *
 * This is a finding, not a placeholder: it says the capture path looked and the runtime has no
 * such signal, so `SKILL_USAGE_CASES` is 0 because nothing emits it — not because a reader
 * failed to find it.
 */
export const NO_SKILL_RUNTIME_SIGNAL = "NO_SKILL_RUNTIME_SIGNAL";

/** Field names that would make a live decision-time snapshot invalid if they appeared in it. */
export const LIVE_FUTURE_FIELD_CHECK = "the live decision-time snapshot, which the advisor is given";

/**
 * The task ledger's own fields, structurally.
 *
 * Declared structurally rather than imported so `src/shared` never depends on `electron`: the
 * host passes its `TaskLedgerRecord`, and any object with these fields is accepted.
 */
export interface LiveLedgerFacts {
  taskId: string;
  revision: number;
  completedSteps?: readonly string[];
  pendingSteps?: readonly string[];
  nextAction?: string;
  checkpointReason?: string;
  activeProvider?: string | null;
  verificationState?: string;
  sessions?: ReadonlyArray<{ id?: string; provider?: string; checkpoint?: number; health?: string }>;
  jobs?: Record<string, { id?: string; state?: string; attempts?: number; sessionId?: string; startedAt?: string; completedAt?: string }>;
  usage?: {
    modelCalls?: number;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    providerInputTokens?: number;
    providerOutputTokens?: number;
    providerTotalTokens?: number;
    toolCalls?: number;
    browserActions?: number;
    retries?: number;
    workerRuntimeMs?: number;
    providerWaitMs?: number;
  };
}

/** One provider dispatch, as the ledger's own session and job records describe it. */
export interface LiveDispatchRecord {
  provider: Measurement<string>;
  sessionId: Measurement<string>;
  runId: Measurement<string>;
  dispatchAt: Measurement<string>;
  completedAt: Measurement<string>;
  state: Measurement<string>;
  attempts: Measurement<number>;
  /**
   * Where the attribution came from. `DIRECT_CHECKPOINT` means this checkpoint recorded the
   * session itself, which is the standard the live path is meant to hold so a later reader never
   * has to fall back to a task-level guess.
   */
  attribution: "DIRECT_CHECKPOINT";
}

export interface LiveUsageRecord {
  /** Provider-reported prompt tokens. Absent when the provider reported no usage. */
  inputTokens: Measurement<number>;
  outputTokens: Measurement<number>;
  totalTokens: Measurement<number>;
  /** The platform's own character-count estimate, named as an estimate. */
  platformEstimatedInputTokens: Measurement<number>;
  platformEstimatedOutputTokens: Measurement<number>;
  toolCalls: Measurement<number>;
  browserActions: Measurement<number>;
  retries: Measurement<number>;
  /** Present only when a provider or runtime actually reported a cost. */
  reportedCostUsd: Measurement<number>;
}

export interface LiveLatencyRecord {
  providerWaitMs: Measurement<number>;
  workerRuntimeMs: Measurement<number>;
  /** A job's own `startedAt -> completedAt` on the application's clock. */
  providerRuntimeMs: Measurement<number>;
  /** This checkpoint's capture time minus the previous one, when both were observed. */
  totalStepMs: Measurement<number>;
}

export interface LiveSkillRecord {
  signal: typeof NO_SKILL_RUNTIME_SIGNAL | "SKILL_SIGNAL_PRESENT";
  /** The skill-shaped field names actually found, so a present signal is nameable. */
  fields: string[];
  selected: string[];
  invoked: string[];
  invocationCount: number;
  reason: string;
}

export interface ContinuationAdviceCapture {
  policyId: string;
  policyHash: string;
  decision: string;
  confidence: number;
  adviceAt: string;
  /** The at-decision-time field names the advice was derived from. */
  derivedFrom: readonly string[];
  temporalVerdict: "NO_FUTURE_INFORMATION";
}

export interface SchedulerAdviceCapture {
  policyId: string;
  policyHash: string;
  adviceAt: string;
  status: "ADVISED" | "UNAVAILABLE";
  reason: string;
  preferredModelKey?: string;
  confidence?: number;
}

/** One checkpoint, as the live path observed it. */
export interface LiveStepObservation {
  schemaVersion: number;
  kind: "STEP_OBSERVED";
  recordKind: "DECISION_TIME_RECORD";
  sourceClass: CaptureSourceClass;
  taskId: string;
  stepIndex: number;
  checkpointId: string;
  capturedAt: string;
  completedCount: number;
  pendingCount: number;
  nextAction: string;
  checkpointReason: string;
  /**
   * The loop's own completion statement, DERIVED here from the at-decision-time counts and the
   * compile markers. The corpus's `taskComplete` is an outcome-side name and never appears in a
   * decision record.
   */
  objectiveComplete: boolean;
  completionEvidence: string;
  activeProvider: Measurement<string>;
  sessions: readonly string[];
  dispatches: LiveDispatchRecord[];
  usage: LiveUsageRecord;
  latency: LiveLatencyRecord;
  skills: LiveSkillRecord;
  continuationAdvice: ContinuationAdviceCapture;
  schedulerAdvice: SchedulerAdviceCapture;
  /** The at-decision-time facts the shadow advice was allowed to see, verbatim. */
  derivedFrom: readonly string[];
  /** The temporal guard's verdict on `derivedFrom`'s object. Always clean: a leak is refused. */
  temporalVerdict: string;
}

/**
 * A stable identity for one observation, so a replayed or duplicated event appends once.
 *
 * The identity is `task + kind + the thing being observed`, never a timestamp: two observations
 * of the same checkpoint are the same evidence however far apart they were written.
 */
export function liveEventId(input: { taskId: string; kind: string; identity: string | number }): string {
  return `${input.taskId}:${input.kind}:${String(input.identity)}`;
}

/** Skill-shaped keys, searched for at the top level and inside the nested records the ledger keeps. */
const SKILL_FIELD_PATTERN = /skill/i;

/**
 * Looks for a real skill signal in the ledger's own record.
 *
 * It does not invent one. When the record carries no skill-shaped field the result is
 * `NO_SKILL_RUNTIME_SIGNAL` with the names it searched, which is the difference between "the
 * runtime emits no skill telemetry" and "nobody looked".
 */
export function skillSignalOf(facts: LiveLedgerFacts): LiveSkillRecord {
  const fields: string[] = [];
  const visit = (value: unknown, prefix: string, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (SKILL_FIELD_PATTERN.test(key)) fields.push(path);
      visit(entry, path, depth + 1);
    }
  };
  visit(facts, "", 0);
  const sorted = [...new Set(fields)].sort();
  if (sorted.length === 0) {
    return {
      signal: NO_SKILL_RUNTIME_SIGNAL,
      fields: [],
      selected: [],
      invoked: [],
      invocationCount: 0,
      reason: "the task ledger records no skill selection, mount or invocation, so the running loop emits no skill telemetry to capture"
    };
  }
  // A signal that exists is named; the values are not interpreted, because no real record has yet
  // shown what shape they take and a guess would be indistinguishable from a measurement.
  return {
    signal: "SKILL_SIGNAL_PRESENT",
    fields: sorted,
    selected: [],
    invoked: [],
    invocationCount: 0,
    reason: `the ledger carries skill-shaped field(s) ${sorted.join(", ")} but no reader has been shown their meaning, so they are named and not interpreted`
  };
}

/**
 * The dispatch records this checkpoint carries directly.
 *
 * A session names the provider runtime it belongs to, and a job names when its run started and
 * finished. Both are the loop's own records at this checkpoint, which is why the attribution is
 * `DIRECT_CHECKPOINT` and not a fallback: nothing here is inferred from the task's first run.
 */
export function dispatchRecordsOf(facts: LiveLedgerFacts, at: string): LiveDispatchRecord[] {
  const jobs = Object.values(facts.jobs ?? {});
  const bySession = new Map(jobs.filter((job) => typeof job.sessionId === "string").map((job) => [String(job.sessionId), job]));
  return (facts.sessions ?? []).map((session) => {
    const sessionId = typeof session.id === "string" ? session.id : undefined;
    const job = sessionId === undefined ? undefined : bySession.get(sessionId);
    // A missing job and a job without a time are different findings, so they get different
    // sentences: one says the ledger never recorded the run, the other says it recorded the run
    // without recording when it started.
    const missingRun = "no job on this task names the session, so the run's own record is absent";
    return {
      provider: typeof session.provider === "string" && session.provider !== "" ? measured(session.provider, "task-ledger sessions[].provider", at) : notMeasured("the session recorded no provider identity, so the dispatch cannot be attributed", "task-ledger sessions[]"),
      sessionId: sessionId === undefined ? notMeasured("the session recorded no id", "task-ledger sessions[]") : measured(sessionId, "task-ledger sessions[].id", at),
      runId: job !== undefined && typeof job.id === "string" ? measured(job.id, "task-ledger jobs[].id", at) : notMeasured(missingRun, "task-ledger jobs[]"),
      dispatchAt: job === undefined
        ? notMeasured(missingRun, "task-ledger jobs[].startedAt")
        : typeof job.startedAt === "string" && Number.isFinite(Date.parse(job.startedAt))
          ? measured(job.startedAt, "task-ledger jobs[].startedAt", at)
          : notMeasured("the job recorded no start time, so the dispatch instant is unknown", "task-ledger jobs[].startedAt"),
      completedAt: job === undefined
        ? notMeasured(missingRun, "task-ledger jobs[].completedAt")
        : typeof job.completedAt === "string" && Number.isFinite(Date.parse(job.completedAt))
          ? measured(job.completedAt, "task-ledger jobs[].completedAt", at)
          : notMeasured("the job has not completed, or recorded no completion time", "task-ledger jobs[].completedAt"),
      state: job !== undefined && typeof job.state === "string" ? measured(job.state, "task-ledger jobs[].state", at) : notMeasured(missingRun, "task-ledger jobs[]"),
      attempts: job !== undefined && typeof job.attempts === "number" ? measured(job.attempts, "task-ledger jobs[].attempts", at) : notMeasured(missingRun, "task-ledger jobs[]"),
      attribution: "DIRECT_CHECKPOINT"
    };
  });
}

/** Provider-reported usage when the provider reported it, and the platform's own estimate named as an estimate. */
export function usageOf(facts: LiveLedgerFacts, at: string): LiveUsageRecord {
  const usage = facts.usage ?? {};
  const count = (value: number | undefined, reason: string, source: string): Measurement<number> =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? measured(value, source, at) : notMeasured(reason, source);
  return {
    inputTokens: count(usage.providerInputTokens, "the provider reported no input token usage for this step", "task-ledger usage.providerInputTokens"),
    outputTokens: count(usage.providerOutputTokens, "the provider reported no output token usage for this step", "task-ledger usage.providerOutputTokens"),
    totalTokens: count(usage.providerTotalTokens, "the provider reported no total token usage for this step", "task-ledger usage.providerTotalTokens"),
    platformEstimatedInputTokens: count(usage.estimatedInputTokens, "the platform estimated no input tokens for this step", "task-ledger usage.estimatedInputTokens (a platform estimate, not a provider count)"),
    platformEstimatedOutputTokens: count(usage.estimatedOutputTokens, "the platform estimated no output tokens for this step", "task-ledger usage.estimatedOutputTokens (a platform estimate, not a provider count)"),
    toolCalls: count(usage.toolCalls, "the ledger records 0 tool calls, which is the counter's initial value and not evidence that a tool ran", "task-ledger usage.toolCalls"),
    browserActions: count(usage.browserActions, "the ledger records 0 browser actions, which is the counter's initial value and not evidence that a page was used", "task-ledger usage.browserActions"),
    retries: count(usage.retries, "the ledger records 0 retries, which is the counter's initial value and not evidence that none happened", "task-ledger usage.retries"),
    // Nothing in this application reports a cost, so it is never derived from tokens and prices.
    reportedCostUsd: notMeasured("the runtime and the provider both report no cost for a web transport, and a price table is not a measurement", "task-ledger usage")
  };
}

/**
 * The step's duration, from timestamps that actually exist.
 *
 * `providerRuntimeMs` comes from a job's own `startedAt` and `completedAt`. `totalStepMs` comes
 * from this capture time minus the previous checkpoint's, which the host observed. A missing
 * instant yields `NOT_MEASURED` with the reason; no branch here substitutes a zero.
 */
export function latencyOf(input: { facts: LiveLedgerFacts; capturedAt: string; previousCapturedAt?: string; at: string }): LiveLatencyRecord {
  const usage = input.facts.usage ?? {};
  const positive = (value: number | undefined, reason: string, source: string): Measurement<number> =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? measured(value, source, input.at) : notMeasured(reason, source);
  const runtimes = Object.values(input.facts.jobs ?? {})
    .map((job) => {
      const from = typeof job.startedAt === "string" ? Date.parse(job.startedAt) : Number.NaN;
      const to = typeof job.completedAt === "string" ? Date.parse(job.completedAt) : Number.NaN;
      return Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : undefined;
    })
    .filter((value): value is number => value !== undefined);
  const jobRuntime: Measurement<number> = runtimes.length === 0
    ? notMeasured("no job on this task carries both a start and a completion time, so no provider runtime was recorded", "task-ledger jobs[].startedAt->completedAt")
    : measured(Math.max(...runtimes), "task-ledger jobs[].startedAt->completedAt", input.at);
  const from = input.previousCapturedAt === undefined ? Number.NaN : Date.parse(input.previousCapturedAt);
  const to = Date.parse(input.capturedAt);
  const totalStepMs: Measurement<number> = Number.isFinite(from) && Number.isFinite(to) && to > from
    ? measured(to - from, "this checkpoint's capture time minus the previous checkpoint's", input.at)
    : notMeasured(input.previousCapturedAt === undefined ? "no previous checkpoint was observed for this task, so the step's own duration is not derivable" : "the two checkpoint capture times do not order, so no duration is derivable", "the capture clock");
  return {
    providerWaitMs: positive(usage.providerWaitMs, "the checkpoint recorded no positive provider wait time", "task-ledger usage.providerWaitMs"),
    workerRuntimeMs: positive(usage.workerRuntimeMs, "the checkpoint recorded no positive worker runtime", "task-ledger usage.workerRuntimeMs"),
    providerRuntimeMs: jobRuntime,
    totalStepMs
  };
}

/** The at-decision-time snapshot the continuation advisor is given. Keys are the corpus's own. */
function decisionSnapshot(facts: LiveLedgerFacts): Record<string, unknown> {
  return {
    stepIndex: facts.revision,
    completedCount: facts.completedSteps === undefined ? undefined : facts.completedSteps.length,
    unresolvedCount: facts.pendingSteps === undefined ? undefined : facts.pendingSteps.length,
    nextAction: facts.nextAction,
    checkpointReason: facts.checkpointReason,
    workerSessions: (facts.sessions ?? []).flatMap((session) => (typeof session.provider === "string" && session.provider !== "" ? [session.provider] : [])),
    tokensConsumed: facts.usage?.providerInputTokens === undefined && facts.usage?.providerOutputTokens === undefined
      ? undefined
      : (facts.usage?.providerInputTokens ?? 0) + (facts.usage?.providerOutputTokens ?? 0),
    toolCalls: facts.usage?.toolCalls,
    browserActions: facts.usage?.browserActions,
    elapsedMs: facts.usage?.workerRuntimeMs
  };
}

/** The field names of the snapshot above, which is what the advice declares it was derived from. */
function snapshotFieldNames(snapshot: Record<string, unknown>): string[] {
  return Object.keys(snapshot).sort();
}

/**
 * The shadow continuation advice, computed from at-decision-time facts only.
 *
 * `taskComplete` is passed to the evaluator because v1's STOP rule requires the loop's own
 * completion statement — but it is DERIVED here from the counts and compile markers, so it is not
 * a field the advisor was handed. The snapshot is checked by the real temporal guard first: if it
 * carries a post-decision name, this throws and the caller refuses the observation.
 */
export function continuationAdviceOf(input: { facts: LiveLedgerFacts; snapshot: Record<string, unknown>; objectiveComplete: boolean; at: string; policy?: ContinuationPolicyId }): ContinuationAdviceCapture {
  const check = checkInputForFutureInformation(input.snapshot, { label: LIVE_FUTURE_FIELD_CHECK });
  if (check.verdict !== "NO_FUTURE_INFORMATION") throw new Error(`live capture temporal leakage: ${check.reasons.join("; ")}`);
  const policy = input.policy ?? (frozenContinuationPolicy().policyId as ContinuationPolicyId);
  const completed = input.facts.completedSteps?.length ?? 0;
  const unresolved = input.facts.pendingSteps?.length ?? 0;
  const total = completed + unresolved;
  const assessment = evaluateContinuation({
    at: input.at,
    sequence: input.facts.revision,
    policy,
    signals: {
      taskId: input.facts.taskId,
      // A web transport exposes no model id. The corpus's replay spells this "unknown-provider"
      // for the same reason; the live path reuses that word so a rule reading it sees the same
      // value in both, and the absence is stated in the field rather than hidden by a default.
      modelKey: "unknown-model",
      elapsedMs: typeof input.snapshot.elapsedMs === "number" ? input.snapshot.elapsedMs : 0,
      toolProgress: "UNKNOWN",
      ...(total > 0 ? { progress: completed / total } : {}),
      unresolvedItems: unresolved,
      resolvedItems: completed,
      stepsCompleted: input.facts.revision,
      taskComplete: input.objectiveComplete,
      pendingWork: unresolved === 0 ? "NONE" : "WORK",
      tokensConsumed: typeof input.snapshot.tokensConsumed === "number" ? input.snapshot.tokensConsumed : 0
    }
  });
  return {
    policyId: policy,
    policyHash: continuationPolicyHash(policy),
    decision: assessment.decision,
    confidence: assessment.confidence,
    adviceAt: input.at,
    derivedFrom: snapshotFieldNames(input.snapshot),
    temporalVerdict: "NO_FUTURE_INFORMATION"
  };
}

/**
 * The shadow scheduling advice, when the plane has a model ledger to rank.
 *
 * With no model records there is nothing to rank, and the capture says so instead of emitting a
 * recommendation about no candidates. The advice is advisory-only by type: `adviseScheduling`
 * returns an object whose routing-authority fields are literal `false`.
 */
export function schedulerAdviceOf(input: { taskId: string; taskKind: TaskKind; models: readonly ModelCapabilityRecord[]; at: string; sequence: number }): SchedulerAdviceCapture {
  const identity = policyIdentity("scheduler-policy-v0");
  const policyId = identity?.policyId ?? "scheduler-policy-v0";
  const policyHash = identity?.policyHash ?? "";
  if (input.models.length === 0) {
    return {
      policyId,
      policyHash,
      adviceAt: input.at,
      status: "UNAVAILABLE",
      reason: "the plane holds no model capability record, so there is no candidate to rank; the same capture will carry an advice once real outcomes populate the ledger"
    };
  }
  const task: TaskProfile = { taskId: input.taskId, role: "worker", taskKind: input.taskKind, requiredCapabilities: [], contextScale: "small", externalEffect: false, risk: "low", createdAt: input.at };
  const recommendation = adviseScheduling({ task, models: input.models, nodes: [], createdAt: input.at, sequence: input.sequence });
  return {
    policyId,
    policyHash,
    adviceAt: input.at,
    status: "ADVISED",
    reason: `the advisor ranked ${input.models.length} model record(s) at this step`,
    ...(recommendation.preferredModel === undefined ? {} : { preferredModelKey: recommendation.preferredModel.modelKey }),
    confidence: recommendation.confidence
  };
}

export interface StepObservationResult {
  ok: boolean;
  observation?: LiveStepObservation;
  problems: string[];
}

/**
 * Builds one decision-time observation, or refuses it.
 *
 * The refusal path is the point: a leaked snapshot, an unknown task or a snapshot that is not an
 * object all produce `ok: false` with the reason, and the host records the refusal instead of a
 * tainted record. Nothing here throws.
 */
export function stepObservationOf(input: {
  facts: LiveLedgerFacts;
  capturedAt: string;
  previousCapturedAt?: string;
  sourceClass: CaptureSourceClass;
  taskKind?: TaskKind;
  models?: readonly ModelCapabilityRecord[];
  policy?: ContinuationPolicyId;
}): StepObservationResult {
  const { facts } = input;
  if (typeof facts.taskId !== "string" || facts.taskId.trim() === "") {
    return { ok: false, problems: ["the checkpoint names no task, so there is nothing to attribute an observation to"] };
  }
  if (!Number.isInteger(facts.revision)) {
    return { ok: false, problems: [`the checkpoint revision ${JSON.stringify(facts.revision)} is not an integer, so the step has no stable identity`] };
  }
  // The record the caller handed in is checked FIRST. The snapshot below is built from a
  // whitelist, so a leak could not reach the advisor through it — but a caller passing a record
  // that carries outcome or review names is reading them somewhere, and refusing here says so
  // instead of silently filtering and reporting a clean decision record.
  const raw = checkInputForFutureInformation(facts, { label: "the task-ledger record handed to the live capture" });
  if (raw.verdict !== "NO_FUTURE_INFORMATION") {
    return { ok: false, problems: raw.reasons };
  }
  const snapshot = decisionSnapshot(facts);
  const check = checkInputForFutureInformation(snapshot, { label: LIVE_FUTURE_FIELD_CHECK });
  if (check.verdict !== "NO_FUTURE_INFORMATION") {
    return { ok: false, problems: check.reasons };
  }
  const completed = facts.completedSteps?.length ?? 0;
  const unresolved = facts.pendingSteps?.length ?? 0;
  const compile = ["COMPILE", "task compiled"].includes(facts.nextAction ?? "") || ["COMPILE", "task compiled"].includes(facts.checkpointReason ?? "");
  const objectiveComplete = !compile && facts.pendingSteps !== undefined && unresolved === 0 && completed > 0;
  const basis = compile
    ? "this is the compile step, which precedes any work item"
    : facts.pendingSteps === undefined
      ? "the ledger did not record its open work, so completion is not claimed"
      : `pending ${unresolved}, completed ${completed}`;
  let continuation: ContinuationAdviceCapture;
  try {
    continuation = continuationAdviceOf({ facts, snapshot, objectiveComplete, at: input.capturedAt, ...(input.policy === undefined ? {} : { policy: input.policy }) });
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
  const observation: LiveStepObservation = {
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    kind: "STEP_OBSERVED",
    recordKind: "DECISION_TIME_RECORD",
    sourceClass: input.sourceClass,
    taskId: facts.taskId,
    stepIndex: facts.revision,
    checkpointId: String(facts.revision).padStart(8, "0"),
    capturedAt: input.capturedAt,
    completedCount: completed,
    pendingCount: unresolved,
    nextAction: facts.nextAction ?? "UNKNOWN",
    checkpointReason: facts.checkpointReason ?? "UNKNOWN",
    objectiveComplete,
    completionEvidence: `checkpoint revision ${facts.revision} at ${input.capturedAt}: ${basis}; the loop's next action was ${facts.nextAction ?? "UNKNOWN"}`,
    activeProvider: typeof facts.activeProvider === "string" && facts.activeProvider !== "" ? measured(facts.activeProvider, "task-ledger activeProvider", input.capturedAt) : notMeasured("the checkpoint recorded no active provider", "task-ledger activeProvider"),
    sessions: (facts.sessions ?? []).flatMap((session) => (typeof session.provider === "string" && session.provider !== "" ? [session.provider] : [])).sort(),
    dispatches: dispatchRecordsOf(facts, input.capturedAt),
    usage: usageOf(facts, input.capturedAt),
    latency: latencyOf({ facts, capturedAt: input.capturedAt, ...(input.previousCapturedAt === undefined ? {} : { previousCapturedAt: input.previousCapturedAt }), at: input.capturedAt }),
    skills: skillSignalOf(facts),
    continuationAdvice: continuation,
    schedulerAdvice: schedulerAdviceOf({ taskId: facts.taskId, taskKind: input.taskKind ?? "other", models: input.models ?? [], at: input.capturedAt, sequence: facts.revision }),
    derivedFrom: snapshotFieldNames(snapshot),
    temporalVerdict: "NO_FUTURE_INFORMATION"
  };
  return { ok: true, observation, problems: [] };
}

/**
 * A provider run's outcome, from the domain event bus.
 *
 * This is an OUTCOME record, and it is emphatically not a task outcome: a run that failed is not
 * a task that failed, and a run that completed is not a window that may close. `closesWindow` is a
 * literal `false` so a consumer cannot make that mistake by accident.
 */
export interface ProspectiveProviderEvent {
  kind: "PROVIDER_OUTCOME";
  recordKind: "OUTCOME_RECORD";
  eventId: string;
  eventType: string;
  taskId: string;
  runtimeId: Measurement<string>;
  jobId: Measurement<string>;
  observedAt: string;
  outcome: Measurement<string>;
  closesWindow: false;
  /** The event itself carried the provider identity, so no fallback was needed. */
  attribution: "DIRECT_BUS_EVENT";
}

/**
 * Builds a provider-outcome event from what the bus actually carries.
 *
 * The identity is the job when there is one and the runtime plus the observation instant when
 * there is not, so a replayed event is one record while two genuinely different events stay two.
 */
export function providerEventOf(input: { eventType: string; taskId: string; runtimeId?: string; jobId?: string; at: string }): ProspectiveProviderEvent {
  const identity = input.jobId ?? `${input.runtimeId ?? "no-runtime"}@${input.at}`;
  return {
    kind: "PROVIDER_OUTCOME",
    recordKind: "OUTCOME_RECORD",
    eventId: liveEventId({ taskId: input.taskId, kind: "PROVIDER_OUTCOME", identity: `${input.eventType}:${identity}` }),
    eventType: input.eventType,
    taskId: input.taskId,
    runtimeId: input.runtimeId === undefined || input.runtimeId === "" ? notMeasured("the event named no runtime, so the provider identity is not derivable", "domain event runtimeId") : measured(input.runtimeId, "domain event runtimeId", input.at),
    jobId: input.jobId === undefined || input.jobId === "" ? notMeasured("the event named no job, so the run identity is not derivable", "domain event jobId") : measured(input.jobId, "domain event jobId", input.at),
    observedAt: input.at,
    outcome: measured(input.eventType === "WORKER_FAILED" ? "FAILURE" : "SUCCESS", "domain event type", input.at),
    closesWindow: false,
    attribution: "DIRECT_BUS_EVENT"
  };
}

/* --------------------------------------------------------------- closure */

/** What the loop's own record says about the end of a task, and where that came from. */
export interface FinalOutcomeEvidence {
  finalOutcome: "SUCCESS" | "FAILURE" | "CANCELLED" | "UNKNOWN";
  source: string;
  reason: string;
}

/**
 * Maps the application's terminal task status onto a window's final outcome.
 *
 * Only a terminal status produces a value. `running`, a missing status or an unknown word all
 * yield `UNKNOWN` with the reason, because a window closed on a guess is worse than one left open.
 */
export function finalOutcomeOf(input: { taskStatus: string | undefined }): FinalOutcomeEvidence {
  const status = input.taskStatus;
  if (status === "completed") return { finalOutcome: "SUCCESS", source: "state.json tasks[].status", reason: "the store records the task as completed" };
  if (status === "failed" || status === "failed_permanent") return { finalOutcome: "FAILURE", source: "state.json tasks[].status", reason: `the store records the task as ${status}` };
  if (status === "cancelled") return { finalOutcome: "CANCELLED", source: "state.json tasks[].status", reason: "the store records the task as cancelled" };
  return {
    finalOutcome: "UNKNOWN",
    source: "state.json tasks[].status",
    reason: status === undefined ? "the store holds no status for this task, so the window stays open" : `the status ${JSON.stringify(status)} is not a terminal one, so the window stays open`
  };
}

/** Whether a task's status means no further checkpoint will arrive. */
export function isTerminalCaptureStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "failed_permanent" || status === "cancelled";
}

/* --------------------------------------------------- headline accounting */

export interface HeadlineCaptureMetrics {
  /** Records from real user tasks only. */
  headline: { tasks: number; steps: number; dispatchRecords: number; latencyMeasured: number; tokensMeasured: number; costMeasured: number; skillSignalPresent: number };
  /** Records excluded from the headline, by source class, so a smoke run is visible and not counted. */
  excluded: Record<string, number>;
  notes: string[];
}

/**
 * Counts what a report may present as a prospective result.
 *
 * Only `REAL_USER_TASK` records are counted. A development smoke run exists to prove the wiring
 * works, and letting it into the headline would make the first measured number in this plane a
 * number nobody's work produced.
 */
export function headlineCaptureMetrics(observations: readonly LiveStepObservation[]): HeadlineCaptureMetrics {
  const real = observations.filter((observation) => observation.sourceClass === "REAL_USER_TASK");
  const excluded: Record<string, number> = {};
  for (const observation of observations) {
    if (observation.sourceClass === "REAL_USER_TASK") continue;
    excluded[observation.sourceClass] = (excluded[observation.sourceClass] ?? 0) + 1;
  }
  const notes: string[] = [];
  const excludedTotal = observations.length - real.length;
  if (excludedTotal > 0) notes.push(`${excludedTotal} observation(s) are not real user tasks and are excluded from every headline figure`);
  if (real.length === 0) notes.push("no real user task has been captured, so the headline is empty rather than zero-valued");
  return {
    headline: {
      tasks: new Set(real.map((observation) => observation.taskId)).size,
      steps: real.length,
      dispatchRecords: real.reduce((total, observation) => total + observation.dispatches.length, 0),
      latencyMeasured: real.filter((observation) => observation.latency.totalStepMs.status === "MEASURED" || observation.latency.providerRuntimeMs.status === "MEASURED").length,
      tokensMeasured: real.filter((observation) => observation.usage.inputTokens.status === "MEASURED" || observation.usage.platformEstimatedInputTokens.status === "MEASURED").length,
      costMeasured: real.filter((observation) => observation.usage.reportedCostUsd.status === "MEASURED").length,
      skillSignalPresent: real.filter((observation) => observation.skills.signal === "SKILL_SIGNAL_PRESENT").length
    },
    excluded,
    notes
  };
}
