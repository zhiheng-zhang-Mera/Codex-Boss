/**
 * Case Record — the dogfood metrics.
 *
 * The point of the dogfood phase is not "how many times did it diagnose". It is whether the
 * diagnoses were RIGHT, and the metric that matters most is the one that costs the most when it is
 * wrong:
 *
 *   `FALSE_HIGH_CONFIDENCE_DIAGNOSES` — a case whose leading candidate was at or above
 *   `HIGH_CONFIDENCE_THRESHOLD` (imported from the diagnosis engine's policy, so the two cannot
 *   drift) and which was later refuted, or resolved to a different root cause. Saying "the cause is
 *   X" and being wrong is worse than saying "the evidence is not enough", and this counts the first
 *   while `UNKNOWN_CORRECTLY_PRESERVED` counts the second.
 *
 * Every metric carries its own definition in `definitions`, so a report quoting a number cannot
 * drift from what the number means, and every denominator that is empty is reported as a note
 * rather than as a zero that reads like a result.
 */

import { HIGH_CONFIDENCE_THRESHOLD } from "../self-diagnosis/policy";
import { TERMINAL_CASE_STATUSES, type SelfDiagnosisCase } from "./case";
import { subjectOf } from "./recurrence";

export const DOGFOOD_METRICS_SCHEMA_VERSION = 1;

export interface DogfoodMetrics {
  schemaVersion: number;
  kind: "SELF_DIAGNOSIS_DOGFOOD_METRICS";
  at: string;
  casesOpened: number;
  casesClosed: number;
  rootCause: { confirmed: number; refuted: number; inconclusive: number };
  top1DiagnosisConfirmed: number;
  top3ContainedRootCause: number;
  missingEvidenceCases: number;
  treatmentProposals: number;
  treatmentProposalsUsed: number;
  recurrentCases: number;
  falseHighConfidenceDiagnoses: number;
  unknownCorrectlyPreserved: number;
  highConfidenceThreshold: number;
  /** What each number means, so a report cannot restate one differently. */
  definitions: Record<string, string>;
  notes: string[];
}

/** The leading candidate of a case's latest revision, and its confidence. */
function leading(record: SelfDiagnosisCase): { componentId: string; confidence: number; hypothesisIds: string[] } | undefined {
  const revision = record.selectedDiagnosis ?? record.diagnosesConsidered[record.diagnosesConsidered.length - 1];
  if (revision === undefined || revision.hypotheses.length === 0) return undefined;
  return {
    componentId: revision.hypotheses[0].suspectedComponent,
    confidence: revision.hypotheses[0].confidence,
    hypothesisIds: revision.hypotheses.slice(0, 3).map((hypothesis) => hypothesis.suspectedComponent)
  };
}

function validationsOf(record: SelfDiagnosisCase): string[] {
  return record.validations.map((validation) => validation.verdict);
}

/**
 * Computes the dogfood metrics over the cases a store holds.
 *
 * A case that is still open contributes to `casesOpened` and to the proposal counts, and to nothing
 * that requires an outcome — the same rule the prospective window uses.
 */
