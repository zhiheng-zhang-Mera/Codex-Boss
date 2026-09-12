#!/usr/bin/env node
/**
 * checkpoint-1 §29 reproducible Execution Planner acceptance command.
 * Usage: node scripts/acceptance-plan.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "execution-plan.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "execution-plan.json");
const REQUIRED = ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[plan] suite not found: ${suite}`); process.exit(1); }
console.log(`[plan] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[plan] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[plan] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[plan] unit=${report.unit}`);
if (report.plan) console.log(`[plan] plan: ${report.plan.nodes} nodes, ${report.plan.waves} waves, concurrency ${report.plan.concurrency} (${report.plan.concurrencyReason})`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[plan] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[plan] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[plan] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[plan] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[plan] execution planner acceptance PASS");
