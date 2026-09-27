#!/usr/bin/env node
/**
 * THE MINIMUM-HUMAN-ACCEPTANCE GATE (Owner decision CC-103 D2)
 * over docs/city/PHASE2_MINIMUM_HUMAN_ACCEPTANCE_DECISION.md, profile file
 * config/city-minimum-human-acceptance.json.
 *
 * WHAT IT IS FOR
 *
 *   The strict full-city gate (scripts/city-final-acceptance.cjs) decides the Phase-2 seal, and it is
 *   still red on purpose: S2, S3, S4, S10 and S14 are not at their historical zero targets. CC-103 D2
 *   did NOT rewrite that gate or those targets. It added a SECOND, narrower checkpoint -- the smallest
 *   honest human gate reachable without another bulk rewiring programme -- and this file is that
 *   checkpoint's machine.
 *
 *   The difference between the two gates is a difference of claim, not of strictness:
 *
 *     city-final-acceptance.cjs   "the city meets the full Phase-2 contract"          -> NOT_READY
 *     this gate                   "nothing moved backwards, and every zero is zero"   -> READY
 *
 *   Every structural number here has TWO bounds. The floor is what `main@bf45476` measured and may not
 *   be exceeded. The strict target is the historical Phase-2 value. A metric between them is reported
 *   RATCHETED_ACCEPTED -- accepted for this checkpoint and visibly NOT at the strict target, which is
 *   the whole reason a reader must be able to see both numbers rather than one verdict.
 *
 * STATUSES
 *
 *   PASS                 at or below the strict target, or a gate that exits clean.
 *   RATCHETED_ACCEPTED   above the strict target and at or below the frozen floor. Never blocks, and
 *                        never reads as "done".
 *   ACCEPTED_PERMANENT   settled by an explicit Owner disposition under workbook section 31.
 *   UNVERIFIED           this run cannot decide it -- a missing --main-sha, or the hosted checks.
 *                        Blocks, exactly as the strict gate's UNVERIFIED does.
 *   BLOCKING             measured, and worse than the floor, or a gate that failed.
 *
 *   MACHINE_RATCHET is deliberately NOT a blocking status for this profile (D2): the principle is
 *   already machine-enforced by a ratchet, so it is RATCHETED_ACCEPTED here. NOT_GUARDED is BLOCKING.
 *
 * READ-ONLY. Every number is read from the artifact that owns it, through the same validators the
 * strict gate uses; none is typed in here. The debt register is read by the SAME function the strict
 * gate reads it with (`debtStatuses`), because two gates reading one register with two regexes is how
 * a verdict and its own explanation come to certify opposite things (ledger CC-063).
 *
 * USAGE
 *
 *   node scripts/city-minimum-human-acceptance.cjs                                   report
 *   node scripts/city-minimum-human-acceptance.cjs --json                            the report as JSON
 *   node scripts/city-minimum-human-acceptance.cjs --gate --main-sha=<sha> --hosted  the checkpoint gate
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { debtStatuses } = require("./city-final-acceptance.cjs");

const ROOT = path.join(__dirname, "..");
const PROFILE = "config/city-minimum-human-acceptance.json";
const DEBT_REGISTER = "docs/city/CITY_RENOVATION_DEBT_REGISTER.md";

const PASS = "PASS";
const RATCHETED_ACCEPTED = "RATCHETED_ACCEPTED";
const ACCEPTED_PERMANENT = "ACCEPTED_PERMANENT";
const UNVERIFIED = "UNVERIFIED";
const BLOCKING = "BLOCKING";
const STATUSES = [PASS, RATCHETED_ACCEPTED, ACCEPTED_PERMANENT, UNVERIFIED, BLOCKING];
/** The statuses that do NOT block this profile. Everything else does. */
const ACCEPTED_STATUSES = [PASS, RATCHETED_ACCEPTED, ACCEPTED_PERMANENT];

const SECTION_ORDER = ["STRUCTURE", "GATES", "DEBT", "EVIDENCE"];

function exists(rel, root = ROOT) {
  return fs.existsSync(path.join(root, rel));
}

function readText(rel, root = ROOT) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function readJson(rel, root = ROOT) {
  return JSON.parse(readText(rel, root));
}

