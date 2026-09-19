import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CASE_LOG_FILENAME,
  CaseStore
} from "../../../electron/self-case-record/case-store";
import {
  UNKNOWN_PROVENANCE,
  TREATMENT_SOURCES,
  CASE_INCIDENT_CLASSES,
  type CaseIncidentClass,
  type CaseProvenance,
  type CaseTimeline,
  type SelfDiagnosisCase,
  unknownProvenance
} from "../../../src/shared/self-case-record/case";
import { appendEvent, foldCase, openCase } from "../../../src/shared/self-case-record/timeline";
import {
  DOGFOOD_METRICS_SCHEMA_VERSION,
  HEADLINE_INCIDENT_CLASS,
  dogfoodMetrics,
  policyDefectReports,
  protocolViolationsOf,
  type CaseProtocolViolation,
  type DogfoodMetrics,
  type SelfDiagnosisPolicyDefectReport
} from "../../../src/shared/self-case-record/dogfood";
import { HIGH_CONFIDENCE_THRESHOLD } from "../../../src/shared/self-diagnosis/policy";
import type { DiagnosisHypothesis } from "../../../src/shared/self-diagnosis/hypotheses";
import type { TreatmentProposal } from "../../../src/shared/self-diagnosis/treatment";

/**
 * Dogfood metrics, case provenance, and the separation from state-core.
 *
 * Three claims:
 *
 *   - a case says which body and which diagnosis rules judged it, and can say that it does not know;
 *   - the metric that matters most is a refuted HIGH-CONFIDENCE claim, and the threshold it is
 *     counted against comes from the diagnosis policy rather than being re-declared here;
 *   - the case log is a diagnostic evidence store, not a second authoritative event journal.
 */

const AT = "2026-09-20T10:00:00.000Z";
const LATER = "2026-09-20T11:00:00.000Z";
const REPO = path.resolve(__dirname, "..", "..", "..");
const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-dogfood-"));
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

const PROVENANCE: CaseProvenance = {
  selfModelVersion: "self-model-v1",
  selfModelHash: "c".repeat(64),
  diagnosisEngineVersion: "self-diagnosis-engine-v1",
  diagnosisPolicyHash: "d".repeat(64),
  source: "self-diagnosis.cjs"
};

function hypothesis(componentId: string, confidence: number, missing = 0): DiagnosisHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: `hypothesis:${componentId}`,
    suspectedComponent: componentId,
    failureMode: "PROVIDER_TIMEOUT_SPIKE",
    role: "ROOT_CAUSE",
    supportingEvidence: [],
    contradictingEvidence: [],
    confidence,
    affectedComponents: [],
    affectedCapabilities: [],
    blastRadius: 0,
    alternativeHypotheses: [],
    missingEvidence: Array.from({ length: missing }, (_, index) => `missing-${index}`),
    source: "self-diagnosis"
  };
}

const PROPOSAL: TreatmentProposal = {
  schemaVersion: 1,
  kind: "TREATMENT_PROPOSAL",
  proposalId: "treatment:hypothesis:providers",
  treatment: "RETRY",
  targetComponent: "providers",
  hypothesisId: "hypothesis:providers",
  risk: "LOW",
  expectedBenefit: "one more attempt",
  riskDetail: "a persistent failure would be retried into the same wall",
  blastRadius: 1,
  reversible: true,
  requiredAuthority: "AUTONOMOUS_CANDIDATE",
  executable: false,
  reason: "a suggestion"
};

