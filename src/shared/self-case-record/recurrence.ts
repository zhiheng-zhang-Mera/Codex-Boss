/**
 * Case Record — recurrence, prior evidence, and the boundary before knowledge.
 *
 * Three things live here, and each encodes one boundary from the brief:
 *
 *   1. **Recurrence.** `linkRecurrence` connects a new case to earlier cases about the same
 *      component and failure mode, and marks the new one `RECURRENT` when there were any. That is a
 *      link between records, not a verdict about the present.
 *   2. **Prior evidence.** `priorEvidenceOf` hands Self Diagnosis what closed cases say. It only
 *      ever reads cases that are closed, and it returns evidence rather than an observation, so it
 *      cannot override what is being observed now: "上一次 Provider X 出问题 → 这次 Provider X 一定有问题"
 *      is exactly what this function does not do.
 *   3. **The knowledge boundary.** `lessonCandidates` refuses a single case, and `promoteLesson`
 *      returns a `LESSON_CANDIDATE` that says it still requires a knowledge review and is not
 *      knowledge. `一次病例 != 永久知识` is a machine rule here, not a convention.
 */

import { foldCase } from "./timeline";
import { TERMINAL_CASE_STATUSES, type SelfDiagnosisCase, type CaseTimeline } from "./case";
import type { DiagnosisHypothesis } from "../self-diagnosis/hypotheses";
import type { PriorEvidence } from "../self-diagnosis/hypotheses";

/** How many closed cases about the same component and failure mode make a lesson candidate. */
export const RECURRENCE_THRESHOLD = 2;

export interface RecurrenceLink {
  caseId: string;
  at: string;
  relatedCaseIds: string[];
  componentId: string;
  failureMode: string;
  reason: string;
}

/** The component and failure mode a case is about, read from its latest revision or its root cause. */
export function subjectOf(record: SelfDiagnosisCase): { componentId: string; failureMode: string } | undefined {
  const hypothesis = record.selectedDiagnosis?.hypotheses[0];
  if (hypothesis !== undefined) return { componentId: hypothesis.suspectedComponent, failureMode: hypothesis.failureMode };
  const rootCause = record.rootCause;
  if (rootCause !== undefined) return { componentId: rootCause, failureMode: record.finalDisposition ?? "UNKNOWN" };
  return undefined;
}

/**
 * Finds the earlier cases a new case recurs from.
 *
 * Only closed cases count: an open case is not evidence that anything has happened before.
 */
export function findRecurrences(input: { cases: readonly SelfDiagnosisCase[]; componentId: string; failureMode: string; excludeCaseId?: string }): SelfDiagnosisCase[] {
  return input.cases.filter((record) => {
    if (record.caseId === input.excludeCaseId) return false;
    if (!TERMINAL_CASE_STATUSES.includes(record.status)) return false;
    const subject = subjectOf(record);
    return subject !== undefined && subject.componentId === input.componentId && subject.failureMode === input.failureMode;
  });
}

/** The link a new case should record, and whether it makes the case recurrent. */
export function linkRecurrence(input: { cases: readonly SelfDiagnosisCase[]; componentId: string; failureMode: string; caseId: string; at: string }): RecurrenceLink & { recurrent: boolean } {
  const earlier = findRecurrences({ cases: input.cases, componentId: input.componentId, failureMode: input.failureMode, excludeCaseId: input.caseId });
  return {
    caseId: input.caseId,
    at: input.at,
    relatedCaseIds: earlier.map((record) => record.caseId).sort(),
    componentId: input.componentId,
    failureMode: input.failureMode,
    recurrent: earlier.length > 0,
    reason: earlier.length === 0
      ? `no closed case has been recorded about ${input.componentId} with ${input.failureMode}`
      : `${earlier.length} closed case(s) were already recorded about ${input.componentId} with ${input.failureMode}; this is evidence about the past and says nothing about whether it is happening now`
  };
}

/**
 * The prior evidence a diagnosis may use.
 *
 * It is deliberately a different type from a `HealthObservation`: a case cannot be mistaken for a
 * current reading, and the diagnosis is told in the record that it is evidence about the past.
 */
export function priorEvidenceOf(input: { cases: readonly SelfDiagnosisCase[]; componentId: string; failureMode?: string }): PriorEvidence[] {
  return input.cases
    .filter((record) => TERMINAL_CASE_STATUSES.includes(record.status))
    .flatMap((record) => {
      const subject = subjectOf(record);
      if (subject === undefined || subject.componentId !== input.componentId) return [];
      if (input.failureMode !== undefined && subject.failureMode !== input.failureMode) return [];
      return [{
        caseId: record.caseId,
        componentId: subject.componentId,
        failureMode: subject.failureMode,
        closedAt: record.closedAt ?? record.openedAt,
        finalDisposition: record.finalDisposition ?? record.status
      }];
    })
    .sort((left, right) => (left.closedAt < right.closedAt ? -1 : 1));
}

