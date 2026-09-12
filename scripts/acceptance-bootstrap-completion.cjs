#!/usr/bin/env node
/**
 * checkpoint-1 §57/§58 (checkpoint-18) — the Bootstrap Completion gate.
 *
 * Runs the audit's own acceptance suite, then audits the REAL reports this chain
 * wrote (via the built module) and requires BOOTSTRAP_COMPLETE. It is the last gate
 * in CI, so every report it reads has just been produced.
 *
 * Usage: node scripts/acceptance-bootstrap-completion.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "bootstrap-completion.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "bootstrap-completion-audit.json");
const REQUIRED = ["BC-01", "BC-02", "BC-03", "BC-04", "BC-05", "BC-06"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[bootstrap] suite not found: ${suite}`); process.exit(1); }
console.log(`[bootstrap] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[bootstrap] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[bootstrap] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[bootstrap] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[bootstrap] acceptance totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[bootstrap] acceptance FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }

/* The real audit: the reports this chain just wrote, the session, and the derived
 * Owner intervention ledger. checkpoint-2 §2.5/§7.5: the caller passes no count. */
const built = path.join(root, "dist-electron", "electron", "engineering", "bootstrap-completion.js");
if (!fs.existsSync(built)) { console.error(`[bootstrap] the built auditor is missing (run the build first): ${built}`); process.exit(1); }
const { createBootstrapAuditor } = require(built);
const outcome = createBootstrapAuditor({ root }).evaluate();
console.log("");
console.log(`[bootstrap] real audit: ${outcome.audit.decision}`);
console.log(`[bootstrap] gates: ${outcome.audit.gates_passed}/${outcome.audit.gates_required} passed, desktop black box ${outcome.audit.desktop.verdict}, capabilities ${outcome.audit.capability_evidence.filter((entry) => entry.established).length}/${outcome.audit.capability_evidence.length}, owner interventions ${outcome.audit.owner_interventions} (ledger events ${outcome.ownerLedger.events})`);
for (const gate of outcome.audit.gates.filter((entry) => entry.verdict !== "PASS")) console.log(`[bootstrap]   ${gate.gate}: ${gate.verdict} — ${gate.reasons[0] ?? ""}`);
console.log(`[bootstrap] record: ${path.relative(root, outcome.recordPath)}`);
if (outcome.audit.decision !== "BOOTSTRAP_COMPLETE") {
  console.error(`[bootstrap] FAILED: ${outcome.audit.reasons.slice(0, 4).join(" | ")}`);
  process.exit(1);
}
console.log("[bootstrap] Bootstrap Completion audit PASS");
