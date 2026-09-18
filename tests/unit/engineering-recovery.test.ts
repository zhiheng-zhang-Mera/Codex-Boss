import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainCommander } from "../../electron/commander/main-commander";
import { StateStore } from "../../electron/store";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { RoleRouter } from "../../electron/commander/role-router";
import { Scheduler } from "../../electron/commander/scheduler";
import { ContextManager } from "../../electron/commander/context-manager";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { EngineeringLoopStore } from "../../electron/engineering/engineering-loop-store";
import { engineeringJournalAt } from "../../electron/engineering/engineering-journal";
import {
  captureRecoveryPoint, EngineeringRecoveryError, EngineeringRecoveryLedger,
  preserveWorkspaceAfter, restoreRecoveryPoint
} from "../../electron/engineering/engineering-recovery";
import type { EngineeringGoalContract, WorkspaceRecoveryOutcome } from "../../src/shared/engineering-loop";

/**
 * The rollback outcome, with its discriminant asserted first.
 *
 * `ok` exists only on the `attempted: true` variants of `WorkspaceRecoveryOutcome`, so
 * reading it straight off the union is a type error. The fix is not a cast: this
 * narrows, and when no rollback was attempted it fails with the code and the reason —
 * which is strictly more than the assertion it replaces used to say.
 */
function attemptedRollback(recovery: WorkspaceRecoveryOutcome | undefined): Extract<WorkspaceRecoveryOutcome, { attempted: true }> {
  if (!recovery?.attempted) {
    throw new Error(`expected a rollback attempt; got ${recovery ? `${recovery.code}: ${recovery.reason}` : "no recovery at all"}`);
  }
  return recovery;
}

/**
 * Update-Plan/cleaning.md §7 — checkpoint fail-closed.
 *
 * The old `checkpointRecord(...).catch(() => undefined)` silently turned "no
 * rollback is possible" into "run anyway". These tests drive the REAL
 * MainCommander path against real directories and assert the four things the
 * plan asks for: the driver must not start, the workspace must be unchanged, the
 * terminal reason must be explicit, and the ledger must carry the evidence.
 */

const dirs: string[] = [];
function wipe(dir: string): void {
  if (!dir) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (fs.existsSync(dir)) {
        const stack = [dir];
        while (stack.length) {
          const current = stack.pop()!;
          try { fs.chmodSync(current, 0o666); } catch { /* ignore */ }
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            try { fs.chmodSync(target, 0o666); } catch { /* ignore */ }
            if (entry.isDirectory()) stack.push(target);
          }
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch { /* transient handle / antivirus; retry */ }
  }
}
afterEach(() => dirs.splice(0).forEach(wipe));
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-recovery-")); dirs.push(dir); return dir; }

function commanderFor(dir: string): { store: StateStore; ledger: TaskLedger; commander: MainCommander } {
  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const registry = new RuntimeRegistry();
  const budgets = new BudgetManager();
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  return { store, ledger, commander };
}

function goal(dir: string): Omit<EngineeringGoalContract, "schemaVersion" | "id" | "createdAt"> {
  return {
    objective: "修复 alpha.cjs 的回归（测试失败），保持质量门不变",
    workspace: dir,
    protectedProductBehavior: ["保持返回 42 的公开行为不变"],
    allowedChangeScope: ["修复", "refactor"],
    forbiddenChangeScope: ["引入新功能"],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 1 }
  };
}

function alpha(dir: string): string {
  return fs.readFileSync(path.join(dir, "alpha.cjs"), "utf8").replace(/\r/g, "");
}

function status(dir: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: dir, windowsHide: true, encoding: "utf8" }).trim();
}

/** A real git workspace (a repository root) with one tracked source file. */
function gitWorkspace(): string {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 42;\n");
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "baseline");
  return dir;
}

