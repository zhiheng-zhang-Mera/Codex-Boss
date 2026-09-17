/**
 * Phase 06 Task D — the dogfooding harness.
 *
 * ## What this is for
 *
 * The Foundation's own exit condition (`Phase-05-…-Soak.md` §7) is that the platform stop being *proved*
 * and start being *used*: run it on real work, and let the real work find the platform's defects rather
 * than adding speculative infrastructure. This script is that capability. It puts one real engineering
 * objective through the production autonomous-engineering seam against a REAL checkout of this
 * repository, and writes durable evidence of what happened.
 *
 * ## Isolation, and why the evidence is worthless without it
 *
 * The task MUTATES the workspace it is given — that is what engineering is. So it is given a LINKED
 * GIT WORKTREE at a detached HEAD, never the live checkout. A linked worktree is chosen over a clone
 * because it shares the object store and the installed toolchain, so the house build/test steps
 * (`pnpm run …`) run for real instead of being skipped for want of dependencies; a clone would need a
 * full reinstall before the gates it must clear even exist.
 *
 * The harness records the live checkout's HEAD and status BEFORE and AFTER and refuses to report a run
 * as usable if either moved. A run that touched the checkout is a failed run whose conclusions are
 * void — not a run to clean up and call a pass.
 *
 * ## What the evidence contains, and what it deliberately does not
 *
 * Recorded: the input identity, the git base, the DURABLE EXECUTION TRACE the platform wrote (which
 * stages actually ran — the Phase 05 contract, never inferred), provider-reported token usage, the
 * driver's own iteration summary, and the isolation check.
 *
 * Not recorded: the provider's reply text, any prompt, and any credential. Cost figures come from the
 * provider's usage block; the platform's `ceil(chars/4)` estimate is carried separately as a
 * diagnostic, per the Phase 05 token-provenance contract.
 *
 * ## Usage
 *
 *   node scripts/dogfood-engineering.cjs --objective "<what to do>" [--goal-id <id>] [--keep] [--out <file>]
 *
 * Requires `pnpm run build:electron` first (loads `dist-electron/*`) and a configured provider
 * (`--provider`, default `deepseek`), read from the environment exactly as `gate8-pair-run.cjs` does.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

function git(args, cwd) {
  return execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

/** The live checkout's identity, so the harness can prove it did not move. */
function checkoutState() {
  return { head: git(["rev-parse", "HEAD"], ROOT), status: git(["status", "--porcelain"], ROOT) };
}

/**
 * Create the isolated workspace: a linked worktree at a detached HEAD.
 *
 * Detached on purpose. A branch would give the run a name to commit to, and the point of dogfooding is
 * to observe the platform, not to produce a change anyone merges.
 */
function makeWorktree(parent) {
  const workspace = path.join(parent, "workspace");
  const base = git(["rev-parse", "HEAD"], ROOT);
  git(["worktree", "add", "--detach", workspace, base], ROOT);
  return { workspace, base };
}

/**
 * Install the toolchain into the isolated workspace.
 *
 * Required, not optional. The engine's audit/build/test steps run the workspace's OWN compilers by
 * absolute path (`node_modules/typescript/bin/tsc`, `node_modules/vitest/vitest.mjs` — see
 * `command-runner.ts`), and a linked worktree starts with no `node_modules`. Without this the audit
 * fails for want of a compiler, the failure is reported as a typecheck finding, and the run measures
 * the harness's own omission instead of the platform.
 *
 * Offline from the local store when one is configured, which is what makes this cheap enough to be
 * part of every run.
 */
