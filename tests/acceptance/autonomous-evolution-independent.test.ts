/**
 * Update-Plan/self-evlo.md §17/§18/§19/§22/§37/§76 — Validator B (VB-01..VB-12).
 *
 * Every scenario drives the real, independent verifier
 * (`scripts/acceptance-evolution-certificate.cjs`) as a child process over a real
 * artifact directory built from `trustedFixture()`: real reports, real attestations,
 * real hashes, a real session, a real Owner ledger and a real bootstrap record. The
 * assertions are made on the verifier's exit code and on the machine-readable verdict
 * it prints, never on a mocked decision (§9.3).
 *
 * The verifier is Validator B: it shares no code with the TypeScript root auditor, so
 * a disagreement between the two is a signal rather than a coincidence.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts, cleanGateReport } from "../helpers/acceptance-report";
import { cleanupFixtures, gitRepo, revParse, tempDir } from "../helpers/root-fixtures";
import { FIXTURE_INSTANT, FIXTURE_TREE, trustedFixture, type TrustedFixture } from "../helpers/trusted-evidence";
import {
  ACCEPTANCE_SUPPORTING_CONTRACTS,
  type AcceptanceGateContract
} from "../../src/shared/acceptance-contracts";
import {
  buildGateAttestation,
  canonicalJson,
  canonicalSha256,
  validateGateReport,
  type AcceptanceSession
} from "../../src/shared/acceptance-evidence";
import type { TrustedBootstrapAudit } from "../../src/shared/bootstrap-audit";

const run = new AcceptanceRun("AUTONOMOUS_EVOLUTION_INDEPENDENT");
const REPORT_DIR = acceptanceArtifacts();
const SCRIPT = path.join(process.cwd(), "scripts", "acceptance-evolution-certificate.cjs");

const SUPPORTING = ACCEPTANCE_SUPPORTING_CONTRACTS;

/* ------------------------------------------------------------------ *
 * small local helpers
 * ------------------------------------------------------------------ */

