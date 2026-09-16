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

/**
 * The stages that are MANDATORY platform contract gates rather than optional Agent stages.
 *
 * A live paired experiment (`scripts/gate8-pair-run.cjs`, recorded in the Phase 05 status document)
 * established why this distinction has to be explicit. Running the same task twice, with and without a
 * verification contract, produced two arms whose durable records both contain `verify` — because
 * `EngineeringRuntime` writes `verificationState` on every completed task. There is no legal production
 * pipeline without the verification gate, so `verify` has no no-verify baseline and an experiment about
 * it can only ever return `INSUFFICIENT_EVIDENCE`.
 *
 * The conclusion is a definition, not a workaround: verification is a platform INVARIANT that
 * establishes task-completion eligibility (tests, typecheck, acceptance checks, `verificationState`).
 * It is never a candidate for removal, so it must never be the variable an economics experiment
 * changes. What Gate 8 governs is the OPTIONAL Agent stages — an independent review, a second review,
 * a critique, an adjudication, an optional repair agent — whose only justification is that they reduce
 * rework or escaped defects by more than they cost.
 *
 * So a stage in this list may legitimately appear in BOTH arms of an experiment; a stage outside it may
 * not.
 */
export const MANDATORY_GATE_STAGES = ["intake", "verify", "finalize"] as const;
export type MandatoryGateStage = (typeof MANDATORY_GATE_STAGES)[number];

/**
 * The stages Gate 8 may select as a candidate: everything that is not a mandatory gate.
 *
 * `plan` is included because a planning pass is genuinely optional work that costs tokens — but note
 * that a task whose plan is compiled by a planner Agent and a task that takes the deterministic
 * compileIntent path differ in more than one variable, so a pairing on `plan` has to be arranged with
 * care. `review`, `repair` and `critique`-style stages are the natural candidates.
 */
export const OPTIONAL_AGENT_STAGES = COORDINATION_STAGES.filter(
  (stage): stage is Exclude<CoordinationStage, MandatoryGateStage> => !(MANDATORY_GATE_STAGES as readonly string[]).includes(stage)
);

/** Whether a stage is a mandatory platform contract gate rather than an optional Agent stage. */
export function isMandatoryGateStage(stage: string): stage is MandatoryGateStage {
  return (MANDATORY_GATE_STAGES as readonly string[]).includes(stage);
}

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

/**
 * The identity a paired comparison must share.
 *
 * Gate 8's with/without sets have to differ in exactly one thing: the candidate stage. Equal task
 * COUNTS are not comparability, and neither is a per-task average — two runs of different tasks, on
 * different models, or against different acceptance criteria can have identical averages and prove
 * nothing. So the pairing carries its identity explicitly and the guard refuses a mismatched pair,
 * rather than trusting whoever assembled the sets to have matched them.
 */
interface CoordinationPolicy {
  /** The model/runtime configuration, e.g. `api:deepseek:chat`. */
  runtime: string;
  /** The benchmark task family or cohort both arms were drawn from. */
  benchmarkTaskId: string;
  /** A hash or id of the input and acceptance requirements, so "same input" is checkable. */
  inputIdentity: string;
  /**
   * The one thing the two arms are allowed to differ in.
   *
   * A paired run declares this so the guard can say what the experiment WAS, instead of inferring the
   * variable from whichever stages happen to be present.
   */
  plannedVariable: string;
}

/** A record's cohort: what it is comparable to. */
export interface CoordinationCohort extends CoordinationPolicy {
  /** `with-candidate` or `baseline`, plus anything a caller needs to name the arm. */
  arm: string;
}

/**
 * What a whole task cost and produced.
 *
 * This is the grain the cost/benefit decision is made at, because it is the grain the durable ledger
 * actually records: it holds task totals and does not attribute them to stages. Every field is
 * `number | null` with its own declaration, so "we measured zero" and "we did not measure" stay
 * distinguishable.
 */
export interface CoordinationTaskTotals {
  modelCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallMs: number | null;
  coordinationMs: number | null;
  executionMs: number | null;
  reviewFindings: number | null;
  reworkAvoided: number | null;
  diffLines: number | null;
  defectsEscaped: number | null;
}

/** The measures a task-level totals block declares as observed. */
export type CoordinationTaskMeasured = CoordinationMeasure[];

