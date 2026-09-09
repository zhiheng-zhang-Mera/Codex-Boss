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
import { NodeCapabilityRegistry } from "../../electron/node/node-capability-registry";
import { inspectDevice } from "../../electron/node/node-inspector";
import type { TaskStep } from "../../src/shared/task-ir";

/**
 * R-301 (Phase C §6.1): a single node (this device, no Fleet anywhere) must be
 * able to run a complete local task through its own capability registry /
 * worker / task / recovery loop. The same harness completes the task without
 * any Fleet concept, and the node registry reports the desktop node healthily.
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
    } catch { /* transient */ }
  }
}
afterEach(() => dirs.splice(0).forEach(wipe));
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-node-")); dirs.push(dir); return dir; }
const step = (id: string, kind: TaskStep["kind"], requiredFiles: string[], dependencies: string[] = []): TaskStep => ({ id, kind, description: id, dependencies, requiredFiles });
const FILES = ["alpha.cjs", "bravo.cjs", "charlie.cjs", "delta.cjs"];

it("R-301: a standalone node (no Fleet) completes a local engineering task end-to-end and self-reports READY", async () => {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "tasks.md"), "Refactor all modules while keeping behaviour and tests passing.");
  for (const file of FILES) fs.writeFileSync(path.join(dir, file), "module.exports=(x)=>x;");
  const requires = FILES.map((file) => `test('${file}',()=>assert.equal(require('./${file}')(7),7));`).join("");
  fs.writeFileSync(path.join(dir, "all.test.cjs"), `const test=require('node:test');const assert=require('node:assert/strict');${requires}`);
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");

  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const registry = new RuntimeRegistry();
  const budgets = new BudgetManager();
  const goal = "按照 tasks.md 重构项目并确保测试通过";
  registry.register({ id: "local:engineering", kind: "local", capabilities: { roles: ["planning", "coding", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
    let content: string;
    if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [
      { ...step("refactor", "edit", FILES), operation: undefined },
      { ...step("verify", "verify", [...FILES, "all.test.cjs"], ["refactor"]), operation: undefined },
      step("report", "worker", [], ["verify"])
    ] });
    else if (request.role === "coding") {
      const data = JSON.parse(request.prompt);
      content = JSON.stringify({ changes: data.files.map((file: { path: string; expectedSha256: string }) => ({ path: file.path, expectedSha256: file.expectedSha256, content: "module.exports=(x)=>{const y=x;return y;};" })), checks: [{ kind: "diff" }] });
    } else { content = "Refactor verified by host tests."; }
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  const task = commander.createTask({ title: "standalone node task", objective: goal, providerIds: ["chatgpt"] });

  // No Fleet exists: this single node executes its own worker/task/recovery loop.
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  const final = store.finalResponseForTask(task.id);
  expect(final?.content).toContain("Refactor verified");

  // Node self-inspection: the desktop node self-reports a usable state (READY or
  // DEGRADED with observed web-ai/compute) — never FAILED.
  const nodeRegistry = new NodeCapabilityRegistry(path.join(dir, ".boss", "nodes.json"));
  const refreshed = nodeRegistry.refresh("desktop", inspectDevice({ loggedInProviderIds: ["chatgpt"] }));
  expect(["READY", "DEGRADED"]).toContain(refreshed.state);
  expect(nodeRegistry.status("desktop")?.verdicts.find((item) => item.id === "web-ai")?.status).toBe("READY");
  expect(nodeRegistry.status("desktop")?.state).not.toBe("FAILED");
  // Nothing fleet-shaped is present: exactly one local node record.
  expect(nodeRegistry.list()).toHaveLength(1);
}, 120000);
