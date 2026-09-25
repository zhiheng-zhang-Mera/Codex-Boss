#!/usr/bin/env node
/**
 * THE CITY FLATNESS VALIDATOR (P2-F; see docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md, section 20).
 *
 * WHAT IT ANSWERS
 *
 *   Section 20 requires ONE machine-readable state per plot, from five, with per-state obligations:
 *   "bridge requires owner + exit condition; degraded requires a declared missing element; migration requires
 *   source/target/exit; unsafe gap blocks that plot's promotion". It also names the states the FINAL SEAL may not
 *   contain. This is the "flatness registry validator" the final acceptance suite names.
 *
 * THE PROPERTY THAT MAKES IT A GATE RATHER THAN A DECLARATION
 *
 *   A registry a maintainer fills in is a registry a maintainer can fill in wrongly, and the cheapest wrong entry
 *   is FLAT. So this program does not merely check the registry's internal shape: it CROSS-CHECKS it against the
 *   four instruments the programme runs -- the edge inventory's kernel -> feature pairs, the cycle instrument's
 *   mutual pairs, the private-state validator's confirmed accesses -- and FAILS when a plot implicated by a
 *   measured defect is recorded FLAT. The registry can therefore be made true only by fixing the architecture or
 *   by declaring the migration, never by editing the file.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not decide what a plot's state OUGHT to be, and it does not generate the registry. A generated
 *   registry would make the cross-check circular -- the instrument would be comparing its own output with
 *   itself. The registry is an authored governance record; this program is what keeps it honest.
 *
 *   It also does not claim FLAT means sound. FLAT means "no defect was measured on this plot by the instruments
 *   that exist", and section 33 lists properties no instrument covers yet (flatness semantics themselves, Core
 *   budget, replacement lifecycle). The registry's own $comment says so, and a test asserts it does.
 *
 * USAGE
 *
 *   node scripts/city-flatness-validator.cjs           report; exit 1 on a shape or cross-check failure
 *   node scripts/city-flatness-validator.cjs --seal     the same, AND exit 1 if any plot is seal-blocking
 *   node scripts/city-flatness-validator.cjs --json     the report as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = "config/city-flatness.json";
const STATES = ["FLAT", "TEMPORARILY_BRIDGED", "PARTIALLY_DEGRADED", "MIGRATION_IN_PROGRESS", "UNSAFE_GAP"];
const SEAL_BLOCKING = ["UNSAFE_GAP", "MIGRATION_IN_PROGRESS", "PARTIALLY_DEGRADED", "TEMPORARILY_BRIDGED"];

/** Every capability the manifests declare: the plot set is DERIVED, so a new capability cannot go unregistered. */
function plotSet(root = ROOT) {
  const directory = path.join(root, "config", "capabilities");
  return fs.readdirSync(directory).filter((name) => name.endsWith(".yaml")).map((name) => name.replace(/\.yaml$/, "")).sort();
}

function readRegistry(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTRY), "utf8"));
}

/**
 * The plots a MEASURED defect implicates, with the reason. Both endpoints of a pair are implicated, because a
 * kernel reaching a feature is a fact about the pair and neither side is flat while it stands.
 *
 * `reports` is a FIXTURE SEAM, and it exists for one reason: the cross-check below is the property that makes
 * this program a gate, so it has to be exercised against a registry that IS falsely flat, and building such a
 * registry in the real repository would require breaking the real tree. A caller that supplies reports gets a
 * check over THOSE reports, and the CLI never supplies them -- `validate` without the seam requires the three
 * instruments from the root, which is what every real invocation does.
 */
function implicatedPlots(root = ROOT, reports = undefined) {
  const inventory = reports?.inventory ?? require(path.join(root, "scripts", "phase2-edge-inventory.cjs")).report;
  const cycles = reports?.cycles ?? require(path.join(root, "scripts", "phase2-cycles.cjs")).report;
  const privateState = reports?.privateState ?? require(path.join(root, "scripts", "phase2-private-state.cjs")).measure();
  const implicated = new Map();
  const note = (capability, reason) => {
    if (capability === undefined || capability === null || capability.startsWith("<")) return;
    if (!implicated.has(capability)) implicated.set(capability, new Set());
    implicated.get(capability).add(reason);
  };
  for (const entry of inventory.kernelToFeaturePairs ?? []) {
    const [from, to] = String(entry.pair).split(" -> ");
    note(from, "kernel -> feature inversion");
    note(to, "kernel -> feature inversion");
  }
  for (const pair of cycles.mutualPairs ?? []) {
    const [from, to] = String(pair).split(" -> ");
    note(from, "capability cycle");
    note(to, "capability cycle");
  }
  for (const access of privateState.confirmed ?? []) {
    note(access.declaredOwner, "cross-domain private-state access");
    note(access.accessedBy, "cross-domain private-state access");
  }
  return implicated;
}

