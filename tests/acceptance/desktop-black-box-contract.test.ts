/**
 * Update-Plan/checkpoint-2.md §6.5 (CP20, DB-01..DB-12) — the desktop black-box
 * contract is hostile-accepted.
 *
 * The real Electron smoke is the strongest evidence Prestart has, so the suite that
 * guards it attacks the evidence itself: no report, `{}`, a missing flag, one claim,
 * 88/89, a lying total, a duplicate id, a tampered contract declaration and a report
 * modified after it was attested. Only the exact versioned contract passes.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AcceptanceRun,
  acceptanceArtifacts,
  desktopBlackBoxReport,
  type DesktopFixtureReport
} from "../helpers/acceptance-report";
import { cleanupFixtures, gitRepo } from "../helpers/root-fixtures";
import { DESKTOP_BLACK_BOX_CONTRACT, gateContract } from "../../src/shared/acceptance-contracts";
import {
  DESKTOP_BLACK_BOX_CONTRACT_HASH,
  DESKTOP_BLACK_BOX_CONTRACT_VERSION,
  DESKTOP_BLACK_BOX_REQUIRED_CLAIMS,
  DESKTOP_BLACK_BOX_REQUIREMENTS
} from "../../src/shared/desktop-black-box-contract";
import {
  buildGateAttestation,
  validateDesktopBlackBoxReport,
  verifyGateAttestation,
  type AcceptanceSession
} from "../../src/shared/acceptance-evidence";
import { acceptanceDirectory, sha256File, startAcceptanceSession, writeAttestation } from "../../electron/engineering/acceptance-session";
import { TRUST_CODES } from "../../src/shared/trust-problems";

const run = new AcceptanceRun("CHECKPOINT_20_DESKTOP_BLACK_BOX_CONTRACT");
const REPORT_DIR = acceptanceArtifacts();
const CONTRACT = DESKTOP_BLACK_BOX_CONTRACT;

function validate(report: unknown) {
  return validateDesktopBlackBoxReport({ contract: CONTRACT, report });
}

describe("checkpoint-2 §6.5 CP20 desktop black-box contract", () => {
  it("DB-01 a missing report is refused", async () => {
    await run.scenario("DB-01", "§6.3 no report", (item) => {
      const missingFile = path.join(acceptanceArtifacts(), "definitely-not-a-report.json");
      item.check("the file really does not exist", false, fs.existsSync(missingFile));
      item.check("its hash is empty, so nothing can be attested", "", sha256File(missingFile));
      const validation = validate(undefined);
      item.check("the absent report is refused", "FAIL", validation.verdict);
      item.check("and the reason is that no object was read", true, validation.reasons.includes("REPORT_NOT_OBJECT:undefined"));
      item.cite("sha256File");
    });
  });

  it("DB-02 an empty object is refused", async () => {
    await run.scenario("DB-02", "§6.3 {} is not evidence", (item) => {
      const validation = validate({});
      item.check("the empty object is refused", "FAIL", validation.verdict);
      for (const reason of ["SCHEMA_VERSION_MISSING", "UNIT_MISSING", "RESULTS_NOT_ARRAY", "PASSED_MISSING", "TOTALS_MISSING", "DESKTOP_CONTRACT_MISSING"]) {
        item.check(`the reason ${reason} is named`, true, validation.reasons.includes(reason));
      }
      item.cite("validateDesktopBlackBoxReport");
    });
  });

  it("DB-03 a report without `passed` is refused", async () => {
    await run.scenario("DB-03", "§6.3 passed missing", (item) => {
      const report = desktopBlackBoxReport();
      delete (report as Partial<DesktopFixtureReport>).passed;
      const validation = validate(report);
      item.check("the missing flag is named", true, validation.reasons.includes("PASSED_MISSING"));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("PASSED_MISSING");
    });
  });

  it("DB-04 `passed: false` is refused", async () => {
    await run.scenario("DB-04", "§6.3 passed false", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => { report.passed = false; }));
      item.check("the false flag is named", true, validation.reasons.some((reason) => reason.startsWith("PASSED_NOT_TRUE")));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("PASSED_NOT_TRUE");
    });
  });

  it("DB-05 a single-claim report is refused", async () => {
    await run.scenario("DB-05", "§6.3 one claim is not the black box", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        report.requirementResults = report.requirementResults.slice(0, 1);
        report.totals = { pass: 1, fail: 0, notRun: 0 };
      }));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.check("the missing claims are counted", DESKTOP_BLACK_BOX_REQUIRED_CLAIMS - 1, validation.counts.missing);
      item.check("and the exact id set is enforced", true, validation.reasons.some((reason) => reason.startsWith("EXACT_IDS_MISSING")));
      item.cite("EXACT_IDS_MISSING");
    });
  });

  it("DB-06 one missing required claim is refused", async () => {
    await run.scenario("DB-06", "§6.3 88/89", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        report.requirementResults = report.requirementResults.filter((entry) => entry.id !== "DB-045");
        report.totals = { pass: report.requirementResults.length, fail: 0, notRun: 0 };
      }));
      item.check("the missing claim is named", true, validation.reasons.includes("REQUIRED_ID_MISSING:DB-045"));
      item.check("the exact id set is enforced", true, validation.reasons.includes("EXACT_IDS_MISSING:DB-045"));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("REQUIRED_ID_MISSING");
    });
  });

  it("DB-07 one FAIL claim is refused", async () => {
    await run.scenario("DB-07", "§6.3 one claim FAIL", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        const entry = report.requirementResults.find((candidate) => candidate.id === "DB-042")!;
        entry.verdict = "FAIL";
        entry.observations = [{ claim: entry.title, expected: "true", observed: "false", ok: false }];
        report.totals = { pass: report.totals.pass - 1, fail: 1, notRun: 0 };
      }));
      item.check("the failing claim is named", true, validation.reasons.includes("FAIL_PRESENT:DB-042"));
      item.check("and it is required to pass", true, validation.reasons.includes("REQUIRED_ID_NOT_PASS:DB-042=FAIL"));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("FAIL_PRESENT");
    });
  });

  it("DB-08 one NOT_RUN claim is refused", async () => {
    await run.scenario("DB-08", "§6.3 one claim NOT_RUN", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        const entry = report.requirementResults.find((candidate) => candidate.id === "DB-063")!;
        entry.verdict = "NOT_RUN";
        report.totals = { pass: report.totals.pass - 1, fail: 0, notRun: 1 };
      }));
      item.check("the unrun claim is named", true, validation.reasons.includes("NOT_RUN_PRESENT:DB-063"));
      item.check("the desktop contract declares no out-of-scope claim", 0, validation.out_of_scope_ids.length);
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("NOT_RUN_PRESENT");
    });
  });

  it("DB-09 totals that lie about the claims are refused", async () => {
    await run.scenario("DB-09", "§5.4 totals", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        const entry = report.requirementResults.find((candidate) => candidate.id === "DB-010")!;
        entry.verdict = "FAIL";
        // The totals keep claiming a full pass: exactly the lie §9.1 mutates.
        report.passed = true;
      }));
      item.check("the forged pass total is named", true, validation.reasons.some((reason) => reason.startsWith("TOTALS_PASS_MISMATCH")));
      item.check("the unrecorded failure is named", true, validation.reasons.some((reason) => reason.startsWith("TOTALS_FAIL_MISMATCH")));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("TOTALS_PASS_MISMATCH");
    });
  });

  it("DB-10 a duplicate claim id is refused", async () => {
    await run.scenario("DB-10", "§6.3 no duplicate ids", (item) => {
      const validation = validate(desktopBlackBoxReport((report) => {
        const first = report.requirementResults[0]!;
        report.requirementResults.push({ ...first, title: `${first.title} (forged duplicate)` });
        report.totals = { pass: report.totals.pass + 1, fail: 0, notRun: 0 };
      }));
      item.check("the duplicate is named", true, validation.reasons.includes("DUPLICATE_ID:DB-001"));
      item.check("and the exact id set rejects the extra entry", true, validation.reasons.some((reason) => reason.startsWith("EXACT_IDS_EXTRA")));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("DUPLICATE_ID");
    });
  });

  it("DB-11 the exact versioned contract passes", async () => {
    await run.scenario("DB-11", "§6.3 exact contract", (item) => {
      item.check("the contract version is declared", "desktop-blackbox-1", DESKTOP_BLACK_BOX_CONTRACT_VERSION);
      item.check("the count comes from the contract", DESKTOP_BLACK_BOX_REQUIREMENTS.length, DESKTOP_BLACK_BOX_REQUIRED_CLAIMS);
      item.check("the ids are stable and sequential", true, DESKTOP_BLACK_BOX_REQUIREMENTS.every((requirement, index) => requirement.id === `DB-${String(index + 1).padStart(3, "0")}`));
      item.check("the titles are unique", DESKTOP_BLACK_BOX_REQUIREMENTS.length, new Set(DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => requirement.title)).size);
      item.check("the contract digest is a sha256", true, /^[0-9a-f]{64}$/.test(DESKTOP_BLACK_BOX_CONTRACT_HASH));
      item.check("the gate contract uses the claim ids", DESKTOP_BLACK_BOX_REQUIRED_CLAIMS, gateContract("acceptance-desktop-workbook")?.required_ids.length);
      const validation = validate(desktopBlackBoxReport());
      item.check("the exact contract passes", "PASS", validation.verdict);
      item.check("with no reasons", 0, validation.reasons.length);
      item.check("and every claim verified", DESKTOP_BLACK_BOX_REQUIRED_CLAIMS, validation.counts.pass);
      item.check("the exact id set holds", true, validation.exact_id_set);

      // §6.2: the declaration itself is checked, so a silent contract change is visible.
      item.check("a bumped contract version is refused", "FAIL", validate(desktopBlackBoxReport((report) => { report.contract.version = "desktop-blackbox-2"; })).verdict);
      item.check("a different claim count is refused", true, validate(desktopBlackBoxReport((report) => { report.contract.required_claims = 88; })).reasons.some((reason) => reason.startsWith("DESKTOP_CONTRACT_COUNT_MISMATCH")));
      item.check("a different claim digest is refused", true, validate(desktopBlackBoxReport((report) => { report.contract.claim_ids_hash = "0".repeat(64); })).reasons.some((reason) => reason.startsWith("DESKTOP_CONTRACT_HASH_MISMATCH")));
      item.check("a report with no contract block is refused", true, validate(desktopBlackBoxReport((report) => { delete (report as Partial<DesktopFixtureReport>).contract; })).reasons.includes("DESKTOP_CONTRACT_MISSING"));

      // §6.1: the producer and the contract cannot drift apart silently.
      const harness = fs.readFileSync(path.join(process.cwd(), "scripts", "acceptance-desktop-workbook.cjs"), "utf8");
      const literalTitles = [...harness.matchAll(/claims\.check\(\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!);
      const contractTitles = new Set(DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => requirement.title));
      const unknownLiterals = literalTitles.filter((title) => !contractTitles.has(title));
      item.check("every literal claim the harness asserts is in the contract", JSON.stringify(unknownLiterals), "[]");
      item.check("the harness runs the contract's claims", true, harness.includes("DESKTOP_BLACK_BOX_REQUIREMENTS"));
      item.check("the harness declares the contract version in its report", true, harness.includes("DESKTOP_BLACK_BOX_CONTRACT_VERSION"));
      item.check(
        "the dynamic claim families are contract titles",
        true,
        DESKTOP_BLACK_BOX_REQUIREMENTS.filter((requirement) => /^renderer step \w+$/.test(requirement.title)).length === 8
        && DESKTOP_BLACK_BOX_REQUIREMENTS.filter((requirement) => /^intake stage [A-Z_]+ was recorded$/.test(requirement.title)).length === 7
      );
      item.cite("src/shared/desktop-black-box-contract.ts");
    });
  });

  it("DB-12 a report modified after attestation is refused", async () => {
    await run.scenario("DB-12", "§2.7 hash binds sources", (item) => {
      const repo = gitRepo("boss-db-tamper-");
      const artifacts = acceptanceDirectory(repo.root);
      const outcome = startAcceptanceSession({ root: repo.root, artifacts, certify: true, sessionId: "session-db-tamper", commit: repo.sha, workingTreeStatus: "" });
      if (!outcome.ok || !outcome.session) throw new Error(`session fixture failed: ${outcome.reason}`);
      const session: AcceptanceSession = outcome.session;
      const reportFile = path.join(artifacts, CONTRACT.report_file);
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(reportFile, `${JSON.stringify(desktopBlackBoxReport(), null, 2)}\n`, "utf8");
      const validation = validate(JSON.parse(fs.readFileSync(reportFile, "utf8")));
      item.check("the exact contract validates before the tamper", "PASS", validation.verdict);
      const attestation = buildGateAttestation({
        gate: CONTRACT.gate,
        contract: CONTRACT,
        session,
        source_sha256: sha256File(reportFile),
        validation,
        attested_at: new Date().toISOString()
      });
      writeAttestation(artifacts, CONTRACT.gate, attestation);
      item.check("the untouched evidence verifies", 0, verifyGateAttestation({
        gate: CONTRACT.gate,
        contract: CONTRACT,
        session,
        attestation,
        report: JSON.parse(fs.readFileSync(reportFile, "utf8")),
        source_sha256: sha256File(reportFile)
      }).length);

      // 89/89 but the evidence changed after attestation: only the hash can catch it.
      const tampered = desktopBlackBoxReport();
      tampered.generatedAt = new Date(Date.now() + 60_000).toISOString();
      tampered.unit = "PHASE_0_DESKTOP_WORKBOOK_SMOKE_REPLAYED";
      fs.writeFileSync(reportFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const problems = verifyGateAttestation({
        gate: CONTRACT.gate,
        contract: CONTRACT,
        session,
        attestation,
        report: JSON.parse(fs.readFileSync(reportFile, "utf8")),
        source_sha256: sha256File(reportFile)
      });
      item.check("the tampered source is named", true, problems.some((problem) => problem.code === TRUST_CODES.SOURCE_HASH_MISMATCH));
      item.check("the tampered report still validates on its own", "PASS", validate(tampered).verdict);
      item.cite("SOURCE_HASH_MISMATCH");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "desktop-contract.json", { checkpoint: "CP20", desktop_contract: DESKTOP_BLACK_BOX_CONTRACT_VERSION });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
