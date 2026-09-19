/**
 * Runtime Intelligence Plane — confidence calibration.
 *
 * The plane has been emitting `confidence` since Phase A. This module asks whether the number
 * means anything: when an advisor says 0.8, is it right about 80% of the time?
 *
 * The machinery is deliberately minimal — a reliability table, a Brier score and an expected
 * calibration error — because the goal is to find out whether Boss is overconfident, not to
 * build a better predictor. Nothing here is machine learning, and nothing here changes a
 * confidence value.
 *
 * Two fail-closed rules run through it:
 *
 *   - an empty bucket has NO observed support rate (`undefined`), never `0`. A bucket nobody
 *     landed in is not evidence of anything, and a `0` would read as "always wrong";
 *   - a verdict of `WELL_CALIBRATED` requires enough samples. Below the minimum the numbers
 *     are still reported and the verdict is `INSUFFICIENT_EVIDENCE`, because a bias computed
 *     from three outcomes is a rumour.
 *
 * The per-source breakdown is what lets the report answer "which advisor's confidence has no
 * meaning": a source is judged on its own samples, and a small source is told it is
 * unproven rather than being quietly averaged into a global verdict.
 */

/** How many confidence buckets the reliability table has. */
export const CALIBRATION_BUCKET_COUNT = 10;

/** Samples needed before a calibration verdict is a verdict rather than a hint. */
export const MIN_SAMPLES_FOR_CALIBRATION = 20;

/** The absolute mean bias above which a source is called over- or under-confident. */
export const CALIBRATION_BIAS_THRESHOLD = 0.1;

export interface CalibrationSample {
  /** The predicted confidence, 0..1. Values outside the range are clamped; NaN is discarded. */
  predicted: number;
  /** Whether the thing the confidence was about actually happened. */
  observed: boolean;
  /** Where the prediction came from, so a report can name a badly calibrated advisor. */
  source?: string;
}

export interface ReliabilityBucket {
  index: number;
  lower: number;
  upper: number;
  /** How many samples landed in the bucket. */
  count: number;
  /** Mean predicted confidence in the bucket, or `undefined` when empty. */
  meanPredicted: number | undefined;
  /** Observed support rate, or `undefined` when empty — never 0. */
  observedSupport: number | undefined;
  /** `meanPredicted - observedSupport`, or `undefined` when empty. */
  gap: number | undefined;
}

export interface ReliabilityTable {
  buckets: ReliabilityBucket[];
  total: number;
  /** Samples whose prediction could not be read as a number and were excluded, with a reason. */
  discarded: number;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Builds the reliability table.
 *
 * A prediction of exactly 1.0 lands in the top bucket rather than out of range, so a fully
 * confident advisor is measured instead of discarded.
 */
export function buildReliabilityTable(samples: readonly CalibrationSample[], bucketCount: number = CALIBRATION_BUCKET_COUNT): ReliabilityTable {
  const counts = new Array<number>(bucketCount).fill(0);
  const predictedSums = new Array<number>(bucketCount).fill(0);
  const observedSums = new Array<number>(bucketCount).fill(0);
  let total = 0;
  let discarded = 0;

  for (const sample of samples) {
    if (typeof sample.predicted !== "number" || Number.isNaN(sample.predicted)) {
      discarded += 1;
      continue;
    }
    const clamped = Math.min(1, Math.max(0, sample.predicted));
    const index = Math.min(bucketCount - 1, Math.floor(clamped * bucketCount));
    counts[index] += 1;
    predictedSums[index] += clamped;
    observedSums[index] += sample.observed ? 1 : 0;
    total += 1;
  }

  const buckets: ReliabilityBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const count = counts[index];
    const lower = index / bucketCount;
    const upper = (index + 1) / bucketCount;
    if (count === 0) {
      buckets.push({ index, lower, upper, count: 0, meanPredicted: undefined, observedSupport: undefined, gap: undefined });
      continue;
    }
    const meanPredicted = predictedSums[index] / count;
    const observedSupport = observedSums[index] / count;
    buckets.push({ index, lower, upper, count, meanPredicted: round(meanPredicted), observedSupport: round(observedSupport), gap: round(meanPredicted - observedSupport) });
  }

  return { buckets, total, discarded };
}

/** The mean squared error of the predictions. `undefined` with no samples. */
export function brierScore(samples: readonly CalibrationSample[]): number | undefined {
  const usable = samples.filter((sample) => typeof sample.predicted === "number" && !Number.isNaN(sample.predicted));
  if (usable.length === 0) return undefined;
  const total = usable.reduce((sum, sample) => {
    const predicted = Math.min(1, Math.max(0, sample.predicted));
    const observed = sample.observed ? 1 : 0;
    return sum + (predicted - observed) ** 2;
  }, 0);
  return round(total / usable.length);
}

/**
 * The expected calibration error: the count-weighted mean bucket gap.
 *
 * Empty buckets contribute nothing AND are not counted, so an advisor that only ever predicts
 * 0.85 is not flattered by nine empty buckets.
 */
export function expectedCalibrationError(table: ReliabilityTable): number | undefined {
  const populated = table.buckets.filter((bucket) => bucket.count > 0 && bucket.gap !== undefined);
  if (populated.length === 0 || table.total === 0) return undefined;
  const weighted = populated.reduce((sum, bucket) => sum + Math.abs(bucket.gap ?? 0) * bucket.count, 0);
  return round(weighted / table.total);
}

