#!/usr/bin/env node
/**
 * checkpoint-1 §33 (checkpoint-10) reproducible self-healing/recovery acceptance.
 * Usage: node scripts/acceptance-self-healing.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "recovery-loop.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "recovery.json");
const REQUIRED = ["RC-01", "RC-02", "RC-03", "RC-04", "RC-05", "RC-06", "RC-07", "RC-08", "RC-09", "RC-10"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[self-healing] suite not found: ${suite}`); process.exit(1); }
console.log(`[self-healing] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[self-healing] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[self-healing] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[self-healing] unit=${report.unit}`);
if (report.workspace) console.log(`[self-healing] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} tsc=${report.workspace.typescript_toolchain}`);
for (const [key, value] of Object.entries(report.recovery ?? {})) {
  if (!value || typeof value !== "object") continue;
  if (typeof value.class === "string") console.log(`[self-healing] ${key}: ${value.class}${value.next ? ` -> next ${value.next}` : ""}`);
  else if (Array.isArray(value.classes)) console.log(`[self-healing] ${key}: ${value.classes.join(" -> ")}`);
}
console.log(`[self-healing] capability gaps: ${(report.backlog ?? []).length}`);
for (const gap of report.backlog ?? []) console.log(`[self-healing]   ${String(gap.severity).padEnd(8)} ${String(gap.class).padEnd(11)} allowed=${gap.allowed} role=${gap.role} ${gap.capability}`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[self-healing] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[self-healing] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[self-healing] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[self-healing] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[self-healing] recovery acceptance PASS");
