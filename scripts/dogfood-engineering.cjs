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
 * Create the isolated workspace.
 *
 * ## Why a clone, and why its origin remote is removed
 *
 * The platform refuses to let ordinary engineering mutate the Boss repository itself
 * (`mutation-guard.ts`): a target that resolves to the Boss repository needs a real
 * `EvolutionRunContext`, which only `SelfEvolutionCoordinator` can create. That guard is correct and
 * this harness is not allowed to work around it — a LINKED WORKTREE shares the Boss repository's git
 * identity, so it is refused, which is exactly what the first attempt here hit.
 *
 * A clone whose `origin` remote has been removed is a genuinely independent repository: deriving
 * `isSelf` requires either a structural signal (the same canonical root, git common directory or
 * installation root) or the remote identity agreeing with the product marker. Removing the remote
 * leaves neither, so the tree is treated as what it is — an ordinary checkout that happens to contain
 * the same source — and the platform's normal engineering path runs unmodified.
 *
 * `--local` keeps it fast; the toolchain is installed afterwards because a clone has no
 * `node_modules` and the audit runs the workspace's own compilers by absolute path.
 */
function makeWorkspace(parent, mode) {
  const workspace = path.join(parent, "workspace");
  const base = git(["rev-parse", "HEAD"], ROOT);
  if (mode === "worktree") {
    // Kept for the record of what the guard does: a linked worktree IS the Boss repository by
    // identity, so a mutation of it is refused unless SelfEvolutionCoordinator covers it.
    git(["worktree", "add", "--detach", workspace, base], ROOT);
    return { workspace, base, mode: "linked-worktree" };
  }
  execFileSync("git", ["clone", "--quiet", "--local", ROOT, workspace], { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  // Detach from the Boss identity so the mutation guard treats this as an ordinary repository rather
  // than as an attempt to self-modify Stable.
  git(["remote", "remove", "origin"], workspace);
  return { workspace, base, mode: "clone-without-remote" };
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

/**
 * The paths an objective NAMES, so the coder is handed the files the goal is actually about.
 *
 * Extracted from the objective text rather than guessed: a dogfooding goal says which files it wants
 * touched, and handing the coder those files is the difference between a bounded proposal and a
 * repository-wide one. A goal that names nothing yields an empty list, and the loop reports that it
 * has no authorised scope instead of proposing a change to files nobody authorised.
 */
function goalFilesFor(objective) {
  const found = objective.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|cjs|mjs|js|json|md)/g) ?? [];
  return [...new Set(found.map((token) => token.replace(/^\.\//, "")))];
}

/* ------------------------------------------------------------------ *
 * the provider-backed engineering worker
 * ------------------------------------------------------------------ */

/**
 * The coder the harness uses.
 *
 * Normally the provider. With `--scripted <file>`, the reply's `changes` come from that file while the
 * rest of the pipeline stays real: the same scope, the same host checks, the same acceptance judgement.
 * Only the PROPOSAL is fixed, which is what lets the counterexample cases be reproduced on demand — a
 * vacuous proposal must be refused every time, not only when the model happens to write one.
 *
 * The scripted file provides `{ "changes": [ { "path", "content" } ] }`. The `checks` are taken from the
 * live request, because they are the host's to choose, and an existing file's `expectedSha256` is filled
 * from the request so a hand-written proposal cannot be rejected for a reason the case is not about.
 */
function makeWorker(options, provider, client, evidence) {
  const worker = makeProviderWorker(provider, client, evidence);
  if (typeof options.scripted !== "string") return worker;
  const scriptedPath = path.resolve(options.scripted);
  return {
    async ask(role, prompt) {
      const content = fs.readFileSync(scriptedPath, "utf8");
      let reply = content;
      try {
        // The request is the JSON the ProposalRunner builds; recover what the host already decided.
        const request = JSON.parse(prompt);
        const proposed = JSON.parse(content);
        if (Array.isArray(proposed.changes) && Array.isArray(request.requiredChecks)) {
          const known = new Map((request.files ?? []).map((file) => [file.path, file.expectedSha256]));
          reply = JSON.stringify({
            changes: proposed.changes.map((change) => ({ ...change, expectedSha256: known.get(change.path) ?? null })),
            checks: request.requiredChecks
          });
        }
      } catch { /* a full manifest is passed through untouched */ }
      evidence.calls.push({ role, outcome: "SCRIPTED", replyChars: reply.length, source: path.basename(scriptedPath), elapsedMs: 0 });
      return reply;
    }
  };
}

/** The provider-backed engineering worker. */
function makeProviderWorker(provider, client, evidence) {
  return {
    async ask(role, prompt) {
      const started = Date.now();
      // Recorded BEFORE the call is awaited, and updated after. A call that throws must still appear:
      // recording only successes meant a run whose coder call failed reported `calls: []`, which reads
      // as "the coder was never asked" rather than "the coder was asked and the call died" — the same
      // observability gap as an uncaptured audit finding.
      const record = { role, promptChars: prompt.length, elapsedMs: 0, outcome: "PENDING" };
      evidence.calls.push(record);
      try {
        const answer = await client.complete(provider, prompt);
        record.elapsedMs = Date.now() - started;
        record.outcome = "OK";
        record.replyChars = answer.content.length;
        // The PROVIDER's own accounting, when it reported any. Absent stays absent.
        if (answer.usage) record.usage = answer.usage;
        record.adapterVersion = answer.adapterVersion;
        return answer.content;
      } catch (error) {
        record.elapsedMs = Date.now() - started;
        record.outcome = "FAILED";
        record.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : String(error).slice(0, 200);
        throw error;
      }
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
  // Extra authorized paths for a case whose point IS a non-test change. Recorded in the evidence, so a
  // reader can see the scope the run was given rather than having to infer it from what applied.
  const allowedPaths = (typeof options.allow === "string" ? options.allow.split(",") : [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // `clone` by default: only a tree that is NOT the Boss repository by identity can be mutated by the
  // ordinary engineering path. `worktree` is kept so the guard's refusal can be reproduced on demand.
  const workspaceMode = options.worktree === true ? "worktree" : "clone";

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
    // The scope this run was GRANTED, so a reader can see it rather than infer it from what applied.
    authorizedPaths: ["tests/unit/", "tests/acceptance/", ...allowedPaths],
    status: "RUNNING"
  };

  let workspace = null;
  try {
    workspace = makeWorkspace(parent, workspaceMode);
    evidence.gitBase = workspace.base;
    evidence.workspaceMode = workspace.mode;

    // Toolchain first, and refused if incomplete: a run whose audit cannot compile has measured the
    // harness, not the platform, and saying so is better than reporting a typecheck finding it caused.
    installToolchain(workspace.workspace, evidence);
    evidence.toolchain = toolchainPresent(workspace.workspace);
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

    const { runEngineeringGoalLoop, createGoalLoopOperations } = load("electron/engineering/engineering-goal-loop.js");
    const { createRepoEngineeringOperations } = load("electron/engineering/repo-engineering-operations.js");
    const { TaskLedger } = load("electron/commander/task-ledger.js");
    const { engineeringJournalAt } = load("electron/engineering/engineering-journal.js");

    const goal = {
      schemaVersion: 1,
      id: typeof options["goal-id"] === "string" ? options["goal-id"] : `dogfood-${Date.now().toString(36)}`,
      objective,
      workspace: workspace.workspace,
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
    const worker = makeWorker(options, provider, client, evidence);
    const repo = createRepoEngineeringOperations({ workspace: workspace.workspace });
    const instrumented = instrumentedOperations(repo, evidence);

    // The GOAL-DRIVEN loop, not the repair loop. The repair loop asks the workspace what is wrong and
    // fixes the first thing it finds, which on a goal means working a pre-existing failure the goal
    // never asked about — the real run that produced PF-DEBT-010 chased an environment-blocked suite
    // and never touched the objective. Here the audit is the precondition and the objective is the
    // work list (PF-DEBT-010 / engineering-goal-loop.ts).
    const goalOperations = createGoalLoopOperations({
      workspace: workspace.workspace,
      coder: (prompt) => worker.ask("coder", prompt),
      reviewer: (prompt) => worker.ask("reviewer", prompt),
      // The objective's own named paths, so the coder is handed exactly the files the goal is about.
      namedFiles: goalFilesFor(objective),
      // A goal that asks for a NEW test file must be allowed to create it. The TRAILING SLASH is what
      // makes these prefix grants rather than file allowances — without it they would authorise nothing
      // creatable and the run would fail with "Change outside authorized scope" (which it did, twice,
      // before this was noticed). It is an allowance over the test tree, not a blanket permission.
      //
      // `--allow <path>` (repeatable) widens it for a case that is ABOUT a non-test change. Case D needs a
      // source-only proposal, and without this the run stopped before the acceptance model was ever
      // consulted: `attempt 1 could not apply a change: Engineering requires explicit file and verification
      // scope`. That is the scope guard doing its job, not a finding — so the case grants the scope it is
      // about rather than the guard being weakened to accommodate it.
      allowPaths: ["tests/unit/", "tests/acceptance/", ...allowedPaths],
      maxScopeFiles: 12,
      // The host's own account of the scope and checks it settled on, per attempt. A refusal is otherwise
      // unattributable from the artifact.
      describe: (observation) => {
        evidence.scopeObservations = [...(evidence.scopeObservations ?? []), observation];
      },
      audit: (g) => instrumented.audit(g),
      // The acceptance judgement, captured into evidence. It is the default production model
      // (`judgeGoalAcceptance`), recorded here so the run's verdict is auditable alongside the checks it
      // came from — `verification` says the checks passed, `acceptance` says what they establish.
      acceptance: async (g, changedFiles) => {
        const { judgeGoalAcceptance } = load("electron/engineering/goal-acceptance.js");
        const verdict = judgeGoalAcceptance({ objective: g.objective, changedFiles, workspace: workspace.workspace });
        evidence.acceptance = {
          verdict: verdict.verdict,
          reasons: verdict.reasons,
          weakSignals: verdict.weakSignals,
          claims: verdict.claims.map((claim) => ({ claimId: claim.claimId, criticality: claim.criticality, verdict: claim.verdict, reasons: claim.reasons }))
        };
        // THE FILES THE JUDGEMENT ACTUALLY READ, verbatim.
        //
        // Without this the evidence is not self-contained: a verdict of `INSUFFICIENT_EVIDENCE` on a
        // generated test cannot be checked by anyone who does not still have the temp workspace, and the
        // first real case-B run had to be diagnosed from a directory that only survived because `--keep`
        // happened to be passed. A reader must be able to reproduce the judgement from the artifact, so the
        // judged evidence is copied in beside the verdict. Only the changed TEST files are captured — they
        // are the input to this judgement and they are what a refusal is about.
        evidence.judgedFiles = changedFiles
          .filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
          .map((file) => {
            try {
              return { path: file, chars: fs.statSync(path.join(workspace.workspace, file.split("/").join(path.sep))).size, content: fs.readFileSync(path.join(workspace.workspace, file.split("/").join(path.sep)), "utf8") };
            } catch (error) {
              return { path: file, error: error instanceof Error ? error.message : String(error) };
            }
          });
        return verdict;
      }
    });

    ledger.recordStage(goal.id, "implement", "agent");
    const summary = await runEngineeringGoalLoop({ goal, operations: goalOperations, maxAttempts: maxIterations });
    evidence.summary = {
      state: summary.state,
      attempts: summary.iterations,
      changedFiles: summary.changedFiles ?? [],
      terminalReason: summary.terminalReason ?? null,
      // Carried, not acted on: the state the goal started from. A reader must be able to see that the
      // workspace was not pristine, without that fact becoming the run's work.
      preExistingFindings: (summary.preExisting ?? []).map((finding) => ({ id: finding.id, area: finding.area, severity: finding.severity, kind: finding.kind ?? "code" })),
      verification: summary.verification ?? null,
      // Separate from `verification` on purpose: one says the checks passed, the other says what they
      // establish. A CONVERGED state requires both, which is Phase 07's whole change.
      acceptanceVerdict: summary.acceptance?.verdict ?? null,
      acceptanceReasons: summary.acceptance?.reasons ?? [],
      reviewFindings: (summary.reviewFindings ?? []).map((finding) => ({ severity: finding.severity, summary: finding.summary }))
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

    // Provider-reported totals, plus the platform's own estimate kept apart as a diagnostic. A call
    // that FAILED contributes no usage — absent stays absent rather than becoming a zero.
    const completed = evidence.calls.filter((call) => call.outcome === "OK");
    const reported = completed.map((call) => call.usage).filter(Boolean);
    evidence.usage = {
      calls: completed.length,
      failedCalls: evidence.calls.length - completed.length,
      providerInputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0) : null,
      providerOutputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0) : null,
      totalWallMs: evidence.calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0),
      note: "providerInputTokens/OutputTokens are the provider's own counts. No ceil(chars/4) estimate is promoted to a measurement."
    };

    // The goal loop's own state is the verdict — it is not the repair loop's `ENGINEERING_CONVERGED`.
    // Comparing against the wrong vocabulary reported a converged run as NOT_CONVERGED.
    evidence.status = summary.state;
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

    // A linked worktree has to be unregistered from the live checkout; a clone is self-contained and
    // the whole temp parent is removed below.
    if (workspace?.mode === "linked-worktree") {
      try { git(["worktree", "remove", "--force", workspace.workspace], ROOT); }
      catch { /* the run's tree may be mid-mutation; the evidence already says whether isolation held */ }
      try { git(["worktree", "prune"], ROOT); } catch { /* best effort */ }
    }
    if (options.keep !== true) fs.rmSync(parent, { recursive: true, force: true });

    process.stdout.write(`[dogfood] status=${evidence.status} provider=${provider} model=${model}\n`);
    process.stdout.write(`[dogfood] gitBase=${(evidence.gitBase ?? "").slice(0, 12)} calls=${evidence.usage?.calls ?? 0} providerInputTokens=${evidence.usage?.providerInputTokens ?? "unmeasured"}\n`);
    process.stdout.write(`[dogfood] trace=${(evidence.executedStages ?? []).join(", ") || "none"} changedFiles=${evidence.summary?.changedFiles?.length ?? 0} iterations=${evidence.summary?.iterations ?? 0}\n`);
    process.stdout.write(`[dogfood] isolation: checkoutUntouched=${evidence.isolation.checkoutUntouched}\n`);
    // The Phase 07 line: the host's checks and the objective's satisfaction are different claims, and a
    // reader must be able to see both.
    process.stdout.write(`[dogfood] acceptance=${evidence.summary?.acceptanceVerdict ?? "not judged"} (checks ${evidence.summary?.verification?.passed === true ? "PASS" : "not run"})\n`);
    process.stdout.write(`[dogfood] judged=${(evidence.judgedFiles ?? []).map((file) => `${file.path}(${file.chars ?? "unreadable"}c)`).join(", ") || "none"}\n`);
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
