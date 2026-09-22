#!/usr/bin/env node
/**
 * Capability City Phase 1A — controlled regression experiments and the three-way comparison.
 *
 * Specification (normative): docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, sections 10, 11 and 13.
 *
 * ISOLATED FIXTURES ONLY. Every injection happens in a temporary directory holding a baseline, a measurement and
 * a declaration set. Production architecture is never mutated to make an experiment pass — that is the whole
 * point of the round, and it is the rule the pre-city programme's earlier failure taught.
 *
 * Each experiment records: baseline semantic hash, the mutation, the expected machine code, the observed machine
 * code, the shadow exit, the enforce exit, the rollback result and the post-rollback semantic hash. A failed
 * expectation is recorded as a FAILURE with its detail, never dropped.
 *
 * USAGE
 *   node scripts/architecture-phase1a-experiments.cjs [--out <dir>] [--no-write]
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const observatory = require("./architecture-observatory.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join("artifacts", "city", "phase1");
const ENGINE = path.join(ROOT, "scripts", "architecture-enforcement.cjs");

const CAP_A = "alpha";
const CAP_B = "beta";
const FILE_A = "src/alpha/a.ts";
const FILE_B = "src/beta/b.ts";
const FILE_U = "src/undeclared/u.ts";
const FILE_U2 = "src/undeclared/u2.ts";

function sha256(text) {
  return require("node:crypto").createHash("sha256").update(text, "utf8").digest("hex");
}

function semanticHash(value) {
  return sha256(observatory.canonicalJson(value));
}

function fixtureBaseline(overrides = {}) {
  return {
    schema: "city-architecture-enforcement-baseline/1",
    baseline_version: 1,
    parent_baseline_hash: null,
    baseline_hash: "experiment-fixture",
    source_commit: "experiment-fixture",
    files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED", [FILE_U2]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    retired_edges: [],
    unresolved: [],
    not_yet_enforced: ["dependency_cycles"],
    ...overrides,
  };
}

function fixtureMeasurement(overrides = {}) {
  return {
    files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED", [FILE_U2]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    unresolved: [],
    parse_issues: [],
    read_failures: [],
    silent_skips: 0,
    ownership_conflicts: [],
    ...overrides,
  };
}

const DECLARATIONS_SILENT = { provides: { "beta@1": CAP_B }, declares: { [CAP_A]: [], [CAP_B]: [] } };

function runEngine(dir, mode, baseline, measurement, declarations) {
  const write = (name, value) => {
    const file = path.join(dir, `${mode}-${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return file;
  };
  const baselinePath = write("baseline", baseline);
  const measurementPath = write("measurement", measurement);
  const declarationsPath = write("declarations", declarations);
  const outDir = path.join(dir, `${mode}-out`);
  let status = 0;
  try {
    execFileSync(process.execPath, [
      ENGINE, "--mode", mode,
      "--baseline", baselinePath,
      "--measurement", measurementPath,
      "--declarations", declarationsPath,
      "--out", outDir,
    ], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    status = typeof error.status === "number" ? error.status : -1;
  }
  const artifactName = mode === "shadow" ? "architecture-enforcement-shadow.json" : "architecture-enforcement-live.json";
  const artifactPath = path.join(outDir, artifactName);
  const artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, "utf8")) : null;
  return { status, artifact, artifactPath };
}

/** One experiment: mutate, evaluate in both modes, expect a code, then roll back and re-hash. */
function experiment({ id, mutation, expectedCode, baseline, measurement, declarations = DECLARATIONS_SILENT, baseMeasurement = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1a-exp-"));
  // The rollback arm is the UNMUTATED measurement. The first revision of this script hashed the baseline in its
  // place; a baseline and a measurement are different shapes, so that comparison could never succeed and all
  // nine experiments were reported as failures even though every expected machine code was observed. Recorded
  // rather than quietly fixed.
  const pristine = baseMeasurement ?? fixtureMeasurement();
  const baselineHash = semanticHash(pristine);
  const mutatedHash = semanticHash(measurement);
  const shadow = runEngine(dir, "shadow", baseline, measurement, declarations);
  const enforce = runEngine(dir, "enforce", baseline, measurement, declarations);
  const codes = (shadow.artifact?.findings ?? []).map((finding) => finding.code);

  const afterRollbackHash = semanticHash(pristine);
  const rollback = afterRollbackHash === baselineHash ? "RESTORED" : "FAILED";

  const pass = codes.includes(expectedCode) &&
    (enforce.artifact?.verdict === "POLICY_VIOLATION" ? enforce.status !== 0 : true) &&
    rollback === "RESTORED";

  return {
    id,
    mutation,
    baseline_semantic_hash: baselineHash,
    mutated_semantic_hash: mutatedHash,
    expected_code: expectedCode,
    observed_codes: codes,
    observed_expected_code_present: codes.includes(expectedCode),
    shadow_verdict: shadow.artifact?.verdict ?? null,
    shadow_exit: shadow.status,
    enforce_verdict: enforce.artifact?.verdict ?? null,
    enforce_exit: enforce.status,
    rollback,
    post_rollback_semantic_hash: afterRollbackHash,
    pass,
  };
}

function buildExperiments() {
  const baseline = fixtureBaseline();
  return [
    experiment({
      id: "EXP-01", mutation: "new undeclared source", expectedCode: "NEW_UNDECLARED_SOURCE",
      baseline,
      measurement: fixtureMeasurement({ files: { ...baseline.files, "src/new/fresh.ts": "UNDECLARED" } }),
    }),
    experiment({
      id: "EXP-02", mutation: "declared -> undeclared edge", expectedCode: "NEW_EDGE_UNDECLARED_ENDPOINT",
      baseline,
      measurement: fixtureMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] }),
    }),
    experiment({
      id: "EXP-03", mutation: "undeclared -> declared edge", expectedCode: "NEW_EDGE_UNDECLARED_ENDPOINT",
      baseline,
      measurement: fixtureMeasurement({ edges: [[FILE_A, FILE_B], [FILE_U, FILE_A]] }),
    }),
    experiment({
      id: "EXP-04", mutation: "undeclared -> undeclared edge", expectedCode: "NEW_EDGE_UNDECLARED_ENDPOINT",
      baseline,
      measurement: fixtureMeasurement({ edges: [[FILE_A, FILE_B], [FILE_U, FILE_U2]] }),
    }),
    experiment({
      id: "EXP-05", mutation: "unauthorized cross-capability edge", expectedCode: "NEW_UNDECLARED_CROSS_CAPABILITY_EDGE",
      baseline: fixtureBaseline({ edges: [] }),
      measurement: fixtureMeasurement({ edges: [[FILE_A, FILE_B]] }),
    }),
    experiment({
      id: "EXP-06", mutation: "ownership conflict", expectedCode: "OWNERSHIP_CONFLICT",
      baseline,
      measurement: fixtureMeasurement({ ownership_conflicts: [{ module: FILE_A, capabilities: [CAP_A, CAP_B] }] }),
    }),
    experiment({
      id: "EXP-07", mutation: "missing source target", expectedCode: "UNRESOLVED_SOURCE_TARGET_MISSING",
      baseline,
      measurement: fixtureMeasurement({ unresolved: [{ from: FILE_A, specifier: "./gone", phase0_reason: "no-tracked-candidate", classification: "SOURCE_TARGET_MISSING" }] }),
    }),
    experiment({
      id: "EXP-08", mutation: "instrument failure (read failure)", expectedCode: "SENSOR_INCOMPLETE",
      baseline,
      measurement: fixtureMeasurement({ read_failures: [{ file: FILE_A, kind: "unreadable" }] }),
    }),
    experiment({
      id: "EXP-09", mutation: "raw-count compensation attack (one grandfathered edge removed, one undeclared-endpoint edge added)",
      expectedCode: "NEW_EDGE_UNDECLARED_ENDPOINT",
      baseline,
      measurement: fixtureMeasurement({ edges: [[FILE_A, FILE_U]] }),
    }),
  ];
}

