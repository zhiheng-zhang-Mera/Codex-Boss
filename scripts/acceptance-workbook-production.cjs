#!/usr/bin/env node
/**
 * WORK_UNIT_4 reproducible WorkBook acceptance command.
 *
 * Runs the WB-01..WB-10 production integration acceptance suite, then verifies
 * and prints the machine-readable report it produced under
 * `artifacts/acceptance/` (an ignored directory — generated evidence is never
 * committed). Exits non-zero unless every WB item is PASS or NOT_RUN, so a
 * failing scenario fails the command.
 *
 * Usage: node scripts/acceptance-workbook-production.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const suite = path.join("tests", "acceptance", "workbook-production-acceptance.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "workbook-acceptance.json");

/**
 * Runs the suite through this Node binary and the resolved vitest entry point.
 * No shell is involved, so no argument is concatenated into a command string.
 */
function runSuite() {
  const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(vitestEntry)) {
    return spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
}

if (!fs.existsSync(path.join(root, suite))) {
  console.error(`[acceptance] suite not found: ${suite}`);
  process.exit(1);
}

console.log(`[acceptance] running ${suite}`);
const result = runSuite();
if (result.status !== 0) {
  console.error(`[acceptance] suite failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`[acceptance] report was not written: ${reportFile}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`[acceptance] report is not valid JSON: ${error.message}`);
  process.exit(1);
}

const rows = (report.requirementResults ?? []).map((entry) => ({
  id: entry.id,
  verdict: entry.verdict,
  checks: `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`
}));

console.log("");
console.log(`[acceptance] unit=${report.unit} provider execution=${report.providerExecution} live provider=${report.externalLiveProviderExecution}`);
console.log("[acceptance] WB item              verdict   checks");
for (const row of rows) {
  console.log(`[acceptance] ${row.id.padEnd(20)} ${row.verdict.padEnd(9)} ${row.checks}`);
}
console.log(`[acceptance] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0} NOT_RUN ${report.totals?.notRun ?? 0}`);
console.log(`[acceptance] report: ${path.relative(root, reportFile)}`);

const failing = rows.filter((row) => row.verdict === "FAIL");
if (failing.length || report.passed !== true) {
  console.error(`[acceptance] FAILED: ${failing.map((row) => row.id).join(", ") || "report.passed is not true"}`);
  process.exit(1);
}
console.log("[acceptance] all WB items PASS or NOT_RUN");
