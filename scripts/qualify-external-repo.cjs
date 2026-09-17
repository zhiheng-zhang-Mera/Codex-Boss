/**
 * Phase 08 external qualification harness.
 *
 * Drives the REAL production path — audit, scope, proposal, mutation guard, mandatory verification,
 * semantic acceptance, convergence — against an EXTERNAL repository that is not Codex-Boss. No scripted
 * proposal: a real provider writes the change.
 *
 * ## Why this is not `dogfood-engineering.cjs`
 *
 * That harness qualifies the platform against ITSELF: it clones Boss, strips the remote so the mutation
 * guard accepts the tree, and installs Boss's own toolchain. Every one of those steps is a Boss-shaped
 * assumption, and an external qualification must not inherit them — if the external run only worked
 * because Boss's toolchain had been installed into it, it would prove nothing about external projects.
 *
 * This harness therefore clones the named external repository, removes its remote (so the tree is an
 * ordinary repository rather than something the guard must classify), gives it a local git identity so a
 * commit is possible, and then does NOTHING ELSE to make the run succeed. Whatever the production path
 * then reports is the qualification result.
 *
 * ## What it records
 *
 * Everything `Update-Plan/Platform-Foundation/Phase-08-Production-Qualification-and-Promotion.md` §4.2
 * requires: repository identity, BASE commit, objective, the derived acceptance
 * claims and obligations, modified files and final diff, provider/model, provider-reported token usage,
 * attempts, pre-existing failures, the verification result, the semantic acceptance verdict, isolation,
 * and whether Owner intervention was required (it never is — this harness asks nobody anything).
 *
 * Usage:
 *   node scripts/qualify-external-repo.cjs --repo <path-or-url> --objective "<real task from that repo>" [--out <file>]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
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

/** The live checkout's identity. An external qualification must not move Boss either. */
function bossIdentity() {
  return { head: git(["rev-parse", "HEAD"], ROOT), status: git(["status", "--porcelain"], ROOT) };
}

/**
 * Clone the external repository into an isolated workspace.
 *
 * `--depth` is deliberately NOT used: qualification must be against a specific BASE commit, and a shallow
 * clone would make later revision reading unreliable. The remote is removed afterwards so the tree is a
 * plain repository; the origin URL is recorded first, because removing it must not lose the identity the
 * evidence needs.
 */
