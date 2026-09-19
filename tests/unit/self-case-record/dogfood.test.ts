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
  type CaseProvenance,
  type CaseTimeline,
  type SelfDiagnosisCase,
  unknownProvenance
} from "../../../src/shared/self-case-record/case";
import { appendEvent, foldCase, openCase } from "../../../src/shared/self-case-record/timeline";
import { DOGFOOD_METRICS_SCHEMA_VERSION, dogfoodMetrics, type DogfoodMetrics } from "../../../src/shared/self-case-record/dogfood";
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
  const opened = openCase({ provenance: PROVENANCE, caseId: input.caseId, at: AT, trigger: "a reading over its limit", affectedComponents: ["providers"] });
  let timeline = opened.timeline as CaseTimeline;
  timeline = appendEvent(timeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: input.hypotheses, selectedHypothesisId: input.hypotheses[0]?.hypothesisId, reason: "the candidates as ranked" } }).timeline as CaseTimeline;
  timeline = appendEvent(timeline, { at: AT, type: "TREATMENT_PROPOSED", detail: { proposals: [PROPOSAL] } }).timeline as CaseTimeline;
  if (input.proposalUsed === true) {
    timeline = appendEvent(timeline, { at: LATER, type: "TREATMENT_PERFORMED", detail: { proposalId: PROPOSAL.proposalId, treatment: "RETRY", performedBy: "an owner", outcome: "the run succeeded", reversible: true } }).timeline as CaseTimeline;
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
    const opened = openCase({ provenance: PROVENANCE, caseId: "case-1", at: AT, trigger: "x" });
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
    expect(openCase({ provenance: unknown, caseId: "case-2", at: AT, trigger: "x" }).ok).toBe(true);
    const blank = openCase({ provenance: { ...PROVENANCE, selfModelHash: "  " }, caseId: "case-3", at: AT, trigger: "x" });
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
    expect(metrics.notes.join(" ")).toContain("no case has been closed yet, so no accuracy metric has a denominator and none of them is reported as zero");
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
      store.openCase({ provenance: PROVENANCE, caseId, at: AT, trigger: "x", affectedComponents: ["providers"] });
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
