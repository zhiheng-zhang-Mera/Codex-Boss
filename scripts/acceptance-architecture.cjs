#!/usr/bin/env node
/**
 * checkpoint-1 §6/§9 reproducible Architecture & UI Surface Discovery command.
 *
 * Runs the A-01..A-10 acceptance suite, then verifies and prints the
 * machine-readable report it produced under `artifacts/acceptance/` (an ignored
 * directory — generated evidence is never committed). Exits non-zero unless
 * every item is PASS.
 *
 * Usage: node scripts/acceptance-architecture.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const suite = path.join("tests", "acceptance", "architecture-discovery.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "architecture-discovery.json");

function runSuite() {
  const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(vitestEntry)) {
    return spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
}

if (!fs.existsSync(path.join(root, suite))) {
  console.error(`[architecture] suite not found: ${suite}`);
  process.exit(1);
}

console.log(`[architecture] running ${suite}`);
const result = runSuite();
if (result.status !== 0) {
  console.error(`[architecture] suite failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`[architecture] report was not written: ${reportFile}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`[architecture] report is not valid JSON: ${error.message}`);
  process.exit(1);
}

const rows = (report.requirementResults ?? []).map((entry) => ({
  id: entry.id,
  verdict: entry.verdict,
  checks: `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`
}));

console.log("");
console.log(`[architecture] unit=${report.unit} workspace=${report.workspace}`);
console.log("[architecture] item                  verdict   checks");
for (const row of rows) {
  console.log(`[architecture] ${row.id.padEnd(21)} ${row.verdict.padEnd(9)} ${row.checks}`);
}
console.log(`[architecture] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0} NOT_RUN ${report.totals?.notRun ?? 0}`);
console.log(`[architecture] report: ${path.relative(root, reportFile)}`);

const failing = rows.filter((row) => row.verdict === "FAIL");
if (failing.length || report.passed !== true) {
  console.error(`[architecture] FAILED: ${failing.map((row) => row.id).join(", ") || "report.passed is not true"}`);
  process.exit(1);
}
console.log("[architecture] repository world model + UI surface registry acceptance PASS");