/** The worst populated bucket gap. A single badly calibrated band is worth naming. */
export function maximumCalibrationError(table: ReliabilityTable): number | undefined {
  const gaps = table.buckets.filter((bucket) => bucket.count > 0 && bucket.gap !== undefined).map((bucket) => Math.abs(bucket.gap ?? 0));
  if (gaps.length === 0) return undefined;
  return round(Math.max(...gaps));
}

export type CalibrationVerdict = "WELL_CALIBRATED" | "OVERCONFIDENT" | "UNDERCONFIDENT" | "INSUFFICIENT_EVIDENCE";

export interface CalibrationSourceReport {
  samples: number;
  meanPredicted: number | undefined;
  observedSupportRate: number | undefined;
  bias: number | undefined;
  expectedCalibrationError: number | undefined;
  brierScore: number | undefined;
  verdict: CalibrationVerdict;
}

export interface CalibrationReport {
  samples: number;
  discarded: number;
  table: ReliabilityTable;
  brierScore: number | undefined;
  expectedCalibrationError: number | undefined;
  maximumCalibrationError: number | undefined;
  meanPredicted: number | undefined;
  observedSupportRate: number | undefined;
  /** `meanPredicted - observedSupportRate`. Positive means overconfident. */
  bias: number | undefined;
  verdict: CalibrationVerdict;
  reasons: string[];
  /** Per-source verdicts, so "which advisor is overconfident" is answerable. */
  bySource: Record<string, CalibrationSourceReport>;
}

function verdictFor(samples: number, bias: number | undefined, minimum: number): CalibrationVerdict {
  if (samples < minimum || bias === undefined) return "INSUFFICIENT_EVIDENCE";
  if (bias > CALIBRATION_BIAS_THRESHOLD) return "OVERCONFIDENT";
  if (bias < -CALIBRATION_BIAS_THRESHOLD) return "UNDERCONFIDENT";
  return "WELL_CALIBRATED";
}

function summarise(samples: readonly CalibrationSample[], minimum: number): Omit<CalibrationSourceReport, "samples"> & { samples: number } {
  const usable = samples.filter((sample) => typeof sample.predicted === "number" && !Number.isNaN(sample.predicted));
  const table = buildReliabilityTable(usable);
  if (usable.length === 0) {
    return { samples: 0, meanPredicted: undefined, observedSupportRate: undefined, bias: undefined, expectedCalibrationError: undefined, brierScore: undefined, verdict: "INSUFFICIENT_EVIDENCE" };
  }
  const meanPredicted = usable.reduce((sum, sample) => sum + Math.min(1, Math.max(0, sample.predicted)), 0) / usable.length;
  const observedSupportRate = usable.filter((sample) => sample.observed).length / usable.length;
  const bias = meanPredicted - observedSupportRate;
  return {
    samples: usable.length,
    meanPredicted: round(meanPredicted),
    observedSupportRate: round(observedSupportRate),
    bias: round(bias),
    expectedCalibrationError: expectedCalibrationError(table),
    brierScore: brierScore(usable),
    verdict: verdictFor(usable.length, bias, minimum)
  };
}

/**
 * The full calibration report.
 *
 * A high confidence paired with frequent errors produces `OVERCONFIDENT` with the numbers
 * that justify it; a small sample produces `INSUFFICIENT_EVIDENCE` while still reporting the
 * table, so a reader can see how much is missing instead of being told "no".
 */
export function calibrate(samples: readonly CalibrationSample[], options: { minimum?: number } = {}): CalibrationReport {
  const minimum = options.minimum ?? MIN_SAMPLES_FOR_CALIBRATION;
  const usable = samples.filter((sample) => typeof sample.predicted === "number" && !Number.isNaN(sample.predicted));
  const discarded = samples.length - usable.length;
  const summary = summarise(usable, minimum);
  const reasons: string[] = [];

  if (discarded > 0) reasons.push(`${discarded} sample(s) had no usable predicted confidence and were excluded`);
  if (summary.verdict === "INSUFFICIENT_EVIDENCE") {
    reasons.push(`${summary.samples} usable sample(s) is below the ${minimum} needed for a calibration verdict; the table is reported so the gap is visible`);
  } else if (summary.verdict === "OVERCONFIDENT") {
    reasons.push(`mean predicted ${summary.meanPredicted} against an observed support rate of ${summary.observedSupportRate}: the plane is overconfident by ${summary.bias}`);
  } else if (summary.verdict === "UNDERCONFIDENT") {
    reasons.push(`mean predicted ${summary.meanPredicted} against an observed support rate of ${summary.observedSupportRate}: the plane is underconfident by ${Math.abs(summary.bias ?? 0)}`);
  } else {
    reasons.push(`mean predicted ${summary.meanPredicted} is within ${CALIBRATION_BIAS_THRESHOLD} of the observed support rate ${summary.observedSupportRate}`);
  }

  const sources = [...new Set(usable.map((sample) => sample.source ?? "(unspecified)"))].sort();
  const bySource: Record<string, CalibrationSourceReport> = {};
  for (const source of sources) {
    const forSource = usable.filter((sample) => (sample.source ?? "(unspecified)") === source);
    bySource[source] = summarise(forSource, minimum);
  }

  return {
    samples: usable.length,
    discarded,
    table: buildReliabilityTable(usable),
    brierScore: summary.brierScore,
    expectedCalibrationError: summary.expectedCalibrationError,
    maximumCalibrationError: maximumCalibrationError(buildReliabilityTable(usable)),
    meanPredicted: summary.meanPredicted,
    observedSupportRate: summary.observedSupportRate,
    bias: summary.bias,
    verdict: summary.verdict,
    reasons,
    bySource
  };
}
