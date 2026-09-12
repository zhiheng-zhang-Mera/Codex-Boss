/**
 * Update-Plan/checkpoint-2.md §5.6 (CP19, EI-01..EI-12) — evidence integrity.
 *
 * The suite proves that a report is only evidence when the raw bytes, the session
 * and the commit it claims all still agree. Even a report whose required ids all
 * PASS is refused when it is incomplete, inconsistent, stale or tampered with.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts, cleanGateReport, type FixtureReport } from "../helpers/acceptance-report";
import { cleanupFixtures, gitRepo, tempDir } from "../helpers/root-fixtures";
import { gateContract } from "../../src/shared/acceptance-contracts";
import {
  buildGateAttestation,
  sessionProblems,
  validateGateReport,
  verifyGateAttestation,
  type AcceptanceSession
} from "../../src/shared/acceptance-evidence";
import {
  ACCEPTANCE_RELATIVE,
  HISTORY_DIRECTORY,
  acceptanceDirectory,
  readJsonFile,
  sha256File,
  startAcceptanceSession,
  writeAttestation
} from "../../electron/engineering/acceptance-session";

const run = new AcceptanceRun("CHECKPOINT_19_EVIDENCE_INTEGRITY");
const WORKBOOK = gateContract("acceptance-workbook")!;
const REPORT_DIR = acceptanceArtifacts();

/** Binds a session with injected identity so the scenarios stay deterministic. */
function bindSession(input: {
  root: string;
  artifacts: string;
  sessionId: string;
  commit: string;
  certify?: boolean;
  clean?: boolean;
  workingTreeStatus?: string;
}): AcceptanceSession {
  const outcome = startAcceptanceSession({
    root: input.root,
    artifacts: input.artifacts,
    certify: input.certify ?? true,
    clean: input.clean ?? false,
    sessionId: input.sessionId,
    commit: input.commit,
    workingTreeStatus: input.workingTreeStatus ?? ""
  });
  if (!outcome.ok || !outcome.session) throw new Error(`session fixture failed: ${outcome.reason}`);
  return outcome.session;
}