function sha256File(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

function writeFile(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function readJsonFile<T = Record<string, unknown>>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ *
 * the verifier as a child process
 * ------------------------------------------------------------------ */

interface VerdictCheck {
  name: string;
  verdict: string;
  detail: string;
}

interface Verdict {
  verified: boolean;
  checks: VerdictCheck[];
  certificate_sha256: string;
  root_hash: string;
  commit_sha: string;
  tree_sha: string;
  evidence_mode: string;
  notes: string[];
}

interface Verification {
  status: number;
  stdout: string;
  stderr: string;
  verdict: Verdict;
  jsonText: string;
}

/** Runs the real verifier and returns its exit code, output and parsed verdict. */
function verify(args: string[]): Verification {
  const outFile = path.join(tempDir("boss-verify-out-"), "verdict.json");
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--json", "--out", outFile], { encoding: "utf8" });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  expect(fs.existsSync(outFile), `the verifier wrote no verdict file (stderr: ${stderr})`).toBe(true);
  const jsonText = fs.readFileSync(outFile, "utf8");
  const verdict = JSON.parse(jsonText) as Verdict;
  // The machine-readable verdict is also the final stdout block.
  expect(stdout.replace(/\r\n/g, "\n").endsWith(jsonText.replace(/\r\n/g, "\n"))).toBe(true);
  return { status: result.status ?? -1, stdout, stderr, verdict, jsonText };
}

function checkOf(verification: Verification, name: string): VerdictCheck {
  const check = verification.verdict.checks.find((entry) => entry.name === name);
  expect(check, `the verifier reported no "${name}" check`).toBeDefined();
  return check!;
}

function failDetail(verification: Verification): string {
  return verification.verdict.checks
    .filter((entry) => entry.verdict === "FAIL")
    .map((entry) => `${entry.name}: ${entry.detail}`)
    .join(" | ");
}

const CHECK_NAMES = [
  "certificate schema",
  "certificate state",
  "root hash",
  "session",
  "git identity",
  "gate attestations",
  "gate reports",
  "owner ledger",
  "source manifest",
  "bootstrap record",
  "adversarial acceptance",
  "supporting suites",
  "verdict"
];

/* ------------------------------------------------------------------ *
 * the certificate fixture, built the way the generator builds it
 * ------------------------------------------------------------------ */

function supportingReport(contract: AcceptanceGateContract): Record<string, unknown> {
  const report = cleanGateReport(contract) as unknown as Record<string, unknown>;
  report.generatedAt = FIXTURE_INSTANT;
  if (contract.gate === "acceptance-adversarial") {
    report.false_positive_cases = 0;
    report.false_positive_ids = [];
    report.positive_control = "BOOTSTRAP_COMPLETE";
  }
  return report;
}

interface CertificateFixture extends TrustedFixture {
  audit: TrustedBootstrapAudit;
  supporting: readonly AcceptanceGateContract[];
  certificateFile: string;
  bootstrapRecordFile: string;
  supportingReportFile(gate: string): string;
  supportingAttestationFile(gate: string): string;
  writeSupportingReport(gate: string, report: unknown): string;
  attestSupporting(gate: string): void;
  /** Re-seals the certificate, optionally over another session or a mutated body. */
  rebuild(options?: { session?: AcceptanceSession; mutate?: (body: Record<string, unknown>) => void; tamperRootHash?: string }): Record<string, unknown>;
}

function certificateBody(input: {
  root: string;
  artifacts: string;
  session: AcceptanceSession;
  audit: TrustedBootstrapAudit;
  supporting: readonly AcceptanceGateContract[];
}): Record<string, unknown> {
  const { root, artifacts, session, audit, supporting } = input;
  const manifest = [
    ...audit.sources.map((source) => ({
      kind: source.kind,
      gate: source.gate,
      report: relative(root, path.join(artifacts, source.report_file)),
      sha256: source.report_sha256,
      attestation: source.attestation_file ? relative(root, path.join(artifacts, source.attestation_file)) : "",
      attestation_sha256: source.attestation_sha256
    })),
    ...supporting.map((contract) => {
      const reportFile = path.join(artifacts, contract.report_file);
      const attestationFile = path.join(artifacts, "attestations", `${contract.gate}.json`);
      return {
        kind: "supporting",
        gate: contract.gate,
        report: relative(root, reportFile),
        sha256: sha256File(reportFile),
        attestation: relative(root, attestationFile),
        attestation_sha256: sha256File(attestationFile)
      };
    })
  ];
  return {
    schemaVersion: 1,
    state: "PRESTART_CERTIFIED",
    bootstrap: "BOOTSTRAP_COMPLETE",
    session_id: session.session_id,
    commit_sha: session.commit_sha,
    tree_sha: session.tree_sha ?? "",
    graduate_identity: {
      commit_sha: session.commit_sha,
      tree_sha: session.tree_sha ?? "",
      worktree_clean: true,
      index_clean: true,
      checked_at: FIXTURE_INSTANT,
      problems: []
    },
    gates: { passed: audit.gates_passed, required: audit.gates_required },
    desktop_black_box: {
      contract_version: audit.desktop.contract,
      passed: audit.desktop.verdict === "PASS",
      verified_claims: audit.desktop.verified_claims,
      required_claims: audit.desktop.required_claims
    },
    capabilities: { established: audit.capabilities.passed, required: audit.capabilities.required },
    owner_interventions: audit.owner_interventions,
    owner_intervention_ledger: {
      file: "owner-interventions.json",
      sha256: audit.owner_intervention_ledger.sha256,
      hash: audit.owner_intervention_ledger.hash,
      events: audit.owner_intervention_ledger.events
    },
    provenance: audit.provenance,
    adversarial_acceptance: {
      passed: true,
      false_positive_cases: 0,
      report_sha256: sha256File(path.join(artifacts, "prestart-adversarial.json"))
    },
    supporting_evidence: supporting.map((contract) => ({
      gate: contract.gate,
      contract_version: contract.contract_version,
      verdict: "PASS",
      required_ids: contract.required_ids.length,
      verified_ids: contract.required_ids.length,
      report_sha256: sha256File(path.join(artifacts, contract.report_file)),
      attestation_sha256: sha256File(path.join(artifacts, "attestations", `${contract.gate}.json`)),
      problems: []
    })),
    bootstrap_record: {
      file: "bootstrap-completion.json",
      sha256: sha256File(path.join(artifacts, "bootstrap-completion.json")),
      root_hash: audit.root_hash,
      problems: []
    },
    sources: manifest,
    reasons: []
  };
}

/** A complete, independently produced certificate over a real trusted evidence set. */
function trustedCertificate(options: { sessionId?: string; commit?: string; tree?: string } = {}): CertificateFixture {
  const fixture = trustedFixture(options);
  const audit = fixture.evaluate();
  const certificateFile = path.join(fixture.artifacts, "prestart-attestation.json");
  const bootstrapRecordFile = path.join(fixture.artifacts, "bootstrap-completion.json");

  const supportingReportFile = (gate: string): string => {
    const contract = SUPPORTING.find((entry) => entry.gate === gate)!;
    return path.join(fixture.artifacts, contract.report_file);
  };
  const supportingAttestationFile = (gate: string): string => path.join(fixture.artifacts, "attestations", `${gate}.json`);

  const writeSupportingReport = (gate: string, report: unknown): string =>
    writeFile(supportingReportFile(gate), `${JSON.stringify(report, null, 2)}\n`);

  const attestSupporting = (gate: string): void => {
    const contract = SUPPORTING.find((entry) => entry.gate === gate)!;
    const reportFile = supportingReportFile(gate);
    const report = readJsonFile(reportFile);
    const validation = validateGateReport({ gate, contract, report });
    const attestation = buildGateAttestation({
      gate,
      contract,
      session: fixture.session,
      source_sha256: sha256File(reportFile),
      validation,
      attested_at: new Date(0).toISOString()
    });
    writeFile(supportingAttestationFile(gate), `${canonicalJson(attestation)}\n`);
  };

  // The ten trust-boundary suites the generator attests exactly like the gates.
  for (const contract of SUPPORTING) {
    writeSupportingReport(contract.gate, supportingReport(contract));
    attestSupporting(contract.gate);
  }

  const rebuild: CertificateFixture["rebuild"] = (rebuildOptions = {}) => {
    const session = rebuildOptions.session ?? fixture.session;
    const body = certificateBody({ root: fixture.root, artifacts: fixture.artifacts, session, audit, supporting: SUPPORTING });
    if (rebuildOptions.mutate) rebuildOptions.mutate(body);
    const certificate = {
      ...body,
      root_hash: rebuildOptions.tamperRootHash ?? canonicalSha256(body),
      certified_at: FIXTURE_INSTANT
    };
    writeFile(certificateFile, `${canonicalJson(certificate)}\n`);
    return certificate;
  };
  rebuild();

  return {
    ...fixture,
    audit,
    supporting: SUPPORTING,
    certificateFile,
    bootstrapRecordFile,
    supportingReportFile,
    supportingAttestationFile,
    writeSupportingReport,
    attestSupporting,
    rebuild
  };
}

/** The arguments every fixture run needs: the fixture is its own root. */
function fixtureArgs(fixture: CertificateFixture, extra: string[] = []): string[] {
  return ["--root", fixture.root, "--artifacts", fixture.artifacts, "--allow-no-git", ...extra];
}

/* ------------------------------------------------------------------ *
 * VB-01 .. VB-12
 * ------------------------------------------------------------------ */
describe("self-evlo §17/§18/§76 Validator B — the independent certificate verifier", () => {
  it("VB-01 the independently built fixtures verify VALID", async () => {
    await run.scenario("VB-01", "§18 a second implementation accepts a complete certificate", (item) => {
      const fixture = trustedCertificate();
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits zero", 0, result.status);
      item.check("and reports VERIFIED", true, result.verdict.verified);
      item.check("the verdict line is CERTIFICATE_VALID", true, result.stdout.includes("[verify] CERTIFICATE_VALID"));
      item.check("every check the brief requires is reported", CHECK_NAMES.join(","), result.verdict.checks.map((entry) => entry.name).join(","));
      item.check("the whole evidence set was re-hashed", "FULL", result.verdict.evidence_mode);
      item.check("the root hash is recomputed from the body", "OK", checkOf(result, "root hash").verdict);
      item.check("all gate attestations verify", "OK", checkOf(result, "gate attestations").verdict);
      item.check("all reports re-validate", "OK", checkOf(result, "gate reports").verdict);
      item.check("the manifest re-hashes from disk", "OK", checkOf(result, "source manifest").verdict);
      item.check("the trust-boundary suites pass", "OK", checkOf(result, "supporting suites").verdict);
      item.check("git is honestly NOT_CHECKED, not faked", "NOT_CHECKED", checkOf(result, "git identity").verdict);

      // The same certificate in a real git checkout: HEAD and the tree are re-read.
      const repo = gitRepo("boss-vb-git-");
      const tree = revParse(repo.root, "HEAD^{tree}");
      const checked = trustedCertificate({ commit: repo.sha, tree });
      const gitResult = verify(["--root", repo.root, "--artifacts", checked.artifacts]);
      item.check("with a repository the verifier re-reads git", "OK", checkOf(gitResult, "git identity").verdict);
      item.check("and still certifies the fixture", 0, gitResult.status);
      item.check("HEAD is bound to the certified commit", repo.sha, gitResult.verdict.commit_sha);
      item.check("and the tree", tree, gitResult.verdict.tree_sha);
      item.cite("scripts/acceptance-evolution-certificate.cjs");
    });
  });

  it("VB-02 a tampered root hash is INVALID while the state field stands", async () => {
    await run.scenario("VB-02", "§97 the seal is the digest, not the state", (item) => {
      const fixture = trustedCertificate();
      const certificate = readJsonFile(fixture.certificateFile);
      const choices = verify(fixtureArgs(fixture)).verdict;
      expect(choices.verified).toBe(true);
      // Break nothing but the seal: the state field stays exactly as written.
      rebuildWithRootHash(fixture, canonicalSha256({ tampered: true }));
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the root hash check fails", "FAIL", checkOf(result, "root hash").verdict);
      item.check("naming the recorded and recomputed digests", true, /recorded [0-9a-f]{16}/.test(checkOf(result, "root hash").detail));
      item.check("the certificate still claims PRESTART_CERTIFIED", "PRESTART_CERTIFIED", certificate.state);
      item.check("and the verifier prints that state without believing it", true,
        checkOf(result, "certificate state").detail.startsWith("PRESTART_CERTIFIED")
        && checkOf(result, "certificate state").detail.includes("ignored as evidence — §19"));
      item.cite("root_hash");
    });
  });

  it("VB-03 a hand-edited state does not rescue a broken certificate", async () => {
    await run.scenario("VB-03", "§19/§76 state is derived output, never input truth", (item) => {
      // A whole re-sealed forgery: the missing attestation is re-hashed into the body,
      // so the seal is valid and only the evidence decides.
      const fixture = trustedCertificate();
      fs.rmSync(fixture.attestationFile("acceptance-publish"), { force: true });
      const forged = fixture.rebuild({ mutate: (body) => { body.state = "PRESTART_CERTIFIED"; } });
      item.check("the forged seal recomputes", canonicalSha256(withoutSeal(forged)), forged.root_hash);
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("because the evidence is gone, not because of the state", "FAIL", checkOf(result, "gate attestations").verdict);
      item.check("the state is printed as information", true, checkOf(result, "certificate state").detail.startsWith("PRESTART_CERTIFIED"));

      // The other shape of the same attack: a body that certifies while recording reasons.
      const second = trustedCertificate();
      second.rebuild({ mutate: (body) => { body.reasons = ["§7: 1 Owner intervention(s) were needed"]; } });
      const reasonsResult = verify(fixtureArgs(second));
      item.check("a body that records reasons is INVALID even re-sealed", 1, reasonsResult.status);
      item.check("and the schema check says so", true, checkOf(reasonsResult, "certificate schema").detail.includes("reason(s)"));
      item.check("while the printed state still reads PRESTART_CERTIFIED", true, checkOf(reasonsResult, "certificate state").detail.startsWith("PRESTART_CERTIFIED"));
      item.cite("§19 derived output");
    });
  });

  it("VB-04 a report changed after attestation is INVALID", async () => {
    await run.scenario("VB-04", "§2.7/§22 a source change invalidates its derived hashes", (item) => {
      const fixture = trustedCertificate();
      const contract = fixture.gateContracts.find((entry) => entry.gate === "acceptance-verify")!;
      const tampered = cleanGateReport(contract) as unknown as Record<string, unknown>;
      tampered.generatedAt = FIXTURE_INSTANT;
      tampered.unit = "TAMPERED_AFTER_ATTESTATION";
      writeFile(fixture.reportFile("acceptance-verify"), `${JSON.stringify(tampered, null, 2)}\n`);
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the manifest check fails", "FAIL", checkOf(result, "source manifest").verdict);
      item.check("naming the gate and the mismatch", true, /acceptance-verify/.test(checkOf(result, "source manifest").detail)
        && /source hash mismatch/.test(checkOf(result, "source manifest").detail));
      item.check("and the attestation no longer matches its source", true, /SOURCE_HASH_MISMATCH/.test(failDetail(result)));

      // §22 metamorphic: one byte in any other trusted source must also break the seal.
      const supporting = trustedCertificate();
      const evidenceReport = supporting.supportingReportFile("acceptance-evidence-integrity");
      fs.appendFileSync(evidenceReport, " ");
      const supportingResult = verify(fixtureArgs(supporting));
      item.check("one byte in a supporting report is INVALID", 1, supportingResult.status);
      item.check("and the suite is named", true, /acceptance-evidence-integrity/.test(failDetail(supportingResult)));

      const record = trustedCertificate();
      const recordJson = readJsonFile(record.bootstrapRecordFile);
      recordJson.audited_at = "2000-01-01T00:00:00.000Z";
      writeFile(record.bootstrapRecordFile, `${JSON.stringify(recordJson, null, 2)}\n`);
      const recordResult = verify(fixtureArgs(record));
      item.check("one byte in the bootstrap record is INVALID", 1, recordResult.status);
      item.check("because the certificate sealed its digest", "FAIL", checkOf(recordResult, "bootstrap record").verdict);
      item.cite("SOURCE_HASH_MISMATCH");
    });
  });

  it("VB-05 a deleted attestation is INVALID", async () => {
    await run.scenario("VB-05", "§5.5 evidence is the attestation, not the report", (item) => {
      const fixture = trustedCertificate();
      fs.rmSync(fixture.attestationFile("acceptance-soak"), { force: true });
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the gate attestation check fails", "FAIL", checkOf(result, "gate attestations").verdict);
      item.check("naming the missing attestation", true, /acceptance-soak/.test(checkOf(result, "gate attestations").detail)
        && /missing/.test(checkOf(result, "gate attestations").detail));
      item.check("and the manifest binding fails with it", "FAIL", checkOf(result, "source manifest").verdict);
      item.cite("attestations/<gate>.json");
    });
  });

  it("VB-06 a certificate from another session is INVALID", async () => {
    await run.scenario("VB-06", "§2.3 same session", (item) => {
      const fixture = trustedCertificate();
      const other = trustedCertificate({ sessionId: "session-other-run", commit: "d".repeat(40) });
      fs.copyFileSync(path.join(other.artifacts, "session.json"), path.join(fixture.artifacts, "session.json"));
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the session check fails", "FAIL", checkOf(result, "session").verdict);
      item.check("naming the other session", true, checkOf(result, "session").detail.includes("session-other-run"));
      item.check("the manifest's session entry fails too", "FAIL", checkOf(result, "source manifest").verdict);
      item.cite("ATTESTATION_SESSION_MISMATCH");
    });
  });

  it("VB-07 a certificate from another commit is INVALID", async () => {
    await run.scenario("VB-07", "§2.4 same commit", (item) => {
      const fixture = trustedCertificate();
      const otherCommit = "d".repeat(40);
      const rebound = fixture.rebindSession({ commit_sha: otherCommit });
      fixture.rebuild({ session: rebound });
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the certificate names the other commit", otherCommit, result.verdict.commit_sha);
      item.check("the attestations refuse it", true, /commit/.test(failDetail(result)) && /ATTESTATION_COMMIT_MISMATCH/.test(failDetail(result)));
      item.check("the bootstrap record refuses it as well", "FAIL", checkOf(result, "bootstrap record").verdict);
      item.cite("ATTESTATION_COMMIT_MISMATCH");
    });
  });

  it("VB-08 a tampered owner ledger is INVALID", async () => {
    await run.scenario("VB-08", "§7.5 the count is derived, the digest is not optional", (item) => {
      const fixture = trustedCertificate();
      const ledgerFile = path.join(fixture.artifacts, "owner-interventions.json");
      const ledger = readJsonFile(ledgerFile);
      const events = ledger.events as Record<string, unknown>[];
      events.push({
        id: `OI-${String(events.length + 1).padStart(4, "0")}`,
        at: FIXTURE_INSTANT,
        source: "acceptance-run",
        blocker_class: "ENGINEERING_REQUEST",
        reason: "the Owner was asked how to proceed",
        requested_action: "decide how the engineering run should proceed",
        outcome: "RECORDED"
      });
      ledger.count = events.length;
      // The count is updated, the digest is not: exactly the §7.5 forgery.
      writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the ledger check fails", "FAIL", checkOf(result, "owner ledger").verdict);
      item.check("naming the recomputed digest", true, /digest does not recompute/.test(checkOf(result, "owner ledger").detail));
      item.check("and the intervention that appeared is named", true, /Owner intervention/.test(checkOf(result, "owner ledger").detail));
      item.cite("ledger_hash");
    });
  });

  it("VB-09 an adversarial report with a false positive is INVALID", async () => {
    await run.scenario("VB-09", "§20/§76 zero false positives is a rule, not a field", (item) => {
      const fixture = trustedCertificate();
      const contract = SUPPORTING.find((entry) => entry.gate === "acceptance-adversarial")!;
      const report = supportingReport(contract);
      report.false_positive_cases = 1;
      report.false_positive_ids = ["AD-07"];
      fixture.writeSupportingReport("acceptance-adversarial", report);
      // Re-attest and re-seal: every hash in the chain agrees, only the rule is broken.
      fixture.attestSupporting("acceptance-adversarial");
      const sealed = fixture.rebuild();
      const manifest = (sealed.sources as Record<string, unknown>[]).find((entry) => entry.gate === "acceptance-adversarial")!;
      item.check("the re-forged bundle is internally consistent", sha256File(fixture.supportingReportFile("acceptance-adversarial")), manifest.sha256);
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the adversarial check fails", "FAIL", checkOf(result, "adversarial acceptance").verdict);
      item.check("naming the false positive", true, /false_positive_cases=1/.test(checkOf(result, "adversarial acceptance").detail));
      item.check("even though all its hashes were rebuilt", "OK", checkOf(result, "source manifest").verdict);
      item.cite("false_positive_cases === 0");
    });
  });

  it("VB-10 a missing supporting-suite attestation is INVALID", async () => {
    await run.scenario("VB-10", "§5.6 the trust-boundary suites are attested like the gates", (item) => {
      const fixture = trustedCertificate();
      item.check("the suite is attested before the attack", true, fs.existsSync(fixture.supportingAttestationFile("acceptance-root-hardening")));
      fs.rmSync(fixture.supportingAttestationFile("acceptance-root-hardening"), { force: true });
      const result = verify(fixtureArgs(fixture));
      item.check("the verifier exits non-zero", 1, result.status);
      item.check("and reports INVALID", false, result.verdict.verified);
      item.check("the supporting suites check fails", "FAIL", checkOf(result, "supporting suites").verdict);
      item.check("naming the suite and the missing attestation", true, /acceptance-root-hardening/.test(checkOf(result, "supporting suites").detail)
        && /missing/.test(checkOf(result, "supporting suites").detail));
      item.check("the gate attestation check agrees", "FAIL", checkOf(result, "gate attestations").verdict);
      item.cite("acceptance-root-hardening");
    });
  });

  it("VB-11 the verifier is independent of the trust modules", async () => {
    await run.scenario("VB-11", "§17 Validator B shares no judgement with Validator A", (item) => {
      const source = fs.readFileSync(SCRIPT, "utf8");
      const requires = [...source.matchAll(/require\(\s*([^)]*?)\s*\)/g)].map((match) => match[1]);
      item.check("the script requires something", true, requires.length > 0);
      const foreign = requires.filter((target) => !(target.startsWith('"node:') || /^[A-Za-z_$][\w$]*$/.test(target)));
      item.check("every require is a node builtin or a computed variable", "", foreign.join(","));
      item.check("the only literal requires are node builtins", "node:fs,node:path,node:crypto,node:child_process",
        requires.filter((target) => target.startsWith('"')).map((target) => target.slice(1, -1)).join(","));
      item.check("no repository module is required by path", false, /require\([^)]*(?:src\/|electron\/)/.test(source));
      item.check("the evidence layer is never loaded", false, /acceptance-evidence\.js/.test(source));
      item.check("the generator is never invoked", false, /acceptance-prestart/.test(source));
      item.check("nor spawned as a child", 0, requires.filter((target) => /prestart/.test(target)).length);
      item.check("it defines its own canonical JSON", true, /function canonicalJson\(/.test(source) && /function canonicalize\(/.test(source));
      item.check("and its own sha256 helpers", true, /function sha256Hex\(/.test(source) && /function canonicalSha256\(/.test(source) && /function sha256File\(/.test(source));
      item.check("it re-reads git through node:child_process", true, /require\("node:child_process"\)/.test(source) && /"rev-parse", "HEAD"/.test(source));

      // Byte-compatibility with the repository's own canonical form, proven on the real
      // certificate: the verifier's recomputed digest must equal the TypeScript one.
      const fixture = trustedCertificate();
      const certificate = readJsonFile(fixture.certificateFile);
      const expected = canonicalSha256(withoutSeal(certificate));
      const result = verify(fixtureArgs(fixture));
      item.check("the two implementations agree byte for byte", expected, certificate.root_hash);
      item.check("and the verifier reports the same digest", expected, result.verdict.root_hash);
      item.check("which is the certificate file's own digest", sha256File(fixture.certificateFile), result.verdict.certificate_sha256);

      // Before the first build there is no compiled contract module: the verifier must
      // re-derive the rules from the checked-in source alone and still agree.
      const sourceOnly = tempDir("boss-vb-contract-source-");
      for (const name of ["acceptance-contracts.ts", "desktop-black-box-contract.ts"]) {
        writeFile(path.join(sourceOnly, "src", "shared", name), fs.readFileSync(path.join(process.cwd(), "src", "shared", name), "utf8"));
      }
      const noBuild = trustedCertificate();
      const sourceResult = verify(["--root", sourceOnly, "--artifacts", noBuild.artifacts, "--allow-no-git"]);
      item.check("without a build the contract source is enough", 0, sourceResult.status);
      item.check("and no compiled module was needed", true, sourceResult.verdict.notes.some((text) => text.includes("acceptance-contracts.ts")));
      item.check("with every gate still verified", "OK", checkOf(sourceResult, "gate attestations").verdict);
      item.check("and the desktop claim contract re-derived", true, sourceResult.verdict.notes.some((text) => text.includes("89 claims")));
      item.cite("canonicalJson equivalence");
    });
  });

  it("VB-12 the verdict is reproducible and does not touch the certificate", async () => {
    await run.scenario("VB-12", "§37 the same evidence yields the same verdict", (item) => {
      const fixture = trustedCertificate();
      const before = sha256File(fixture.certificateFile);
      const first = verify(fixtureArgs(fixture));
      const second = verify(fixtureArgs(fixture));
      item.check("both runs verify", 0, first.status);
      item.check("twice over the same directory", 0, second.status);
      item.check("with byte-identical verdicts", first.jsonText, second.jsonText);
      item.check("the certificate is untouched by verification", before, sha256File(fixture.certificateFile));
      item.check("and its root hash is unchanged", first.verdict.root_hash, second.verdict.root_hash);
      item.check("the verdict carries no timestamp", false, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(first.jsonText));
      item.check("the verdict names the certified identity", fixture.session.commit_sha, first.verdict.commit_sha);
      item.check("and the tree", FIXTURE_TREE, first.verdict.tree_sha);
      item.cite("reproducibility.json");
    });
  });
}, 120_000);

/* ------------------------------------------------------------------ *
 * helpers that need the module scope
 * ------------------------------------------------------------------ */

/** The certificate body as §97 defines it: everything except the seal and the clock. */
function withoutSeal(certificate: Record<string, unknown>): Record<string, unknown> {
  const body = { ...certificate };
  delete body.root_hash;
  delete body.certified_at;
  return body;
}

/** Rewrites the certificate with a chosen root hash, leaving every other field alone. */
function rebuildWithRootHash(fixture: CertificateFixture, rootHash: string): void {
  const certificate = readJsonFile(fixture.certificateFile);
  writeFile(fixture.certificateFile, `${canonicalJson({ ...certificate, root_hash: rootHash })}\n`);
}

afterAll(() => {
  const report = run.write(REPORT_DIR, "evolution-independent.json", {
    checkpoint: "PHASE_D",
    gate: "acceptance-evolution-independent",
    plan: "Update-Plan/self-evlo.md"
  });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
