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
import { captureRecoveryPoint, EngineeringRecoveryLedger, recoveryLedgerFor } from "../../electron/engineering/engineering-recovery";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

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
    const dir = root();
    const { commander } = commanderFor(dir);
    const summary = await commander.runEngineeringGoal({ goal: goal(dir), workspace: dir, disableCoder: true, disableReviewer: true });
    expect(summary.terminalReason).toMatch(/^CHECKPOINT_UNAVAILABLE: /);
    expect(summary.terminalReason).toContain("not a git repository root");
  });

  it("leaves durable ledger evidence for the refusal", async () => {
    const dir = root();
    const { commander, ledger } = commanderFor(dir);
    const summary = await commander.runEngineeringGoal({ goal: goal(dir), workspace: dir, disableCoder: true, disableReviewer: true });

    const loopFile = path.join(ledger.root, "..", "engineering-loop.json");
    const loop = new EngineeringLoopStore(loopFile);
    const iterations = loop.iterations();
    expect(iterations).toHaveLength(1);
    expect(iterations[0]!.status).toBe("ABORTED");
    expect(iterations[0]!.remainingRisk).toBe(summary.terminalReason);

    const events = recoveryLedgerFor(loopFile).list();
    expect(events).toHaveLength(1);
    expect(events[0]!.code).toBe("CHECKPOINT_UNAVAILABLE");
    expect(events[0]!.recovery.attempted).toBe(false);
    expect(events[0]!.reason).toContain("not a git repository root");
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
    const dir = root();
    const attempt = await captureRecoveryPoint(dir);
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toContain("not a git repository root");
  });

  it("records a recovery point for a real repository root", async () => {
    const dir = gitWorkspace();
    const attempt = await captureRecoveryPoint(dir);
    expect(attempt.ok).toBe(true);
    expect(attempt.ok === true && attempt.checkpoint.head).toMatch(/^[0-9a-f]{40}$/);
  }, 120000);
});

describe("recovery ledger", () => {
  it("is bounded and survives corrupt content", () => {
    const dir = root();
    const file = path.join(dir, "engineering-recovery.json");
    const ledger = new EngineeringRecoveryLedger(file);
    const recovery = { attempted: false as const, code: "CHECKPOINT_UNAVAILABLE" as const, reason: "x" };
    for (let index = 0; index < 210; index++) ledger.append({ at: new Date().toISOString(), goalId: "g", code: `C${index}`, reason: "r", recovery });
    const events = ledger.list();
    expect(events.length).toBe(200);
    expect(events[events.length - 1]!.code).toBe("C209");

    fs.writeFileSync(file, "{ not json");
    expect(new EngineeringRecoveryLedger(file).list()).toEqual([]);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, events: [] }));
    expect(new EngineeringRecoveryLedger(file).list()).toEqual([]);
  });
});
