/**
 * Gate 8 — the paired A/B provider run.
 *
 * The book's gate asks for cost/benefit evidence per agent stage: run one representative task
 * through the PRODUCTION pipeline twice, once without the candidate stage and once with it, and let
 * the guard in `src/shared/coordination-economics.ts` decide. This script is the driver for that
 * comparison. It is not a fixture and it does not synthesise anything:
 *
 *   - the task is executed by the real `MainCommander` (`electron/commander/main-commander.ts`) over
 *     the real `StateStore`, the real durable `TaskLedger` and the real `RuntimeRegistry`;
 *   - the model calls are real: the registered runtime is the production `ApiRuntime`, which reaches
 *     the provider through the production `ProviderApiClient` and `ApiSettingsStore`;
 *   - the recorded figures are the provider's own accounting, persisted by the production
 *     `ExecutionSupervisor`, and read back from the ledger by the production coordination recorder.
 *
 * ## The two arms
 *
 * The planned variable is the `verify` stage — the risk-gated verification gate
 * (`src/shared/result-validator.ts`) that a task carrying a `VerificationContract` must pass before
 * MODEL_DONE may complete it. Both arms run the SAME objective over the SAME kind of workspace with
 * the SAME provider; the contract is the only difference, so the derived pipelines differ by exactly
 * the candidate stage and the guard's comparability check can hold.
 *
 * ## Secrets
 *
 * The credential is read from an environment variable in this process and written only into the
 * encrypted store, through the same `encrypt`/`decrypt` seam the application injects `safeStorage`
 * into. Nothing prints it, nothing writes it in the clear, and no path in this file reports it.
 *
 * ## Usage
 *
 *   node scripts/gate8-pair-run.cjs --provider deepseek --env DeepSeek_API --model <modelId> \
 *       --data-root <dir> [--label <runLabel>]
 *
 * Writes nothing but ledgers, workspaces and a counts-only summary line per arm.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COMPILED = path.join(ROOT, "dist-electron");

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

/* ------------------------------------------------------------------ *
 * the representative task, and the candidate stages that may vary
 * ------------------------------------------------------------------ */

/**
 * One objective, run identically in both arms. It is a real refactor request against a real git
 * repository with a real passing test suite: the planner has to produce a plan, the coder has to
 * produce hash-bound proposals that the host applies and tests, and the mandatory verification gate
 * has something to actually verify. `needsPlanning()` is satisfied so the full production plan path is
 * taken rather than the deterministic L0 shortcut.
 */
const OBJECTIVE = "按照 tasks.md 重构项目并确保测试通过";

/**
 * The candidate stages an experiment may vary, and how each one differs between its arms.
 *
 * `verify` is deliberately ABSENT. A live paired run established that the verification gate is present
 * in every completed task — `EngineeringRuntime` writes `verificationState` on every task, contract or
 * not — so there is no legal production pipeline without it and no baseline to subtract. It is a
 * mandatory platform contract gate, not an optional Agent stage, and `evaluateStageGuard` now refuses
 * it by kind. The evidence from that run is preserved in the Phase 05 status document: its provenance
 * was real-provider and its result was INSUFFICIENT_EVIDENCE for this reason.
 *
 * Every entry here must therefore be a stage whose presence the durable execution trace can record,
 * and which a production task can legitimately be configured without.
 */
const CANDIDATE_STAGES = {
  review: {
    plannedVariable: "review",
    benchmarkTaskId: "boss-gate8-refactor",
    /**
     * The MANDATORY verification contract, carried by BOTH arms.
     *
     * It is not the variable and must never be: it is the platform gate that decides completion
     * eligibility. Both arms passing it is what makes the comparison a comparison of the review alone.
     */
    verification: { domain: "engineering", risk: "low" },
    /** The acceptance criteria both arms are judged against, given to the reviewer as context. */
    acceptance: "all four modules keep their existing behaviour and the suite in all.test.cjs passes",
    /** What the candidate arm asks for, and the baseline arm does not. */
    optionalReview: { passes: 1, acceptance: "all four modules keep their existing behaviour and the suite in all.test.cjs passes" },
    /** The provider role the optional stage is dispatched as. */
    reviewerRole: "reviewer",
    describe: (arm) => (arm === "with" ? "with the optional independent review Agent" : "without the optional independent review Agent")
  }
};

