#!/usr/bin/env node
/**
 * checkpoint-1 §25 reproducible theme acceptance command.
 *
 * Runs the TH-01..TH-15 (plus T-TOKENS and the CP5 generator items) suite, then
 * verifies and prints the machine-readable report it produced under
 * `artifacts/acceptance/`. Exits non-zero unless every item is PASS: TH-04/05/06
 * (prompt-driven creation, preview-before-install, feedback revision) became
 * real PASS items in CP5, so nothing is allowed to remain NOT_RUN.
 *
 * Usage: node scripts/acceptance-theme.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const suite = path.join("tests", "acceptance", "theme-engine.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "theme-engine.json");
const REQUIRED_PASS = [
  "TH-01", "TH-02", "TH-03", "TH-04", "TH-05", "TH-06", "TH-07", "TH-08", "TH-09", "TH-10",
  "TH-11", "TH-12", "TH-13", "TH-14", "TH-15", "T-TOKENS",
  "T-GEN", "T-BOUNDARY", "T-CAPTURE", "T-VISUAL", "T-KNOWLEDGE"
];
/** Everything CP4/CP5 owns must now be green; nothing may stay NOT_RUN. */
const REQUIRED_NOT_RUN = [];

function runSuite() {
  const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(vitestEntry)) {
    return spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
}

if (!fs.existsSync(path.join(root, suite))) {
  console.error(`[theme] suite not found: ${suite}`);
  process.exit(1);
}

console.log(`[theme] running ${suite}`);
const result = runSuite();
if (result.status !== 0) {
  console.error(`[theme] suite failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`[theme] report was not written: ${reportFile}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`[theme] report is not valid JSON: ${error.message}`);
  process.exit(1);
}

const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry]));
console.log("");
console.log(`[theme] unit=${report.unit} theme sandbox=${report.themeSandbox}`);
console.log("[theme] item                  verdict   checks");
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[theme] ${entry.id.padEnd(21)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[theme] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0} NOT_RUN ${report.totals?.notRun ?? 0}`);
console.log(`[theme] report: ${path.relative(root, reportFile)}`);

const missing = REQUIRED_PASS.filter((id) => verdicts.get(id)?.verdict !== "PASS");
const wronglyRun = REQUIRED_NOT_RUN.filter((id) => verdicts.get(id)?.verdict !== "NOT_RUN");
const failing = (report.requirementResults ?? []).filter((entry) => entry.verdict === "FAIL").map((entry) => entry.id);
if (missing.length || wronglyRun.length || failing.length || report.totals?.fail) {
  console.error(`[theme] FAILED: missing=${missing.join(",") || "-"} wronglyRun=${wronglyRun.join(",") || "-"} failed=${failing.join(",") || "-"}`);
  process.exit(1);
}
console.log("[theme] theme engine foundation acceptance PASS");
