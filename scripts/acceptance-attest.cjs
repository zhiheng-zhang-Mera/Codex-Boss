#!/usr/bin/env node
/**
 * Update-Plan/checkpoint-2.md §5.4/§5.5/§10.3 — attest one gate's report.
 *
 *   node scripts/acceptance-attest.cjs acceptance-workbook
 *
 * It strictly validates the report the gate just wrote, binds it to the report's
 * SHA-256, the current session and the current commit, and writes
 * `artifacts/acceptance/attestations/<gate>.json`. A FAIL attestation is written
 * too — with its reasons — and the process exits non-zero, so CI stops before
 * Graduation instead of degrading into a warning.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const gate = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!gate) {
  console.error("[attest] usage: node scripts/acceptance-attest.cjs <gate>");
  process.exit(2);
}
const built = path.join(root, "dist-electron");
const contractsModule = path.join(built, "src", "shared", "acceptance-contracts.js");
const evidenceModule = path.join(built, "src", "shared", "acceptance-evidence.js");
const sessionModule = path.join(built, "electron", "engineering", "acceptance-session.js");
for (const required of [contractsModule, evidenceModule, sessionModule]) {
  if (!fs.existsSync(required)) {
    console.error(`[attest] built module missing (run \`pnpm run build\` first): ${required}`);
    process.exit(1);
  }
}
const { gateContract } = require(contractsModule);
const { buildGateAttestation, validateGateReport, requiredIdsHash } = require(evidenceModule);
const { acceptanceDirectory, inspectSession, sha256File, writeAttestation, readJsonFile } = require(sessionModule);

const contract = gateContract(gate);
if (!contract) {
  console.error(`[attest] ${gate} has no declared acceptance contract`);
  process.exit(2);
}

const artifacts = acceptanceDirectory(root);
const { session, problems } = inspectSession(artifacts);
if (!session) {
  console.error(`[attest] no usable acceptance session (${problems.join(", ")}); run acceptance:session:start first`);
  process.exit(1);
}

const reportFile = path.join(artifacts, contract.report_file);
const sourceSha256 = sha256File(reportFile);
const raw = readJsonFile(reportFile);
const validation = validateGateReport({ gate, contract, report: raw });
if (sourceSha256 === "") {
  validation.reasons.unshift("REPORT_FILE_MISSING");
  validation.verdict = "FAIL";
}
console.log(`[attest] ${gate} → ${contract.report_file}`);
console.log(`[attest] session ${session.session_id} @ ${session.commit_sha.slice(0, 12)}`);
console.log(`[attest] contract ${contract.contract_version}; required ${contract.required_ids.length}; out of scope ${contract.out_of_scope_ids.length}`);
console.log(`[attest] results ${validation.ids.length}: PASS ${validation.counts.pass} FAIL ${validation.counts.fail} NOT_RUN ${validation.counts.notRun}`);
console.log(`[attest] source sha256 ${sourceSha256 === "" ? "(missing)" : sourceSha256.slice(0, 16) + "…"}; required ids ${requiredIdsHash(contract.required_ids).slice(0, 16)}…`);
for (const reason of validation.reasons.slice(0, 12)) console.error(`[attest]   ${reason}`);

const attestation = buildGateAttestation({
  gate,
  contract,
  session,
  source_sha256: sourceSha256,
  validation,
  attested_at: new Date().toISOString()
});
const target = writeAttestation(artifacts, gate, attestation);
console.log(`[attest] attestation ${path.relative(root, target)} (${attestation.attestation_hash.slice(0, 16)}…)`);
if (validation.verdict !== "PASS") {
  console.error(`[attest] FAILED: ${gate} did not satisfy its strict report contract (${validation.reasons.length} problem(s))`);
  process.exit(1);
}
console.log(`[attest] strict validation PASS`);
