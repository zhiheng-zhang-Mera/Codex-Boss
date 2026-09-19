/**
 * Runtime Intelligence Plane — the intelligence evaluation report.
 *
 * This is the round's deliverable: one report that answers, from measured data, whether the
 * plane's advice is worth anything — and that is allowed to answer "not enough data".
 *
 * Two rules shape it.
 *
 * First, **evidence and readiness are separated**. The report states what was measured and
 * then, separately, whether the measurements are enough to propose giving the plane execution
 * authority. It carries `grantsExecutionAuthority: false` as a literal, so reading the report
 * can never be mistaken for a permission.
 *
 * Second, **the report never invents a number**. Every metric is either measured or the string
 * `NOT_MEASURED`, and a question whose data does not exist says so with the specific reason —
 * "the loop's per-step completion state is not recorded, so no false-stop rate can be
 * computed" is a finding, and it is more useful than a zero.
 */

import type { CalibrationReport } from "./calibration";
import type { ContinuationBenchmarkMetrics } from "./continuation-benchmark";
import type { SchedulerBenchmarkMetrics } from "./scheduler-benchmark";
import type { SkillReplayAggregate } from "./skill-replay";

export const EVALUATION_REPORT_SCHEMA_VERSION = 1;

/**
 * A false-stop rate at or below this is the gate for proposing assisted execution.
 *
 * It is deliberately stricter than the unnecessary-continue tolerance, mirroring the penalty
 * asymmetry: stopping a task that had work left is a failure a human has to notice, while an
 * extra round is a cost.
 */
export const MAX_FALSE_STOP_RATE_FOR_ASSISTED = 0.02;

/** The named readiness gates. Every one must pass before the report says READY. */
export const ASSISTED_EXECUTION_GATES = ["scheduler-beats-baseline", "false-stop-rate-low", "ledger-calibrated", "loadout-no-underload-risk"] as const;
export type AssistedExecutionGate = (typeof ASSISTED_EXECUTION_GATES)[number];

/** The metric names the round's acceptance requires, in one place so none can be dropped. */
export const EVALUATION_METRIC_KEYS = [
  "MODEL_OUTCOMES_INGESTED",
  "TASKS_REPLAYED",
  "SCHEDULER_SUPPORTED",
  "SCHEDULER_CONTRADICTED",
  "SCHEDULER_INCONCLUSIVE",
  "CONTINUATION_DECISIONS_REPLAYED",
  "FALSE_STOP_COUNT",
  "FALSE_STOP_RATE",
  "UNNECESSARY_CONTINUE_RATE",
  "SWITCH_MODEL_ERROR_RATE",
  "SKILL_LOADOUT_REPLAYS",
  "ESTIMATED_SKILL_OVERHEAD_REDUCTION",
  "NODE_SNAPSHOTS_RAW",
  "NODE_SNAPSHOTS_AFTER_COMPACTION",
  "CONFIDENCE_CALIBRATION_ERROR",
  "TELEMETRY_STORAGE_GROWTH",
  "ROOT_TRUST_TOUCHED",
  "QUALIFICATION_TOUCHED",
  "OWNER_REVIEW_PATHS"
] as const;
export type EvaluationMetricKey = (typeof EVALUATION_METRIC_KEYS)[number];

export type MetricValue = number | string;

export interface IngestionStats {
  considered: number;
  ingested: number;
  charged: number;
  refused: number;
  domains: Record<string, number>;
  degraded: string[];
  sources: Array<{ name: string; present: boolean; records: number; degradedReason?: string }>;
}

export interface NodeTelemetryStats {
  rawSamples: number;
  afterCompaction: number;
  suppressedSamples: number;
  archivedEntries: number;
  bytes: { samples: number; archive: number; index: number };
  nodes: string[];
  /** Per node, how much of a snapshot was actually observable and what was not. */
  coverageByNode: Array<{ nodeId: string; coverage: number; absentKeys: string[] }>;
}

export interface PlaneStorageStats {
  observations: number;
  recommendations: number;
  models: number;
  contextRecords: number;
  skillTelemetry: number;
  bytes: Record<string, number>;
}

export interface BoundaryFacts {
  rootTrustTouched: boolean;
  qualificationTouched: boolean;
  ownerReviewPaths: string[];
  /** What the authority decision function answered for this branch's change set. */
  authorityDecision: string;
  changeClass: string;
}