/** A case walked to a disposition, as the CLI would record it. */
function caseTo(input: { caseId: string; hypotheses: DiagnosisHypothesis[]; validation?: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE"; rootCause?: string; disposition?: string; proposalUsed?: boolean }): SelfDiagnosisCase {
  const opened = openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId: input.caseId, at: AT, trigger: "a reading over its limit", affectedComponents: ["providers"] });
  let timeline = opened.timeline as CaseTimeline;
  timeline = appendEvent(timeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: input.hypotheses, selectedHypothesisId: input.hypotheses[0]?.hypothesisId, reason: "the candidates as ranked" } }).timeline as CaseTimeline;
  timeline = appendEvent(timeline, { at: AT, type: "TREATMENT_PROPOSED", detail: { proposals: [PROPOSAL] } }).timeline as CaseTimeline;
  if (input.proposalUsed === true) {
    timeline = appendEvent(timeline, { at: LATER, type: "TREATMENT_PERFORMED", detail: { proposalId: PROPOSAL.proposalId, treatment: "RETRY", performedBy: "OWNER", outcome: "the run succeeded", reversible: true } }).timeline as CaseTimeline;
  }
  if (input.validation !== undefined) {
    timeline = appendEvent(timeline, { at: LATER, type: "VALIDATION_ADDED", detail: { verdict: input.validation, evidence: ["observed for a day"], observedBy: "an owner" } }).timeline as CaseTimeline;
  }
  timeline = appendEvent(timeline, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: input.disposition ?? "RESOLVED", ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }) } }).timeline as CaseTimeline;
  const folded = foldCase(timeline);
  if (!folded.ok || folded.case === undefined) throw new Error(folded.problems.join("; "));
  return folded.case;
}

describe("a case says which body and which rules judged it", () => {
  it("records provenance at open and keeps it through the fold", () => {
    const opened = openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId: "case-1", at: AT, trigger: "x" });
    const record = opened.case as SelfDiagnosisCase;
    expect(record.provenance).toEqual(PROVENANCE);
    expect(record.provenance.selfModelHash).toHaveLength(64);
    expect(record.provenance.diagnosisEngineVersion).toBe("self-diagnosis-engine-v1");
    // It is an opening fact: a later event cannot change it.
    const later = appendEvent(opened.timeline as CaseTimeline, { at: LATER, type: "OBSERVATION_ADDED", detail: { detail: "something else happened" } });
    expect((later.case as SelfDiagnosisCase).provenance).toEqual(PROVENANCE);
  });

  it("accepts an explicit UNKNOWN and refuses a blank", () => {
    const unknown = unknownProvenance("self-diagnosis.cjs with no checkout to read");
    expect(unknown.selfModelHash).toBe(UNKNOWN_PROVENANCE);
    expect(openCase({ provenance: unknown, incidentClass: "REAL_INCIDENT", caseId: "case-2", at: AT, trigger: "x" }).ok).toBe(true);
    const blank = openCase({ provenance: { ...PROVENANCE, selfModelHash: "  " }, incidentClass: "REAL_INCIDENT", caseId: "case-3", at: AT, trigger: "x" });
    expect(blank.ok).toBe(false);
    expect(blank.problems.join(" ")).toContain("names no selfModelHash");
    expect(blank.problems.join(" ")).toContain("never left blank");
  });
});