function prepareWorkspace(parent, source, keepRemote) {
  const workspace = path.join(parent, "workspace");
  const local = fs.existsSync(source);
  const origin = local ? git(["remote", "get-url", "origin"], source) : source;
  const sourceCommit = git(["rev-parse", "HEAD"], local ? source : ROOT);
  execFileSync("git", ["clone", "--quiet", source, workspace], { cwd: os.tmpdir(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const base = git(["rev-parse", "HEAD"], workspace);
  // The remote is REMOVED by default so the tree is an ordinary repository rather than something the
  // mutation guard has to classify. `--keep-remote` exists to measure the opposite: what the guard does
  // when the external repository still carries its origin identity. Which boundary was exercised is one of
  // the fields Phase 08 must record, and it cannot be recorded if only one configuration is ever tried.
  if (!keepRemote) git(["remote", "remove", "origin"], workspace);
  // A commit needs an identity. Set locally, never globally, so this harness cannot change the machine.
  git(["config", "user.email", "qualification@codex-boss.invalid"], workspace);
  git(["config", "user.name", "Phase 08 Qualification"], workspace);
  return { workspace, base, origin, sourceCommit, mode: local ? "clone-of-local-checkout" : "clone-of-remote", remoteRetained: keepRemote === true };
}

/** What the repository actually provides, recorded so a refusal can be attributed rather than guessed. */
function describeRepo(workspace) {
  const tracked = git(["ls-files"], workspace).split("\n").filter(Boolean);
  const byExtension = {};
  for (const file of tracked) {
    const ext = path.extname(file).toLowerCase() || "(none)";
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
  }
  return {
    trackedFiles: tracked.length,
    byExtension,
    hasPackageJson: fs.existsSync(path.join(workspace, "package.json")),
    hasTsconfig: fs.existsSync(path.join(workspace, "tsconfig.json")),
    hasNodeModules: fs.existsSync(path.join(workspace, "node_modules")),
    hasViteConfig: fs.existsSync(path.join(workspace, "vitest.config.mjs")) || fs.existsSync(path.join(workspace, "vitest.config.ts")),
    hasPythonManifest: fs.existsSync(path.join(workspace, "requirements.txt")) || fs.existsSync(path.join(workspace, "pyproject.toml")),
    sampleFiles: tracked.slice(0, 12)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const provider = typeof options.provider === "string" ? options.provider : "deepseek";
  const envName = typeof options.env === "string" ? options.env : "DeepSeek_API";
  const credential = process.env[envName];
  const model = typeof options.model === "string" ? options.model : "deepseek-flash";
  const baseUrl = (typeof options["base-url"] === "string" ? options["base-url"] : "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const source = typeof options.repo === "string" ? options.repo : "";
  const objective = typeof options.objective === "string" ? options.objective : "";
  const startedAt = new Date().toISOString();

  if (!source.trim()) { process.stderr.write("qualify: --repo is required\n"); return 2; }
  if (!objective.trim()) { process.stderr.write("qualify: --objective is required (a real task from that repository)\n"); return 2; }

  const before = bossIdentity();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "boss-qualify-"));
  const evidence = {
    kind: "EXTERNAL_QUALIFICATION_RUN",
    startedAt,
    objective,
    provider,
    model,
    /** Recorded so a reader can see the harness never borrowed Boss's own credentials path. */
    credential: credential && credential.trim() ? "found" : "not found",
    bossCommit: before.head,
    isolation: { bossHeadBefore: before.head, bossCleanBefore: before.status === "" },
    calls: [],
    status: "RUNNING"
  };

  let workspace = null;
  try {
    workspace = prepareWorkspace(parent, source, options["keep-remote"] === true);
    evidence.repository = { origin: workspace.origin, base: workspace.base, sourceCommit: workspace.sourceCommit, workspaceMode: workspace.mode, remoteRetained: workspace.remoteRetained };
    evidence.repository.provided = describeRepo(workspace.workspace);
    evidence.ownerInterventionRequired = false;

    if (!credential || !credential.trim()) {
      evidence.status = "NO_CREDENTIAL";
      evidence.error = `credential not found in ${envName}; refusing to run a qualification without a real provider`;
      return finish(evidence, options, parent, workspace, before, 2);
    }

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
      id: typeof options["goal-id"] === "string" ? options["goal-id"] : `qualify-${Date.now().toString(36)}`,
      objective,
      workspace: workspace.workspace,
      protectedProductBehavior: [],
      allowedChangeScope: ["correctness", "tests", "docs"],
      forbiddenChangeScope: [],
      verificationPolicy: "standard",
      agentCount: 1,
      convergencePolicy: { cleanRoundsRequired: 1, maxIterations: 1 },
      createdAt: startedAt
    };
    evidence.goal = { id: goal.id, allowedChangeScope: goal.allowedChangeScope, verificationPolicy: goal.verificationPolicy };

    const ledger = new TaskLedger(path.join(dataRoot, "tasks"));
    ledger.create(goal.id, objective, [], {});
    const journal = engineeringJournalAt(path.join(dataRoot, "engineering"));
    journal.loopStore().freezeGoal(goal);

    // A real provider worker. Every call is recorded BEFORE it is awaited, so a transport failure appears
    // as a recorded failed call rather than as silence.
    const worker = {
      async ask(role, prompt) {
        const record = { role, promptChars: prompt.length, elapsedMs: 0, outcome: "PENDING" };
        evidence.calls.push(record);
        const started = Date.now();
        try {
          const answer = await client.complete(provider, prompt);
          record.elapsedMs = Date.now() - started;
          record.outcome = "OK";
          record.replyChars = answer.content.length;
          if (answer.usage) record.usage = answer.usage;
          record.adapterVersion = answer.adapterVersion;
          return answer.content;
        } catch (error) {
          record.elapsedMs = Date.now() - started;
          record.outcome = "FAILED";
          record.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
    };

    const repo = createRepoEngineeringOperations({ workspace: workspace.workspace });
    const goalOperations = createGoalLoopOperations({
      workspace: workspace.workspace,
      coder: (prompt) => worker.ask("coder", prompt),
      reviewer: (prompt) => worker.ask("reviewer", prompt),
      // The objective's own named paths. Deliberately NO allowPaths: an external repository gets no
      // Boss-shaped create-grant, and the qualification must show whether the objective's own naming is
      // enough. A refusal on that basis is a result, not a harness omission.
      namedFiles: objective.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|cjs|mjs|js|json|md|py)/g) ?? [],
      describe: (observation) => { evidence.scopeObservations = [...(evidence.scopeObservations ?? []), observation]; },
      audit: async (g) => {
        const auditStarted = Date.now();
        const findings = await repo.audit(g);
        evidence.audit = {
          elapsedMs: Date.now() - auditStarted,
          findingCount: findings.length,
          findings: findings.map((finding) => ({
            id: finding.id,
            area: finding.area,
            severity: finding.severity,
            kind: finding.kind ?? "code",
            description: (finding.description ?? "").slice(0, 400),
            evidenceChars: (finding.evidence ?? "").length
          }))
        };
        // THE AUDIT'S OWN COMMANDS, probed separately from the audit.
        //
        // `createRepoEngineeringOperations().audit()` always runs the workspace's typecheck AND test
        // commands, whatever the goal's scope, and reports only the failures. Asking each command directly
        // is what makes the refusal ATTRIBUTABLE: without it, "PRECONDITION_FAILED on an external Python
        // repo" could be read as "the host ran out of tests" rather than "the host has no toolchain for
        // this language at all". The probes are the host's own allowlisted commands, run read-only.
        const { runAllowedCommand } = load("electron/engineering/command-runner.js");
        evidence.auditCommands = [];
        for (const command of ["typecheck", "test"]) {
          const started = Date.now();
          try {
            const outcome = await runAllowedCommand(workspace.workspace, command, []);
            evidence.auditCommands.push({
              command,
              passed: outcome.passed,
              exitCode: outcome.exitCode,
              elapsedMs: Date.now() - started,
              args: outcome.args,
              output: String(outcome.output ?? "").slice(0, 600)
            });
          } catch (error) {
            evidence.auditCommands.push({ command, threw: error instanceof Error ? error.message : String(error) });
          }
        }
        return findings;
      },
      implement: async (goalContract, finding) => {
        evidence.implementAttempts = [...(evidence.implementAttempts ?? []), { findingId: finding.id, area: finding.area, severity: finding.severity }];
        return repo.implement(goalContract, finding);
      },
      acceptance: async (g, changedFiles) => {
        const { judgeGoalAcceptance } = load("electron/engineering/goal-acceptance.js");
        const verdict = judgeGoalAcceptance({ objective: g.objective, changedFiles, workspace: workspace.workspace });
        evidence.acceptance = {
          verdict: verdict.verdict,
          reasons: verdict.reasons,
          weakSignals: verdict.weakSignals,
          claims: verdict.claims.map((claim) => ({ claimId: claim.claimId, criticality: claim.criticality, verdict: claim.verdict, reasons: claim.reasons }))
        };
        evidence.judgedFiles = changedFiles
          .filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
          .map((file) => {
            const absolute = path.join(workspace.workspace, file.split("/").join(path.sep));
            try { return { path: file, chars: fs.statSync(absolute).size, content: fs.readFileSync(absolute, "utf8") }; }
            catch (error) { return { path: file, error: error instanceof Error ? error.message : String(error) }; }
          });
        return verdict;
      }
    });

    ledger.recordStage(goal.id, "implement", "agent");
    const summary = await runEngineeringGoalLoop({ goal, operations: goalOperations, maxAttempts: 1 });
    evidence.summary = {
      state: summary.state,
      attempts: summary.iterations,
      changedFiles: summary.changedFiles ?? [],
      terminalReason: summary.terminalReason ?? null,
      preExistingFindings: (summary.preExisting ?? []).map((finding) => ({ id: finding.id, area: finding.area, severity: finding.severity, kind: finding.kind ?? "code" })),
      verification: summary.verification ?? null,
      acceptanceVerdict: summary.acceptance?.verdict ?? null,
      acceptanceReasons: summary.acceptance?.reasons ?? [],
      reviewFindings: (summary.reviewFindings ?? []).map((finding) => ({ severity: finding.severity, summary: finding.summary }))
    };

    const persisted = ledger.load(goal.id);
    evidence.executedStages = (persisted?.executedStages ?? []).map((entry) => `${entry.stage}:${entry.kind}`);

    // The final diff, and whether the external repository is still byte-identical to its BASE commit.
    // Qualification means the platform CHANGED this repository, so a dirty tree is the expected outcome —
    // what matters is that the change is exactly the diff that was reported, and that the change is
    // attributable. `pushed: false` is recorded because the harness must never write to the Owner's repo.
    const status = git(["status", "--porcelain"], workspace.workspace);
    evidence.result = {
      changedFiles: summary.changedFiles ?? [],
      finalDiff: git(["diff", "HEAD"], workspace.workspace).slice(0, 200000),
      uncommittedStatus: status,
      headUnchanged: git(["rev-parse", "HEAD"], workspace.workspace) === workspace.base,
      pushed: false
    };

    const completed = evidence.calls.filter((call) => call.outcome === "OK");
    const reported = completed.map((call) => call.usage).filter(Boolean);
    evidence.usage = {
      calls: completed.length,
      failedCalls: evidence.calls.length - completed.length,
      providerInputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0) : null,
      providerOutputTokens: reported.length ? reported.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0) : null,
      note: "providerInputTokens/OutputTokens are the provider's own counts. No ceil(chars/4) estimate is promoted to a measurement."
    };

    evidence.status = summary.state;
  } catch (error) {
    evidence.status = "FAILED";
    evidence.error = error instanceof Error ? error.message : String(error);
  }

  return finish(evidence, options, parent, workspace, before, 0);
}

