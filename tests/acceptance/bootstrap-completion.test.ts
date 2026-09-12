/**
 * checkpoint-1 §57/§58 (checkpoint-18) — Bootstrap Completion audit acceptance
 * (BC-01..BC-06). The audit reads the reports the delivery chain's gates wrote; the
 * acceptance drives it with a real report set on disk and with hostile ones.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBootstrapAuditor, REPORT_FILES, BOOTSTRAP_AUDIT_RECORD } from "../../electron/engineering/bootstrap-completion";
import { auditBootstrap, auditGate, DESKTOP_BLACK_BOX, GATE_REQUIREMENTS } from "../../src/shared/bootstrap-audit";
import { CRITICAL_CAPABILITIES } from "../../src/shared/final-acceptance";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-bootstrap-audit-"));
const ARTIFACTS = path.join(ROOT, "artifacts", "acceptance");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");

type Verdict = "PASS" | "FAIL" | "NOT_RUN";
interface Observation { claim: string; expected: string; observed: string; ok: boolean; }
interface RequirementResult { id: string; title: string; verdict: Verdict; observations: Observation[]; evidence: string[]; notes?: string; }

class Item {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}
  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  cite(pointer: string): void { if (!this.evidence.includes(pointer)) this.evidence.push(pointer); }
  fail(reason: string): void { this.failure = reason; }
  get ok(): boolean { return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok); }
  result(): RequirementResult {
    const result: RequirementResult = { id: this.id, title: this.title, verdict: this.ok ? "PASS" : "FAIL", observations: this.observations, evidence: this.evidence };
    if (this.failure) result.notes = this.failure;
    return result;
  }
}
const results: RequirementResult[] = [];
async function scenario(id: string, title: string, body: (item: Item) => Promise<void> | void): Promise<void> {
  const item = new Item(id, title);
  try { await body(item); }
  catch (error) { item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`); }
  results.push(item.result());
}

/** Writes a report set where every required id passes. */
function writeCleanReports(): void {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const [gate, file] of Object.entries(REPORT_FILES)) {
    const ids = [...(GATE_REQUIREMENTS[gate] ?? [])];
    const requirementResults = ids.map((id) => ({ id, verdict: "PASS" }));
    // The desktop black box reports its own claim ids.
    if (gate === DESKTOP_BLACK_BOX) requirementResults.push({ id: "DB-01", verdict: "PASS" });
    fs.writeFileSync(path.join(ARTIFACTS, file), JSON.stringify({
      schemaVersion: 1,
      unit: gate.toLocaleUpperCase().replace(/-/g, "_"),
      requirementResults,
      totals: { pass: requirementResults.length, fail: 0, notRun: 0 },
      passed: true,
      owner_interventions: 0
    }, null, 2), "utf8");
  }
}
writeCleanReports();
const auditor = () => createBootstrapAuditor({ root: ROOT, artifacts: ARTIFACTS });
const shared: Record<string, unknown> = {};

