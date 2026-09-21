import { describe, expect, it } from "vitest";
import {
  CALIBRATION_BIAS_THRESHOLD,
  CALIBRATION_BUCKET_COUNT,
  MIN_SAMPLES_FOR_CALIBRATION,
  brierScore,
  buildReliabilityTable,
  calibrate,
  expectedCalibrationError,
  maximumCalibrationError,
  type CalibrationReport,
  type CalibrationSample,
  type CalibrationSourceReport,
  type CalibrationVerdict,
  type ReliabilityBucket,
  type ReliabilityTable
} from "../../../src/shared/runtime-intelligence/calibration";

/**
 * Phase L. The claim under test is the plan's: a number called `confidence` has to be
 * checked against outcomes, and the check has to say "not enough data" rather than pick a
 * verdict it cannot support. Every bucket-level fact is also asserted to be absent rather
 * than zero when nothing landed in it.
 */

function samples(predicted: number, observed: boolean, count: number, source?: string): CalibrationSample[] {
  return Array.from({ length: count }, () => ({ predicted, observed, ...(source === undefined ? {} : { source }) }));
}

describe("the reliability table is honest about empty buckets", () => {
  it("has ten buckets covering the whole range", () => {
    const table: ReliabilityTable = buildReliabilityTable([]);
    expect(table.buckets).toHaveLength(CALIBRATION_BUCKET_COUNT);
    expect(table.buckets[0]).toMatchObject({ index: 0, lower: 0, upper: 0.1, count: 0 });
    expect(table.buckets.at(-1)).toMatchObject({ index: 9, lower: 0.9, upper: 1 });
    expect(table.total).toBe(0);
  });

  it("reports no support rate for an empty bucket, never zero", () => {
    const table = buildReliabilityTable(samples(0.85, true, 3));
    const empty: ReliabilityBucket = table.buckets[0];
    expect(empty.count).toBe(0);
    expect(empty.observedSupport).toBeUndefined();
    expect(empty.meanPredicted).toBeUndefined();
    expect(empty.gap).toBeUndefined();
    expect(empty.observedSupport).not.toBe(0);
  });

  it("measures a fully confident prediction in the top bucket instead of discarding it", () => {
    const table = buildReliabilityTable([{ predicted: 1, observed: true }]);
    expect(table.buckets[9].count).toBe(1);
    expect(table.discarded).toBe(0);
  });

  it("excludes an unreadable prediction and counts it, rather than treating it as zero", () => {
    const table = buildReliabilityTable([{ predicted: Number.NaN, observed: true }, { predicted: 0.5, observed: true }]);
    expect(table.total).toBe(1);
    expect(table.discarded).toBe(1);
  });

  it("clamps an out-of-range prediction into the table", () => {
    const table = buildReliabilityTable([{ predicted: 1.4, observed: true }, { predicted: -0.2, observed: false }]);
    expect(table.total).toBe(2);
    expect(table.buckets[9].count).toBe(1);
    expect(table.buckets[0].count).toBe(1);
  });
});

describe("the three scores are computed, not asserted", () => {
  it("computes the Brier score of a perfect and a wrong prediction", () => {
    expect(brierScore([{ predicted: 1, observed: true }])).toBe(0);
    expect(brierScore([{ predicted: 0, observed: true }])).toBe(1);
    expect(brierScore([{ predicted: 0.5, observed: true }, { predicted: 0.5, observed: false }])).toBe(0.25);
    expect(brierScore([])).toBeUndefined();
  });

  it("weights the calibration error by bucket population", () => {
    // 18 samples at 0.85 that are all right, 2 at 0.95 that are all wrong.
    const table = buildReliabilityTable([...samples(0.85, true, 18), ...samples(0.95, false, 2)]);
    const ece = expectedCalibrationError(table);
    expect(ece).toBeDefined();
    // (|0.85-1|*18 + |0.95-0|*2) / 20 = (2.7 + 1.9)/20 = 0.23
    expect(ece).toBeCloseTo(0.23, 2);
    expect(maximumCalibrationError(table)).toBeCloseTo(0.95, 2);
  });

  it("returns no calibration error for an empty table instead of zero", () => {
    expect(expectedCalibrationError(buildReliabilityTable([]))).toBeUndefined();
    expect(maximumCalibrationError(buildReliabilityTable([]))).toBeUndefined();
  });
});

