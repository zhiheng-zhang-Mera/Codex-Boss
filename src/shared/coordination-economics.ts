/**
 * Agent coordination economics (Phase 05, Task D).
 *
 * The book asks for a per-task account of what a multi-agent pipeline costs and what it buys:
 * model calls, input/output tokens, wall time, coordination time, coding/execution time, review
 * findings, rework avoided, final diff size, defects escaped. And then the rule that gives the
 * account its purpose:
 *
 *   > adding an extra Agent stage must not become the default pipeline if it only increases
 *   > token/wall-time without improving defect/rework
 *
 * ## What this module refuses to do
 *
 * It will not invent a number. A `CoordinationRecord` carries `measured` alongside each figure, and a
 * record whose stage costs or gains were NOT observed cannot be used to promote a stage — the guard
 * returns `INSUFFICIENT_EVIDENCE` and says which figures are missing. That is the only stance that
 * makes the guard worth having: a pipeline-composition rule that accepted estimated token counts
 * would approve an expensive stage on the strength of a guess.
 *
 * ## Where the figures come from
 *
 * The repository already records most of them for real. `Consumption` on the task ledger carries
 * `modelCalls`, `estimatedInputTokens`, `retries` and `toolCalls`, incremented as work happens, and
 * `modifiedFiles` is the diff surface. This module consumes those rather than re-deriving them, so a
 * record describes the running system instead of a parallel accounting that could drift from it.
 *
 * Pure: no clock, no I/O. A record can be written into an artifact and re-evaluated later.
 */

/** The stages a Boss pipeline can be composed of, in the order the book names them. */
export const COORDINATION_STAGES = [
  "intake",
  "plan",
  "implement",
  "verify",
  "review",
  "repair",
  "finalize"
] as const;
export type CoordinationStage = (typeof COORDINATION_STAGES)[number];

/** Which figures a record actually observed, as opposed to leaving unmeasured. */
export const COORDINATION_MEASURES = [
  "modelCalls",
  "inputTokens",
  "outputTokens",
  "wallMs",
  "coordinationMs",
  "executionMs",
  "reviewFindings",
  "reworkAvoided",
  "diffLines",
  "defectsEscaped"
] as const;
export type CoordinationMeasure = (typeof COORDINATION_MEASURES)[number];

/** What one stage of one task cost and produced. Absent figures are `null`, never zero. */
export interface CoordinationStageRecord {
  stage: CoordinationStage;
  modelCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallMs: number | null;
  /** Time spent waiting on or coordinating other stages rather than doing the work. */
  coordinationMs: number | null;
  /** Time spent producing or executing the change. */
  executionMs: number | null;
  /** Findings this stage raised. */
  reviewFindings: number | null;
  /** Findings raised by an EARLIER stage that this stage removed before they escaped. */
  reworkAvoided: number | null;
  diffLines: number | null;
  /** Defects that reached the Owner or production despite this stage. */
  defectsEscaped: number | null;
}

export interface CoordinationRecord {
  taskId: string;
  /** The pipeline the task ran through, in order. */
  pipeline: CoordinationStage[];
  stages: CoordinationStageRecord[];
  /** Which model/runtime produced the figures, so a comparison is like for like. */
  runtime: string;
  /**
   * The measures a run actually observed.
   *
   * Declared rather than inferred from nulls, because "we measured zero findings" and "we did not
   * look for findings" are different claims and only the first can support a promotion.
   */
  measured: CoordinationMeasure[];
  at: string;
}

interface CoordinationTotals {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
  coordinationMs: number;
  executionMs: number;
  reviewFindings: number;
  reworkAvoided: number;
  diffLines: number;
  defectsEscaped: number;
  /** Coordination cost as a share of wall time. `null` when wall time was not observed. */
  coordinationShare: number | null;
}