const MODULES = ["alpha.cjs", "bravo.cjs", "charlie.cjs", "delta.cjs"];
const MODULE_BODY = "module.exports=(x)=>x;\n";
const TASKS_MD = "Refactor all four modules while keeping behaviour and the existing test suite passing.\n";
const TEST_BODY = [
  "const test=require('node:test');",
  "const assert=require('node:assert/strict');",
  ...MODULES.map((file) => `test('${file}',()=>assert.equal(require('./${file}')(7),7));`),
  ""
].join("\n");

/** A real, freshly-committed git workspace with a real toolchain. */
function makeWorkspace(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `boss-gate8-${label}-`));
  const git = (...args) => require("node:child_process").execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "ignore" });
  fs.writeFileSync(path.join(directory, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(directory, "tasks.md"), TASKS_MD);
  for (const file of MODULES) fs.writeFileSync(path.join(directory, file), MODULE_BODY);
  fs.writeFileSync(path.join(directory, "all.test.cjs"), TEST_BODY);
  git("init");
  git("add", ".");
  git("-c", "user.name=Gate8", "-c", "user.email=gate8@example.invalid", "commit", "-m", "fixture");
  return directory;
}

/* ------------------------------------------------------------------ *
 * one arm
 * ------------------------------------------------------------------ */

/**
 * Run the objective once, for one arm of one candidate stage.
 *
 * The arm configuration is the ONLY difference between the two runs of an experiment: same objective,
 * same workspace shape, same provider and model, same mandatory verification. `withCandidate` decides
 * whether the optional Agent stage runs at all.
 */
