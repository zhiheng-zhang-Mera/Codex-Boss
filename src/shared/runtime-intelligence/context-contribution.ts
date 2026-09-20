/**
 * Runtime Intelligence Plane — context contribution observation.
 *
 * The second real gap: the plane knows a context record was injected and does not know whether
 * it did anything. The instruction is explicit that this must not be guessed by a model, so
 * this module only ever records what was OBSERVED.
 *
 * The signals are ordered by how much they actually show:
 *
 *   OBSERVED_CONTRIBUTION   a tool consumed it, the reviewer matched on it, or the output cites
 *                           it. Each is a fact about something that happened to the record.
 *   INFERRED_CONTRIBUTION   something referred to it, which is a link but not a demonstrated
 *                           effect. Named "inferred" so it is never quoted as measured.
 *   UNKNOWN                 everything else — including a record that was merely injected.
 *
 * The last line is the whole point: **being injected is not contribution.** A record that was
 * retrieved and injected and then never touched again is `UNKNOWN`, and the summary reports it
 * under `injectedButUnattributed` rather than under "contributed nothing", because absence of
 * evidence is not evidence of absence.
 */

export const CONTRIBUTION_STATES = ["OBSERVED_CONTRIBUTION", "INFERRED_CONTRIBUTION", "UNKNOWN"] as const;
export type ContributionState = (typeof CONTRIBUTION_STATES)[number];

/** The weak attribution signals, strongest first. Every one is something that happened. */
export const CONTRIBUTION_SIGNALS = ["cited-in-output", "matched-by-review", "used-by-tool", "referenced", "injected", "retrieved"] as const;
export type ContributionSignal = (typeof CONTRIBUTION_SIGNALS)[number];

/** Signals that establish an observed contribution. */
export const OBSERVED_CONTRIBUTION_SIGNALS: readonly ContributionSignal[] = ["cited-in-output", "matched-by-review", "used-by-tool"];

/** Signals that support an inference and nothing stronger. */
export const INFERRED_CONTRIBUTION_SIGNALS: readonly ContributionSignal[] = ["referenced"];

/** Signals that say nothing about contribution at all. */
export const NON_CONTRIBUTION_SIGNALS: readonly ContributionSignal[] = ["injected", "retrieved"];

export interface ContextContributionObservation {
  recordId: string;
  /** Only the signals that were actually observed. */
  signals: ContributionSignal[];
  state: ContributionState;
  reasons: string[];
}

/**
 * Classifies one record from its observed signals.
 *
 * Order is the decision: any observed-effect signal outranks an inference, and an inference
 * outranks nothing at all. An unrecognised signal is reported and ignored rather than treated
 * as weak evidence.
 */
export function classifyContribution(input: { recordId: string; signals: readonly ContributionSignal[] }): ContextContributionObservation {
  // Recognised signals only, in the DECLARED strength order rather than the caller's order, so
  // two observations of the same record read the same way strongest-first.
  const observed = [...new Set(input.signals)]
    .filter((signal) => CONTRIBUTION_SIGNALS.includes(signal))
    .sort((left, right) => CONTRIBUTION_SIGNALS.indexOf(left) - CONTRIBUTION_SIGNALS.indexOf(right));
  const strong = observed.filter((signal) => OBSERVED_CONTRIBUTION_SIGNALS.includes(signal));
  const inferred = observed.filter((signal) => INFERRED_CONTRIBUTION_SIGNALS.includes(signal));
  const inert = observed.filter((signal) => NON_CONTRIBUTION_SIGNALS.includes(signal));
  const reasons: string[] = [];

  if (strong.length > 0) {
    reasons.push(`observed: ${strong.join(", ")}`);
    return { recordId: input.recordId, signals: observed, state: "OBSERVED_CONTRIBUTION", reasons };
  }
  if (inferred.length > 0) {
    reasons.push(`inferred from ${inferred.join(", ")}: something referred to the record, which shows a link and not an effect`);
    if (inert.length > 0) reasons.push(`also ${inert.join(", ")}, which on their own would say nothing`);
    return { recordId: input.recordId, signals: observed, state: "INFERRED_CONTRIBUTION", reasons };
  }
  if (inert.length > 0) {
    reasons.push(`only ${inert.join(", ")}: being retrieved or injected is not contribution, so the effect is UNKNOWN`);
    return { recordId: input.recordId, signals: observed, state: "UNKNOWN", reasons };
  }
  reasons.push("no contribution signal was observed for this record");
  return { recordId: input.recordId, signals: observed, state: "UNKNOWN", reasons };
}

export interface ContributionSummary {
  records: number;
  byState: Record<ContributionState, number>;
  observedRecordIds: string[];
  inferredRecordIds: string[];
  /** Injected or retrieved with no contribution signal — the "injected and unattributed" set. */
  injectedButUnattributed: string[];
  /** Records with no signal at all, which is a different thing from an unattributed injection. */
  noSignalRecordIds: string[];
  notes: string[];
}

/**
 * Summarises observations.
 *
 * The two unattributed sets are kept apart on purpose: "we injected it and never saw it used"
 * is the measurable waste, while "we have no observation for it at all" is a gap in the
 * instrumentation. Reporting them together would overstate what is known.
 */
export function summariseContributions(observations: readonly ContextContributionObservation[]): ContributionSummary {
  const byState: Record<ContributionState, number> = { OBSERVED_CONTRIBUTION: 0, INFERRED_CONTRIBUTION: 0, UNKNOWN: 0 };
  const observedRecordIds: string[] = [];
  const inferredRecordIds: string[] = [];
  const injectedButUnattributed: string[] = [];
  const noSignalRecordIds: string[] = [];

  for (const observation of observations) {
    byState[observation.state] += 1;
    if (observation.state === "OBSERVED_CONTRIBUTION") observedRecordIds.push(observation.recordId);
    if (observation.state === "INFERRED_CONTRIBUTION") inferredRecordIds.push(observation.recordId);
    const inert = observation.signals.some((signal) => NON_CONTRIBUTION_SIGNALS.includes(signal));
    if (observation.state === "UNKNOWN" && inert) injectedButUnattributed.push(observation.recordId);
    if (observation.signals.length === 0) noSignalRecordIds.push(observation.recordId);
  }

  const notes: string[] = [];
  if (noSignalRecordIds.length > 0) notes.push(`${noSignalRecordIds.length} record(s) have no observation at all, which is an instrumentation gap rather than a measured zero contribution`);
  if (injectedButUnattributed.length > 0) notes.push(`${injectedButUnattributed.length} record(s) were injected and never observed in use; this is measurable waste, not proof the record was useless`);
  if (observedRecordIds.length === 0) notes.push("no record has an observed contribution, so the context question cannot be answered yet");

  return {
    records: observations.length,
    byState,
    observedRecordIds: observedRecordIds.sort(),
    inferredRecordIds: inferredRecordIds.sort(),
    injectedButUnattributed: injectedButUnattributed.sort(),
    noSignalRecordIds: noSignalRecordIds.sort(),
    notes
  };
}

/**
 * Builds observations for a task's context records from a signal table.
 *
 * The table is the only input, so a caller cannot accidentally assert a contribution: a record
 * that appears in `injected` and nowhere else is UNKNOWN.
 */
export function observeContextContributions(input: {
  records: ReadonlyArray<{ recordId: string; signals?: readonly ContributionSignal[] }>;
}): ContextContributionObservation[] {
  return input.records.map((record) => classifyContribution({ recordId: record.recordId, signals: record.signals ?? [] }));
}