describe("§7 checkpoint fail-closed: no recovery point, no autonomous mutation", () => {
  it("refuses a non-git workspace before the driver starts, leaving the tree untouched", async () => {
    const dir = root();
    fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 42;\n");
    const { commander } = commanderFor(dir);
    const implement = vi.fn(async () => ({ changedFiles: ["alpha.cjs"] }));

    const summary = await commander.runEngineeringGoal({
      goal: goal(dir), workspace: dir, maxIterations: 2, disableCoder: true, disableReviewer: true,
      implement, review: async () => ({ findings: [] })
    });

    expect(summary.state).toBe("ABORTED");
    expect(summary.changedFiles).toEqual([]);
    expect(summary.recovery).toEqual({ attempted: false, code: "CHECKPOINT_UNAVAILABLE", reason: expect.any(String) });
    // The driver never started: the injected editor was never called.
    expect(implement).not.toHaveBeenCalled();
    // The workspace is byte-identical to what it was, and nothing new was written
    // into it (`.boss` is the commander's own ledger, created by the fixture).
    expect(fs.readFileSync(path.join(dir, "alpha.cjs"), "utf8")).toBe("module.exports = 42;\n");
    expect(fs.readdirSync(dir).filter((name) => name !== ".boss")).toEqual(["alpha.cjs"]);
  });

  it("the refusal is an explicit terminal reason, not a vague failure", async () => {
    // Deliberately environment-independent: whether a bare temp directory is
    // inside some repository or inside none, the refusal must still carry the
    // CHECKPOINT_UNAVAILABLE code and a real reason. The exact wording of the
    // nested-directory refusal is asserted in its own deterministic case below.
    const dir = root();
    const { commander } = commanderFor(dir);
    const summary = await commander.runEngineeringGoal({ goal: goal(dir), workspace: dir, disableCoder: true, disableReviewer: true });
    expect(summary.terminalReason).toMatch(/^CHECKPOINT_UNAVAILABLE: /);
    expect((summary.terminalReason ?? "").length).toBeGreaterThan("CHECKPOINT_UNAVAILABLE: ".length + 10);
    expect(summary.recovery?.code).toBe("CHECKPOINT_UNAVAILABLE");
  });

  it("leaves durable ledger evidence for the refusal", async () => {
    const dir = root();
    const { commander, ledger } = commanderFor(dir);
    const summary = await commander.runEngineeringGoal({ goal: goal(dir), workspace: dir, disableCoder: true, disableReviewer: true });

    const journal = engineeringJournalAt(path.join(ledger.root, ".."));
    const loopFile = journal.loopFile;
    const loop = new EngineeringLoopStore(loopFile);
    const iterations = loop.iterations();
    expect(iterations).toHaveLength(1);
    expect(iterations[0]!.status).toBe("ABORTED");
    expect(iterations[0]!.remainingRisk).toBe(summary.terminalReason);

    const events = engineeringJournalAt(path.dirname(loopFile)).recoveryLedger().list();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.code).toBe("CHECKPOINT_UNAVAILABLE");
    expect(event.recovery.attempted).toBe(false);
    // The ledger carries the same reason the run reported, so the evidence and
    // the read-model cannot drift apart.
    const reason = event.recovery.attempted ? "" : event.recovery.reason;
    expect(summary.terminalReason).toBe(`CHECKPOINT_UNAVAILABLE: ${reason}`);
    expect(iterations[0]!.remainingRisk).toBe(summary.terminalReason);
  });

  it("still refuses when the workspace does not exist at all", async () => {
    const dir = root();
    const { commander } = commanderFor(dir);
    const missing = path.join(dir, "no-such-directory");
    // A missing workspace is refused through the same terminal summary — an
    // explicit reason the UI can show, not an exception that loses the ledger.
    const summary = await commander.runEngineeringGoal({ goal: goal(missing), workspace: missing, disableCoder: true, disableReviewer: true });
    expect(summary.state).toBe("ABORTED");
    expect(summary.terminalReason).toMatch(/^CHECKPOINT_UNAVAILABLE: /);
    expect(summary.changedFiles).toEqual([]);
  });

  it("refuses a workspace that is only a subdirectory of a repository", async () => {
    // A recovery point must describe the workspace. `git` inside a nested
    // directory reports paths relative to the ENCLOSING repository, so a
    // checkpoint taken there would restore the wrong files (and would roll back
    // somebody else's repository). Fail closed.
    const repo = gitWorkspace();
    const nested = path.join(repo, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "beta.cjs"), "module.exports = 1;\n");
    const attempt = await captureRecoveryPoint(nested);
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toContain("not a git repository root");

    const { commander } = commanderFor(nested);
    const summary = await commander.runEngineeringGoal({ goal: goal(nested), workspace: nested, disableCoder: true, disableReviewer: true });
    expect(summary.state).toBe("ABORTED");
    expect(summary.terminalReason).toContain("CHECKPOINT_UNAVAILABLE");
  }, 120000);

  it("captureRecoveryPoint reports the reason instead of throwing", async () => {
    // Environment-independent: a directory with no usable recovery point must
    // produce a refusal, never a throw, whatever the ambient repository layout is.
    const dir = root();
    const attempt = await captureRecoveryPoint(dir);
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.code).toBe("CHECKPOINT_UNAVAILABLE");
    expect(attempt.ok === false && attempt.reason.length).toBeGreaterThan(10);
    // And a directory that is inside a repository but is not its root is refused
    // with the nested-directory reason specifically (deterministic fixture).
    const repo = gitWorkspace();
    const nested = path.join(repo, "sub");
    fs.mkdirSync(nested, { recursive: true });
    const nestedAttempt = await captureRecoveryPoint(nested);
    expect(nestedAttempt.ok).toBe(false);
    expect(nestedAttempt.ok === false && nestedAttempt.reason).toContain("not a git repository root");
  }, 120000);

  it("records a recovery point for a real repository root", async () => {
    const dir = gitWorkspace();
    const attempt = await captureRecoveryPoint(dir);
    expect(attempt.ok).toBe(true);
    expect(attempt.ok === true && attempt.checkpoint.head).toMatch(/^[0-9a-f]{40}$/);
  }, 120000);

  it("records a recovery point for the repository root given in another spelling", async () => {
    // The guard asks "is this workspace the repository root?", and it must answer
    // by IDENTITY. Different producers spell one directory differently — Node's
    // `fs.realpathSync` keeps a Windows 8.3 short name (`C:\Users\RUNNER~1\...`)
    // that `realpathSync.native` and `git rev-parse --show-toplevel` both expand —
    // so a string comparison would refuse a workspace that IS the root. A
    // traversal spelling exercises the same code path deterministically.
    const dir = gitWorkspace();
    const nested = path.join(dir, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    const throughTraversal = path.join(nested, "..", "..");
    const attempt = await captureRecoveryPoint(throughTraversal);
    expect(attempt.ok).toBe(true);
    expect(attempt.ok === true && attempt.checkpoint.head).toMatch(/^[0-9a-f]{40}$/);

    const upper = await captureRecoveryPoint(dir.toUpperCase());
    expect(upper.ok).toBe(true);
  }, 120000);
});

