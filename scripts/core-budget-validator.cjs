#!/usr/bin/env node
/**
 * THE CORE GROWTH BUDGET (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 22, principle 15.9)
 *
 * WHAT SECTION 22 ASKS FOR
 *
 *   Three things, in this order: "Measure the city-phase starting Core/foundation surface using a stable
 *   classification"; "Create a machine-enforced budget"; and, as the final acceptance, "Core size <= Phase 2
 *   starting Core size -- unless every increase has a separate Owner-approved architecture exception". It adds the
 *   rule that keeps the budget from being gamed by relabelling: "shared road != automatic Core", and the rule that
 *   keeps an exception from becoming a quiet edit: "An exception does not silently redefine the baseline".
 *
 * THE STABLE CLASSIFICATION, AND WHY THIS ONE
 *
 *   A capability is Core if and only if its MANIFEST declares `kind: kernel`. That field already exists, is
 *   already the basis of the P2-B/P2-C ratchet's kernel->feature measurement, and is therefore not a second
 *   opinion about the same tree -- it is the same opinion. The composition root is measured as its OWN line and
 *   is NOT folded into the capability total, because section 22 forbids treating shared infrastructure as
 *   automatic Core and because conflating the two is exactly how a road would enter Core unnoticed.
 *
 *   At the city-phase start this classifies FOUR capabilities -- persistence, providers, runtime, state-core --
 *   and those four are then PINNED BY NAME. Pinning by name matters more than it looks: a count would still read
 *   four if a kernel lost its `kind` and some unrelated capability gained one, so the budget would hold while the
 *   foundation had been swapped underneath it.
 *
 * HOW THE BUDGET IS ENFORCED
 *
 *   1  the pinned Core names must all still be Core -- a kernel cannot leave Core by losing its kind;
 *   2  a capability that is Core now but was not at the start must be covered by an exception naming it;
 *   3  Core owned files must not exceed the starting count plus the allowances of approved exceptions;
 *   4  the COMPOSITION ROOT is a ceiling of its own, so shared machinery cannot drift into Core;
 *   5  the TOTAL owned file count is a FLOOR, because shrinking Core by scanning fewer files is the same fraud
 *      the P2-B ratchet already refuses: a capability that vanishes from the map makes Core look smaller without
 *      anything having been repaired;
 *   6  an exception is not a comment. It must enumerate its identity, answer section 22's four questions, carry a
 *      debt id and an exit condition, and be recorded in the construction ledger -- and the ledger is append-only,
 *      so the record cannot be withdrawn;
 *   7  the starting measurement is anchored to the LEDGER ENTRY that recorded it, so re-recording the baseline is
 *      a visible act rather than an edit to a number.
 *
 * READ-ONLY. It measures and judges; it never writes.
 *
 * USAGE
 *
 *   node scripts/core-budget-validator.cjs            check and print the decision
 *   node scripts/core-budget-validator.cjs --json     the measurement and decision as JSON
 *   node scripts/core-budget-validator.cjs --measure  only the measurement, for recording a new baseline
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUDGET_PATH = path.join("config", "core-budget.json");
const LEDGER_PATH = path.join("docs", "city", "OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md");

const CLASSIFICATION =
  "Core = a capability whose manifest declares kind: kernel. The composition root is measured separately and is never folded into the capability total.";

const KERNEL_KIND = "kernel";

/** Section 22's four questions (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md), which an exception has to answer rather than gesture at. */
const EXCEPTION_QUESTIONS = [
  ["whyExistingRoadCannotCarryIt", "why an existing road or foundation element cannot carry it"],
  ["whyItIsNotABuilding", "why it is not a building"],
  ["whatInvariantOnlyCoreCanHold", "what invariant only Core can hold"],
  ["whatBreaksIfOutsideCore", "what breaks if it remains outside Core"],
];

function readBudget(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, BUDGET_PATH), "utf8"));
}

function readLedger(root = ROOT) {
  const absolute = path.join(root, LEDGER_PATH);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
}

