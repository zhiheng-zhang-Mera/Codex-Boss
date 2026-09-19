/**
 * Case Record — the append-only timeline, and the fold that reads it.
 *
 * There is no mutable case object anywhere in this module. A case is a list of events; the
 * `SelfDiagnosisCase` a caller reads is a FOLD of that list. Two consequences follow, and both are
 * the point:
 *
 *   - **a revision cannot overwrite its predecessor.** A diagnosis that changed appears as another
 *     `HYPOTHESIS_REVISED` event, so "we thought A, then found B" is readable in the record rather
 *     than being rewritten into "we always thought B".
 *   - **history is evidence.** The fold is deterministic, so any two readers of the same timeline
 *     agree on the case, and a store that loses state can be rebuilt from the events alone.
 *
 * `appendEvent` refuses an event that would rewrite history: an unknown case, a duplicate sequence,
 * an unparseable instant, or a `CASE_RESOLVED` on a case that is already closed.
 */

import {
  CASE_EVENT_TYPES,
  CASE_INCIDENT_CLASSES,
  CASE_SCHEMA_VERSION,
  CASE_VALIDATION_VERDICTS,
  TERMINAL_CASE_STATUSES,
  TREATMENT_SOURCES,
  type CaseEvent,
  type CaseEventType,
  type CaseFirstPass,
  type CaseIncidentClass,
  type CaseProvenance,
  type CaseStatus,
  type CaseTimeline,
  type CaseValidation,
  type CaseValidationVerdict,
  type DiagnosisRevision,
  type SelfDiagnosisCase,
  type TreatmentPerformed,
  type TreatmentSource
} from "./case";
import type { DiagnosisHypothesis, DiagnosticSymptom } from "../self-diagnosis/hypotheses";
import type { DiagnosticPlanStep } from "../self-diagnosis/plan";
import type { TreatmentProposal } from "../self-diagnosis/treatment";

export interface TimelineOperation {
  ok: boolean;
  timeline?: CaseTimeline;
  case?: SelfDiagnosisCase;
  problems: string[];
}

/** Opens a case. The opening event is the first thing on the timeline and is never removed. */
export function openCase(input: { caseId: string; at: string; trigger: string; incidentClass: CaseIncidentClass; provenance: CaseProvenance; affectedComponents?: readonly string[]; symptoms?: readonly DiagnosticSymptom[]; relatedTasks?: readonly string[]; relatedCommits?: readonly string[]; relatedRuntimeEvents?: readonly string[] }): TimelineOperation {
  if (input.caseId.trim() === "") return { ok: false, problems: ["a case needs an id: a record that cannot be named cannot be linked to"] };
  if (!Number.isFinite(Date.parse(input.at))) return { ok: false, problems: [`the instant ${JSON.stringify(input.at)} does not parse, so the case has no opening time`] };
  if (input.trigger.trim() === "") return { ok: false, problems: ["a case needs a trigger: what started it is the first thing a reader asks"] };
  // A case must say whether it is evidence about the system or about the recorder. There is no
  // default: a fixture recorded as a real incident would enter the dogfood headline, and that is the
  // mistake this field exists to prevent.
  if (!CASE_INCIDENT_CLASSES.includes(input.incidentClass)) {
    return { ok: false, problems: [`${JSON.stringify(input.incidentClass)} is not an incident class: a case is a REAL_INCIDENT, a RETROSPECTIVE_FIXTURE or a DEVELOPMENT_TEST, and only the first counts`] };
  }
  // Provenance is required, and a blank field is refused while `UNKNOWN` is accepted: a record must
  // say which body and which rules judged it, and it must be able to say that it does not know.
  const blank = Object.entries(input.provenance ?? {}).filter(([, value]) => typeof value !== "string" || value.trim() === "").map(([key]) => key);
  if (blank.length > 0) return { ok: false, problems: [`the case names no ${blank.join(", ")}: provenance is recorded as UNKNOWN when it cannot be established, and never left blank`] };
  const timeline: CaseTimeline = { caseId: input.caseId, events: [] };
  const applied = appendEvent(timeline, {
    at: input.at,
    type: "CASE_OPENED",
    detail: {
      trigger: input.trigger,
      incidentClass: input.incidentClass,
      provenance: input.provenance,
      affectedComponents: [...(input.affectedComponents ?? [])],
      symptoms: [...(input.symptoms ?? [])],
      relatedTasks: [...(input.relatedTasks ?? [])],
      relatedCommits: [...(input.relatedCommits ?? [])],
      relatedRuntimeEvents: [...(input.relatedRuntimeEvents ?? [])]
    }
  });
  return applied;
}