describe("§8 a driver exception rolls back and preserves both errors", () => {
  it("restores the workspace and rethrows the ORIGINAL error with the rollback outcome", async () => {
    const dir = gitWorkspace();
    const before = alpha(dir);
    const { commander, ledger } = commanderFor(dir);

    // The implementer mutates the tree and then throws — "the driver died
    // mid-change". `implement` is reached before build/test/review, so this is
    // the exception path with a real mutation behind it.
    const failure = new Error("driver exploded while implementing");
    let thrown: unknown;
    try {
      await commander.runEngineeringGoal({
        goal: goal(dir), workspace: dir, maxIterations: 2, disableCoder: true, disableReviewer: true,
        implement: async () => { fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 0;\n"); throw failure; }
      });
    } catch (error) { thrown = error; }

    expect(thrown).toBeInstanceOf(EngineeringRecoveryError);
    const recoveryError = thrown as EngineeringRecoveryError;
    // The original error is preserved, not replaced.
    expect(recoveryError.driverError).toBe(failure);
    expect(recoveryError.cause).toBe(failure);
    expect(recoveryError.message).toContain("driver exploded while implementing");
    // The rollback really ran, and its outcome travels with the error.
    expect(recoveryError.recovery.attempted).toBe(true);
    expect(attemptedRollback(recoveryError.recovery).ok).toBe(true);
    // The workspace is back to its pre-run content and git is clean.
    expect(alpha(dir)).toBe(before);
    expect(status(dir)).toBe("");

    const events = engineeringJournalAt(path.join(ledger.root, "..")).recoveryLedger().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.code).toBe("ENGINEERING_DRIVER_FAILED");
    expect(events[0]!.driverError).toBe("driver exploded while implementing");
    // The durable ledger may not be left claiming a run is still in progress.
    expect(new EngineeringLoopStore(path.join(ledger.root, "..", "engineering-loop.json")).iterations().every((item) => item.status !== "RUNNING")).toBe(true);
  }, 120000);

  it("keeps a rollback failure separate from the driver error", async () => {
    const dir = gitWorkspace();
    const before = alpha(dir);
    const { commander, ledger } = commanderFor(dir);
    const failure = new Error("driver exploded after advancing the repo");

    // A real rollback failure: the repository advances past the checkpoint while
    // the driver is running, so `rollbackToCheckpoint` refuses by design.
    let thrown: unknown;
    try {
      await commander.runEngineeringGoal({
        goal: goal(dir), workspace: dir, maxIterations: 2, disableCoder: true, disableReviewer: true,
        implement: async () => {
          fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 0;\n");
          execFileSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
          execFileSync("git", ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "--no-verify", "-m", "advanced past checkpoint"], { cwd: dir, windowsHide: true });
          throw failure;
        }
      });
    } catch (error) { thrown = error; }

    const recoveryError = thrown as EngineeringRecoveryError;
    expect(recoveryError).toBeInstanceOf(EngineeringRecoveryError);
    expect(recoveryError.driverError).toBe(failure);              // preserved
    expect(recoveryError.recovery.attempted).toBe(true);
    expect(attemptedRollback(recoveryError.recovery).ok).toBe(false);                 // kept apart
    expect(recoveryError.recovery.attempted && !recoveryError.recovery.ok && recoveryError.recovery.reason).toContain("advanced past checkpoint");
    expect(recoveryError.message).toContain("driver exploded after advancing the repo");
    expect(recoveryError.message).toContain("rollback failed");
    // The rollback refusal is why the tree still holds the change — reported, not hidden.
    expect(alpha(dir)).not.toBe(before);

    const events = engineeringJournalAt(path.join(ledger.root, "..")).recoveryLedger().list();
    expect(events[0]!.code).toBe("ENGINEERING_DRIVER_FAILED");
    expect(attemptedRollback(events[0]!.recovery).ok).toBe(false);
  }, 120000);

  it("restoreRecoveryPoint returns failures instead of throwing", async () => {
    const dir = gitWorkspace();
    const attempt = await captureRecoveryPoint(dir);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 0;\n");
    execFileSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@b.invalid", "commit", "-m", "moved on"], { cwd: dir, windowsHide: true });
    const outcome = await restoreRecoveryPoint(dir, attempt.checkpoint);
    expect(outcome.attempted).toBe(true);
    expect(attemptedRollback(outcome).ok).toBe(false);
    expect(outcome.attempted && !outcome.ok && outcome.reason).toContain("advanced past checkpoint");
  }, 120000);
});

