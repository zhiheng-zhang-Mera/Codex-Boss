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
import { validId } from "../../electron/commander/durable-json";
import { engineeringSessionId, type EngineeringSessionKey } from "../../electron/engineering/engineering-session";
import { createLiveEngineeringOperations } from "../../electron/engineering/live-engineering-operations";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

/**
 * Update-Plan/cleaning.md §10 — finding-level session isolation.
 *
 * Three layers are asserted, none of them mocked away:
 *   1. the key function itself (all three parts, ledger-validity, no collisions);
 *   2. the production wiring — the live coder/reviewer operations really hand the
 *      goal + finding to the worker, for the real ProposalRunner;
 *   3. the command path — a real run dispatches under the id the key function
 *      computes.
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
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-session-")); dirs.push(dir); return dir; }

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

function gitWorkspace(): string {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 42;\n");
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "baseline");
  return dir;
}

describe("§10 the session key", () => {
  it("spells out goal, finding and role for a clean key", () => {
    expect(engineeringSessionId("eng-abc123", "finding-1", "coder")).toBe("eng-eng-abc123-finding-1-coder");
    expect(engineeringSessionId("eng-abc123", "finding-1", "reviewer")).toBe("eng-eng-abc123-finding-1-reviewer");
  });

  it("keeps a lossy (sanitized) key readable but distinct", () => {
    const lossy = engineeringSessionId("eng-abc123", "command:typecheck", "coder");
    expect(lossy).toMatch(/^eng-eng-abc123-command-typecheck-[0-9a-f]{12}-coder$/);
    // The real audit uses `command:typecheck`, so this is the id production sees.
    expect(lossy).not.toBe(engineeringSessionId("eng-abc123", "command-typecheck", "coder"));
  });

  it("is a valid ledger identity for every shape it can meet", () => {
    const keys: Array<[string, string, "coder" | "reviewer"]> = [
      ["eng-abc123", "command:typecheck", "coder"],
      ["eng-abc123", "review:command:typecheck:1a2b3c", "reviewer"],
      ["eng-9f8e7d", "command:test", "coder"],
      ["goal with spaces", "finding/with/slashes", "coder"],
      ["✓✓✓", "：：：", "reviewer"]
    ];
    for (const [goalId, findingId, role] of keys) {
      const id = engineeringSessionId(goalId, findingId, role);
      expect(() => validId(id)).not.toThrow();
      expect(id.endsWith(`-${role}`)).toBe(true);
    }
  });

  it("gives the same finding the same session and a different finding its own", () => {
    const goalId = "eng-abc123";
    const first = engineeringSessionId(goalId, "command:typecheck", "coder");
    expect(engineeringSessionId(goalId, "command:typecheck", "coder")).toBe(first);   // retry reuses the session
    const second = engineeringSessionId(goalId, "command:test", "coder");
    expect(second).not.toBe(first);                                                    // different finding
    expect(engineeringSessionId(goalId, "command:typecheck", "reviewer")).not.toBe(first); // different role
    expect(engineeringSessionId("eng-other", "command:typecheck", "coder")).not.toBe(first); // different goal
  });

  it("never collides two long keys onto one session", () => {
    const long = "f".repeat(400);
    const a = engineeringSessionId("g".repeat(200), `${long}a`, "coder");
    const b = engineeringSessionId("g".repeat(200), `${long}b`, "coder");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(() => validId(a)).not.toThrow();
    expect(() => validId(b)).not.toThrow();
    expect(a.endsWith("-coder")).toBe(true);
  });

  it("does not let sanitizing collapse two different findings", () => {
    expect(engineeringSessionId("g", "command:typecheck", "coder")).not.toBe(engineeringSessionId("g", "command-typecheck", "coder"));
  });
});

describe("§10 the live operations hand the goal and the finding to the worker", () => {
  it("asks the coder for the exact finding under review, and the reviewer for its own", async () => {
    const dir = gitWorkspace();
    const goalContract: EngineeringGoalContract = { schemaVersion: 1, id: "eng-session-1", createdAt: new Date().toISOString(), ...goal(dir) };
    const calls: Array<{ role: string; session: EngineeringSessionKey }> = [];
    const worker = {
      ask: vi.fn(async (role: "coder" | "reviewer", _prompt: string, session: EngineeringSessionKey) => {
        calls.push({ role, session });
        // The coder's answer is deliberately unusable, so ProposalRunner stops
        // after asking: the point here is WHICH session was asked, not the patch.
        throw new Error("no coder runtime in this fixture");
      })
    };
    const live = createLiveEngineeringOperations({ workspace: dir, goal: goalContract, worker });

    const findingA = { id: "command:typecheck", area: "build", severity: "HIGH" as const, description: "typecheck failure in alpha.cjs", evidence: "alpha.cjs(1,1): error TS9999" };
    const outcome = await live.implement(goalContract, findingA);
    expect(outcome.error).toContain("live coder failed");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.role).toBe("coder");
    expect(calls[0]!.session).toEqual({ goalId: "eng-session-1", findingId: "command:typecheck" });

    const findingB = { id: "command:test", area: "tests", severity: "HIGH" as const, description: "test failure (see evidence)", evidence: "alpha.cjs failing" };
    await live.review(goalContract, findingB, ["alpha.cjs"], { buildPassed: true, testsPassed: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.role).toBe("reviewer");
    expect(calls[1]!.session).toEqual({ goalId: "eng-session-1", findingId: "command:test" });

    // The two turns cannot share a provider session.
    const ids = calls.map((call) => engineeringSessionId(call.session.goalId, call.session.findingId, call.role as "coder" | "reviewer"));
    expect(new Set(ids).size).toBe(2);
  }, 120000);
});

describe("§10 the real command path dispatches under the computed session id", () => {
  it("uses engineeringSessionId(goalId, findingId, coder) for a live goal run", async () => {
    const dir = gitWorkspace();
    // The first real typecheck fails with a diagnostic naming a real file, so the
    // audit triages a genuine finding and the live coder path is entered.
    const tsc = path.join(dir, "node_modules", "typescript", "bin", "tsc");
    fs.mkdirSync(path.dirname(tsc), { recursive: true });
    fs.writeFileSync(tsc, "console.error('alpha.cjs(1,1): error TS9999: fixture diagnostic naming alpha.cjs'); process.exit(1);\n");

    const { commander } = commanderFor(dir);
    const dispatched: string[] = [];
    const spy = vi.spyOn(commander, "dispatchRole").mockImplementation(async (taskId: string) => {
      dispatched.push(taskId);
      // No runtime is available in this fixture; the run must abort honestly.
      return { status: "FAILURE", runtimeId: "none", failure: { message: "no runtime in fixture" } } as never;
    });

    const summary = await commander.runEngineeringGoal({ goal: goal(dir), workspace: dir, maxIterations: 1 });
    spy.mockRestore();

    // `runEngineeringGoal` derives the goal id exactly this way (see main-commander).
    const goalId = `eng-${TaskLedger.fingerprint(goal(dir).objective).slice(0, 12)}`;
    const expected = engineeringSessionId(goalId, "command:typecheck", "coder");
    expect(summary.state).toBe("ABORTED");
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0]).toBe(expected);
    // Every dispatch of one finding reuses exactly one id (no per-attempt drift).
    expect(new Set(dispatched).size).toBe(1);
    // The reviewer never shares the coder's id.
    expect(dispatched[0]!.endsWith("-coder")).toBe(true);
  }, 180000);
});
