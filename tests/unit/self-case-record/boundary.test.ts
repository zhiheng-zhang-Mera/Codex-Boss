import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CASE_LOG_FILENAME,
  CaseStore
} from "../../../electron/self-case-record/case-store";
import {
  appendEvent,
  foldCase,
  openCase
} from "../../../src/shared/self-case-record/timeline";
import { priorEvidenceOf } from "../../../src/shared/self-case-record/recurrence";
import type { CaseTimeline, SelfDiagnosisCase } from "../../../src/shared/self-case-record/case";
import type { DiagnosisHypothesis } from "../../../src/shared/self-diagnosis/hypotheses";

/**
 * The case-record boundary.
 *
 * `CAN_RECORD = YES`, `CAN_REWRITE_HISTORY = NO`, `CAN_EXECUTE_TREATMENT = NO` — and, from the
 * brief, `CASE_RECORD does not diagnose autonomously`, `does not execute repair`, and `does not
 * redefine current self model`. Each of those is checked structurally here rather than asserted in
 * prose.
 */

const AT = "2026-09-20T10:00:00.000Z";
const LATER = "2026-09-20T11:00:00.000Z";
const REPO = path.resolve(__dirname, "..", "..", "..");
const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-case-boundary-"));
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

function hypothesis(componentId: string, failureMode: string): DiagnosisHypothesis {
  return { schemaVersion: 1, hypothesisId: `hypothesis:${componentId}:${failureMode}`, suspectedComponent: componentId, failureMode, role: "ROOT_CAUSE", supportingEvidence: [], contradictingEvidence: [], confidence: 0.7, affectedComponents: [], affectedCapabilities: [], blastRadius: 0, alternativeHypotheses: [], missingEvidence: [], source: "test" };
}

describe("the case record can record, and only record", () => {
  const pureModules = ["case.ts", "timeline.ts", "recurrence.ts"];
  const code = pureModules
    .map((name) => fs.readFileSync(path.join(REPO, "src", "shared", "self-case-record", name), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("writes nothing and executes nothing in its pure modules", () => {
    expect(/from "node:fs"/.test(code)).toBe(false);
    for (const call of ["writeFileSync", "appendFileSync", "rmSync", "unlinkSync", "mkdirSync", "renameSync", "child_process", "execSync", "spawn"]) {
      expect(code.includes(call), `${call} must not appear in the pure case-record modules`).toBe(false);
    }
    for (const verb of ["execute", "perform", "diagnose", "repair"]) {
      expect(new RegExp(`export (function|const) \\w*${verb}`, "i").test(code), `no ${verb} export`).toBe(false);
    }
    // The record copies what a diagnosis said; it does not produce one.
    expect(/\bdiagnose\s*\(/.test(code)).toBe(false);
  });

  it("does not know the self model exists, so it cannot redefine it", () => {
    // The strongest form of "does not redefine current self model" is not importing it at all.
    expect(code.includes("self-cognition")).toBe(false);
    const store = fs.readFileSync(path.join(REPO, "electron", "self-case-record", "case-store.ts"), "utf8");
    expect(store.includes("self-cognition")).toBe(false);
  });

  it("offers no way to rewrite a timeline once it is written", () => {
    const store = new CaseStore({ rootDir: makeRoot(), now: () => AT });
    const names = new Set<string>();
    let prototype: object | null = Object.getPrototypeOf(store) as object | null;
    while (prototype !== null && prototype !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    for (const forbidden of ["update", "delete", "remove", "rewrite", "replace", "reset", "clear", "truncate", "execute", "apply", "treat", "repair", "diagnose"]) {
      expect([...names], `${forbidden} would let the store rewrite what it recorded`).not.toContain(forbidden);
    }
    for (const name of ["openCase", "append", "records", "record", "timelines", "status", "lessonCandidates", "priorEvidence"]) {
      expect([...names], `the store must expose ${name}`).toContain(name);
    }
  });

  it("grows by one row per event and never rewrites an earlier row", () => {
    const root = makeRoot();
    const store = new CaseStore({ rootDir: root, now: () => AT });
    store.openCase({ caseId: "case-1", trigger: "x" });
    const afterFirst = fs.readFileSync(path.join(root, CASE_LOG_FILENAME), "utf8");
    store.append({ caseId: "case-1", type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "PROVIDER_TIMEOUT_SPIKE")] } });
    store.append({ caseId: "case-1", type: "CASE_RESOLVED", detail: { disposition: "RESOLVED" } });
    const afterAll = fs.readFileSync(path.join(root, CASE_LOG_FILENAME), "utf8");
    // The first row is byte-identical: appending did not rewrite it.
    expect(afterAll.startsWith(afterFirst)).toBe(true);
    expect(afterAll.split(/\r?\n/).filter((line) => line.trim() !== "")).toHaveLength(3);
  });

  it("does not mutate the timeline it folds", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const timeline = opened.timeline as CaseTimeline;
    const withRevision = appendEvent(timeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "CACHE_STALE")] } }).timeline as CaseTimeline;
    const before = JSON.stringify(withRevision);
    const first = foldCase(withRevision);
    const second = foldCase(withRevision);
    expect(JSON.stringify(withRevision)).toBe(before);
    expect(JSON.stringify(first.case)).toBe(JSON.stringify(second.case));
    // The input timeline of the first append is untouched too, which is what append-only means.
    expect(timeline.events).toHaveLength(1);
  });

  it("hands out evidence about the past in a shape that is not an observation", () => {
    const opened = openCase({ caseId: "case-1", at: AT, trigger: "x" });
    const diagnosed = appendEvent(opened.timeline as CaseTimeline, { at: AT, type: "HYPOTHESIS_ADDED", detail: { hypotheses: [hypothesis("providers", "CACHE_STALE")] } }).timeline as CaseTimeline;
    const resolved = appendEvent(diagnosed, { at: LATER, type: "CASE_RESOLVED", detail: { disposition: "RESOLVED", rootCause: "providers" } }).timeline as CaseTimeline;
    const record = foldCase(resolved).case as SelfDiagnosisCase;
    const priors = priorEvidenceOf({ cases: [record], componentId: "providers" });
    expect(priors).toHaveLength(1);
    // A prior has no status and no measurement: it cannot be mistaken for a reading about now.
    expect(Object.keys(priors[0]).sort()).toEqual(["caseId", "closedAt", "componentId", "failureMode", "finalDisposition"]);
    expect(JSON.stringify(priors)).not.toContain("measurement");
  });
});