function writeReport(artifacts: string, file: string, report: unknown): string {
  const target = path.join(artifacts, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

describe("checkpoint-2 §5.6 CP19 evidence integrity", () => {
  it("EI-01 a session fixes the commit, the id and the tree state", async () => {
    await run.scenario("EI-01", "§5.2 session creation", (item) => {
      const repo = gitRepo("boss-ei-session-");
      const artifacts = acceptanceDirectory(repo.root);
      const outcome = startAcceptanceSession({ root: repo.root, artifacts, certify: true, clean: true });
      item.check("the session starts", true, outcome.ok);
      item.check("it records the repository HEAD", repo.sha, outcome.session?.commit_sha);
      item.check("certification mode is on", true, outcome.session?.certification_mode);
      item.check("the working tree is clean", true, outcome.session?.working_tree_clean);
      item.check("the session id is unique to the run", true, /^session-/.test(String(outcome.session?.session_id)));
      item.check("the manifest is durable", true, fs.existsSync(path.join(artifacts, "session.json")));
      item.check("the manifest is structurally sound", 0, sessionProblems(outcome.session).length);
      item.cite(path.join(ACCEPTANCE_RELATIVE, "session.json"));
    });
  });

  it("EI-02 certification refuses a dirty working tree", async () => {
    await run.scenario("EI-02", "§5.3 dirty tree", (item) => {
      const repo = gitRepo("boss-ei-dirty-");
      const artifacts = acceptanceDirectory(repo.root);
      fs.writeFileSync(path.join(repo.root, "uncommitted.txt"), "dirty\n", "utf8");
      const refused = startAcceptanceSession({ root: repo.root, artifacts, certify: true, clean: true });
      item.check("certification is refused", false, refused.ok);
      item.check("the refusal names the dirty tree", true, /dirty working tree/.test(String(refused.reason)));
      item.check("no manifest was written by the refusal", false, fs.existsSync(path.join(artifacts, "session.json")));
      const development = startAcceptanceSession({ root: repo.root, artifacts, certify: false });
      item.check("a development session is still allowed", true, development.ok);
      item.check("and it records that the tree was dirty", false, development.session?.working_tree_clean);
      item.check("a development session is not certification", false, development.session?.certification_mode);
      item.check(
        "a certification manifest on a dirty tree is rejected",
        true,
        sessionProblems({ ...development.session, certification_mode: true }).includes("SESSION_CERTIFICATION_ON_DIRTY_TREE")
      );
      item.cite("startAcceptanceSession");
    });
  });

  it("EI-03 a stale artifact cannot join a new session", async () => {
    await run.scenario("EI-03", "§2.3 same run", (item) => {
      const repo = gitRepo("boss-ei-stale-");
      const artifacts = acceptanceDirectory(repo.root);
      const first = bindSession({ root: repo.root, artifacts, sessionId: "session-stale-a", commit: repo.sha });
      const reportPath = writeReport(artifacts, WORKBOOK.report_file, cleanGateReport(WORKBOOK));
      const validation = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: readJsonFile(reportPath) });
      writeAttestation(artifacts, WORKBOOK.gate, buildGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session: first,
        source_sha256: sha256File(reportPath),
        validation,
        attested_at: new Date().toISOString()
      }));
      item.check("the first session's evidence validates", true, validation.verdict === "PASS");

      const second = bindSession({ root: repo.root, artifacts, sessionId: "session-stale-b", commit: repo.sha, clean: true });
      item.check("the new session is the current one", "session-stale-b", second.session_id);
      item.check("the stale report left the current namespace", false, fs.existsSync(reportPath));
      const archived = path.join(artifacts, HISTORY_DIRECTORY, "session-stale-a");
      item.check("it was archived under the previous session id", true, fs.existsSync(archived));
      item.check("the archived report is intact for history", true, fs.existsSync(path.join(archived, WORKBOOK.report_file)));
      const staleAttestation = readJsonFile(path.join(archived, "attestations", `${WORKBOOK.gate}.json`));
      const problems = verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session: second,
        attestation: staleAttestation,
        report: cleanGateReport(WORKBOOK),
        source_sha256: sha256File(reportPath)
      });
      item.check("the stale attestation is refused by the new session", true, problems.some((problem) => problem.startsWith("ATTESTATION_SESSION_MISMATCH")));
      item.check("and the missing current report is refused too", true, problems.includes("ATTESTATION_SOURCE_MISSING"));
      item.cite(path.join(ACCEPTANCE_RELATIVE, HISTORY_DIRECTORY));
    });
  });

  it("EI-04 a malformed report is not evidence", async () => {
    await run.scenario("EI-04", "§2.1 malformed JSON", (item) => {
      const artifacts = tempDir("boss-ei-malformed-");
      const broken = path.join(artifacts, "broken.json");
      fs.writeFileSync(broken, "{ \"schemaVersion\": 1, ", "utf8");
      item.check("the file really is unparseable", undefined, readJsonFile(broken));
      const validation = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: readJsonFile(broken) });
      item.check("the report is refused", "FAIL", validation.verdict);
      item.check("and the reason is that it is not an object", true, validation.reasons.includes("REPORT_NOT_OBJECT:undefined"));
      const arrayReport = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: [1, 2, 3] });
      item.check("a JSON array is not a report either", true, arrayReport.reasons.includes("REPORT_NOT_OBJECT:array"));
      item.cite("validateGateReport");
    });
  });

  it("EI-05 a missing `passed` field is refused", async () => {
    await run.scenario("EI-05", "§2.1 passed missing", (item) => {
      const report = cleanGateReport(WORKBOOK);
      delete (report as Partial<FixtureReport>).passed;
      const missing = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report });
      item.check("the missing flag is named", true, missing.reasons.includes("PASSED_MISSING"));
      const falseFlag = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: cleanGateReport(WORKBOOK, (value) => { value.passed = false; }) });
      item.check("passed=false is not a pass", true, falseFlag.reasons.some((reason) => reason.startsWith("PASSED_NOT_TRUE")));
      item.check("and the verdict is FAIL", "FAIL", falseFlag.verdict);
      item.cite("PASSED_MISSING");
    });
  });

  it("EI-06 totals that disagree with the results are refused", async () => {
    await run.scenario("EI-06", "§5.4 totals", (item) => {
      const lyingPass = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => { value.totals.pass += 1; })
      });
      item.check("a forged pass total is named", true, lyingPass.reasons.some((reason) => reason.startsWith("TOTALS_PASS_MISMATCH")));
      const lyingRun = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => {
          value.totals.pass -= 1;
          value.totals.notRun += 1;
          value.totals.fail += 1;
        })
      });
      item.check("the fail total is checked", true, lyingRun.reasons.some((reason) => reason.startsWith("TOTALS_FAIL_MISMATCH")));
      item.check("the notRun total is checked", true, lyingRun.reasons.some((reason) => reason.startsWith("TOTALS_NOTRUN_MISMATCH")));
      item.check("the sum is checked", true, lyingRun.reasons.some((reason) => reason.startsWith("TOTALS_SUM_MISMATCH")));
      item.check("the gate fails", "FAIL", lyingRun.verdict);
      item.cite("TOTALS_PASS_MISMATCH");
    });
  });

  it("EI-07 a duplicate requirement id is refused", async () => {
    await run.scenario("EI-07", "§5.4 unique ids", (item) => {
      const validation = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => {
          value.requirementResults.push({ id: "WB-01", title: "forged duplicate", verdict: "PASS" });
          value.totals.pass += 1;
        })
      });
      item.check("the duplicate is named", true, validation.reasons.includes("DUPLICATE_ID:WB-01"));
      item.check("the gate fails", "FAIL", validation.verdict);
      item.cite("DUPLICATE_ID");
    });
  });

  it("EI-08 an extra FAIL cannot hide behind passing required ids", async () => {
    await run.scenario("EI-08", "§2.1 extra FAIL", (item) => {
      const validation = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => {
          value.requirementResults.push({ id: "WB-EXTRA", title: "an extra check", verdict: "FAIL" });
          value.totals.fail += 1;
        })
      });
      item.check("every required id still passed", true, !validation.reasons.some((reason) => reason.startsWith("REQUIRED_ID")));
      item.check("but the extra FAIL is named", true, validation.reasons.includes("FAIL_PRESENT:WB-EXTRA"));
      item.check("so the gate fails", "FAIL", validation.verdict);
      item.cite("FAIL_PRESENT");
    });
  });

  it("EI-09 an undeclared NOT_RUN is refused", async () => {
    await run.scenario("EI-09", "§2.1 NOT_RUN", (item) => {
      const clean = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: cleanGateReport(WORKBOOK) });
      item.check("the declared out-of-scope id passes the validator", "PASS", clean.verdict);
      item.check("it is reported as NOT_RUN, not dropped", true, clean.counts.notRun === 1);
      const extraNotRun = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => {
          value.requirementResults.push({ id: "WB-EXTRA", title: "an extra check", verdict: "NOT_RUN" });
          value.totals.notRun += 1;
        })
      });
      item.check("an undeclared NOT_RUN is named", true, extraNotRun.reasons.includes("NOT_RUN_PRESENT:WB-EXTRA"));
      item.check("and the gate fails", "FAIL", extraNotRun.verdict);
      const dropped = validateGateReport({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        report: cleanGateReport(WORKBOOK, (value) => {
          value.requirementResults = value.requirementResults.filter((entry) => entry.id !== "WB-LIVE-PROVIDER");
          value.totals.notRun -= 1;
        })
      });
      item.check("an out-of-scope id that vanishes is refused", true, dropped.reasons.includes("OUT_OF_SCOPE_ID_MISSING:WB-LIVE-PROVIDER"));
      item.cite("NOT_RUN_PRESENT");
    });
  });

  it("EI-10 a report modified after attestation is refused", async () => {
    await run.scenario("EI-10", "§2.7 hash binds sources", (item) => {
      const repo = gitRepo("boss-ei-hash-");
      const artifacts = acceptanceDirectory(repo.root);
      const session = bindSession({ root: repo.root, artifacts, sessionId: "session-hash", commit: repo.sha });
      const reportPath = writeReport(artifacts, WORKBOOK.report_file, cleanGateReport(WORKBOOK));
      const validation = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: readJsonFile(reportPath) });
      const attestation = buildGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session,
        source_sha256: sha256File(reportPath),
        validation,
        attested_at: new Date().toISOString()
      });
      const before = verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session,
        attestation,
        report: readJsonFile(reportPath),
        source_sha256: sha256File(reportPath)
      });
      item.check("the untouched evidence verifies", 0, before.length);
      // The tamper keeps the report *valid*: only the bytes change.
      const tampered = cleanGateReport(WORKBOOK, (value) => { value.unit = "TAMPERED_UNIT"; });
      writeReport(artifacts, WORKBOOK.report_file, tampered);
      const after = verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session,
        attestation,
        report: tampered,
        source_sha256: sha256File(reportPath)
      });
      item.check("the tampered bytes are named", true, after.some((problem) => problem.startsWith("SOURCE_HASH_MISMATCH")));
      item.check("the report itself still validates (so only the hash caught it)", "PASS", validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report: tampered }).verdict);
      item.cite("SOURCE_HASH_MISMATCH");
    });
  });

  it("EI-11 a stale session cannot verify an attestation", async () => {
    await run.scenario("EI-11", "§2.3 mixed session", (item) => {
      const repo = gitRepo("boss-ei-mixed-session-");
      const artifacts = acceptanceDirectory(repo.root);
      const sessionA = bindSession({ root: repo.root, artifacts, sessionId: "session-a", commit: repo.sha });
      const reportPath = writeReport(artifacts, WORKBOOK.report_file, cleanGateReport(WORKBOOK));
      const report = readJsonFile(reportPath);
      const validation = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report });
      const attestation = buildGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session: sessionA,
        source_sha256: sha256File(reportPath),
        validation,
        attested_at: new Date().toISOString()
      });
      const sessionB = bindSession({ root: repo.root, artifacts, sessionId: "session-b", commit: repo.sha });
      const problems = verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session: sessionB,
        attestation,
        report,
        source_sha256: sha256File(reportPath)
      });
      item.check("the session mismatch is named", true, problems.some((problem) => problem.startsWith("ATTESTATION_SESSION_MISMATCH")));
      item.cite("ATTESTATION_SESSION_MISMATCH");
    });
  });

  it("EI-12 a stale commit cannot verify an attestation", async () => {
    await run.scenario("EI-12", "§2.4 mixed commit", (item) => {
      const repo = gitRepo("boss-ei-mixed-commit-");
      const artifacts = acceptanceDirectory(repo.root);
      const session = bindSession({ root: repo.root, artifacts, sessionId: "session-commit", commit: repo.sha });
      const reportPath = writeReport(artifacts, WORKBOOK.report_file, cleanGateReport(WORKBOOK));
      const report = readJsonFile(reportPath);
      const validation = validateGateReport({ gate: WORKBOOK.gate, contract: WORKBOOK, report });
      const attestation = buildGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session,
        source_sha256: sha256File(reportPath),
        validation,
        attested_at: new Date().toISOString()
      });
      const otherCommit = { ...session, commit_sha: "0".repeat(40) };
      const problems = verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session: otherCommit,
        attestation,
        report,
        source_sha256: sha256File(reportPath)
      });
      item.check("the commit mismatch is named", true, problems.some((problem) => problem.startsWith("ATTESTATION_COMMIT_MISMATCH")));
      item.check("the attestation itself is internally consistent", 0, verifyGateAttestation({
        gate: WORKBOOK.gate,
        contract: WORKBOOK,
        session,
        attestation,
        report,
        source_sha256: sha256File(reportPath)
      }).length);
      item.cite("ATTESTATION_COMMIT_MISMATCH");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "evidence-integrity.json", { checkpoint: "CP19" });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