/**
 * Measure the Core/foundation surface. The classification is read from the MANIFESTS; the sizes are resolved
 * through the CLOSURE VALIDATOR's own scan set, ownership map and `ownsPath` rule, so this instrument cannot
 * disagree with the rest of the programme about which capability owns which file.
 *
 * The ownership map stores PATTERNS, not files -- 271 of them, expanding to the scanned tree -- so counting the
 * patterns would have produced a number that looks like a size and is not one. The file counts here are the same
 * currency the P2-B/P2-C ratchet records (598 owned files at the time of writing).
 */
function measure(root = ROOT, options = {}) {
  const closure = require(path.join(__dirname, "capability-closure-validator.cjs"));
  const manifests = options.manifests ?? closure.readManifests(root);
  const map = options.map ?? closure.readOwnershipMap(root);
  const files = options.files ?? closure.scanSet(root);
  const ownsPath = closure.ownsPath;

  const kinds = {};
  const coreCapabilities = [];
  for (const manifest of manifests) {
    if (!manifest.id) continue;
    kinds[manifest.id] = manifest.kind ?? null;
    if (manifest.kind === KERNEL_KIND) coreCapabilities.push(manifest.id);
  }
  coreCapabilities.sort();

  const perCapability = {};
  const claimed = new Set();
  for (const [capability, patterns] of Object.entries(map.capabilities)) {
    const owned = files.filter((file) => ownsPath(patterns, file));
    perCapability[capability] = owned.length;
    for (const file of owned) claimed.add(file);
  }
  let coreOwnedFiles = 0;
  for (const id of coreCapabilities) coreOwnedFiles += perCapability[id] ?? 0;

  const compositionRootFiles = files.filter((file) => ownsPath(Object.keys(map.compositionRoot ?? {}), file)).length;

  return {
    schema: "city-core-budget-measurement/1",
    classification: CLASSIFICATION,
    ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, resolved to FILES through the closure validator's scan set",
    scanRoots: ["electron", "src"],
    coreCapabilities,
    coreOwnedFiles,
    filesPerCapability: perCapability,
    compositionRootFiles,
    capabilityCount: Object.keys(map.capabilities ?? {}).length,
    capabilityOwnedFiles: claimed.size,
    scannedSourceFiles: files.length,
    manifestCount: manifests.filter((manifest) => manifest.id).length,
    kinds,
  };
}

function substantive(value, minimum = 30) {
  return typeof value === "string" && value.trim().length >= minimum;
}

/**
 * Judge the measurement against the budget. `ledger` is injected so the ledger cross-check can be falsified.
 */