export interface EvaluationInput {
  generatedAt: string;
  ingestion?: IngestionStats;
  scheduler?: SchedulerBenchmarkMetrics;
  continuation?: ContinuationBenchmarkMetrics;
  skillReplay?: SkillReplayAggregate;
  calibration?: CalibrationReport;
  nodeTelemetry?: NodeTelemetryStats;
  storage?: PlaneStorageStats;
  /**
   * False when the recorded data cannot support a continuation replay — the loop's per-step
   * completion state is not recorded, so a false-stop rate cannot be computed from it.
   */
  continuationReplayPossible?: boolean;
  boundary: BoundaryFacts;
}

export interface EvaluationQuestion {
  id: string;
  question: string;
  answer: string;
  evidence: string;
}

export interface EvaluationGateResult {
  gate: AssistedExecutionGate;
  passed: boolean;
  detail: string;
}

export interface EvaluationReport {
  schemaVersion: number;
  kind: "RUNTIME_INTELLIGENCE_EVALUATION_REPORT";
  generatedAt: string;
  authority: "ADVISORY_ONLY";
  /** Literal: this report evidences readiness and grants nothing. */
  grantsExecutionAuthority: false;
  readiness: "READY_FOR_ASSISTED_EXECUTION_PROPOSAL" | "INSUFFICIENT_EVIDENCE";
  samples: Record<string, number>;
  metrics: Record<EvaluationMetricKey, MetricValue>;
  questions: EvaluationQuestion[];
  gates: EvaluationGateResult[];
  notes: string[];
}

function metric(value: number | undefined | null): MetricValue {
  return value === undefined || value === null || Number.isNaN(value) ? "NOT_MEASURED" : value;
}

function count(entries: Record<string, number>): Array<{ id: string; count: number }> {
  return Object.entries(entries)
    .map(([id, value]) => ({ id, count: value }))
    .sort((left, right) => (right.count === left.count ? left.id.localeCompare(right.id) : right.count - left.count));
}

function topUnused(entries: Record<string, number>, limit = 3): string {
  const ranked = count(entries);
  if (ranked.length === 0) return "none recorded";
  return ranked.slice(0, limit).map((entry) => `${entry.id} (${entry.count}x)`).join(", ");
}

function misCalibratedSources(report: CalibrationReport | undefined): string {
  if (report === undefined) return "no calibration data";
  const bad = Object.entries(report.bySource)
    .filter(([, source]) => source.verdict === "OVERCONFIDENT" || source.verdict === "UNDERCONFIDENT")
    .map(([source, value]) => `${source} (${value.verdict}, bias ${value.bias}, n=${value.samples})`);
  return bad.length === 0 ? "none: no source is over- or under-confident on its own samples" : bad.join("; ");
}

function unknownNodes(stats: NodeTelemetryStats | undefined): string {
  if (stats === undefined || stats.coverageByNode.length === 0) return "no node snapshots were sampled";
  return stats.coverageByNode.map((node) => `${node.nodeId} ${(node.coverage * 100).toFixed(0)}% observed; not measured: ${node.absentKeys.join(", ") || "nothing"}`).join(" | ");
}

/**
 * Evidence for a question: the numbers it rests on, then any caveat.
 *
 * Counts come first so a question can never have empty evidence — "no caveats" is itself worth
 * saying, and an empty string in a report reads as a missing field.
 */
function evidenceFor(counts: string, notes: readonly string[]): string {
  const caveats = notes.filter((note) => note.trim() !== "");
  return caveats.length === 0 ? `${counts}; no caveats recorded` : `${counts}; ${caveats.join("; ")}`;
}