function validate(root = ROOT, options = {}) {
  const problems = [];
  const registry = readRegistry(root);
  const plots = registry.plots ?? {};
  const states = Array.isArray(registry.states) ? registry.states : STATES;
  const sealBlocking = Array.isArray(registry.seal_blocking) ? registry.seal_blocking : SEAL_BLOCKING;
  const stages = registry.stages ?? {};
  const bridges = registry.bridges ?? {};
  const declared = plotSet(root);

  // --- shape: the plot set is the manifest set, exactly -----------------------------------------------
  const missing = declared.filter((capability) => !Object.prototype.hasOwnProperty.call(plots, capability));
  const unknown = Object.keys(plots).filter((capability) => !declared.includes(capability));
  if (missing.length > 0) problems.push(`${missing.length} capability(ies) have no state: ${missing.join(", ")}`);
  if (unknown.length > 0) problems.push(`${unknown.length} entr(ies) name no declared capability: ${unknown.join(", ")}`);

  // --- shape: one state per plot, from the declared set, with the obligations that state carries -------
  const counts = Object.fromEntries(states.map((state) => [state, 0]));
  const sealBlockingPlots = [];
  for (const [capability, entry] of Object.entries(plots)) {
    const state = entry?.state;
    if (!states.includes(state)) { problems.push(`${capability}: state ${JSON.stringify(state)} is not one of ${states.join(", ")}`); continue; }
    counts[state] += 1;
    if (sealBlocking.includes(state)) sealBlockingPlots.push(`${capability}(${state})`);
    if (state === "MIGRATION_IN_PROGRESS") {
      const migrations = Array.isArray(entry.migrations) ? entry.migrations : [];
      if (migrations.length === 0) problems.push(`${capability}: MIGRATION_IN_PROGRESS with no migration declared`);
      for (const migration of migrations) {
        if (!stages[migration?.stage]) problems.push(`${capability}: migration names stage ${JSON.stringify(migration?.stage)}, which the registry does not declare`);
        // Migration state requires source/target/exit, per
        // docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (section 20). Source and target are per plot; the
        // exit is
        // the STAGE's, resolved below, because 22 plots migrating in P2-B do not have 22 different exits.
        if (typeof migration?.source !== "string" || migration.source.trim().length < 20) problems.push(`${capability}: migration for ${migration?.stage} carries no substantive source`);
        if (typeof migration?.target !== "string" || migration.target.trim().length < 20) problems.push(`${capability}: migration for ${migration?.stage} carries no substantive target`);
        const exit = stages[migration?.stage]?.exitCondition;
        if (typeof exit !== "string" || exit.trim().length < 20) problems.push(`${capability}: stage ${migration?.stage} declares no exit condition, so the migration has no exit`);
      }
    }
    if (state === "PARTIALLY_DEGRADED") {
      if (typeof entry.missingElement !== "string" || entry.missingElement.trim().length < 10) problems.push(`${capability}: PARTIALLY_DEGRADED without a declared missing element`);
    }
    if (state === "TEMPORARILY_BRIDGED") {
      const named = Array.isArray(entry.bridges) ? entry.bridges : [];
      if (named.length === 0) problems.push(`${capability}: TEMPORARILY_BRIDGED without naming a declared bridge`);
      for (const id of named) if (!bridges[id]) problems.push(`${capability}: names bridge ${id}, which the registry does not declare`);
    }
    // A bridge is never lost to the precedence rule: a plot may carry one while its state is more blocking.
    for (const id of Array.isArray(entry.bridges) ? entry.bridges : []) {
      if (!bridges[id]) problems.push(`${capability}: names bridge ${id}, which the registry does not declare`);
    }
    if (typeof entry.why !== "string" || entry.why.trim().length < 20) problems.push(`${capability}: the entry states no reason for its state`);
  }

  // --- shape: every declared bridge carries its obligations, as required by
  // docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (sections 17 and 20) ----------------------------
  const bridgeFields = ["owner", "reason", "source", "target", "exitCondition", "deadline_phase", "tests", "record"];
  for (const [id, bridge] of Object.entries(bridges)) {
    for (const field of bridgeFields) {
      const value = bridge?.[field];
      if (typeof value !== "string" || value.trim().length < 10) problems.push(`bridge ${id}: no substantive ${field}`);
    }
    const namedBy = Array.isArray(bridge?.declaredIn) ? bridge.declaredIn : [];
    if (namedBy.length === 0) problems.push(`bridge ${id}: declared by no plot, so it is an orphan declaration`);
    for (const capability of namedBy) if (!plots[capability]) problems.push(`bridge ${id}: declaredIn names ${capability}, which has no registry entry`);
    const record = bridge?.record;
    if (typeof record === "string" && !fs.existsSync(path.join(root, record))) problems.push(`bridge ${id}: its record ${record} does not exist`);
    const tests = bridge?.tests;
    if (typeof tests === "string" && !fs.existsSync(path.join(root, tests))) problems.push(`bridge ${id}: its test file ${tests} does not exist`);
  }

  // --- the CROSS-CHECK that makes the registry a gate ---------------------------------------------------
  const implicated = implicatedPlots(root, options.reports);
  const falselyFlat = [];
  for (const [capability, reasons] of implicated) {
    const entry = plots[capability];
    if (!entry) continue; // already reported as missing
    if (entry.state === "FLAT") falselyFlat.push(`${capability} (${[...reasons].sort().join(", ")})`);
  }
  if (falselyFlat.length > 0) {
    problems.push(`${falselyFlat.length} plot(s) are recorded FLAT while a measured defect implicates them: ${falselyFlat.join("; ")}`);
  }

  const sealProblems = [];
  if (options.seal === true && sealBlockingPlots.length > 0) {
    sealProblems.push(`${sealBlockingPlots.length} plot(s) are in a seal-blocking state: ${sealBlockingPlots.slice(0, 12).join(", ")}${sealBlockingPlots.length > 12 ? ", ..." : ""}`);
  }

  return {
    schema: "city-flatness-validation/1",
    plots: declared.length,
    counts,
    sealBlockingPlots,
    implicated: implicated.size,
    bridges: Object.keys(bridges).length,
    stages: Object.keys(stages).length,
    problems,
    sealProblems,
    verdict: problems.length > 0 ? "FAIL" : sealProblems.length > 0 ? "SEAL_BLOCKED" : "PASS",
  };
}