function decide(measurement, budget, ledger) {
  const problems = [];
  const improvements = [];
  const starting = budget.starting ?? {};
  const exceptions = Array.isArray(budget.exceptions) ? budget.exceptions : [];

  // The classification is a property of the BUDGET, not of the starting block. Reading it from the wrong place
  // made this rule fire as "a different classification" when the field was merely absent, which is a different
  // fault with a different repair.
  if (typeof budget.classification !== "string" || budget.classification.trim().length === 0) {
    problems.push("the budget states no classification, so there is no agreement about what Core is");
  } else if (budget.classification !== CLASSIFICATION) {
    problems.push("the budget records a different classification from the one this program measures with, so the two are not describing the same surface");
  }
  const pinned = Array.isArray(starting.coreCapabilities) ? starting.coreCapabilities : [];
  if (pinned.length === 0) problems.push("the budget records no starting Core capabilities, so it pins nothing");

  // 1 -- a pinned name cannot leave Core.
  for (const id of pinned) {
    if (!measurement.coreCapabilities.includes(id)) {
      problems.push(`${id} was Core at the city-phase start and is not Core now: its manifest no longer declares kind: ${KERNEL_KIND}, which moves a foundation element out of the surface being budgeted`);
    }
  }

  // 2 -- a new Core capability is an exception, not an event.
  const uncoveredCapabilities = measurement.coreCapabilities.filter((id) => !pinned.includes(id));
  const exceptedCapabilities = new Set(exceptions.map((entry) => entry.capability));
  for (const id of uncoveredCapabilities) {
    if (!exceptedCapabilities.has(id)) {
      problems.push(`${id} is Core now and was not at the start, and no exception names it`);
    }
  }
  if (uncoveredCapabilities.length === 0) {
    for (const entry of exceptions) {
      if (typeof entry.capability === "string" && measurement.coreCapabilities.includes(entry.capability)) {
        improvements.push(`exception ${entry.id} names ${entry.capability}, which is Core -- the exception is still carrying an identity it was written for`);
      }
    }
  }

  // 3 and 4 -- the ceilings.
  const startingCoreFiles = typeof starting.coreOwnedFiles === "number" ? starting.coreOwnedFiles : 0;
  const startingCompositionRoot = typeof starting.compositionRootFiles === "number" ? starting.compositionRootFiles : 0;
  const allowances = exceptions.reduce((sum, entry) => sum + (typeof entry.allowedFiles === "number" ? entry.allowedFiles : 0), 0);
  const coreGrowth = measurement.coreOwnedFiles - startingCoreFiles;
  const compositionGrowth = measurement.compositionRootFiles - startingCompositionRoot;
  const growth = Math.max(0, coreGrowth) + Math.max(0, compositionGrowth);
  const unexcusedGrowth = Math.max(0, growth - allowances);

  if (growth > 0 && allowances === 0) {
    problems.push(`Core grew by ${growth} owned file(s) -- ${coreGrowth} capability file(s) and ${compositionGrowth} composition-root file(s) -- above the city-phase starting surface, with no exception recorded`);
  }
  if (growth > allowances && allowances > 0) {
    problems.push(`Core grew by ${growth} owned file(s) but the recorded exceptions allow only ${allowances}`);
  }
  if (growth <= 0) improvements.push(`Core is at or below its starting surface (${measurement.coreOwnedFiles} capability file(s) against ${startingCoreFiles})`);

  // 5 -- the floors. A fall in these is not progress.
  const floor = (label, value, recorded, why) => {
    if (typeof recorded !== "number") {
      problems.push(`${label} has no recorded floor, so a fall in it could not be detected`);
      return;
    }
    if (value < recorded) problems.push(`${label} fell from ${recorded} to ${value}: ${why}`);
  };
  floor("capability-owned files", measurement.capabilityOwnedFiles, starting.capabilityOwnedFiles, "a smaller Core that comes from a smaller ownership map is not a smaller Core, it is a smaller measurement");
  floor("scanned source files", measurement.scannedSourceFiles, starting.scannedSourceFiles, "Core cannot be shrunk by narrowing the scan, which would lower every count while nothing was repaired");
  floor("declared manifest count", measurement.manifestCount, starting.manifestCount, "a capability that lost its manifest stops being classified without being retired");

  // 6 -- an exception is an Owner-authorised architecture decision, not a comment.
  const seen = new Set();
  for (const entry of exceptions) {
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : "(unnamed exception)";
    if (seen.has(id)) problems.push(`exception ${id} is declared twice`);
    seen.add(id);
    if (!substantive(entry.capability, 1) && entry.capability !== "composition_root") {
      problems.push(`exception ${id} does not name the identity it covers`);
    }
    if (typeof entry.allowedFiles !== "number" || entry.allowedFiles < 1) {
      problems.push(`exception ${id} states no positive file allowance, so it authorises nothing`);
    }
    if (!substantive(entry.debtId, 4)) problems.push(`exception ${id} carries no debt id`);
    if (!substantive(entry.exitCondition, 20)) problems.push(`exception ${id} states no exit condition, so the increase has no end`);
    if (!substantive(entry.ownerAuthorization, 20)) problems.push(`exception ${id} names no Owner authorization`);
    for (const [field, question] of EXCEPTION_QUESTIONS) {
      if (!substantive(entry[field], 30)) problems.push(`exception ${id} does not answer ${question}`);
    }
    if (!substantive(entry.ledgerEntry, 2)) {
      problems.push(`exception ${id} is not recorded in the construction ledger`);
    } else if (!ledger.includes(`ENTRY_ID                    ${entry.ledgerEntry}`)) {
      problems.push(`exception ${id} cites ledger entry ${entry.ledgerEntry}, which the ledger does not contain`);
    } else if (!ledger.includes(id)) {
      problems.push(`exception ${id} cites ledger entry ${entry.ledgerEntry}, but that entry does not mention ${id}, so the ledger does not record this exception`);
    }
  }

  // 7 -- the starting measurement is anchored to an append-only record, so re-recording it is a visible act.
  if (!substantive(starting.recordedByLedgerEntry, 2)) {
    problems.push("the starting measurement names no ledger entry, so nothing outside this file records where the baseline came from");
  } else if (!ledger.includes(`ENTRY_ID                    ${starting.recordedByLedgerEntry}`)) {
    problems.push(`the starting measurement cites ledger entry ${starting.recordedByLedgerEntry}, which the ledger does not contain`);
  }

  return {
    schema: "city-core-budget-decision/1",
    ok: problems.length === 0,
    classification: CLASSIFICATION,
    recordedAt: budget.recordedAt ?? null,
    target: budget.target ?? { growth: 0 },
    problems,
    improvements,
    measured: {
      coreCapabilities: measurement.coreCapabilities,
      coreOwnedFiles: measurement.coreOwnedFiles,
      compositionRootFiles: measurement.compositionRootFiles,
      capabilityCount: measurement.capabilityCount,
      capabilityOwnedFiles: measurement.capabilityOwnedFiles,
      scannedSourceFiles: measurement.scannedSourceFiles,
      manifestCount: measurement.manifestCount,
      startingCoreFiles,
      startingCompositionRoot,
      coreGrowth,
      compositionGrowth,
      growth,
      allowances,
      unexcusedGrowth,
      exceptions: exceptions.length,
    },
  };
}

