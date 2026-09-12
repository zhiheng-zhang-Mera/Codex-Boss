#!/usr/bin/env node
/**
 * checkpoint-1 §30/§31 (checkpoint-8) reproducible Verification Engine acceptance.
 * Usage: node scripts/acceptance-verify.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "verification-engine.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "verification-engine.json");
const REQUIRED = ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06", "V-07", "V-08", "V-09", "V-10"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[verify] suite not found: ${suite}`); process.exit(1); }
console.log(`[verify] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[verify] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[verify] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[verify] unit=${report.unit}`);
if (report.workspace) console.log(`[verify] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} tsc=${report.workspace.typescript_toolchain} platform-package=${report.workspace.typescript_platform_package}`);
if (report.ledger) {
  console.log(`[verify] ledger: ${report.ledger.entries} rows (re-run added ${(report.ledger.after_rerun ?? 0) - (report.ledger.before_rerun ?? 0)})`);
  console.log(`[verify] ledger gates: ${Object.entries(report.ledger.by_gate ?? {}).map(([gate, count]) => `${gate}=${count}`).join(" ")}`);
}
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[verify] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[verify] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[verify] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[verify] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[verify] verification engine acceptance PASS");
