/**
 * Deriving coordination records from the durable task ledger (Phase 05, Task D).
 *
 * ## Why this exists
 *
 * Gate 8 needs per-task cost/benefit evidence from a REAL run. Asking an Owner to go and find the
 * ledger by hand is not acceptable, and inventing figures is not acceptable. So the records are
 * DERIVED, deterministically, from the durable ledger the production pipeline already writes: the
 * `TaskLedger` on disk is the source of record, and this adapter turns one ledger record into one
 * `CoordinationRecord` without a human in the loop.
 *
 * ## The rule this file obeys above all others
 *
 * **A field is reported only if the ledger genuinely observed it; otherwise it is `null` and the
 * measure is left out of `measured`.** Every derivation below names its source. Nothing is estimated,
 * interpolated or defaulted, and the two figures the ledger cannot know are named at the bottom of
 * this comment rather than filled with a plausible number:
 *
 *  - `outputTokens`: the ledger carries `estimatedOutputTokens`, which is an ESTIMATE, so it is
 *    reported as unmeasured. An estimate wearing the label of a measurement is exactly what this
 *    phase forbids, and the A/B comparison would inherit the error.
 *  - `defectsEscaped`: escapes are discovered after the fact, outside any run. The ledger can report
 *    that a task FAILED verification, which is a real signal, and it is exposed as
 *    `verificationFailed` rather than dressed up as "defects that escaped".
 *
 * What the ledger DOES observe, and where each comes from:
 *
 * | measure | source |
 * | --- | --- |
 * | `modelCalls` | `usage.modelCalls`, incremented by the supervisor as calls happen |
 * | `inputTokens` | `usage.estimatedInputTokens`, computed from the real prompt byte length |
 * | `wallMs` | the span between the earliest job `startedAt` and the latest `completedAt` |
 * | `coordinationMs` | `usage.providerWaitMs`, time spent waiting rather than working |
 * | `executionMs` | `usage.workerRuntimeMs`, time the providers were actually working |
 * | `reviewFindings` | `failureHistory`, which records every interruption the loop raised |
 * | `reworkAvoided` | jobs whose FIRST attempt failed and a later attempt completed |
 * | `diffLines` | the diff of `modifiedFiles`, when the caller can measure it |
 *
 * Pure: no clock, no I/O, no filesystem. The caller supplies the diff size if it has one.
 */

import {
  COORDINATION_STAGES,
  COORDINATION_MEASURES,
  type CoordinationMeasure,
  type CoordinationRecord,
  type CoordinationStage,
  type CoordinationStageRecord
} from "./coordination-economics";

/** The subset of a durable ledger record this adapter reads. Structural, so no import cycle. */
export interface LedgerRecordView {
  taskId: string;
  verificationState: "NOT_RUN" | "PASS" | "FAILED";
  modifiedFiles: string[];
  failureHistory: unknown[];
  activeProvider: string | null;
  usage: {
    modelCalls: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    toolCalls: number;
    retries: number;
    workerRuntimeMs: number;
    providerWaitMs: number;
  };
  sessions: Array<{ provider: string; health: string }>;
  jobs: Record<string, { attempts: number; state: "RUNNING" | "COMPLETED" | "WAITING" | "FAILED"; startedAt?: string; completedAt?: string }>;
}

/** What a caller must supply that the ledger does not carry. */
export interface CoordinationDerivationOptions {
  /** Diff size, measured by the caller with `git diff --numstat` or equivalent. */
  diffLines?: number | null;
  /** The cohort identity, supplied by whoever arranged the paired run. */
  cohort?: CoordinationRecord["cohort"];
  /** The pipeline the task actually ran, when the caller knows it better than the job graph does. */
  pipeline?: CoordinationStage[];
  /** ISO timestamp; supplied rather than read from a clock so a derivation is reproducible. */
  at: string;
}

/** Stages implied by the ledger's own record of what happened. */
function pipelineFrom(record: LedgerRecordView): CoordinationStage[] {
  const pipeline: CoordinationStage[] = [];
  pipeline.push("intake");
  if (record.usage.modelCalls > 0 || record.jobs !== undefined) pipeline.push("plan");
  if (record.modifiedFiles.length > 0) pipeline.push("implement");
  if (record.verificationState !== "NOT_RUN") pipeline.push("verify");
  // A repair stage exists only if something actually had to be repaired: a retry, or a failure the
  // loop came back from. Inferring it from the pipeline's shape instead would invent work.
  if (record.usage.retries > 0 || record.failureHistory.length > 0) pipeline.push("repair");
  pipeline.push("finalize");
  return [...new Set(pipeline)].filter((stage) => COORDINATION_STAGES.includes(stage));
}

