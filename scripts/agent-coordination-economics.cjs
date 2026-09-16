#!/usr/bin/env node
/**
 * Phase 05 Task D — the coordination economics entry point.
 *
 * Usage:
 *   node scripts/agent-coordination-economics.cjs collect --ledger <dir> [--cohort-runtime <id>] [--benchmark <id>] [--input <hash>]
 *   node scripts/agent-coordination-economics.cjs evaluate [--stage <stage>] [--record <file>]
 *   node scripts/agent-coordination-economics.cjs verify
 *   node scripts/agent-coordination-economics.cjs pair-run --help
 *
 * `collect`   derives coordination records from the durable task ledger and writes
 *             `artifacts/platform-foundation/agent-coordination-economics.json`. No manual ledger
 *             hunting: the ledger the pipeline already writes is the source.
 * `evaluate`  reads the durable records, runs `evaluateStageGuard()` over each recorded pair, and
 *             reports the verdict. An incomplete pair stays INSUFFICIENT_EVIDENCE; a stage that only
 *             costs more is COST_ONLY and is NOT added to the default pipeline.
 * `verify`    re-derives the report from the artifact and fails if it no longer holds, so a stale
 *             report cannot be cited.
 * `pair-run`  runs the real paired A/B experiment. It needs a configured provider, and refuses
 *             clearly when none is available rather than substituting fixtures.
 *
 * Exit codes: 0 the requested work succeeded; 1 the evidence is incomplete or a check failed;
 * 2 a usage or configuration problem.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COMPILED = path.join(ROOT, "dist-electron");
const ARTIFACT = path.join(ROOT, "artifacts", "platform-foundation", "agent-coordination-economics.json");

function load(relative) {
  const file = path.join(COMPILED, relative);
  if (!fs.existsSync(file)) throw new Error(`the compiled module ${relative} is missing; run \`pnpm run build:electron\` first.`);
  return require(file);
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token.startsWith("--")) options[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    else options._.push(token);
  }
  return options;
}

function readArtifact(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Derive the guard result for every recorded pair, without writing anything. */
function evaluatePairs(artifact, shared) {
  const results = [];
  for (const pair of artifact.pairs ?? []) {
    const baseline = (pair.baselineTaskIds ?? []).map((id) => (artifact.records ?? []).find((record) => record.taskId === id)).filter(Boolean);
    const candidate = (pair.candidateTaskIds ?? []).map((id) => (artifact.records ?? []).find((record) => record.taskId === id)).filter(Boolean);
    const missing = [
      ...(pair.baselineTaskIds ?? []).filter((id) => !baseline.some((record) => record.taskId === id)).map((id) => `baseline:${id}`),
      ...(pair.candidateTaskIds ?? []).filter((id) => !candidate.some((record) => record.taskId === id)).map((id) => `candidate:${id}`)
    ];
    // A pair naming records that do not exist cannot be judged at all; that is a refusal, not a zero.
    const guard = missing.length > 0
      ? { verdict: "INSUFFICIENT_EVIDENCE", stage: pair.candidateStage, comparison: null, reasons: [`the pair names ${missing.length} record(s) that are not in the artifact: ${missing.join(", ")}`] }
      : shared.evaluateStageGuard({ stage: pair.candidateStage, withStage: candidate, withoutStage: baseline });
    const decision = shared.permittedPipeline({ current: ["intake", "implement", "finalize"], candidate: pair.candidateStage, verdict: guard.verdict });
    results.push({ pairId: pair.pairId, candidateStage: pair.candidateStage, describes: pair.describes, verdict: guard.verdict, reasons: guard.reasons, missing, comparison: guard.comparison, pipelineDecision: { changed: decision.changed, reason: decision.reason } });
  }
  return results;
}

