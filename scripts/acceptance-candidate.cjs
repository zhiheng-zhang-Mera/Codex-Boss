#!/usr/bin/env node
/**
 * checkpoint-1 §35/§36 (checkpoint-12) reproducible candidate + Guardian acceptance.
 * Usage: node scripts/acceptance-candidate.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "candidate-guardian.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "candidate-guardian.json");
const REQUIRED = ["GD-01", "GD-02", "GD-03", "GD-04", "GD-05", "GD-06", "GD-07", "GD-08", "GD-09", "GD-10"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[candidate] suite not found: ${suite}`); process.exit(1); }
console.log(`[candidate] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[candidate] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[candidate] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[candidate] unit=${report.unit}`);
if (report.workspace) console.log(`[candidate] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} tsc=${report.workspace.typescript_toolchain} record=${report.workspace.record_written}`);
if (report.checklist) console.log(`[candidate] checklist: ${report.checklist.base.length} base + ${report.checklist.theme.length} theme checks`);
if (report.candidate) console.log(`[candidate] last record: state=${report.candidate.state} guardian=${report.candidate.guardian} released=${report.candidate.released} blocking=${(report.candidate.blocking ?? []).join(",") || "-"}`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[candidate] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[candidate] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[candidate] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[candidate] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[candidate] candidate + Guardian acceptance PASS");