/**
 * Run a repository program and parse its stdout as JSON, REGARDLESS of the exit code.
 *
 * Deliberately unlike the strict gate's helper, which only parses on exit 0: here a validator that
 * exits non-zero is reporting a MEASUREMENT (a violation count, a list of problems), and a gate that
 * threw that measurement away would have to guess the number it is supposed to compare against a
 * floor. The exit code is kept beside the parsed body so a failing validator can still be reported as
 * a failed validator.
 */
function runJson(rel, root = ROOT, cache = new Map(), args = ["--json"]) {
  const key = `json:${rel}:${args.join(" ")}`;
  if (cache.has(key)) return cache.get(key);
  const run = spawnSync(process.execPath, [path.join(root, rel), ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  let json = null;
  try {
    json = JSON.parse(run.stdout ?? "");
  } catch {
    json = null;
  }
  const entry = { exitCode: run.status, json, stderr: (run.stderr ?? "").slice(0, 400) };
  cache.set(key, entry);
  return entry;
}

/** Run a repository program whose EXIT CODE is the verdict, and cache it. */
function runExit(rel, root = ROOT, cache = new Map(), args = []) {
  const key = `exit:${rel}:${args.join(" ")}`;
  if (cache.has(key)) return cache.get(key);
  const run = spawnSync(process.execPath, [path.join(root, rel), ...args], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  cache.set(key, run.status);
  return run.status;
}

function gh(args) {
  const run = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout ?? "");
  } catch {
    return null;
  }
}

/**
 * Every number the profile reads, resolved from the instrument that owns it.
 *
 * Nothing here decides anything: `measure` reports what the tree says, `evaluate` compares it with the
 * profile. Keeping those apart is what lets the floors be falsified with a synthetic measurement
 * instead of by editing the repository.
 */
function measure(root = ROOT, cache = new Map()) {
  const profile = readJson(PROFILE, root);

  const p2b = runJson("scripts/p2b-kernel-feature-ratchet.cjs", root, cache);
  const p2bMeasured = p2b.json?.measured ?? {};
  const p2d = runJson("scripts/phase2-private-state.cjs", root, cache);
  const p2dReport = p2d.json?.report ?? {};
  const roads = runJson("scripts/capability-roads-validator.cjs", root, cache);
  const flatness = runJson("scripts/city-flatness-validator.cjs", root, cache);
  const principles = runJson("scripts/principle-enforcement-validator.cjs", root, cache);
  const bridge = runJson("scripts/bridge-expiry-validator.cjs", root, cache);
  const closure = runJson("scripts/capability-closure-validator.cjs", root, cache);
  const provenance = runJson("scripts/city-ledger-provenance.cjs", root, cache);
  const core = runJson("scripts/core-budget-validator.cjs", root, cache);
  const ratchet = runJson("scripts/architecture.cjs", root, cache, ["ratchet"]);
  const enforcement = runJson("scripts/architecture-enforcement.cjs", root, cache, ["--mode", "enforce", "--no-write"]);
  const rootTrust = runExit("scripts/acceptance-evolution-bless.cjs", root, cache, ["--check"]);

  const flatnessCounts = flatness.json?.counts ?? {};
  const principleCounts = principles.json?.counts ?? {};
  const expiredBridges = (bridge.json?.bridges ?? []).filter((entry) => entry.expired === true).length;
  const debt = exists(DEBT_REGISTER, root) ? debtStatuses(readText(DEBT_REGISTER, root)) : { ids: [], entries: [], unsettled: [], settled: [] };

  return {
    profile,
    metrics: {
      kernel_to_feature_file_edges: p2bMeasured.kernelToFeatureFileEdges ?? null,
      kernel_to_feature_distinct_pairs: p2bMeasured.kernelToFeaturePairs ?? null,
      mutual_capability_pairs: p2bMeasured.mutualCapabilityPairs ?? null,
      largest_scc_size: p2bMeasured.largestSccSize ?? null,
      migration_in_progress: flatnessCounts.MIGRATION_IN_PROGRESS ?? null,
      confirmed_cross_domain_accesses: p2dReport.confirmedAccesses ?? null,
      multi_writer_candidates: Array.isArray(p2dReport.multiWriterCandidates) ? p2dReport.multiWriterCandidates.length : null,
      road_edges_leaving_a_road: roads.json?.effect?.edgesFromRoads ?? null,
      architecture_enforcement_violations: enforcement.json?.summary?.violations ?? null,
      unsafe_gap: flatnessCounts.UNSAFE_GAP ?? null,
      expired_bridge: expiredBridges,
      not_guarded: principleCounts.NOT_GUARDED ?? null,
      machine_ratchet: principleCounts.MACHINE_RATCHET ?? null
    },
    gates: {
      closure: { pass: closure.exitCode === 0 && (closure.json?.problems ?? []).length === 0, detail: `capability-closure-validator.cjs exit ${closure.exitCode}, ${(closure.json?.problems ?? []).length} problem(s) over ${closure.json?.scannedSourceFiles ?? "?"} scanned source file(s)` },
      ledgerProvenance: { pass: provenance.exitCode === 0 && (provenance.json?.problems ?? []).length === 0, detail: `city-ledger-provenance.cjs exit ${provenance.exitCode}, ${provenance.json?.entries ?? "?"} entr(ies), ${(provenance.json?.problems ?? []).length} problem(s)` },
      legacyRatchet: { pass: ratchet.exitCode === 0 && (ratchet.json?.violations ?? []).length === 0, detail: `architecture.cjs ratchet exit ${ratchet.exitCode}, ${(ratchet.json?.violations ?? []).length} violation(s) against bootModuleCount ${ratchet.json?.metrics?.bootModuleCount ?? "?"}` },
      roads: { pass: roads.exitCode === 0 && (roads.json?.undispositioned ?? []).length === 0, detail: `capability-roads-validator.cjs exit ${roads.exitCode}, ${(roads.json?.undispositioned ?? []).length} undispositioned leaf candidate(s), ${roads.json?.effect?.roads ?? "?"} declared road(s)` },
      core: { pass: core.exitCode === 0, detail: `core-budget-validator.cjs exit ${core.exitCode}, ${core.json?.decision?.measured?.unexcusedGrowth ?? "?"} unexcused growth` },
      flatness: { pass: flatness.exitCode === 0, detail: `city-flatness-validator.cjs exit ${flatness.exitCode}, verdict ${flatness.json?.verdict ?? "?"}` },
      enforcement: { pass: enforcement.json?.verdict === "PASS" && (enforcement.json?.summary?.violations ?? -1) === 0, detail: `architecture-enforcement.cjs --mode enforce verdict ${enforcement.json?.verdict ?? "UNREAD"}, mode ${enforcement.json?.mode ?? "?"}` },
      rootTrust: { pass: rootTrust === 0, detail: `acceptance-evolution-bless.cjs --check exit ${rootTrust}` }
    },
    debt,
    raw: { p2b: p2b.json, flatness: flatness.json, principles: principles.json, enforcement: enforcement.json, roads: roads.json, ratchet: ratchet.json }
  };
}

/** Compare one measured number against its floor and its strict target. Pure. */
function ratchetStatus(measured, floor, strictTarget) {
  if (typeof measured !== "number" || Number.isNaN(measured)) return UNVERIFIED;
  if (measured > floor) return BLOCKING;
  return measured <= strictTarget ? PASS : RATCHETED_ACCEPTED;
}

/**
 * The decision, computed from a measurement and a context. Pure and exported so every floor can be
 * falsified by a test with a synthetic measurement rather than by editing the repository.
 */
function evaluate(measurement, context = {}) {
  const { profile, metrics, gates, debt } = measurement;
  const floors = profile.floors;
  const targets = profile.strict_targets;
  const items = [];
  const add = (section, id, text, status, evidence, numbers = {}) => items.push({ section, id, text, status, evidence, ...numbers });

  // ---- STRUCTURE: every frozen floor, each with its strict target beside it -------------------------
  const structural = [
    ["S2", "kernel -> feature FILE edges stay at or below the frozen floor", "kernel_to_feature_file_edges", "file edge(s)"],
    ["S2b", "kernel -> feature DISTINCT PAIRS stay at or below the frozen floor", "kernel_to_feature_distinct_pairs", "distinct pair(s)"],
    ["S3", "mutual capability pairs stay at or below the frozen floor", "mutual_capability_pairs", "mutual pair(s)"],
    ["S4", "largest strongly connected component stays at or below the frozen floor", "largest_scc_size", "capabilit(ies) in the largest SCC"],
    ["S10", "plots left in MIGRATION_IN_PROGRESS stay at or below the frozen floor", "migration_in_progress", "plot(s)"],
    ["S5", "confirmed cross-domain private-state accesses", "confirmed_cross_domain_accesses", "confirmed access(es)"],
    ["S6", "namespaces touched by more than one non-owner capability (multi-writer candidates)", "multi_writer_candidates", "candidate namespace(s)"],
    ["S7", "road edges that leave a road", "road_edges_leaving_a_road", "edge(s) leaving a road"],
    ["S9", "plots in UNSAFE_GAP", "unsafe_gap", "plot(s) in UNSAFE_GAP"],
    ["S11", "expired temporary bridges", "expired_bridge", "expired bridge(s)"],
    ["S14", "principles with NO guard at all", "not_guarded", "unguarded principle(s)"]
  ];
  for (const [id, text, key, unit] of structural) {
    const measured = metrics[key];
    const floor = floors[key];
    // A metric with no separately declared strict target HAS one: the floor is zero and the strict
    // full-city target for a zero floor is zero. Without this, `measured <= undefined` is false and a
    // measured zero is reported as "NOT at the strict target", which is the kind of number a reader
    // would rightly stop trusting.
    const target = targets[key] ?? floor;
    const status = ratchetStatus(measured, floor, target);
    const where = status === PASS
      ? `measured ${measured} ${unit}, at the strict target ${target}`
      : status === RATCHETED_ACCEPTED
        ? `measured ${measured} ${unit}: at or below the frozen floor ${floor}, and NOT at the strict full-city target ${target}`
        : status === BLOCKING
          ? `measured ${measured} ${unit}, ABOVE the frozen floor ${floor}`
          : `the validator did not report a usable number for ${key}`;
    add("STRUCTURE", id, text, status, where, { measured, floor, strictTarget: target });
  }

  // S14's second half: MACHINE_RATCHET is acceptable under this profile (D2) because a ratchet IS a
  // machine. It is reported so a reader sees it, and it never blocks.
  const machineRatchet = metrics.machine_ratchet;
  add("STRUCTURE", "S14r", "principles guarded only by a ratchet (acceptable under this profile, never a pass)",
    typeof machineRatchet === "number" && machineRatchet <= targets.machine_ratchet ? PASS : RATCHETED_ACCEPTED,
    typeof machineRatchet === "number" && machineRatchet <= targets.machine_ratchet
      ? `measured ${machineRatchet} ratcheted principle(s), at the strict target`
      : `measured ${machineRatchet} principle(s) enforced by a ratchet rather than a guard: MACHINE_RATCHET does not block the minimum profile (CC-103 D2), and it is NOT reported as a pass`,
    { measured: machineRatchet, floor: null, strictTarget: targets.machine_ratchet });

  // ---- GATES: the validators that must not be failing ----------------------------------------------
  const gateItems = [
    ["G1", "capability closure holds", "closure"],
    ["G2", "ledger provenance holds", "ledgerProvenance"],
    ["G3", "the legacy architecture ratchet holds", "legacyRatchet"],
    ["G4", "architecture enforcement reports no violation", "enforcement"],
    ["G5", "Root Trust --check MATCHES", "rootTrust"],
    ["G6", "road validation holds", "roads"],
    ["G7", "the Core budget holds", "core"],
    ["G8", "the flatness validator holds", "flatness"]
  ];
  for (const [id, text, key] of gateItems) {
    const gate = gates[key] ?? { pass: false, detail: `${key} was not measured` };
    add("GATES", id, text, gate.pass ? PASS : BLOCKING, gate.detail);
  }

  // ---- DEBT: every disposition must be one the Owner accepted ---------------------------------------
  const unsettled = debt.unsettled ?? [];
  const acceptedPermanent = (debt.settled ?? []).filter((entry) => entry.status === ACCEPTED_PERMANENT);
  const accepted = profile.accepted_debt_statuses;
  const debtStatus = (debt.ids ?? []).length === 0
    ? BLOCKING
    : unsettled.length > 0
      ? BLOCKING
      : acceptedPermanent.length > 0
        ? ACCEPTED_PERMANENT
        : PASS;
  add("DEBT", "D1", `every renovation debt is one of ${accepted.join(" / ")}`, debtStatus,
    (debt.ids ?? []).length === 0
      ? `the debt register names no CITY-DEBT id, so there is nothing to disposition`
      : unsettled.length > 0
        ? `${unsettled.length} debt entr(ies) are ${unsettled.map((entry) => entry.status).join(", ")}: ${unsettled.map((entry) => entry.id).join(", ")}`
        : acceptedPermanent.length > 0
          ? `all ${(debt.settled ?? []).length} settled entr(ies) are ${accepted.join(" or ")}, and ${acceptedPermanent.map((entry) => `${entry.id} ${entry.status}`).join(", ")} is an explicit Owner disposition rather than a repair`
          : `all ${(debt.settled ?? []).length} entr(ies) are CLOSED`);

  const decisionRecord = measurement.decisionRecordExists ?? exists(profile.decision);
  add("DEBT", "D2", "the minimum-human-acceptance Owner decision is on disk", decisionRecord ? PASS : BLOCKING,
    decisionRecord ? `${profile.decision} exists` : `${profile.decision} is missing, so this profile has no Owner decision behind it`);

  // ---- EVIDENCE: the exact immutable SHA and its hosted checks --------------------------------------
  const mainSha = context.mainSha ?? null;
  const hosted = context.hosted === true;
  const observed = Array.isArray(context.hostedChecks) ? context.hostedChecks : null;
  const required = profile.required_hosted_checks;
  const green = observed ? required.filter((name) => observed.some((run) => run.name === name && run.status === "completed" && run.conclusion === "success")) : [];
  const hostedStatus = mainSha && hosted
    ? green.length === required.length ? PASS : BLOCKING
    : UNVERIFIED;
  add("EVIDENCE", "E1", `all of ${required.join(", ")} are completed/success on the named SHA`, hostedStatus,
    mainSha && hosted
      ? green.length === required.length
        ? `quality, unit, acceptance, package and architecture are all completed/success on ${mainSha}`
        : `${green.length} of ${required.length} green on ${mainSha}: ${JSON.stringify((observed ?? []).map((run) => `${run.name}=${run.conclusion}`))}`
      : "the hosted checks are not readable without --hosted and --main-sha, and this checkpoint may not rest on a local run",
    { measured: green.length, floor: required.length, strictTarget: required.length });

  const headSha = context.headSha ?? null;
  const dirty = context.dirty ?? null;
  const clean = dirty === false;
  const identityStatus = !mainSha || !headSha ? UNVERIFIED : (headSha === mainSha && clean ? PASS : BLOCKING);
  add("EVIDENCE", "E2", "the named SHA is this tree, and this tree is clean", identityStatus,
    !mainSha
      ? "no --main-sha was given, so no single SHA is named by this run"
      : !headSha
        ? "the HEAD SHA could not be read"
        : headSha === mainSha && clean
          ? `HEAD is ${mainSha} and git status --porcelain is empty`
          : `HEAD is ${headSha} against named ${mainSha}, working tree ${clean ? "clean" : "dirty"}`);

  const counts = { PASS: 0, RATCHETED_ACCEPTED: 0, ACCEPTED_PERMANENT: 0, UNVERIFIED: 0, BLOCKING: 0 };
  for (const item of items) counts[item.status] += 1;
  const blockingIds = items.filter((item) => !ACCEPTED_STATUSES.includes(item.status)).map((item) => item.id);
  const strictNotMet = items.filter((item) => item.status === RATCHETED_ACCEPTED && typeof item.measured === "number" && item.strictTarget !== null).map((item) => `${item.id} ${item.measured}>${item.strictTarget}`);

  return {
    items,
    counts,
    ready: blockingIds.length === 0,
    blocking: blockingIds,
    strictTargetsMet: strictNotMet.length === 0,
    strictTargetsNotMet: strictNotMet
  };
}

/** Read the hosted check runs for one SHA, keeping the run/job identity for the record. */
function hostedChecks(mainSha) {
  const body = gh(["api", `repos/{owner}/{repo}/commits/${mainSha}/check-runs`]);
  if (!Array.isArray(body?.check_runs)) return null;
  return body.check_runs.map((run) => {
    const match = /\/(\d+)\/job\/(\d+)/.exec(run.details_url ?? "");
    return { name: run.name, status: run.status, conclusion: run.conclusion, runId: match ? Number(match[1]) : null, jobId: match ? Number(match[2]) : null };
  });
}

function context(root = ROOT, options = {}, cache = new Map()) {
  const headSha = (spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout ?? "").trim() || null;
  const porcelain = (spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout ?? "").trim();
  return {
    hosted: options.hosted === true,
    mainSha: typeof options.mainSha === "string" ? options.mainSha : null,
    hostedChecks: options.hosted && options.mainSha ? hostedChecks(options.mainSha) : null,
    headSha,
    dirty: porcelain.length > 0,
    decisionRecordExists: exists(readJson(PROFILE, root).decision, root)
  };
}

function render(report) {
  const lines = [];
  for (const section of SECTION_ORDER) {
    const items = report.items.filter((item) => item.section === section);
    if (items.length === 0) continue;
    const accepted = items.filter((item) => ACCEPTED_STATUSES.includes(item.status)).length;
    lines.push(`[minimum] ${section}: ${accepted}/${items.length} acceptable for this profile`);
    for (const item of items) {
      lines.push(`[minimum]   ${item.status.padEnd(18)} ${item.id.padEnd(4)} ${item.text}`);
      if (item.status !== PASS) lines.push(`[minimum]   ${"".padEnd(18)}      -> ${item.evidence}`);
    }
  }
  lines.push(`[minimum] ${report.counts.PASS} PASS, ${report.counts.RATCHETED_ACCEPTED} RATCHETED_ACCEPTED, ${report.counts.ACCEPTED_PERMANENT} ACCEPTED_PERMANENT, ${report.counts.UNVERIFIED} UNVERIFIED, ${report.counts.BLOCKING} BLOCKING`);
  // The line that keeps this checkpoint honest: a reader must be able to see that the ratcheted
  // metrics are NOT at the strict full-city target, whatever this gate's own verdict says.
  lines.push(report.strictTargetsMet
    ? `[minimum] STRICT_FULL_CITY_TARGETS = MET`
    : `[minimum] STRICT_FULL_CITY_TARGETS = NOT_MET (${report.strictTargetsNotMet.join(", ")}) -- deferred full-city renovation debt, see ${report.profile.decision}`);
  if (report.ready) lines.push(`[minimum] VERDICT=READY (MINIMUM_HUMAN_ACCEPTANCE)`);
  else lines.push(`[minimum] VERDICT=NOT_READY (${report.blocking.length} blocking item(s): ${report.blocking.join(", ")})`);
  return lines.join("\n");
}

function main(argv, root = ROOT) {
  const options = {
    hosted: argv.includes("--hosted"),
    mainSha: (argv.find((argument) => argument.startsWith("--main-sha=")) ?? "").split("=")[1] ?? null
  };
  const cache = new Map();
  const measurement = measure(root, cache);
  const decision = evaluate(measurement, context(root, options, cache));
  const report = {
    schema: "city-minimum-human-acceptance/1",
    profile: measurement.profile,
    hosted: options.hosted,
    mainSha: options.mainSha,
    items: decision.items,
    counts: decision.counts,
    ready: decision.ready,
    blocking: decision.blocking,
    strictTargetsMet: decision.strictTargetsMet,
    strictTargetsNotMet: decision.strictTargetsNotMet,
    metrics: measurement.metrics,
    gates: measurement.gates
  };

  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report)}\n`);

  // Reporting mode always exits 0: the profile is information until the checkpoint is attempted.
  if (argv.includes("--gate") && !decision.ready) return 1;
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`city-minimum-human-acceptance failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main, measure, evaluate, render, context, hostedChecks, ratchetStatus, debtStatuses,
  PROFILE, DEBT_REGISTER, SECTION_ORDER, ACCEPTED_STATUSES,
  STATUSES: { PASS, RATCHETED_ACCEPTED, ACCEPTED_PERMANENT, UNVERIFIED, BLOCKING }
};