export function dogfoodMetrics(input: { cases: readonly SelfDiagnosisCase[]; at: string }): DogfoodMetrics {
  const closed = input.cases.filter((record) => TERMINAL_CASE_STATUSES.includes(record.status) || record.closedAt !== undefined);
  const confirmed = closed.filter((record) => validationsOf(record).includes("CONFIRMED"));
  const refuted = closed.filter((record) => validationsOf(record).includes("REFUTED"));
  const inconclusive = closed.filter((record) => !confirmed.includes(record) && !refuted.includes(record));

  let top1 = 0;
  let top3 = 0;
  let falseHighConfidence = 0;
  for (const record of confirmed) {
    const lead = leading(record);
    const cause = record.rootCause ?? subjectOf(record)?.componentId;
    if (lead === undefined || cause === undefined) continue;
    if (lead.componentId === cause) top1 += 1;
    if (lead.hypothesisIds.includes(cause)) top3 += 1;
  }
  for (const record of closed) {
    const lead = leading(record);
    if (lead === undefined || lead.confidence < HIGH_CONFIDENCE_THRESHOLD) continue;
    const cause = record.rootCause ?? subjectOf(record)?.componentId;
    // A claim at or above the threshold that was refuted, or resolved to something else.
    if (validationsOf(record).includes("REFUTED") || (cause !== undefined && cause !== lead.componentId)) falseHighConfidence += 1;
  }

  const missingEvidenceCases = input.cases.filter((record) => {
    const revision = record.selectedDiagnosis ?? record.diagnosesConsidered[record.diagnosesConsidered.length - 1];
    return record.missingEvidence.length > 0 || (revision?.hypotheses ?? []).some((hypothesis) => hypothesis.missingEvidence.length > 0);
  }).length;

  const proposals = input.cases.flatMap((record) => record.treatmentProposals);
  // A proposal is counted as used when ITS OWN case recorded performing it. The id is built from
  // the hypothesis, so two cases about the same component and failure mode can carry the same
  // proposal id; scoping the check to the case is what keeps that from inflating the count.
  const usedProposals = input.cases.reduce(
    (total, record) => total + record.treatmentProposals.filter((proposal) => record.treatmentActuallyPerformed.some((entry) => entry.proposalId === proposal.proposalId)).length,
    0
  );
  const recurrent = input.cases.filter((record) => record.status === "RECURRENT" || record.recurrenceLinks.length > 0);
  const unknownPreserved = closed.filter((record) => {
    if (record.rootCause !== undefined) return false;
    const lead = leading(record);
    return lead === undefined || lead.confidence < HIGH_CONFIDENCE_THRESHOLD;
  });

  const notes: string[] = [];
  if (closed.length === 0) notes.push("no case has been closed yet, so no accuracy metric has a denominator and none of them is reported as zero");
  if (proposals.length === 0) notes.push("no treatment has been proposed yet");
  if (falseHighConfidence > 0) notes.push(`${falseHighConfidence} case(s) made a claim at or above confidence ${HIGH_CONFIDENCE_THRESHOLD} that was later refuted or resolved elsewhere: this is the metric to watch`);

  return {
    schemaVersion: DOGFOOD_METRICS_SCHEMA_VERSION,
    kind: "SELF_DIAGNOSIS_DOGFOOD_METRICS",
    at: input.at,
    casesOpened: input.cases.length,
    casesClosed: closed.length,
    rootCause: { confirmed: confirmed.length, refuted: refuted.length, inconclusive: inconclusive.length },
    top1DiagnosisConfirmed: top1,
    top3ContainedRootCause: top3,
    missingEvidenceCases,
    treatmentProposals: proposals.length,
    treatmentProposalsUsed: usedProposals,
    recurrentCases: recurrent.length,
    falseHighConfidenceDiagnoses: falseHighConfidence,
    unknownCorrectlyPreserved: unknownPreserved.length,
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    definitions: {
      casesOpened: "every case the store holds, open or closed",
      casesClosed: "cases with a terminal disposition",
      rootCauseConfirmed: "closed cases with a CONFIRMED validation",
      rootCauseRefuted: "closed cases with a REFUTED validation",
      rootCauseInconclusive: "closed cases with neither a CONFIRMED nor a REFUTED validation",
      top1DiagnosisConfirmed: "confirmed cases whose leading candidate is the root cause the case recorded",
      top3ContainedRootCause: "confirmed cases whose recorded root cause is among the leading three candidates",
      missingEvidenceCases: "cases whose latest revision or plan recorded missing evidence — a blind spot the diagnosis named",
      treatmentProposals: "every treatment proposal the cases record",
      treatmentProposalsUsed: "proposals whose id appears in a TREATMENT_PERFORMED event on their own case — performed by someone else, never by this plane",
      recurrentCases: "cases marked RECURRENT or linked to an earlier case",
      falseHighConfidenceDiagnoses: `closed cases whose leading candidate was at or above confidence ${HIGH_CONFIDENCE_THRESHOLD} and was refuted or resolved to a different root cause`,
      unknownCorrectlyPreserved: "closed cases that named no root cause while no candidate had reached the claim threshold — the uncertainty was kept rather than resolved by assertion"
    },
    notes
  };
}
