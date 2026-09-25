#!/usr/bin/env node
/**
 * THE FINAL-CITY ACCEPTANCE SUITE (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 30, over the
 * completion definition in section 33)
 *
 * WHAT IT IS FOR
 *
 *   Section 33 enumerates the conditions under which the programme is complete: nine Governance items, fourteen
 *   Structure items, five Evidence items and six Final-main items. Section 30 enumerates the artifacts and commands
 *   that have to run before completion may be declared, and adds the rule that governs the whole exercise: "No final
 *   result may depend solely on a local run."
 *
 *   Until this program existed, "are we done?" was a READING exercise over two documents and a set of validators --
 *   which is how a required artifact goes missing for a whole programme (section 30 named a bridge expiry validator
 *   that had never been written, found only when someone read the last section of the workbook).
 *
 * THREE STATUSES, AND WHY THERE ARE THREE
 *
 *   PASS        machine-verified from the tree, an instrument's live output, or the hosted API when asked.
 *   OPEN        machine-verified as NOT YET satisfied. Always blocks the seal.
 *   UNVERIFIED  the tree cannot decide it -- completeness of the cloud ledger, the live ruleset, the hosted checks.
 *               Blocks the seal too, UNLESS the run is made with `--attest` AND the final acceptance record exists,
 *               because the workbook's own mechanism for an Owner attestation is that record. A machine that
 *               silently passes what it cannot check would be worse than one that refuses.
 *
 * READ-ONLY, except that `--hosted` queries the GitHub API through `gh`, which needs no token of its own beyond the
 * caller's.
 *
 * USAGE
 *
 *   node scripts/city-final-acceptance.cjs                            report the checklist
 *   node scripts/city-final-acceptance.cjs --json                     the report as JSON
 *   node scripts/city-final-acceptance.cjs --seal --main-sha=<sha>    gate the seal (blocks on OPEN/UNVERIFIED)
 *   node scripts/city-final-acceptance.cjs --seal --main-sha=<sha> --hosted --attest
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const FINAL_RECORD = "docs/city/FINAL_ACCEPTANCE_RECORD.md";
const LEDGER = "docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md";
const DEBT_REGISTER = "docs/city/CITY_RENOVATION_DEBT_REGISTER.md";
const CI = ".github/workflows/ci.yml";
const FINAL_STATUS = "FINAL_STATUS = CAPABILITY_CITY_CONSTRUCTION_COMPLETE";

const PASS = "PASS";
const OPEN = "OPEN";
const UNVERIFIED = "UNVERIFIED";

function exists(rel, root = ROOT) {
  return fs.existsSync(path.join(root, rel));
}

function readText(rel, root = ROOT) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** Run a repository program with `--json` and parse it. Cached, because several items share an instrument. */
function runJson(rel, root = ROOT, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel);
  const run = spawnSync(process.execPath, [path.join(root, rel), "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  let json = null;
  if (run.status === 0) {
    try {
      json = JSON.parse(run.stdout ?? "");
    } catch {
      json = null;
    }
  }
  const entry = { exitCode: run.status, json };
  cache.set(rel, entry);
  return entry;
}

/** Run a repository program with explicit arguments and return its exit code. */
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

function verdict(status, evidence) {
  return { status, evidence };
}

/**
 * The checklist of docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 33. Every item carries a verifier; nothing is asserted twice, and every number is resolved
 * from the artifact that owns it rather than typed here.
 */
function checklist(root = ROOT, options = {}, cache = new Map()) {
  const ci = exists(CI, root) ? readText(CI, root) : "";
  const ledger = exists(LEDGER, root) ? readText(LEDGER, root) : "";
  const hosted = options.hosted === true;
  const mainSha = typeof options.mainSha === "string" ? options.mainSha : null;
  const items = [];
  const add = (section, id, text, result) => items.push({ section, id, text, ...result });

  // ---- GOVERNANCE ------------------------------------------------------------------------------------
  add("GOVERNANCE", "G1", "architecture hosted job exists",
    /^ {2}architecture:$/m.test(ci) ? verdict(PASS, `${CI} declares a job named "architecture"`) : verdict(OPEN, `${CI} has no job named "architecture"`));

  const ruleset = hosted ? gh(["api", "repos/{owner}/{repo}/rulesets"]) : null;
  const mainRuleset = Array.isArray(ruleset) ? ruleset.find((entry) => entry?.name === "Main-Protection") ?? ruleset[0] : null;
  const rulesetDetail = mainRuleset && typeof mainRuleset.id === "number" ? gh(["api", `repos/{owner}/{repo}/rulesets/${mainRuleset.id}`]) : null;
  const contexts = rulesetDetail?.rules?.flatMap((rule) => rule?.parameters?.required_status_checks ?? []).map((check) => check?.context) ?? [];
  add("GOVERNANCE", "G2", "architecture is a required status check",
    hosted
      ? (contexts.includes("architecture") ? verdict(PASS, `the live ruleset requires ${contexts.length} contexts including "architecture"`) : verdict(OPEN, `the live ruleset requires ${JSON.stringify(contexts)}, which does not include "architecture"`))
      : verdict(UNVERIFIED, "the live ruleset is not readable from the tree; run with --hosted"));

  add("GOVERNANCE", "G3", "strict required checks remain active",
    hosted
      ? (rulesetDetail?.parameters?.strict_required_status_checks_policy === true ? verdict(PASS, "strict_required_status_checks_policy is true") : verdict(OPEN, `strict_required_status_checks_policy is ${JSON.stringify(rulesetDetail?.parameters?.strict_required_status_checks_policy)}`))
      : verdict(UNVERIFIED, "the live ruleset is not readable from the tree; run with --hosted"));

  const negativeControl = exists("docs/city/S2_HOSTED_NEGATIVE_CONTROL_RECORD.md", root) && exists("tests/unit/city/architecture-hosted-shadow.test.ts", root);
  add("GOVERNANCE", "G4", "negative control has proved fail-closed behaviour",
    negativeControl ? verdict(PASS, "docs/city/S2_HOSTED_NEGATIVE_CONTROL_RECORD.md and the shadow tests that pin it exist") : verdict(OPEN, "the negative-control record or the tests that pin it are missing"));

  const parity = exists("docs/city/S2_EXIT_CERTIFICATION.md", root) && exists("tests/unit/city/architecture-s2-hosted-enforce.test.ts", root);
  add("GOVERNANCE", "G5", "local/hosted parity is proved",
    parity ? verdict(PASS, "docs/city/S2_EXIT_CERTIFICATION.md and the parity tests that pin it exist") : verdict(OPEN, "the parity record or the tests that pin it are missing"));

  // The bless program has no --json mode: it REPORTS and its exit code is the verdict, so this resolves --check
  // directly rather than reading a report shape it never had. The first version read a null report and reported a
  // matching epoch as OPEN, which is the failure mode a checklist has to avoid most: a false alarm teaches a reader
  // to ignore the list.
  const blessCheck = runExit("scripts/acceptance-evolution-bless.cjs", root, cache, ["--check"]);
  add("GOVERNANCE", "G6", "Root Trust anchors the final live surface",
    blessCheck === 0 ? verdict(PASS, "acceptance-evolution-bless.cjs --check exits 0: the committed epoch MATCHES the live surface") : verdict(OPEN, `acceptance-evolution-bless.cjs --check exits ${blessCheck}: the committed epoch does not match the live Root Trust surface`));

  add("GOVERNANCE", "G7", "trust-finalization dispatch is immutable-SHA bound",
    exists("tests/unit/city/trust-finalization-sha-binding.test.ts", root) ? verdict(PASS, "tests/unit/city/trust-finalization-sha-binding.test.ts exists") : verdict(OPEN, "the SHA-binding test is missing"));

  const incidents = exists("docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md", root) && exists("docs/city/incidents/2026-09-24-repeated-spurious-epoch-dispatch.md", root);
  add("GOVERNANCE", "G8", "spurious dispatch incident is recorded",
    incidents ? verdict(PASS, "both spurious-dispatch incident records exist") : verdict(OPEN, "an incident record is missing"));

  add("GOVERNANCE", "G9", "legacy-ratchet S4 decision is recorded",
    exists("docs/city/PHASE1B_S4_LEGACY_RATCHET_DECISION.md", root) ? verdict(PASS, "docs/city/PHASE1B_S4_LEGACY_RATCHET_DECISION.md exists (ledger CC-012)") : verdict(OPEN, "the S4 decision record is missing"));

  // ---- STRUCTURE -------------------------------------------------------------------------------------
  const closure = runJson("scripts/capability-closure-validator.cjs", root, cache);
  add("STRUCTURE", "S1", "capability ownership/manifest map is truthful",
    closure.exitCode === 0 ? verdict(PASS, "capability-closure-validator.cjs VERDICT=PASS") : verdict(OPEN, "the closure validator fails"));

  const p2b = runJson("scripts/p2b-kernel-feature-ratchet.cjs", root, cache);
  const measured = p2b.json?.measured ?? {};
  const kf = measured.kernelToFeatureFileEdges ?? null;
  add("STRUCTURE", "S2", "foundation -> building implementation edges = 0",
    kf === 0 ? verdict(PASS, "kernel -> feature file edges = 0") : verdict(OPEN, `kernel -> feature file edges = ${kf} (target 0)`));

  const mutual = measured.mutualCapabilityPairs ?? null;
  add("STRUCTURE", "S3", "capability dependency cycles = 0",
    mutual === 0 ? verdict(PASS, "mutual capability pairs = 0") : verdict(OPEN, `mutual capability pairs = ${mutual} (target 0)`));

  const largest = measured.largestSccSize ?? null;
  add("STRUCTURE", "S4", "uncontrolled lateral bearing dependencies = 0",
    typeof largest === "number" && largest <= 1 ? verdict(PASS, `largest strongly connected component = ${largest}`) : verdict(OPEN, `largest strongly connected component = ${largest} of ${measured.capabilityNodes} nodes (target <= 1)`));

  const p2d = runJson("scripts/phase2-private-state.cjs", root, cache);
  const accesses = p2d.json?.report?.confirmedAccesses ?? null;
  add("STRUCTURE", "S5", "cross-domain private-state access = 0",
    accesses === 0 ? verdict(PASS, "confirmed cross-domain private-state accesses = 0") : verdict(OPEN, `confirmed cross-domain private-state accesses = ${accesses} (target 0)`));

  const multiWriter = p2d.json?.report?.multiWriterCandidates?.length ?? null;
  add("STRUCTURE", "S6", "uncontrolled multi-writer durable stores = 0",
    multiWriter === 0 ? verdict(PASS, "no namespace is touched by more than one non-owner capability") : verdict(OPEN, `${multiWriter} namespace(s) touched by more than one non-owner capability: ${(p2d.json?.report?.multiWriterCandidates ?? []).map((entry) => entry.namespace).join(", ")} -- the validator does not decide read from write, so this is the measured list`));

  const roads = runJson("scripts/capability-roads-validator.cjs", root, cache);
  const undispositioned = roads.json?.undispositioned ?? null;
  add("STRUCTURE", "S7", "shared roads are explicitly classified",
    Array.isArray(undispositioned) && undispositioned.length === 0
      ? verdict(PASS, `every leaf that a kernel imports across a boundary is declared a road or refused as one (${roads.json?.effect?.roads ?? 0} declared, ${roads.json?.refutations?.length ?? 0} refused)`)
      : verdict(OPEN, `${(undispositioned ?? []).length} kernel-imported leaf candidate(s) are neither declared nor refused: ${(undispositioned ?? []).slice(0, 5).map((entry) => entry.file).join(", ")}`));

  const flatness = runJson("scripts/city-flatness-validator.cjs", root, cache);
  add("STRUCTURE", "S8", "every plot has a valid flatness state",
    flatness.exitCode === 0 ? verdict(PASS, "city-flatness-validator.cjs VERDICT=PASS") : verdict(OPEN, "the flatness validator fails"));

  const counts = flatness.json?.counts ?? {};
  add("STRUCTURE", "S9", "no unsafe gap remains",
    (counts.UNSAFE_GAP ?? 0) === 0 ? verdict(PASS, "0 plots in UNSAFE_GAP") : verdict(OPEN, `${counts.UNSAFE_GAP} plot(s) in UNSAFE_GAP`));
  add("STRUCTURE", "S10", "no migration-in-progress remains",
    (counts.MIGRATION_IN_PROGRESS ?? 0) === 0 ? verdict(PASS, "0 plots in MIGRATION_IN_PROGRESS") : verdict(OPEN, `${counts.MIGRATION_IN_PROGRESS} plot(s) in MIGRATION_IN_PROGRESS`));

  const bridge = runJson("scripts/bridge-expiry-validator.cjs", root, cache);
  const expired = (bridge.json?.bridges ?? []).filter((entry) => entry.expired === true).length;
  add("STRUCTURE", "S11", "no expired temporary bridge remains",
    bridge.exitCode === 0 && expired === 0
      ? verdict(PASS, `no bridge is past its deadline; ${bridge.json?.sealGate?.liveBridges ?? 0} live bridge(s) are enforced by the seal gate`)
      : verdict(OPEN, expired > 0 ? `${expired} bridge(s) are EXPIRED` : "the bridge expiry validator fails"));

  // S12 used to pass on the EXISTENCE of an artifact, which is the weakest predicate a checklist can carry: a file
  // named city-replacement-lifecycle.json would have satisfied it. The mechanism docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 21 asks for now exists, so this resolves the protocol's own validator AND requires an
  // instance that has actually reached RETIRED.
  const lifecycle = runJson("scripts/replacement-lifecycle-validator.cjs", root, cache);
  const retired = lifecycle.json?.retiredInstances ?? 0;
  add("STRUCTURE", "S12", "reusable replacement lifecycle exists and has one real proof",
    lifecycle.exitCode === 0 && retired > 0
      ? verdict(PASS, `the lifecycle protocol holds and ${retired} instance(s) have reached RETIRED with evidence at every state`)
      : verdict(OPEN, `the lifecycle protocol ${lifecycle.exitCode === 0 ? "HOLDS" : "fails"} but ${retired} instance(s) have reached RETIRED: stage P2-G's mechanism now exists, and section 21's proof is one real bounded migration -- until one is retired, the protocol is machinery without a demonstration`));

  const core = runJson("scripts/core-budget-validator.cjs", root, cache);
  add("STRUCTURE", "S13", "Core budget is enforced and final Core does not exceed the permitted budget",
    core.exitCode === 0 ? verdict(PASS, `core-budget-validator.cjs VERDICT=HOLDS; unexcused growth ${core.json?.decision?.measured?.unexcusedGrowth}`) : verdict(OPEN, "the Core budget validator fails"));

  const principles = runJson("scripts/principle-enforcement-validator.cjs", root, cache);
  const matrixCounts = principles.json?.counts ?? {};
  const matrixReady = (matrixCounts.NOT_GUARDED ?? 1) === 0 && (matrixCounts.MACHINE_RATCHET ?? 1) === 0;
  add("STRUCTURE", "S14", "principles 15.1-15.9 have enforceable guards / evidence requirements",
    matrixReady
      ? verdict(PASS, `no principle is unguarded or waiting on a ratchet: ${JSON.stringify(matrixCounts)}`)
      : verdict(OPEN, `the enforcement matrix still reports ${matrixCounts.NOT_GUARDED ?? "?"} unguarded and ${matrixCounts.MACHINE_RATCHET ?? "?"} ratcheted principle(s): ${(principles.json?.rows ?? []).filter((row) => row.strength === "NOT_GUARDED" || row.strength === "MACHINE_RATCHET").map((row) => row.id).join(", ")}`));

  // ---- EVIDENCE / DEBT -------------------------------------------------------------------------------
  const entryIds = (ledger.match(/ENTRY_ID {20}CC-\d+/g) ?? []).length;
  const reviewAnchors = (ledger.match(/CC-\d+/g) ?? []).length;
  add("EVIDENCE", "E1", "all compromises are in the cloud ledger",
    entryIds > 0 ? verdict(UNVERIFIED, `the ledger carries ${entryIds} entry id(s) and ${reviewAnchors} ledger reference(s); COMPLETENESS cannot be proven from the tree, so it is attested in ${FINAL_RECORD}`) : verdict(OPEN, "the construction ledger has no entries"));

  const debtText = exists(DEBT_REGISTER, root) ? readText(DEBT_REGISTER, root) : "";
  const debtIds = [...new Set((debtText.match(/CITY-DEBT-\d+/g) ?? []))];
  const perEntry = (debtText.match(/^status\s+(OPEN|CONTAINED|CLOSED|ACCEPTED_PERMANENT)\s*$/gm) ?? []);
  const unsettled = perEntry.filter((line) => /OPEN|CONTAINED/.test(line));
  // WHICH debt is open, not merely HOW MANY. Every other OPEN item in this checklist names its member -- the road
  // items name files, the matrix item names principle ids -- because an item a reader cannot act on is a red without
  // a next step. This one reported "1 debt entr(ies) are still OPEN" until ledger CC-051, which says there is a
  // problem and nothing about which. The pairing is id-first-then-status, and the first occurrence of an id is its
  // entry block rather than the summary table at the foot of the register.
  const openDebtIds = [];
  for (const match of debtText.matchAll(/CITY-DEBT-(\d+)[\s\S]*?status\s+(OPEN|CONTAINED|CLOSED|ACCEPTED_PERMANENT)/g)) {
    const id = `CITY-DEBT-${match[1]}`;
    if (openDebtIds.some((entry) => entry.id === id)) continue;
    openDebtIds.push({ id, status: match[2] });
  }
  const unsettledIds = openDebtIds.filter((entry) => entry.status === "OPEN" || entry.status === "CONTAINED");
  const debtReady = debtIds.length > 0 && unsettled.length === 0;
  add("EVIDENCE", "E2", "all live renovation debt is CLOSED or ACCEPTED_PERMANENT",
    debtReady ? verdict(PASS, `${debtIds.length} debt id(s), all settled: ${perEntry.map((line) => line.split(/\s+/)[1]).join(", ")}`) : verdict(OPEN, unsettledIds.length > 0 ? `${unsettledIds.length} debt entr(ies) are still ${unsettledIds.map((entry) => `${entry.status}`).join(", ")}: ${unsettledIds.map((entry) => entry.id).join(", ")}` : `${unsettled.length} debt entr(ies) are still ${unsettled.map((line) => line.split(/\s+/)[1]).join(", ")}`));

  add("EVIDENCE", "E3", "paper-useful findings are in PAPER_EVIDENCE_LEDGER",
    exists("docs/research/PAPER_EVIDENCE_LEDGER.md", root) ? verdict(PASS, "docs/research/PAPER_EVIDENCE_LEDGER.md exists") : verdict(OPEN, "the paper evidence ledger is missing"));

  const historyPresent = incidents && entryIds > 0;
  add("EVIDENCE", "E4", "no historical failure was erased",
    historyPresent ? verdict(UNVERIFIED, `the incident records and ${entryIds} ledger entries are present; ERASURE cannot be disproved from a working tree, and the check that can disprove it is the git history, which is attested in ${FINAL_RECORD}`) : verdict(OPEN, "a required historical record is missing"));

  add("EVIDENCE", "E5", "final acceptance record exists",
    exists(FINAL_RECORD, root) ? verdict(PASS, `${FINAL_RECORD} exists`) : verdict(OPEN, `${FINAL_RECORD} does not exist`));

  // ---- FINAL MAIN ------------------------------------------------------------------------------------
  add("FINAL_MAIN", "F1", "one final main SHA is named",
    mainSha ? verdict(PASS, `--main-sha=${mainSha}`) : verdict(UNVERIFIED, "no --main-sha was given, so no single SHA is named by this run"));

  const hostedChecks = hosted && mainSha ? gh(["api", `repos/{owner}/{repo}/commits/${mainSha}/check-runs`]) : null;
  const names = ["quality", "unit", "acceptance", "package", "architecture"];
  const observed = Array.isArray(hostedChecks?.check_runs) ? hostedChecks.check_runs.filter((run) => names.includes(run.name)) : [];
  const greenNames = names.filter((name) => observed.some((run) => run.name === name && run.conclusion === "success" && run.status === "completed"));
  add("FINAL_MAIN", "F2", "all five hosted checks green on that SHA",
    mainSha && hosted
      ? (greenNames.length === 5 ? verdict(PASS, `quality, unit, acceptance, package and architecture are all completed/success on ${mainSha}`) : verdict(OPEN, `${greenNames.length} of 5 green on ${mainSha}: ${JSON.stringify(observed.map((run) => `${run.name}=${run.conclusion}`))}`))
      : verdict(UNVERIFIED, "the hosted checks are not readable without --hosted and --main-sha, and section 30 says no final result may depend solely on a local run"));

  const allInstrumentsPass = [closure, p2b, p2d, flatness, bridge, core, principles, roads].every((run) => run.exitCode === 0);
  add("FINAL_MAIN", "F3", "city-specific acceptance is green",
    allInstrumentsPass ? verdict(PASS, "every city validator exits zero on this tree") : verdict(OPEN, "at least one city validator fails on this tree"));

  const head = (spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout ?? "").trim();
  add("FINAL_MAIN", "F4", "Root Trust --check MATCHES on that SHA",
    mainSha ? (head === mainSha && blessCheck === 0 ? verdict(PASS, `HEAD is ${mainSha} and the epoch MATCHES`) : verdict(OPEN, `HEAD is ${head}, the named SHA is ${mainSha}, bless exit ${blessCheck}`)) : verdict(UNVERIFIED, "no --main-sha was given"));

  const porcelain = (spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout ?? "").trim();
  add("FINAL_MAIN", "F5", "working tree clean",
    porcelain.length === 0 ? verdict(PASS, "git status --porcelain is empty") : verdict(OPEN, `the tree is dirty: ${porcelain.split("\n").slice(0, 5).join("; ")}`));

  add("FINAL_MAIN", "F6", "no hidden local-only patch",
    porcelain.length === 0 && (!mainSha || head === mainSha)
      ? verdict(PASS, `the working tree is clean and ${mainSha ? `HEAD is the named SHA ${mainSha}` : "no --main-sha was given, so identity with the named SHA is attested"}`)
      : verdict(OPEN, `local-only state: dirty tree ${porcelain.length > 0}, HEAD ${head}${mainSha ? ` against named ${mainSha}` : ""}`));

  return items;
}

function summarise(items) {
  const counts = { PASS: 0, OPEN: 0, UNVERIFIED: 0 };
  for (const item of items) counts[item.status] += 1;
  const open = items.filter((item) => item.status === OPEN);
  const unverified = items.filter((item) => item.status === UNVERIFIED);
  return { counts, open, unverified };
}

/**
 * The seal decision, pure and exported so it can be falsified.
 *
 * An OPEN item always blocks: the machine knows the condition is unmet. An UNVERIFIED item blocks UNLESS the run is
 * made with `--attest` AND the final acceptance record exists, because the workbook's own vehicle for an Owner
 * attestation is that record -- so `--attest` without the record grants nothing, which is the case worth having in
 * the test suite rather than in the documentation.
 */
function decideSeal(items, options = {}) {
  const { counts, open, unverified } = summarise(items);
  const attested = options.attest === true && options.recordExists === true;
  const ready = counts.OPEN === 0 && (counts.UNVERIFIED === 0 || attested);
  const blocking = counts.OPEN + (attested ? 0 : counts.UNVERIFIED);
  return { counts, open, unverified, attested, ready, blocking };
}

const SECTION_ORDER = ["GOVERNANCE", "STRUCTURE", "EVIDENCE", "FINAL_MAIN"];

function render(report) {
  const lines = [];
  for (const section of SECTION_ORDER) {
    const items = report.items.filter((item) => item.section === section);
    if (items.length === 0) continue;
    const passed = items.filter((item) => item.status === PASS).length;
    lines.push(`[acceptance] ${section}: ${passed}/${items.length} verified`);
    for (const item of items) {
      lines.push(`[acceptance]   ${item.status.padEnd(10)} ${item.id}  ${item.text}`);
      if (item.status !== PASS) lines.push(`[acceptance]              -> ${item.evidence}`);
    }
  }
  lines.push(`[acceptance] ${report.counts.PASS} PASS, ${report.counts.OPEN} OPEN, ${report.counts.UNVERIFIED} UNVERIFIED`);
  if (report.ready) {
    lines.push(`[acceptance] VERDICT=READY (${FINAL_STATUS} is permitted)`);
  } else {
    const blocking = report.counts.OPEN + (report.attested ? 0 : report.counts.UNVERIFIED);
    lines.push(`[acceptance] VERDICT=NOT_READY (${blocking} blocking item(s)${report.attested ? `; ${report.counts.UNVERIFIED} unverifiable item(s) ATTESTED` : ""})`);
  }
  return lines.join("\n");
}

function main(argv, root = ROOT) {
  const options = {
    hosted: argv.includes("--hosted"),
    attest: argv.includes("--attest"),
    mainSha: (argv.find((argument) => argument.startsWith("--main-sha=")) ?? "").split("=")[1] ?? null,
  };
  const items = checklist(root, options);
  const decision = decideSeal(items, { attest: options.attest, recordExists: exists(FINAL_RECORD, root) });
  const report = {
    schema: "city-final-acceptance/1",
    items,
    counts: decision.counts,
    ready: decision.ready,
    attested: decision.attested,
    blocking: decision.blocking,
    open: decision.open.map((item) => item.id),
    unverified: decision.unverified.map((item) => item.id),
  };

  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report)}\n`);

  // Reporting mode always exits 0: the checklist is information until a seal is attempted. `--seal` is the gate.
  if (argv.includes("--seal") && !decision.ready) return 1;
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`city-final-acceptance failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, checklist, render, summarise, decideSeal, gh, FINAL_RECORD, FINAL_STATUS, SECTION_ORDER, STATUSES: { PASS, OPEN, UNVERIFIED } };
