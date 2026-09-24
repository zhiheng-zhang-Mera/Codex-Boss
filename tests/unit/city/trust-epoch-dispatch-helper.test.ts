import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Section 9 B2 — the dispatch helper cannot dispatch without an explicit confirmation.
 *
 * THE INCIDENT THIS FILE PINS
 *
 *   A helper intended as a dry run performed a REAL `workflow_dispatch` of the protected Trust Epoch Finalization
 *   workflow. Run 35961897353 was created on head_sha 8897ddc3 (the pre-PR#26 tree) while the intended run
 *   35962014554 was opened on 79af142b. The spurious run was cancelled, never approved, and preserved:
 *
 *       docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md
 *       CITY-DEBT-001
 *
 *   The ceremony's gate worked — nothing was anchored. The defect was that an action's declared intent and its
 *   effect disagreed: `--dry-run` on a helper that dispatches unconditionally is a name that overstates its safety.
 *
 * THE PROPERTIES THIS FILE PINS, as the workbook states them
 *
 *   1. no write without an explicit `--confirm`
 *   2. a true read-only / dry-run path
 *   3. the exact write is printed BEFORE confirmation
 *   4. tests prove the dry-run path cannot dispatch
 *
 * REQUIREMENT 4 IS PROVEN IN TWO INDEPENDENT WAYS, because it is the one that failed live
 *
 *   (a) BEHAVIOUR: the CLI is run as a real child process with a REAL, WORKING fake `gh` injected. The fake records
 *       every invocation to a file. After a dry run that file must not exist, and after a confirmed run it must —
 *       which proves the dry run did not reach an executor that demonstrably works.
 *   (b) STRUCTURE: the only function that runs anything is `execute`, and `execute` runs only the commands the plan
 *       carries; a plan built without `--confirm` carries none. That is asserted directly, so "the dry run happens
 *       not to dispatch" cannot be satisfied by a stub that silently swallowed the call.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/trust-epoch-dispatch.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const helper = require(path.join(PROJECT, SCRIPT)) as {
  EXIT: { OK: number; REFUSED: number; MALFORMED: number };
  OWNER_ENVIRONMENT: string;
  REQUIRED_REASON_INPUTS: string[];
  WORKFLOW_FILE: string;
  commands: () => { git: string; gh: string };
  parseArgs: (argv: string[]) => Record<string, unknown>;
  validateRequest: (request: unknown) => string[];
  plan: (request: unknown, commands?: unknown) => { dry_run: boolean; confirmed: boolean; writes: unknown[]; commands: string[][]; problems: string[]; read_only_inspection: string[] };
  dispatchCommand: (request: unknown, commands?: unknown) => string[];
  execute: (plan: unknown, runner?: (argv: string[]) => { status: number; stderr?: string }) => { executed: unknown[]; failures: unknown[]; wrote_anything: boolean };
  renderCommand: (argv: string[]) => string;
};

const request = (over: Record<string, unknown> = {}) => ({
  dryRun: false,
  confirm: false,
  repository: "zhiheng-zhang-Mera/Codex-Boss",
  workflow: helper.WORKFLOW_FILE,
  ref: "main",
  reason: null as string | null,
  risk: null as string | null,
  rollback: null as string | null,
  json: false,
  ...over,
});

const confirmed = (over: Record<string, unknown> = {}) =>
  request({ confirm: true, reason: "finalize epoch 30 after the SHA-binding repair", risk: "an incorrect epoch anchors the wrong surface", rollback: "repair forward through the governed trust-migration path", ...over });

/**
 * The fake executor, injected through the helper's own command override.
 *
 * `TRUST_EPOCH_DISPATCH_GH` is `process.execPath` and `NODE_OPTIONS` preloads the recorder, so the process the helper
 * spawns IS the recorder: it records the argv it was asked to run and exits non-zero, and the real `gh` is never
 * reached. That last part is not a detail. An earlier revision of this file injected the recorder through PATH and
 * `NODE_OPTIONS` alone; the spawned `gh` on this host is a native binary that ignores `NODE_OPTIONS`, so a "confirmed"
 * case actually dispatched the REAL protected workflow four times (runs 35965428473, 35965431153, 35965446098,
 * 35965449267 — all cancelled, recorded in the ledger and in CITY-DEBT-004). A test that can reach the real thing is
 * not a test of the fake, and this file must not be able to do it again.
 */
