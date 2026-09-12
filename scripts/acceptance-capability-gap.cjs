#!/usr/bin/env node
/**
 * checkpoint-1 §34 (checkpoint-11) reproducible capability-gap acceptance.
 * Usage: node scripts/acceptance-capability-gap.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "capability-gap-loop.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "capability-gap.json");
const REQUIRED = ["CG-01", "CG-02", "CG-03", "CG-04", "CG-05", "CG-06", "CG-07", "CG-08", "CG-09", "CG-10"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[capability] suite not found: ${suite}`); process.exit(1); }
console.log(`[capability] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[capability] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[capability] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[capability] unit=${report.unit}`);
if (report.workspace) console.log(`[capability] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} tsc=${report.workspace.typescript_toolchain} capability_present=${report.workspace.capability_present_after_chain}`);
console.log(`[capability] chain: ${(report.chain?.stages ?? []).join(" -> ")}`);
for (const entry of report.registry ?? []) console.log(`[capability] registry ${String(entry.status).padEnd(8)} ${entry.capability} (${entry.movement})`);
for (const entry of report.knowledge ?? []) console.log(`[capability] knowledge ${String(entry.verification).padEnd(11)} ${entry.subject} (${entry.evidence} evidence)`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[capability] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[capability] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[capability] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[capability] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[capability] capability gap acceptance PASS");
