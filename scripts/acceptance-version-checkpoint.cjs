#!/usr/bin/env node
/**
 * checkpoint-1 §37/§38 (checkpoint-13) reproducible version-impact + git-checkpoint acceptance.
 * Usage: node scripts/acceptance-version-checkpoint.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "version-checkpoint.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "version-checkpoint.json");
const REQUIRED = ["VC-01", "VC-02", "VC-03", "VC-04", "VC-05", "VC-06", "VC-07", "VC-08"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[checkpoint] suite not found: ${suite}`); process.exit(1); }
console.log(`[checkpoint] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[checkpoint] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[checkpoint] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[checkpoint] unit=${report.unit}`);
if (report.workspace) console.log(`[checkpoint] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} head=${report.workspace.head} checkpoints=${report.workspace.checkpoints_written}`);
if (report.impact) console.log(`[checkpoint] impact: docs=${report.impact.docs} implementation=${report.impact.implementation} breaking=${report.impact.breaking} theme=${report.impact.theme} reevaluation=${report.impact.reevaluation}`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[checkpoint] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[checkpoint] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[checkpoint] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[checkpoint] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[checkpoint] version impact + git checkpoint acceptance PASS");