function installToolchain(workspace, log) {
  const storeDir = process.env.BOSS_PNPM_STORE ?? "D:\\.pnpm-store";
  const offline = fs.existsSync(storeDir) ? ` --offline "--store-dir=${storeDir}"` : "";
  const command = `corepack pnpm install --ignore-scripts${offline}`;
  execFileSync("powershell", ["-NoProfile", "-Command", command], {
    cwd: workspace,
    windowsHide: true,
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  log.command = command;
}

/** The executables the engine's allowed commands resolve in the workspace. */
function toolchainPresent(workspace) {
  return {
    typescript: fs.existsSync(path.join(workspace, "node_modules", "typescript", "bin", "tsc")),
    vitest: fs.existsSync(path.join(workspace, "node_modules", "vitest", "vitest.mjs"))
  };
}

/* ------------------------------------------------------------------ *
 * the provider-backed engineering worker
 * ------------------------------------------------------------------ */

/**
 * The worker the production loop calls: a real coder and a real reviewer.
 *
 * `createLiveEngineeringOperations` asks this for two roles. The coder is handed the
 * `ProposalRunner` request (a JSON scope with the file contents and their expected hashes) and must
 * answer with the same superset shape; the reviewer is handed review instructions and answers with
 * findings. Both go to the provider through the production `ProviderApiClient`.
 */
function makeProviderWorker(provider, client, evidence) {
  return {
    async ask(role, prompt) {
      const started = Date.now();
      const answer = await client.complete(provider, prompt);
      const elapsedMs = Date.now() - started;
      evidence.calls.push({
        role,
        elapsedMs,
        promptChars: prompt.length,
        replyChars: answer.content.length,
        // The PROVIDER's own accounting, when it reported any. Absent stays absent.
        ...(answer.usage ? { usage: answer.usage } : {}),
        adapterVersion: answer.adapterVersion
      });
      return answer.content;
    }
  };
}

/**
 * Wrap the repo operations so the audit's OWN findings are recorded.
 *
 * Without this the evidence cannot answer the first question any run raises: "what did the platform
 * find?" A run that reports `stage: IMPLEMENT` with a coder error is unreadable if the finding that
 * caused it was never written down — the reader is left inferring, which is the habit this phase
 * exists to break. The finding DESCRIPTION and its area are recorded; the provider's reply text never
 * is.
 */
function instrumentedOperations(operations, evidence) {
  return {
    ...operations,
    async audit(goal) {
      const started = Date.now();
      const findings = await operations.audit(goal);
      evidence.audit = {
        elapsedMs: Date.now() - started,
        findingCount: findings.length,
        findings: findings.map((finding) => ({
          id: finding.id,
          area: finding.area,
          severity: finding.severity,
          // The description carries the compiler/test transcript head; the evidence field carries its
          // tail. Lengths are recorded too, so a truncated record is visible as truncated.
          description: (finding.description ?? "").slice(0, 400),
          evidenceChars: (finding.evidence ?? "").length
        }))
      };
      return findings;
    },
    async implement(goal, finding) {
      evidence.implementAttempts = [...(evidence.implementAttempts ?? []), { findingId: finding.id, area: finding.area, severity: finding.severity }];
      return operations.implement(goal, finding);
    }
  };
}

/* ------------------------------------------------------------------ *
 * entry point
 * ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const provider = typeof options.provider === "string" ? options.provider : "deepseek";
  const envName = typeof options.env === "string" ? options.env : "DeepSeek_API";
  const credential = process.env[envName];
  if (!credential || !credential.trim()) {
    process.stderr.write(`dogfood: credential not found in ${envName}\n`);
    return 2;
  }
  const model = typeof options.model === "string" ? options.model : "deepseek-flash";
  const baseUrl = (typeof options["base-url"] === "string" ? options["base-url"] : "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const objective = typeof options.objective === "string" ? options.objective : "";
  if (!objective.trim()) {
    process.stderr.write("dogfood: --objective is required (the real work to run)\n");
    return 2;
  }
  const maxIterations = Number.isInteger(Number(options.iterations)) ? Number(options.iterations) : 1;

  const before = checkoutState();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "boss-dogfood-"));
  const startedAt = new Date().toISOString();
  const evidence = {
    kind: "DOGFOOD_ENGINEERING_RUN",
    startedAt,
    objective,
    provider,
    model,
    /** The platform commit the run is judged against, and the git base the workspace was cut from. */
    platformCommit: before.head,
    inputIdentity: `objective:${Buffer.from(objective, "utf8").toString("hex").slice(0, 32)}`,
    calls: [],
    isolation: { checkoutHeadBefore: before.head, checkoutCleanBefore: before.status === "" },
    status: "RUNNING"
  };

  let worktree = null;
  try {
    worktree = makeWorktree(parent);
    evidence.gitBase = worktree.base;

    // Toolchain first, and refused if incomplete: a run whose audit cannot compile has measured the
    // harness, not the platform, and saying so is better than reporting a typecheck finding it caused.
    installToolchain(worktree.workspace, evidence);
    evidence.toolchain = toolchainPresent(worktree.workspace);
    if (!evidence.toolchain.typescript || !evidence.toolchain.vitest) {
      throw new Error(`the isolated workspace has no usable toolchain (typescript=${evidence.toolchain.typescript}, vitest=${evidence.toolchain.vitest}); refusing to run an audit that cannot compile`);
    }

    // The isolated data root: the ledger, the state document and everything else Boss writes belong to
    // this run, not to the developer's own runtime data.
    const dataRoot = path.join(parent, "runtime-data");
    fs.mkdirSync(dataRoot, { recursive: true });

    const { ApiSettingsStore } = load("electron/api-settings.js");
    const { ProviderApiClient } = load("electron/provider-api.js");
    const settings = new ApiSettingsStore(
      path.join(dataRoot, "api-settings.json"),
      (plainText) => Buffer.from(plainText, "utf8").toString("base64"),
      (cipherText) => Buffer.from(cipherText, "base64").toString("utf8")
    );
    settings.update({ providerId: provider, enabled: true, protocol: "openai-compatible", baseUrl, model, apiKey: credential.trim() });
    settings.assertReady(provider);
    const client = new ProviderApiClient(settings);

    const { EngineeringLoopDriver } = load("electron/engineering/engineering-loop-driver.js");
    const { createRepoEngineeringOperations } = load("electron/engineering/repo-engineering-operations.js");
    const { createLiveEngineeringOperations } = load("electron/engineering/live-engineering-operations.js");
    const { TaskLedger } = load("electron/commander/task-ledger.js");
    const { engineeringJournalAt } = load("electron/engineering/engineering-journal.js");

    const goal = {
      schemaVersion: 1,
      id: typeof options["goal-id"] === "string" ? options["goal-id"] : `dogfood-${Date.now().toString(36)}`,
      objective,
      workspace: worktree.workspace,
      protectedProductBehavior: [],
      allowedChangeScope: ["correctness", "tests", "docs"],
      forbiddenChangeScope: [],
      verificationPolicy: "standard",
      agentCount: 1,
      convergencePolicy: { cleanRoundsRequired: 1, maxIterations },
      createdAt: startedAt
    };

    const ledgerRoot = path.join(dataRoot, "tasks");
    const ledger = new TaskLedger(ledgerRoot);
    // The task id is the goal id, so the durable trace the platform writes is attributable to this run
    // and can be read back afterwards — this is the Phase 05 `executedStages` contract in use.
    ledger.create(goal.id, objective, [], {});

    const journal = engineeringJournalAt(path.join(dataRoot, "engineering"));
    journal.loopStore().freezeGoal(goal);
    const worker = makeProviderWorker(provider, client, evidence);
    const live = createLiveEngineeringOperations({ workspace: worktree.workspace, goal, worker });
    const operations = instrumentedOperations(
      createRepoEngineeringOperations({
        workspace: worktree.workspace,
        implement: (finding) => live.implement(goal, finding),
        review: (finding, files, acceptance) => live.review(goal, finding, files, acceptance)
      }),
      evidence
    );

    ledger.recordStage(goal.id, "implement", "agent");
    const summary = await new EngineeringLoopDriver({ store: journal.loopStore(), operations, maxIterations }).run();
    evidence.summary = {
      state: summary.state,
      iterations: summary.iterations?.length ?? 0,
      changedFiles: summary.changedFiles ?? [],
      terminalReason: summary.terminalReason ?? null
    };

    // The durable execution trace, read back from the ledger rather than reconstructed.
    const persisted = ledger.load(goal.id);
    evidence.executedStages = (persisted?.executedStages ?? []).map((entry) => `${entry.stage}:${entry.kind}`);
    evidence.iterationRows = journal.loopStore().iterations().map((item) => ({
      iteration: item.iteration,
      stage: item.stage,
      status: item.status,
      buildPassed: item.buildPassed,
      testsPassed: item.testsPassed,
      changedFiles: item.changedFiles,
      reviewFindings: item.reviewFindings,
      remainingRisk: item.remainingRisk
    }));

    // Provider-reported totals, plus the platform's own estimate kept apart as a diagnostic.
    const reported = evidence.calls.map((call) => call.usage).filter(Boolean);
    evidence.usage = {
      calls: evidence.calls.length,
      providerInputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0) : null,
      providerOutputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0) : null,
      totalWallMs: evidence.calls.reduce((sum, call) => sum + call.elapsedMs, 0),
      note: "providerInputTokens/OutputTokens are the provider's own counts. No ceil(chars/4) estimate is promoted to a measurement."
    };

    evidence.status = summary.state === "ENGINEERING_CONVERGED" ? "CONVERGED" : "NOT_CONVERGED";
  } catch (error) {
    evidence.status = "FAILED";
    evidence.error = error instanceof Error ? error.message : String(error);
  } finally {
    // Isolation is checked BEFORE anything is cleaned up, so a run that touched the checkout is
    // reported as such rather than tidied away.
    const after = checkoutState();
    evidence.isolation.checkoutHeadAfter = after.head;
    evidence.isolation.checkoutCleanAfter = after.status === "";
    // Isolation means the run did not CHANGE the checkout, not that the checkout was pristine before
    // it started. Conjoining the two made the check report `false` for a developer's own uncommitted
    // work — an unrelated fact — and would have reported `true` for a run that dirtied a clean tree and
    // cleaned up after itself. Compared field by field instead.
    evidence.isolation.checkoutHeadUnchanged = after.head === before.head;
    evidence.isolation.checkoutStatusUnchanged = after.status === before.status;
    evidence.isolation.checkoutUntouched = after.head === before.head && after.status === before.status;
    evidence.finishedAt = new Date().toISOString();

    const out = typeof options.out === "string"
      ? path.resolve(options.out)
      : path.join(ROOT, "artifacts", "platform-foundation", "phase-06", `dogfood-${startedAt.replace(/[:.]/g, "-")}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    if (worktree) {
      try { git(["worktree", "remove", "--force", worktree.workspace], ROOT); }
      catch { /* the run's tree may be mid-mutation; the evidence already says whether isolation held */ }
      try { git(["worktree", "prune"], ROOT); } catch { /* best effort */ }
    }
    if (options.keep !== true) fs.rmSync(parent, { recursive: true, force: true });

    process.stdout.write(`[dogfood] status=${evidence.status} provider=${provider} model=${model}\n`);
    process.stdout.write(`[dogfood] gitBase=${(evidence.gitBase ?? "").slice(0, 12)} calls=${evidence.usage?.calls ?? 0} providerInputTokens=${evidence.usage?.providerInputTokens ?? "unmeasured"}\n`);
    process.stdout.write(`[dogfood] trace=${(evidence.executedStages ?? []).join(", ") || "none"} changedFiles=${evidence.summary?.changedFiles?.length ?? 0} iterations=${evidence.summary?.iterations ?? 0}\n`);
    process.stdout.write(`[dogfood] isolation: checkoutUntouched=${evidence.isolation.checkoutUntouched}\n`);
    if (evidence.error) process.stdout.write(`[dogfood] error: ${evidence.error}\n`);
    process.stdout.write(`[dogfood] evidence: ${path.relative(ROOT, out).split(path.sep).join("/")}\n`);
  }

  if (evidence.isolation.checkoutUntouched !== true) return 1;
  return evidence.status === "FAILED" ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`dogfood: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
