#!/usr/bin/env node
/**
 * THE BRIDGE EXPIRY VALIDATOR (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 30, "bridge expiry
 * validator"; the eight required fields are section 15's; the completion condition is section 33's "no expired
 * temporary bridge remains")
 *
 * WHY IT EXISTS
 *
 *   A temporary bridge is the one legitimate repair in the workbook's list that is DESIGNED to be temporary, so it
 *   is the one that most easily becomes permanent. Section 15 requires eight fields for every bridge and states that
 *   "a bridge without an exit condition is not allowed"; section 33 puts "no expired temporary bridge remains" in the
 *   completion checklist; and section 30 names this validator. None of it existed: the flatness registry checked
 *   that a bridge is named by a plot, that its record and test files exist, and nothing else -- so a bridge past its
 *   deadline, or one whose code had already been removed while the declaration stayed, would have gone unnoticed.
 *
 * WHAT IT CHECKS, AND WHY EACH CHECK IS FALSIFIABLE
 *
 *   1  the eight fields of section 15 are present and substantive;
 *   2  `deadline_phase` names a DECLARED stage or the seal -- an unrecognised deadline is not a deadline;
 *   3  the bridge's `literal` source text is STILL PRESENT in its source file, exactly once. This is the check that
 *      makes the declaration falsifiable against the tree: a bridge that was already removed but not un-declared is
 *      a stale record, and it is reported as one;
 *   4  the bridge is still declared by at least one plot, so it is not an orphan declaration;
 *   5  the phase it is due before is resolved from MEASUREMENTS, not from prose: each stage declares `decidedBy`
 *      keys, this program resolves them live from the instruments, and a stage whose keys cannot be resolved is a
 *      failure rather than an assumption;
 *   6  a bridge whose deadline phase is COMPLETE is EXPIRED, which is a failure.
 *
 * READ-ONLY. It measures and judges; it never writes.
 *
 * USAGE
 *
 *   node scripts/bridge-expiry-validator.cjs            check and print the report
 *   node scripts/bridge-expiry-validator.cjs --json     the report as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REGISTRY_PATH = path.join("config", "city-flatness.json");
const SEAL_DEADLINE = "before the Phase 2 seal";

/** Section 15's fields (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md), with the minimum length that makes each one a statement rather than a nod. */
const REQUIRED_FIELDS = [
  ["owner", 20],
  ["reason", 40],
  ["source", 10],
  ["target", 10],
  ["form", 10],
  ["exitCondition", 40],
  ["deadline_phase", 8],
  ["tests", 4],
];

/**
 * The measurement keys a stage may declare. Kept local rather than shared with the enforcement matrix, because the
 * matrix resolves values to PROVE a principle and this program resolves them to decide whether a deadline passed;
 * sharing the table would couple two artifacts that can legitimately disagree about what they need.
 */
const KEY_INSTRUMENT = {
  "p2b:kernelToFeatureFileEdges": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:kernelToFeaturePairs": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:mutualCapabilityPairs": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:largestSccSize": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2d:confirmedAccesses": "scripts/phase2-private-state.cjs",
};

function readRegistry(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTRY_PATH), "utf8"));
}