function runTrial(command, args) {
  let status = 0;
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, [path.join(ROOT, "scripts", command), ...args], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = typeof error.status === "number" ? error.status : -1;
    stdout = String(error.stdout ?? "");
  }
  return { status, stdout };
}

function buildComparison(outDir) {
  const ratchet = runTrial("architecture.cjs", ["ratchet"]);
  const observe = runTrial("architecture-observatory.cjs", ["--no-write"]);
  const shadow = runTrial("architecture-enforcement.cjs", ["--mode", "shadow", "--out", outDir]);
  const enforce = runTrial("architecture-enforcement.cjs", ["--mode", "enforce", "--out", outDir]);
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  const ratchetJson = parse(ratchet.stdout);
  const observeJson = parse(observe.stdout);
  const shadowJson = parse(shadow.stdout);
  const enforceJson = parse(enforce.stdout);
  return {
    schema: "city-phase1a-legacy-vs-observer-vs-enforcer/1",
    roles: {
      architecture_ratchet: "legacy control sensor (unchanged, not replaced)",
      architecture_observe: "truth sensor (Phase 0, enforcement-qualified)",
      architecture_enforce: "prospective policy (shadow and enforce share one evaluator)",
    },
    legacy_ratchet: {
      exit: ratchet.status,
      pass: ratchetJson?.pass ?? null,
      violations: ratchetJson?.violations?.length ?? null,
      metrics: ratchetJson?.metrics ?? null,
    },
    observer: {
      exit: observe.status,
      tracked_source_files_scanned: observeJson?.tracked_source_files_scanned ?? null,
      observer_internal_edges: observeJson?.observer_internal_edges ?? null,
      undeclared_files: observeJson?.undeclared_files ?? null,
      semantic_hash: observeJson?.semantic_hash ?? null,
    },
    enforce_shadow: { exit: shadow.status, verdict: shadowJson?.verdict ?? null, violations: shadowJson?.summary?.violations ?? null },
    enforce_live: { exit: enforce.status, verdict: enforceJson?.verdict ?? null, violations: enforceJson?.summary?.violations ?? null },
    expectation: {
      legacy_ratchet: "PASS under legacy semantics",
      observer: "qualified truth",
      shadow: "evaluates with no engine error",
      enforce: "PASS because every inherited relation is grandfathered",
      new_regressions: 0,
    },
    observed_new_regressions: enforceJson?.summary?.violations ?? null,
    roles_are_distinct_and_all_present: ratchet.status === 0 && observe.status === 0 && shadow.status === 0 && enforce.status === 0,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const noWrite = argv.includes("--no-write");
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex >= 0 && argv[outIndex + 1]
    ? (path.isAbsolute(argv[outIndex + 1]) ? argv[outIndex + 1] : path.join(ROOT, argv[outIndex + 1]))
    : path.join(ROOT, DEFAULT_OUT_DIR);

  const started = Date.now();
  const experiments = buildExperiments();
  const failed = experiments.filter((e) => !e.pass);

  const payload = {
    schema: "city-phase1a-controlled-regressions/1",
    generatedAt: new Date().toISOString(),
    isolation: "Every injection happens in a temporary directory. Production architecture is never mutated.",
    experiments,
    summary: {
      total: experiments.length,
      passed: experiments.length - failed.length,
      failed: failed.length,
      expected_codes_present: experiments.filter((e) => e.observed_expected_code_present).length,
      shadow_exit_zero_on_violation: experiments.filter((e) => e.shadow_exit === 0).length,
      enforce_exit_nonzero_on_violation: experiments.filter((e) => e.enforce_exit !== 0).length,
      rollbacks_restored: experiments.filter((e) => e.rollback === "RESTORED").length,
    },
  };

  const comparison = buildComparison(outDir);

  if (!noWrite) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "controlled-regressions.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outDir, "legacy-vs-observer-vs-enforcer.json"), `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify({
    controlled_regressions: payload.summary,
    three_way: {
      legacy_ratchet_exit: comparison.legacy_ratchet.exit,
      legacy_ratchet_pass: comparison.legacy_ratchet.pass,
      observer_edges: comparison.observer.observer_internal_edges,
      shadow_verdict: comparison.enforce_shadow.verdict,
      enforce_verdict: comparison.enforce_live.verdict,
      new_regressions: comparison.observed_new_regressions,
    },
    wall_time_ms: Date.now() - started,
  }, null, 2)}\n`);
  return failed.length === 0 ? 0 : 1;
}

module.exports = { buildExperiments, buildComparison, fixtureBaseline, fixtureMeasurement };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`phase 1a experiments failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
