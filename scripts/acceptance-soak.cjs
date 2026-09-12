#!/usr/bin/env node
/**
 * checkpoint-1 §53 (checkpoint-17) reproducible soak + §51 benchmark-plan acceptance.
 * Usage: node scripts/acceptance-soak.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "soak.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "soak.json");
const REQUIRED = ["SK-01", "SK-02", "SK-03", "SK-04", "SK-05", "SK-06"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[soak] suite not found: ${suite}`); process.exit(1); }
console.log(`[soak] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[soak] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[soak] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[soak] unit=${report.unit}`);
console.log(`[soak] network=${report.network}`);
if (report.soak) console.log(`[soak] soak: ${report.soak.rounds} rounds, ${report.soak.clean} clean, ${report.soak.theme} themed, complete=${report.soak.complete}`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[soak] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[soak] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[soak] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[soak] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[soak] soak acceptance PASS");