export interface CoordinationRecord {
  taskId: string;
  /** The pipeline the task ran through, in order. */
  pipeline: CoordinationStage[];
  /**
   * Where `pipeline` came from.
   *
   * `executed-trace` — the durable ledger recorded these stages as they ran. This is the only source
   * that is evidence about stage PRESENCE, because it does not depend on the stage having left a
   * diff, a retry or a finding behind.
   *
   * `inferred` — reconstructed from the finished record by `pipelineFrom`, which is a legacy fallback
   * for ledgers written before the trace existed. It cannot tell a mandatory gate from an optional
   * Agent stage, so a real Gate 8 pairing refuses a record that carries it.
   *
   * `caller` — supplied by the caller of the adapter. Kept for the certificate's probe records and the
   * deterministic fixtures, both of which construct their pipelines explicitly and neither of which
   * claims to be a production observation.
   *
   * Optional so a record written before this field existed still loads; a real pairing treats an
   * absent value as untrusted rather than as traced.
   */
  pipelineSource?: "executed-trace" | "inferred" | "caller";
  /**
   * Task-level totals. THE decision grain.
   *
   * Separate from `stages` because a task total is not a stage measurement: the ledger sums a task's
   * cost without knowing which stage spent it. Keeping them apart is what lets a five-stage production
   * record be judged on its real totals without inventing a per-stage attribution, and it is why
   * `stages` may legitimately be empty.
   */
  totals: CoordinationTaskTotals;
  /** The measures `totals` actually observed. */
  measured: CoordinationTaskMeasured;
  /**
   * Stage-level measurements, ONLY where a stage's cost was genuinely attributable.
   *
   * Empty when the source could not attribute cost per stage, which is the normal case for a ledger
   * derived record. An empty array means "no stage attribution available", never "every stage cost
   * nothing" — the distinction the first version of this model lost by putting task totals into a
   * carrier stage and then requiring every other stage to carry them too.
   */
  stages: CoordinationStageRecord[];
  /**
   * The measures the `stages` rows genuinely observe.
   *
   * The STAGE grain, kept separate from `measured` (the task grain) because they are different claims:
   * a task total says "the task cost this much", a stage measurement says "THIS STAGE cost this much".
   * Empty is the honest state for a source that could not attribute cost per stage.
   */
  stageMeasured?: CoordinationMeasure[];
  /** Which model/runtime produced the figures, so a comparison is like for like. */
  runtime: string;
  /**
   * What this record may be compared against.
   *
   * Optional so a single observation can still be recorded, but a record without it can never take
   * part in a promotion decision: the guard refuses a pairing whose cohort identity it cannot check.
   */
  cohort?: CoordinationCohort;
  /**
   * Figures kept for DIAGNOSIS that are deliberately NOT measurements.
   *
   * `estimatedInputTokens` belongs here: the platform computes it as `ceil(characters / 4)`, which is
   * a heuristic rather than a tokenizer, and `ApiCompletion` carries no usage block at all so no
   * provider-counted tokens ever reach the ledger. Publishing it as `inputTokens` would be exactly the
   * "estimate wearing the label of a measurement" this phase forbids, and renaming it would not change
   * where it came from.
   */
  diagnostics?: {
    estimatedInputTokens?: number | null;
    estimatedOutputTokens?: number | null;
    /** Why a diagnostic is not a measurement, so a reader is not left to infer it. */
    note?: string;
  };
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
  /** Totals over the records that observed each measure. `null` where no record did. */
  totals: CoordinationTotals;
  /** How many tasks ran this stage. */
  tasks: number;
  /** Measures some record did not observe: either not declared, or declared and left null. */
  unmeasured: CoordinationMeasure[];
  /** Whether EVERY record observed EVERY measure the comparison reads, per that record's own declaration. */
  complete: boolean;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * What one record's own declaration says about one of its STAGE measurements.
 *
 * Two ways a figure can be unusable, and both are problems rather than zeroes:
 *
 *  - **declared but null**: the record says it measured this and then supplies nothing. Trusting the
 *    declaration would count a missing figure as 0, which is the hand-filled arithmetic this phase
 *    forbids;
 *  - **not declared but present**: the record supplies a number it did not claim to have measured.
 *    That is a contradiction, and a comparison built on it would be comparing a figure of unknown
 *    provenance.
 *
 * A value that is neither declared nor present is a plain gap: not a problem, just unmeasured. The
 * declaration consulted here is `stageMeasured` — the STAGE grain — not the task-level one, because a
 * stage figure and a task figure are different claims and the first version conflated them.
 */
function auditStage(record: CoordinationRecord, stage: CoordinationStageRecord, measure: CoordinationMeasure): { usable: boolean; problem: string | null } {
  const declared = (record.stageMeasured ?? []).includes(measure);
  const value = stage[measure];
  if (declared && value === null) {
    return { usable: false, problem: `${record.taskId}/${stage.stage}: ${measure} is declared as a stage measurement but is null, so it cannot be counted` };
  }
  if (!declared && value !== null) {
    return { usable: false, problem: `${record.taskId}/${stage.stage}: ${measure} has a stage value but is not declared a stage measurement, so its provenance is unclear` };
  }
  return { usable: declared && value !== null, problem: null };
}

/**
 * Whether a task-level figure is usable: declared AND non-null.
 *
 * The task-level counterpart of `auditStage`, and the grain the decision reads. A declared-but-null
 * task total is a missing measurement wearing the label of a real one, so it must fail closed rather
 * than be summed as zero.
 */
function auditTaskTotal(record: CoordinationRecord, measure: CoordinationMeasure): { usable: boolean; problem: string | null } {
  const declared = record.measured.includes(measure);
  const value = record.totals[measure];
  if (declared && value === null) {
    return { usable: false, problem: `${record.taskId}: ${measure} is declared as a task total but is null, so it cannot be counted` };
  }
  if (!declared && value !== null) {
    return { usable: false, problem: `${record.taskId}: ${measure} carries a task total but is not declared measured, so its provenance is unclear` };
  }
  return { usable: declared && value !== null, problem: null };
}

/**
 * Total ONE TASK from its task-level totals.
 *
 * The decision grain. It reads `record.totals`, never the stages — so it cannot double-count, because
 * a task total is already the whole task. The stage rows are consulted only to report how much of the
 * task was attributed per stage, which is diagnostic.
 */
export function totalRecord(record: CoordinationRecord): CoordinationTotals {
  const value = (measure: CoordinationMeasure): number | null =>
    auditTaskTotal(record, measure).usable ? record.totals[measure] : null;
  const wallMs = value("wallMs") ?? 0;
  const coordinationMs = value("coordinationMs") ?? 0;
  return {
    modelCalls: value("modelCalls") ?? 0,
    inputTokens: value("inputTokens") ?? 0,
    outputTokens: value("outputTokens") ?? 0,
    wallMs,
    coordinationMs,
    executionMs: value("executionMs") ?? 0,
    reviewFindings: value("reviewFindings") ?? 0,
    reworkAvoided: value("reworkAvoided") ?? 0,
    diffLines: value("diffLines") ?? 0,
    defectsEscaped: value("defectsEscaped") ?? 0,
    coordinationShare: wallMs > 0 ? coordinationMs / wallMs : null
  };
}

/**
 * How much of a task's cost was attributed to each stage, for diagnosis.
 *
 * Reports the attributed figure and whether the attribution is COMPLETE for the task. An incomplete
 * attribution is not an error — it is the normal case for a ledger-derived record, whose source sums
 * a task without knowing which stage spent what. What must never happen is treating the attributed
 * part as if it were the whole, which is why the task totals are the decision grain.
 */
export function stageAttribution(record: CoordinationRecord, measure: CoordinationMeasure): { attributed: number; stages: number; complete: boolean } {
  const rows = record.stages.filter((stage) => (record.stageMeasured ?? []).includes(measure) && stage[measure] !== null);
  const attributed = rows.reduce((total, stage) => total + (stage[measure] ?? 0), 0);
  const total = auditTaskTotal(record, measure).usable ? record.totals[measure] ?? 0 : 0;
  return { attributed, stages: rows.length, complete: rows.length > 0 && attributed === total };
}

/**
 * Total one stage across a set of records, using ONLY genuine stage provenance.
 *
 * Records that carry no stage attribution are excluded from the stage figure and counted in
 * `unattributedTasks`, rather than contributing a zero or being silently dropped. The first version of
 * this function instead required EVERY record to carry the measure on the stage, which made any
 * normal multi-stage production record unusable.
 */
export function totalStage(records: readonly CoordinationRecord[], stage: CoordinationStage): StageEconomics & { unattributedTasks: string[]; measuresWithAttribution: CoordinationMeasure[] } {
  const relevant = records.filter((record) => record.pipeline.includes(stage));
  const pairs = relevant
    .map((record) => ({ record, stage: record.stages.find((entry) => entry.stage === stage) }))
    .filter((pair): pair is { record: CoordinationRecord; stage: CoordinationStageRecord } => pair.stage !== undefined);
  const unattributedTasks = relevant.filter((record) => !record.stages.some((entry) => entry.stage === stage)).map((record) => record.taskId).sort();

  const unmeasured = COORDINATION_MEASURES.filter((measure) =>
    pairs.some((pair) => !auditStage(pair.record, pair.stage, measure).usable));
  /**
   * The aggregate carries only the measures that were usable everywhere among the records that DID
   * attribute this stage.
   *
   * Passing `[...COORDINATION_MEASURES]` here was a defect inside an earlier fix: it declared every
   * measure for the aggregate, which re-admitted the very value the audit had just judged undeclared.
   */
  const usableEverywhere = COORDINATION_MEASURES.filter((measure) =>
    pairs.length > 0 && pairs.every((pair) => auditStage(pair.record, pair.stage, measure).usable));
  /**
   * The stage aggregate sums the STAGE rows directly.
   *
   * Not via `totalRecord`: that function reads the TASK grain, which would report a task's whole cost
   * as if it were this stage's — the exact attribution error the grain split exists to prevent. A
   * measure contributes only where it was declared a stage measurement AND is non-null.
   */
  const stageValue = (measure: CoordinationMeasure): Array<number | null> =>
    pairs.map((pair) => (auditStage(pair.record, pair.stage, measure).usable ? pair.stage[measure] : null));
  const wallMs = sum(stageValue("wallMs"));
  const coordinationMs = sum(stageValue("coordinationMs"));
  const totals: CoordinationTotals = {
    modelCalls: sum(stageValue("modelCalls")),
    inputTokens: sum(stageValue("inputTokens")),
    outputTokens: sum(stageValue("outputTokens")),
    wallMs,
    coordinationMs,
    executionMs: sum(stageValue("executionMs")),
    reviewFindings: sum(stageValue("reviewFindings")),
    reworkAvoided: sum(stageValue("reworkAvoided")),
    diffLines: sum(stageValue("diffLines")),
    defectsEscaped: sum(stageValue("defectsEscaped")),
    coordinationShare: wallMs > 0 ? coordinationMs / wallMs : null
  };
  return {
    stage,
    totals,
    tasks: relevant.length,
    unmeasured,
    // Complete means every record that ran this stage attributed it, and every measure was usable.
    complete: relevant.length > 0 && unattributedTasks.length === 0 && unmeasured.length === 0,
    unattributedTasks,
    measuresWithAttribution: usableEverywhere
  };
}

/** The judgements the guard can reach, and one of them is deliberately "I cannot tell". */
const GUARD_VERDICTS = ["EARNS_PLACE", "COST_ONLY", "INSUFFICIENT_EVIDENCE"] as const;
type GuardVerdict = (typeof GUARD_VERDICTS)[number];

/**
 * The measures a promotion decision can be based on.
 *
 * Two are derived from evidence the platform actually has, and both come from the durable ledger:
 * `reworkAvoided` (jobs whose first attempt failed and a later attempt completed) and
 * `reviewFindings` (the interruptions the loop raised).
 *
 * `defectsEscaped` is deliberately NOT here by default, and this is a finding rather than an
 * oversight: escapes are discovered AFTER a task finishes, outside any run, so no ledger can report
 * them. Only the Owner can, by reporting that something got through. An experiment that has that
 * input passes `defectsEscaped` in `decisionMeasures`; one that does not is decided on rework, which
 * is the book's other named benefit ("不改善 defect/rework").
 */
const COST_MEASURES: CoordinationMeasure[] = ["modelCalls", "inputTokens", "wallMs"];

const DEFAULT_DECISION_MEASURES: CoordinationMeasure[] = ["reworkAvoided"];

/** The measures that can additionally sharpen a decision when a caller has them. */
const OPTIONAL_DECISION_MEASURES: CoordinationMeasure[] = ["defectsEscaped", "reviewFindings"];

/** What a caller may base a decision on, and what the guard will therefore require. */
interface GuardDecisionOptions {
  /**
   * The benefit measures this experiment claims to judge.
   *
   * Every one must be observed by every record, or the guard refuses. Defaults to rework alone.
   */
  decisionMeasures?: CoordinationMeasure[];
}

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

/**
 * Combine several tasks into one arm's totals.
 *
 * Each record contributes its TASK total exactly once. It does not also add up the stage rows: those
 * are an attribution of the same money, so summing both would count a task's cost twice — once as a
 * total and again as the parts that make it up. That double count is the specific hazard the grain
 * split exists to prevent.
 */
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

/**
 * Whether every record observed every measure the decision needs, AT THE TASK GRAIN.
 *
 * This reads `record.totals` and `record.measured`. It deliberately does NOT read the stage rows: a
 * record whose source could not attribute cost per stage has an empty `stages` array, which is a
 * normal and honest state, and requiring the task total to appear on every stage would refuse every
 * production record. Stage-level completeness is a separate question, answered by `totalStage` and
 * reported as diagnosis rather than as a precondition for the decision.
 */
function decisionEvidenceProblems(records: readonly CoordinationRecord[], decisions: readonly CoordinationMeasure[]): string[] {
  const problems: string[] = [];
  // Cost is always required: a benefit comparison with no cost side is not a cost/benefit decision.
  const required: CoordinationMeasure[] = [...COST_MEASURES, ...decisions];
  for (const record of records) {
    for (const measure of required) {
      const audited = auditTaskTotal(record, measure);
      if (!audited.usable) {
        problems.push(audited.problem ?? `${record.taskId}: ${measure} is not usable as a task total`);
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * Whether two arms are a legitimate paired comparison.
 *
 * Comparability is NOT "the same number of tasks" and NOT "similar per-task averages": two arms of
 * different tasks, on different models, or against different acceptance criteria can match on both
 * and prove nothing. The identity has to be shared and the difference has to be the planned variable,
 * so it is checked rather than assumed.
 */
function comparabilityProblems(withStage: readonly CoordinationRecord[], withoutStage: readonly CoordinationRecord[], stage: CoordinationStage): string[] {
  const problems: string[] = [];
  const all = [...withStage, ...withoutStage];
  const missing = all.filter((record) => !record.cohort);
  if (missing.length > 0) {
    problems.push(`${missing.length} record(s) carry no cohort identity (${missing.slice(0, 3).map((record) => record.taskId).join(", ")}), so comparability cannot be checked`);
    return problems;
  }

  const field = <K extends keyof CoordinationCohort>(pick: K): string[] => [...new Set(all.map((record) => String(record.cohort?.[pick])))].sort();
  for (const [name, values] of [["runtime", field("runtime")], ["benchmarkTaskId", field("benchmarkTaskId")], ["inputIdentity", field("inputIdentity")], ["plannedVariable", field("plannedVariable")]] as const) {
    if (values.length > 1) {
      problems.push(`the two arms disagree on ${name} (${values.join(", ")}), so they are not a paired comparison`);
    }
  }
  // The record's own runtime must agree with the cohort's, or one of the two is wrong.
  for (const record of all) {
    if (record.cohort && record.cohort.runtime !== record.runtime) {
      problems.push(`${record.taskId}: runtime ${record.runtime} disagrees with its cohort's ${record.cohort.runtime}`);
    }
  }
  // Exactly the candidate stage is the planned variable, and it is present in one arm and absent in
  // the other. A "planned variable" naming something else means this is not the experiment being asked
  // about, whatever the pipelines happen to look like.
  if (all.every((record) => record.cohort?.plannedVariable !== stage)) {
    problems.push(`no cohort declares ${stage} as its planned variable, so these records are not an experiment about ${stage}`);
  }
  const arms = new Set(all.map((record) => record.cohort?.arm));
  if (arms.size < 2) {
    problems.push(`both sets share the arm label ${[...arms].join(", ")}, so they are one arm rather than a pair`);
  }
  // Nothing outside the planned variable may differ between the arms.
  const pipelineOf = (records: readonly CoordinationRecord[]): string[] =>
    [...new Set(records.map((record) => [...record.pipeline].sort().join("+")))].sort();
  const baselinePipelines = pipelineOf(withoutStage);
  const candidatePipelines = pipelineOf(withStage);
  for (const pipeline of candidatePipelines) {
    const withoutStageName = pipeline.split("+").filter((entry) => entry !== stage).join("+");
    if (!baselinePipelines.includes(withoutStageName)) {
      problems.push(`the candidate pipeline ${pipeline} has no matching baseline ${withoutStageName}, so more than the candidate stage differs between the arms`);
    }
  }
  return problems;
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
 *
 * `COST_ONLY` is a RESULT, not a failure of the experiment: the book's purpose is to prevent an
 * unprofitable stage becoming default, so a stage that measurably buys nothing and costs more has been
 * correctly evaluated, and the answer is to leave it out.
 */
export function evaluateStageGuard(input: {
  stage: CoordinationStage;
  /** Records from tasks that ran the fuller pipeline, including the candidate stage. */
  withStage: readonly CoordinationRecord[];
  /** Records from comparable tasks that ran without it. */
  withoutStage: readonly CoordinationRecord[];
  /** The benefit measures this experiment judges. Defaults to rework alone; see below. */
  decisionMeasures?: CoordinationMeasure[];
}): GuardResult {
  const reasons: string[] = [];
  const stage = input.stage;

  // A mandatory platform contract gate has no legal no-gate production arm, so it can never be the
  // thing an experiment varies. Refusing here — rather than leaving it to a reader to notice — is what
  // stops a safety invariant from being silently adjudicated out of the pipeline. A live paired run
  // about `verify` produced exactly this result and was recorded as a platform design finding.
  if (isMandatoryGateStage(stage)) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      stage,
      comparison: null,
      reasons: [
        `${stage} is a mandatory platform contract gate, not an optional Agent stage: it establishes task-completion eligibility and is present in every completed task's trace, so no legal production pipeline runs without it`,
        `Gate 8 judges whether an EXTRA Agent stage earns its place; a mandatory gate is not a candidate for removal`
      ]
    };
  }

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
  if (input.withStage.length > 0 && input.withoutStage.length > 0) {
    reasons.push(...comparabilityProblems(input.withStage, input.withoutStage, stage));
  }
  // Every record is checked against its own declaration and its own values. This is the fix for a
  // defect that made the guard answerable only when the data was already clean: it previously looked
  // at whether the measure appeared in ANY record's declaration, so one well-measured task could vouch
  // for a set of tasks that had never measured the figure at all.
  const decisions = [...new Set([...(input.decisionMeasures ?? DEFAULT_DECISION_MEASURES)])];
  for (const measure of decisions) {
    if (!COORDINATION_MEASURES.includes(measure)) reasons.push(`decision measure ${measure} is not a coordination measure`);
  }
  if (decisions.length === 0) reasons.push("no benefit measure was named, so there is no benefit to compare against the cost");
  reasons.push(...decisionEvidenceProblems([...input.withStage, ...input.withoutStage], decisions));
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
  const reworkPerTask = perTask(candidate, (entry) => entry.reworkAvoided) - perTask(baseline, (entry) => entry.reworkAvoided);
  const costPerTask = perTask(candidate, (entry) => entry.inputTokens) - perTask(baseline, (entry) => entry.inputTokens);

  // The benefit test reads the measures this experiment actually judged. An experiment that did not
  // measure escapes cannot be decided on them, and pretending otherwise would either invent them or
  // refuse every real run.
  const defectsPerTask = decisions.includes("defectsEscaped")
    ? perTask(candidate, (entry) => entry.defectsEscaped) - perTask(baseline, (entry) => entry.defectsEscaped)
    : null;
  const findingsPerTask = decisions.includes("reviewFindings")
    ? perTask(candidate, (entry) => entry.reviewFindings) - perTask(baseline, (entry) => entry.reviewFindings)
    : null;
  const boughtSomething = (defectsPerTask !== null && defectsPerTask < 0) || reworkPerTask > 0;
  const costsMore = costPerTask > 0 || comparison.addedWallMs > 0;
  // The benefit sentence names only the measures this experiment judged, so a reader is never told
  // about a figure that was not part of the decision.
  const benefitSentence = [
    defectsPerTask === null ? null : `escaped defects by ${defectsPerTask.toFixed(2)}`,
    `rework avoided by ${reworkPerTask.toFixed(2)}`,
    findingsPerTask === null ? null : `findings by ${findingsPerTask.toFixed(2)}`
  ].filter(Boolean).join(", ");
  const judged = `judged on ${decisions.join(" and ")}`;
  if (boughtSomething) {
    return {
      verdict: "EARNS_PLACE",
      stage,
      comparison,
      reasons: [
        `per task, ${stage} changed ${benefitSentence} (${judged})`,
        `its added cost per task was ${costPerTask.toFixed(0)} input tokens`
      ]
    };
  }
  return {
    verdict: "COST_ONLY",
    stage,
    comparison,
    reasons: [
      `per task, ${stage} changed ${benefitSentence} (${judged}), so it bought nothing measurable`,
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
