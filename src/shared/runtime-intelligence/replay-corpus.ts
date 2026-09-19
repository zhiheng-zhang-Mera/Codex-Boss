/**
 * Runtime Intelligence Plane — the replay corpus contract.
 *
 * This is the format that carries real Boss behaviour to the plane, and it is built around
 * one structural decision: **every record is split into `atDecisionTime` and
 * `afterDecision`.**
 *
 * That split is what makes temporal leakage impossible rather than merely discouraged. A
 * benchmark's INPUT is the `atDecisionTime` section; its TARGET is the `afterDecision`
 * section. A field that only exists after the fact cannot be read as an input, because it is
 * not in the input object — and `temporal-guard.ts` checks the boundary anyway, so a record
 * that smuggles `finalOutcome` into the input is `INVALID_REPLAY_CASE` rather than a
 * supported recommendation.
 *
 * The second decision is that absences are carried, not defaulted. Fields that were not
 * measured use the plane's existing `Measurement` vocabulary rather than a second one, and a
 * missing number is `NOT_MEASURED` or `UNAVAILABLE` — never `0`. A corpus is read-only during
 * replay: `REPLAY_CORPUS_GUARANTEES` states what importing one may not touch.
 */

import { isMeasured, type Measurement } from "./measurement";
import type { FailureDomain, TaskKind } from "./contracts";

export const REPLAY_CORPUS_SCHEMA_VERSION = 1;
export const REPLAY_CORPUS_KIND = "RUNTIME_INTELLIGENCE_REPLAY_CORPUS";

/**
 * What importing a corpus is allowed to do. Literal `false` for every mutation, so a caller
 * cannot mistake a replay corpus for a way into production state.
 */
export const REPLAY_CORPUS_GUARANTEES = {
  mutatesProductionTaskHistory: false,
  mutatesProviderState: false,
  mutatesCredentials: false,
  mutatesTrustEvidence: false,
  mutatesModelLedger: false
} as const;

/** Where a corpus came from. A corpus without provenance is not evidence. */
export type ReplayProvenanceKind = "LIVE_CAPTURE" | "SANITIZED_EXPORT" | "CONTROL_FIXTURE";

export interface ReplayProvenance {
  kind: ReplayProvenanceKind;
  /** The machine the behaviour happened on. */
  sourceHost: string;
  sourceRoot: string;
  exportedAt: string;
  /** The tool that produced the corpus, so a format change is traceable. */
  exporter: string;
  /** True when user content and secrets were removed. A corpus that is not sanitized cannot be evidence. */
  sanitized: boolean;
  /** What the sanitizer removed, by field name. */
  redactedFields: string[];
}

/** A completed step's outcome, as the loop itself reported it. */
export interface StepCompletionObservation {
  /** Monotone step index within the task. */
  stepIndex: number;
  /** Whether the task was finished after this step, from the loop's own state. */
  taskComplete: boolean;
  /** Work items still open after this step. `undefined` when the loop did not say. */
  unresolvedCount: number | undefined;
  /** The loop's own next action, verbatim — the termination/continuation reason. */
  terminationReason: string;
  /** Whether the loop took another step after this one. */
  continuedAfterStep: boolean;
  /** Whether the task's final outcome was known at the time the corpus was taken. */
  finalOutcomeKnown: boolean;
}

/** Everything knowable WHEN the decision was made. The only section a benchmark may use as input. */
export interface AtDecisionTime {
  stepIndex: number;
  /** Open items at this step. `undefined` when the loop did not record them. */
  unresolvedCount: number | undefined;
  completedCount: number | undefined;
  provider: Measurement<string>;
  runtimeId: Measurement<string>;
  /** The model identity when the corpus could establish one. Usually UNKNOWN for web transport. */
  modelKey: Measurement<string>;
  nodeId: Measurement<string>;
  mountedSkills: string[];
  usedSkills: string[];
  contextInjected: string[];
  tokensConsumed: number;
  elapsedMs: number;
  /** The confidence a prior recommendation carried, when one was recorded. */
  recommendedConfidence?: number;
  /** The model a prior recommendation named, when one was recorded. */
  recommendedModelKey?: string;
}

/** Everything knowable only AFTERWARDS. Read only as the target, never as an input. */
export interface AfterDecision {
  finalOutcome: Measurement<"SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "CANCELLED">;
  reviewOutcome: Measurement<"AGREED" | "DISAGREED" | "NOT_REVIEWED" | "NOT_RUN" | "VERIFIED">;
  taskComplete: boolean;
  continuedAfterStep: boolean;
  taskSucceeded: boolean | undefined;
  measuredLatencyMs: Measurement<number>;
  measuredCostUsd: Measurement<number>;
  failureDomain: Measurement<FailureDomain>;
}

export interface ReplayCorpusRecord {
  schemaVersion: number;
  recordId: string;
  taskId: string;
  taskKind: TaskKind | "unknown";
  role: Measurement<string>;
  sourceTimestamp: string;
  atDecisionTime: AtDecisionTime;
  afterDecision: AfterDecision;
  /** How this record's step completion was established. */
  completionEvidence: Measurement<string>;
}