/* -------------------------------------------------------------------------- */
/* §9 — non-converged runs roll back                                           */
/* -------------------------------------------------------------------------- */

describe("§9 one rule: CONVERGED preserves, everything else rolls back", () => {
  it("states the rule as a single predicate over every terminal state", () => {
    const states = ["ENGINEERING_CONVERGED", "OPTIONAL_IMPROVEMENTS", "STAGNANT", "ABORTED"] as const;
    expect(states.filter(preserveWorkspaceAfter)).toEqual(["ENGINEERING_CONVERGED"]);
  });

  it("ABORTED (implementer error after a real mutation) rolls the tree back", async () => {
    const dir = gitWorkspace();
    const before = alpha(dir);
    const { commander, ledger } = commanderFor(dir);
    const summary = await commander.runEngineeringGoal({
      goal: goal(dir), workspace: dir, maxIterations: 2, disableCoder: true, disableReviewer: true,
      implement: async () => {
        fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 0; // mutated\n");
        return { changedFiles: ["alpha.cjs"], error: "implementer crashed mid-change" };
      },
      review: async () => ({ findings: [], raw: "clean" })
    });
    expect(summary.state).toBe("ABORTED");
    expect(summary.changedFiles).toEqual([]);
    expect(summary.recovery?.attempted).toBe(true);
    expect(attemptedRollback(summary.recovery).ok).toBe(true);
    expect(summary.terminalReason).toContain("ABORTED");
    expect(alpha(dir)).toBe(before);
    expect(status(dir)).toBe("");
    expect(engineeringJournalAt(path.join(ledger.root, "..")).recoveryLedger().list()[0]!.code).toBe("ROLLBACK_ABORTED");
  }, 120000);

  it("CONVERGED preserves its verified changes and records the preserved checkpoint", async () => {
    // A workspace the real audited commands can satisfy, whose FIRST typecheck
    // fails with a diagnostic naming a real file and whose later ones pass. The
    // loop therefore triages a genuine HIGH finding, the injected editor's change
    // is verified by the real build/test operations, and the next clean audit
    // converges — exactly the production shape, with no operation faked.
    const dir = gitWorkspace();
    // One PASSING test file, so the `test` command succeeds identically on every
    // Node version (a runner with no test files at all is a different, and
    // version-dependent, exit).
    fs.writeFileSync(path.join(dir, "bar.test.cjs"), [
      "'use strict';",
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      "test('baseline passes', () => { assert.strictEqual(1, 1); });",
      ""
    ].join("\n"));
    execFileSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "passing baseline test"], { cwd: dir, windowsHide: true });
    const tsc = path.join(dir, "node_modules", "typescript", "bin", "tsc");
    fs.mkdirSync(path.dirname(tsc), { recursive: true });
    fs.writeFileSync(tsc, [
      "const fs = require('fs');",
      "const path = require('path');",
      "const marker = path.join(process.cwd(), '.tsc-calls');",
      "const calls = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;",
      "fs.writeFileSync(marker, String(calls + 1));",
      "if (calls === 0) { console.error('alpha.cjs(1,1): error TS9999: fixture diagnostic naming alpha.cjs'); process.exit(1); }",
      "process.exit(0);",
      ""
    ].join("\n"));
    const { commander, ledger } = commanderFor(dir);

    const summary = await commander.runEngineeringGoal({
      goal: goal(dir), workspace: dir, maxIterations: 3, disableCoder: true, disableReviewer: true,
      implement: async () => { fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 43;\n"); return { changedFiles: ["alpha.cjs"] }; }
    });

    expect(summary.state).toBe("ENGINEERING_CONVERGED");
    expect(summary.changedFiles).toContain("alpha.cjs");
    // The change is kept: CONVERGED is the one state that preserves the tree.
    expect(alpha(dir)).toContain("43");
    expect(summary.recovery).toEqual({ attempted: false, code: "CHECKPOINT_PRESERVED", reason: expect.any(String) });
    expect(summary.terminalReason).toBeUndefined();

    const journal = engineeringJournalAt(path.join(ledger.root, ".."));
    const loopFile = journal.loopFile;
    const events = engineeringJournalAt(path.dirname(loopFile)).recoveryLedger().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.code).toBe("CHECKPOINT_PRESERVED");
    expect(new EngineeringLoopStore(loopFile).iterations().at(-1)!.status).toBe("CONVERGED");
  }, 180000);

  it("STAGNANT rolls back every change the run made", async () => {
    // A workspace whose build AND tests keep failing: the audit re-finds the same
    // failures, the editor changes nothing of value, and the stagnation limit
    // trips. The run ends STAGNANT — which §9 treats exactly like ABORTED.
    const dir = gitWorkspace();
    fs.writeFileSync(path.join(dir, "foo.test.cjs"), [
      "'use strict';",
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      "test('fixture fails', () => { assert.strictEqual(1, 2); });",
      ""
    ].join("\n"));
    execFileSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
    execFileSync("git", ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "add failing test"], { cwd: dir, windowsHide: true });
    const before = alpha(dir);
    const { commander, ledger } = commanderFor(dir);

    const summary = await commander.runEngineeringGoal({
      goal: goal(dir), workspace: dir, maxIterations: 6, disableCoder: true, disableReviewer: true,
      implement: async () => {
        // A real (but useless) edit each round: the tree really changes, so the
        // rollback below has something to undo.
        fs.writeFileSync(path.join(dir, "scratch.cjs"), `module.exports = ${Date.now()};\n`);
        return { changedFiles: ["scratch.cjs"] };
      }
    });

    expect(summary.state).toBe("STAGNANT");
    expect(summary.changedFiles).toEqual([]);
    expect(summary.recovery?.attempted).toBe(true);
    expect(attemptedRollback(summary.recovery).ok).toBe(true);
    expect(summary.terminalReason).toContain("STAGNANT");
    expect(alpha(dir)).toBe(before);
    expect(fs.existsSync(path.join(dir, "scratch.cjs"))).toBe(false);
    expect(status(dir)).toBe("");
    expect(engineeringJournalAt(path.join(ledger.root, "..")).recoveryLedger().list()[0]!.code).toBe("ROLLBACK_STAGNANT");
  }, 180000);
});