describe("checkpoint-18 §57/§58 Bootstrap Completion audit", () => {
  it("BC-01 every gate is audited against the ids it must have passed", async () => {
    await scenario("BC-01", "§58 the chain's gates", async (item) => {
      item.check("sixteen gates plus the black box are audited", 17, Object.keys(GATE_REQUIREMENTS).length + 1);
      item.check("every gate names its report file", true, Object.keys(GATE_REQUIREMENTS).every((gate) => (REPORT_FILES[gate] ?? "").endsWith(".json")));
      const missing = auditGate("acceptance-verify", undefined, GATE_REQUIREMENTS["acceptance-verify"]!.slice(0, 2));
      item.check("a gate with no report is MISSING", "MISSING", missing.verdict);
      item.check("and names every id it owes", 2, missing.missing_ids.length);
      const failed = auditGate("acceptance-verify", { requirementResults: [{ id: "V-01", verdict: "FAIL" }, { id: "V-02", verdict: "PASS" }] }, ["V-01", "V-02"]);
      item.check("a failed id fails the gate", "FAIL", failed.verdict);
      item.check("and the reason names it", true, failed.reasons[0]?.includes("V-01"));
      shared.bc01 = { gates: Object.keys(GATE_REQUIREMENTS).length };
      item.cite("auditGate");
    });
  });

  it("BC-02 a complete report set yields BOOTSTRAP_COMPLETE", async () => {
    await scenario("BC-02", "§57/§58 the verdict", async (item) => {
      const outcome = auditor().evaluate({ owner_interventions: 0 });
      item.check("every gate passed", outcome.audit.gates_passed, outcome.audit.gates_required);
      item.check("the desktop black box passed", "PASS", outcome.audit.desktop.verdict);
      item.check("every capability is established", true, outcome.audit.capability_evidence.every((entry) => entry.established));
      item.check("the decision is BOOTSTRAP_COMPLETE", "BOOTSTRAP_COMPLETE", outcome.audit.decision);
      item.check("no Owner intervention was needed", 0, outcome.audit.owner_interventions);
      item.check("the audit is hashed", true, /^[0-9a-f]{64}$/.test(outcome.audit.hash));
      item.check("the record is durable", true, fs.existsSync(path.join(ARTIFACTS, BOOTSTRAP_AUDIT_RECORD)));
      item.check("all seventeen reports were found", 17, outcome.reports.filter((entry) => entry.present).length);
      shared.bc02 = { decision: outcome.audit.decision, gates: outcome.audit.gates_passed };
      item.cite(path.join(ARTIFACTS, BOOTSTRAP_AUDIT_RECORD));
    });
  });

  it("BC-03 a missing gate report means INCOMPLETE", async () => {
    await scenario("BC-03", "§58 a gate that wrote nothing", async (item) => {
      const file = path.join(ARTIFACTS, REPORT_FILES["acceptance-publish"]!);
      const saved = fs.readFileSync(file, "utf8");
      fs.rmSync(file);
      const outcome = auditor().evaluate({ owner_interventions: 0 });
      item.check("the decision is INCOMPLETE", "INCOMPLETE", outcome.audit.decision);
      item.check("the missing gate is named", true, outcome.audit.gates.some((gate) => gate.gate === "acceptance-publish" && gate.verdict === "MISSING"));
      item.check("and its capability is not established", true, outcome.audit.capability_evidence.some((entry) => entry.capability === "GitHub publishing" && !entry.established));
      fs.writeFileSync(file, saved, "utf8");
      shared.bc03 = { decision: outcome.audit.decision };
      item.cite("a deleted report");
    });
  });

  it("BC-04 a partially green report is not a pass", async () => {
    await scenario("BC-04", "§58 ids, not vibes", async (item) => {
      const file = path.join(ARTIFACTS, REPORT_FILES["acceptance-ci-repair"]!);
      const saved = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(saved) as { requirementResults: { id: string; verdict: string }[] };
      parsed.requirementResults = parsed.requirementResults.map((entry) => entry.id === "CR-07" ? { id: "CR-07", verdict: "NOT_RUN" } : entry);
      fs.writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
      const outcome = auditor().evaluate();
      item.check("the gate fails", true, outcome.audit.gates.some((gate) => gate.gate === "acceptance-ci-repair" && gate.verdict === "FAIL"));
      item.check("the id is named", true, outcome.audit.gates.find((gate) => gate.gate === "acceptance-ci-repair")?.missing_ids.includes("CR-07"));
      item.check("so the decision is INCOMPLETE", "INCOMPLETE", outcome.audit.decision);
      fs.writeFileSync(file, saved, "utf8");
      shared.bc04 = { decision: outcome.audit.decision };
      item.cite("a NOT_RUN id");
    });
  });

  it("BC-05 an Owner intervention forbids completion", async () => {
    await scenario("BC-05", "§57 no human engineering", async (item) => {
      const outcome = auditor().evaluate({ owner_interventions: 1 });
      item.check("the intervention is recorded", 1, outcome.audit.owner_interventions);
      item.check("the decision is INCOMPLETE", "INCOMPLETE", outcome.audit.decision);
      item.check("and the reason says the black box forbids it", true, outcome.audit.reasons.some((reason) => reason.includes("forbids them")));
      item.check("the pure audit agrees", "INCOMPLETE", auditBootstrap({ reports: {}, owner_interventions: 2 }).decision);
      shared.bc05 = { reasons: outcome.audit.reasons.slice(-1) };
      item.cite("owner_interventions");
    });
  });

  it("BC-06 the thirteen capabilities are each traceable to evidence", async () => {
    await scenario("BC-06", "§43 capability evidence", async (item) => {
      item.check("thirteen capabilities", 13, CRITICAL_CAPABILITIES.length);
      const outcome = auditor().evaluate({ owner_interventions: 0 });
      item.check("every capability maps to at least one gate", true, outcome.audit.capability_evidence.every((entry) => entry.gates.length > 0));
      item.check("the theme capability includes the real black box", true, outcome.audit.capability_evidence.find((entry) => entry.capability === "theme engine")?.gates.includes(DESKTOP_BLACK_BOX));
      item.check("the completion verdict is complete", true, outcome.audit.completion.complete);
      const empty = auditBootstrap({ reports: {} });
      item.check("with no reports nothing is established", 0, empty.capability_evidence.filter((entry) => entry.established).length);
      item.check("and the decision is INCOMPLETE", "INCOMPLETE", empty.decision);
      shared.bc06 = { capabilities: outcome.audit.capability_evidence.length, complete: outcome.audit.completion.complete };
      item.cite("capability_evidence");
    });
  });
});

afterAll(() => {
  const recordPath = path.join(ARTIFACTS, BOOTSTRAP_AUDIT_RECORD);
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_18_BOOTSTRAP_COMPLETION",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    bootstrap: fs.existsSync(recordPath)
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { decision: string; gates_passed: number; gates_required: number; owner_interventions: number; capability_evidence: { capability: string; established: boolean }[] };
          return { decision: raw.decision, gates: `${raw.gates_passed}/${raw.gates_required}`, owner_interventions: raw.owner_interventions, capabilities: raw.capability_evidence.filter((entry) => entry.established).length };
        })()
      : undefined,
    audit: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "bootstrap-completion-audit.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "bootstrap-completion-audit.md"), [
    "# checkpoint-1 §57/§58 Bootstrap Completion audit acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Audit: ${report.bootstrap?.decision ?? "-"} (${report.bootstrap?.gates ?? "-"} gates, ${report.bootstrap?.capabilities ?? 0}/13 capabilities, ${report.bootstrap?.owner_interventions ?? 0} Owner interventions)`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Item | Verdict | Observations |",
    "| --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  expect(report.requirementResults.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(report.requirementResults.map((entry) => `${entry.id}:PASS`));
});