function answeredQuestions(input: EvaluationInput): EvaluationQuestion[] {
  const scheduler = input.scheduler;
  const continuation = input.continuation;
  const calibration = input.calibration ?? scheduler?.calibration;
  const skill = input.skillReplay;

  return [
    {
      id: "ledger-calibration",
      question: "Has the model scoring become more accurate recently?",
      answer:
        calibration === undefined || calibration.verdict === "INSUFFICIENT_EVIDENCE"
          ? "NOT_MEASURED: not enough outcomes with a recorded confidence to calibrate"
          : `${calibration.verdict}: predicted ${calibration.meanPredicted} against an observed support rate of ${calibration.observedSupportRate} over ${calibration.samples} sample(s)`,
      evidence:
        calibration === undefined
          ? "no calibration report was produced"
          : evidenceFor(`${calibration.samples} sample(s), expected calibration error ${metric(calibration.expectedCalibrationError)}, Brier ${metric(calibration.brierScore)}`, calibration.reasons)
    },
    {
      id: "scheduler-success",
      question: "How often are the scheduler's recommendations successful?",
      answer:
        scheduler === undefined || scheduler.reason !== "OK"
          ? `INSUFFICIENT_EVIDENCE: ${scheduler?.casesWithOutcome ?? 0} case(s) with an observed outcome`
          : `success precision ${scheduler.successPrecision ?? "NOT_MEASURED"} over ${scheduler.successPrecisionSamples} confident followed case(s); followed success rate ${scheduler.followedSuccessRate} against an overall ${scheduler.overallSuccessRate} (lift ${scheduler.successLiftOverOverall})`,
      evidence:
        scheduler === undefined
          ? "no scheduler benchmark was produced"
          : evidenceFor(`${scheduler.cases} case(s), ${scheduler.verdicts.SUPPORTED} supported, ${scheduler.verdicts.CONTRADICTED} contradicted, ${scheduler.verdicts.INCONCLUSIVE} inconclusive, ${scheduler.verdicts.NOT_FOLLOWED} not followed`, scheduler.notes)
    },
    {
      id: "skills-mounted-unused",
      question: "Which skills are mounted often but never used?",
      answer: skill === undefined ? "NOT_MEASURED: no loadout replays" : `${skill.unusedOriginalSkillCount} mounted-but-unused instance(s) across ${skill.replaysWithUsageObserved} replay(s); most frequent: ${topUnused(skill.unusedSkillCounts)}`,
      evidence: skill === undefined ? "no skill replay was produced" : evidenceFor(`${skill.replays} replay(s), load reduction ${skill.loadReduction} over proven replays, ${skill.droppedUsedSkillCount} invoked skill(s) dropped`, skill.notes)
    },
    {
      id: "context-injected-without-contribution",
      question: "Which context is injected often but contributes nothing?",
      answer:
        "NOT_MEASURED: the context lifecycle plans injections and records them on the observation, but no outcome is attributed back to an individual context record yet, so a contribution figure does not exist",
      evidence: "the plane records context.injected/candidate/archived per run; per-record contribution needs a later phase, and inventing it now would be a fabricated number"
    },
    {
      id: "continuation-calls-saved",
      question: "If the continuation evaluator had execution authority, how many calls would it save?",
      answer:
        continuation === undefined || continuation.reason !== "OK"
          ? "INSUFFICIENT_EVIDENCE: no judged replay steps"
          : `${continuation.estimatedCallsSaved} call(s) across ${continuation.judgedSteps} judged step(s)`,
      evidence:
        continuation === undefined
          ? "no continuation replay was produced"
          : evidenceFor(`${continuation.steps} step(s) recorded, ${continuation.judgedSteps} judged, weighted penalty ${continuation.weightedPenalty}`, continuation.notes)
    },
    {
      id: "continuation-false-stops",
      question: "How many false stops does it produce?",
      answer:
        continuation === undefined || continuation.falseStopRate === undefined
          ? "NOT_MEASURED: the shadow advice never said STOP in the recorded data, so no false-stop rate exists"
          : `${continuation.falseStopCount} false stop(s) out of ${continuation.stopsAdvised} STOP advice(s), a rate of ${continuation.falseStopRate}`,
      evidence: evidenceFor(
        `asymmetric penalty in force: a false stop costs ${continuation?.penaltyByKind.falseStop ?? 0} against ${continuation?.penaltyByKind.unnecessaryContinue ?? 0} for an unnecessary continue`,
        continuation?.notes ?? []
      )
    },
    {
      id: "overconfident-advice",
      question: "Which advice is confident but often wrong?",
      answer: misCalibratedSources(calibration),
      evidence: calibration === undefined ? "no calibration report was produced" : evidenceFor(`${calibration.samples} sample(s) across ${Object.keys(calibration.bySource).length} source(s)`, calibration.reasons)
    },
    {
      id: "unknown-nodes",
      question: "Which nodes are often UNKNOWN?",
      answer: unknownNodes(input.nodeTelemetry),
      evidence:
        input.nodeTelemetry === undefined
          ? "no node telemetry was sampled"
          : evidenceFor(`${input.nodeTelemetry.rawSamples} raw sample(s) collapsed to ${input.nodeTelemetry.afterCompaction} entry(ies), ${input.nodeTelemetry.suppressedSamples} suppressed, ${input.nodeTelemetry.archivedEntries} archived`, [])
    },
    {
      id: "enough-data",
      question: "Is there enough data to support the next stage?",
      answer: input.ingestion === undefined ? "NOT_MEASURED: no ingestion summary" : `${input.ingestion.ingested} real outcome(s) ingested, ${input.ingestion.charged} charged to a model and ${input.ingestion.refused} refused as non-attributable`,
      evidence:
        input.ingestion === undefined
          ? "no ingestion was performed"
          : evidenceFor(`domains: ${Object.entries(input.ingestion.domains).map(([domain, value]) => `${domain}=${value}`).join(", ") || "none"}`, input.ingestion.degraded)
    }
  ];
}