describe("the dogfood metrics count accuracy, not activity", () => {
  it("counts a refuted high-confidence claim as the error that matters", () => {
    const confirmed = caseTo({ caseId: "case-1", hypotheses: [hypothesis("providers", 0.85), hypothesis("tasks", 0.4)], validation: "CONFIRMED", rootCause: "providers", proposalUsed: true });
    const refuted = caseTo({ caseId: "case-2", hypotheses: [hypothesis("providers", 0.9)], validation: "REFUTED", rootCause: "tasks" });
    const careful = caseTo({ caseId: "case-3", hypotheses: [hypothesis("providers", 0.2, 1)] });
    const metrics: DogfoodMetrics = dogfoodMetrics({ cases: [confirmed, refuted, careful], at: LATER });
    expect(metrics.kind).toBe("SELF_DIAGNOSIS_DOGFOOD_METRICS");
    expect(metrics.schemaVersion).toBe(DOGFOOD_METRICS_SCHEMA_VERSION);
    expect(metrics.casesOpened).toBe(3);
    expect(metrics.casesClosed).toBe(3);
    expect(metrics.rootCause.confirmed).toBe(1);
    expect(metrics.rootCause.refuted).toBe(1);
    expect(metrics.rootCause.inconclusive).toBe(1);
    // The high-confidence refuted claim is the one error, and it is named.
    expect(metrics.falseHighConfidenceDiagnoses).toBe(1);
    expect(metrics.highConfidenceThreshold).toBe(HIGH_CONFIDENCE_THRESHOLD);
    expect(metrics.notes.join(" ")).toContain("this is the metric to watch");
    // The careful case named no root cause and never claimed one, so its uncertainty was kept.
    expect(metrics.unknownCorrectlyPreserved).toBe(1);
    expect(metrics.missingEvidenceCases).toBe(1);
    expect(metrics.treatmentProposals).toBe(3);
    expect(metrics.treatmentProposalsUsed).toBe(1);
    expect(metrics.top1DiagnosisConfirmed).toBe(1);
    expect(metrics.top3ContainedRootCause).toBe(1);
  });

  it("says that an empty denominator is not a zero result", () => {
    const metrics = dogfoodMetrics({ cases: [], at: LATER });
    expect(metrics.casesOpened).toBe(0);
    expect(metrics.falseHighConfidenceDiagnoses).toBe(0);
    expect(metrics.notes.join(" ")).toContain("no real incident has been closed yet, so no accuracy metric has a denominator and none of them is reported as zero");
    expect(metrics.notes.join(" ")).toContain("no treatment has been proposed yet");
  });

  it("carries a definition for every metric it reports", () => {
    const metrics = dogfoodMetrics({ cases: [], at: LATER });
    const expected = ["casesOpened", "casesClosed", "rootCauseConfirmed", "rootCauseRefuted", "rootCauseInconclusive", "top1DiagnosisConfirmed", "top3ContainedRootCause", "missingEvidenceCases", "treatmentProposals", "treatmentProposalsUsed", "recurrentCases", "falseHighConfidenceDiagnoses", "unknownCorrectlyPreserved"];
    for (const key of expected) expect(metrics.definitions[key], `${key} must be defined`).toBeTruthy();
    expect(metrics.definitions.falseHighConfidenceDiagnoses).toContain(String(HIGH_CONFIDENCE_THRESHOLD));
    expect(metrics.definitions.treatmentProposalsUsed).toContain("never by this plane");
  });

  it("counts a recurrence and reads the metrics off the store", () => {
    const store = new CaseStore({ rootDir: makeRoot(), now: () => LATER });
    for (const caseId of ["case-1", "case-2"]) {
      store.openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId, at: AT, trigger: "x", affectedComponents: ["providers"] });
      store.append({ caseId, at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", 0.9)], selectedHypothesisId: "hypothesis:providers" } });
      store.append({ caseId, at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "providers" } });
    }
    store.append({ caseId: "case-2", at: LATER, type: "RECURRENCE_LINKED", detail: { caseIds: ["case-1"] } });
    const metrics = store.dogfood();
    expect(metrics.recurrentCases).toBe(1);
    expect(metrics.casesOpened).toBe(2);
    expect(metrics.falseHighConfidenceDiagnoses).toBe(0);
    expect(metrics.rootCause.inconclusive).toBe(2);
  });
});

