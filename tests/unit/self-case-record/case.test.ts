import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CASE_EVENT_TYPES,
  CASE_SCHEMA_VERSION,
  CASE_STATUSES,
  TERMINAL_CASE_STATUSES,
  type CaseEvent,
  type CaseEventType,
  type CaseStatus,
  type CaseTimeline,
  type DiagnosisRevision,
  type SelfDiagnosisCase,
  type TreatmentPerformed
} from "../../../src/shared/self-case-record/case";
import { appendEvent, diagnosisHistory, expectsMoreObservation, foldCase, openCase } from "../../../src/shared/self-case-record/timeline";
import {
  LESSON_CANDIDATE_KINDS,
  RECURRENCE_THRESHOLD,
  findRecurrences,
  foldCases,
  lessonCandidates,
  linkRecurrence,
  priorEvidenceOf,
  promoteLesson,
  selectedHypothesis,
  subjectOf,
  type LessonCandidate,
  type LessonCandidateKind,
  type RecurrenceLink
} from "../../../src/shared/self-case-record/recurrence";
import { CASE_LOG_FILENAME, CaseStore, type CaseStoreOptions, type CaseStoreStatus } from "../../../electron/self-case-record/case-store";
import type { DiagnosisHypothesis } from "../../../src/shared/self-diagnosis/hypotheses";

/**
 * The case record.
 *
 * The claims under test are the ones that make a record worth reading later: a revision never
 * overwrites its predecessor, the fold is a pure function of the timeline, a recurrence is a link
 * rather than a verdict, and a single case never becomes knowledge.
 */

const AT = "2026-09-20T10:00:00.000Z";
const LATER = "2026-09-20T11:00:00.000Z";
const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-case-record-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function hypothesis(componentId: string, failureMode: string, confidence: number): DiagnosisHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: `hypothesis:${componentId}:${failureMode}`,
    suspectedComponent: componentId,
    failureMode,
    role: "ROOT_CAUSE",
    supportingEvidence: ["a reading"],
    contradictingEvidence: [],
    confidence,
    affectedComponents: [],
    affectedCapabilities: [],
    blastRadius: 1,
    alternativeHypotheses: [],
    missingEvidence: [],
    source: "test"
  };
}

/** A case opened, diagnosed and resolved, as the CLI would record it. */
function resolvedCase(caseId: string, componentId: string, failureMode: string, at = AT): CaseTimeline {
  const opened = openCase({ caseId, at, trigger: "a reading over its limit", affectedComponents: [componentId] });
  if (opened.timeline === undefined) throw new Error(opened.problems.join("; "));
  const diagnosed = appendEvent(opened.timeline, { at, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis(componentId, failureMode, 0.7)], reason: "the only candidate" } });
  if (diagnosed.timeline === undefined) throw new Error(diagnosed.problems.join("; "));
  const resolved = appendEvent(diagnosed.timeline, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: componentId } });
  if (resolved.timeline === undefined) throw new Error(resolved.problems.join("; "));
  return resolved.timeline;
}

