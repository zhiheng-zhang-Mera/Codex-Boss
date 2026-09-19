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
import { TERMINAL_CASE_STATUSES, type CaseIncidentClass, type SelfDiagnosisCase } from "./case";
import { subjectOf } from "./recurrence";

export const DOGFOOD_METRICS_SCHEMA_VERSION = 1;

/** The incident class a headline metric counts. Everything else is reported as excluded. */
export const HEADLINE_INCIDENT_CLASS: CaseIncidentClass = "REAL_INCIDENT";

/** Something a case did that would invalidate the experiment it is part of. */
export interface CaseProtocolViolation {
  caseId: string;
  violation: "FIRST_PASS_MISSING" | "FIRST_PASS_AFTER_INVESTIGATION" | "TREATMENT_SOURCE_MISSING";
  detail: string;
}

export interface DogfoodMetrics {
  schemaVersion: number;
  kind: "SELF_DIAGNOSIS_DOGFOOD_METRICS";
  at: string;
  /** Cases counted in the headline: real incidents only. */
  casesOpened: number;
  casesClosed: number;
  /** Cases the headline leaves out, by incident class, so a fixture cannot hide inside a total. */
  excludedByIncidentClass: Record<string, number>;
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
  /** Cases whose timeline would make the metrics mean something other than they say. */
  protocolViolations: CaseProtocolViolation[];
  /** What each number means, so a report cannot restate one differently. */
  definitions: Record<string, string>;
  notes: string[];
}

/**
 * The leading candidate of the FIRST-PASS diagnosis, and its confidence.
 *
 * Scoring the latest revision instead would measure a diagnosis that had already seen the
 * investigation, which is the one number the dogfood phase exists to avoid.
 */
function leading(record: SelfDiagnosisCase): { componentId: string; confidence: number; top3: string[]; reason: string } | undefined {
  const first = record.firstPass ?? (record.diagnosesConsidered.length === 0 ? undefined : record.diagnosesConsidered[0]);
  if (first === undefined || first.hypotheses.length === 0) return undefined;
  return {
    componentId: first.hypotheses[0].suspectedComponent,
    confidence: first.hypotheses[0].confidence,
    top3: first.hypotheses.slice(0, 3).map((hypothesis) => hypothesis.suspectedComponent),
    reason: first.reason
  };
}

function validationsOf(record: SelfDiagnosisCase): string[] {
  return record.validations.map((validation) => validation.verdict);
}

/**
 * Finds the timelines that would invalidate the experiment.
 *
 * The rule the dogfood phase rests on is that the first pass is made BEFORE anyone investigates. A
 * case whose first diagnosis arrived after a treatment or a validation has a first pass that could
 * have seen the answer, so its top-1 and top-3 figures would be meaningless — and it is better to
 * say that than to average it in.
 */
export function protocolViolationsOf(record: SelfDiagnosisCase, events: readonly { type: string }[] = []): CaseProtocolViolation[] {
  const violations: CaseProtocolViolation[] = [];
  if (record.diagnosesConsidered.length === 0) {
    violations.push({ caseId: record.caseId, violation: "FIRST_PASS_MISSING", detail: "the case holds no hypothesis revision, so there is no first-pass diagnosis to score" });
  } else if (events.length > 0) {
    const firstHypothesis = events.findIndex((event) => event.type === "HYPOTHESIS_ADDED" || event.type === "HYPOTHESIS_REVISED");
    const investigation = events.findIndex((event) => event.type === "TREATMENT_PERFORMED" || event.type === "VALIDATION_ADDED");
    if (investigation >= 0 && (firstHypothesis < 0 || investigation < firstHypothesis)) {
      violations.push({ caseId: record.caseId, violation: "FIRST_PASS_AFTER_INVESTIGATION", detail: "a treatment or validation was recorded before any hypothesis, so the first pass could have seen the answer" });
    }
  }
  return violations;
}

/**
 * Computes the dogfood metrics over the cases a store holds.
 *
 * The headline counts REAL INCIDENTS only. A fixture or a test proves the record works and proves
 * nothing about whether a diagnosis was right, so the same rule the prospective window applies to
 * tasks is applied to cases, and the excluded ones are named rather than dropped.
 *
 * Every accuracy figure is scored against the FIRST-PASS diagnosis, which is the one made before
 * anyone investigated.
 */
