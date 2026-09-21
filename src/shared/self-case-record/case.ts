/**
 * Case Record — the vocabulary.
 *
 * A case is a record of one anomaly: what was seen, what was considered, what was decided, what was
 * actually done, and how it turned out. It is not a diagnostic engine — it does not produce
 * hypotheses — and it is not a knowledge base: it does not decide what is true.
 *
 * The load-bearing decision in this module is that **a case's truth is its timeline**. The record
 * below is a FOLD of appended events, never a mutable object: `CaseRecord does not rewrite
 * history`, and a later, better diagnosis appears as another revision beside the first one rather
 * than replacing it. `CAN_RECORD = YES`, `CAN_REWRITE_HISTORY = NO`, `CAN_EXECUTE_TREATMENT = NO`.
 */

import type { DiagnosisHypothesis, DiagnosticSymptom } from "../self-diagnosis/hypotheses";
import type { TreatmentProposal } from "../self-diagnosis/treatment";
import type { DiagnosticPlanStep } from "../self-diagnosis/plan";

export const CASE_SCHEMA_VERSION = 1;

/** Where a case is in its life. A case is never deleted; it is resolved, unresolved or recurrent. */
export const CASE_STATUSES = [
  "OPEN",
  "OBSERVING",
  "DIAGNOSING",
  "WAITING_FOR_EVIDENCE",
  "TREATMENT_PROPOSED",
  "TREATED_EXTERNALLY",
  "VALIDATING",
  "RESOLVED",
  "UNRESOLVED",
  "RECURRENT"
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** The statuses that mean no further observation is expected. */
export const TERMINAL_CASE_STATUSES: readonly CaseStatus[] = ["RESOLVED", "UNRESOLVED"];

/**
 * What produced a case.
 *
 * Only `REAL_INCIDENT` counts towards the dogfood headline. A fixture or a test proves the record
 * works and proves nothing about whether a diagnosis was right, so the distinction is part of the
 * case rather than a convention in a report — the same rule the prospective window applies to
 * tasks. A caller must state which it is: there is no default, because a default would be wrong
 * half the time and would be the half nobody checks.
 */
export const CASE_INCIDENT_CLASSES = ["REAL_INCIDENT", "RETROSPECTIVE_FIXTURE", "DEVELOPMENT_TEST"] as const;
export type CaseIncidentClass = (typeof CASE_INCIDENT_CLASSES)[number];

/**
 * Who performed a treatment.
 *
 * `SELF_DIAGNOSIS` is not in this vocabulary and never will be: this plane may propose a treatment
 * and may record one, and it may not perform one. The list is short on purpose, because who did it
 * is the fact that decides whether a case is evidence about the diagnosis or about a person.
 */
export const TREATMENT_SOURCES = ["OWNER", "HNS", "EXTERNAL_SYSTEM"] as const;
export type TreatmentSource = (typeof TREATMENT_SOURCES)[number];

/** How a validation turned out. The vocabulary is closed, so an unknown word cannot be stored. */
export const CASE_VALIDATION_VERDICTS = ["CONFIRMED", "PARTIALLY_CONFIRMED", "REFUTED", "INCONCLUSIVE"] as const;
export type CaseValidationVerdict = (typeof CASE_VALIDATION_VERDICTS)[number];

/**
 * The first diagnosis, kept apart from every later revision.
 *
 * The first pass is the one that counts: it is made before anyone investigates, so it is the only
 * one that can be scored against the root cause found afterwards. `firstPass` is set by the first
 * revision and never rewritten, which is what makes `TOP1_DIAGNOSIS_CONFIRMED`,
 * `TOP3_CONTAINED_ROOT_CAUSE` and `FALSE_HIGH_CONFIDENCE_DIAGNOSES` mean something.
 */
export interface CaseFirstPass {
  at: string;
  revision: number;
  hypotheses: DiagnosisHypothesis[];
  reason: string;
}

/** What can happen to a case. Every one of them is an event on the timeline. */
export const CASE_EVENT_TYPES = [
  "CASE_OPENED",
  "OBSERVATION_ADDED",
  "HYPOTHESIS_ADDED",
  "HYPOTHESIS_REVISED",
  "TREATMENT_PROPOSED",
  "TREATMENT_PERFORMED",
  "VALIDATION_ADDED",
  "CASE_RESOLVED",
  "CASE_REOPENED",
  "RECURRENCE_LINKED"
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

/** One revision of the diagnosis, kept beside the ones before it. */
export interface DiagnosisRevision {
  revision: number;
  at: string;
  /** The candidates as they stood at this revision, in rank order. */
  hypotheses: DiagnosisHypothesis[];
  /** The candidate this revision selected, if it selected one. */
  selectedHypothesisId?: string;
  reason: string;
}

/**
 * Which body and which diagnosis rules judged this case.
 *
 * Provenance, not logic: the values are recorded so a later reader can tell what the diagnosis was
 * looking at, and nothing in this module computes or interprets them. A caller that cannot
 * establish a value records `UNKNOWN` rather than an empty string, so "not established" stays
 * distinguishable from "not filled in".
 */
export interface CaseProvenance {
  selfModelVersion: string;
  selfModelHash: string;
  diagnosisEngineVersion: string;
  diagnosisPolicyHash: string;
  /** Who supplied these values, so a copied value can be traced. */
  source: string;
}

/** The value a caller records when it cannot establish one of the four provenance fields. */
export const UNKNOWN_PROVENANCE = "UNKNOWN";

/** The provenance a caller records when it has no self model or engine identity to hand. */
export function unknownProvenance(source: string): CaseProvenance {
  return {
    selfModelVersion: UNKNOWN_PROVENANCE,
    selfModelHash: UNKNOWN_PROVENANCE,
    diagnosisEngineVersion: UNKNOWN_PROVENANCE,
    diagnosisPolicyHash: UNKNOWN_PROVENANCE,
    source
  };
}

/** What was actually done, as opposed to what was proposed. */
export interface TreatmentPerformed {  at: string;
  proposalId: string;
  treatment: string;
  /** Who performed it. This module records the answer; it never is the answer. */
  performedBy: TreatmentSource;
  outcome: string;
  reversible: boolean;
}

export interface CaseValidation {
  at: string;
  /** Whether the treatment worked, as observed later. */
  verdict: CaseValidationVerdict;
  evidence: string[];
  observedBy: string;
}

/**
 * One case, as folded from its timeline.
 *
 * Every field is either a fold of events or a link to something outside the case, and the links are
 * ids rather than copies so a reader can follow them.
 */
export interface SelfDiagnosisCase {
  schemaVersion: number;
  kind: "SELF_DIAGNOSIS_CASE";
  caseId: string;
  openedAt: string;
  closedAt?: string;
  status: CaseStatus;
  /** What started the case. */
  trigger: string;
  /** A real incident, a fixture or a test. Fixed at open; only a real incident counts in the headline. */
  incidentClass: CaseIncidentClass;
  /** The body and the diagnosis rules this case was opened against. Fixed at open, never rewritten. */
  provenance: CaseProvenance;
  affectedComponents: string[];
  symptoms: DiagnosticSymptom[];
  observations: string[];
  /** Every revision, oldest first. The first is never overwritten. */
  diagnosesConsidered: DiagnosisRevision[];
  /** The first diagnosis, frozen: the only one an investigation could not have influenced. */
  firstPass?: CaseFirstPass;
  selectedDiagnosis?: DiagnosisRevision;
  missingEvidence: string[];
  diagnosticActions: DiagnosticPlanStep[];
  treatmentProposals: TreatmentProposal[];
  treatmentActuallyPerformed: TreatmentPerformed[];
  validations: CaseValidation[];
  finalDisposition?: string;
  rootCause?: string;
  /** Other cases about the same component and failure mode. */
  recurrenceLinks: string[];
  relatedCommits: string[];
  relatedTasks: string[];
  relatedRuntimeEvents: string[];
  /** The last event's identity, so a reader can see the timeline's length without reading it. */
  events: number;
  notes: string[];
}

/** A case and its raw timeline, which is what a store persists and what a fold consumes. */
export interface CaseTimeline {
  caseId: string;
  events: CaseEvent[];
}

/** One appended fact. A case's timeline is a list of these and nothing else. */
export interface CaseEvent {
  schemaVersion: number;
  /** Monotone within a case, assigned at append time. */
  sequence: number;
  at: string;
  type: CaseEventType;
  /** The event's payload, shaped by its type. Validated on append. */
  detail: Record<string, unknown>;
}
