#!/usr/bin/env node
/**
 * THE REPLACEMENT LIFECYCLE VALIDATOR (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 21, principle
 * 15.4)
 *
 * WHY IT IS A STATE MACHINE AND NOT A CHECKLIST
 *
 *   Section 21 requires a reusable replacement-governance mechanism and names seven pieces of machinery, then asks
 *   for one real bounded migration as its proof. A replacement that reports RETIRED without ever having run the old
 *   side and the new side side by side is indistinguishable, IN PROSE, from one that did: both read like a completed
 *   migration. The difference is the ORDER of the steps, so the order is what this program checks.
 *
 *   Every instance carries a history of states it has actually entered, and the validator refuses a history that
 *   skips a state, that arrives by an undeclared transition, that carries no evidence for the state it enters, or
 *   that cites a ledger entry the construction ledger does not contain. A RETIRED instance that never passed
 *   DUAL_VALIDATED therefore cannot be recorded, which is the whole point.
 *
 * THREE THINGS THAT COULD BE FAKED, AND WHAT STOPS EACH
 *
 *   1  claiming a later state: stopped by the history -- `state` must be the state the history actually reaches;
 *   2  walking the history without doing anything: stopped by the per-state EVIDENCE requirement, which must be
 *      substantive in the very entry that enters the state;
 *   3  an unexecutable rollback: stopped by `rollbackVerifiedBy`, which must name a file that exists.
 *
 * READ-ONLY. It measures and judges; it never writes.
 *
 * USAGE
 *
 *   node scripts/replacement-lifecycle-validator.cjs            check and print the report
 *   node scripts/replacement-lifecycle-validator.cjs --json     the report as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LIFECYCLE_PATH = path.join("config", "city-replacement-lifecycle.json");
const LEDGER_PATH = path.join("docs", "city", "OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md");
const MINIMUM = 40;

function readLifecycle(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, LIFECYCLE_PATH), "utf8"));
}

function substantive(value, minimum = MINIMUM) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function validate(root = ROOT, options = {}) {
  const lifecycle = options.lifecycle ?? readLifecycle(root);
  const ledger = fs.existsSync(path.join(root, LEDGER_PATH)) ? fs.readFileSync(path.join(root, LEDGER_PATH), "utf8") : "";
  const problems = [];

  const states = Array.isArray(lifecycle.states) ? lifecycle.states : [];
  const transitions = Array.isArray(lifecycle.transitions) ? lifecycle.transitions : [];
  const machinery = Array.isArray(lifecycle.requiredMachinery) ? lifecycle.requiredMachinery : [];
  const evidenceByState = lifecycle.evidenceByState ?? {};
  const terminal = new Set(Array.isArray(lifecycle.terminalStates) ? lifecycle.terminalStates : []);

  // ---- the protocol itself ------------------------------------------------------------------------------
  if (states.length < 5) problems.push(`the protocol declares ${states.length} state(s); a replacement lifecycle that omits a stage is a checklist`);
  if (states[0] !== "DECLARED") problems.push(`the first state is ${JSON.stringify(states[0])} rather than DECLARED, so an instance cannot begin`);
  if (machinery.length < 7) problems.push(`the protocol requires ${machinery.length} piece(s) of machinery; section 21 names seven`);
  for (const state of ["SHADOW", "DUAL_VALIDATED", "TRAFFIC_SWITCHED", "OLD_FALLBACK", "DRAINED", "RETIRED"]) {
    if (!states.includes(state)) problems.push(`the protocol has no ${state} state, so a replacement could reach the end without passing it`);
    else if (!substantive(evidenceByState[state], 10)) problems.push(`state ${state} requires no evidence, so it can be entered by assertion`);
  }
  if (!substantive(lifecycle.adoptionProtocol, 80)) problems.push("the protocol states no adoption procedure, so the next capability would have to invent one");

  const outgoing = new Map();
  for (const transition of transitions) {
    if (!states.includes(transition?.from) || !states.includes(transition?.to)) {
      problems.push(`transition ${JSON.stringify(transition)} names a state the protocol does not declare`);
      continue;
    }
    if (transition.to === "DECLARED") problems.push("a transition returns to DECLARED, which would let a history loop instead of progress");
    const set = outgoing.get(transition.from) ?? new Set();
    set.add(transition.to);
    outgoing.set(transition.from, set);
  }
  for (const state of terminal) {
    if ((outgoing.get(state)?.size ?? 0) > 0) problems.push(`terminal state ${state} has outgoing transition(s), so it is not terminal`);
  }
  // Every non-terminal state must be able to move forward, or an instance could be declared and abandoned mid-flight.
  for (const state of states) {
    if (terminal.has(state)) continue;
    if ((outgoing.get(state)?.size ?? 0) === 0) problems.push(`state ${state} has no outgoing transition, so an instance that reaches it can never finish`);
  }

  // ---- the instances ------------------------------------------------------------------------------------
  const instances = [];
  for (const [id, instance] of Object.entries(lifecycle.instances ?? {})) {
    const entry = { id, capability: instance.capability ?? null, state: instance.state ?? null, steps: 0, retired: false };
    instances.push(entry);

    for (const field of machinery) {
      if (!substantive(instance[field])) problems.push(`instance ${id} states no substantive ${field}; section 21 requires it as machinery, not as an intention`);
    }
    const rollbackFile = instance.rollbackVerifiedBy;
    if (!substantive(rollbackFile, 4)) problems.push(`instance ${id} names no file that verifies its rollback, so 'rollback is executable' is an assertion`);
    else if (!fs.existsSync(path.join(root, rollbackFile))) problems.push(`instance ${id} cites ${rollbackFile} as its rollback verification, which does not exist`);

    const history = Array.isArray(instance.history) ? instance.history : [];
    let current = "DECLARED";
    let previousAt = null;
    for (const [index, step] of history.entries()) {
      const to = step?.to;
      if (!states.includes(to)) {
        problems.push(`instance ${id} step ${index + 1} enters ${JSON.stringify(to)}, which the protocol does not declare`);
        break;
      }
      if (!(outgoing.get(current)?.has(to))) {
        problems.push(`instance ${id} step ${index + 1} moves ${current} -> ${to}, which is not a declared transition: a lifecycle cannot be walked out of order (the point of section 21 is the ORDER, and a RETIRED instance that never passed DUAL_VALIDATED is the specific forgery this refuses)`);
        break;
      }
      const evidenceField = evidenceByState[to];
      if (evidenceField && !substantive(step[evidenceField], MINIMUM)) {
        problems.push(`instance ${id} step ${index + 1} enters ${to} without a substantive ${evidenceField}`);
      }
      if (!substantive(step.at, 10)) problems.push(`instance ${id} step ${index + 1} carries no timestamp`);
      else if (previousAt !== null && step.at <= previousAt) problems.push(`instance ${id} step ${index + 1} is stamped ${step.at}, which is not after the previous step's ${previousAt}: a history that does not move forward in time is not a history`);
      if (previousAt === null || step.at > previousAt) previousAt = step.at;
      if (!substantive(step.ledgerEntry, 2)) {
        problems.push(`instance ${id} step ${index + 1} cites no ledger entry, so nothing append-only records the step`);
      } else if (!ledger.includes(`ENTRY_ID                    ${step.ledgerEntry}`)) {
        problems.push(`instance ${id} step ${index + 1} cites ledger entry ${step.ledgerEntry}, which the ledger does not contain`);
      }
      current = to;
      entry.steps = index + 1;
    }

    if (instance.state !== current) {
      problems.push(`instance ${id} reports state ${JSON.stringify(instance.state)} but its history reaches ${current}: a state cannot be claimed without being entered`);
    }
    if (terminal.has(current) && (outgoing.get(current)?.size ?? 0) === 0 && history.length > 0) {
      // Terminal states are final: no further steps are possible, which the loop above already guarantees.
    }
    entry.state = current;
    entry.retired = current === "RETIRED";
    if (current === "ROLLED_BACK") entry.rolledBack = true;
  }

  const retired = instances.filter((instance) => instance.retired);
  return {
    schema: "city-replacement-lifecycle-report/1",
    ok: problems.length === 0,
    problems,
    states,
    transitions: transitions.length,
    instances,
    retiredInstances: retired.length,
    anyRetired: retired.length > 0,
  };
}

function render(report) {
  const lines = [];
  lines.push(`[lifecycle] protocol: ${report.states.length} state(s), ${report.transitions} transition(s)`);
  for (const instance of report.instances) {
    lines.push(`[lifecycle]   ${instance.id}  capability ${instance.capability}  state ${instance.state}  ${instance.steps} step(s)${instance.retired ? "  RETIRED" : ""}`);
  }
  lines.push(`[lifecycle] ${report.retiredInstances} instance(s) have reached RETIRED`);
  if (report.ok) {
    lines.push("[lifecycle] VERDICT=HOLDS (every instance's history is a declared path, with evidence at each state)");
    return lines.join("\n");
  }
  lines.push(`[lifecycle] VERDICT=REGRESSED (${report.problems.length} problem(s))`);
  for (const problem of report.problems) lines.push(`[lifecycle]   - ${problem}`);
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
    process.stderr.write(`replacement-lifecycle-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, validate, readLifecycle, render, substantive, LIFECYCLE_PATH, MINIMUM };
