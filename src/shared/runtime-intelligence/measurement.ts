/**
 * Runtime Intelligence Plane — the fail-closed measurement primitive.
 *
 * Every fact this plane reasons about (a model score, a node's GPU, a skill's token
 * overhead) is wrapped in a `Measurement` instead of a bare value. The rule the type
 * exists to enforce is the one the plan states as "cannot be measured is not safe":
 *
 *     UNKNOWN / UNREADABLE / UNAVAILABLE / NOT_MEASURED  !=  a healthy, good or zero value
 *
 * A missing GPU is therefore `{ status: "UNREADABLE" }`, never `gpu: []` and never
 * `gpu: "none"`, and `measurementValue` returns `undefined` rather than a default. A
 * caller that wants a fallback has to write the fallback down, which is exactly the
 * decision that used to be made silently by `?? true` and `?? 0` defaults.
 *
 * This module is pure: no fs, no clock, no process, no network. The observer passes
 * `source` and `observedAt` in, so every measurement can be traced to who produced it
 * and when.
 */

/** The five states a fact can be in. Only the first is a value. */
export const MEASUREMENT_STATUSES = ["MEASURED", "UNKNOWN", "UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

/** A fact that was observed, with the provenance needed to trust it. */
export interface MeasuredFact<T> {
  status: "MEASURED";
  value: T;
  /** The probe that produced it, e.g. "node:os.totalmem". */
  source: string;
  observedAt: string;
}

/** A fact that is absent. `reason` is mandatory: an unexplained absence is a bug. */
export interface AbsentFact {
  status: Exclude<MeasurementStatus, "MEASURED">;
  reason: string;
  /** The probe that failed, when one was attempted. */
  source?: string;
  observedAt?: string;
}

export type Measurement<T> = MeasuredFact<T> | AbsentFact;

/** A measured fact. `source` names the real probe; nothing else may call this. */
export function measured<T>(value: T, source: string, observedAt: string): MeasuredFact<T> {
  return { status: "MEASURED", value, source, observedAt };
}

/** The probe ran but there is no fact to report (e.g. no probe is configured). */
export function unknown(reason: string, source?: string): AbsentFact {
  return { status: "UNKNOWN", reason, ...(source === undefined ? {} : { source }) };
}

/** The probe was attempted and failed (an exception, a parse error, a refusal). */
export function unreadable(reason: string, source?: string): AbsentFact {
  return { status: "UNREADABLE", reason, ...(source === undefined ? {} : { source }) };
}

/** The fact cannot exist in this environment (a platform without the API). */
export function unavailable(reason: string, source?: string): AbsentFact {
  return { status: "UNAVAILABLE", reason, ...(source === undefined ? {} : { source }) };
}

/** No probe was attempted yet. Distinct from UNKNOWN so "we have not looked" is visible. */
export function notMeasured(reason: string, source?: string): AbsentFact {
  return { status: "NOT_MEASURED", reason, ...(source === undefined ? {} : { source }) };
}

export function isMeasured<T>(fact: Measurement<T>): fact is MeasuredFact<T> {
  return fact.status === "MEASURED";
}

export function measurementStatus(fact: Measurement<unknown>): MeasurementStatus {
  return fact.status;
}

/**
 * The value, or `undefined` when the fact is absent.
 *
 * Deliberately NOT a fallback-taking signature: `measurementValue(gpu) ?? []` at a call
 * site is a written decision, whereas `measurementValue(gpu, [])` would hide it inside
 * this helper.
 */
export function measurementValue<T>(fact: Measurement<T>): T | undefined {
  return isMeasured(fact) ? fact.value : undefined;
}

/** Why a fact is absent, or `undefined` when it is present. */
export function measurementAbsenceReason(fact: Measurement<unknown>): string | undefined {
  return isMeasured(fact) ? undefined : fact.reason;
}

/**
 * Runs a real probe and converts a throw into an UNREADABLE fact.
 *
 * This is the only sanctioned way to build a measurement from a probe: a probe that
 * throws must never be allowed to look like a probe that returned nothing.
 */
export function attemptMeasurement<T>(input: {
  source: string;
  observedAt: string;
  probe: () => T;
  /** Optional validation; a `false` result becomes UNREADABLE rather than a value. */
  validate?: (value: T) => boolean;
}): Measurement<T> {
  let value: T;
  try {
    value = input.probe();
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : String(error), input.source);
  }
  if (input.validate && !input.validate(value)) {
    return unreadable(`${input.source} returned a value that failed validation`, input.source);
  }
  return measured(value, input.source, input.observedAt);
}

/** Applies `project` to a measured fact, preserving absence exactly. */
export function mapMeasurement<T, U>(fact: Measurement<T>, project: (value: T) => U): Measurement<U> {
  if (!isMeasured(fact)) return fact;
  return { status: "MEASURED", value: project(fact.value), source: fact.source, observedAt: fact.observedAt };
}

/** How much of a measurement set is actually present. Absent facts lower it; none raise it. */
export function measurementCoverage(facts: readonly Measurement<unknown>[]): { measured: number; total: number; coverage: number } {
  const total = facts.length;
  const present = facts.filter(isMeasured).length;
  return { measured: present, total, coverage: total === 0 ? 0 : present / total };
}

/** The absent facts of a set, so a report can name what it could not observe. */
export function absentMeasurements(facts: readonly Measurement<unknown>[]): AbsentFact[] {
  return facts.filter((fact): fact is AbsentFact => !isMeasured(fact));
}

/**
 * A stable text rendering of a measurement, for logs and explanations.
 *
 * Absence renders as `STATUS(reason)` — never as an empty string — so a missing fact
 * cannot be mistaken for a zero-length value in a report.
 */
export function describeMeasurement(fact: Measurement<unknown>): string {
  if (isMeasured(fact)) {
    const value = typeof fact.value === "object" ? JSON.stringify(fact.value) : String(fact.value);
    return `${value} [${fact.source}]`;
  }
  return `${fact.status}(${fact.reason})`;
}
