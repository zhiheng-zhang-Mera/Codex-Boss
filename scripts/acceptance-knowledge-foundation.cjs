#!/usr/bin/env node
/**
 * checkpoint-1 §5 reproducible Knowledge Foundation acceptance command.
 *
 * Runs the K-01..K-04 acceptance suite, then verifies and prints the
 * machine-readable report it produced under `artifacts/acceptance/` (an ignored
 * directory — generated evidence is never committed). Exits non-zero unless
 * every item is PASS, so a scenario that silently degrades fails the command.
 *
 * Usage: node scripts/acceptance-knowledge-foundation.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const suite = path.join("tests", "acceptance", "knowledge-reuse.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "knowledge-foundation.json");

/** Runs the suite through this Node binary and the resolved vitest entry point. */
function runSuite() {
  const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(vitestEntry)) {
    return spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
}

if (!fs.existsSync(path.join(root, suite))) {
  console.error(`[knowledge] suite not found: ${suite}`);
  process.exit(1);
}

console.log(`[knowledge] running ${suite}`);
const result = runSuite();
if (result.status !== 0) {
  console.error(`[knowledge] suite failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`[knowledge] report was not written: ${reportFile}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`[knowledge] report is not valid JSON: ${error.message}`);
  process.exit(1);
}

const rows = (report.requirementResults ?? []).map((entry) => ({
  id: entry.id,
  verdict: entry.verdict,
  checks: `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`
}));

console.log("");
console.log(`[knowledge] unit=${report.unit} provider execution=${report.providerExecution} live provider=${report.externalLiveProviderExecution}`);
console.log("[knowledge] item                  verdict   checks");
for (const row of rows) {
  console.log(`[knowledge] ${row.id.padEnd(21)} ${row.verdict.padEnd(9)} ${row.checks}`);
}
console.log(`[knowledge] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0} NOT_RUN ${report.totals?.notRun ?? 0}`);
console.log(`[knowledge] report: ${path.relative(root, reportFile)}`);

const failing = rows.filter((row) => row.verdict === "FAIL");
if (failing.length || report.passed !== true) {
  console.error(`[knowledge] FAILED: ${failing.map((row) => row.id).join(", ") || "report.passed is not true"}`);
  process.exit(1);
}
console.log("[knowledge] Knowledge Foundation acceptance PASS");
