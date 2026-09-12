#!/usr/bin/env node
/**
 * checkpoint-1 §42–§45 + §51/§52 (checkpoint-16) reproducible final-acceptance gate.
 * Usage: node scripts/acceptance-final-acceptance.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "final-acceptance.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "final-acceptance-gate.json");
const REQUIRED = ["FS-01", "FS-02", "FS-03", "FS-04", "FS-05", "FS-06", "FS-07", "FS-08"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[final] suite not found: ${suite}`); process.exit(1); }
console.log(`[final] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[final] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[final] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[final] unit=${report.unit}`);
if (report.finalAcceptance) console.log(`[final] gate: ${report.finalAcceptance.decision} (${report.finalAcceptance.verified}/${report.finalAcceptance.items} items verified)`);
if (report.catalogues) console.log(`[final] catalogues: ${report.catalogues.benchmarks} benchmarks, ${report.catalogues.seeded} seeded failures, ${report.catalogues.critical_capabilities} critical capabilities, ${report.catalogues.hard_blocker_classes} Hard Blocker classes`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[final] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[final] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[final] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[final] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[final] final acceptance PASS");