export interface ReplayCorpus {
  schemaVersion: number;
  kind: typeof REPLAY_CORPUS_KIND;
  corpusId: string;
  createdAt: string;
  provenance: ReplayProvenance;
  records: ReplayCorpusRecord[];
}

/** Field names that may ONLY appear in `afterDecision`. The temporal guard reads this list. */
export const AFTER_DECISION_ONLY_FIELDS: readonly string[] = [
  "finalOutcome",
  "reviewOutcome",
  "taskComplete",
  "continuedAfterStep",
  "taskSucceeded",
  "measuredLatencyMs",
  "measuredCostUsd",
  "failureDomain"
];

/** Field names a benchmark may read as input. Anything else is a leak. */
export const AT_DECISION_TIME_FIELDS: readonly string[] = [
  "stepIndex",
  "unresolvedCount",
  "completedCount",
  "provider",
  "runtimeId",
  "modelKey",
  "nodeId",
  "mountedSkills",
  "usedSkills",
  "contextInjected",
  "tokensConsumed",
  "elapsedMs",
  "recommendedConfidence",
  "recommendedModelKey"
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMeasurement(value: unknown, path: string, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${path} must be a measurement object`);
    return;
  }
  const status = value.status;
  if (status === "MEASURED") {
    if (!("value" in value)) problems.push(`${path} is MEASURED but carries no value`);
    return;
  }
  if (status !== "UNKNOWN" && status !== "UNREADABLE" && status !== "UNAVAILABLE" && status !== "NOT_MEASURED") {
    problems.push(`${path} has an unknown measurement status ${JSON.stringify(status)}`);
    return;
  }
  if (typeof value.reason !== "string" || value.reason.trim() === "") problems.push(`${path} is ${String(status)} without a reason`);
}

function validateAfterDecision(value: unknown, path: string, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${path} must be an object`);
    return;
  }
  validateMeasurement(value.finalOutcome, `${path}.finalOutcome`, problems);
  validateMeasurement(value.reviewOutcome, `${path}.reviewOutcome`, problems);
  validateMeasurement(value.measuredLatencyMs, `${path}.measuredLatencyMs`, problems);
  validateMeasurement(value.measuredCostUsd, `${path}.measuredCostUsd`, problems);
  validateMeasurement(value.failureDomain, `${path}.failureDomain`, problems);
  if (typeof value.taskComplete !== "boolean") problems.push(`${path}.taskComplete must be a boolean`);
  if (typeof value.continuedAfterStep !== "boolean") problems.push(`${path}.continuedAfterStep must be a boolean`);
}

/**
 * Validates a corpus, returning it only when it is fully well-formed.
 *
 * Every problem is reported rather than the first, because a corpus that fails validation is
 * usually generated and the generator needs the whole list.
 */
export function validateReplayCorpus(value: unknown): { corpus?: ReplayCorpus; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(value)) return { problems: ["the corpus is not an object"] };
  if (value.schemaVersion !== REPLAY_CORPUS_SCHEMA_VERSION) {
    return { problems: [`schemaVersion ${JSON.stringify(value.schemaVersion)} is not ${REPLAY_CORPUS_SCHEMA_VERSION}`] };
  }
  if (value.kind !== REPLAY_CORPUS_KIND) return { problems: [`kind is not ${REPLAY_CORPUS_KIND}`] };
  const provenance = value.provenance;
  if (!isObject(provenance)) problems.push("provenance is missing");
  else {
    if (typeof provenance.kind !== "string") problems.push("provenance.kind is missing");
    if (typeof provenance.sourceHost !== "string" || provenance.sourceHost.trim() === "") problems.push("provenance.sourceHost is missing");
    if (typeof provenance.exportedAt !== "string" || provenance.exportedAt.trim() === "") problems.push("provenance.exportedAt is missing");
    if (typeof provenance.sanitized !== "boolean") problems.push("provenance.sanitized must be a boolean");
    if (!Array.isArray(provenance.redactedFields)) problems.push("provenance.redactedFields must be an array");
  }
  if (!Array.isArray(value.records)) problems.push("records must be an array");
  if (problems.length > 0) return { problems };

  const records = value.records as unknown[];
  records.forEach((record, index) => {
    const path = `records[${index}]`;
    if (!isObject(record)) {
      problems.push(`${path} is not an object`);
      return;
    }
    if (typeof record.recordId !== "string" || record.recordId.trim() === "") problems.push(`${path}.recordId is missing`);
    if (typeof record.taskId !== "string" || record.taskId.trim() === "") problems.push(`${path}.taskId is missing`);
    if (typeof record.sourceTimestamp !== "string") problems.push(`${path}.sourceTimestamp is missing`);
    if (!isObject(record.atDecisionTime)) {
      problems.push(`${path}.atDecisionTime is missing, so there is no input section`);
      return;
    }
    const at = record.atDecisionTime;
    if (typeof at.stepIndex !== "number" || !Number.isInteger(at.stepIndex) || at.stepIndex < 0) problems.push(`${path}.atDecisionTime.stepIndex must be a non-negative integer`);
    if (!Array.isArray(at.mountedSkills)) problems.push(`${path}.atDecisionTime.mountedSkills must be an array`);
    if (!Array.isArray(at.usedSkills)) problems.push(`${path}.atDecisionTime.usedSkills must be an array`);
    if (!Array.isArray(at.contextInjected)) problems.push(`${path}.atDecisionTime.contextInjected must be an array`);
    validateMeasurement(at.provider, `${path}.atDecisionTime.provider`, problems);
    validateMeasurement(at.runtimeId, `${path}.atDecisionTime.runtimeId`, problems);
    validateMeasurement(at.modelKey, `${path}.atDecisionTime.modelKey`, problems);
    validateAfterDecision(record.afterDecision, `${path}.afterDecision`, problems);
    validateMeasurement(record.completionEvidence, `${path}.completionEvidence`, problems);
  });

  if (problems.length > 0) return { problems };
  return { corpus: value as unknown as ReplayCorpus, problems: [] };
}