function render(report, options) {
  const lines = [];
  lines.push(`[flatness] plots ${report.plots}; states ${JSON.stringify(report.counts)}`);
  lines.push(`[flatness] plots implicated by a measured defect ${report.implicated}; declared bridges ${report.bridges}; migration stages ${report.stages}`);
  lines.push(`[flatness] seal-blocking plots ${report.sealBlockingPlots.length}${report.sealBlockingPlots.length > 0 ? `: ${report.sealBlockingPlots.slice(0, 10).join(", ")}${report.sealBlockingPlots.length > 10 ? ", ..." : ""}` : ""}`);
  if (options.seal === true) lines.push("[flatness] SEAL MODE: section 20 permits only FLAT at the seal");
  if (report.problems.length > 0) {
    lines.push(`[flatness] VERDICT=FAIL (${report.problems.length} problem(s))`);
    for (const problem of report.problems) lines.push(`[flatness]   - ${problem}`);
    return lines.join("\n");
  }
  if (report.sealProblems.length > 0) {
    lines.push(`[flatness] VERDICT=SEAL_BLOCKED`);
    for (const problem of report.sealProblems) lines.push(`[flatness]   - ${problem}`);
    return lines.join("\n");
  }
  lines.push(`[flatness] VERDICT=${options.seal === true ? "SEAL_READY" : "PASS"}`);
  return lines.join("\n");
}

function main(argv) {
  const options = { seal: argv.includes("--seal") };
  const report = validate(ROOT, options);
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report, options)}\n`);
  return report.problems.length === 0 && report.sealProblems.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`city-flatness-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, validate, render, plotSet, readRegistry, implicatedPlots, REGISTRY, STATES, SEAL_BLOCKING };
