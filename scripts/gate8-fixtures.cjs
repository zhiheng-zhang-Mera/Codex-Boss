#!/usr/bin/env node
/**
 * Phase 05 Task D — deterministic fixture validation of the Gate 8 infrastructure.
 *
 * ## What this is, and what it deliberately is NOT
 *
 * This builds a coordination artifact from SYNTHETIC records and requires each of the infrastructure's
 * behaviours to come out right: task-level aggregation, stage-level aggregation, cohort comparability,
 * provenance validation, and all three verdicts (EARNS_PLACE, COST_ONLY, INSUFFICIENT_EVIDENCE),
 * including that a task total is never double counted.
 *
 * It is labelled `provenance.kind: "deterministic-fixture"`, NOT `real-provider`. That is not cosmetic:
 * `scripts/agent-coordination-economics.cjs evaluate` records any pair whose provenance is not a real
 * provider run as INSUFFICIENT_EVIDENCE, and the platform certificate reports the gate as measured only
 * when a real run produced the records AND the guard reached a verdict. So these fixtures can validate
 * the machinery and can never be mistaken for the Gate 8 experiment.
 *
 * Run: node scripts/gate8-fixtures.cjs [--out <file>]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COMPILED = path.join(ROOT, "dist-electron");
const DEFAULT_OUT = path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "gate8-fixtures.json");

const ALL_MEASURES = ["modelCalls", "inputTokens", "outputTokens", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided", "diffLines", "defectsEscaped"];

function load(relative) {
  const file = path.join(COMPILED, relative);
  if (!fs.existsSync(file)) throw new Error(`the compiled module ${relative} is missing; run \`pnpm run build:electron\` first.`);
  return require(file);
}

/** A task record at the TASK grain: totals plus a declaration, and stage rows only when given. */
function task(id, pipeline, totals, options = {}) {
  const filled = {};
  for (const measure of ALL_MEASURES) filled[measure] = measure in totals ? totals[measure] : null;
  const measured = ALL_MEASURES.filter((measure) => filled[measure] !== null);
  return {
    taskId: id,
    pipeline,
    totals: filled,
    measured,
    stages: options.stages ?? [],
    stageMeasured: options.stageMeasured ?? [],
    runtime: options.runtime ?? "fixture:runtime",
    cohort: {
      runtime: options.runtime ?? "fixture:runtime",
      benchmarkTaskId: options.benchmark ?? "fixture-bench",
      inputIdentity: options.input ?? "fixture-input",
      plannedVariable: options.plannedVariable ?? "review",
      arm: options.arm ?? (pipeline.includes("review") ? "candidate" : "baseline")
    },
    at: "2026-01-01T00:00:00.000Z"
  };
}