export function dogfoodMetrics(input: { cases: readonly SelfDiagnosisCase[]; at: string; eventsByCase?: Record<string, readonly { type: string }[]> }): DogfoodMetrics {
  const headline = input.cases.filter((record) => record.incidentClass === HEADLINE_INCIDENT_CLASS);
  const excludedByIncidentClass: Record<string, number> = {};
  for (const record of input.cases) {
    if (record.incidentClass === HEADLINE_INCIDENT_CLASS) continue;
    excludedByIncidentClass[record.incidentClass] = (excludedByIncidentClass[record.incidentClass] ?? 0) + 1;
  }
  const closed = headline.filter((record) => TERMINAL_CASE_STATUSES.includes(record.status) || record.closedAt !== undefined);
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
    if (lead.top3.includes(cause)) top3 += 1;
  }
  for (const record of closed) {
    const lead = leading(record);
    if (lead === undefined || lead.confidence < HIGH_CONFIDENCE_THRESHOLD) continue;
    const cause = record.rootCause ?? subjectOf(record)?.componentId;
    // A claim at or above the threshold that was refuted, or resolved to something else.
    if (validationsOf(record).includes("REFUTED") || (cause !== undefined && cause !== lead.componentId)) falseHighConfidence += 1;
  }

  const missingEvidenceCases = headline.filter((record) => {
    const revision = record.firstPass ?? record.diagnosesConsidered[0];
    return record.missingEvidence.length > 0 || (revision?.hypotheses ?? []).some((hypothesis) => hypothesis.missingEvidence.length > 0);
  }).length;

  const proposals = headline.flatMap((record) => record.treatmentProposals);
  // A proposal is counted as used when ITS OWN case recorded performing it. The id is built from
  // the hypothesis, so two cases about the same component and failure mode can carry the same
  // proposal id; scoping the check to the case is what keeps that from inflating the count.
  const usedProposals = headline.reduce(
    (total, record) => total + record.treatmentProposals.filter((proposal) => record.treatmentActuallyPerformed.some((entry) => entry.proposalId === proposal.proposalId)).length,
    0
  );
  const recurrent = headline.filter((record) => record.status === "RECURRENT" || record.recurrenceLinks.length > 0);
  const unknownPreserved = closed.filter((record) => {
    if (record.rootCause !== undefined) return false;
    const lead = leading(record);
    return lead === undefined || lead.confidence < HIGH_CONFIDENCE_THRESHOLD;
  });
  const protocolViolations = headline.flatMap((record) => protocolViolationsOf(record, input.eventsByCase?.[record.caseId] ?? []));

  const notes: string[] = [];
  const excludedCases = input.cases.length - headline.length;
  if (excludedCases > 0) notes.push(`${excludedCases} case(s) are fixtures or tests and are excluded from every headline figure`);
  if (closed.length === 0) notes.push("no real incident has been closed yet, so no accuracy metric has a denominator and none of them is reported as zero");
  if (proposals.length === 0) notes.push("no treatment has been proposed yet");
  if (protocolViolations.length > 0) notes.push(`${protocolViolations.length} protocol violation(s): a case whose first pass could have seen the answer would make TOP1 and TOP3 meaningless`);
  if (falseHighConfidence > 0) notes.push(`${falseHighConfidence} case(s) made a claim at or above confidence ${HIGH_CONFIDENCE_THRESHOLD} that was later refuted or resolved elsewhere: this is the metric to watch`);

  return {
    schemaVersion: DOGFOOD_METRICS_SCHEMA_VERSION,
    kind: "SELF_DIAGNOSIS_DOGFOOD_METRICS",
    at: input.at,
    casesOpened: headline.length,
    casesClosed: closed.length,
    excludedByIncidentClass,
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
    protocolViolations,
    definitions: {
      casesOpened: "REAL INCIDENT cases the store holds, open or closed; fixtures and tests are excluded and counted separately",
      casesClosed: "real incidents with a terminal disposition",
      excludedByIncidentClass: "cases left out of every headline figure, by incident class",
      rootCauseConfirmed: "closed real incidents with a CONFIRMED validation",
      rootCauseRefuted: "closed real incidents with a REFUTED validation",
      rootCauseInconclusive: "closed real incidents with neither a CONFIRMED nor a REFUTED validation — closed without forcing a root cause",
      top1DiagnosisConfirmed: "confirmed cases whose FIRST-PASS leading candidate is the root cause the case recorded",
      top3ContainedRootCause: "confirmed cases whose recorded root cause is among the FIRST-PASS leading three candidates",
      missingEvidenceCases: "real incidents whose first pass recorded missing evidence — a blind spot the diagnosis named",
      treatmentProposals: "every treatment proposal the real incidents record",
      treatmentProposalsUsed: "proposals whose id appears in a TREATMENT_PERFORMED event on their own case — performed by someone else, never by this plane",
      recurrentCases: "real incidents marked RECURRENT or linked to an earlier case",
      falseHighConfidenceDiagnoses: `closed real incidents whose FIRST-PASS leading candidate was at or above confidence ${HIGH_CONFIDENCE_THRESHOLD} and was refuted or resolved to a different root cause`,
      unknownCorrectlyPreserved: "closed real incidents that named no root cause while no first-pass candidate had reached the claim threshold — the uncertainty was kept rather than resolved by assertion",
      protocolViolations: "real incidents whose timeline would make the accuracy figures mean something other than they say"
    },
    notes
  };
}

