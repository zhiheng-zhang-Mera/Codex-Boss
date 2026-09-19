/**
 * Runtime Intelligence Plane — scheduling replay benchmark.
 *
 * Phase J answers the question the plane could not answer before: were the recommendations
 * any good? It replays recorded tasks against the advice that preceded them and reports a
 * verdict per case plus benchmark metrics.
 *
 * Two design choices make the instrument trustworthy rather than flattering:
 *
 *   - a failure only CONTRADICTS the advice when it is attributable to the model. A run that
 *     died on a network outage is `INCONCLUSIVE`, because the choice of model had nothing to
 *     do with it. Counting it as a contradiction would make the advisor look bad for reasons
 *     it does not control, and counting it as support would be worse;
 *   - the headline score is a LIFT over a stated baseline, never a bare percentage.
 *     `successLiftOverOverall` compares the success rate of followed recommendations with the
 *     success rate of every observed run, so a corpus where everything succeeds cannot make
 *     the advisor look good. `agreementLiftOverMajority` compares agreement with the
 *     majority-model baseline, so agreeing with reality by always naming the most common
 *     model scores zero.
 *
 * The benchmark is a measuring instrument. Nothing in this module reads the advisor's code,
 * and no threshold here is tuned to a fixture: the controls in the test suite feed it a
 * deliberately correct and a deliberately wrong advisor and require it to tell them apart.
 */

import {
  type ReasoningFactor,
  type RuntimeObservation,
  type SchedulingRecommendation
} from "./contracts";
import { calibrate, type CalibrationReport, type CalibrationSample } from "./calibration";

export const BENCHMARK_VERDICTS = ["SUPPORTED", "CONTRADICTED", "INCONCLUSIVE", "NOT_FOLLOWED"] as const;
export type BenchmarkVerdict = (typeof BENCHMARK_VERDICTS)[number];

/** Cases needed before the aggregate is called evidence. */
export const MIN_BENCHMARK_CASES = 10;

/** The confidence at or above which a followed recommendation counts as a confident claim. */
export const CONFIDENT_THRESHOLD = 0.5;

export interface ReplayCase {
  taskId: string;
  /** The recommendation recorded before the run, when one was. */
  recommendation?: SchedulingRecommendation;
  observation: RuntimeObservation;
}

export interface EstimateError {
  estimated: number;
  actual: number;
  absoluteRelativeError: number;
}

export interface ReplayCaseVerdict {
  taskId: string;
  observationId: string;
  verdict: BenchmarkVerdict;
  /** The actual model was the recommended one. */
  modelAgreement: boolean;
  nodeAgreement: boolean;
  /** The actual model was the recommendation's fallback. */
  usedFallback: boolean;
  skillLoadoutAgreement: boolean;
  /** The recommendation's confidence, or `undefined` when there was no recommendation. */
  confidence: number | undefined;
  /** `undefined` when the run's outcome was not observed. */
  observedSuccess: boolean | undefined;
  /** True when a failure was attributed to the model, which is when it counts against the advice. */
  attributedToModel: boolean;
  latencyEstimate?: EstimateError;
  costEstimate?: EstimateError;
  reasons: string[];
}

function relativeError(estimated: number, actual: number): EstimateError {
  const denominator = Math.abs(actual) === 0 ? 1 : Math.abs(actual);
  return { estimated, actual, absoluteRelativeError: Math.round((Math.abs(estimated - actual) / denominator) * 10000) / 10000 };
}

function agreementOf(actual: readonly string[], reference: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...reference].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Judges one replayed case.
 *
 * The order of the checks is the argument: no advice and no observed outcome are each
 * `INCONCLUSIVE` before any comparison is attempted, so a missing record can never be read
 * as either support or contradiction.
 */