async function runArm(options, withCandidate) {
  const { MainCommander } = load("electron/commander/main-commander.js");
  const { StateStore } = load("electron/store.js");
  const { RuntimeRegistry } = load("electron/commander/runtime-registry.js");
  const { BudgetManager } = load("electron/commander/budget-manager.js");
  const { RoleRouter } = load("electron/commander/role-router.js");
  const { Scheduler } = load("electron/commander/scheduler.js");
  const { ContextManager } = load("electron/commander/context-manager.js");
  const { ExecutionGate } = load("electron/commander/execution-gate.js");
  const { TaskLedger } = load("electron/commander/task-ledger.js");
  const { ApiSettingsStore } = load("electron/api-settings.js");
  const { ProviderApiClient } = load("electron/provider-api.js");
  const { ApiRuntime } = load("electron/runtimes/native-api-runtime.js");

  const armLabel = withCandidate ? `with-${options.stage}` : `without-${options.stage}`;
  const armRoot = path.join(options.dataRoot, armLabel);
  fs.mkdirSync(armRoot, { recursive: true });
  const workspace = makeWorkspace(armLabel);

  // The credential is written through the store's own seam. `encrypt` is a pass-through here
  // because this harness deliberately runs outside Electron and therefore has no `safeStorage`;
  // what matters for the measurement is that the PRODUCTION read path (`connection()` →
  // `assertReady()` → the provider's own `usage` block) is what reaches the provider.
  const settings = new ApiSettingsStore(
    path.join(armRoot, "api-settings.json"),
    (plainText) => Buffer.from(plainText, "utf8").toString("base64"),
    (cipherText) => Buffer.from(cipherText, "base64").toString("utf8")
  );
  settings.update({
    providerId: options.provider,
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: options.baseUrl,
    model: options.model,
    apiKey: options.credential
  });
  settings.assertReady(options.provider);

  const client = new ProviderApiClient(settings);
  const store = new StateStore(path.join(armRoot, "state.json"));
  const ledger = new TaskLedger(path.join(armRoot, "tasks"));
  const registry = new RuntimeRegistry();
  const runtime = new ApiRuntime(options.provider, client);
  registry.register(runtime);
  const budgets = new BudgetManager();
  const commander = new MainCommander(
    store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets,
    new ContextManager(), new ExecutionGate(), ledger
  );

  // The OPTIONAL review Agent's reviewer. Production dispatches the "reviewer" role through the same
  // role router and supervisor every other model call goes through, so the review's tokens are counted
  // exactly like any other work — which is the cost side of the comparison. Set on every arm so the
  // only difference between them is whether the stage is REQUESTED.
  const stage = CANDIDATE_STAGES[options.stage];
  if (typeof stage?.describe !== "function") {
    throw new Error(`unknown candidate stage '${options.stage}'; the harness supports: ${Object.keys(CANDIDATE_STAGES).join(", ")}`);
  }

  const task = commander.createTask({
    title: `gate8 ${armLabel}`,
    objective: OBJECTIVE,
    providerIds: [options.provider],
    appMode: "work",
    transports: { [options.provider]: "api" },
    // The MANDATORY gate, on BOTH arms: it is the platform invariant, not the variable.
    ...(stage.verification ? { verification: stage.verification } : {}),
    // The OPTIONAL Agent stage, on the candidate arm only.
    ...(withCandidate && stage.optionalReview ? { optionalReview: stage.optionalReview } : {})
  });

  if (stage.reviewerRole) {
    commander.optionalReviewer = async (prompt) => {
      const answer = await commander.dispatchRole(task.id, stage.reviewerRole, prompt);
      if (answer.status !== "SUCCESS" || !answer.content) throw new Error(answer.failure?.message ?? "reviewer unavailable");
      return answer.content;
    };
  }

  const started = Date.now();
  let status = "UNKNOWN";
  let failure = null;
  try {
    await commander.executePlan(task.id, workspace);
    const settled = store.snapshot().tasks.find((item) => item.id === task.id);
    status = settled?.status ?? "UNKNOWN";
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    status = "THREW";
  }
  const wallMs = Date.now() - started;

  const persisted = ledger.load(task.id);
  const usage = persisted?.usage ?? {};
  // Counts and identifiers only. No prompt, no reply, no credential.
  return {
    arm: armLabel,
    taskId: task.id,
    /**
     * The runtime the ledger will record, taken from the production runtime object rather than
     * spelled out here. The guard requires `record.runtime` to equal `cohort.runtime`, and the ledger
     * records `activeProvider`, which the supervisor sets to the runtime's own id (`api:<provider>`).
     * Reporting the id from the object that produced it is what makes that agreement true by
     * construction instead of by a second, hand-written string that can drift from it.
     */
    runtimeId: runtime.id,
    status,
    failure,
    wallMs,
    verification: persisted?.verificationState ?? "ABSENT",
    /** The stages the durable trace recorded, so a reader sees presence rather than a reconstruction. */
    executedStages: (persisted?.executedStages ?? []).map((entry) => `${entry.stage}:${entry.kind}`),
    reviewFindings: persisted?.reviewFindings ?? null,
    hasCandidateStage: withCandidate,
    modelCalls: usage.modelCalls ?? 0,
    providerInputTokens: usage.providerInputTokens ?? null,
    providerOutputTokens: usage.providerOutputTokens ?? null,
    estimatedInputTokens: usage.estimatedInputTokens ?? null,
    retries: usage.retries ?? 0,
    modifiedFiles: persisted?.modifiedFiles?.length ?? 0,
    failureHistory: persisted?.failureHistory?.length ?? 0,
    jobs: Object.values(persisted?.jobs ?? {}).map((job) => ({ id: job.id, state: job.state, attempts: job.attempts })),
    workspace,
    ledgerRoot: path.join(armRoot, "tasks"),
    /** The harness with `assertReady` satisfied and `usage` observed — the readiness evidence. */
    credentialFound: true
  };
}

/* ------------------------------------------------------------------ *
 * entry point
 * ------------------------------------------------------------------ */

/**
 * Rebuild the evidence artifact from two arms' ledgers.
 *
 * Separated from the run so the artifact can be regenerated from ALREADY-COLLECTED ledgers without
 * spending provider calls again. That matters because the artifact is derived evidence: if its shape
 * has to be corrected, the honest move is to re-derive it from the same ledgers rather than to re-run
 * the experiment and hope for the same numbers.
 *
 * Rebuilding rather than appending is deliberate. The artifact is the evidence a reader is asked to
 * believe, and the fixture validation (`pnpm run economics:fixtures`) writes its own records
 * elsewhere; if any of those ever end up beside the real ones, a reader could not tell which figures
 * came from a live provider. So this refuses to inherit anything and derives only from the named
 * ledgers.
 */
