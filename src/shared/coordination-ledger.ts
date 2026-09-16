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
  type CoordinationTaskTotals
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
    /**
     * What a PROVIDER reported, when one did.
     *
     * Optional because the field is absent on a ledger written before the plumbing existed, and on any
     * task whose provider returned no usage block. Absent means unmeasured, never zero.
     */
    providerInputTokens?: number;
    providerOutputTokens?: number;
    providerTotalTokens?: number;
    toolCalls: number;
    retries: number;
    workerRuntimeMs: number;
    providerWaitMs: number;
  };
  sessions: Array<{ provider: string; health: string }>;
  /** Findings an optional review Agent raised. Absent when no reviewer ran. */
  reviewFindings?: number;
  jobs: Record<string, { attempts: number; state: "RUNNING" | "COMPLETED" | "WAITING" | "FAILED"; startedAt?: string; completedAt?: string }>;
  /**
   * The durable first-class execution trace, when the ledger has one.
   *
   * This is the PREFERRED source for "which stages ran". Absent on a ledger written before the trace
   * existed, which is the only case in which the inference below is used.
   */
  executedStages?: Array<{ stage: string; kind: "agent" | "platform"; startedAt: string }>;
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

/**
 * Stages implied by the ledger's own record of what happened.
 *
 * LEGACY FALLBACK, and only that. It infers `implement` from a non-empty `modifiedFiles`, `verify`
 * from a non-`NOT_RUN` verification state and `repair` from a retry or a failure, so a stage that ran
 * without producing a diff, a retry or a failure is invisible to it — and a mandatory gate is
 * indistinguishable from an optional Agent stage. That is precisely the ambiguity that made a live
 * experiment about `verify` unanswerable, so a record carrying the durable trace does NOT come through
 * here. Kept so a ledger written before the trace existed still yields a record, flagged as inferred.
 */
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

/**
 * The executed pipeline, from the trace when there is one.
 *
 * Returns the stages AND where the list came from. A reader — and the guard — must be able to tell a
 * recorded observation from a reconstruction, because only the first is evidence about stage presence.
 * A trace that names stages the vocabulary does not know is not silently trimmed: the unknown names
 * are reported, so a pipeline cannot quietly lose a stage it actually ran.
 */
