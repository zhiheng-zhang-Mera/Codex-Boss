import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { MainCommander } from "../../electron/commander/main-commander";
import { StateStore } from "../../electron/store";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { RoleRouter } from "../../electron/commander/role-router";
import { Scheduler } from "../../electron/commander/scheduler";
import { ContextManager } from "../../electron/commander/context-manager";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { TaskLedger } from "../../electron/commander/task-ledger";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

/**
 * §17 / §38 — self-iteration isolation over the REAL MainCommander
 * runEngineeringGoal path. The candidate goal is checkpointed before work; a
 * candidate-side failure (implementer mutates the tree and then reports an
 * error → ABORTED) must roll the working tree fully back — the "stable" tree is
 * never left worse, changedFiles are reported empty, and git stays clean.
 * Converged attempts keep their build/test-verified changes (driver CONVERGED).
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
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eng-rollback-")); dirs.push(dir); return dir; }

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
    objective: "修复 alpha.cjs 的回归（测试失败），保持行为与质量门不变",
    workspace: dir,
    protectedProductBehavior: ["保持返回 42 的公开行为不变"],
    allowedChangeScope: ["修复", "refactor"],
    forbiddenChangeScope: ["引入新功能"],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 1 }
  };
}

it("§38 isolation: an ABORTED candidate (mutated then errored) rolls the working tree back completely — stable tree untouched", async () => {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  const original = "module.exports = 42;\n";
  fs.writeFileSync(path.join(dir, "alpha.cjs"), original);
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "baseline");

  const { commander } = commanderFor(dir);
  // The implementer first MUTATES the stable tree, then reports an error —
  // exactly the "candidate crashed mid-change" case that must never leak.
  const summary = await commander.runEngineeringGoal({
    goal: goal(dir),
    workspace: dir,
    maxIterations: 2,
    disableCoder: true,
    disableReviewer: true,
    implement: async () => {
      fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports = 0; // candidate mutation\n");
      return { changedFiles: ["alpha.cjs"], error: "implementer crashed mid-change (candidate failure)" };
    },
    review: async () => ({ findings: [], raw: "clean" })
  });

  expect(summary.state).toBe("ABORTED");
  expect(summary.changedFiles).toEqual([]); // rollback reported — nothing leaked
  // The stable working tree is fully restored and git is clean (git may have
  // normalized line endings on checkout — compare content semantics).
  const restored = fs.readFileSync(path.join(dir, "alpha.cjs"), "utf8");
  expect(restored.replace(/\r/g, "")).toBe(original.replace(/\r/g, ""));
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: dir, windowsHide: true, encoding: "utf8" }).trim();
  expect(dirty).toBe("");
}, 120000);

it("§17 driver control: a CONVERGED goal reports its build/test-verified changes (kept, not rolled back)", async () => {
  // Driver-level control with fully injected operations: audit clean after the
  // first implement round ⇒ the goal converges and changedFiles are returned.
  const dir = root();
  const { EngineeringLoopDriver } = await import("../../electron/engineering/engineering-loop-driver");
  const { EngineeringLoopStore } = await import("../../electron/engineering/engineering-loop-store");
  const loopStore = new EngineeringLoopStore(path.join(dir, "loop.json"));
  const fullGoal: EngineeringGoalContract = { schemaVersion: 1, id: "eng-rollback-converged", createdAt: new Date().toISOString(), ...goal(dir) };
  loopStore.freezeGoal(fullGoal);
  let audits = 0;
  const driver = new EngineeringLoopDriver({
    store: loopStore,
    maxIterations: 3,
    operations: {
      audit: async () => (audits++ === 0 ? [{ id: "seed-1", area: "tests", severity: "HIGH", description: "test failure (see evidence)", evidence: "failing assertion in all.test.cjs" }] : []),
      build: async () => ({ passed: true, evidence: "typecheck PASS" }),
      test: async () => ({ passed: true, evidence: "tests PASS" }),
      implement: async () => ({ changedFiles: ["alpha.cjs"] }),
      review: async () => ({ findings: [] })
    }
  });
  const summary = await driver.run();
  expect(summary.state).toBe("ENGINEERING_CONVERGED");
  expect(summary.changedFiles).toContain("alpha.cjs"); // kept, not rolled back
});
