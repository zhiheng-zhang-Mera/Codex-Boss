#!/usr/bin/env node
/**
 * Trust epoch finalization — the DISPATCH AND APPROVAL HELPER.
 *
 * Read together with `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §9 B2, which states the four properties
 * this file must have: no write without an explicit confirmation, a true read-only path, the exact write printed
 * before confirmation, and tests proving the read-only path cannot dispatch.
 *
 * WHAT THIS FILE EXISTS FOR
 *
 *   A helper intended as a dry run once performed a REAL `workflow_dispatch` of the protected Trust Epoch
 *   Finalization workflow. The consequence is preserved as an incident and a debt, not explained away:
 *
 *       docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md
 *       CITY-DEBT-001
 *       spurious run 35961897353 on head_sha 8897ddc3 (pre-PR#26), waiting on boss-root-trust-owner, cancelled
 *       intended run 35962014554 on head_sha 79af142b, approved and completed
 *
 *   The defect was not in the ceremony: the environment gate worked and nothing was anchored. It was a mismatch
 *   between an action's DECLARED INTENT and its EFFECT. `--dry-run` on a helper that dispatches unconditionally is
 *   a name that overstates its safety.
 *
 * THE RULE THIS PROGRAM IMPLEMENTS
 *
 *   NOTHING IS WRITTEN WITHOUT `--confirm`. Ever. There is no other write path, no implicit one, and no default
 *   that writes. The default mode is a true read-only plan:
 *
 *       node scripts/trust-epoch-dispatch.cjs                 # plan only: prints what WOULD be executed, executes nothing
 *       node scripts/trust-epoch-dispatch.cjs --dry-run       # identical, named explicitly
 *       node scripts/trust-epoch-dispatch.cjs --confirm --reason ... --risk ... --rollback ...
 *
 *   `--confirm` without `--reason`, `--risk` and `--rollback` is refused, because the protected workflow requires
 *   all three as dispatch inputs and records them verbatim in the proposal, the epoch commit message and the
 *   uploaded evidence. A confirmation that omitted them would dispatch a run whose own record is incomplete.
 *
 * WHY A PLAN OBJECT RATHER THAN A BARE SPAWN
 *
 *   The write is a DATA STRUCTURE (`plan()` -> `{ writes, commands }`) and the only function that touches a process
 *   is `execute(plan, runner)`. That makes the safety property testable without a network, a runner or a
 *   credential: a dry run is exactly "plan, render, exit" and never reaches `execute`. The tests prove both halves —
 *   that the module cannot execute without being asked, and that the CLI's dry-run path cannot reach the executor
 *   even with a real `gh` on PATH.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not approve an environment. Approving the `boss-root-trust-owner` deployment is the external Owner
 *   authorisation itself, and it is performed as a deliberate, single, reviewable API call with a comment naming
 *   the run, the SHA and the authorising clause — never as a batched or implicit side effect of "checking on" a
 *   run. It also holds no credential of its own: it shells out to the already-authenticated `gh` client, exactly
 *   like every other operator command in this repository.
 */

"use strict";

const { spawnSync } = require("node:child_process");

const PROJECT = `${__dirname}/..`;
const WORKFLOW_FILE = ".github/workflows/trust-epoch-finalization.yml";
const WORKFLOW_NAME = "Trust Epoch Finalization";

/** The protected environment the finalization job targets. Named here so a plan can be read without the YAML. */
const OWNER_ENVIRONMENT = "boss-root-trust-owner";

/** Exit codes. 0 = the plan was produced / the read succeeded. 1 = refusal. 2 = the request itself was malformed. */
const EXIT = { OK: 0, REFUSED: 1, MALFORMED: 2 };

/** The dispatch inputs the protected workflow declares as required, and what --confirm must therefore supply. */
const REQUIRED_REASON_INPUTS = ["reason", "risk", "rollback"];

/**
 * The commands this program may run, resolved late so a test can point them at a stub without touching PATH.
 * The overrides exist for testability only; they are not a supported operator interface and are not documented as
 * one, because an env var that could redirect a governance command is itself a surface worth keeping small.
 */
function commands() {
  return {
    git: process.env.TRUST_EPOCH_DISPATCH_GIT || "git",
    gh: process.env.TRUST_EPOCH_DISPATCH_GH || "gh",
  };
}

/* -------------------------------------------------------------------------- */
/* The request                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse and validate the request. This is the ONLY place arguments become decisions, and it decides nothing that
 * the caller did not state.
 */
function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  const request = {
    // `--dry-run` is the NAMED form of the default. It is not a switch that changes behaviour -- it can only ever
    // agree with the default -- which is deliberate: a mode that exists to be declared can be asserted in a test,
    // while "the absence of --confirm" cannot be named in a log by a reader who has not read this file.
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
    repository: value("--repository"),
    workflow: value("--workflow") || WORKFLOW_FILE,
    ref: value("--ref") || "main",
    reason: value("--reason"),
    risk: value("--risk"),
    rollback: value("--rollback"),
    json: argv.includes("--json"),
  };
  return request;
}