describe("the dogfood protocol: real incidents only, first pass frozen, nothing tuned", () => {
  it("counts only real incidents in the headline and names the rest", () => {
    const real = caseTo({ caseId: "real-1", hypotheses: [hypothesis("providers", 0.9)], validation: "CONFIRMED", rootCause: "providers" });
    const fixture = caseTo({ caseId: "fixture-1", hypotheses: [hypothesis("providers", 0.9)], validation: "REFUTED", rootCause: "tasks" });
    const fixtureAsRetrospective: SelfDiagnosisCase = { ...fixture, caseId: "fixture-2", incidentClass: "RETROSPECTIVE_FIXTURE" };
    const metrics = dogfoodMetrics({ cases: [real, { ...fixture, incidentClass: "DEVELOPMENT_TEST" }, fixtureAsRetrospective], at: LATER });
    expect(metrics.casesOpened).toBe(1);
    expect(metrics.casesClosed).toBe(1);
    expect(metrics.excludedByIncidentClass).toEqual({ DEVELOPMENT_TEST: 1, RETROSPECTIVE_FIXTURE: 1 });
    expect(metrics.notes.join(" ")).toContain("2 case(s) are fixtures or tests and are excluded from every headline figure");
    // The excluded refuted claim does not reach the safety metric.
    expect(metrics.falseHighConfidenceDiagnoses).toBe(0);
    expect(HEADLINE_INCIDENT_CLASS).toBe("REAL_INCIDENT");
    expect(CASE_INCIDENT_CLASSES).toEqual(["REAL_INCIDENT", "RETROSPECTIVE_FIXTURE", "DEVELOPMENT_TEST"]);
    expect(TREATMENT_SOURCES).toEqual(["OWNER", "HNS", "EXTERNAL_SYSTEM"]);
  });

  it("scores the FIRST PASS, so a later revision cannot make a wrong claim look right", () => {
    // The first pass named providers at 0.9; the investigation later found tasks. Scoring the
    // latest revision would award top-1 to a diagnosis that had already seen the answer.
    const opened = openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId: "case-1", at: AT, trigger: "a reading over its limit" });
    let timeline = opened.timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", 0.9)], selectedHypothesisId: "hypothesis:providers", reason: "FIRST_PASS: before any investigation" } }).timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: LATER, type: "HYPOTHESIS_REVISED", detail: { hypotheses: [hypothesis("tasks", 0.95)], selectedHypothesisId: "hypothesis:tasks", reason: "the ledger evidence arrived" } }).timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: LATER, type: "VALIDATION_ADDED", detail: { verdict: "CONFIRMED", evidence: ["the ledger was the cause"], observedBy: "HNS" } }).timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "tasks" } }).timeline as CaseTimeline;
    const folded = foldCase(timeline);
    expect(folded.ok).toBe(true);
    const record = folded.case as SelfDiagnosisCase;
    expect(record.firstPass?.hypotheses[0].suspectedComponent).toBe("providers");
    expect(record.firstPass?.reason).toContain("FIRST_PASS");
    expect(record.diagnosesConsidered).toHaveLength(2);
    const metrics = dogfoodMetrics({ cases: [record], at: LATER });
    expect(metrics.casesClosed).toBe(1);
    expect(metrics.rootCause.confirmed).toBe(1);
    // The first pass was wrong, and both numbers say so.
    expect(metrics.top1DiagnosisConfirmed).toBe(0);
    expect(metrics.top3ContainedRootCause).toBe(0);
    expect(metrics.falseHighConfidenceDiagnoses).toBe(1);
  });

  it("flags a first pass that arrived after the investigation", () => {
    const opened = openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId: "case-late", at: AT, trigger: "x" });
    let timeline = opened.timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: AT, type: "VALIDATION_ADDED", detail: { verdict: "CONFIRMED", evidence: ["we already knew"], observedBy: "HNS" } }).timeline as CaseTimeline;
    timeline = appendEvent(timeline, { at: LATER, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", 0.9)], selectedHypothesisId: "hypothesis:providers" } }).timeline as CaseTimeline;
    const record = foldCase(timeline).case as SelfDiagnosisCase;
    const violations: CaseProtocolViolation[] = protocolViolationsOf(record, timeline.events);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe("FIRST_PASS_AFTER_INVESTIGATION");
    expect(violations[0].detail).toContain("could have seen the answer");
    const metrics = dogfoodMetrics({ cases: [record], at: LATER, eventsByCase: { "case-late": timeline.events } });
    expect(metrics.protocolViolations).toHaveLength(1);
    expect(metrics.notes.join(" ")).toContain("protocol violation(s)");
    // A case with no revision at all is a violation too, rather than an empty pass.
    const bare = openCase({ provenance: PROVENANCE, incidentClass: "REAL_INCIDENT", caseId: "case-bare", at: AT, trigger: "x" }).case as SelfDiagnosisCase;
    expect(protocolViolationsOf(bare)[0].violation).toBe("FIRST_PASS_MISSING");
  });

  it("writes a defect report for a refuted claim and tunes nothing", () => {
    const refuted = caseTo({ caseId: "case-1", hypotheses: [hypothesis("providers", 0.9)], validation: "REFUTED", rootCause: "tasks" });
    const confirmed = caseTo({ caseId: "case-2", hypotheses: [hypothesis("providers", 0.85)], validation: "CONFIRMED", rootCause: "providers" });
    const fixture = { ...caseTo({ caseId: "case-3", hypotheses: [hypothesis("providers", 0.9)], validation: "REFUTED", rootCause: "tasks" }), incidentClass: "DEVELOPMENT_TEST" as const };
    const reports: SelfDiagnosisPolicyDefectReport[] = policyDefectReports({ cases: [refuted, confirmed, fixture], at: LATER, engineVersion: "self-diagnosis-engine-v1", policyHash: "e".repeat(64) });
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.kind).toBe("SELF_DIAGNOSIS_POLICY_DEFECT_REPORT");
    expect(report.failureMode).toBe("FALSE_HIGH_CONFIDENCE_DIAGNOSIS");
    expect(report.caseIds).toEqual(["case-1"]);
    expect(report.claimedComponents).toEqual(["providers"]);
    expect(report.actualRootCauses).toEqual(["tasks"]);
    expect(report.highConfidenceThreshold).toBe(HIGH_CONFIDENCE_THRESHOLD);
    expect(report.evidence[0]).toContain("the first pass named providers at confidence 0.9 and the case settled on tasks");
    expect(report.candidateHypothesis).toContain("over-weighting");
    expect(report.expectedTradeoff).toContain("only worth making from several cases rather than one");
    // A report proposes: it cannot mutate a policy and it goes to an owner.
    expect(report.mutatesPolicy).toBe(false);
    expect(report.requiresOwnerReview).toBe(true);
    expect(report.note).toContain("recorded, not acted on");
    expect(report.engineVersion).toBe("self-diagnosis-engine-v1");
    expect(report.policyHash).toBe("e".repeat(64));
    // Two cases about the same component make the defect severe rather than one-off.
    const repeated = policyDefectReports({ cases: [refuted, { ...caseTo({ caseId: "case-4", hypotheses: [hypothesis("providers", 0.8)], validation: "REFUTED", rootCause: "tasks" }) }], at: LATER, engineVersion: "self-diagnosis-engine-v1", policyHash: "e".repeat(64) });
    expect(repeated[0].severity).toBe("HIGH");
    expect(repeated[0].caseIds).toEqual(["case-1", "case-4"]);
    // Nothing to report when the claim held.
    expect(policyDefectReports({ cases: [confirmed], at: LATER, engineVersion: "v", policyHash: "h" })).toEqual([]);
  });
});