describe("recovery ledger", () => {
  it("is bounded and survives corrupt content", () => {
    // The cap is injected rather than exercised at its production value. `append` rewrites the whole file,
    // so appending cap+10 events is O(cap²) file I/O: at the production cap of 200 that is 210 rewrites,
    // which took 85 s on a CI runner and exceeded vitest's 60 s per-test timeout while passing in ~18 s
    // locally. The rule being asserted is "the newest N are kept", not that N is 200, so a small cap proves
    // the same thing without the cost. The production constant is covered by the default below.
    const retention = 15;
    const dir = root();
    const file = path.join(dir, "engineering-recovery.json");
    const ledger = new EngineeringRecoveryLedger(file, retention);
    const recovery = { attempted: false as const, code: "CHECKPOINT_UNAVAILABLE" as const, reason: "x" };
    const appended = retention + 10;
    for (let index = 0; index < appended; index++) ledger.append({ at: new Date().toISOString(), goalId: "g", code: `C${index}`, reason: "r", recovery });

    const events = ledger.list();
    // Bounded: exactly the cap, not everything that was appended.
    expect(events.length).toBe(retention);
    expect(appended).toBeGreaterThan(retention);
    // And it is the NEWEST window: the oldest were dropped, the last is the last appended.
    expect(events[0]!.code).toBe(`C${appended - retention}`);
    expect(events[events.length - 1]!.code).toBe(`C${appended - 1}`);

    fs.writeFileSync(file, "{ not json");
    expect(new EngineeringRecoveryLedger(file).list()).toEqual([]);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, events: [] }));
    expect(new EngineeringRecoveryLedger(file).list()).toEqual([]);
  });

  it("defaults to the production retention cap", () => {
    // The constant itself is still asserted, so a test that injects a small cap cannot hide a change to it.
    const file = path.join(root(), "engineering-recovery.json");
    const ledger = new EngineeringRecoveryLedger(file);
    const recovery = { attempted: false as const, code: "CHECKPOINT_UNAVAILABLE" as const, reason: "x" };
    // One past what the production ledger should keep, written straight to the file so the default path is
    // read without paying 200 appends.
    const events = Array.from({ length: 260 }, (_value, index) => ({ at: new Date().toISOString(), goalId: "g", code: `C${index}`, reason: "r", recovery }));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, events }));
    ledger.append({ at: new Date().toISOString(), goalId: "g", code: "LAST", reason: "r", recovery });
    const kept = ledger.list();
    expect(kept.length).toBe(200);
    expect(kept[kept.length - 1]!.code).toBe("LAST");
    // 261 events after the append, keeping the newest 200 drops the oldest 61, so the window starts at C61.
    expect(kept[0]!.code).toBe("C61");
  });
});
