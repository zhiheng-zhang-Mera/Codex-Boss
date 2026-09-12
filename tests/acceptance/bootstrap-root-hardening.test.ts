/**
 * Update-Plan/checkpoint-2.md §8.7 (CP22, RA-01..RA-12) — the trusted root audit.
 *
 * Every case is driven through the real host auditor over a real temporary artifact
 * directory: real report files, real attestations, real SHA-256 hashes, the real
 * ledger and the real session manifest (§9.3 — no mocked verdicts).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts, cleanGateReport, desktopBlackBoxReport } from "../helpers/acceptance-report";
import { cleanupFixtures } from "../helpers/root-fixtures";
import { trustedFixture } from "../helpers/trusted-evidence";
import { ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT } from "../../src/shared/acceptance-contracts";
import { emptyOwnerLedger } from "../../src/shared/owner-intervention";
import { TRUST_CODES } from "../../src/shared/trust-problems";

const run = new AcceptanceRun("CHECKPOINT_22_ROOT_HARDENING");
const REPORT_DIR = acceptanceArtifacts();

const VERIFY_GATE = "acceptance-verify";
const PUBLISH_GATE = "acceptance-publish";

describe("checkpoint-2 §8.7 CP22 trusted root hardening", () => {
  it("RA-01 a complete trusted evidence set completes", async () => {
    await run.scenario("RA-01", "§8.2 all trusted evidence", (item) => {
      const fixture = trustedFixture();
      const audit = fixture.evaluate();
      item.check("the decision is BOOTSTRAP_COMPLETE", "BOOTSTRAP_COMPLETE", audit.decision);
      item.check("with no reasons", 0, audit.reasons.length);
      item.check("and a positive summary", true, audit.summary.includes("trusted evidence"));
      item.check("sixteen of sixteen gates", "16/16", `${audit.gates_passed}/${audit.gates_required}`);
      item.check("the desktop black box", "PASS", audit.desktop.verdict);
      item.check("thirteen of thirteen capabilities", "13/13", `${audit.capabilities.passed}/${audit.capabilities.required}`);
      item.check("and no Owner interventions", 0, audit.owner_interventions);
      item.check("the session is recorded", fixture.session.session_id, audit.session_id);
      item.check("and the commit", fixture.session.commit_sha, audit.commit_sha);
      item.cite("evaluateTrustedBootstrap");
    });
  });

  it("RA-02 a missing gate attestation is INCOMPLETE", async () => {
    await run.scenario("RA-02", "§8.2 attestation required", (item) => {
      const fixture = trustedFixture();
      fixture.removeAttestation(PUBLISH_GATE);
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      const gate = audit.gates.find((entry) => entry.gate === PUBLISH_GATE)!;
      item.check("the gate fails", "FAIL", gate.verdict);
      item.check("because the attestation is missing", true, gate.problems.some((problem) => problem.code === TRUST_CODES.ATTESTATION_NOT_OBJECT));
      item.check("and the capability it establishes is not", false, audit.capability_evidence.find((entry) => entry.capability === "GitHub publishing")!.established);
      item.cite("ATTESTATION_NOT_OBJECT");
    });
  });

  it("RA-03 a source hash mismatch is INCOMPLETE", async () => {
    await run.scenario("RA-03", "§2.7 hash binds sources", (item) => {
      const fixture = trustedFixture();
      // A valid-looking change to the report after attestation: only the hash notices.
      const tampered = cleanGateReport(ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === VERIFY_GATE)!);
      tampered.unit = "TAMPERED";
      fixture.writeReport(VERIFY_GATE, tampered);
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("the gate fails", "FAIL", audit.gates.find((entry) => entry.gate === VERIFY_GATE)!.verdict);
      item.check("the hash mismatch is named", true, audit.gates.find((entry) => entry.gate === VERIFY_GATE)!.problems.some((problem) => problem.code === TRUST_CODES.SOURCE_HASH_MISMATCH));
      item.check("and provenance reports unverified sources", false, audit.provenance.source_hashes_verified);
      item.cite("SOURCE_HASH_MISMATCH");
    });
  });

  it("RA-04 a stale gate attestation is INCOMPLETE", async () => {
    await run.scenario("RA-04", "§2.3 stale evidence", (item) => {
      const fixture = trustedFixture();
      const stale = JSON.parse(fs.readFileSync(fixture.attestationFile(VERIFY_GATE), "utf8")) as Record<string, unknown>;
      stale.attested_at = "2020-01-01T00:00:00.000Z";
      // The digest no longer covers the file: stale evidence is refused.
      fs.writeFileSync(fixture.attestationFile(VERIFY_GATE), JSON.stringify(stale), "utf8");
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("the attestation digest is refused", true, audit.gates.find((entry) => entry.gate === VERIFY_GATE)!.problems.some((problem) => problem.code === TRUST_CODES.ATTESTATION_HASH_MISMATCH));
      item.cite("ATTESTATION_HASH_MISMATCH");
    });
  });

  it("RA-05 mixed commits are INCOMPLETE", async () => {
    await run.scenario("RA-05", "§2.4 same commit", (item) => {
      const fixture = trustedFixture();
      // A real second session on another commit writes one gate's evidence.
      const other = trustedFixture({ sessionId: "session-other-commit", commit: "d".repeat(40) });
      fs.copyFileSync(other.reportFile(VERIFY_GATE), fixture.reportFile(VERIFY_GATE));
      fs.copyFileSync(other.attestationFile(VERIFY_GATE), fixture.attestationFile(VERIFY_GATE));
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      const gate = audit.gates.find((entry) => entry.gate === VERIFY_GATE)!;
      item.check("the commit mismatch is named", true, gate.problems.some((problem) => problem.code === TRUST_CODES.ATTESTATION_COMMIT_MISMATCH));
      item.check("and provenance says the commits differ", false, audit.provenance.same_commit);
      item.cite("ATTESTATION_COMMIT_MISMATCH");
    });
  });

  it("RA-06 mixed sessions are INCOMPLETE", async () => {
    await run.scenario("RA-06", "§2.3 same session", (item) => {
      const fixture = trustedFixture();
      const other = trustedFixture({ sessionId: "session-other-run" });
      fs.copyFileSync(other.reportFile(VERIFY_GATE), fixture.reportFile(VERIFY_GATE));
      fs.copyFileSync(other.attestationFile(VERIFY_GATE), fixture.attestationFile(VERIFY_GATE));
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      const gate = audit.gates.find((entry) => entry.gate === VERIFY_GATE)!;
      item.check("the session mismatch is named", true, gate.problems.some((problem) => problem.code === TRUST_CODES.ATTESTATION_SESSION_MISMATCH));
      item.check("and provenance says the sessions differ", false, audit.provenance.same_session);
      item.cite("ATTESTATION_SESSION_MISMATCH");
    });
  });

  it("RA-07 an incomplete desktop contract is INCOMPLETE", async () => {
    await run.scenario("RA-07", "§6.3 desktop contract", (item) => {
      const fixture = trustedFixture();
      fixture.writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, desktopBlackBoxReport((report) => {
        report.requirementResults = report.requirementResults.slice(0, 88);
        report.totals = { pass: 88, fail: 0, notRun: 0 };
      }));
      fixture.attest(DESKTOP_BLACK_BOX_CONTRACT.gate);
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("the black box fails", "FAIL", audit.desktop.verdict);
      item.check("because a claim is missing", true, audit.desktop.problems.some((problem) => problem.code === TRUST_CODES.EXACT_IDS_MISSING));
      item.check("and the theme capability is not established", false, audit.capability_evidence.find((entry) => entry.capability === "theme engine")!.established);
      item.cite("EXACT_IDS_MISSING");
    });
  });

  it("RA-08 an Owner intervention is INCOMPLETE", async () => {
    await run.scenario("RA-08", "§7.5 derived count", (item) => {
      const fixture = trustedFixture();
      fixture.recordIntervention("the Owner was asked to fix CI", "ENGINEERING_REQUEST");
      const audit = fixture.evaluate();
      item.check("the derived count is one", 1, audit.owner_interventions);
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      item.check("the reason names the intervention", true, audit.reasons.some((reason) => reason.includes("forbids them")));
      item.check("and the ledger hash is recorded", true, /^[0-9a-f]{64}$/.test(audit.owner_intervention_ledger.hash));
      item.cite("deriveOwnerInterventions");
    });
  });

  it("RA-09 a missing capability evidence is INCOMPLETE", async () => {
    await run.scenario("RA-09", "§8.3 capability derivation", (item) => {
      const fixture = trustedFixture();
      fixture.removeReport("acceptance-knowledge");
      fixture.removeReport("acceptance-final");
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      const knowledge = audit.capability_evidence.find((entry) => entry.capability === "knowledge foundation")!;
      item.check("both of its gates are listed", 2, knowledge.gates.length);
      item.check("and it is not established", false, knowledge.established);
      item.check("while the other capabilities still are", 12, audit.capabilities.passed);
      item.cite("capability_evidence");
    });
  });

  it("RA-10 a malformed source report is INCOMPLETE", async () => {
    await run.scenario("RA-10", "§2.1 malformed report", (item) => {
      const fixture = trustedFixture();
      fs.writeFileSync(fixture.reportFile(VERIFY_GATE), "{ this is not json", "utf8");
      const audit = fixture.evaluate();
      item.check("the decision is INCOMPLETE", "INCOMPLETE", audit.decision);
      const gate = audit.gates.find((entry) => entry.gate === VERIFY_GATE)!;
      item.check("the gate fails", "FAIL", gate.verdict);
      item.check("because no object could be read", true, gate.problems.some((problem) => problem.code === TRUST_CODES.REPORT_NOT_OBJECT && problem.detail === "undefined"));
      item.cite("REPORT_NOT_OBJECT");
    });
  });

  it("RA-11 changing a source changes the root result and hash", async () => {
    await run.scenario("RA-11", "§8.5 root hash", (item) => {
      const fixture = trustedFixture();
      const before = fixture.evaluate();
      item.check("the clean root hash is stable", before.root_hash, fixture.evaluate().root_hash);
      fixture.recordIntervention("one more request");
      const after = fixture.evaluate();
      item.check("the decision changed", true, before.decision !== after.decision);
      item.check("and so did the root hash", true, before.root_hash !== after.root_hash);
      const tampered = trustedFixture();
      const report = cleanGateReport(ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === VERIFY_GATE)!);
      report.requirementResults[0]!.title = "reworded";
      tampered.writeReport(VERIFY_GATE, report);
      tampered.attest(VERIFY_GATE);
      item.check("re-attested but reworded evidence is still a different root", true, tampered.evaluate().root_hash !== before.root_hash);
      item.cite("root_hash");
    });
  });

  it("RA-12 the exact clean set produces a stable root hash", async () => {
    await run.scenario("RA-12", "§8.5 stable root", (item) => {
      const first = trustedFixture();
      const second = trustedFixture();
      // Both fixtures use the same injected session id and commit, so identical
      // evidence must produce an identical root hash.
      item.check("the same evidence yields the same root", first.evaluate().root_hash, second.evaluate().root_hash);
      item.check("and the same decision", first.evaluate().decision, second.evaluate().decision);
      item.check("the ledger digest is empty-ledger", emptyOwnerLedger(first.session).ledger_hash, first.evaluate().owner_intervention_ledger.hash);
      const record = JSON.parse(fs.readFileSync(path.join(first.artifacts, "bootstrap-completion.json"), "utf8")) as { schemaVersion: number; root_hash: string };
      item.check("the durable record is schemaVersion 2", 2, record.schemaVersion);
      item.check("and carries the root hash", first.evaluate().root_hash, record.root_hash);
      item.cite("bootstrap-completion.json");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "bootstrap-root-hardening.json", { checkpoint: "CP22" });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