export function executedPipelineOf(record: LedgerRecordView): { stages: CoordinationStage[]; source: "executed-trace" | "inferred"; unknown: string[] } {
  const trace = record.executedStages;
  if (Array.isArray(trace) && trace.length > 0) {
    const named = trace.map((entry) => entry.stage);
    const stages = named.filter((stage): stage is CoordinationStage => COORDINATION_STAGES.includes(stage as CoordinationStage));
    return { stages: [...new Set(stages)], source: "executed-trace", unknown: [...new Set(named.filter((stage) => !stages.includes(stage as CoordinationStage)))] };
  }
  return { stages: pipelineFrom(record), source: "inferred", unknown: [] };
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
export function coordinationRecordFromLedger(record: LedgerRecordView, options: CoordinationDerivationOptions): {
  record: CoordinationRecord;
  unmeasured: CoordinationMeasure[];
  /** The real signal the ledger DOES carry about quality, reported under its own name. */
  verificationFailed: boolean;
  /** Why `inputTokens` is or is not a real measurement, so the provenance travels with the record. */
  tokenProvenance: string;
  /** Where the pipeline list came from, and any stage name the vocabulary did not recognize. */
  pipelineProvenance: { source: "executed-trace" | "inferred" | "caller"; unknown: string[] };
} {
  const observed = options.pipeline
    ? { stages: options.pipeline, source: "caller" as const, unknown: [] }
    : executedPipelineOf(record);
  const pipeline = observed.stages;
  const wallMs = wallMsFrom(record);
  const reworkAvoided = reworkAvoidedFrom(record);
  const diffLines = options.diffLines === undefined ? null : options.diffLines;

  /**
   * Task-level totals: the decision grain, one row per task.
   *
   * The ledger sums a task's consumption and does not attribute it per stage, so this is the only
   * grain at which the figures are real. Nothing here is copied onto stages.
   */
  const totals: CoordinationTaskTotals = {
    modelCalls: record.usage.modelCalls,
    /**
     * The PROVIDER's figure, or nothing.
     *
     * `usage.estimatedInputTokens` is deliberately NOT read here: it is `ceil(characters / 4)`, a
     * heuristic the platform computed, and promoting it would be the false provenance this audit
     * removed. When no provider reported usage the value stays null and the measure stays undeclared,
     * which makes the guard refuse rather than compare invented arithmetic.
     */
    inputTokens: record.usage.providerInputTokens ?? null,
    outputTokens: record.usage.providerOutputTokens ?? null,
    wallMs,
    coordinationMs: record.usage.providerWaitMs,
    executionMs: record.usage.workerRuntimeMs,
    reviewFindings: record.reviewFindings ?? null,
    reworkAvoided,
    diffLines,
    defectsEscaped: null
  };

  const measured: CoordinationMeasure[] = [];
  if (record.usage.modelCalls >= 0) measured.push("modelCalls");
  // Declared only when a provider really reported the figure. `?? null` above and this guard are the
  // same test on purpose: a declared-but-null figure is refused by the guard, so they must agree.
  if (record.usage.providerInputTokens !== undefined) measured.push("inputTokens");
  if (record.usage.providerOutputTokens !== undefined) measured.push("outputTokens");
  if (wallMs !== null) measured.push("wallMs");
  if (record.usage.providerWaitMs >= 0) measured.push("coordinationMs");
  if (record.usage.workerRuntimeMs >= 0) measured.push("executionMs");
  // An OPTIONAL review Agent's findings, when one ran. Absent means no reviewer ran, which is a
  // different fact from a reviewer that ran and found nothing — so this is measured only when the
  // ledger actually carries the count, and the "no reviewer" arm leaves it unmeasured rather than
  // reporting a zero that a comparison would then trust.
  if (record.reviewFindings !== undefined) measured.push("reviewFindings");
  if (reworkAvoided !== null) measured.push("reworkAvoided");
  if (diffLines !== null) measured.push("diffLines");
  // `inputTokens`, `outputTokens` and `defectsEscaped` are deliberately ABSENT from that list, and the
  // values above are null to match: a declared-but-null figure would be refused by the guard anyway,
  // and declaring them would be the false provenance this audit exists to remove.

  /**
   * No stage attribution.
   *
   * An empty array is the honest answer: the ledger has no per-stage cost, and the alternative the
   * first version chose — putting the task totals on one arbitrary "carrier" stage — both invented an
   * attribution and made every other stage look like an unmeasured gap.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- documented as the stage grain above
  const stages: import("./coordination-economics").CoordinationStageRecord[] = [];

  const unmeasured = COORDINATION_MEASURES.filter((measure) => !measured.includes(measure));
  return {
    record: {
      taskId: record.taskId,
      pipeline,
      ...(observed.source === "caller" ? {} : { pipelineSource: observed.source }),
      totals,
      measured,
      stages,
      stageMeasured: [],
      // The provider the task ended on, or a named placeholder when none was ever selected. Naming it
      // `unknown` rather than inventing a runtime keeps an unpaired record from looking comparable.
      runtime: record.activeProvider ?? record.sessions[0]?.provider ?? "unknown",
      ...(options.cohort ? { cohort: options.cohort } : {}),
      diagnostics: {
        estimatedInputTokens: record.usage.estimatedInputTokens,
        estimatedOutputTokens: record.usage.estimatedOutputTokens,
        note: "the estimated* fields are ceil(characters / 4), heuristics the platform computed rather than counts any provider reported, so they are diagnostics and deliberately NOT measurements. inputTokens/outputTokens carry the provider's own usage when it returned one."
      },
      at: options.at
    },
    unmeasured,
    verificationFailed: record.verificationState === "FAILED",
    tokenProvenance: record.usage.providerInputTokens !== undefined
      ? `inputTokens came from the provider's own usage block (${record.usage.providerInputTokens} prompt tokens), persisted on the ledger`
      : "inputTokens is unmeasured: the provider returned no usage block, and the platform's ceil(characters / 4) figure is a diagnostic rather than a measurement",
    pipelineProvenance: { source: observed.source, unknown: observed.unknown }
  };
}