export function judgeReplayCase(input: ReplayCase): ReplayCaseVerdict {
  const { observation, recommendation } = input;
  const reasons: string[] = [];
  const domain = observation.execution.failureDomain;
  const outcome = observation.execution.outcome;
  const observedSuccess = outcome === "SUCCESS" ? true : outcome === "FAILED" ? false : undefined;
  // Attributable means "this failure is the model's responsibility". A failure with no recorded
  // domain is treated as attributable rather than escaping judgement; a success has nothing to
  // attribute.
  const attributedToModel = domain === undefined ? observedSuccess === false : domain === "MODEL" || domain === "SEMANTIC";
  if (domain === undefined && observedSuccess === false) {
    reasons.push("no failure domain was recorded, so the failure is treated as attributable to the model rather than escaping judgement");
  }

  const actualModel = observation.model.modelKey;
  const skillLoadoutAgreement = agreementOf(observation.skills.recommended, observation.skills.actual);

  const base = {
    taskId: input.taskId,
    observationId: observation.observationId,
    modelAgreement: recommendation?.preferredModel?.modelKey === actualModel,
    nodeAgreement: recommendation?.preferredNode?.nodeId === observation.node.nodeId,
    usedFallback: recommendation?.fallbackModel?.modelKey === actualModel,
    skillLoadoutAgreement,
    confidence: recommendation?.confidence,
    observedSuccess,
    attributedToModel,
    reasons
  };

  const latencyEstimate =
    recommendation?.estimatedLatencyMs !== undefined && observation.execution.latencyMs !== undefined
      ? relativeError(recommendation.estimatedLatencyMs, observation.execution.latencyMs)
      : undefined;
  const costEstimate =
    recommendation?.estimatedCostUsd !== undefined && observation.execution.costUsd !== undefined
      ? relativeError(recommendation.estimatedCostUsd, observation.execution.costUsd)
      : undefined;

  if (recommendation === undefined) {
    reasons.push("no recommendation was recorded for this run, so there is nothing to compare it with");
    return { ...base, verdict: "INCONCLUSIVE", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
  }
  if (observedSuccess === undefined) {
    reasons.push(`the run's outcome was ${outcome}, so the advice cannot be judged either way`);
    return { ...base, verdict: "INCONCLUSIVE", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
  }

  const recommendedModel = recommendation.preferredModel?.modelKey;
  const followed = recommendedModel === actualModel;
  const followedFallback = base.usedFallback;
  if (!followed && !followedFallback) {
    reasons.push(`the run used ${actualModel} while the advice named ${recommendedModel ?? "no model"}`);
    return { ...base, verdict: "NOT_FOLLOWED", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
  }

  if (observedSuccess) {
    reasons.push(followedFallback ? "the run followed the fallback and succeeded" : "the run followed the advice and succeeded");
    return { ...base, verdict: "SUPPORTED", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
  }
  if (!attributedToModel) {
    reasons.push(`the run failed but the failure was attributed to ${domain}, which is not evidence about the choice`);
    return { ...base, verdict: "INCONCLUSIVE", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
  }
  reasons.push(`the run followed the advice and failed with ${observation.execution.failureClass ?? "an unclassified failure"}`);
  return { ...base, verdict: "CONTRADICTED", ...(latencyEstimate ? { latencyEstimate } : {}), ...(costEstimate ? { costEstimate } : {}) };
}

export interface MeanEstimateError {
  samples: number;
  meanAbsoluteRelativeError: number;
  worstAbsoluteRelativeError: number;
}

function meanError(errors: readonly EstimateError[]): MeanEstimateError | undefined {
  if (errors.length === 0) return undefined;
  const values = errors.map((error) => error.absoluteRelativeError);
  return {
    samples: values.length,
    meanAbsoluteRelativeError: Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10000) / 10000,
    worstAbsoluteRelativeError: Math.max(...values)
  };
}

export interface SchedulerBenchmarkMetrics {
  cases: number;
  /** Cases where an outcome was observed, which are the only ones a metric may use. */
  casesWithOutcome: number;
  verdicts: Record<BenchmarkVerdict, number>;
  modelAgreementRate: number | undefined;
  nodeAgreementRate: number | undefined;
  skillLoadoutAgreementRate: number | undefined;
  /** Success rate among followed cases the advisor was confident about. */
  successPrecision: number | undefined;
  successPrecisionSamples: number;
  /** Failure rate among followed cases the advisor flagged as high risk. */
  failurePrecision: number | undefined;
  failurePrecisionSamples: number;
  /** Success rate of followed recommendations, and of every observed run. The gap is the lift. */
  followedSuccessRate: number | undefined;
  overallSuccessRate: number | undefined;
  successLiftOverOverall: number | undefined;
  /** Agreement compared with always naming the most frequently observed model. */
  majorityModelKey: string | undefined;
  majorityAgreementRate: number | undefined;
  agreementLiftOverMajority: number | undefined;
  latencyEstimation: MeanEstimateError | undefined;
  costEstimation: MeanEstimateError | undefined;
  fallback: { used: number; succeeded: number; rate: number | undefined };
  calibration: CalibrationReport;
  reason: "OK" | "INSUFFICIENT_EVIDENCE";
  notes: string[];
}

/**
 * Benchmarks a corpus of replayed cases.
 *
 * Every rate is `undefined` rather than `0` when its denominator is empty, so "no evidence"
 * and "evidence of failure" never look alike in the report.
 */
export function benchmarkScheduler(cases: readonly ReplayCase[], options: { minimum?: number } = {}): SchedulerBenchmarkMetrics {
  const minimum = options.minimum ?? MIN_BENCHMARK_CASES;
  const verdicts: Record<BenchmarkVerdict, number> = { SUPPORTED: 0, CONTRADICTED: 0, INCONCLUSIVE: 0, NOT_FOLLOWED: 0 };
  const judged = cases.map((entry) => judgeReplayCase(entry));
  for (const verdict of judged) verdicts[verdict.verdict] += 1;

  const withOutcome = judged.filter((verdict) => verdict.observedSuccess !== undefined);
  const modelAgreementSamples = judged.filter((verdict) => verdict.modelAgreement !== undefined && verdict.confidence !== undefined);
  const rate = (numerator: number, denominator: number): number | undefined => (denominator === 0 ? undefined : Math.round((numerator / denominator) * 10000) / 10000);

  const followed = withOutcome.filter((verdict) => verdict.verdict === "SUPPORTED" || verdict.verdict === "CONTRADICTED");
  const modelAgreementCount = modelAgreementSamples.filter((verdict) => verdict.modelAgreement).length;
  const nodeAgreementCount = cases.filter((entry, index) => entry.recommendation?.preferredNode !== undefined && judged[index].nodeAgreement).length;
  const nodeAgreementDenominator = cases.filter((entry) => entry.recommendation?.preferredNode !== undefined).length;
  const skillAgreementCount = judged.filter((verdict) => verdict.skillLoadoutAgreement).length;

  const confidentFollowed = followed.filter((verdict) => (verdict.confidence ?? 0) >= CONFIDENT_THRESHOLD);
  const successPrecision = rate(confidentFollowed.filter((verdict) => verdict.observedSuccess).length, confidentFollowed.length);

  const riskyFollowed = followed.filter((verdict) => {
    const risk = cases.find((entry) => entry.observation.observationId === verdict.observationId)?.recommendation?.estimatedRisk;
    return risk === "high" || risk === "medium";
  });
  const failurePrecision = rate(riskyFollowed.filter((verdict) => verdict.observedSuccess === false).length, riskyFollowed.length);

  const followedSuccessRate = rate(followed.filter((verdict) => verdict.observedSuccess).length, followed.length);
  const overallSuccessRate = rate(withOutcome.filter((verdict) => verdict.observedSuccess).length, withOutcome.length);
  const successLiftOverOverall = followedSuccessRate === undefined || overallSuccessRate === undefined ? undefined : Math.round((followedSuccessRate - overallSuccessRate) * 10000) / 10000;

  const modelCounts = new Map<string, number>();
  for (const entry of cases) modelCounts.set(entry.observation.model.modelKey, (modelCounts.get(entry.observation.model.modelKey) ?? 0) + 1);
  const majorityModelKey = [...modelCounts.entries()].sort((left, right) => (right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]))[0]?.[0];
  const majorityAgreementRate = majorityModelKey === undefined ? undefined : rate(withOutcome.filter((verdict) => cases.find((entry) => entry.taskId === verdict.taskId)?.observation.model.modelKey === majorityModelKey).length, withOutcome.length);
  const agreementLiftOverMajority =
    modelAgreementSamples.length === 0 || majorityAgreementRate === undefined ? undefined : Math.round((modelAgreementCount / modelAgreementSamples.length - majorityAgreementRate) * 10000) / 10000;

  const fallbackCases = judged.filter((verdict) => verdict.usedFallback);
  const fallbackSucceeded = fallbackCases.filter((verdict) => verdict.observedSuccess).length;

  /**
   * Calibration is measured over FOLLOWED cases only.
   *
   * The confidence is a claim about the advised choice, so only a run that actually took the
   * advice can test it. Including runs that ignored the recommendation would punish the
   * advisor for an outcome it did not influence, and would let a corpus of ignored advice
   * report the advisor as overconfident.
   */
  const calibrationSamples: CalibrationSample[] = followed
    .filter((verdict) => verdict.confidence !== undefined)
    .map((verdict) => ({ predicted: verdict.confidence ?? 0, observed: verdict.observedSuccess === true, source: "scheduler" }));

  const notes: string[] = [];
  if (withOutcome.length < minimum) notes.push(`${withOutcome.length} case(s) with an observed outcome is below the ${minimum} needed for a benchmark verdict`);
  if (cases.length > withOutcome.length) notes.push(`${cases.length - withOutcome.length} case(s) had no observed outcome and are excluded from every rate`);
  if (verdicts.NOT_FOLLOWED > 0) notes.push(`${verdicts.NOT_FOLLOWED} case(s) did not follow the advice, so they measure the loop rather than the advisor`);
  if (verdicts.CONTRADICTED === 0 && verdicts.SUPPORTED === 0 && cases.length > 0) notes.push("no case could be judged against its advice");

  return {
    cases: cases.length,
    casesWithOutcome: withOutcome.length,
    verdicts,
    modelAgreementRate: rate(modelAgreementCount, modelAgreementSamples.length),
    nodeAgreementRate: rate(nodeAgreementCount, nodeAgreementDenominator),
    skillLoadoutAgreementRate: rate(skillAgreementCount, judged.length),
    successPrecision,
    successPrecisionSamples: confidentFollowed.length,
    failurePrecision,
    failurePrecisionSamples: riskyFollowed.length,
    followedSuccessRate,
    overallSuccessRate,
    successLiftOverOverall,
    majorityModelKey,
    majorityAgreementRate,
    agreementLiftOverMajority,
    latencyEstimation: meanError(judged.map((verdict) => verdict.latencyEstimate).filter((error): error is EstimateError => error !== undefined)),
    costEstimation: meanError(judged.map((verdict) => verdict.costEstimate).filter((error): error is EstimateError => error !== undefined)),
    fallback: { used: fallbackCases.length, succeeded: fallbackSucceeded, rate: rate(fallbackSucceeded, fallbackCases.length) },
    calibration: calibrate(calibrationSamples),
    reason: withOutcome.length >= minimum ? "OK" : "INSUFFICIENT_EVIDENCE",
    notes
  };
}

/** The factors of a recommendation as report lines, so a benchmark can quote the reasoning. */
export function recommendationFactors(recommendation: SchedulingRecommendation | undefined): ReasoningFactor[] {
  return recommendation === undefined ? [] : [...recommendation.reasoningFactors];
}