describe("the case log is not a second state-core journal", () => {
  const pure = ["case.ts", "timeline.ts", "recurrence.ts", "dogfood.ts"];
  const code = [
    ...pure.map((name) => fs.readFileSync(path.join(REPO, "src", "shared", "self-case-record", name), "utf8")),
    fs.readFileSync(path.join(REPO, "electron", "self-case-record", "case-store.ts"), "utf8")
  ].join("\n");

  it("names no part of state-core and claims no journal authority", () => {
    for (const token of ["state-core", "event-journal", "state.journal", "state.db", "StateRepository", "withTransaction", "consumer-cursor", "idempotencyKey", "aggregateId"]) {
      expect(code.includes(token), `${token} belongs to state-core, not to the case record`).toBe(false);
    }
    // No claim of being a source of truth, and no dispatch: it records evidence and reports it.
    for (const token of ["sourceOfTruth", "authoritative journal", "authoritativeJournal", "publish(", "dispatch(", "replay(", "cursor("]) {
      expect(code.includes(token), `${token} would be a journal, not an evidence store`).toBe(false);
    }
    // The one place the two could be confused is the word "journal": the case record has none.
    expect(code.includes("journal")).toBe(false);
  });

  it("is not referenced by state-core, and does not write a state-core path", () => {
    const stateCoreRoot = path.join(REPO, "electron", "state-core");
    for (const name of fs.readdirSync(stateCoreRoot)) {
      const text = fs.readFileSync(path.join(stateCoreRoot, name), "utf8");
      expect(text.includes("self-case-record"), `electron/state-core/${name} must not know about the case record`).toBe(false);
      expect(text.includes(CASE_LOG_FILENAME), `electron/state-core/${name} must not write the case log`).toBe(false);
    }
    // The log lives under whatever root the caller hands in, and its name is not a state path.
    expect(CASE_LOG_FILENAME).toBe("case-record.jsonl");
    const store = new CaseStore({ rootDir: makeRoot(), now: () => AT });
    expect(store.status().file.endsWith(CASE_LOG_FILENAME)).toBe(true);
    expect(store.status().file.includes("state")).toBe(false);
  });
});