/** The fold's current status, before an event is applied. */
function statusOf(timeline: CaseTimeline): CaseStatus {
  const folded = foldCase(timeline);
  return folded.ok && folded.case !== undefined ? folded.case.status : "OPEN";
}

/**
 * Appends one event.
 *
 * The sequence is assigned here rather than supplied, so a caller cannot reorder or replay a
 * timeline by hand. Every refusal names what the event would have done.
 */
export function appendEvent(timeline: CaseTimeline, input: { at: string; type: CaseEventType; detail: Record<string, unknown> }): TimelineOperation {
  if (!CASE_EVENT_TYPES.includes(input.type)) return { ok: false, problems: [`${input.type} is not a case event type`] };
  if (!Number.isFinite(Date.parse(input.at))) return { ok: false, problems: [`the instant ${JSON.stringify(input.at)} does not parse, so the event cannot be placed in time`] };
  const current = statusOf(timeline);
  const last = timeline.events[timeline.events.length - 1];
  if (last !== undefined && Date.parse(input.at) < Date.parse(last.at)) {
    return { ok: false, problems: [`the event is at ${input.at}, before the previous event at ${last.at}: a timeline only moves forward`] };
  }
  if (input.type === "CASE_RESOLVED" && TERMINAL_CASE_STATUSES.includes(current)) {
    return { ok: false, problems: [`the case is already ${current}, so a second resolution would rewrite which disposition stands`] };
  }
  if (input.type !== "CASE_OPENED" && timeline.events.length === 0) {
    return { ok: false, problems: ["the case has not been opened, so there is nothing to append to"] };
  }
  // A treatment is performed by a person or another system, never by this plane, so a record that
  // cannot name one of those is refused rather than stored with a source nobody can act on.
  if (input.type === "TREATMENT_PERFORMED") {
    const source = input.detail.performedBy;
    if (!TREATMENT_SOURCES.includes(source as TreatmentSource)) {
      return { ok: false, problems: [`a treatment was performed by ${JSON.stringify(source)}: the source must be one of ${TREATMENT_SOURCES.join(", ")}, and SELF_DIAGNOSIS is never one of them because this plane cannot treat`] };
    }
  }
  // A validation verdict is the fact a case is adjudicated on, so an unknown word is refused rather
  // than quietly stored as INCONCLUSIVE.
  if (input.type === "VALIDATION_ADDED" && !CASE_VALIDATION_VERDICTS.includes(input.detail.verdict as CaseValidationVerdict)) {
    return { ok: false, problems: [`${JSON.stringify(input.detail.verdict)} is not a validation verdict: it must be one of ${CASE_VALIDATION_VERDICTS.join(", ")}`] };
  }
  const event: CaseEvent = { schemaVersion: CASE_SCHEMA_VERSION, sequence: timeline.events.length + 1, at: input.at, type: input.type, detail: input.detail };
  const next: CaseTimeline = { caseId: timeline.caseId, events: [...timeline.events, event] };
  const folded = foldCase(next);
  if (!folded.ok) return { ok: false, problems: folded.problems };
  return { ok: true, timeline: next, case: folded.case, problems: [] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Whether a stored opening event carries a well-formed provenance rather than a partial one. */
function isProvenance(value: unknown): value is CaseProvenance {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["selfModelVersion", "selfModelHash", "diagnosisEngineVersion", "diagnosisPolicyHash", "source"].every((key) => typeof candidate[key] === "string" && (candidate[key] as string).trim() !== "");
}

/**
 * Reads a timeline into a case.
 *
 * The fold is a pure function of the events: the same timeline always reads the same way, which is
 * what makes the record auditable rather than merely stored.
 */
export function foldCase(timeline: CaseTimeline): TimelineOperation {
  const problems: string[] = [];
  const notes: string[] = [];
  let opened: CaseEvent | undefined;
  let closedAt: string | undefined;
  let status: CaseStatus = "OPEN";
  let trigger = "";
  let incidentClass: CaseIncidentClass = "DEVELOPMENT_TEST";
  let provenance: CaseProvenance = { selfModelVersion: "", selfModelHash: "", diagnosisEngineVersion: "", diagnosisPolicyHash: "", source: "" };
  let affectedComponents: string[] = [];
  let symptoms: DiagnosticSymptom[] = [];
  let observations: string[] = [];
  const diagnosesConsidered: DiagnosisRevision[] = [];
  let firstPass: CaseFirstPass | undefined;
  let missingEvidence: string[] = [];
  let diagnosticActions: DiagnosticPlanStep[] = [];
  let treatmentProposals: TreatmentProposal[] = [];
  const treatmentActuallyPerformed: TreatmentPerformed[] = [];
  const validations: CaseValidation[] = [];
  let finalDisposition: string | undefined;
  let rootCause: string | undefined;
  let recurrenceLinks: string[] = [];
  let relatedCommits: string[] = [];
  let relatedTasks: string[] = [];
  let relatedRuntimeEvents: string[] = [];

  for (const [index, event] of timeline.events.entries()) {
    if (event.sequence !== index + 1) {
      problems.push(`event ${index + 1} carries sequence ${event.sequence}: a timeline whose sequence is not its order cannot be trusted`);
      continue;
    }
    switch (event.type) {
      case "CASE_OPENED":
        opened = event;
        trigger = typeof event.detail.trigger === "string" ? event.detail.trigger : "";
        incidentClass = CASE_INCIDENT_CLASSES.includes(event.detail.incidentClass as CaseIncidentClass) ? (event.detail.incidentClass as CaseIncidentClass) : "DEVELOPMENT_TEST";
        provenance = isProvenance(event.detail.provenance) ? event.detail.provenance : provenance;
        affectedComponents = strings(event.detail.affectedComponents);
        symptoms = Array.isArray(event.detail.symptoms) ? (event.detail.symptoms as DiagnosticSymptom[]) : [];
        relatedTasks = strings(event.detail.relatedTasks);
        relatedCommits = strings(event.detail.relatedCommits);
        relatedRuntimeEvents = strings(event.detail.relatedRuntimeEvents);
        status = "OBSERVING";
        break;
      case "OBSERVATION_ADDED": {
        const detail = typeof event.detail.detail === "string" ? event.detail.detail : "";
        observations.push(`${event.at}: ${detail}`);
        status = "OBSERVING";
        break;
      }
      case "HYPOTHESIS_ADDED":
      case "HYPOTHESIS_REVISED": {
        const hypotheses = Array.isArray(event.detail.hypotheses) ? (event.detail.hypotheses as DiagnosisHypothesis[]) : [];
        const revision: DiagnosisRevision = {
          revision: diagnosesConsidered.length + 1,
          at: event.at,
          hypotheses,
          ...(typeof event.detail.selectedHypothesisId === "string" ? { selectedHypothesisId: event.detail.selectedHypothesisId } : {}),
          reason: typeof event.detail.reason === "string" ? event.detail.reason : "no reason recorded"
        };
        diagnosesConsidered.push(revision);
        // The FIRST revision is the first pass, and it is copied here rather than referenced so a
        // later revision cannot change it. This is the diagnosis the dogfood metrics score.
        if (firstPass === undefined) {
          firstPass = { at: revision.at, revision: revision.revision, hypotheses: revision.hypotheses, reason: revision.reason };
        }
        status = revision.selectedHypothesisId === undefined ? "DIAGNOSING" : "WAITING_FOR_EVIDENCE";
        break;
      }
      case "TREATMENT_PROPOSED":
        treatmentProposals = [...treatmentProposals, ...(Array.isArray(event.detail.proposals) ? (event.detail.proposals as TreatmentProposal[]) : [])];
        status = "TREATMENT_PROPOSED";
        break;
      case "TREATMENT_PERFORMED":
        treatmentActuallyPerformed.push({
          at: event.at,
          proposalId: typeof event.detail.proposalId === "string" ? event.detail.proposalId : "",
          treatment: typeof event.detail.treatment === "string" ? event.detail.treatment : "",
          // A record that named no source folds to EXTERNAL_SYSTEM and is reported as a protocol
          // violation, rather than being attributed to this plane or to a person by default.
          performedBy: TREATMENT_SOURCES.includes(event.detail.performedBy as TreatmentSource) ? (event.detail.performedBy as TreatmentSource) : "EXTERNAL_SYSTEM",
          outcome: typeof event.detail.outcome === "string" ? event.detail.outcome : "unknown",
          reversible: event.detail.reversible === true
        });
        status = "TREATED_EXTERNALLY";
        break;
      case "VALIDATION_ADDED":
        validations.push({
          at: event.at,
          verdict: CASE_VALIDATION_VERDICTS.includes(event.detail.verdict as CaseValidationVerdict) ? (event.detail.verdict as CaseValidationVerdict) : "INCONCLUSIVE",
          evidence: strings(event.detail.evidence),
          observedBy: typeof event.detail.observedBy === "string" ? event.detail.observedBy : "unknown"
        });
        status = "VALIDATING";
        break;
      case "CASE_RESOLVED":
        closedAt = event.at;
        finalDisposition = typeof event.detail.disposition === "string" ? event.detail.disposition : "UNKNOWN";
        rootCause = typeof event.detail.rootCause === "string" ? event.detail.rootCause : undefined;
        status = finalDisposition === "RESOLVED" ? "RESOLVED" : "UNRESOLVED";
        break;
      case "CASE_REOPENED":
        closedAt = undefined;
        status = "RECURRENT";
        break;
      case "RECURRENCE_LINKED":
        recurrenceLinks = [...new Set([...recurrenceLinks, ...strings(event.detail.caseIds)])];
        break;
      default:
        problems.push(`the event type ${String(event.type)} is not one this fold understands`);
    }
  }

  if (opened === undefined && timeline.events.length > 0) problems.push("the timeline holds events but no CASE_OPENED, so the case has no beginning");

  return {
    ok: problems.length === 0,
    problems,
    timeline,
    case: {
      schemaVersion: CASE_SCHEMA_VERSION,
      kind: "SELF_DIAGNOSIS_CASE",
      caseId: timeline.caseId,
      openedAt: opened?.at ?? "",
      ...(closedAt === undefined ? {} : { closedAt }),
      status,
      trigger,
      incidentClass,
      provenance,
      affectedComponents,
      symptoms,
      observations,
      diagnosesConsidered,
      ...(diagnosesConsidered.length === 0 ? {} : { selectedDiagnosis: diagnosesConsidered[diagnosesConsidered.length - 1] }),
      ...(firstPass === undefined ? {} : { firstPass }),
      missingEvidence,
      diagnosticActions,
      treatmentProposals,
      treatmentActuallyPerformed,
      validations,
      ...(finalDisposition === undefined ? {} : { finalDisposition }),
      ...(rootCause === undefined ? {} : { rootCause }),
      recurrenceLinks,
      relatedCommits,
      relatedTasks,
      relatedRuntimeEvents,
      events: timeline.events.length,
      notes
    }
  };
}

/** Every revision's first hypothesis, so a reader can see the diagnosis change over time. */
export function diagnosisHistory(record: SelfDiagnosisCase): Array<{ revision: number; at: string; leading: string; confidence: number; reason: string }> {
  return record.diagnosesConsidered.map((revision) => ({
    revision: revision.revision,
    at: revision.at,
    leading: revision.hypotheses[0]?.suspectedComponent ?? "none",
    confidence: revision.hypotheses[0]?.confidence ?? 0,
    reason: revision.reason
  }));
}

/** Whether the fold's status expects more evidence. */
export function expectsMoreObservation(record: SelfDiagnosisCase): boolean {
  return record.status === "OBSERVING" || record.status === "DIAGNOSING" || record.status === "WAITING_FOR_EVIDENCE" || record.status === "VALIDATING";
}