/* ------------------------------------------------------- knowledge boundary */

export const LESSON_CANDIDATE_KINDS = ["RECURRING_FAILURE", "VALIDATED_TREATMENT"] as const;
export type LessonCandidateKind = (typeof LESSON_CANDIDATE_KINDS)[number];

export interface LessonCandidate {
  schemaVersion: number;
  kind: "LESSON_CANDIDATE";
  candidateId: string;
  lessonKind: LessonCandidateKind;
  componentId: string;
  failureMode: string;
  /** What a reviewer would be asked to accept. */
  statement: string;
  evidenceCaseIds: string[];
  /** Literal: a candidate is not knowledge. It has to pass a review first. */
  isKnowledge: false;
  requiresKnowledgeReview: true;
  /** The review this candidate is waiting for. */
  reviewQueue: "knowledge-review";
  createdAt: string;
  reason: string;
}

/**
 * The cases that have earned a lesson review.
 *
 * A single case is never enough. A candidate needs either the same component and failure mode
 * recorded in at least `RECURRENCE_THRESHOLD` closed cases, or one case whose treatment was
 * validated as confirmed — and both of those are stated on the candidate so a reviewer can check
 * the claim rather than trust it.
 */
export function lessonCandidates(input: { cases: readonly SelfDiagnosisCase[]; at: string }): LessonCandidate[] {
  const closed = input.cases.filter((record) => TERMINAL_CASE_STATUSES.includes(record.status));
  const bySubject = new Map<string, SelfDiagnosisCase[]>();
  for (const record of closed) {
    const subject = subjectOf(record);
    if (subject === undefined) continue;
    const key = `${subject.componentId}|${subject.failureMode}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), record]);
  }
  const candidates: LessonCandidate[] = [];
  for (const [key, records] of bySubject) {
    const [componentId, failureMode] = key.split("|");
    const confirmed = records.filter((record) => record.validations.some((validation) => validation.verdict === "CONFIRMED"));
    if (records.length >= RECURRENCE_THRESHOLD) {
      candidates.push({
        schemaVersion: 1,
        kind: "LESSON_CANDIDATE",
        candidateId: `lesson:${key}`,
        lessonKind: "RECURRING_FAILURE",
        componentId,
        failureMode,
        statement: `${componentId} has failed with ${failureMode} in ${records.length} closed case(s)`,
        evidenceCaseIds: records.map((record) => record.caseId).sort(),
        isKnowledge: false,
        requiresKnowledgeReview: true,
        reviewQueue: "knowledge-review",
        createdAt: input.at,
        reason: `${records.length} closed case(s) is at or above the recurrence threshold of ${RECURRENCE_THRESHOLD}`
      });
      continue;
    }
    if (confirmed.length > 0) {
      candidates.push({
        schemaVersion: 1,
        kind: "LESSON_CANDIDATE",
        candidateId: `lesson:${key}:validated`,
        lessonKind: "VALIDATED_TREATMENT",
        componentId,
        failureMode,
        statement: `a treatment for ${failureMode} on ${componentId} was validated as confirmed`,
        evidenceCaseIds: confirmed.map((record) => record.caseId).sort(),
        isKnowledge: false,
        requiresKnowledgeReview: true,
        reviewQueue: "knowledge-review",
        createdAt: input.at,
        reason: `${confirmed.length} case(s) recorded a CONFIRMED validation, which one case alone cannot establish`
      });
    }
  }
  return candidates.sort((left, right) => (left.candidateId < right.candidateId ? -1 : 1));
}

/**
 * Turns a candidate into the thing a knowledge review receives.
 *
 * It returns the candidate unchanged, with the review's own queue named: there is no path from here
 * that produces a knowledge object, because that is the review's decision and not this module's.
 */
export function promoteLesson(candidate: LessonCandidate): { candidate: LessonCandidate; dispatchTo: "knowledge-review"; createsKnowledge: false; reason: string } {
  return {
    candidate,
    dispatchTo: "knowledge-review",
    createsKnowledge: false,
    reason: `${candidate.candidateId} is a candidate: it becomes knowledge only if a knowledge review accepts it, which this module cannot do`
  };
}

/** The cases a timeline list folds to, so a caller can search without re-reading a store. */
export function foldCases(timelines: readonly CaseTimeline[]): Array<{ record: SelfDiagnosisCase; problems: string[] }> {
  return timelines.map((timeline) => {
    const folded = foldCase(timeline);
    return { record: folded.case as SelfDiagnosisCase, problems: folded.problems };
  });
}

/** The hypothesis a case's record ended up resting on, when it recorded one. */
export function selectedHypothesis(record: SelfDiagnosisCase): DiagnosisHypothesis | undefined {
  return record.selectedDiagnosis?.hypotheses[0];
}