describe("a case is its timeline, folded", () => {
  it("opens with an event and folds to a status", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "a task ledger write failed", affectedComponents: ["tasks"] });
    expect(opened.ok).toBe(true);
    expect(opened.timeline?.events).toHaveLength(1);
    expect(opened.timeline?.events[0].type).toBe("CASE_OPENED");
    expect(opened.timeline?.events[0].sequence).toBe(1);
    const record: SelfDiagnosisCase | undefined = opened.case;
    expect(record?.kind).toBe("SELF_DIAGNOSIS_CASE");
    expect(record?.schemaVersion).toBe(CASE_SCHEMA_VERSION);
    expect(record?.status).toBe("OBSERVING");
    expect(record?.trigger).toBe("a task ledger write failed");
    expect(record?.affectedComponents).toEqual(["tasks"]);
    expect(record?.events).toBe(1);
    expect(expectsMoreObservation(record as SelfDiagnosisCase)).toBe(true);
    expect(CASE_STATUSES).toContain(record?.status);
    expect(TERMINAL_CASE_STATUSES).toEqual(["RESOLVED", "UNRESOLVED"]);
  });

  it("refuses a case with no id, no trigger or an unparseable instant", () => {
    expect(openCase({ caseId: " ", at: AT, trigger: "x" }).problems.join(" ")).toContain("a case needs an id");
    expect(openCase({ caseId: "case-1", at: AT, trigger: "  " }).problems.join(" ")).toContain("a case needs a trigger");
    expect(openCase({ caseId: "case-1", at: "not-a-date", trigger: "x" }).problems.join(" ")).toContain("does not parse");
  });

  it("keeps every diagnosis revision, so a changed mind is visible", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const first = appendEvent(opened.timeline as CaseTimeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "PROVIDER_TIMEOUT_SPIKE", 0.7)], selectedHypothesisId: "hypothesis:providers:PROVIDER_TIMEOUT_SPIKE", reason: "the first reading" } });
    const second = appendEvent(first.timeline as CaseTimeline, { at: LATER, type: "HYPOTHESIS_REVISED", detail: { hypotheses: [hypothesis("tasks", "TASK_LEDGER_WRITE_FAILURE", 0.9)], selectedHypothesisId: "hypothesis:tasks:TASK_LEDGER_WRITE_FAILURE", reason: "the ledger evidence arrived and the provider was fine" } });
    const record = second.case as SelfDiagnosisCase;
    expect(record.diagnosesConsidered).toHaveLength(2);
    expect(record.diagnosesConsidered[0].hypotheses[0].suspectedComponent).toBe("providers");
    expect(record.diagnosesConsidered[1].hypotheses[0].suspectedComponent).toBe("tasks");
    // The first revision is intact: the record shows what was thought, and when it changed.
    const history = diagnosisHistory(record);
    expect(history.map((entry) => entry.leading)).toEqual(["providers", "tasks"]);
    expect(history[0].reason).toBe("the first reading");
    expect(history[1].at).toBe(LATER);
    expect(selectedHypothesis(record)?.suspectedComponent).toBe("tasks");
    expect(subjectOf(record)).toEqual({ componentId: "tasks", failureMode: "TASK_LEDGER_WRITE_FAILURE" });
  });

  it("refuses an event that would rewrite history", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const timeline = opened.timeline as CaseTimeline;
    expect(appendEvent(timeline, { at: "2026-09-19T00:00:00.000Z", type: "OBSERVATION_ADDED", detail: { detail: "backdated" } }).problems.join(" ")).toContain("a timeline only moves forward");
    const resolved = appendEvent(appendEvent(timeline, { at: AT, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED" } }).timeline as CaseTimeline, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: "UNRESOLVED" } });
    expect(resolved.problems.join(" ")).toContain("already RESOLVED");
    expect(appendEvent(timeline, { at: AT, type: "NOT_AN_EVENT" as CaseEventType, detail: {} }).problems.join(" ")).toContain("is not a case event type");
    const unopened: CaseTimeline = { caseId: "case-2", events: [] };
    expect(appendEvent(unopened, { at: AT, type: "OBSERVATION_ADDED", detail: {} }).problems.join(" ")).toContain("has not been opened");
    // A sequence that is not the order is refused by the fold, not silently accepted.
    const tampered: CaseTimeline = { caseId: "case-3", events: [{ schemaVersion: 1, sequence: 7, at: AT, type: "CASE_OPENED", detail: { trigger: "x" } }] };
    expect(foldCase(tampered).problems.join(" ")).toContain("cannot be trusted");
    const orphan: CaseTimeline = { caseId: "case-4", events: [{ schemaVersion: 1, sequence: 1, at: AT, type: "OBSERVATION_ADDED", detail: {} }] };
    expect(foldCase(orphan).problems.join(" ")).toContain("no CASE_OPENED");
  });

  it("records what was performed separately from what was proposed", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const withProposal = appendEvent(opened.timeline as CaseTimeline, { at: AT, type: "TREATMENT_PROPOSED", detail: { proposals: [{ schemaVersion: 1, kind: "TREATMENT_PROPOSAL", proposalId: "treatment:h", treatment: "RETRY", targetComponent: "providers", hypothesisId: "h", risk: "LOW", expectedBenefit: "b", riskDetail: "r", blastRadius: 1, reversible: true, requiredAuthority: "AUTONOMOUS_CANDIDATE", executable: false, reason: "x" }] } });
    expect((withProposal.case as SelfDiagnosisCase).treatmentProposals).toHaveLength(1);
    expect((withProposal.case as SelfDiagnosisCase).treatmentActuallyPerformed).toEqual([]);
    const performed = appendEvent(withProposal.timeline as CaseTimeline, { at: LATER, type: "TREATMENT_PERFORMED", detail: { proposalId: "treatment:h", treatment: "RETRY", performedBy: "an owner", outcome: "the run succeeded", reversible: true } });
    const record = performed.case as SelfDiagnosisCase;
    expect(record.treatmentActuallyPerformed).toHaveLength(1);
    const done: TreatmentPerformed = record.treatmentActuallyPerformed[0];
    expect(done.performedBy).toBe("an owner");
    expect(record.status).toBe("TREATED_EXTERNALLY");
    const validated = appendEvent(performed.timeline as CaseTimeline, { at: LATER, type: "VALIDATION_ADDED", detail: { verdict: "CONFIRMED", evidence: ["no further failure in 24h"], observedBy: "an owner" } });
    expect((validated.case as SelfDiagnosisCase).validations[0].verdict).toBe("CONFIRMED");
    expect((validated.case as SelfDiagnosisCase).status).toBe("VALIDATING");
  });

  it("names every event type it accepts and every status it can hold", () => {
    expect(CASE_EVENT_TYPES).toEqual(["CASE_OPENED", "OBSERVATION_ADDED", "HYPOTHESIS_ADDED", "HYPOTHESIS_REVISED", "TREATMENT_PROPOSED", "TREATMENT_PERFORMED", "VALIDATION_ADDED", "CASE_RESOLVED", "CASE_REOPENED", "RECURRENCE_LINKED"]);
    expect(CASE_STATUSES).toHaveLength(10);
    const status: CaseStatus = "OPEN";
    expect(CASE_STATUSES).toContain(status);
    const revision: DiagnosisRevision | undefined = foldCase(resolvedCase("case-1", "providers", "PROVIDER_TIMEOUT_SPIKE")).case?.diagnosesConsidered[0];
    expect(revision?.revision).toBe(1);
    const event: CaseEvent | undefined = resolvedCase("case-2", "providers", "PROVIDER_TIMEOUT_SPIKE").events[0];
    expect(event?.type).toBe("CASE_OPENED");
  });
});