describe("overconfidence and underconfidence are distinguished from good calibration", () => {
  it("calls a high-confidence, frequently-wrong advisor OVERCONFIDENT", () => {
    // 0.9 predicted, right 20% of the time: a bias of +0.7.
    const report: CalibrationReport = calibrate([...samples(0.9, true, 4), ...samples(0.9, false, 16)]);
    expect(report.samples).toBe(20);
    expect(report.verdict).toBe("OVERCONFIDENT");
    expect(report.bias).toBeCloseTo(0.7, 2);
    expect(report.meanPredicted).toBeCloseTo(0.9, 2);
    expect(report.observedSupportRate).toBeCloseTo(0.2, 2);
    expect(report.reasons.join(" ")).toContain("overconfident by");
  });

  it("calls an advisor that is right far more often than it claims UNDERCONFIDENT", () => {
    // 0.2 predicted, right 90% of the time: a bias of -0.7.
    const report = calibrate([...samples(0.2, true, 18), ...samples(0.2, false, 2)]);
    expect(report.verdict).toBe("UNDERCONFIDENT");
    expect(report.bias).toBeLessThan(0);
    expect(report.reasons.join(" ")).toContain("underconfident by");
  });

  it("calls a matched advisor WELL_CALIBRATED", () => {
    // 0.8 predicted, right exactly 80% of the time.
    const report = calibrate([...samples(0.8, true, 16), ...samples(0.8, false, 4)]);
    expect(report.verdict).toBe("WELL_CALIBRATED");
    expect(Math.abs(report.bias ?? 1)).toBeLessThanOrEqual(CALIBRATION_BIAS_THRESHOLD);
    expect(report.reasons.join(" ")).toContain("within");
  });

  it("refuses a verdict below the sample minimum while still reporting the numbers", () => {
    const report = calibrate([...samples(0.9, false, 10)]);
    expect(report.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.samples).toBe(10);
    expect(report.bias).toBeCloseTo(0.9, 2);
    expect(report.table.total).toBe(10);
    expect(report.reasons.join(" ")).toContain(`below the ${MIN_SAMPLES_FOR_CALIBRATION}`);
  });

  it("reports no verdict at all for an empty sample", () => {
    const report = calibrate([]);
    expect(report.samples).toBe(0);
    expect(report.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.bias).toBeUndefined();
    expect(report.meanPredicted).toBeUndefined();
    expect(report.brierScore).toBeUndefined();
  });
});

describe("per-source verdicts name which advisor is worst", () => {
  const corpus: CalibrationSample[] = [
    ...samples(0.9, true, 16, "scheduler").flatMap((sample) => [sample]),
    ...samples(0.9, false, 4, "scheduler"),
    ...samples(0.95, false, 20, "continuation"),
    ...samples(0.3, true, 10, "tiny-advisor")
  ];

  it("judges each source on its own samples", () => {
    const report = calibrate(corpus);
    expect(Object.keys(report.bySource).sort()).toEqual(["continuation", "scheduler", "tiny-advisor"]);
    const verdicts: CalibrationVerdict[] = Object.values(report.bySource).map((source) => source.verdict);
    expect(verdicts).toContain("OVERCONFIDENT");
    expect(verdicts).toContain("INSUFFICIENT_EVIDENCE");
    // 16/20 right at 0.9 is a bias of +0.1, right at the threshold; 0/20 right at 0.95 is not.
    expect(report.bySource.continuation.verdict).toBe("OVERCONFIDENT");
    expect(report.bySource.continuation.observedSupportRate).toBe(0);
    expect(report.bySource.continuation.bias).toBeCloseTo(0.95, 2);
    // A source with too few samples is told so, not averaged into a global verdict.
    expect(report.bySource["tiny-advisor"].verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.bySource["tiny-advisor"].samples).toBe(10);
    const scheduler: CalibrationSourceReport = report.bySource.scheduler;
    expect(scheduler.samples).toBe(20);
    expect(scheduler.expectedCalibrationError).toBeDefined();
  });

  it("groups samples with no named source rather than dropping them", () => {
    const report = calibrate([...samples(0.5, true, 5)]);
    expect(report.bySource["(unspecified)"].samples).toBe(5);
  });

  it("counts discarded samples in the report", () => {
    const report = calibrate([{ predicted: Number.NaN, observed: true }, ...samples(0.5, true, 3)]);
    expect(report.discarded).toBe(1);
    expect(report.samples).toBe(3);
    expect(report.reasons.join(" ")).toContain("no usable predicted confidence");
  });
});
