/**
 * Self Diagnosis — the engine.
 *
 * One entry point, `diagnose`, which reads the anatomy the Self Cognition module built, turns
 * readings into named symptoms, produces SEVERAL candidate causes with confidences, separates a
 * cause from its downstream effects through the dependency graph, says what to check next, and
 * suggests what might be done — advisory only, with the boundary cases marked `OWNER_ONLY`.
 *
 * It takes the self model as an INPUT. It has no path that writes to it, returns no model, and its
 * report carries `mutatesAnatomy: false` as a literal: `SELF_DIAGNOSIS does not mutate anatomy
 * truth`, enforced by the type of the return value rather than by a promise.
 */

import type { BossSelfModel } from "../self-cognition/contracts";
import {
  collectObservations,
  unhealthyObservations,
  type HealthObservation,
  type SelfObservationSource
} from "./observations";
import {
  assignRoles,
  hypothesesOf,
  rankHypotheses,
  spreadOf,
  symptomsOf,
  unreadableSymptom,
  type DiagnosisHypothesis,
  type HypothesisSpread,
  type PriorEvidence
} from "./hypotheses";
import { planDiagnosis, type DiagnosticPlan } from "./plan";
import { proposeTreatments, type TreatmentProposal } from "./treatment";
import type { DiagnosticSymptom } from "./hypotheses";

export const SELF_DIAGNOSIS_SCHEMA_VERSION = 1;

export interface DiagnosisReport {
  schemaVersion: number;
  kind: "SELF_DIAGNOSIS_REPORT";
  at: string;
  /** How many readings were taken, and how many of them were unhealthy. */
  observations: number;
  unhealthyObservations: number;
  symptoms: DiagnosticSymptom[];
  hypotheses: DiagnosisHypothesis[];
  spread: HypothesisSpread;
  plan: DiagnosticPlan;
  treatments: TreatmentProposal[];
  unreadable: Array<{ source: string; reason: string }>;
  sourceFailures: Array<{ source: string; reason: string }>;
  /** Literal capabilities. A consumer cannot mistake this report for an instruction. */
  authority: { canDiagnose: true; canProposeTreatment: true; canExecuteTreatment: false; mutatesAnatomy: false };
  notes: string[];
}

/**
 * Diagnoses the system from its own readings.
 *
 * A run with no symptoms produces a report with no hypotheses, an empty plan and the sentence that
 * says what that does and does not mean.
 */
export function diagnose(input: {
  model: BossSelfModel;
  observations?: readonly HealthObservation[];
  sources?: readonly SelfObservationSource[];
  at: string;
  priors?: readonly PriorEvidence[];
  /** Components a source could not attribute, offered so the report can say which they were. */
  unattributableFrom?: readonly HealthObservation[];
}): DiagnosisReport {
  const notes: string[] = [];
  const collected = input.sources === undefined ? { observations: [] as HealthObservation[], unreadable: [], sourceFailures: [] } : collectObservations({ model: input.model, at: input.at, sources: input.sources });
  const observations = [...(input.observations ?? []), ...collected.observations];
  const unreadable = [...collected.unreadable];

  // A reading that names a component the anatomy does not describe is kept, and said out loud.
  const known = new Set(input.model.components.flatMap((component) => [component.id, component.name]));
  const unattributable = observations.filter((observation) => !known.has(observation.componentId));
  for (const observation of unattributable) {
    notes.push(`${observation.source} reported ${observation.signalId} about ${observation.componentId}, which the anatomy does not describe; the reading is kept and its component is not assumed to exist`);
  }

  const symptoms = [
    ...symptomsOf(observations),
    ...unreadable.map((entry) => unreadableSymptom({ source: entry.source, reason: entry.reason, componentId: `source:${entry.source}`, at: input.at }))
  ];
  for (const failure of collected.sourceFailures) {
    notes.push(`the observation source ${failure.source} threw and was isolated: ${failure.reason}`);
  }
  if (unhealthyObservations(observations).length === 0) {
    notes.push(
      symptoms.some((symptom) => symptom.kind !== "SOURCE_UNREADABLE")
        ? "no reading that was taken was unhealthy"
        : "no reading that was taken was unhealthy, which is not the same as the system being healthy: readings that could not be taken are listed as UNKNOWN and are not counted here"
    );
  }

  const candidates = hypothesesOf({ model: input.model, symptoms, at: input.at, ...(input.priors === undefined ? {} : { priors: input.priors }) });
  const hypotheses = rankHypotheses(assignRoles({ model: input.model, hypotheses: candidates }));
  const plan = planDiagnosis({ hypotheses, missingEvidence: hypotheses.flatMap((hypothesis) => hypothesis.missingEvidence), at: input.at });
  const treatments = proposeTreatments({ model: input.model, hypotheses });
  const spread = spreadOf(hypotheses);
  if (spread === "MULTIPLE_HYPOTHESES") {
    notes.push(`${hypotheses.filter((hypothesis) => hypothesis.confidence >= 0.3).length} candidate(s) are credible at the same time; no single root cause is asserted and the ranked list is the answer`);
  }

  return {
    schemaVersion: SELF_DIAGNOSIS_SCHEMA_VERSION,
    kind: "SELF_DIAGNOSIS_REPORT",
    at: input.at,
    observations: observations.length,
    unhealthyObservations: unhealthyObservations(observations).length,
    symptoms,
    hypotheses,
    spread,
    plan,
    treatments,
    unreadable,
    sourceFailures: collected.sourceFailures,
    authority: { canDiagnose: true, canProposeTreatment: true, canExecuteTreatment: false, mutatesAnatomy: false },
    notes
  };
}

/** The four things a report says about itself, re-exported so a caller can assert on them. */
export const SELF_DIAGNOSIS_CAPABILITIES = {
  canDiagnose: true,
  canProposeTreatment: true,
  canExecuteTreatment: false,
  mutatesAnatomy: false
} as const;
