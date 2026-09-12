#!/usr/bin/env node
/**
 * checkpoint-1 §28 reproducible Requirements Graph acceptance command.
 *
 * Runs the R-01..R-08 suite, then verifies and prints the machine-readable
 * report it produced under `artifacts/acceptance/`. Exits non-zero unless every
 * item is PASS.
 *
 * Usage: node scripts/acceptance-requirements.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const suite = path.join("tests", "acceptance", "requirements-graph.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "requirements-graph.json");
const REQUIRED_PASS = ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08"];

function runSuite() {
  const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(vitestEntry)) {
    return spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
}

if (!fs.existsSync(path.join(root, suite))) {
  console.error(`[requirements] suite not found: ${suite}`);
  process.exit(1);
}

console.log(`[requirements] running ${suite}`);
const result = runSuite();
if (result.status !== 0) {
  console.error(`[requirements] suite failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`[requirements] report was not written: ${reportFile}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`[requirements] report is not valid JSON: ${error.message}`);
  process.exit(1);
}

const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry]));
console.log("");
console.log(`[requirements] unit=${report.unit} provider execution=${report.providerExecution}`);
if (report.graph) {
  console.log(`[requirements] graph: ${report.graph.nodes} nodes, ${report.graph.edges} edges, types ${JSON.stringify(report.graph.counts)}`);
  console.log(`[requirements] states: ${JSON.stringify(report.graph.states)}`);
}
console.log("[requirements] item                  verdict   checks");
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[requirements] ${entry.id.padEnd(21)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[requirements] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0} NOT_RUN ${report.totals?.notRun ?? 0}`);
console.log(`[requirements] report: ${path.relative(root, reportFile)}`);

const missing = REQUIRED_PASS.filter((id) => verdicts.get(id)?.verdict !== "PASS");
const failing = (report.requirementResults ?? []).filter((entry) => entry.verdict === "FAIL").map((entry) => entry.id);
if (missing.length || failing.length || report.totals?.fail) {
  console.error(`[requirements] FAILED: missing=${missing.join(",") || "-"} failed=${failing.join(",") || "-"}`);
  process.exit(1);
}
console.log("[requirements] requirements graph acceptance PASS");
