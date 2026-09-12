#!/usr/bin/env node
/**
 * checkpoint-1 §41 (checkpoint-15) reproducible CI repair-loop acceptance.
 * Usage: node scripts/acceptance-ci-repair.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "ci-repair-loop.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "ci-repair.json");
const REQUIRED = ["CR-01", "CR-02", "CR-03", "CR-04", "CR-05", "CR-06", "CR-07", "CR-08"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[ci-repair] suite not found: ${suite}`); process.exit(1); }
console.log(`[ci-repair] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[ci-repair] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[ci-repair] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[ci-repair] unit=${report.unit}`);
console.log(`[ci-repair] network=${report.network}`);
if (report.workspace) console.log(`[ci-repair] fixture: git=${report.workspace.git_initialized} remote=${report.workspace.remote_initialized} base=${report.workspace.base_branch}`);
if (report.loop) console.log(`[ci-repair] loop: ${report.loop.outcome} over ${report.loop.attempts} attempt(s) (${(report.loop.classes ?? []).join(" -> ")})`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[ci-repair] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[ci-repair] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[ci-repair] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[ci-repair] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[ci-repair] CI repair-loop acceptance PASS");