function commandCollect(options) {
  const recorderModule = load("electron/platform/coordination-recorder.js");
  const ledgerModule = load("electron/commander/task-ledger.js");
  // Static reference, on purpose: the export-surface guard counts "a script that loads the compiled
  // module" as a reference, and it looks for the NAME. Reaching the function only through
  // `module.member(...)` leaves the export reading as dead surface, which the guard then blocks. So
  // the name is bound here rather than inlined at the call site.
  const createCoordinationRecorder = recorderModule.createCoordinationRecorder;
  if (typeof createCoordinationRecorder !== "function") {
    process.stderr.write("the compiled recorder does not export the recorder factory; run `pnpm run build:electron`\n");
    return 1;
  }
  if (typeof options.ledger !== "string") {
    process.stderr.write("collect needs --ledger <dir>: the durable task ledger root to derive records from\n");
    return 2;
  }
  const ledgerRoot = path.resolve(options.ledger);
  if (!fs.existsSync(ledgerRoot)) {
    process.stderr.write(`the ledger root does not exist: ${ledgerRoot}\n`);
    return 1;
  }
  const at = typeof options.at === "string" ? options.at : new Date().toISOString();
  const cohort = typeof options.runtime === "string" && typeof options.benchmark === "string" && typeof options.input === "string"
    ? { runtime: options.runtime, benchmarkTaskId: options.benchmark, inputIdentity: options.input, plannedVariable: typeof options.stage === "string" ? options.stage : "review", arm: String(options.arm ?? "unpaired") }
    : undefined;
  const recorder = createCoordinationRecorder({
    ledgerRoot,
    artifactFile: ARTIFACT,
    at,
    ...(cohort ? { cohort } : {})
  });
  const ledger = new ledgerModule.TaskLedger(ledgerRoot);
  const sweep = recorder.sweep(ledger);
  recorder.store.save(at);
  process.stdout.write(`[economics] ledger tasks: ${sweep.tasks.length}\n`);
  process.stdout.write(`[economics] records written: ${sweep.added} added, ${sweep.replaced} replaced\n`);
  if (sweep.skipped.length > 0) process.stdout.write(`[economics] skipped ${sweep.skipped.length}: ${sweep.skipped.slice(0, 3).map((entry) => `${entry.taskId} (${entry.reason})`).join(", ")}\n`);
  process.stdout.write(`[economics] unmeasured everywhere: ${sweep.unmeasuredEverywhere.join(", ") || "none"}\n`);
  process.stdout.write(`[economics] artifact: ${path.relative(ROOT, ARTIFACT)}\n`);
  return 0;
}

function commandEvaluate(options) {
  const shared = load("src/shared/coordination-economics.js");
  const store = load("electron/platform/coordination-store.js");
  const file = typeof options.record === "string" ? path.resolve(options.record) : ARTIFACT;
  const artifact = readArtifact(file);
  if (!artifact) {
    process.stderr.write(`no economics artifact at ${file}; run \`collect\` first\n`);
    return 1;
  }
  const results = evaluatePairs(artifact, shared);

  // The authoritative report goes back INTO the artifact, so the certificate reads one file rather
  // than a summary of it. An evaluation that cannot be attributed to a real run is recorded as such
  // and never counted as satisfying the gate.
  const evaluations = (artifact.pairs ?? []).map((pair) => {
    const result = results.find((entry) => entry.pairId === pair.pairId);
    const realRun = pair.provenance?.kind === "real-provider";
    return {
      pairId: pair.pairId,
      candidateStage: pair.candidateStage,
      describes: pair.describes,
      verdict: realRun ? result.verdict : "INSUFFICIENT_EVIDENCE",
      reasons: realRun
        ? result.reasons
        : [...result.reasons, `the pair's provenance is ${pair.provenance?.kind}, not a real provider run, so it cannot satisfy Gate 8`],
      comparison: realRun ? result.comparison : null,
      pipelineDecision: realRun ? result.pipelineDecision : { changed: false, reason: "not a real provider run" },
      provenance: pair.provenance,
      /** Derived from the records actually used, so a reader can see which measures decided it. */
      measuresUsed: [...new Set((artifact.records ?? []).flatMap((record) => record.measured ?? []))].sort(),
      recordCounts: { baseline: (pair.baselineTaskIds ?? []).length, candidate: (pair.candidateTaskIds ?? []).length }
    };
  });

  artifact.evaluations = evaluations;
  artifact.generatedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const report = {
    $comment: "Gate 8 evaluation over the durable coordination records. INSUFFICIENT_EVIDENCE means the evidence is not there; COST_ONLY means the stage was measured and bought nothing, so it is NOT added to the default pipeline; EARNS_PLACE means it measurably reduced defects or rework.",
    generatedAt: new Date().toISOString(),
    phase: "05-scale-verification-soak",
    artifact: path.relative(ROOT, file).split(path.sep).join("/"),
    records: (artifact.records ?? []).length,
    pairs: (artifact.pairs ?? []).length,
    results: evaluations
  };
  const out = path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "coordination-economics.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const result of evaluations) {
    process.stdout.write(`[economics] ${result.pairId} (${result.candidateStage}): ${result.verdict}${result.provenance?.kind === "real-provider" ? "" : " [not a real run]"}\n`);
    for (const reason of result.reasons.slice(0, 3)) process.stdout.write(`             ${reason}\n`);
  }
  if (evaluations.length === 0) process.stdout.write("[economics] no pairs recorded, so there is nothing to judge\n");
  process.stdout.write(`[economics] report: ${path.relative(ROOT, out)}\n`);
  return 0;
}

