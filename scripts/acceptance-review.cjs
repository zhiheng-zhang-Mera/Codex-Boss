#!/usr/bin/env node
/**
 * checkpoint-1 §30/§32 (checkpoint-9) reproducible implementation-loop + review acceptance.
 * Usage: node scripts/acceptance-review.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const suite = path.join("tests", "acceptance", "review-loop.test.ts");
const reportFile = path.join(root, "artifacts", "acceptance", "review-loop.json");
const REQUIRED = ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08", "C-09", "C-10", "C-11"];

const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(path.join(root, suite))) { console.error(`[review] suite not found: ${suite}`); process.exit(1); }
console.log(`[review] running ${suite}`);
const result = fs.existsSync(vitestEntry)
  ? spawnSync(process.execPath, [vitestEntry, "run", suite], { cwd: root, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", suite], { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) { console.error(`[review] suite failed with exit code ${result.status}`); process.exit(result.status ?? 1); }
if (!fs.existsSync(reportFile)) { console.error(`[review] report was not written: ${reportFile}`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
console.log("");
console.log(`[review] unit=${report.unit}`);
if (report.workspace) console.log(`[review] fixture: git=${report.workspace.git_initialized} commit=${report.workspace.git_commit} tsc=${report.workspace.typescript_toolchain}`);
for (const [name, loop] of Object.entries(report.loops ?? {})) {
  const entry = loop && typeof loop === "object" ? loop : { label: loop, iterations: [] };
  if (!entry.label && !(entry.iterations ?? []).length) continue;
  const trail = (entry.iterations ?? []).map((iteration) => `${iteration.blocking} blocking (${(iteration.subjects ?? []).join("/") || "-"})`);
  console.log(`[review] ${name}: ${trail.length ? `${trail.join(" -> ")} => ` : ""}${entry.label}`);
}
for (const entry of report.requirementResults ?? []) {
  const checks = `${(entry.observations ?? []).filter((observation) => observation.ok).length}/${(entry.observations ?? []).length}`;
  console.log(`[review] ${entry.id.padEnd(6)} ${entry.verdict.padEnd(9)} ${checks}`);
}
console.log(`[review] totals: PASS ${report.totals?.pass ?? 0} FAIL ${report.totals?.fail ?? 0}`);
console.log(`[review] report: ${path.relative(root, reportFile)}`);
const missing = REQUIRED.filter((id) => verdicts.get(id) !== "PASS");
if (missing.length || report.totals?.fail) { console.error(`[review] FAILED: missing=${missing.join(",") || "-"}`); process.exit(1); }
console.log("[review] implementation loop + review acceptance PASS");
