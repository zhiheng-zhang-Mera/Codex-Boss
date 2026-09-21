import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_STATUSES,
  absentMeasurements,
  attemptMeasurement,
  describeMeasurement,
  isMeasured,
  mapMeasurement,
  measured,
  measurementAbsenceReason,
  measurementCoverage,
  measurementStatus,
  measurementValue,
  notMeasured,
  unavailable,
  unreadable,
  unknown
} from "../../../src/shared/runtime-intelligence/measurement";
import type { AbsentFact, MeasuredFact, MeasurementStatus } from "../../../src/shared/runtime-intelligence/measurement";

/**
 * The plane's first invariant: what cannot be measured may never read as a healthy value.
 *
 * Every case below is one of the ways a codebase turns an absence into a positive fact —
 * a default parameter, a `?? []`, a caught exception that returns zero, a fabricated
 * "none" — and each one is required to fail here instead.
 */

const AT = "2026-01-01T00:00:00.000Z";

describe("measurement is a closed vocabulary of five states", () => {
  it("declares exactly the five statuses, with MEASURED as the only value-bearing one", () => {
    expect(MEASUREMENT_STATUSES).toEqual(["MEASURED", "UNKNOWN", "UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"]);
    expect(isMeasured(measured(1, "probe", AT))).toBe(true);
    for (const fact of [unknown("no probe"), unreadable("threw"), unavailable("wrong platform"), notMeasured("not looked")]) {
      expect(isMeasured(fact)).toBe(false);
    }
  });

  it("carries provenance on a measured fact, so a value can be traced to a probe", () => {
    const fact: MeasuredFact<number> = measured(12, "node:os.cpus", AT);
    expect(fact.source).toBe("node:os.cpus");
    expect(fact.observedAt).toBe(AT);
    expect(measurementValue(fact)).toBe(12);
  });

  it("requires a reason for every absence rather than accepting a bare null", () => {
    const absent: AbsentFact[] = [unknown("r"), unreadable("r"), unavailable("r"), notMeasured("r")];
    expect(absent.map((fact) => fact.status)).toEqual(["UNKNOWN", "UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"]);
    for (const fact of absent) {
      expect(fact.reason).toBe("r");
      expect(measurementAbsenceReason(fact)).toBe("r");
      expect(measurementValue(fact)).toBeUndefined();
    }
    const statuses: MeasurementStatus[] = ["MEASURED", "UNKNOWN", "UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"];
    expect(statuses).toEqual(MEASUREMENT_STATUSES);
  });
});

describe("fail-closed: an absence never becomes a value", () => {
  it("returns undefined instead of a default for every absent status", () => {
    const statuses = MEASUREMENT_STATUSES.filter((status) => status !== "MEASURED");
    for (const status of statuses) {
      const fact = status === "UNKNOWN" ? unknown("x") : status === "UNREADABLE" ? unreadable("x") : status === "UNAVAILABLE" ? unavailable("x") : notMeasured("x");
      expect(measurementStatus(fact)).toBe(status);
      expect(measurementValue(fact), `${status} produced a value`).toBeUndefined();
    }
  });

  it("turns a throwing probe into UNREADABLE, never into a measured value", () => {
    const fact = attemptMeasurement({ source: "gpu.probe", observedAt: AT, probe: () => { throw new Error("access denied"); } });
    expect(fact.status).toBe("UNREADABLE");
    expect(measurementAbsenceReason(fact)).toBe("access denied");
    expect(measurementValue(fact)).toBeUndefined();
  });

  it("turns a probe result that fails validation into UNREADABLE", () => {
    const fact = attemptMeasurement({ source: "cpu.cores", observedAt: AT, probe: () => 0, validate: (value) => value > 0 });
    expect(fact.status).toBe("UNREADABLE");
    expect(measurementValue(fact)).toBeUndefined();
  });

  it("keeps a valid probe result as MEASURED with its source", () => {
    const fact = attemptMeasurement({ source: "cpu.cores", observedAt: AT, probe: () => 16, validate: (value) => value > 0 });
    expect(isMeasured(fact)).toBe(true);
    expect(measurementValue(fact)).toBe(16);
  });

  it("does not turn an empty array into NONE or a healthy value", () => {
    // The repository's historical bug shape: `gpu: []` meaning "we did not look".
    // Here an unread GPU is an absence, and the empty list would have to be measured.
    const unread = attemptMeasurement<{ name: string }[]>({ source: "gpu.probe", observedAt: AT, probe: () => { throw new Error("no probe configured"); } });
    expect(measurementValue(unread)).toBeUndefined();
    expect(describeMeasurement(unread)).toBe("UNREADABLE(no probe configured)");

    const genuinelyEmpty = measured<{ name: string }[]>([], "gpu.enumerate", AT);
    expect(measurementValue(genuinelyEmpty)).toEqual([]);
    // The two are distinguishable, which is the whole requirement.
    expect(describeMeasurement(genuinelyEmpty)).not.toBe(describeMeasurement(unread));
  });
});

describe("measurement sets describe their own coverage", () => {
  const facts = [measured(1, "a", AT), unknown("b"), measured(3, "c", AT), unreadable("d")];

  it("counts present and total, and never reports coverage above what was measured", () => {
    const coverage = measurementCoverage(facts);
    expect(coverage).toEqual({ measured: 2, total: 4, coverage: 0.5 });
  });

  it("reports zero coverage for an empty set rather than full coverage", () => {
    expect(measurementCoverage([]).coverage).toBe(0);
  });

  it("names the absent facts so a report can say what it could not observe", () => {
    expect(absentMeasurements(facts).map((fact) => fact.reason)).toEqual(["b", "d"]);
  });
});

describe("deriving from a measurement preserves absence", () => {
  it("maps a measured value", () => {
    const fact = mapMeasurement(measured(1024, "mem.total", AT), (mb) => mb / 1024);
    expect(measurementValue(fact)).toBe(1);
  });

  it("keeps an absence absent through a projection, with its original reason", () => {
    const fact = mapMeasurement(unreadable("statfs failed", "disk.free"), (mb: number) => mb / 1024);
    expect(fact.status).toBe("UNREADABLE");
    expect(measurementValue(fact)).toBeUndefined();
    expect(measurementAbsenceReason(fact)).toBe("statfs failed");
  });
});
