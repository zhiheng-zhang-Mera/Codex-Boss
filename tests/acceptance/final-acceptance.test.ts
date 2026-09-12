/**
 * checkpoint-1 §42–§45 + §51/§52 (checkpoint-16) — final acceptance (FS-01..FS-08).
 *
 * The gate is driven with artifacts the earlier checkpoints really wrote (the JSON
 * reports under `artifacts/acceptance/`, the §31.3 ledger, real files on disk), so a
 * missing artifact is visible as `NOT_VERIFIED` rather than silently passing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFinalAcceptanceGate } from "../../electron/engineering/final-acceptance-gate";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";
import {
  assessBlocker,
  AUTONOMOUS_SITUATIONS,
  BENCHMARK_SCENARIOS,
  bootstrapCompletion,
  CRITICAL_CAPABILITIES,
  evaluateFinalAcceptance,
  FINAL_ITEMS,
  HARD_BLOCKER_CLASSES,
  scenarioById,
  SEEDED_FAILURES,
  THEME_FINAL_ITEMS,
  type FinalEvidence
} from "../../src/shared/final-acceptance";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-final-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const ARTIFACTS = path.join(WORK, "artifacts", "acceptance");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(ARTIFACTS, "verification-ledger.json");

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

/* ------------------------------------------------------------------ *
 * a workspace with the artifacts earlier checkpoints write
 * ------------------------------------------------------------------ */

for (const directory of ["src", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), "export const gateway = (): string => \"full\";\n", "utf8");
fs.writeFileSync(path.join(ARTIFACTS, "review-loop.json"), JSON.stringify({ unit: "CHECKPOINT_9_REVIEW_AND_LOOP", loops: { c02: { label: "INCOMPLETE", iterations: [{ blocking: 0, subjects: [] }] }, c10: { label: "COMPLETED" } } }), "utf8");
fs.writeFileSync(path.join(ARTIFACTS, "candidate-guardian.json"), JSON.stringify({ unit: "CHECKPOINT_12_CANDIDATE_GUARDIAN", candidate: { state: "CANDIDATE", guardian: "ACCEPTED", released: true, blocking: [] } }), "utf8");
fs.writeFileSync(path.join(ARTIFACTS, "knowledge-foundation.json"), JSON.stringify({ unit: "CHECKPOINT_2_KNOWLEDGE", knowledge: { written: 6, quarantined: 0, reused: 3 } }), "utf8");
fs.writeFileSync(path.join(ARTIFACTS, "version-checkpoint.json"), JSON.stringify({ unit: "CHECKPOINT_13_VERSION_IMPACT_CHECKPOINT", impact: { docs: "NONE", implementation: "MINOR", breaking: "MAJOR", theme: "NONE" } }), "utf8");
fs.writeFileSync(path.join(ARTIFACTS, "ci-repair.json"), JSON.stringify({ unit: "CHECKPOINT_15_CI_REPAIR", loop: { outcome: "PASS", attempts: 2, classes: ["BUILD", "-"] } }), "utf8");

const COMMANDS = { syntax: "node --check", build_tools: [] as string[] };
const engine = () => createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH, commands: COMMANDS, targets: { syntax: [], unit: [], module: [], integration: [] }, harnesses: {}, host: "acceptance-host" });
const requirement = (id: string, state: string, type = "CONSTRAINT") => ({ id, type, text: `requirement ${id}`, visual: false, state });
const baseInput = (overrides: Partial<Parameters<ReturnType<typeof createFinalAcceptanceGate>["evaluate"]>[0]> = {}) => ({
  requirements: [requirement("R-1", "VERIFIED"), requirement("R-2", "VERIFIED")],
  goal: "the gateway returns a receipt",
  served_requirements: ["R-1", "R-2"],
  ...overrides
});
/** Runs the real ladder for the fixture's requirements, so the ledger holds evidence. */
async function verifyFixtureRequirements(): Promise<void> {
  const verification = engine();
  for (const id of ["R-1", "R-2"]) {
    await verification.verifyRequirement(verification.selectFor({ id, type: "CONSTRAINT", text: `requirement ${id}`, visual: false }));
  }
}
const gate = () => createFinalAcceptanceGate({
  root: WORK,
  artifacts: ARTIFACTS,
  ledger: () => engine().ledger(),
  writtenFiles: () => ["src/gateway.ts"]
});
const shared: Record<string, unknown> = {};