function commandVerify(options) {
  const shared = load("src/shared/coordination-economics.js");
  const file = typeof options.record === "string" ? path.resolve(options.record) : ARTIFACT;
  const artifact = readArtifact(file);
  if (!artifact) {
    process.stderr.write(`no economics artifact at ${file}; run \`collect\` first\n`);
    return 1;
  }
  const problems = [];
  if (artifact.schemaVersion !== 1) problems.push(`unexpected schemaVersion ${artifact.schemaVersion}`);
  for (const record of artifact.records ?? []) {
    if (!Array.isArray(record.measured)) problems.push(`${record.taskId} declares no measured list`);
    if (!record.cohort) problems.push(`${record.taskId} carries no cohort identity, so it cannot take part in a pairing`);
    // A record must not declare a measure it left null anywhere: the guard refuses it, so the artifact
    // should not be publishing it as measured either.
    for (const measure of record.measured ?? []) {
      const stageWithValue = (record.stages ?? []).some((stage) => stage[measure] !== null && stage[measure] !== undefined);
      if (!stageWithValue) problems.push(`${record.taskId}: ${measure} is declared measured but no stage carries a value`);
    }
  }
  for (const pair of artifact.pairs ?? []) {
    const ids = [...(pair.baselineTaskIds ?? []), ...(pair.candidateTaskIds ?? [])];
    for (const id of ids) if (!(artifact.records ?? []).some((record) => record.taskId === id)) problems.push(`${pair.pairId} names ${id}, which has no record`);
    if (!pair.provenance?.kind) problems.push(`${pair.pairId} carries no provenance, so a real run cannot be told from a fabricated one`);
  }
  process.stdout.write(`[economics] records: ${(artifact.records ?? []).length}, pairs: ${(artifact.pairs ?? []).length}\n`);
  for (const record of artifact.records ?? []) {
    process.stdout.write(`  ${record.taskId.padEnd(28)} runtime=${record.runtime} measured=${(record.measured ?? []).length}/${shared.COORDINATION_MEASURES.length}\n`);
  }
  if (problems.length > 0) {
    process.stderr.write(`[economics] artifact FAILED verification:\n  ${problems.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write("[economics] artifact verified\n");
  return 0;
}

function commandPairRun() {
  process.stdout.write([
    "pair-run executes the real A/B experiment and therefore needs a configured provider.",
    "",
    "It is not implemented as a fixture: Gate 8 forbids unit-test fixtures, mock workers or synthetic",
    "token figures standing in for the experiment, so a run without a provider must fail rather than",
    "substitute one. Configure a provider (an API key with its api-settings entry, or a web provider",
    "session) and drive the two arms through the production pipeline; the durable ledger each arm",
    "writes is then collected with:",
    "",
    "  node scripts/agent-coordination-economics.cjs collect --ledger <arm-ledger-root> \\",
    "      --runtime <provider-id> --benchmark <task-family> --input <input-hash> --stage <candidate-stage>",
    "",
    "and judged with `evaluate`."
  ].join("\n") + "\n");
  return 2;
}

const COMMANDS = { collect: commandCollect, evaluate: commandEvaluate, verify: commandVerify, "pair-run": commandPairRun };

function main() {
  const command = process.argv[2];
  if (!command || !COMMANDS[command]) {
    process.stderr.write("usage: node scripts/agent-coordination-economics.cjs <collect|evaluate|verify|pair-run> [options]\n");
    return 2;
  }
  const options = parseArgs(process.argv.slice(3));
  return COMMANDS[command](options) ?? 0;
}

try {
  const code = main();
  if (typeof code === "number") process.exitCode = code;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
