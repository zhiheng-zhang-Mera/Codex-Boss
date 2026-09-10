import { BEHAVIOUR_METRIC_KEYS, type BehaviourMetricKey } from "../../../src/shared/behaviour-epoch";

/**
 * Engine Phase 8 — change-point detector (pure, deterministic).
 *
 * Rules from the book (§9):
 *  - a SINGLE anomaly must never open an epoch (A20);
 *  - a minimum sample count is required on BOTH sides of the candidate split;
 *  - the change must be SUSTAINED (measured over the whole window, not one point);
 *  - detection carries a confidence, and a downstream gate decides.
 *
 * Latency is normalised before comparison so a slow network day cannot look like
 * a behaviour change.
 */

export interface BehaviourSample {
  episodeId: string;
  timestamp: string;
  completion: number;
  goalFidelity: number;
  restrictionImpact: number;
  quality?: number;
  latencyMs?: number;
  formatCompliance?: number; // 1 = contract respected, 0 = format failure
}

export interface ChangePointOptions {
  minSamplesPerSide?: number;
  /** Required normalised shift score to declare a change. */
  minShiftScore?: number;
  confidenceThreshold?: number;
  /** Latency (ms) that maps to a full normalised unit of shift. */
  latencyScaleMs?: number;
  metrics?: readonly BehaviourMetricKey[];
}

export interface ChangePointResult {
  changed: boolean;
  confidence: number;
  /** Normalised per-metric shift (after − before). */
  shifts: Partial<Record<BehaviourMetricKey, number>>;
  beforeIds: string[];
  afterIds: string[];
  splitIndex: number;
  reasons: string[];
}

const DEFAULTS = {
  minSamplesPerSide: 4,
  minShiftScore: 0.25,
  confidenceThreshold: 0.5,
  latencyScaleMs: 10_000
} as const;

function normalisedValue(sample: BehaviourSample, metric: BehaviourMetricKey, latencyScaleMs: number): number | undefined {
  switch (metric) {
    case "completion":
      return sample.completion;
    case "goalFidelity":
      return sample.goalFidelity;
    case "restrictionImpact":
      return sample.restrictionImpact;
    case "quality":
      return sample.quality;
    case "latency":
      return sample.latencyMs === undefined ? undefined : Math.min(1, sample.latencyMs / latencyScaleMs);
    case "formatCompliance":
      return sample.formatCompliance;
  }
}

function seriesOf(samples: BehaviourSample[], metric: BehaviourMetricKey, latencyScaleMs: number): number[] {
  return samples
    .map((sample) => normalisedValue(sample, metric, latencyScaleMs))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Scan candidate split points and return the strongest sustained change.
 * The scan requires `minSamplesPerSide` on BOTH sides, which is what makes a
 * single outlier inert.
 */
export function detectChangePoint(samples: BehaviourSample[], options: ChangePointOptions = {}): ChangePointResult {
  const minSamplesPerSide = options.minSamplesPerSide ?? DEFAULTS.minSamplesPerSide;
  const minShiftScore = options.minShiftScore ?? DEFAULTS.minShiftScore;
  const confidenceThreshold = options.confidenceThreshold ?? DEFAULTS.confidenceThreshold;
  const latencyScaleMs = options.latencyScaleMs ?? DEFAULTS.latencyScaleMs;
  const metrics = options.metrics ?? BEHAVIOUR_METRIC_KEYS;

  const ordered = [...samples].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.episodeId.localeCompare(b.episodeId));
  const empty: ChangePointResult = { changed: false, confidence: 0, shifts: {}, beforeIds: [], afterIds: [], splitIndex: -1, reasons: ["insufficient samples"] };
  if (ordered.length < minSamplesPerSide * 2) return empty;

  let best: { score: number; result: ChangePointResult } | undefined;
  for (let split = minSamplesPerSide; split <= ordered.length - minSamplesPerSide; split++) {
    const before = ordered.slice(0, split);
    const after = ordered.slice(split);
    const shifts: Partial<Record<BehaviourMetricKey, number>> = {};
    let magnitude = 0;
    let counted = 0;
    for (const metric of metrics) {
      const beforeSeries = seriesOf(before, metric, latencyScaleMs);
      const afterSeries = seriesOf(after, metric, latencyScaleMs);
      if (beforeSeries.length < minSamplesPerSide || afterSeries.length < minSamplesPerSide) continue;
      const shift = Number((mean(afterSeries) - mean(beforeSeries)).toFixed(4));
      shifts[metric] = shift;
      magnitude += Math.abs(shift);
      counted += 1;
    }
    if (!counted) continue;
    const score = magnitude / counted;
    if (score < minShiftScore) continue;
    // confidence: magnitude relative to the threshold, tempered by sample size
    const sampleFactor = Math.min(1, (ordered.length - minSamplesPerSide * 2 + minSamplesPerSide) / (minSamplesPerSide * 3));
    const confidence = Number(Math.min(0.95, (score / minShiftScore) * 0.6 + sampleFactor * 0.3).toFixed(3));
    const result: ChangePointResult = {
      changed: true,
      confidence,
      shifts,
      beforeIds: before.map((sample) => sample.episodeId),
      afterIds: after.map((sample) => sample.episodeId),
      splitIndex: split,
      reasons: [`sustained shift score ${score.toFixed(4)} across ${counted} metric(s)`]
    };
    if (!best || score > best.score) best = { score, result };
  }

  if (!best || best.result.confidence < confidenceThreshold) {
    return {
      changed: false,
      confidence: best?.result.confidence ?? 0,
      shifts: best?.result.shifts ?? {},
      beforeIds: best?.result.beforeIds ?? [],
      afterIds: best?.result.afterIds ?? [],
      splitIndex: best?.result.splitIndex ?? -1,
      reasons: [best ? `shift below confidence threshold (${best.result.confidence})` : "no sustained shift detected"]
    };
  }
  return best.result;
}