/**
 * Refuse a malformed or incomplete request. Returns a list of problems; an empty list means the request may be
 * planned. It NEVER returns a list that only says "fine" -- the caller prints every problem.
 */
function validateRequest(request) {
  const problems = [];
  if (!request || typeof request !== "object") return ["the request is not an object"];
  if (!request.repository || !/^[^/\s]+\/[^/\s]+$/.test(String(request.repository))) {
    problems.push("--repository owner/name is required");
  }
  if (!request.workflow || typeof request.workflow !== "string") problems.push("--workflow is required");
  if (!request.ref || typeof request.ref !== "string") problems.push("--ref is required");
  // THE WORKFLOW'S OWN GUARD, ENFORCED IN THE HELPER. The finalization workflow's first step refuses any ref but main
  // (TRUST_EPOCH_FINALIZATION_REQUIRES_MAIN), so a dispatch on a branch can only produce a failed run and an
  // unaccounted dispatch. That happened on run 36125878796 (ledger CC-045): this helper planned and executed a
  // dispatch the workflow was always going to refuse, because it validates the SHAPE of a request and not the policy
  // of the workflow it names. That is the same class as the original spurious dispatch -- an action whose declared
  // intent and its effect disagree -- so the rule belongs here, not in a runbook.
  if (request.workflow === WORKFLOW_FILE && request.ref !== "main") {
    problems.push(
      `--ref ${JSON.stringify(request.ref)} is refused: ${WORKFLOW_FILE} refuses any ref but main, so this dispatch could only fail; a surface-moving change is anchored by running scripts/acceptance-evolution-bless.cjs --advance in the SAME commit, and the workflow is for a surface a later commit already moved onto main`,
    );
  }
  if (request.confirm) {
    for (const name of REQUIRED_REASON_INPUTS) {
      if (!request[name] || String(request[name]).trim() === "") {
        problems.push(`--confirm requires --${name}: the protected workflow declares it as a required input and records it verbatim`);
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

/** The dispatch command, as an argv array. No shell, so nothing here can be re-interpreted by one. */
function dispatchCommand(request, commandsOverride) {
  const { gh } = commandsOverride || commands();
  return [
    gh, "workflow", "run", request.workflow,
    "--repo", request.repository,
    "--ref", request.ref,
    "-f", `reason=${request.reason ?? ""}`,
    "-f", `risk=${request.risk ?? ""}`,
    "-f", `rollback=${request.rollback ?? ""}`,
  ];
}

/** The read-only command a plan may be built from: what is already waiting on the protected environment. */
function pendingDeploymentsCommand(request, commandsOverride) {
  const { gh } = commandsOverride || commands();
  return [gh, "api", `repos/${request.repository}/actions/runs?event=workflow_dispatch&per_page=20`];
}

/**
 * Build the plan.
 *
 * PURE: it reads nothing, runs nothing, and returns what a confirmed run WOULD execute alongside the commands a
 * confirmed run WOULD run. The distinction between `commands` and `preview_commands` is the safety property, and it
 * is deliberate rather than incidental:
 *
 *   - `commands` is what `execute` runs, and it is EMPTY unless `--confirm` was given. A plan with no commands cannot
 *     dispatch, whatever the caller does with it.
 *   - `preview_commands` is the exact argv a confirmation would produce. It is populated in every mode, so a dry run
 *     can PRINT the write it would perform, as the workbook requires
 *     (`docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §9 B2), without that print ever being runnable.
 *
 * The required dispatch inputs are shown as placeholders when they have not been supplied, because the point of a
 * preview is the shape of the command, not a promise that an incomplete request would be accepted -- and an
 * incomplete request is refused by `validateRequest` before anything is planned.
 */
function plan(request, commandsOverride) {
  const problems = validateRequest(request);
  const writes = [];
  const planned = [];

  // What a confirmation WOULD do, regardless of whether this request is one. A missing input is shown as a
  // placeholder rather than omitted, so the printed plan has the same argv shape a real dispatch would have.
  const wouldDispatch = {
    ...request,
    reason: request.reason || "<reason>",
    risk: request.risk || "<risk>",
    rollback: request.rollback || "<rollback>",
  };
  const preview = [dispatchCommand(wouldDispatch, commandsOverride)];

  if (request.confirm && problems.length === 0) {
    writes.push({
      kind: "workflow_dispatch",
      workflow: request.workflow,
      repository: request.repository,
      ref: request.ref,
      inputs: {
        reason: request.reason,
        risk: request.risk,
        rollback: request.rollback,
      },
      // Stated so a reader can see the ceremony the dispatch will open, not merely that "a run" starts.
      targets_environment: OWNER_ENVIRONMENT,
      approval_required_by: "the named reviewer of boss-root-trust-owner",
      note: "the run does not start until that reviewer approves it; this command only opens it",
    });
    planned.push(dispatchCommand(request, commandsOverride));
  }

  return {
    schema: "city-trust-epoch-dispatch-plan/1",
    dry_run: !request.confirm,
    confirmed: Boolean(request.confirm),
    writes,
    // The commands a confirmed run WOULD run. Empty unless confirmed: `execute` reads only this field.
    commands: planned,
    // The commands are shown in every mode; they are never run from here.
    preview_commands: preview,
    problems,
    // The read-only inspection any caller may run at any time, listed so the plan states how a human should check
    // the result rather than leaving it to memory.
    read_only_inspection: pendingDeploymentsCommand(request, commandsOverride),
  };
}

/** Render one argv array for display. Display only -- execution never goes through a shell. */
function renderCommand(argv) {
  return argv
    .map((part) => (/^[A-Za-z0-9_./=:@-]+$/.test(String(part)) ? String(part) : JSON.stringify(String(part))))
    .join(" ");
}

/**
 * Execute a plan. THE ONLY PATH THAT RUNS ANYTHING.
 *
 * A plan with no writes executes nothing: there is no fallback that "does the dispatch anyway", because that
 * fallback is precisely the defect this file was written to close.
 */
function execute(planValue, runner) {
  if (!planValue || typeof planValue !== "object") throw new Error("execute: a plan is required");
  if (!Array.isArray(planValue.commands) || planValue.commands.length === 0) {
    return { executed: [], failures: [], wrote_anything: false };
  }
  const run = runner || defaultRunner;
  const executed = [];
  const failures = [];
  for (const argv of planValue.commands) {
    const result = run(argv);
    const status = result && typeof result.status === "number" ? result.status : 1;
    executed.push({ command: argv, status });
    if (status !== 0) failures.push({ command: argv, status, stderr: (result && result.stderr) || "" });
  }
  return { executed, failures, wrote_anything: executed.length > 0 };
}

function defaultRunner(argv) {
  return spawnSync(argv[0], argv.slice(1), { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
}

/* -------------------------------------------------------------------------- */
/* The command line                                                            */
/* -------------------------------------------------------------------------- */

function main(argv) {
  const request = parseArgs(argv);
  const built = plan(request);

  if (built.problems.length > 0) {
    process.stderr.write(`${built.problems.map((problem) => `trust-epoch-dispatch: ${problem}`).join("\n")}\n`);
    process.stderr.write("trust-epoch-dispatch: refused; nothing was written\n");
    return EXIT.MALFORMED;
  }

  if (!request.confirm) {
    // THE READ-ONLY PATH. It prints exactly what a confirmed run WOULD execute and returns without running it.
    process.stdout.write(`trust-epoch-dispatch: DRY RUN. Nothing below is executed.\n`);
    process.stdout.write(`trust-epoch-dispatch: repository ${request.repository}, workflow ${request.workflow}, ref ${request.ref}\n`);
    process.stdout.write(`trust-epoch-dispatch: target environment ${OWNER_ENVIRONMENT} (approval by its named reviewer is still required after dispatch)\n`);
    if (built.commands.length === 0) {
      process.stdout.write(`trust-epoch-dispatch: no dispatch is planned without --confirm, so there is nothing to execute.\n`);
    }
    for (const command of built.preview_commands) {
      process.stdout.write(`trust-epoch-dispatch: WOULD RUN with --confirm --reason <...> --risk <...> --rollback <...>:\n`);
      process.stdout.write(`  WOULD RUN: ${renderCommand(command)}\n`);
    }
    process.stdout.write(`trust-epoch-dispatch: to inspect the protected environment without writing: ${renderCommand(built.read_only_inspection)}\n`);
    process.stdout.write(`trust-epoch-dispatch: re-run with --confirm --reason <...> --risk <...> --rollback <...> to perform the dispatch.\n`);
    if (request.json) process.stdout.write(`${JSON.stringify(built, null, 2)}\n`);
    return EXIT.OK;
  }

  process.stdout.write(`trust-epoch-dispatch: CONFIRMED. Executing ${built.commands.length} write(s).\n`);
  for (const command of built.commands) process.stdout.write(`  RUNNING: ${renderCommand(command)}\n`);
  if (request.json) process.stdout.write(`${JSON.stringify(built, null, 2)}\n`);

  const result = execute(built);
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      process.stderr.write(`trust-epoch-dispatch: the command failed with status ${failure.status}: ${renderCommand(failure.command)}\n${failure.stderr}\n`);
    }
    return EXIT.REFUSED;
  }
  process.stdout.write(`trust-epoch-dispatch: the dispatch was submitted. The run is now waiting on ${OWNER_ENVIRONMENT}.\n`);
  return EXIT.OK;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`trust-epoch-dispatch failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = EXIT.REFUSED;
  }
}

module.exports = {
  EXIT,
  OWNER_ENVIRONMENT,
  REQUIRED_REASON_INPUTS,
  WORKFLOW_FILE,
  WORKFLOW_NAME,
  commands,
  defaultRunner,
  dispatchCommand,
  execute,
  main,
  parseArgs,
  pendingDeploymentsCommand,
  plan,
  renderCommand,
  validateRequest,
};