function evaluateGates(input: EvaluationInput): EvaluationGateResult[] {
  const scheduler = input.scheduler;
  const continuation = input.continuation;
  const calibration = input.calibration ?? scheduler?.calibration;
  const skill = input.skillReplay;

  /**
   * "Stably better than a simple baseline" means both halves: following the advice does better
   * than the average observed run (the lift), and the advice agrees with reality at least as
   * often as always naming the most common model.
   *
   * Agreement is `>=` rather than `>` on purpose. Demanding strictly MORE agreement than the
   * majority baseline would reward an advisor for disagreeing with the majority, which is not a
   * quality goal; the lift is what shows the per-task choice was better.
   */
  const schedulerBeatsBaseline =
    scheduler !== undefined &&
    scheduler.reason === "OK" &&
    scheduler.successLiftOverOverall !== undefined &&
    scheduler.successLiftOverOverall > 0 &&
    scheduler.modelAgreementRate !== undefined &&
    scheduler.majorityAgreementRate !== undefined &&
    scheduler.modelAgreementRate >= scheduler.majorityAgreementRate;

  const falseStopLow = continuation !== undefined && continuation.reason === "OK" && continuation.falseStopRate !== undefined && continuation.falseStopRate <= MAX_FALSE_STOP_RATE_FOR_ASSISTED;

  const ledgerCalibrated = calibration !== undefined && calibration.verdict === "WELL_CALIBRATED";

  const loadoutSafe = skill !== undefined && skill.reason === "OK" && skill.droppedUsedSkillCount === 0 && skill.riskCounts.HIGH === 0;

  return [
    {
      gate: "scheduler-beats-baseline",
      passed: schedulerBeatsBaseline,
      detail: scheduler === undefined ? "no scheduler benchmark" : `lift over overall success ${metric(scheduler.successLiftOverOverall)}; agreement ${metric(scheduler.modelAgreementRate)} against a majority baseline of ${metric(scheduler.majorityAgreementRate)}`
    },
    {
      gate: "false-stop-rate-low",
      passed: falseStopLow,
      detail: continuation === undefined ? "no continuation replay" : `false-stop rate ${metric(continuation.falseStopRate)} must be at or below ${MAX_FALSE_STOP_RATE_FOR_ASSISTED}`
    },
    {
      gate: "ledger-calibrated",
      passed: ledgerCalibrated,
      detail: calibration === undefined ? "no calibration report" : `verdict ${calibration.verdict}, bias ${metric(calibration.bias)}, samples ${calibration.samples}`
    },
    {
      gate: "loadout-no-underload-risk",
      passed: loadoutSafe,
      detail: skill === undefined ? "no skill replay" : `${skill.droppedUsedSkillCount} invoked skill(s) dropped, ${skill.riskCounts.HIGH} high-risk replay(s)`
    }
  ];
}

/**
 * Builds the report.
 *
 * Readiness is `READY_FOR_ASSISTED_EXECUTION_PROPOSAL` only when every gate passes on measured
 * data. Anything less — including "the data does not exist" — is `INSUFFICIENT_EVIDENCE`. The
 * report never returns a "probably fine".
 */