function buildPair(input) {
  const { openCoordinationStore } = load("electron/platform/coordination-store.js");
  const { createCoordinationRecorder } = load("electron/platform/coordination-recorder.js");
  const { TaskLedger } = load("electron/commander/task-ledger.js");
  // A run plan written by `run` carries the cohort identity directly; accept the explicitly-named
  // form too, so a hand-written plan has one obvious field to set.
  const candidateStage = input.plannedVariable ?? input.candidateStage;
  if (typeof candidateStage !== "string" || !candidateStage) throw new Error("the run plan names no candidate stage");
  const cohort = {
    runtime: input.runtime,
    benchmarkTaskId: input.benchmarkTaskId,
    inputIdentity: input.inputIdentity,
    plannedVariable: candidateStage
  };
  // The store accepts a repo root and resolves the standard artifact path itself, so the layout is
  // declared in one place rather than repeated by every caller.
  const artifactFile = openCoordinationStore(ROOT).file;
  fs.rmSync(artifactFile, { force: true });
  const store = openCoordinationStore(ROOT);
  const at = new Date().toISOString();
  const derived = [];
  for (const arm of [`without-${candidateStage}`, `with-${candidateStage}`]) {
    const armResult = input.arms[arm.startsWith("without") ? "without" : "with"];
    const recorder = createCoordinationRecorder({
      ledgerRoot: armResult.ledgerRoot,
      // The recorder persists through the same production store; the artifact is written once below.
      artifactFile,
      at,
      cohort: { ...cohort, arm }
    });
    const sweep = recorder.sweep(new TaskLedger(armResult.ledgerRoot));
    if (sweep.skipped.length > 0) {
      process.stderr.write(`gate8: ${arm} skipped ${sweep.skipped.length} ledger task(s): ${sweep.skipped.map((entry) => `${entry.taskId} (${entry.reason})`).join(", ")}\n`);
      return 1;
    }
    // Selected by task id, never by position: a ledger root that ever held more than one task must
    // not be able to shift an arm's record into the other arm.
    const record = recorder.store.load().records.find((entry) => entry.taskId === armResult.taskId);
    if (!record) {
      process.stderr.write(`gate8: no coordination record was derived for ${armResult.taskId}\n`);
      return 1;
    }
    derived.push({ arm, record });
  }
  store.putRecords(derived.map((entry) => entry.record));

  const pairId = `gate8-${candidateStage}-${input.runLabel}`;
  const pairing = store.putPair({
    pairId,
    candidateStage,
    describes: `${candidateStage}: the OPTIONAL independent review Agent on a real refactor, with the mandatory verification contract carried by BOTH arms, one real provider run per arm`,
    cohort,
    baselineTaskIds: [input.arms.without.taskId],
    candidateTaskIds: [input.arms.with.taskId],
    provenance: {
      executedAt: input.executedAt ?? at,
      kind: "real-provider",
      entryPoint: "scripts/gate8-pair-run.cjs",
      notes: `provider ${input.provider}, model ${input.model}; both arms ran through MainCommander.executePlan with the production ApiRuntime and ProviderApiClient, and both carried the mandatory verification contract. Stage presence is read from the durable execution trace, not inferred.`
    }
  });
  store.save(at);
  process.stdout.write(`[gate8] pair ${pairId}: ${pairing.added ? "added" : "replaced"} (artifact rebuilt from ${derived.length} ledger roots)\n`);
  for (const entry of derived) {
    const totals = entry.record.totals;
    process.stdout.write(
      `[gate8] ${entry.arm.padEnd(15)} runtime=${entry.record.runtime} pipeline=${entry.record.pipeline.join("+")}` +
      ` modelCalls=${totals.modelCalls} inputTokens=${totals.inputTokens} outputTokens=${totals.outputTokens}` +
      ` reworkAvoided=${totals.reworkAvoided} measured=${entry.record.measured.length}\n`
    );
  }
  return 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const command = options._[0] ?? "run";
  const provider = typeof options.provider === "string" ? options.provider : "deepseek";
  const envName = typeof options.env === "string" ? options.env : "BOSS_IMPORT_PROVIDER_KEY";
  const credential = process.env[envName];
  if (!credential || !credential.trim()) {
    process.stderr.write(`gate8: credential not found in ${envName}\n`);
    return 2;
  }
  const url = typeof options["base-url"] === "string" ? options["base-url"].replace(/\/+$/, "") : "https://api.deepseek.com/v1";
  const model = typeof options.model === "string" ? options.model : "";
  if (!model) {
    process.stderr.write("gate8: --model is required (the provider's own model id)\n");
    return 2;
  }
  const dataRoot = typeof options["data-root"] === "string"
    ? path.resolve(options["data-root"])
    : fs.mkdtempSync(path.join(os.tmpdir(), "boss-gate8-"));
  fs.mkdirSync(dataRoot, { recursive: true });
  const candidateStage = typeof options.stage === "string" ? options.stage : "review";
  const stage = CANDIDATE_STAGES[candidateStage];
  if (!stage) {
    process.stderr.write(`gate8: unknown --stage '${candidateStage}'; this harness supports ${Object.keys(CANDIDATE_STAGES).join(", ")}\n`);
    process.stderr.write("gate8: `verify` is deliberately not among them — it is a mandatory platform contract gate with no legal no-verify arm\n");
    return 2;
  }

  const planFile = path.join(dataRoot, "gate8-run.json");
  if (command === "pair") {
    // Re-derive the artifact from ledgers an earlier `run` produced. No provider call is made.
    if (!fs.existsSync(planFile)) {
      process.stderr.write(`gate8: no run plan at ${planFile}; run the pair first\n`);
      return 1;
    }
    return buildPair(JSON.parse(fs.readFileSync(planFile, "utf8")));
  }

  const resolved = { provider, credential, baseUrl: url, model, dataRoot, stage: candidateStage };
  // Deliberately sequential: two live provider runs must not contend for rate limit, and the
  // baseline has to finish before the candidate starts for the pair to be a pair.
  const baseline = await runArm(resolved, false);
  const candidate = await runArm(resolved, true);

  // The cohort identity both arms share, and the SAME strings the collector was given. The guard
  // re-checks them from the records rather than trusting this file, so a disagreement here shows up
  // as a refusal rather than as a silent pairing.
  const runLabel = typeof options.label === "string" ? options.label : new Date().toISOString().replace(/[:.]/g, "-");
  const cohort = {
    // From the runtime object, not from the provider id: the ledger records the runtime id, and a
    // cohort spelling it differently is a pairing the guard correctly refuses.
    runtime: baseline.runtimeId,
    benchmarkTaskId: stage.benchmarkTaskId,
    inputIdentity: `objective:${Buffer.from(OBJECTIVE, "utf8").toString("hex").slice(0, 32)}`,
    plannedVariable: stage.plannedVariable
  };
  const plan = {
    runLabel,
    provider,
    model,
    stage: cohort.plannedVariable,
    ...cohort,
    executedAt: new Date().toISOString(),
    arms: { without: baseline, with: candidate }
  };
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const code = buildPair(plan);
  if (code !== 0) return code;

  // Printed shape: counts, ids and booleans. Never the credential, never a prompt, never a reply.
  for (const arm of [baseline, candidate]) {
    process.stdout.write(
      `[gate8] ${arm.arm.padEnd(22)} status=${arm.status.padEnd(10)} verification=${String(arm.verification).padEnd(7)}` +
      ` modelCalls=${arm.modelCalls} inputTokens=${arm.providerInputTokens ?? "unmeasured"}` +
      ` reviewFindings=${arm.reviewFindings ?? "unmeasured"} retries=${arm.retries}\n` +
      `[gate8]   trace=${arm.executedStages.join(", ") || "none"} modifiedFiles=${arm.modifiedFiles} wallMs=${arm.wallMs}\n`
    );
    if (arm.failure) process.stdout.write(`[gate8]   failure: ${arm.failure}\n`);
  }
  process.stdout.write(`[gate8] run plan: ${path.relative(ROOT, planFile).split(path.sep).join("/")}\n`);
  process.stdout.write(`[gate8] baseline ledger: ${baseline.ledgerRoot}\n`);
  process.stdout.write(`[gate8] candidate ledger: ${candidate.ledgerRoot}\n`);
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`gate8: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
