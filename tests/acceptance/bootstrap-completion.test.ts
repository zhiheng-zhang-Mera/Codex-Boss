/**
 * checkpoint-1 §57/§58 (checkpoint-18) + checkpoint-2 §8 — Bootstrap Completion
 * audit acceptance (BC-01..BC-06).
 *
 * The audit no longer reads bare report files: it reads a session, sixteen
 * attestation-bound gate reports, the desktop black box under its versioned claim
 * contract and the Owner intervention ledger. This suite drives the real host
 * auditor over a real temporary artifact directory and over hostile ones.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts, cleanGateReport } from "../helpers/acceptance-report";
import { cleanupFixtures, tempDir } from "../helpers/root-fixtures";
import { trustedFixture } from "../helpers/trusted-evidence";
import { ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT, GATE_REQUIREMENTS, REPORT_FILES } from "../../src/shared/acceptance-contracts";
import { DESKTOP_BLACK_BOX, evaluateTrustedBootstrap } from "../../src/shared/bootstrap-audit";
import { validateGateReport } from "../../src/shared/acceptance-evidence";
import { emptyOwnerLedger } from "../../src/shared/owner-intervention";
import { TRUST_CODES } from "../../src/shared/trust-problems";
import { CRITICAL_CAPABILITIES } from "../../src/shared/final-acceptance";
import { createBootstrapAuditor, BOOTSTRAP_AUDIT_RECORD } from "../../electron/engineering/bootstrap-completion";

const run = new AcceptanceRun("CHECKPOINT_18_BOOTSTRAP_COMPLETION");
const REPORT_DIR = acceptanceArtifacts();
const shared: Record<string, unknown> = {};

describe("checkpoint-18 §57/§58 Bootstrap Completion audit (hardened)", () => {
  it("BC-01 every gate is audited against the ids its contract requires", async () => {
    await run.scenario("BC-01", "§8.2 the chain's gates", (item) => {
      item.check("sixteen delivery gates", 16, ACCEPTANCE_GATE_CONTRACTS.length);
      item.check("every gate names its report file", true, Object.values(REPORT_FILES).every((file) => file.endsWith(".json")));
      const verify = GATE_REQUIREMENTS["acceptance-verify"]!;
      const missing = validateGateReport({ gate: "acceptance-verify", contract: ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === "acceptance-verify")!, report: undefined });
      item.check("a gate with no report is refused", "FAIL", missing.verdict);
      item.check("and names every id it owes", verify.length, missing.counts.missing);
      const fixture = trustedFixture();
      const audit = fixture.evaluate();
      item.check("the audit carries one entry per gate", 16, audit.gates.length);
      item.check("plus the black box", "acceptance-desktop-workbook", audit.desktop.gate);
      item.check("every gate records its required id count", true, audit.gates.every((gate) => gate.required_ids === GATE_REQUIREMENTS[gate.gate]?.length));
      item.check("and how many of them are verified", true, audit.gates.every((gate) => gate.verified_ids === gate.required_ids));
      shared.bc01 = { gates: audit.gates.length };
      item.cite("evaluateTrustedBootstrap");
    });
  });

  it("BC-02 a complete trusted evidence set yields BOOTSTRAP_COMPLETE", async () => {
    await run.scenario("BC-02", "§57/§58 the verdict", (item) => {
      const fixture = trustedFixture();
      const audit = fixture.evaluate();
      item.check("every gate passed", audit.gates_passed, audit.gates_required);
      item.check("the desktop black box passed", "PASS", audit.desktop.verdict);
      item.check("under its versioned contract", DESKTOP_BLACK_BOX_CONTRACT.contract_version, audit.desktop.contract);
      item.check("with every claim verified", audit.desktop.required_claims, audit.desktop.verified_claims);
      item.check("every capability is established", 13, audit.capabilities.passed);
      item.check("the decision is BOOTSTRAP_COMPLETE", "BOOTSTRAP_COMPLETE", audit.decision);
      item.check("no Owner intervention was needed", 0, audit.owner_interventions);
      item.check("the provenance is one session", true, audit.provenance.same_session);
      item.check("one commit", true, audit.provenance.same_commit);
      item.check("and the source hashes were verified", true, audit.provenance.source_hashes_verified);
      item.check("the audit is sealed by a root hash", true, /^[0-9a-f]{64}$/.test(audit.root_hash));
      item.check("the manifest lists sixteen gates, the black box, the ledger and the session", 19, audit.sources.length);
      item.check("every source carries a report hash", true, audit.sources.every((source) => /^[0-9a-f]{64}$/.test(source.report_sha256)));
      item.check("the record is durable", true, fs.existsSync(path.join(fixture.artifacts, BOOTSTRAP_AUDIT_RECORD)));
      shared.bc02 = { decision: audit.decision, gates: audit.gates_passed };
      item.cite(path.join(fixture.artifacts, BOOTSTRAP_AUDIT_RECORD));
    });
  });

  it("BC-03 a missing gate report means INCOMPLETE", async () => {
    await run.scenario("BC-03", "§8.2 a gate that wrote nothing", (item) => {
      const fixture = trustedFixture();
      fixture.removeReport("acceptance-publish");
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("the missing gate is named", true, audit.gates.some((gate) => gate.gate === "acceptance-publish" && gate.verdict === "MISSING"));
      item.check("and its capability is not established", true, audit.capability_evidence.some((entry) => entry.capability === "GitHub publishing" && !entry.established));
      item.check("the reason says the report is missing", true, audit.gates.find((gate) => gate.gate === "acceptance-publish")?.problems.some((problem) => problem.code === TRUST_CODES.REPORT_FILE_MISSING));
      shared.bc03 = { decision: audit.decision };
      item.cite("a deleted report");
    });
  });

  it("BC-04 a partially green report is not a pass", async () => {
    await run.scenario("BC-04", "§8.2 ids, not vibes", (item) => {
      const fixture = trustedFixture();
      const report = cleanGateReport(ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === "acceptance-ci-repair")!);
      report.requirementResults = report.requirementResults.map((entry) => entry.id === "CR-07" ? { ...entry, verdict: "NOT_RUN" as const } : entry);
      report.totals = { pass: report.totals.pass - 1, fail: 0, notRun: 1 };
      fixture.writeReport("acceptance-ci-repair", report);
      fixture.attest("acceptance-ci-repair");
      const audit = fixture.evaluate();
      item.check("the gate fails", true, audit.gates.some((gate) => gate.gate === "acceptance-ci-repair" && gate.verdict === "FAIL"));
      item.check("the id is named", true, audit.gates.find((gate) => gate.gate === "acceptance-ci-repair")?.problems.some((problem) => (problem.detail ?? "").includes("CR-07")));
      item.check("so the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      shared.bc04 = { decision: audit.decision };
      item.cite("a NOT_RUN id");
    });
  });

  it("BC-05 an Owner intervention forbids completion", async () => {
    await run.scenario("BC-05", "§57 no human engineering", (item) => {
      const fixture = trustedFixture();
      item.check("the clean run completes first", "BOOTSTRAP_COMPLETE", fixture.evaluate().decision);
      fixture.recordIntervention("the Owner had to supply a missing resource", "HB3_MISSING_EXTERNAL_RESOURCE");
      const audit = fixture.evaluate();
      item.check("the derived count is one", 1, audit.owner_interventions);
      item.check("it came from the ledger's own events", 1, audit.owner_intervention_ledger.events);
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("and the reason says the black box forbids it", true, audit.reasons.some((reason) => reason.includes("forbids them")));
      // An empty ledger restores the verdict: the event, not the file, was decisive.
      fixture.writeLedger(emptyOwnerLedger(fixture.session));
      item.check("an empty ledger completes again", "BOOTSTRAP_COMPLETE", fixture.evaluate().decision);
      item.check("the pure audit refuses an empty evidence set", "INCOMPLETE", evaluateTrustedBootstrap({ session_sha256: "", gates: [], ownerLedgerSha256: "" }).decision);
      shared.bc05 = { reasons: audit.reasons.slice(-1) };
      item.cite("owner-interventions.json");
    });
  });

  it("BC-06 the thirteen capabilities are each traceable to trusted evidence", async () => {
    await run.scenario("BC-06", "§8.3 capability evidence", async (item) => {
      item.check("thirteen capabilities", 13, CRITICAL_CAPABILITIES.length);
      const fixture = trustedFixture();
      const audit = fixture.evaluate();
      item.check("every capability maps to at least one gate", true, audit.capability_evidence.every((entry) => entry.gates.length > 0));
      item.check("the theme capability includes the real black box", true, audit.capability_evidence.find((entry) => entry.capability === "theme engine")?.gates.includes(DESKTOP_BLACK_BOX));
      item.check("the completion verdict is complete", true, audit.completion.complete);
      const empty = tempDir("boss-bc-empty-");
      const nothing = createBootstrapAuditor({ root: empty, artifacts: path.join(empty, "artifacts", "acceptance") }).evaluate().audit;
      item.check("with no evidence nothing is established", 0, nothing.capability_evidence.filter((entry) => entry.established).length);
      item.check("and the decision is INCOMPLETE", "INCOMPLETE", nothing.decision);
      shared.bc06 = { capabilities: audit.capability_evidence.length, complete: audit.completion.complete };
      item.cite("capability_evidence");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "bootstrap-completion-audit.json", { checkpoint: "CP18+CP22", audit: shared });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