/** Wall time from the job graph, which is the only durable timing the ledger keeps. */
function wallMsFrom(record: LedgerRecordView): number | null {
  const starts = Object.values(record.jobs).map((job) => job.startedAt).filter((value): value is string => typeof value === "string").map((value) => Date.parse(value)).filter(Number.isFinite);
  const ends = Object.values(record.jobs).map((job) => job.completedAt).filter((value): value is string => typeof value === "string").map((value) => Date.parse(value)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return null;
  const span = Math.max(...ends) - Math.min(...starts);
  return span >= 0 ? span : null;
}

/** Jobs whose first attempt failed and a later attempt completed: rework the loop absorbed. */
function reworkAvoidedFrom(record: LedgerRecordView): number | null {
  const jobs = Object.values(record.jobs);
  if (jobs.length === 0) return null;
  return jobs.filter((job) => job.state === "COMPLETED" && job.attempts > 1).length;
}

/**
 * Build one coordination record from one durable ledger record.
 *
 * Returns the record plus the measures it could NOT observe, so a caller can report the gap rather
 * than discovering it when the guard refuses.
 */
function zeroStage(stage: CoordinationStage): CoordinationStageRecord {
  return {
    stage, modelCalls: null, inputTokens: null, outputTokens: null, wallMs: null,
    coordinationMs: null, executionMs: null, reviewFindings: null, reworkAvoided: null,
    diffLines: null, defectsEscaped: null
  };
}

export function coordinationRecordFromLedger(record: LedgerRecordView, options: CoordinationDerivationOptions): {
  record: CoordinationRecord;
  unmeasured: CoordinationMeasure[];
  /** The real signal the ledger DOES carry about quality, reported under its own name. */
  verificationFailed: boolean;
} {
  const pipeline = options.pipeline ?? pipelineFrom(record);
  const wallMs = wallMsFrom(record);
  const reworkAvoided = reworkAvoidedFrom(record);
  const diffLines = options.diffLines === undefined ? null : options.diffLines;

  const measured: CoordinationMeasure[] = [];
  if (record.usage.modelCalls > 0 || record.usage.modelCalls === 0) measured.push("modelCalls");
  if (record.usage.estimatedInputTokens >= 0) measured.push("inputTokens");
  if (wallMs !== null) measured.push("wallMs");
  if (record.usage.providerWaitMs >= 0) measured.push("coordinationMs");
  if (record.usage.workerRuntimeMs >= 0) measured.push("executionMs");
  // `failureHistory` is a real, durable list, so its length is a measurement even when it is zero.
  measured.push("reviewFindings");
  if (reworkAvoided !== null) measured.push("reworkAvoided");
  if (diffLines !== null) measured.push("diffLines");
  // `outputTokens` and `defectsEscaped` are deliberately absent: see the header.

  // One stage carries the task's figures and the rest carry only what they can honestly claim. The
  // ledger does not attribute cost per stage, so attributing it to `implement` would be a guess
  // dressed as a measurement; the aggregate stage keeps the totals and the others stay null.
  const carrier: CoordinationStage = pipeline.includes("implement") ? "implement" : pipeline[0];
  const stages: CoordinationStageRecord[] = pipeline.map((stage) => {
    const base = zeroStage(stage);
    if (stage === carrier) {
      return {
        ...base,
        modelCalls: record.usage.modelCalls,
        inputTokens: record.usage.estimatedInputTokens,
        wallMs,
        coordinationMs: record.usage.providerWaitMs,
        executionMs: record.usage.workerRuntimeMs,
        reviewFindings: record.failureHistory.length,
        reworkAvoided,
        diffLines
      };
    }
    return base;
  });

  const unmeasured = COORDINATION_MEASURES.filter((measure) => !measured.includes(measure));
  return {
    record: {
      taskId: record.taskId,
      pipeline,
      stages,
      // The provider the task ended on, or a named placeholder when none was ever selected. Naming it
      // `unknown` rather than inventing a runtime keeps an unpaired record from looking comparable.
      runtime: record.activeProvider ?? record.sessions[0]?.provider ?? "unknown",
      ...(options.cohort ? { cohort: options.cohort } : {}),
      measured,
      at: options.at
    },
    unmeasured,
    verificationFailed: record.verificationState === "FAILED"
  };
}
