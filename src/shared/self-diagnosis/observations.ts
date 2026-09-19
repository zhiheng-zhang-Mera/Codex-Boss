/**
 * Self Diagnosis — health observations, and the sources that produce them.
 *
 * This module answers "where might I be broken?" It reads what other components already recorded —
 * telemetry, runtime outcomes, recovery events, errors — through the `SelfObservationSource`
 * interface, and it owns none of them: a source is handed in, asked once, and cannot be written to
 * from here.
 *
 * Two rules keep an observation honest:
 *
 *   1. **A missing measurement is a status, not a zero.** `UNKNOWN` means the question was asked and
 *      could not be answered; `NOT_MEASURED` means nothing observed it. Neither can be read as
 *      `HEALTHY`, and neither may stand in for one.
 *   2. **An observation is about a component the self model holds.** A signal that names a
 *      component the anatomy does not know is kept and reported as unattributable rather than
 *      silently dropped: a component the model has never heard of is exactly the kind of thing a
 *      diagnosis should surface.
 */

import type { BossSelfModel } from "../self-cognition/contracts";

export const HEALTH_OBSERVATION_SCHEMA_VERSION = 1;

export const HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN", "NOT_MEASURED"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface ExpectedRange {
  min?: number;
  max?: number;
}

/** One measured or unmeasured reading about one component. */
export interface HealthObservation {
  schemaVersion: number;
  componentId: string;
  /** The signal's own name, from whichever source produced it. */
  signalId: string;
  status: HealthStatus;
  /** Present only when something actually measured a number. */
  measurement?: number;
  expectedRange?: ExpectedRange;
  capturedAt: string;
  /** The file, event or probe this came from. Never empty. */
  source: string;
  /** 0..1. How much this reading should weigh, stated by the source rather than assumed. */
  confidence: number;
  detail: string;
}

export interface SourceResult {
  observations: HealthObservation[];
  /** Sources that could not be read, with the reason. Never an empty failure. */
  unreadable: Array<{ source: string; reason: string }>;
}

/**
 * Something that can report how a part of Boss is doing.
 *
 * The interface is deliberately one method with no back-channel: a source is given the self model
 * so it can attribute its signals to real components, and it returns observations. There is no
 * `write`, no `apply` and no handle to the thing it observes, so a diagnosis cannot change what it
 * is diagnosing.
 */
export interface SelfObservationSource {
  id: string;
  observe(input: { model: BossSelfModel; at: string }): SourceResult;
}

/** A reading with a number, and the range that number is expected to sit in. */
export function measuredObservation(input: { componentId: string; signalId: string; measurement: number; expectedRange?: ExpectedRange; at: string; source: string; confidence?: number; detail?: string }): HealthObservation {
  const range = input.expectedRange;
  const below = range?.min !== undefined && input.measurement < range.min;
  const above = range?.max !== undefined && input.measurement > range.max;
  const status: HealthStatus = below || above ? (isSeverelyOutside(input.measurement, range) ? "UNHEALTHY" : "DEGRADED") : "HEALTHY";
  return {
    schemaVersion: HEALTH_OBSERVATION_SCHEMA_VERSION,
    componentId: input.componentId,
    signalId: input.signalId,
    status,
    measurement: input.measurement,
    ...(range === undefined ? {} : { expectedRange: range }),
    capturedAt: input.at,
    source: input.source,
    confidence: input.confidence ?? 0.8,
    detail: input.detail ?? (below || above ? `${input.signalId} is ${input.measurement}, outside the expected ${formatRange(range)}` : `${input.signalId} is ${input.measurement}, inside the expected ${formatRange(range)}`)
  };
}

function isSeverelyOutside(value: number, range: ExpectedRange | undefined): boolean {
  if (range === undefined) return false;
  if (range.min !== undefined && value < range.min * 0.5) return true;
  if (range.max !== undefined && range.max > 0 && value > range.max * 2) return true;
  return false;
}

function formatRange(range: ExpectedRange | undefined): string {
  if (range === undefined) return "range";
  if (range.min !== undefined && range.max !== undefined) return `range ${range.min}..${range.max}`;
  if (range.min !== undefined) return `at least ${range.min}`;
  return `at most ${range.max}`;
}

/** A reading that a source could state a status for but not a number for. */
export function statedObservation(input: { componentId: string; signalId: string; status: HealthStatus; at: string; source: string; confidence?: number; detail: string }): HealthObservation {
  return {
    schemaVersion: HEALTH_OBSERVATION_SCHEMA_VERSION,
    componentId: input.componentId,
    signalId: input.signalId,
    status: input.status,
    capturedAt: input.at,
    source: input.source,
    confidence: input.confidence ?? 0.6,
    detail: input.detail
  };
}

/** The reading for a source that looked and could not tell. It is not HEALTHY. */
export function unknownObservation(input: { componentId: string; signalId: string; at: string; source: string; reason: string }): HealthObservation {
  return statedObservation({ componentId: input.componentId, signalId: input.signalId, status: "UNKNOWN", at: input.at, source: input.source, confidence: 0, detail: input.reason });
}

/** The readings that indicate something is wrong. `HEALTHY` and the two absences are not symptoms. */
export function unhealthyObservations(observations: readonly HealthObservation[]): HealthObservation[] {
  return observations.filter((observation) => observation.status === "DEGRADED" || observation.status === "UNHEALTHY");
}

/** Whether an observation's component is one the anatomy knows. */
export function isAttributable(model: BossSelfModel, observation: HealthObservation): boolean {
  return model.components.some((component) => component.id === observation.componentId || component.name === observation.componentId);
}

/** Runs every source, isolating each one: a source that throws costs its own readings only. */
export function collectObservations(input: { model: BossSelfModel; at: string; sources: readonly SelfObservationSource[] }): SourceResult & { sourceFailures: Array<{ source: string; reason: string }> } {
  const observations: HealthObservation[] = [];
  const unreadable: Array<{ source: string; reason: string }> = [];
  const sourceFailures: Array<{ source: string; reason: string }> = [];
  for (const source of input.sources) {
    try {
      const result = source.observe({ model: input.model, at: input.at });
      observations.push(...result.observations);
      unreadable.push(...result.unreadable);
    } catch (error) {
      // A source that fails is itself evidence about the system, and it is recorded as such rather
      // than being allowed to take the whole diagnosis down with it.
      sourceFailures.push({ source: source.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { observations, unreadable, sourceFailures };
}