function finish(evidence, options, parent, workspace, before, code) {
  const after = bossIdentity();
  evidence.isolation.bossHeadAfter = after.head;
  evidence.isolation.bossCleanAfter = after.status === "";
  evidence.isolation.bossUntouched = after.head === before.head && after.status === before.status;
  evidence.finishedAt = new Date().toISOString();

  const out = typeof options.out === "string"
    ? path.resolve(options.out)
    : path.join(ROOT, "artifacts", "platform-foundation", "phase-08", `qualify-${evidence.startedAt.replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  if (options.keep !== true && workspace) fs.rmSync(parent, { recursive: true, force: true });

  process.stdout.write(`[qualify] status=${evidence.status} repo=${evidence.repository?.origin ?? "unknown"}\n`);
  process.stdout.write(`[qualify] base=${(evidence.repository?.base ?? "").slice(0, 12)} files=${evidence.repository?.provided?.trackedFiles ?? "?"} package.json=${evidence.repository?.provided?.hasPackageJson ?? "?"} tsconfig=${evidence.repository?.provided?.hasTsconfig ?? "?"}\n`);
  process.stdout.write(`[qualify] calls=${evidence.usage?.calls ?? 0} failed=${evidence.usage?.failedCalls ?? 0} providerInputTokens=${evidence.usage?.providerInputTokens ?? "unmeasured"}\n`);
  process.stdout.write(`[qualify] verification=${evidence.summary?.verification ? (evidence.summary.verification.passed ? "PASS" : "FAIL") : "not run"} acceptance=${evidence.summary?.acceptanceVerdict ?? "not judged"}\n`);
  process.stdout.write(`[qualify] bossUntouched=${evidence.isolation.bossUntouched} ownerIntervention=${evidence.ownerInterventionRequired}\n`);
  if (evidence.error) process.stdout.write(`[qualify] error: ${evidence.error}\n`);
  process.stdout.write(`[qualify] evidence: ${path.relative(ROOT, out).split(path.sep).join("/")}\n`);
  return code;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`qualify: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
