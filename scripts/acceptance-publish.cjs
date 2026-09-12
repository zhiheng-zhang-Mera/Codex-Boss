#!/usr/bin/env node
/**
 * checkpoint-1 §39/§40 (checkpoint-14) reproducible publishing acceptance.
 * Usage: node scripts/acceptance-publish.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "publish-release.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "publish-release.json");
const REQUIRED = ["PB-01", "PB-02", "PB-03", "PB-04", "PB-05", "PB-06", "PB-07", "PB-08", "PB-09", "PB-10"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[publish] suite not found: ${suite}`); process.exit(1); }
console.log(`[publish] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[publish] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[publish] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[publish] unit=${report.unit}`);
console.log(`[publish] network=${report.network}`);
if (report.workspace) console.log(`[publish] fixture: git=${report.workspace.git_initialized} remote=${report.workspace.remote_initialized} base=${report.workspace.base_branch} checkpoints=${report.workspace.checkpoints}`);
if (report.release) console.log(`[publish] last release: ${report.release.branch} ${report.release.decision} pushed=${report.release.pushed} commit=${report.release.commit ?? "-"}`);
if (report.publishing?.pb06) console.log(`[publish] gateway calls: ${(report.publishing.pb06.calls ?? []).join(" | ")}`);
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[publish] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[publish] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[publish] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[publish] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[publish] publishing acceptance PASS");