describe("recurrence is a link, and priors are about the past", () => {
  it("links a new case to the closed cases it recurs from", () => {
    const cases = foldCases([resolvedCase("case-1", "providers", "PROVIDER_TIMEOUT_SPIKE")]).map((entry) => entry.record);
    const link: RecurrenceLink & { recurrent: boolean } = linkRecurrence({ cases, componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE", caseId: "case-2", at: LATER });
    expect(link.recurrent).toBe(true);
    expect(link.caseId).toBe("case-2");
    expect(link.componentId).toBe("providers");
    expect(link.relatedCaseIds).toEqual(["case-1"]);
    expect(link.reason).toContain("evidence about the past and says nothing about whether it is happening now");
    expect(findRecurrences({ cases, componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE" })).toHaveLength(1);
    // An open case is not evidence that anything happened before.
    const opened = openCase({ caseId: "case-3", at: AT, trigger: "x" });
    expect(findRecurrences({ cases: [opened.case as SelfDiagnosisCase], componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE" })).toEqual([]);
    const first = linkRecurrence({ cases: [], componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE", caseId: "case-9", at: LATER });
    expect(first.recurrent).toBe(false);
    expect(first.reason).toContain("no closed case has been recorded");
  });

  it("hands the diagnosis evidence, never an observation", () => {
    const cases = foldCases([resolvedCase("case-1", "providers", "PROVIDER_TIMEOUT_SPIKE")]).map((entry) => entry.record);
    const priors = priorEvidenceOf({ cases, componentId: "providers" });
    expect(priors).toEqual([{ caseId: "case-1", componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE", closedAt: LATER, finalDisposition: "RESOLVED" }]);
    expect(priorEvidenceOf({ cases, componentId: "tasks" })).toEqual([]);
    expect(priorEvidenceOf({ cases, componentId: "providers", failureMode: "CACHE_STALE" })).toEqual([]);
  });
});

describe("a case is not knowledge", () => {
  it("refuses a lesson candidate from a single case", () => {
    const one = foldCases([resolvedCase("case-1", "providers", "PROVIDER_TIMEOUT_SPIKE")]).map((entry) => entry.record);
    expect(lessonCandidates({ cases: one, at: LATER })).toEqual([]);
    expect(RECURRENCE_THRESHOLD).toBe(2);
  });

  it("offers a candidate once the same failure has recurred", () => {
    const cases = foldCases([resolvedCase("case-1", "providers", "PROVIDER_TIMEOUT_SPIKE"), resolvedCase("case-2", "providers", "PROVIDER_TIMEOUT_SPIKE", LATER)]).map((entry) => entry.record);
    const candidates: LessonCandidate[] = lessonCandidates({ cases, at: LATER });
    expect(candidates).toHaveLength(1);
    const kind: LessonCandidateKind = candidates[0].lessonKind;
    expect(kind).toBe("RECURRING_FAILURE");
    expect(LESSON_CANDIDATE_KINDS).toEqual(["RECURRING_FAILURE", "VALIDATED_TREATMENT"]);
    expect(candidates[0].lessonKind).toBe("RECURRING_FAILURE");
    expect(candidates[0].evidenceCaseIds).toEqual(["case-1", "case-2"]);
    expect(candidates[0].isKnowledge).toBe(false);
    expect(candidates[0].requiresKnowledgeReview).toBe(true);
    expect(candidates[0].reviewQueue).toBe("knowledge-review");
    const promoted = promoteLesson(candidates[0]);
    expect(promoted.dispatchTo).toBe("knowledge-review");
    expect(promoted.createsKnowledge).toBe(false);
    expect(promoted.reason).toContain("only if a knowledge review accepts it");
  });

  it("offers a candidate for a validated treatment on its own", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const diagnosed = appendEvent(opened.timeline as CaseTimeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "CACHE_STALE", 0.6)], selectedHypothesisId: "hypothesis:providers:CACHE_STALE" } });
    const validated = appendEvent(diagnosed.timeline as CaseTimeline, { at: AT, type: "VALIDATION_ADDED", detail: { verdict: "CONFIRMED", evidence: ["the cache was stale"], observedBy: "owner" } });
    const resolved = appendEvent(validated.timeline as CaseTimeline, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "providers" } });
    const candidates = lessonCandidates({ cases: [resolved.case as SelfDiagnosisCase], at: LATER });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].lessonKind).toBe("VALIDATED_TREATMENT");
    expect(candidates[0].reason).toContain("which one case alone cannot establish");
  });
});

describe("the store appends events and folds them back", () => {
  it("records a case across a restart, one row per event", () => {
    const root = makeRoot();
    const options: CaseStoreOptions = { rootDir: root, now: () => AT };
    const store = new CaseStore(options);
    const opened = store.openCase({ caseId: "case-1", trigger: "a reading over its limit", affectedComponents: ["providers"] });
    expect(opened.ok).toBe(true);
    expect(store.append({ caseId: "case-1", type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "PROVIDER_TIMEOUT_SPIKE", 0.7)], selectedHypothesisId: "hypothesis:providers:PROVIDER_TIMEOUT_SPIKE" } }).ok).toBe(true);
    expect(store.append({ caseId: "case-1", type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "providers" } }).ok).toBe(true);

    // A second process reads the same log and sees the same case.
    const reopened = new CaseStore({ rootDir: root });
    const record = reopened.record("case-1");
    expect(record?.status).toBe("RESOLVED");
    expect(record?.diagnosesConsidered).toHaveLength(1);
    expect(record?.events).toBe(3);
    const status: CaseStoreStatus = reopened.status();
    expect(status.file.endsWith(CASE_LOG_FILENAME)).toBe(true);
    expect(status.cases).toBe(1);
    expect(status.events).toBe(3);
    expect(status.closed).toBe(1);
    expect(status.unreadableRows).toBe(0);
    // One row per event, never a snapshot per case.
    const rows = fs.readFileSync(path.join(root, CASE_LOG_FILENAME), "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
    expect(rows).toHaveLength(3);
  });

  it("refuses to open the same case twice, and to append to a case it does not hold", () => {
    const store = new CaseStore({ rootDir: makeRoot(), now: () => AT });
    store.openCase({ caseId: "case-1", trigger: "x" });
    expect(store.openCase({ caseId: "case-1", trigger: "y" }).problems.join(" ")).toContain("never opened twice, and a recurrence is a link");
    expect(store.append({ caseId: "case-2", type: "OBSERVATION_ADDED", detail: {} }).problems.join(" ")).toContain("no case case-2 is recorded");
  });

  it("counts a torn row instead of losing the case", () => {
    const root = makeRoot();
    const store = new CaseStore({ rootDir: root, now: () => AT });
    store.openCase({ caseId: "case-1", trigger: "x" });
    fs.appendFileSync(path.join(root, CASE_LOG_FILENAME), "{ torn\n", "utf8");
    expect(store.records()).toHaveLength(1);
    expect(store.status().unreadableRows).toBe(1);
  });

  it("exposes candidates and priors from what it holds", () => {
    const root = makeRoot();
    const store = new CaseStore({ rootDir: root, now: () => LATER });
    for (const caseId of ["case-1", "case-2"]) {
      store.openCase({ caseId, at: AT, trigger: "x", affectedComponents: ["providers"] });
      store.append({ caseId, at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "PROVIDER_TIMEOUT_SPIKE", 0.7)], selectedHypothesisId: "hypothesis:providers:PROVIDER_TIMEOUT_SPIKE" } });
      store.append({ caseId, at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "providers" } });
    }
    expect(store.lessonCandidates()).toHaveLength(1);
    expect(store.priorEvidence({ componentId: "providers" })).toHaveLength(2);
    expect(new CaseStore({ rootDir: makeRoot() }).status().cases).toBe(0);
  });
});