/* ------------------------------------------------- policy defect reporting */

export interface SelfDiagnosisPolicyDefectReport {
  schemaVersion: number;
  kind: "SELF_DIAGNOSIS_POLICY_DEFECT_REPORT";
  at: string;
  /** Which rules produced the claim that turned out wrong. */
  engineVersion: string;
  policyHash: string;
  failureMode: "FALSE_HIGH_CONFIDENCE_DIAGNOSIS";
  severity: "HIGH" | "MEDIUM";
  caseIds: string[];
  /** The component the first pass named, and the one the case settled on. */
  claimedComponents: string[];
  actualRootCauses: string[];
  highConfidenceThreshold: number;
  evidence: string[];
  /** What MIGHT be changed. This report changes nothing: a policy is tuned from several cases, not one. */
  candidateHypothesis: string;
  expectedTradeoff: string;
  /** Literal: a defect report proposes, it never mutates a policy. */
  mutatesPolicy: false;
  requiresOwnerReview: true;
  note: string;
}

/**
 * Builds one defect report per component a false high-confidence claim was made about.
 *
 * This is the record the dogfood phase asks for when the first safety metric moves, and it is
 * deliberately a REPORT: the rule is to accumulate cases before touching the diagnosis, so nothing
 * here changes a rule, a threshold or a policy hash.
 */
export function policyDefectReports(input: { cases: readonly SelfDiagnosisCase[]; at: string; engineVersion: string; policyHash: string; eventsByCase?: Record<string, readonly { type: string }[]> }): SelfDiagnosisPolicyDefectReport[] {
  const offenders = input.cases.filter((record) => {
    if (record.incidentClass !== HEADLINE_INCIDENT_CLASS) return false;
    if (!TERMINAL_CASE_STATUSES.includes(record.status) && record.closedAt === undefined) return false;
    const lead = leading(record);
    if (lead === undefined || lead.confidence < HIGH_CONFIDENCE_THRESHOLD) return false;
    const cause = record.rootCause ?? subjectOf(record)?.componentId;
    return validationsOf(record).includes("REFUTED") || (cause !== undefined && cause !== lead.componentId);
  });
  const byClaim = new Map<string, SelfDiagnosisCase[]>();
  for (const record of offenders) {
    const claimed = leading(record)?.componentId ?? "unknown";
    byClaim.set(claimed, [...(byClaim.get(claimed) ?? []), record]);
  }
  return [...byClaim.entries()]
    .map(([claimed, records]) => {
      const actual = [...new Set(records.map((record) => record.rootCause ?? subjectOf(record)?.componentId).filter((value): value is string => value !== undefined))];
      const violations = records.flatMap((record) => protocolViolationsOf(record, input.eventsByCase?.[record.caseId] ?? []));
      return {
        schemaVersion: 1,
        kind: "SELF_DIAGNOSIS_POLICY_DEFECT_REPORT" as const,
        at: input.at,
        engineVersion: input.engineVersion,
        policyHash: input.policyHash,
        failureMode: "FALSE_HIGH_CONFIDENCE_DIAGNOSIS" as const,
        severity: (records.length > 1 ? "HIGH" : "MEDIUM") as "HIGH" | "MEDIUM",
        caseIds: records.map((record) => record.caseId).sort(),
        claimedComponents: [claimed],
        actualRootCauses: actual.sort(),
        highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
        evidence: records.map((record) => {
          const lead = leading(record);
          return `${record.caseId}: the first pass named ${lead?.componentId ?? "nothing"} at confidence ${lead?.confidence ?? 0} and the case settled on ${record.rootCause ?? "no root cause"} (${record.finalDisposition ?? record.status})`;
        }),
        candidateHypothesis: actual.length === 0
          ? `the rules that produced a ${claimed} candidate at or above ${HIGH_CONFIDENCE_THRESHOLD} may be attributing stronger evidence than they hold`
          : `the rules that produced a ${claimed} candidate may be over-weighting whatever evidence is shared with ${actual.join(", ")}`,
        expectedTradeoff: "lowering the confidence of this candidate class would also lower it on incidents where it was right, so the change is only worth making from several cases rather than one",
        mutatesPolicy: false as const,
        requiresOwnerReview: true as const,
        note: violations.length > 0
          ? `this report rests on ${violations.length} protocol violation(s), so the claim may not have been a genuine first pass: ${violations.map((violation) => violation.violation).join(", ")}`
          : "recorded, not acted on: the dogfood rule is to accumulate cases before changing a diagnosis rule"
      };
    })
    .sort((left, right) => (left.claimedComponents[0] < right.claimedComponents[0] ? -1 : 1));
}