function render(measurement, decision) {
  const lines = [];
  lines.push(`[core] classification: ${CLASSIFICATION}`);
  lines.push(`[core] Core capabilities (${measurement.coreCapabilities.length}): ${measurement.coreCapabilities.map((id) => `${id}(${measurement.filesPerCapability[id]})`).join(", ")}`);
  lines.push(`[core] measured Core ${measurement.coreOwnedFiles} owned file(s) against a starting ${decision.measured.startingCoreFiles}; composition root ${measurement.compositionRootFiles} against ${decision.measured.startingCompositionRoot}`);
  lines.push(`[core] capability-owned files ${measurement.capabilityOwnedFiles} of ${measurement.scannedSourceFiles} scanned; manifests ${measurement.manifestCount}; capabilities ${measurement.capabilityCount}`);
  lines.push(`[core] growth ${decision.measured.growth} file(s); recorded exception allowance ${decision.measured.allowances}; UNEXCUSED growth ${decision.measured.unexcusedGrowth}   (section 22 target: 0)`);
  for (const line of decision.improvements) lines.push(`[core] IMPROVED ${line}`);
  if (decision.ok) {
    lines.push("[core] VERDICT=HOLDS (Core is inside its budget; no unapproved growth)");
    return lines.join("\n");
  }
  lines.push(`[core] VERDICT=REGRESSED (${decision.problems.length} problem(s))`);
  for (const problem of decision.problems) lines.push(`[core]   - ${problem}`);
  return lines.join("\n");
}

function main(argv, root = ROOT) {
  const measurement = measure(root);
  if (argv.includes("--measure")) {
    process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
    return 0;
  }
  const decision = decide(measurement, readBudget(root), readLedger(root));
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify({ measurement, decision }, null, 2)}\n`);
  else process.stdout.write(`${render(measurement, decision)}\n`);
  return decision.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`core-budget-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  measure,
  decide,
  readBudget,
  readLedger,
  render,
  CLASSIFICATION,
  EXCEPTION_QUESTIONS,
  BUDGET_PATH,
  LEDGER_PATH,
};
