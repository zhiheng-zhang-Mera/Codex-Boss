#!/usr/bin/env node
/**
 * Update-Plan/checkpoint-2.md §10.4/§11/§12 — the single authoritative Prestart
 * Graduation command.
 *
 *   node scripts/acceptance-prestart.cjs
 *
 * It performs, in order: session integrity, the trusted root audit over the sixteen
 * attested gate reports and the desktop black box, the trust-boundary suites
 * (evidence integrity, desktop contract, owner ledger, root hardening, adversarial
 * mutation defense), the Owner intervention ledger, the source manifest with its
 * hashes, and the final certificate. It prints PRESTART_CERTIFIED /
 * BOOTSTRAP_COMPLETE only when every one of those holds, and exits non-zero
 * otherwise — there is no warning mode.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = process.cwd();
const artifacts = path.join(root, "artifacts", "acceptance");
const dist = path.join(root, "dist-electron");
const modules = {
  contracts: path.join(dist, "src", "shared", "acceptance-contracts.js"),
  evidence: path.join(dist, "src", "shared", "acceptance-evidence.js"),
  audit: path.join(dist, "electron", "engineering", "bootstrap-completion.js"),
  session: path.join(dist, "electron", "engineering", "acceptance-session.js"),
  ledger: path.join(dist, "electron", "engineering", "owner-intervention-ledger.js"),
  atomic: path.join(dist, "electron", "engineering", "atomic-file.js")
};
for (const [name, file] of Object.entries(modules)) {
  if (!fs.existsSync(file)) {
    console.error(`[prestart] the built ${name} module is missing (run \`pnpm run build\` first): ${file}`);
    process.exit(1);
  }
}
const { ACCEPTANCE_SUPPORTING_CONTRACTS, DESKTOP_BLACK_BOX_GATE } = require(modules.contracts);
const { canonicalJson, canonicalSha256, validateGateReport, verifyGateAttestation } = require(modules.evidence);
const { createBootstrapAuditor } = require(modules.audit);
const { inspectSession, readJsonFile } = require(modules.session);
const { OWNER_LEDGER_FILE } = require(modules.ledger);
const { readGitIdentity } = require(modules.session);
const { writeFileAtomicSync, hashOnceStable } = require(modules.atomic);

const PRESTART_SCHEMA_VERSION = 1;
const PRESTART_ATTESTATION = "prestart-attestation.json";
const BOOTSTRAP_RECORD = "bootstrap-completion.json";

function sha256File(file) {
  try { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch { return ""; }
}
function rel(file) { return path.relative(root, file).split(path.sep).join("/"); }
function line(label, value) { console.log(`[prestart] ${label.padEnd(20)} ${value}`); }

/* ------------------------------------------------------------------ *
 * 1. session integrity
 * ------------------------------------------------------------------ */