interface StageEconomics {
  stage: CoordinationStage;
  totals: CoordinationTotals;
  /** How many tasks ran this stage. */
  tasks: number;
  /** Measures that at least one record left unobserved. */
  unmeasured: CoordinationMeasure[];
  /** Whether every task that ran a stage observed every figure the comparison needs. */
  complete: boolean;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Total one record, counting each measure only where it was observed. */
export function totalRecord(record: CoordinationRecord): CoordinationTotals {
  const pick = (measure: CoordinationMeasure): Array<number | null> =>
    record.stages.map((stage) => (record.measured.includes(measure) ? stage[measure] : null));
  const wallMs = sum(pick("wallMs"));
  const coordinationMs = sum(pick("coordinationMs"));
  return {
    modelCalls: sum(pick("modelCalls")),
    inputTokens: sum(pick("inputTokens")),
    outputTokens: sum(pick("outputTokens")),
    wallMs,
    coordinationMs,
    executionMs: sum(pick("executionMs")),
    reviewFindings: sum(pick("reviewFindings")),
    reworkAvoided: sum(pick("reworkAvoided")),
    diffLines: sum(pick("diffLines")),
    defectsEscaped: sum(pick("defectsEscaped")),
    coordinationShare: wallMs > 0 ? coordinationMs / wallMs : null
  };
}

/** Total one stage across a set of records, keeping unmeasured figures visible. */
export function totalStage(records: readonly CoordinationRecord[], stage: CoordinationStage): StageEconomics {
  const relevant = records.filter((record) => record.pipeline.includes(stage));
  const stageRecords = relevant.map((record) => record.stages.find((entry) => entry.stage === stage)).filter((entry): entry is CoordinationStageRecord => entry !== undefined);
  const unmeasured = COORDINATION_MEASURES.filter((measure) => stageRecords.some((entry) => !relevant[0].measured.includes(measure) || entry[measure] === null));
  const totals = totalRecord({
    taskId: `${stage}-aggregate`,
    pipeline: [stage],
    stages: stageRecords,
    runtime: relevant[0]?.runtime ?? "unknown",
    measured: [...COORDINATION_MEASURES],
    at: relevant[0]?.at ?? ""
  });
  return {
    stage,
    totals,
    tasks: relevant.length,
    unmeasured,
    // A stage is complete only when every figure the cost/benefit comparison reads was observed for
    // every task that ran it. Anything less and the comparison would be between different things.
    complete: relevant.length > 0 && unmeasured.length === 0
  };
}

/** The judgements the guard can reach, and one of them is deliberately "I cannot tell". */
const GUARD_VERDICTS = ["EARNS_PLACE", "COST_ONLY", "INSUFFICIENT_EVIDENCE"] as const;
type GuardVerdict = (typeof GUARD_VERDICTS)[number];

/** The measures a promotion decision depends on. Without these there is no decision to make. */
const DECISION_MEASURES: CoordinationMeasure[] = ["modelCalls", "inputTokens", "wallMs", "reworkAvoided", "defectsEscaped"];

interface StageComparison {
  /** The pipeline without the candidate stage. */
  baseline: CoordinationTotals & { tasks: number };
  /** The pipeline with it. */
  candidate: CoordinationTotals & { tasks: number };
  addedModelCalls: number;
  addedInputTokens: number;
  addedWallMs: number;
  addedCoordinationMs: number;
  /** Negative when the stage REDUCED defects or rework — the direction that earns a place. */
  changeInReworkAvoided: number;
  changeInDefectsEscaped: number;
}

interface GuardResult {
  verdict: GuardVerdict;
  /** The stage being judged. */
  stage: CoordinationStage;
  comparison: StageComparison | null;
  /** Every reason, so a refusal names each figure it is missing rather than the first. */
  reasons: string[];
}

function combine(records: readonly CoordinationRecord[]): CoordinationTotals & { tasks: number } {
  const totals = records.map(totalRecord);
  const wallMs = sum(totals.map((entry) => entry.wallMs));
  const coordinationMs = sum(totals.map((entry) => entry.coordinationMs));
  return {
    tasks: records.length,
    modelCalls: sum(totals.map((entry) => entry.modelCalls)),
    inputTokens: sum(totals.map((entry) => entry.inputTokens)),
    outputTokens: sum(totals.map((entry) => entry.outputTokens)),
    wallMs,
    coordinationMs,
    executionMs: sum(totals.map((entry) => entry.executionMs)),
    reviewFindings: sum(totals.map((entry) => entry.reviewFindings)),
    reworkAvoided: sum(totals.map((entry) => entry.reworkAvoided)),
    diffLines: sum(totals.map((entry) => entry.diffLines)),
    defectsEscaped: sum(totals.map((entry) => entry.defectsEscaped)),
    coordinationShare: wallMs > 0 ? coordinationMs / wallMs : null
  };
}

/** Whether a record observed every measure the decision needs. */
function missingDecisionMeasures(records: readonly CoordinationRecord[]): CoordinationMeasure[] {
  return DECISION_MEASURES.filter((measure) => records.some((record) => !record.measured.includes(measure)));
}

/**
 * Decide whether a stage earns a place in the default pipeline.
 *
 * The rule, stated so it can be argued with rather than merely obeyed:
 *
 *  - the stage must have bought something: FEWER defects escaped, or MORE rework avoided, than the
 *    same tasks without it. A stage that only costs more is `COST_ONLY`;
 *  - a stage that bought nothing AND cost nothing observable is not a pass either — it is
 *    `INSUFFICIENT_EVIDENCE`, because a comparison of unobserved figures is not a comparison;
 *  - ties go against the stage. If it changed neither defects nor rework, the cheaper pipeline wins,
 *    which is the book's rule read literally: "只增加 token/wall-time 且不改善 defect/rework" is
 *    precisely a tie on benefit plus a cost.
 */
export function evaluateStageGuard(input: {
  stage: CoordinationStage;
  /** Records from tasks that ran the fuller pipeline, including the candidate stage. */
  withStage: readonly CoordinationRecord[];
  /** Records from comparable tasks that ran without it. */
  withoutStage: readonly CoordinationRecord[];
}): GuardResult {
  const reasons: string[] = [];
  const stage = input.stage;

  if (input.withStage.length === 0) reasons.push(`no task ran the pipeline with ${stage}, so nothing is being compared`);
  if (input.withoutStage.length === 0) reasons.push(`no comparable task ran the pipeline without ${stage}, so there is no baseline`);
  if (input.withStage.some((record) => !record.pipeline.includes(stage))) {
    reasons.push(`a record in the with-stage set does not actually include ${stage}`);
  }
  if (input.withoutStage.some((record) => record.pipeline.includes(stage))) {
    reasons.push(`a record in the without-stage set actually includes ${stage}, so the sets overlap`);
  }
  const mixedRuntimes = new Set([...input.withStage, ...input.withoutStage].map((record) => record.runtime));
  if (mixedRuntimes.size > 1) {
    reasons.push(`the two sets ran on different runtimes (${[...mixedRuntimes].sort().join(", ")}), so their costs are not comparable`);
  }
  const missing = missingDecisionMeasures([...input.withStage, ...input.withoutStage]);
  if (missing.length > 0) {
    reasons.push(`the decision needs ${missing.join(", ")}, which was not observed`);
  }
  if (reasons.length > 0) return { verdict: "INSUFFICIENT_EVIDENCE", stage, comparison: null, reasons };

  const baseline = combine(input.withoutStage);
  const candidate = combine(input.withStage);
  const comparison: StageComparison = {
    baseline,
    candidate,
    addedModelCalls: candidate.modelCalls - baseline.modelCalls,
    addedInputTokens: candidate.inputTokens - baseline.inputTokens,
    addedWallMs: candidate.wallMs - baseline.wallMs,
    addedCoordinationMs: candidate.coordinationMs - baseline.coordinationMs,
    changeInReworkAvoided: candidate.reworkAvoided - baseline.reworkAvoided,
    changeInDefectsEscaped: candidate.defectsEscaped - baseline.defectsEscaped
  };

  // The per-task figures, because a stage that halves defects while tripling the task count has not
  // proved anything: comparing totals across different sample sizes is the classic way a stage
  // "earns" its place by being run more.
  const perTask = (totals: CoordinationTotals & { tasks: number }, pick: (entry: CoordinationTotals) => number): number =>
    totals.tasks === 0 ? 0 : pick(totals) / totals.tasks;
  const defectsPerTask = perTask(candidate, (entry) => entry.defectsEscaped) - perTask(baseline, (entry) => entry.defectsEscaped);
  const reworkPerTask = perTask(candidate, (entry) => entry.reworkAvoided) - perTask(baseline, (entry) => entry.reworkAvoided);
  const costPerTask = perTask(candidate, (entry) => entry.inputTokens) - perTask(baseline, (entry) => entry.inputTokens);

  const boughtSomething = defectsPerTask < 0 || reworkPerTask > 0;
  const costsMore = costPerTask > 0 || comparison.addedWallMs > 0;
  if (boughtSomething) {
    return {
      verdict: "EARNS_PLACE",
      stage,
      comparison,
      reasons: [
        `per task, ${stage} changed escaped defects by ${defectsPerTask.toFixed(2)} and rework avoided by ${reworkPerTask.toFixed(2)}`,
        `its added cost per task was ${costPerTask.toFixed(0)} input tokens`
      ]
    };
  }
  return {
    verdict: "COST_ONLY",
    stage,
    comparison,
    reasons: [
      `per task, ${stage} changed escaped defects by ${defectsPerTask.toFixed(2)} and rework avoided by ${reworkPerTask.toFixed(2)}, so it bought nothing measurable`,
      costsMore
        ? `it still added ${costPerTask.toFixed(0)} input tokens and ${comparison.addedWallMs} ms per task`
        : "it matched the baseline's cost, so a tie on benefit is decided against the extra stage"
    ]
  };
}

/**
 * The default pipeline a guard result permits.
 *
 * Refuses to add a stage whose verdict is anything but `EARNS_PLACE`, and refuses to REMOVE a stage
 * the caller marked as required, because a guard that can quietly drop a verification step is worse
 * than no guard.
 */
export function permittedPipeline(input: {
  current: readonly CoordinationStage[];
  candidate: CoordinationStage;
  verdict: GuardVerdict;
  required?: readonly CoordinationStage[];
}): { pipeline: CoordinationStage[]; changed: boolean; reason: string } {
  const current = [...input.current];
  const required = new Set(input.required ?? []);
  if (current.includes(input.candidate)) {
    return { pipeline: current, changed: false, reason: `${input.candidate} is already in the pipeline` };
  }
  if (input.verdict !== "EARNS_PLACE") {
    return {
      pipeline: current,
      changed: false,
      reason: `${input.candidate} is not added: the guard returned ${input.verdict}, and a stage that has not shown a defect or rework improvement does not become default`
    };
  }
  return {
    pipeline: [...current, input.candidate],
    changed: true,
    reason: `${input.candidate} is added after the guard returned EARNS_PLACE${required.size > 0 ? `; ${[...required].join(", ")} remain required and are never removed by this rule` : ""}`
  };
}

/** A one-screen account of a pipeline run, so the economics are readable without the raw records. */
export function summarizeCoordination(records: readonly CoordinationRecord[]): string {
  if (records.length === 0) return "no coordination records";
  const totals = combine(records);
  const share = totals.coordinationShare === null ? "unmeasured" : `${(totals.coordinationShare * 100).toFixed(1)}%`;
  return [
    `${records.length} task(s) through ${[...new Set(records.flatMap((record) => record.pipeline))].length} stage(s)`,
    `per task: ${(totals.modelCalls / totals.tasks).toFixed(1)} model calls, ${(totals.inputTokens / totals.tasks).toFixed(0)} input tokens, ${(totals.wallMs / totals.tasks).toFixed(0)} ms`,
    `coordination share of wall time: ${share}`,
    `findings ${totals.reviewFindings}, rework avoided ${totals.reworkAvoided}, defects escaped ${totals.defectsEscaped}, diff ${totals.diffLines} line(s)`
  ].join("\n");
}