function main() {
  const outArgIndex = process.argv.indexOf("--out");
  const out = outArgIndex >= 0 ? path.resolve(process.argv[outArgIndex + 1]) : DEFAULT_OUT;
  const shared = load("src/shared/coordination-economics.js");

  const checks = [];
  const check = (name, expected, actual) => checks.push({ name, expected, actual, ok: expected === actual });

  // ---- task-level aggregation: a five-stage record with NO stage attribution still decides --------
  const fullTotals = { modelCalls: 9, inputTokens: 6_000, wallMs: 6_000, coordinationMs: 600, executionMs: 5_400, reviewFindings: 2, reworkAvoided: 3 };
  const baseTotals = { modelCalls: 5, inputTokens: 2_000, wallMs: 2_000, coordinationMs: 200, executionMs: 1_800, reviewFindings: 0, reworkAvoided: 0 };
  const fiveStage = task("fx-five-stage-candidate", ["intake", "plan", "implement", "verify", "review", "finalize"], fullTotals);
  const fiveStageBase = task("fx-five-stage-baseline", ["intake", "plan", "implement", "verify", "finalize"], baseTotals);
  check("task-level aggregation decides on totals with no stage rows", "EARNS_PLACE",
    shared.evaluateStageGuard({ stage: "review", withStage: [fiveStage], withoutStage: [fiveStageBase] }).verdict);

  // ---- no double counting: totals are counted once even when every stage is attributed ------------
  const attributed = task("fx-attributed", ["implement", "verify"], { modelCalls: 3, inputTokens: 1_000, wallMs: 1_000 }, {
    stages: [
      { stage: "implement", modelCalls: 2, inputTokens: 600, outputTokens: null, wallMs: 600, coordinationMs: 0, executionMs: 600, reviewFindings: 0, reworkAvoided: 0, diffLines: 0, defectsEscaped: null },
      { stage: "verify", modelCalls: 1, inputTokens: 400, outputTokens: null, wallMs: 400, coordinationMs: 0, executionMs: 400, reviewFindings: 0, reworkAvoided: 0, diffLines: 0, defectsEscaped: null }
    ],
    stageMeasured: ["modelCalls", "inputTokens", "wallMs"]
  });
  check("task total is not double counted", 1_000, shared.totalRecord(attributed).inputTokens);

  // ---- stage-level aggregation uses only genuine stage provenance ---------------------------------
  const stageOnly = shared.totalStage([attributed, fiveStage], "implement");
  check("stage aggregation sums only attributed rows", 600, stageOnly.totals.inputTokens);
  check("stage aggregation reports unattributed tasks", 1, stageOnly.unattributedTasks.length);

  // ---- verdicts -----------------------------------------------------------------------------------
  const costOnlyWith = task("fx-costly-candidate", ["implement", "review"], { modelCalls: 3, inputTokens: 4_000, wallMs: 4_000, reworkAvoided: 0 });
  const costOnlyBase = task("fx-costly-baseline", ["implement"], { modelCalls: 1, inputTokens: 1_000, wallMs: 1_000, reworkAvoided: 0 });
  const costOnly = shared.evaluateStageGuard({ stage: "review", withStage: [costOnlyWith], withoutStage: [costOnlyBase] });
  check("COST_ONLY when the stage buys nothing and costs more", "COST_ONLY", costOnly.verdict);
  const costDecision = shared.permittedPipeline({ current: ["implement", "finalize"], candidate: "review", verdict: costOnly.verdict });
  check("COST_ONLY leaves the stage out of the default pipeline", false, costDecision.changed);

  const earningWith = task("fx-earning-candidate", ["implement", "review"], { modelCalls: 6, inputTokens: 3_000, wallMs: 3_000, reworkAvoided: 3 });
  const earningBase = task("fx-earning-baseline", ["implement"], { modelCalls: 3, inputTokens: 1_000, wallMs: 1_000, reworkAvoided: 0 });
  const earning = shared.evaluateStageGuard({ stage: "review", withStage: [earningWith], withoutStage: [earningBase] });
  check("EARNS_PLACE on a measured rework improvement", "EARNS_PLACE", earning.verdict);
  check("EARNS_PLACE adds the stage", true, shared.permittedPipeline({ current: ["implement", "finalize"], candidate: "review", verdict: earning.verdict }).changed);

  const incomplete = task("fx-incomplete", ["implement", "review"], { modelCalls: 3, inputTokens: 1_000, wallMs: 1_000 });
  check("INSUFFICIENT_EVIDENCE when the benefit measure was never observed", "INSUFFICIENT_EVIDENCE",
    shared.evaluateStageGuard({ stage: "review", withStage: [incomplete], withoutStage: [earningBase] }).verdict);

  // ---- cohort comparability -----------------------------------------------------------------------
  const wrongCohort = task("fx-wrong-cohort", ["implement", "review"], { modelCalls: 6, inputTokens: 3_000, wallMs: 3_000, reworkAvoided: 3 }, { benchmark: "other-bench" });
  check("refuses a pair from a different benchmark cohort", "INSUFFICIENT_EVIDENCE",
    shared.evaluateStageGuard({ stage: "review", withStage: [wrongCohort], withoutStage: [earningBase] }).verdict);
  const extraStage = task("fx-two-variables", ["implement", "verify", "review"], { modelCalls: 6, inputTokens: 3_000, wallMs: 3_000, reworkAvoided: 3 });
  check("refuses when more than the candidate stage differs", "INSUFFICIENT_EVIDENCE",
    shared.evaluateStageGuard({ stage: "review", withStage: [extraStage], withoutStage: [earningBase] }).verdict);

  // ---- provenance validation: a fixture can never be a real run ----------------------------------
  const artifact = {
    $comment: "DETERMINISTIC FIXTURES for validating the Gate 8 infrastructure. These records are synthetic: provenance.kind is 'deterministic-fixture', which the evaluator records as INSUFFICIENT_EVIDENCE precisely so this file can never be mistaken for the Gate 8 experiment.",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    records: [fiveStage, fiveStageBase, attributed, costOnlyWith, costOnlyBase, earningWith, earningBase, incomplete, wrongCohort, extraStage],
    pairs: [
      { pairId: "fx-task-grain", candidateStage: "review", describes: "task-level totals decide with no stage attribution", cohort: { runtime: "fixture:runtime", benchmarkTaskId: "fixture-bench", inputIdentity: "fixture-input", plannedVariable: "review" }, baselineTaskIds: ["fx-five-stage-baseline"], candidateTaskIds: ["fx-five-stage-candidate"], provenance: { executedAt: "2026-01-01T00:00:00.000Z", kind: "deterministic-fixture", entryPoint: "scripts/gate8-fixtures.cjs" } },
      { pairId: "fx-cost-only", candidateStage: "review", describes: "COST_ONLY", cohort: { runtime: "fixture:runtime", benchmarkTaskId: "fixture-bench", inputIdentity: "fixture-input", plannedVariable: "review" }, baselineTaskIds: ["fx-costly-baseline"], candidateTaskIds: ["fx-costly-candidate"], provenance: { executedAt: "2026-01-01T00:00:00.000Z", kind: "deterministic-fixture", entryPoint: "scripts/gate8-fixtures.cjs" } },
      { pairId: "fx-earns-place", candidateStage: "review", describes: "EARNS_PLACE", cohort: { runtime: "fixture:runtime", benchmarkTaskId: "fixture-bench", inputIdentity: "fixture-input", plannedVariable: "review" }, baselineTaskIds: ["fx-earning-baseline"], candidateTaskIds: ["fx-earning-candidate"], provenance: { executedAt: "2026-01-01T00:00:00.000Z", kind: "deterministic-fixture", entryPoint: "scripts/gate8-fixtures.cjs" } },
      { pairId: "fx-insufficient-evidence", candidateStage: "review", describes: "INSUFFICIENT_EVIDENCE", cohort: { runtime: "fixture:runtime", benchmarkTaskId: "fixture-bench", inputIdentity: "fixture-input", plannedVariable: "review" }, baselineTaskIds: ["fx-earning-baseline"], candidateTaskIds: ["fx-incomplete"], provenance: { executedAt: "2026-01-01T00:00:00.000Z", kind: "deterministic-fixture", entryPoint: "scripts/gate8-fixtures.cjs" } }
    ]
  };

  const report = {
    $comment: artifact.$comment,
    generatedAt: new Date().toISOString(),
    phase: "05-scale-verification-soak",
    purpose: "deterministic validation of the Gate 8 infrastructure; NOT a Gate 8 measurement and not usable as one",
    provenanceKind: "deterministic-fixture",
    checks,
    passed: checks.every((entry) => entry.ok),
    failed: checks.filter((entry) => !entry.ok).map((entry) => entry.name),
    artifact: path.relative(ROOT, out).split(path.sep).join("/")
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ ...report, fixtureArtifact: artifact }, null, 2)}\n`, "utf8");

  for (const entry of checks) {
    process.stdout.write(`[gate8-fixtures] ${entry.ok ? "ok  " : "FAIL"} ${entry.name} => ${entry.actual}\n`);
  }
  process.stdout.write(`[gate8-fixtures] ${checks.filter((entry) => entry.ok).length}/${checks.length} checks passed\n`);
  process.stdout.write(`[gate8-fixtures] report: ${path.relative(ROOT, out)}\n`);
  if (!report.passed) {
    process.stderr.write(`[gate8-fixtures] FAILED: ${report.failed.join(", ")}\n`);
    return 1;
  }
  process.stdout.write("[gate8-fixtures] infrastructure validated (fixtures, NOT a gate measurement)\n");
  return 0;
}

try {
  const code = main();
  if (typeof code === "number") process.exitCode = code;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