const sessionInspection = inspectSession(artifacts);
const session = sessionInspection.session;
console.log(`[prestart] certification session: ${session ? session.session_id : "(none)"}`);
console.log(`[prestart] commit: ${session ? session.commit_sha : "(none)"}`);
if (!session) {
  console.error(`[prestart] session integrity FAILED: ${sessionInspection.problems.join(", ")}`);
  console.error("[prestart] PRESTART_INCOMPLETE");
  process.exit(1);
}
if (session.certification_mode !== true) {
  console.error("[prestart] session integrity FAILED: this is a development session; only a certification session started with `acceptance:session:start -- --certify` can graduate Prestart");
  console.error("[prestart] PRESTART_INCOMPLETE");
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 2. §5/§6 graduation-time identity lock (TOCTOU close)
 * ------------------------------------------------------------------ */
const identity = readGitIdentity(root);
const identityProblems = [];
if (identity.commit_sha !== session.commit_sha) identityProblems.push(`CURRENT_HEAD_MISMATCH:${identity.commit_sha || "unknown"}!=${session.commit_sha}`);
if (session.tree_sha) {
  if (identity.tree_sha !== session.tree_sha) identityProblems.push(`CURRENT_TREE_MISMATCH:${identity.tree_sha || "unknown"}!=${session.tree_sha}`);
} else {
  identityProblems.push("SESSION_TREE_MISSING");
}
if (!identity.worktree_clean) identityProblems.push("WORKTREE_DIRTY_AT_GRADUATION");
if (!identity.index_clean) identityProblems.push("INDEX_DIRTY_AT_GRADUATION");
for (const problem of identityProblems) console.error(`[prestart] identity ${problem}`);

/* ------------------------------------------------------------------ *
 * 3. the trusted root audit (16 gates + desktop + ledger + session)
 * ------------------------------------------------------------------ */
/* §2.8: read the record an earlier step wrote FIRST, then recompute. An auditor that
 * rewrites the record before comparing it can never fail that comparison. */
const storedRecordPath = path.join(artifacts, BOOTSTRAP_RECORD);
const storedRecord = readJsonFile(storedRecordPath);
const audit = createBootstrapAuditor({ root, write: false }).evaluate().audit;
const recordProblems = [];
if (!storedRecord) recordProblems.push("BOOTSTRAP_RECORD_MISSING");
else {
  if (storedRecord.root_hash !== audit.root_hash) recordProblems.push("BOOTSTRAP_RECORD_ROOT_HASH_MISMATCH");
  if (storedRecord.decision !== audit.decision) recordProblems.push("BOOTSTRAP_RECORD_DECISION_MISMATCH");
  if (storedRecord.session_id !== session.session_id) recordProblems.push("BOOTSTRAP_RECORD_SESSION_MISMATCH");
}

/* ------------------------------------------------------------------ *
 * 3. the trust-boundary suites, attested exactly like the gates
 * ------------------------------------------------------------------ */
const supporting = ACCEPTANCE_SUPPORTING_CONTRACTS.map((contract) => {
  const reportFile = path.join(artifacts, contract.report_file);
  const attestationFile = path.join(artifacts, "attestations", `${contract.gate}.json`);
  const reportSha256 = sha256File(reportFile);
  const report = readJsonFile(reportFile);
  const attestation = readJsonFile(attestationFile);
  const validation = validateGateReport({ gate: contract.gate, contract, report });
  const problems = [...validation.reasons];
  if (reportSha256 === "") problems.unshift("REPORT_FILE_MISSING");
  problems.push(...verifyGateAttestation({
    gate: contract.gate,
    contract,
    session,
    attestation,
    report,
    source_sha256: reportSha256
  }));
  return {
    gate: contract.gate,
    contract_version: contract.contract_version,
    report_file: contract.report_file,
    report_sha256: reportSha256,
    attestation_file: `attestations/${contract.gate}.json`,
    attestation_sha256: sha256File(attestationFile),
    verdict: problems.length ? "FAIL" : "PASS",
    required_ids: contract.required_ids.length,
    verified_ids: validation.counts.pass,
    false_positive_cases: typeof (report && report.false_positive_cases) === "number" ? report.false_positive_cases : null,
    problems
  };
});
const supportingById = new Map(supporting.map((entry) => [entry.gate, entry]));
const adversarial = supportingById.get("acceptance-adversarial");
const mutationDefense = [];
if (!adversarial || adversarial.verdict !== "PASS") mutationDefense.push("the adversarial acceptance suite is not attested as PASS");
else {
  if (adversarial.false_positive_cases !== 0) mutationDefense.push(`false_positive_cases=${String(adversarial.false_positive_cases)}`);
  const report = readJsonFile(path.join(artifacts, "prestart-adversarial.json"));
  if (!report || !Array.isArray(report.false_positive_ids) || report.false_positive_ids.length !== 0) mutationDefense.push("the adversarial report lists accepted mutations");
  if (!report || report.positive_control !== "BOOTSTRAP_COMPLETE") mutationDefense.push("the adversarial report has no accepted positive control");
}

/* ------------------------------------------------------------------ *
 * 4. source manifest re-verification (§8.4/§2.7)
 * ------------------------------------------------------------------ */
const manifestProblems = [];
const manifest = audit.sources.map((source) => {
  const absolute = path.join(artifacts, source.report_file);
  const current = sha256File(absolute);
  if (source.report_file === "" || current === "") manifestProblems.push(`${source.gate}: the source file is missing`);
  else if (current !== source.report_sha256) manifestProblems.push(`${source.gate}: the source changed after the audit`);
  return {
    kind: source.kind,
    gate: source.gate,
    report: rel(absolute),
    sha256: source.report_sha256,
    attestation: source.attestation_file ? rel(path.join(artifacts, source.attestation_file)) : "",
    attestation_sha256: source.attestation_sha256
  };
});
for (const entry of supporting) {
  manifest.push({
    kind: "supporting",
    gate: entry.gate,
    report: rel(path.join(artifacts, entry.report_file)),
    sha256: entry.report_sha256,
    attestation: rel(path.join(artifacts, entry.attestation_file)),
    attestation_sha256: entry.attestation_sha256
  });
}
const sourcesVerified = audit.sources.filter((source) => source.report_sha256 !== "" && source.report_sha256 === sha256File(path.join(artifacts, source.report_file))).length;

/* ------------------------------------------------------------------ *
 * 5. the certificate
 * ------------------------------------------------------------------ */
const reasons = [
  ...identityProblems.map((problem) => `identity: ${problem}`),
  ...recordProblems.map((problem) => `bootstrap record: ${problem}`),
  ...audit.reasons,
  ...mutationDefense.map((problem) => `mutation defense: ${problem}`),
  ...manifestProblems.map((problem) => `manifest: ${problem}`),
  ...supporting.filter((entry) => entry.verdict !== "PASS").flatMap((entry) => entry.problems.slice(0, 3).map((problem) => `${entry.gate}: ${problem}`))
];
const certified = reasons.length === 0;
/* §97: the certificate's own bytes are the sealed object — `root_hash` is the
 * canonical digest of everything except `root_hash` and `certified_at`, so any
 * independent verifier can recompute it from the file alone. */
const attestationBody = {
  schemaVersion: PRESTART_SCHEMA_VERSION,
  state: certified ? "PRESTART_CERTIFIED" : "PRESTART_INCOMPLETE",
  bootstrap: certified ? "BOOTSTRAP_COMPLETE" : "INCOMPLETE",
  session_id: session.session_id,
  commit_sha: session.commit_sha,
  /** §6: the tree is part of the certified identity. */
  tree_sha: session.tree_sha ?? "",
  /** §5: the identity re-read at graduation, not only at session start. */
  graduate_identity: {
    commit_sha: identity.commit_sha,
    tree_sha: identity.tree_sha,
    worktree_clean: identity.worktree_clean,
    index_clean: identity.index_clean,
    checked_at: new Date().toISOString(),
    problems: identityProblems
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
    file: OWNER_LEDGER_FILE,
    sha256: audit.owner_intervention_ledger.sha256,
    hash: audit.owner_intervention_ledger.hash,
    events: audit.owner_intervention_ledger.events
  },
  provenance: audit.provenance,
  adversarial_acceptance: {
    passed: mutationDefense.length === 0,
    false_positive_cases: adversarial ? adversarial.false_positive_cases : null,
    report_sha256: adversarial ? adversarial.report_sha256 : ""
  },
  supporting_evidence: supporting.map((entry) => ({
    gate: entry.gate,
    contract_version: entry.contract_version,
    verdict: entry.verdict,
    required_ids: entry.required_ids,
    verified_ids: entry.verified_ids,
    report_sha256: entry.report_sha256,
    attestation_sha256: entry.attestation_sha256,
    problems: entry.problems
  })),
  bootstrap_record: { file: BOOTSTRAP_RECORD, sha256: sha256File(storedRecordPath), root_hash: audit.root_hash, problems: recordProblems },
  sources: manifest,
  reasons
};
const rootHash = canonicalSha256(attestationBody);
const attestation = { ...attestationBody, root_hash: rootHash, certified_at: new Date().toISOString() };
fs.mkdirSync(artifacts, { recursive: true });
/* §96: the machine certificate is written atomically — a reader must never see a
 * half-written certificate — and its bytes are re-hashed before the seal is printed. */
writeFileAtomicSync(path.join(artifacts, PRESTART_ATTESTATION), `${canonicalJson(attestation)}\n`);
const certificateStability = hashOnceStable(path.join(artifacts, PRESTART_ATTESTATION));

/* ------------------------------------------------------------------ *
 * 6. the human-readable certificate (§20 deliverable 15)
 * ------------------------------------------------------------------ */
const markdown = [
  "# Prestart certificate",
  "",
  "Documentation records this certification; it does not constitute it. The authority is",
  "`artifacts/acceptance/prestart-attestation.json` inside a successful CI run.",
  "",
  `- State: **${attestation.state}**`,
  `- Bootstrap: **${attestation.bootstrap}**`,
  `- Session: \`${session.session_id}\``,
  `- Commit: \`${session.commit_sha}\``,
  `- Tree: \`${session.tree_sha ?? "(missing)"}\``,
  `- Graduation identity: commit ${identity.commit_sha === session.commit_sha ? "SAME" : "MISMATCH"}, tree ${identity.tree_sha === session.tree_sha ? "SAME" : "MISMATCH"}, worktree ${identity.worktree_clean ? "CLEAN" : "DIRTY"}, index ${identity.index_clean ? "CLEAN" : "DIRTY"}`,
  `- Gates: ${audit.gates_passed}/${audit.gates_required} trusted PASS`,
  `- Desktop black box: ${audit.desktop.verified_claims}/${audit.desktop.required_claims} claims under \`${audit.desktop.contract}\``,
  `- Capabilities: ${audit.capabilities.passed}/${audit.capabilities.required} established`,
  `- Owner interventions: ${audit.owner_interventions}`,
  `- Provenance: same session ${audit.provenance.same_session}, same commit ${audit.provenance.same_commit}, source hashes ${audit.provenance.source_hashes_verified}`,
  `- Adversarial acceptance: ${attestation.adversarial_acceptance.passed ? "PASS" : "FAIL"} (false positives ${String(attestation.adversarial_acceptance.false_positive_cases)})`,
  `- Root hash: \`${rootHash}\``,
  "",
  "## Sources",
  "",
  "| Source | Verdict | SHA-256 |",
  "| --- | --- | --- |",
  ...manifest.map((entry) => `| ${entry.gate} | ${entry.kind} | \`${entry.sha256.slice(0, 16)}…\` |`),
  "",
  ...(reasons.length ? ["## Reasons", "", ...reasons.map((reason) => `- ${reason}`), ""] : [])
].join("\n");
fs.writeFileSync(path.join(artifacts, "prestart-attestation.md"), markdown, "utf8");

/* ------------------------------------------------------------------ *
 * 7. the §10.5 terminal output
 * ------------------------------------------------------------------ */
console.log("");
line("gate evidence", `${audit.gates_passed}/${audit.gates_required} ${audit.gates_passed === audit.gates_required ? "PASS" : "FAIL"}`);
line("source integrity", `${sourcesVerified}/${audit.sources.length} VERIFIED`);
line("graduation identity", identityProblems.length === 0 ? `HEAD+TREE SAME, WORKTREE+INDEX CLEAN` : `FAIL (${identityProblems.length})`);
line("desktop black box", `${audit.desktop.verified_claims}/${audit.desktop.required_claims} ${audit.desktop.verdict === "PASS" ? "PASS" : "FAIL"}`);
line("capabilities", `${audit.capabilities.passed}/${audit.capabilities.required} ${audit.capabilities.passed === audit.capabilities.required ? "ESTABLISHED" : "INCOMPLETE"}`);
line("owner intervention", String(audit.owner_interventions));
line("provenance", `${audit.provenance.same_session ? "SAME_SESSION" : "MIXED_SESSION"} / ${audit.provenance.same_commit ? "SAME_COMMIT" : "MIXED_COMMIT"}`);
line("mutation defense", mutationDefense.length === 0 ? "PASS" : `FAIL (${mutationDefense.length})`);
line("root manifest", manifestProblems.length === 0 && recordProblems.length === 0 ? "VERIFIED" : "INVALID");
line("trust suites", `${supporting.filter((entry) => entry.verdict === "PASS").length}/${supporting.length} PASS`);
console.log("");
line("certificate", rel(path.join(artifacts, PRESTART_ATTESTATION)));
line("root hash", rootHash);
line("certificate file", certificateStability.stable ? "STABLE" : "UNSTABLE");
console.log("");
if (!certified) {
  for (const reason of reasons.slice(0, 10)) console.error(`[prestart]   ${reason}`);
  console.error("[prestart] PRESTART_INCOMPLETE");
  process.exit(1);
}
console.log("[prestart] PRESTART_CERTIFIED");
console.log("[prestart] BOOTSTRAP_COMPLETE");