/** A new corpus with provenance and no records, so a capture can be appended to. */
export function createReplayCorpus(input: { corpusId: string; createdAt: string; provenance: ReplayProvenance }): ReplayCorpus {
  return { schemaVersion: REPLAY_CORPUS_SCHEMA_VERSION, kind: REPLAY_CORPUS_KIND, corpusId: input.corpusId, createdAt: input.createdAt, provenance: input.provenance, records: [] };
}

/**
 * Appends records, refusing a duplicate id.
 *
 * Appending is idempotent by `recordId`, so re-importing the same export twice cannot double
 * a corpus and inflate a sample count.
 */
export function appendReplayRecords(corpus: ReplayCorpus, records: readonly ReplayCorpusRecord[]): { corpus: ReplayCorpus; added: number; skippedDuplicates: string[] } {
  const seen = new Set(corpus.records.map((record) => record.recordId));
  const added: ReplayCorpusRecord[] = [];
  const skippedDuplicates: string[] = [];
  for (const record of records) {
    if (seen.has(record.recordId)) {
      skippedDuplicates.push(record.recordId);
      continue;
    }
    seen.add(record.recordId);
    added.push(record);
  }
  return { corpus: { ...corpus, records: [...corpus.records, ...added] }, added: added.length, skippedDuplicates };
}

export interface ReplayCorpusSummary {
  corpusId: string;
  provenanceKind: ReplayProvenanceKind;
  sanitized: boolean;
  records: number;
  tasks: number;
  /** Records whose final outcome was measured, which is the denominator for any verdict. */
  recordsWithOutcome: number;
  /** Records that carry at least one step of continuation evidence. */
  recordsWithCompletionEvidence: number;
  outcomes: Record<string, number>;
  reviewOutcomes: Record<string, number>;
  failureDomains: Record<string, number>;
  /** Fields the exporter reported as removed, so a reader can see what is not there. */
  redactedFields: string[];
}

/** Counts a corpus by the states it actually carries, so absent data stays visible. */
export function summariseReplayCorpus(corpus: ReplayCorpus): ReplayCorpusSummary {
  const outcomes: Record<string, number> = {};
  const reviewOutcomes: Record<string, number> = {};
  const failureDomains: Record<string, number> = {};
  let recordsWithOutcome = 0;
  let recordsWithCompletionEvidence = 0;
  const tasks = new Set<string>();

  const bump = (bucket: Record<string, number>, key: string): void => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  for (const record of corpus.records) {
    tasks.add(record.taskId);
    if (isMeasured(record.afterDecision.finalOutcome)) {
      recordsWithOutcome += 1;
      bump(outcomes, record.afterDecision.finalOutcome.value);
    } else {
      bump(outcomes, record.afterDecision.finalOutcome.status);
    }
    if (isMeasured(record.afterDecision.reviewOutcome)) bump(reviewOutcomes, record.afterDecision.reviewOutcome.value);
    else bump(reviewOutcomes, record.afterDecision.reviewOutcome.status);
    if (isMeasured(record.afterDecision.failureDomain)) bump(failureDomains, record.afterDecision.failureDomain.value);
    else bump(failureDomains, record.afterDecision.failureDomain.status);
    if (isMeasured(record.completionEvidence)) recordsWithCompletionEvidence += 1;
  }

  return {
    corpusId: corpus.corpusId,
    provenanceKind: corpus.provenance.kind,
    sanitized: corpus.provenance.sanitized,
    records: corpus.records.length,
    tasks: tasks.size,
    recordsWithOutcome,
    recordsWithCompletionEvidence,
    outcomes,
    reviewOutcomes,
    failureDomains,
    redactedFields: [...corpus.provenance.redactedFields]
  };
}

/** Convenience: a corpus builder uses the plane's measurement constructors directly. */