export function buildEvaluationReport(input: EvaluationInput): EvaluationReport {
  const scheduler = input.scheduler;
  const continuation = input.continuation;
  const calibration = input.calibration ?? scheduler?.calibration;
  const skill = input.skillReplay;
  const node = input.nodeTelemetry;
  const storage = input.storage;

  const metrics: Record<EvaluationMetricKey, MetricValue> = {
    MODEL_OUTCOMES_INGESTED: metric(input.ingestion?.ingested),
    TASKS_REPLAYED: metric(scheduler?.cases),
    SCHEDULER_SUPPORTED: metric(scheduler?.verdicts.SUPPORTED),
    SCHEDULER_CONTRADICTED: metric(scheduler?.verdicts.CONTRADICTED),
    SCHEDULER_INCONCLUSIVE: metric(scheduler?.verdicts.INCONCLUSIVE),
    CONTINUATION_DECISIONS_REPLAYED: metric(continuation?.judgedSteps),
    FALSE_STOP_COUNT: metric(continuation?.falseStopCount),
    FALSE_STOP_RATE: metric(continuation?.falseStopRate),
    UNNECESSARY_CONTINUE_RATE: metric(continuation?.unnecessaryContinueRate),
    SWITCH_MODEL_ERROR_RATE: metric(continuation?.switchModelErrorRate),
    SKILL_LOADOUT_REPLAYS: metric(skill?.replays),
    ESTIMATED_SKILL_OVERHEAD_REDUCTION: metric(skill?.estimatedTokenSaved),
    NODE_SNAPSHOTS_RAW: metric(node?.rawSamples),
    NODE_SNAPSHOTS_AFTER_COMPACTION: metric(node?.afterCompaction),
    CONFIDENCE_CALIBRATION_ERROR: metric(calibration?.expectedCalibrationError),
    TELEMETRY_STORAGE_GROWTH: metric(storage === undefined ? undefined : Object.values(storage.bytes).reduce((total, value) => total + value, 0)),
    ROOT_TRUST_TOUCHED: input.boundary.rootTrustTouched ? "YES" : "NO",
    QUALIFICATION_TOUCHED: input.boundary.qualificationTouched ? "YES" : "NO",
    OWNER_REVIEW_PATHS: input.boundary.ownerReviewPaths.length === 0 ? "none" : input.boundary.ownerReviewPaths.join(", ")
  };

  const gates = evaluateGates(input);
  const notes: string[] = [];
  for (const gate of gates) if (!gate.passed) notes.push(`gate not met: ${gate.gate} (${gate.detail})`);
  if (input.continuationReplayPossible === false) {
    notes.push("a real continuation replay is not possible from the recorded data: the loop's per-step completion state is not recorded, so a false-stop rate cannot be computed from it");
  }
  if (input.ingestion !== undefined && input.ingestion.degraded.length > 0) notes.push(`ingestion was degraded: ${input.ingestion.degraded.join("; ")}`);
  if (input.boundary.authorityDecision !== "ALLOW") notes.push(`the authority decision for this change set was ${input.boundary.authorityDecision}`);

  return {
    schemaVersion: EVALUATION_REPORT_SCHEMA_VERSION,
    kind: "RUNTIME_INTELLIGENCE_EVALUATION_REPORT",
    generatedAt: input.generatedAt,
    authority: "ADVISORY_ONLY",
    grantsExecutionAuthority: false,
    readiness: gates.every((gate) => gate.passed) ? "READY_FOR_ASSISTED_EXECUTION_PROPOSAL" : "INSUFFICIENT_EVIDENCE",
    samples: {
      ingestedOutcomes: input.ingestion?.ingested ?? 0,
      schedulerCases: scheduler?.cases ?? 0,
      schedulerCasesWithOutcome: scheduler?.casesWithOutcome ?? 0,
      continuationSteps: continuation?.judgedSteps ?? 0,
      skillReplays: skill?.replays ?? 0,
      skillReplaysWithUsage: skill?.replaysWithUsageObserved ?? 0,
      nodeSamples: node?.rawSamples ?? 0,
      calibrationSamples: calibration?.samples ?? 0
    },
    metrics,
    questions: answeredQuestions(input),
    gates,
    notes
  };
}