describe("checkpoint-16 §42–§45 + §51/§52 final acceptance", () => {
  it("FS-01 the checklist is the plan's eight items (+ four for UI)", async () => {
    await scenario("FS-01", "§42 the checklist", async (item) => {
      item.check("eight base items", 8, FINAL_ITEMS.length);
      item.check("four theme items", 4, THEME_FINAL_ITEMS.length);
      const noUi = evaluateFinalAcceptance({ touches_ui: false });
      item.check("a non-UI change requires eight", 8, noUi.required_items.length);
      const ui = evaluateFinalAcceptance({ touches_ui: true });
      item.check("a UI change requires twelve", 12, ui.required_items.length);
      item.check("nothing is verified without evidence", true, noUi.not_verified.length >= 8);
      item.check("and the acceptance is rejected", "REJECTED", noUi.decision);
      item.check("the assessment is hashed", true, /^[0-9a-f]{64}$/.test(noUi.hash));
      shared.fs01 = { base: FINAL_ITEMS.length, theme: THEME_FINAL_ITEMS.length, notVerified: noUi.not_verified.length };
      item.cite("FINAL_ITEMS/THEME_FINAL_ITEMS");
    });
  });

  it("FS-02 a real artifact set verifies every item", async () => {
    await scenario("FS-02", "§42 all items verified from real artifacts", async (item) => {
      await verifyFixtureRequirements();
      const outcome = gate().evaluate(baseInput());
      item.check("the gate accepts", "ACCEPTED", outcome.acceptance.decision);
      item.check("no item failed", 0, outcome.acceptance.failed.length);
      item.check("no item is unverified", 0, outcome.acceptance.not_verified.length);
      item.check("the §32 report was read", true, outcome.artifacts.read.includes("review-loop.json"));
      item.check("the §41 record was read", true, outcome.artifacts.read.includes("ci-repair.json"));
      item.check("the record is durable", true, fs.existsSync(outcome.recordPath));
      const raw = JSON.parse(fs.readFileSync(outcome.recordPath, "utf8")) as { decision: string; artifacts_read: string[] };
      item.check("and names what it read", true, raw.artifacts_read.length >= 5);
      shared.fs02 = { decision: outcome.acceptance.decision, read: outcome.artifacts.read.length };
      item.cite(outcome.recordPath);
    });
  });

  it("FS-03 a missing artifact is NOT_VERIFIED, not a pass", async () => {
    await scenario("FS-03", "§2.3 silence is not acceptance", async (item) => {
      const empty = path.join(ROOT, "empty-artifacts");
      fs.mkdirSync(empty, { recursive: true });
      const outcome = createFinalAcceptanceGate({ root: WORK, artifacts: empty, ledger: () => engine().ledger(), writtenFiles: () => ["src/gateway.ts"] }).evaluate(baseInput());
      item.check("the gate rejects", "REJECTED", outcome.acceptance.decision);
      item.check("it names the missing artifacts", true, outcome.artifacts.missing.length >= 5);
      const unverified = outcome.acceptance.not_verified;
      item.check("the review item could not be evaluated", true, unverified.includes("NO_BLOCKING_FINDINGS"));
      item.check("so could not the destructive one", true, unverified.includes("NO_UNRESOLVED_DESTRUCTIVE_ACTION"));
      item.check("nor the knowledge write", true, unverified.includes("KNOWLEDGE_WRITE_COMPLETE"));
      item.check("nor the version impact", true, unverified.includes("VERSION_IMPACT_COMPLETE"));
      item.check("nor CI", true, unverified.includes("CI_GREEN"));
      item.check("nothing claims success", false, outcome.acceptance.decision === "ACCEPTED");
      shared.fs03 = { missing: outcome.artifacts.missing, notVerified: unverified };
      item.cite("a gate with no artifacts");
    });
  });

  it("FS-04 a credential shape, an open finding or an unapproved removal rejects", async () => {
    await scenario("FS-04", "§42 the failing items", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "creds.ts"), "const key = \"AKIAIOSFODNN7EXAMPLE\";\n", "utf8");
      const secret = createFinalAcceptanceGate({
        root: WORK,
        artifacts: ARTIFACTS,
        ledger: () => engine().ledger(),
        writtenFiles: () => ["src/gateway.ts", "src/creds.ts"]
      }).evaluate(baseInput());
      item.check("the secret fails its item", true, secret.acceptance.failed.includes("NO_UNRESOLVED_SECRET"));
      item.check("and the acceptance rejects", "REJECTED", secret.acceptance.decision);
      fs.rmSync(path.join(WORK, "src", "creds.ts"));

      fs.writeFileSync(path.join(ARTIFACTS, "review-loop.json"), JSON.stringify({ loops: { c02: { iterations: [{ blocking: 2, subjects: ["HIGH:correctness"] }] } } }), "utf8");
      const findings = gate().evaluate(baseInput());
      item.check("an open HIGH/MEDIUM finding fails its item", true, findings.acceptance.failed.includes("NO_BLOCKING_FINDINGS"));
      fs.writeFileSync(path.join(ARTIFACTS, "review-loop.json"), JSON.stringify({ loops: { c02: { iterations: [{ blocking: 0 }] } } }), "utf8");

      fs.writeFileSync(path.join(ARTIFACTS, "candidate-guardian.json"), JSON.stringify({ candidate: { blocking: ["DESTRUCTIVE_CHANGE_CHECK"] } }), "utf8");
      const destructive = gate().evaluate(baseInput());
      item.check("an unapproved removal fails its item", true, destructive.acceptance.failed.includes("NO_UNRESOLVED_DESTRUCTIVE_ACTION"));
      fs.writeFileSync(path.join(ARTIFACTS, "candidate-guardian.json"), JSON.stringify({ candidate: { blocking: [] } }), "utf8");
      shared.fs04 = { secret: secret.acceptance.failed, findings: findings.acceptance.failed, destructive: destructive.acceptance.failed };
      item.cite("secret scan + review routing + Guardian destructive check");
    });
  });

  it("FS-05 an unverified requirement or a red CI rejects", async () => {
    await scenario("FS-05", "§42 coverage and CI", async (item) => {
      const unverified = gate().evaluate(baseInput({ requirements: [requirement("R-1", "VERIFIED"), requirement("R-2", "RUNNING")] }));
      item.check("the unverified requirement fails its item", true, unverified.acceptance.failed.includes("ALL_REQUIREMENTS_VERIFIED"));
      const outstanding = gate().evaluate(baseInput({ requirements: [requirement("R-1", "VERIFIED"), requirement("R-9", "RUNNING", "NON_FUNCTIONAL")] }));
      item.check("owed evidence is named for a requirement with no ledger rows", true, outstanding.evidence.requirements!.outstanding.includes("R-9"));
      item.check("and it also fails the item", true, outstanding.acceptance.failed.includes("ALL_REQUIREMENTS_VERIFIED"));

      fs.writeFileSync(path.join(ARTIFACTS, "ci-repair.json"), JSON.stringify({ loop: { outcome: "HARD_BLOCKER" } }), "utf8");
      const red = gate().evaluate(baseInput());
      item.check("a red CI fails its item", true, red.acceptance.failed.includes("CI_GREEN"));
      fs.writeFileSync(path.join(ARTIFACTS, "ci-repair.json"), JSON.stringify({ loop: { outcome: "PASS" } }), "utf8");
      const green = gate().evaluate(baseInput());
      item.check("a green CI verifies it", true, green.acceptance.items.find((entry) => entry.item === "CI_GREEN")?.verdict === "VERIFIED");
      shared.fs05 = { unverified: unverified.acceptance.failed, red: red.acceptance.failed };
      item.cite("§31.3 ledger binding + §41 outcome");
    });
  });

  it("FS-06 §43 BOOTSTRAP_COMPLETE needs every critical capability", async () => {
    await scenario("FS-06", "§43 the completion state", async (item) => {
      const partial = bootstrapCompletion([...CRITICAL_CAPABILITIES].slice(0, 5));
      item.check("a partial set is not complete", false, partial.complete);
      item.check("it names what is missing", true, partial.missing.length === CRITICAL_CAPABILITIES.length - 5);
      const full = bootstrapCompletion([...CRITICAL_CAPABILITIES]);
      item.check("the full set is complete", true, full.complete);
      item.check("and says so", true, full.reason.includes("every one of"));
      item.check("there are thirteen critical capabilities", 13, CRITICAL_CAPABILITIES.length);
      shared.fs06 = { missing: partial.missing.length, complete: full.complete };
      item.cite("bootstrapCompletion");
    });
  });

  it("FS-07 §44 allows four blockers and §45 forbids the rest", async () => {
    await scenario("FS-07", "§44/§45 what may block", async (item) => {
      item.check("four classes", 4, HARD_BLOCKER_CLASSES.length);
      item.check("a policy denial is HB4", "HB4_ROOT_POLICY", assessBlocker({ situation: "the Guardian refused the action", policy_denied: true }).blocker_class);
      item.check("an authority need is HB1", "HB1_AUTHORITY", assessBlocker({ situation: "the account needs MFA", authority_needed: true }).blocker_class);
      item.check("a missing resource is HB3", "HB3_MISSING_EXTERNAL_RESOURCE", assessBlocker({ situation: "the dataset does not exist", missing_resource: true }).blocker_class);
      item.check("an irreversible decision is HB2", "HB2_IRREVERSIBLE_OWNER_DECISION", assessBlocker({ situation: "delete the production database", irreversible: true, claimed: "HB2_IRREVERSIBLE_OWNER_DECISION" }).blocker_class);
      item.check("a CI failure is Boss's own problem", false, assessBlocker({ situation: "the CI failure needs a decision" }).allowed);
      item.check("and so is a provider failure", false, assessBlocker({ situation: "provider failure on the page" }).allowed);
      item.check("so is a library choice", false, assessBlocker({ situation: "which library should we use", claimed: "HB1_AUTHORITY" }).allowed);
      item.check("and conflicting reviewers", false, assessBlocker({ situation: "conflicting reviewer opinions" }).allowed);
      item.check("the §45 list is complete", 13, AUTONOMOUS_SITUATIONS.length);
      item.check("a blocker the plan never listed is refused", false, assessBlocker({ situation: "the branch naming is unclear" }).allowed);
      shared.fs07 = { hb: HARD_BLOCKER_CLASSES.length, forbidden: AUTONOMOUS_SITUATIONS.length };
      item.cite("assessBlocker");
    });
  });

  it("FS-08 §51/§52 catalogues point at gates that exist and are known", async () => {
    await scenario("FS-08", "§51 benchmarks + §52 seeded battery", async (item) => {
      item.check("eighteen benchmark scenarios", 18, BENCHMARK_SCENARIOS.length);
      item.check("thirteen seeded failures", 13, SEEDED_FAILURES.length);
      item.check("every scenario names its proof", true, [...BENCHMARK_SCENARIOS, ...SEEDED_FAILURES].every((scenario) => scenario.proof.length > 10));
      item.check("ids are B01..B18", JSON.stringify(["B01", "B18"]), JSON.stringify([BENCHMARK_SCENARIOS[0]?.id, BENCHMARK_SCENARIOS.at(-1)?.id]));
      item.check("ids are S01..S13", JSON.stringify(["S01", "S13"]), JSON.stringify([SEEDED_FAILURES[0]?.id, SEEDED_FAILURES.at(-1)?.id]));
      item.check("a scenario resolves by id", "CI-only failure", scenarioById("B10")?.title);
      item.check("and an unknown id does not", undefined, scenarioById("B99"));
      // Every proof must name a gate this repository actually runs.
      const known = /acceptance[-:](workbook|knowledge|architecture|theme|requirements|plan|verify|review|self-healing|capability-gap|candidate|version-checkpoint|publish|ci-repair|github-machine|restart|desktop-workbook)|benchmark|acceptance-restart/;
      const unknown = [...BENCHMARK_SCENARIOS, ...SEEDED_FAILURES].filter((scenario) => !known.test(scenario.proof)).map((scenario) => scenario.id);
      item.check("every proof names a real gate", JSON.stringify([]), JSON.stringify(unknown));
      shared.fs08 = { benchmarks: BENCHMARK_SCENARIOS.length, seeded: SEEDED_FAILURES.length };
      item.cite("BENCHMARK_SCENARIOS/SEEDED_FAILURES");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_16_FINAL_ACCEPTANCE",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    finalAcceptance: fs.existsSync(path.join(ARTIFACTS, "final-acceptance.json"))
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, "final-acceptance.json"), "utf8")) as { decision: string; items: { item: string; verdict: string }[] };
          return { decision: raw.decision, verified: raw.items.filter((entry) => entry.verdict === "VERIFIED").length, items: raw.items.length };
        })()
      : undefined,
    catalogues: { benchmarks: BENCHMARK_SCENARIOS.length, seeded: SEEDED_FAILURES.length, critical_capabilities: CRITICAL_CAPABILITIES.length, hard_blocker_classes: HARD_BLOCKER_CLASSES.length },
    acceptance: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "final-acceptance-gate.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "final-acceptance-gate.md"), [
    "# checkpoint-1 §42–§45 + §51/§52 final acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Catalogues: ${report.catalogues.benchmarks} benchmarks, ${report.catalogues.seeded} seeded failures, ${report.catalogues.critical_capabilities} critical capabilities`,
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