function withFakeGh(status: number): { log: string; env: NodeJS.ProcessEnv } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-epoch-gh-"));
  const log = path.join(dir, "invocations.log");
  const shim = path.join(PROJECT, "tests", "fixtures", "fake-gh.cjs");
  return {
    log,
    env: {
      ...process.env,
      TRUST_EPOCH_DISPATCH_GH: process.execPath,
      TRUST_EPOCH_DISPATCH_GIT: process.execPath,
      // NOT JSON.stringify: a quoted `--require` path is not resolved by Node on Windows, so the preload would
      // silently fail to load and the "confirmed run reaches the fake executor" case would reach the REAL one. That
      // is exactly the failure this fixture caused once already.
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${shim}`.trim(),
      FAKE_GH_LOG: log,
      FAKE_GH_STATUS: String(status),
    },
  };
}

/** Read the recorded invocations, or an empty list when the executor was never reached. */
function invocations(log: string): string[] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean);
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: PROJECT, encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

// =============================================================================================
// Requirement 1 and 2 — no write without --confirm, and a true read-only path
// =============================================================================================

describe("Trust epoch dispatch helper: nothing is written without --confirm", () => {
  it("the DEFAULT mode plans nothing to write, and says so", () => {
    const built = helper.plan(request());
    expect(built.confirmed, "the default mode reported itself as confirmed").toBe(false);
    expect(built.dry_run, "the default mode is not a dry run").toBe(true);
    expect(built.writes, "the default mode planned a write").toEqual([]);
    expect(built.commands, "the default mode planned a command to run").toEqual([]);
  });

  it("--dry-run is identical to the default and is still not a write", () => {
    const built = helper.plan(request({ dryRun: true }));
    expect(built.writes).toEqual([]);
    expect(built.commands).toEqual([]);
    expect(helper.plan(request({ confirm: true, reason: "r", risk: "k", rollback: "b" })).writes.length, "a confirmed run plans exactly one write").toBe(1);
  });

  it("--confirm is required to plan a write, and the plan names the ceremony it opens", () => {
    const built = helper.plan(confirmed());
    expect(built.confirmed).toBe(true);
    expect(built.dry_run, "a confirmed plan still reported itself as a dry run").toBe(false);
    expect(built.writes.length).toBe(1);
    const write = built.writes[0] as Record<string, unknown>;
    expect(write.kind).toBe("workflow_dispatch");
    expect(write.workflow).toBe(helper.WORKFLOW_FILE);
    expect(write.targets_environment, "the plan does not name the protected environment the dispatch targets").toBe(helper.OWNER_ENVIRONMENT);
    expect(String(write.approval_required_by), "the plan does not state that an Owner approval is still required").toMatch(/reviewer/);
  });

  it("a malformed request is refused with nothing planned", () => {
    for (const bad of [request({ repository: null }), request({ repository: "not-a-repo" }), request({ workflow: null }), request({ ref: null })]) {
      const problems = helper.validateRequest(bad);
      expect(problems.length, `a malformed request was accepted: ${JSON.stringify(bad)}`).toBeGreaterThan(0);
      expect(helper.plan(bad).commands).toEqual([]);
    }
  });

  it("--confirm without the reason/risk/rollback inputs is REFUSED, because the protected workflow requires them", () => {
    // The protected workflow declares all three as required inputs and records them verbatim in the proposal, the
    // epoch commit message and the uploaded evidence. A confirmation that omitted them would dispatch a run whose
    // own record is incomplete -- an approval-shaped action with no stated basis.
    expect(helper.REQUIRED_REASON_INPUTS.sort()).toEqual(["reason", "risk", "rollback"]);
    let partial = request({ confirm: true });
    for (const name of helper.REQUIRED_REASON_INPUTS) {
      const problems = helper.validateRequest(partial);
      expect(problems.join(" "), `--confirm without --${name} was accepted`).toMatch(new RegExp(`--${name}`));
      expect(helper.plan(partial).commands, `a write was planned without --${name}`).toEqual([]);
      partial = { ...partial, [name]: "provided" };
    }
    expect(helper.validateRequest(partial), "a fully-specified confirmation was refused").toEqual([]);
    expect(helper.plan(partial).commands.length).toBe(1);
  });
});

// =============================================================================================
// Requirement 4(a) — behaviour: the dry run cannot reach a WORKING executor
// =============================================================================================

describe("Trust epoch dispatch helper: the dry run cannot dispatch (real child process, real fake executor)", () => {
  it("the fake executor records a child's command — so the next cases prove something", () => {
    const fake = withFakeGh(0);
    // Armed exactly as a child of the CLI is armed: the preload, at depth 1, in a spawned process.
    const probe = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
      encoding: "utf8", timeout: 60000, env: { ...fake.env, FAKE_GH_DEPTH: "1" },
    });
    expect(probe.status, "the fake executor shim did not intercept a spawned process, so the following proofs would be vacuous").toBe(0);
    const recorded = invocations(fake.log);
    expect(recorded.length, "the shim ran but recorded nothing").toBe(1);
    // The recorder always writes a non-empty marker, so "no arguments visible at preload time" can never be mistaken
    // for "the executor was not reached" -- the distinction the whole file depends on.
    expect(recorded[0].length, "the recorder wrote an empty line, which would make 'not reached' and 'reached' indistinguishable").toBeGreaterThan(0);
    // ...and it cannot be reached from the CLI's own arm level, which is what keeps the CLI itself alive.
    const cliArm = spawnSync(process.execPath, ["-e", "process.exit(process.env.FAKE_GH_DEPTH === '1' ? 0 : 9)"], {
      encoding: "utf8", timeout: 60000, env: fake.env,
    });
    expect(cliArm.status, "the fixture re-armed at depth 0 instead of arming the next level, so the CLI would be replaced by its own recorder").toBe(0);
  });

  it("a DRY RUN exits 0, prints the exact write it would perform, and invokes no executor at all", () => {
    const fake = withFakeGh(0);
    const run = runCli(["--repository", "zhiheng-zhang-Mera/Codex-Boss", "--dry-run"], fake.env);
    expect(run.status, `a dry run must succeed: ${run.stderr}`).toBe(helper.EXIT.OK);
    expect(run.stdout, "the dry run did not say it was a dry run").toMatch(/DRY RUN/);
    expect(run.stdout, "the dry run does not name the protected environment").toContain(helper.OWNER_ENVIRONMENT);
    // Requirement 3, from the reader's side: the exact command a confirmation would execute is PRINTED. A dry run
    // that only said "ok" would leave the operator confirming something they had not been shown.
    expect(run.stdout, "the dry run does not print the exact command it would run").toMatch(/WOULD RUN:/);
    // Requirement 4(a): NOTHING was executed. The executor shim works and records; it must have no record.
    expect(invocations(fake.log), "the dry run reached an executor").toEqual([]);
  });

  it("the default mode (no flags at all) is equally inert", () => {
    const fake = withFakeGh(0);
    const run = runCli(["--repository", "zhiheng-zhang-Mera/Codex-Boss"], fake.env);
    expect(run.status, `the default invocation must succeed: ${run.stderr}`).toBe(helper.EXIT.OK);
    expect(run.stdout).toMatch(/DRY RUN/);
    expect(invocations(fake.log), "the default invocation reached an executor").toEqual([]);
  });

  it("a CONFIRMED run reaches the fake executor and NOT the real one", () => {
    const fake = withFakeGh(0);
    const run = runCli([
      "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--confirm",
      "--reason", "finalize epoch 30", "--risk", "wrong surface anchored", "--rollback", "repair forward",
    ], fake.env);
    expect(run.status, `a confirmed dispatch must succeed: ${run.stderr}`).toBe(helper.EXIT.OK);
    expect(run.stdout, "a confirmed run did not say it was confirmed").toMatch(/CONFIRMED/);
    const recorded = invocations(fake.log);
    expect(recorded.length, "the confirmed run did not reach the fake executor, so it either reached the REAL one or reached nothing").toBe(1);
    expect(recorded[0], "the confirmed run did not ask for the protected workflow").toMatch(/workflow run .*trust-epoch-finalization\.yml/);
    // The three required inputs must travel with the dispatch, or the run's own record is incomplete.
    for (const required of helper.REQUIRED_REASON_INPUTS) {
      expect(recorded[0], `the dispatch omitted the ${required} input`).toContain(`${required}=`);
    }
    // The helper's only spawn goes through the injected path, which is what made the recorded child the fake rather
    // than the real `gh`. Asserted on the SOURCE because the resolution happens in the child: the assertion below must
    // not be satisfiable by the vitest process's own environment.
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    expect(source, "the helper resolves gh from a route a test cannot override, so an injection could silently miss").toContain("process.env.TRUST_EPOCH_DISPATCH_GH");
    expect(helper.commands().gh, "the documented default is no longer the operator's own gh").toBe("gh");
  });

  it("--confirm without the required inputs dispatches NOTHING and exits non-zero", () => {
    const fake = withFakeGh(0);
    const run = runCli(["--repository", "zhiheng-zhang-Mera/Codex-Boss", "--confirm", "--reason", "only the reason"], fake.env);
    expect(run.status, "an incomplete confirmation must be refused").toBe(helper.EXIT.MALFORMED);
    expect(run.stderr, "the refusal does not name what is missing").toMatch(/--risk/);
    expect(invocations(fake.log), "an incomplete confirmation still reached the executor").toEqual([]);
  });

  it("a failing executor is reported as a failure rather than as a submitted dispatch", () => {
    const fake = withFakeGh(1);
    const run = runCli([
      "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--confirm",
      "--reason", "finalize epoch 30", "--risk", "wrong surface anchored", "--rollback", "repair forward",
    ], fake.env);
    expect(run.status, "a failed dispatch was reported as success").toBe(helper.EXIT.REFUSED);
    expect(invocations(fake.log).length, "the executor was not reached at all, so this case proves nothing").toBe(1);
  });
});

// =============================================================================================
// Requirement 4(b) — structure: only `execute` runs anything, and it runs exactly the plan
// =============================================================================================

describe("Trust epoch dispatch helper: only a plan that carries writes can execute anything", () => {
  it("`execute` on a write-free plan calls no runner and reports that it wrote nothing", () => {
    const calls: string[][] = [];
    const spy = (argv: string[]) => {
      calls.push(argv);
      return { status: 0 };
    };
    const result = helper.execute(helper.plan(request({ dryRun: true })), spy);
    expect(calls, "a write-free plan reached the runner").toEqual([]);
    expect(result.wrote_anything, "a write-free plan reported that it wrote something").toBe(false);
    expect(result.executed).toEqual([]);
  });

  it("`execute` on a confirmed plan calls the runner with exactly the planned command", () => {
    const calls: string[][] = [];
    const spy = (argv: string[]) => {
      calls.push(argv);
      return { status: 0 };
    };
    const built = helper.plan(confirmed());
    const result = helper.execute(built, spy);
    expect(result.wrote_anything).toBe(true);
    expect(calls.length, "a confirmed plan executed nothing").toBe(1);
    expect(calls[0]).toEqual(built.commands[0]);
    expect(calls[0].slice(0, 3)).toEqual([calls[0][0], "workflow", "run"]);
  });

  it("a failure from the runner is collected rather than thrown, so the caller can refuse by exit code", () => {
    const result = helper.execute(helper.plan(confirmed()), () => ({ status: 3, stderr: "boom" }));
    expect(result.failures.length).toBe(1);
    expect(result.wrote_anything).toBe(true);
  });

  it("the command is an argv ARRAY, so no shell ever re-interprets an operator-supplied reason", () => {
    // The reason text is free-form operator input, and passing it through a shell would make the governance command
    // injectable. The whole file therefore spawns argv arrays.
    //
    // The hostile text is COMMAND SUBSTITUTION plus a MARKER, so the assertion is real rather than a tautology: when
    // a shell does interpret it, the substitution runs and the marker is replaced by real output -- `id` on POSIX,
    // the echoed value plus `whoami` output on Windows cmd. `SHELL_INTERPRETED_MARKER` is the token that must survive
    // only if nothing interpreted the string.
    const marker = "SHELL_INTERPRETED_MARKER";
    const hostile = `echo ${marker} $(id) \`whoami\``;
    const shellOutput = spawnSync(hostile, { shell: true, encoding: "utf8", timeout: 60000 });
    expect(shellOutput.status, "the hostile probe could not run in a shell at all").toBe(0);
    const interpreted = String(shellOutput.stdout ?? "").trim();
    expect(interpreted, "the hostile probe did not run in a shell, so this case would not detect one").toMatch(/uid=|gid=|groups=|SHELL_INTERPRETED_MARKER/i);

    const argv = helper.dispatchCommand(confirmed({ reason: hostile }));
    expect(Array.isArray(argv), "the dispatch command is not an argv array").toBe(true);
    expect(argv, "the reason did not travel as its own argument").toContain(`reason=${hostile}`);
    // The display renderer must QUOTE the argument, so a reader cannot mistake a printed plan for a copy-pasteable
    // safe command, and it must echo the argument EXACTLY rather than something a shell re-derived from it. The
    // count is what makes that a real assertion: if the rendered line contained shell output, the hostile text would
    // appear in it twice -- once as the argument and once as the interpreter's product.
    const rendered = helper.renderCommand(argv);
    expect(rendered, "a hostile argument was rendered unquoted, so a reader could paste a command with a live substitution into a shell").toContain("reason=");
    expect(rendered, "a hostile argument was rendered unquoted").toMatch(/"/);
    expect(rendered.split(`reason=${hostile}`).length - 1, "the rendered plan shows the shell-produced text, i.e. the argument was interpreted").toBe(1);
    expect(rendered, "the rendered plan no longer contains the argument that would be passed").toContain(`reason=${hostile}`);
    // The source must not paper over this by invoking a shell.
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    expect(source, "the helper passes shell: true, so an operator-supplied argument could be interpreted").not.toMatch(/shell:\s*true/);
  });

  it("the module only spawns through one place, so 'it cannot dispatch' is a property of the file", () => {
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    const spawns = source.match(/spawnSync\(/g) ?? [];
    expect(spawns.length, `the helper spawns processes in ${spawns.length} places; one is the contract, more is a second write path`).toBe(1);
    // And that one place is the default runner, which `execute` is the only caller of.
    const executeBody = source.slice(source.indexOf("function execute("), source.indexOf("function defaultRunner("));
    expect(executeBody, "execute no longer routes through an injected runner").toContain("runner || defaultRunner");
    const dryRunBranch = source.slice(source.indexOf("if (!request.confirm)"), source.indexOf("process.stdout.write(`trust-epoch-dispatch: CONFIRMED"));
    for (const forbidden of ["execute(", "defaultRunner", "spawnSync"]) {
      expect(dryRunBranch, `the dry-run branch reaches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("--json emits the plan verbatim, so a reviewer can diff what a confirmation would do", () => {
    const run = runCli(["--repository", "zhiheng-zhang-Mera/Codex-Boss", "--dry-run", "--json"]);
    expect(run.status).toBe(helper.EXIT.OK);
    const json = run.stdout.slice(run.stdout.indexOf("{"));
    const parsed = JSON.parse(json) as { schema: string; dry_run: boolean; writes: unknown[] };
    expect(parsed.schema).toBe("city-trust-epoch-dispatch-plan/1");
    expect(parsed.dry_run).toBe(true);
    expect(parsed.writes).toEqual([]);
  });
});