function runInstrument(relPath, root = ROOT, cache = new Map()) {
  if (cache.has(relPath)) return cache.get(relPath);
  const result = spawnSync(process.execPath, [path.join(root, relPath), "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  let json = null;
  if (result.status === 0) {
    try {
      json = JSON.parse(result.stdout ?? "");
    } catch {
      json = null;
    }
  }
  const entry = { relPath, exitCode: result.status, json };
  cache.set(relPath, entry);
  return entry;
}

function resolveKey(key, root = ROOT, cache = new Map()) {
  const instrument = KEY_INSTRUMENT[key];
  if (!instrument) return { key, ok: false, reason: `no instrument is registered as publishing ${key}` };
  const run = runInstrument(instrument, root, cache);
  if (run.exitCode !== 0) return { key, ok: false, reason: `${instrument} exited ${run.exitCode}` };
  if (run.json === null) return { key, ok: false, reason: `${instrument} --json produced no parseable report` };
  const [source, field] = key.split(":");
  const container = source === "p2b" ? run.json.measured : run.json.report;
  const value = container?.[field];
  if (typeof value !== "number") return { key, ok: false, reason: `${instrument} --json publishes no ${field}` };
  return { key, ok: true, value };
}

/**
 * Decide every declared stage from its own `decidedBy` keys. `all` means every clause must hold; a stage with no
 * `decidedBy`, or one whose keys cannot be resolved, is UNRESOLVED -- an unresolved deadline cannot be allowed to
 * read as "not yet due", because that is exactly how a bridge outlives its phase.
 */
function measurePhases(registry, root = ROOT, cache = new Map()) {
  const phases = {};
  for (const [id, stage] of Object.entries(registry.stages ?? {})) {
    const decidedBy = stage.decidedBy;
    if (!decidedBy || !Array.isArray(decidedBy.all) || decidedBy.all.length === 0) {
      phases[id] = { id, status: "UNRESOLVED", reason: "the stage declares no decidedBy keys, so its completion cannot be measured" };
      continue;
    }
    const resolutions = [];
    let complete = true;
    let resolvable = true;
    for (const clause of decidedBy.all) {
      if (typeof clause?.key !== "string" || typeof clause?.target !== "number") {
        resolvable = false;
        resolutions.push({ key: clause?.key ?? "(none)", ok: false, reason: "the clause is missing a key or a target" });
        continue;
      }
      const resolved = resolveKey(clause.key, root, cache);
      resolutions.push({ ...resolved, target: clause.target });
      if (!resolved.ok) resolvable = false;
      else if (!(resolved.value <= clause.target)) complete = false;
    }
    phases[id] = {
      id,
      status: resolvable ? (complete ? "COMPLETE" : "IN_PROGRESS") : "UNRESOLVED",
      trackedBy: stage.trackedBy ?? null,
      resolutions,
    };
  }
  return phases;
}

function substantive(value, minimum) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function validate(root = ROOT, options = {}) {
  const registry = options.registry ?? readRegistry(root);
  const cache = new Map();
  const phases = measurePhases(registry, root, cache);
  const bridges = registry.bridges ?? {};
  const plots = registry.plots ?? {};
  const problems = [];
  const entries = [];

  for (const [id, bridge] of Object.entries(bridges)) {
    const entry = { id, deadline: bridge.deadline_phase ?? null, phaseStatus: null, expired: false, literalPresent: null };
    entries.push(entry);

    for (const [field, minimum] of REQUIRED_FIELDS) {
      if (!substantive(bridge[field], minimum)) {
        problems.push(`bridge ${id} does not state a substantive ${field}: section 15 requires it and says a bridge without an exit condition is not allowed`);
      }
    }

    // The declaration must still describe the tree. A bridge is one source statement, named by `literal`, and it has
    // to be THERE: if the code is gone the declaration is stale, and if it appears twice the bridge is not one
    // statement and its exit condition does not describe it.
    const sourcePath = typeof bridge.source === "string" ? bridge.source.split(" (")[0].trim() : null;
    if (!sourcePath || !fs.existsSync(path.join(root, sourcePath))) {
      problems.push(`bridge ${id} names a source file that does not exist: ${JSON.stringify(sourcePath)}`);
    } else if (!substantive(bridge.literal, 5)) {
      problems.push(`bridge ${id} carries no ` + "literal" + ` source text, so nothing can be checked against the tree and the declaration cannot be falsified`);
    } else {
      const text = fs.readFileSync(path.join(root, sourcePath), "utf8");
      const occurrences = text.split(bridge.literal).length - 1;
      entry.literalPresent = occurrences;
      if (occurrences === 0) {
        problems.push(`bridge ${id} declares a statement that is NOT in ${sourcePath}: the bridge has been removed and the declaration is stale, which section 33's "no expired temporary bridge remains" covers`);
      } else if (occurrences > 1) {
        problems.push(`bridge ${id} declares a statement that appears ${occurrences} times in ${sourcePath}: a bridge is ONE statement, and its exit condition cannot describe several`);
      }
    }

    if (typeof bridge.tests === "string" && bridge.tests.length > 0 && !fs.existsSync(path.join(root, bridge.tests))) {
      problems.push(`bridge ${id} names a test file that does not exist: ${bridge.tests}`);
    }

    const declaredIn = Object.entries(plots).filter(([, plot]) => Array.isArray(plot?.bridges) && plot.bridges.includes(id));
    if (declaredIn.length === 0) {
      problems.push(`bridge ${id} is declared by no plot, so it is an orphan declaration`);
    }

    // The deadline, and whether it has passed.
    const deadline = bridge.deadline_phase;
    if (typeof deadline === "string" && deadline.trim() === SEAL_DEADLINE) {
      entry.phaseStatus = "PENDING_SEAL";
    } else if (typeof deadline === "string" && Object.prototype.hasOwnProperty.call(registry.stages ?? {}, deadline)) {
      entry.phaseStatus = phases[deadline]?.status ?? "UNRESOLVED";
    } else {
      entry.phaseStatus = "UNRECOGNISED";
      problems.push(`bridge ${id} declares deadline_phase ${JSON.stringify(deadline)}, which is neither a declared stage nor the seal: an unrecognised deadline is not a deadline`);
    }

    if (entry.phaseStatus === "COMPLETE") {
      entry.expired = true;
      problems.push(`bridge ${id} is EXPIRED: its deadline phase has completed, and section 33 forbids an expired temporary bridge at the seal`);
    }
    if (entry.phaseStatus === "UNRESOLVED") {
      problems.push(`bridge ${id} cannot be checked: the phase it is due before could not be measured, and an unmeasurable deadline must not read as "not yet due"`);
    }
    if (entry.phaseStatus === "PENDING_SEAL") {
      // A bridge whose deadline IS the seal cannot be expired by a phase, so the seal gate is the only thing that
      // can enforce it -- and the flatness validator refuses to seal while any bridge is declared. The two
      // artifacts are checked against each other in the test suite rather than assumed to agree here.
      entry.expiresAtSeal = true;
    }
  }

  const live = entries.filter((entry) => !entry.expired);
  return {
    schema: "city-bridge-expiry-report/1",
    ok: problems.length === 0,
    problems,
    bridges: entries,
    phases,
    sealGate: {
      declaredBridges: entries.length,
      liveBridges: live.length,
      note: "the seal gate must refuse while any bridge is declared; a bridge whose deadline is the seal is enforced by that gate rather than by a phase",
    },
  };
}

function render(report) {
  const lines = [];
  lines.push(`[bridge] declared ${report.bridges.length} bridge(s); ${report.sealGate.liveBridges} still live`);
  for (const [id, phase] of Object.entries(report.phases)) {
    const detail = phase.status === "UNRESOLVED" ? ` -- ${phase.reason ?? (phase.resolutions ?? []).map((entry) => entry.reason).filter(Boolean).join("; ")}` : (phase.resolutions ?? []).map((entry) => `${entry.key}=${entry.value}<=${entry.target}`).join(", ");
    lines.push(`[bridge]   phase ${id}: ${phase.status}${detail ? `  (${detail})` : ""}`);
  }
  for (const entry of report.bridges) {
    lines.push(`[bridge]   ${entry.id}  deadline ${JSON.stringify(entry.deadline)}  ${entry.phaseStatus}${entry.expired ? "  EXPIRED" : ""}  declaration ${entry.literalPresent === null ? "(unchecked)" : `${entry.literalPresent} occurrence(s)`}`);
  }
  if (report.ok) {
    lines.push("[bridge] VERDICT=HOLDS (every bridge is substantively declared, still present in the tree, and inside its deadline)");
    return lines.join("\n");
  }
  lines.push(`[bridge] VERDICT=REGRESSED (${report.problems.length} problem(s))`);
  for (const problem of report.problems) lines.push(`[bridge]   - ${problem}`);
  return lines.join("\n");
}

function main(argv, root = ROOT) {
  const report = validate(root);
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report)}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`bridge-expiry-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, validate, measurePhases, resolveKey, readRegistry, render, REQUIRED_FIELDS, KEY_INSTRUMENT, SEAL_DEADLINE, REGISTRY_PATH };
