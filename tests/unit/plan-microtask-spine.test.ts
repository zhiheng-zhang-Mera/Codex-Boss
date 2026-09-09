import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PlanRunner } from "../../electron/commander/plan-runner";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { MainCommander } from "../../electron/commander/main-commander";
import { StateStore } from "../../electron/store";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { RoleRouter } from "../../electron/commander/role-router";
import { Scheduler } from "../../electron/commander/scheduler";
import { ContextManager } from "../../electron/commander/context-manager";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { compileIntent, type TaskStep } from "../../src/shared/task-ir";

const dirs: string[] = [];
// electron-as-node's fs.rmSync cannot delete git's read-only object files
// (plain node can); clear attributes first, with retries for transient locks.
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
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-plan-micro-")); dirs.push(dir); return dir; }
const step = (id: string, kind: TaskStep["kind"], requiredFiles: string[], dependencies: string[] = []): TaskStep => ({ id, kind, description: id, dependencies, requiredFiles });

const FILES = ["alpha.cjs", "bravo.cjs", "charlie.cjs", "delta.cjs", "echo.cjs", "foxtrot.cjs", "golf.cjs"];

/**
 * AP12 in the Commander spine: a wide edit step (>6 files) executes as a
 * bounded read → propose micro-DAG per file group through the real
 * MainCommander/PlanRunner path, persists per-microtask jobs, and still emits
 * ONE canonical ProposalResult for every downstream consumer.
 */
it("decomposes a wide edit step into microtasks through the Commander spine and aggregates one ProposalResult", async () => {
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
  let codingCalls = 0;
  registry.register({ id: "local:engineering", kind: "local", capabilities: { roles: ["planning", "coding", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
    let content: string;
    if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [
      { ...step("refactor", "edit", FILES), operation: undefined },
      { ...step("verify", "verify", [...FILES, "all.test.cjs"], ["refactor"]), operation: undefined },
      step("report", "worker", [], ["verify"])
    ] });
    else if (request.role === "coding") {
      const data = JSON.parse(request.prompt);
      codingCalls++;
      // Serve one bounded proposal per chunk: every file this chunk owns keeps
      // behaviour identical (test stays green), so no repair round trips.
      content = JSON.stringify({ changes: data.files.map((file: { path: string; expectedSha256: string }) => ({ path: file.path, expectedSha256: file.expectedSha256, content: "module.exports=(x)=>{const y=x;return y;};" })), checks: [{ kind: "diff" }] });
    } else { content = "Refactor verified by host tests."; }
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  const task = commander.createTask({ title: "wide refactor", objective: goal, providerIds: ["chatgpt"] });

  expect(await commander.executePlan(task.id, dir)).toBe(true);
  // Two file groups → two coder proposals (never one monolithic proposal).
  expect(codingCalls).toBe(2);
  const jobs = ledger.load(task.id)!.jobs;
  expect(jobs.graph_refactor_microtask.state).toBe("COMPLETED");
  for (const key of ["graph_refactor_microtask_refactor_read_0", "graph_refactor_microtask_refactor_propose_0", "graph_refactor_microtask_refactor_read_1", "graph_refactor_microtask_refactor_propose_1"]) {
    expect(jobs[key]?.state).toBe("COMPLETED");
  }
  // The step-level job still carries ONE aggregate ProposalResult (JSON.parse-safe).
  const stepOutput = jobs.graph_refactor.result?.content;
  expect(() => JSON.parse(stepOutput ?? "")).not.toThrow();
  const aggregate = JSON.parse(stepOutput ?? "") as { status: string; changes: Array<{ path: string }>; repairs: number };
  expect(aggregate.status).toBe("PASS");
  expect(aggregate.changes.map((change) => change.path).sort()).toEqual([...FILES].sort());
  // Every module was refactored in the delivered workspace.
  expect(fs.readFileSync(path.join(dir, "alpha.cjs"), "utf8")).toContain("const y=x");
  // Consumers unchanged: final response + engineering summary.
  const final = store.finalResponseForTask(task.id);
  expect(final?.content).toContain("Refactor verified");
  expect(final?.content).toContain("修改文件：alpha.cjs, bravo.cjs, charlie.cjs, delta.cjs, echo.cjs, foxtrot.cjs, golf.cjs");
  expect(ledger.load(task.id)?.modifiedFiles).toContain("golf.cjs");

  // Re-run reuses persisted microtask evidence: no further coder calls.
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  expect(codingCalls).toBe(2);
}, 120000);

/** Negative regression: the historical single-step edit path (≤6 files) produces zero microtask jobs. */
it("keeps small edit steps on the exact single-step path (no microtask jobs)", async () => {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "tasks.md"), "Refactor module alpha.");
  fs.writeFileSync(path.join(dir, "alpha.cjs"), "module.exports=(x)=>x;");
  fs.writeFileSync(path.join(dir, "all.test.cjs"), "const test=require('node:test');const assert=require('node:assert/strict');test('alpha',()=>assert.equal(require('./alpha.cjs')(7),7));");
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");

  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const registry = new RuntimeRegistry();
  const budgets = new BudgetManager();
  const goal = "按照 tasks.md 重构项目并确保测试通过";
  let codingCalls = 0;
  registry.register({ id: "local:engineering", kind: "local", capabilities: { roles: ["planning", "coding", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
    let content: string;
    if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [
      { ...step("refactor", "edit", ["alpha.cjs"]), operation: undefined },
      { ...step("verify", "verify", ["alpha.cjs", "all.test.cjs"], ["refactor"]), operation: undefined },
      step("report", "worker", [], ["verify"])
    ] });
    else if (request.role === "coding") {
      const data = JSON.parse(request.prompt);
      codingCalls++;
      content = JSON.stringify({ changes: data.files.map((file: { path: string; expectedSha256: string }) => ({ path: file.path, expectedSha256: file.expectedSha256, content: "module.exports=(x)=>{const y=x;return y;};" })), checks: [{ kind: "diff" }] });
    } else content = "Small refactor verified.";
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  const task = commander.createTask({ title: "small refactor", objective: goal, providerIds: ["chatgpt"] });
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  expect(codingCalls).toBe(1);
  expect(Object.keys(ledger.load(task.id)!.jobs).some((key) => key.includes("_microtask"))).toBe(false);
  expect(ledger.load(task.id)!.jobs.graph_refactor.state).toBe("COMPLETED");
}, 120000);

/** Micro-DAG durability through the real spine: restart reuse revalidates, never re-proposes. */
it("revalidates decomposed-edit evidence across a ledger restart without re-running the coder", async () => {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "tasks.md"), "Refactor all modules.");
  for (const file of FILES) fs.writeFileSync(path.join(dir, file), "module.exports=(x)=>x;");
  const requires = FILES.map((file) => `test('${file}',()=>assert.equal(require('./${file}')(7),7));`).join("");
  fs.writeFileSync(path.join(dir, "all.test.cjs"), `const test=require('node:test');const assert=require('node:assert/strict');${requires}`);
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");

  const file = path.join(dir, ".boss", "state.json");
  const goal = "按照 tasks.md 重构项目并确保测试通过";
  const build = () => {
    const store = new StateStore(file);
    const registry = new RuntimeRegistry();
    const budgets = new BudgetManager();
    let codingCalls = 0;
    registry.register({ id: "local:engineering", kind: "local", capabilities: { roles: ["planning", "coding", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
      let content: string;
      if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [
        { ...step("refactor", "edit", FILES), operation: undefined },
        { ...step("verify", "verify", [...FILES, "all.test.cjs"], ["refactor"]), operation: undefined },
        step("report", "worker", [], ["verify"])
      ] });
      else if (request.role === "coding") {
        const data = JSON.parse(request.prompt);
        codingCalls++;
        content = JSON.stringify({ changes: data.files.map((fileEntry: { path: string; expectedSha256: string }) => ({ path: fileEntry.path, expectedSha256: fileEntry.expectedSha256, content: "module.exports=(x)=>{const y=x;return y;};" })), checks: [{ kind: "diff" }] });
      } else content = "Refactor verified.";
      return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
    } });
    const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
    const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
    return { commander, ledger, calls: () => codingCalls };
  };
  const first = build();
  const created = first.commander.createTask({ title: "restart reuse", objective: goal, providerIds: ["chatgpt"] });
  expect(await first.commander.executePlan(created.id, dir)).toBe(true);
  expect(first.calls()).toBe(2);
  // A fresh commander over the same durable state resumes: completed steps are
  // revalidated, completed microtasks are reused — no coder re-invocation.
  const second = build();
  expect(await second.commander.executePlan(created.id, dir)).toBe(true);
  expect(second.calls()).toBe(0);
}, 120000);

/** Replan after a failed wide edit purges the microtask scope (plan-runner Change B). */
it("purges a failed step's microtask scope on replan and keeps the plan runnable", async () => {
  const dir = root();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "tasks.md"), "Refactor all modules.");
  for (const file of FILES) fs.writeFileSync(path.join(dir, file), "module.exports=(x)=>x;");
  const requires = FILES.map((file) => `test('${file}',()=>assert.equal(require('./${file}')(7),7));`).join("");
  fs.writeFileSync(path.join(dir, "all.test.cjs"), `const test=require('node:test');const assert=require('node:assert/strict');${requires}`);
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");

  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const plan = compileIntent("refactor", { steps: [{ ...step("refactor", "edit", FILES), operation: undefined }, step("report", "worker", [], ["refactor"])], allowParallel: false });
  let calls = 0;
  const executor = {
    async execute(item: TaskStep) { calls++; if (item.id === "fixed") return "fixed-ok"; throw new Error("boom"); },
    async verify() { return true; },
    microtasks: {
      decompose: (item: TaskStep) => item.kind === "edit" ? FILES.map((_, i) => ({ id: `${item.id}_read_${i}`, kind: "read" as const, parentStepId: item.id, description: "read", dependencies: [] as string[], requiredFiles: [FILES[i]] })) : undefined,
      async execute() { calls++; throw new Error("micro boom"); },
      async verify() { return false; }
    }
  };
  const runner = new PlanRunner(ledger);
  const result = await runner.run("task", plan, executor, async (previous, frozen) => ({ ...previous, steps: [...frozen, step("fixed", "worker", [], [])] }));
  expect(result.status).toBe("COMPLETED");
  // The failed edit's microtask scope was purged; the retried graph has none.
  expect(Object.keys(ledger.load("task")!.jobs).some((key) => key.includes("microtask"))).toBe(false);
  expect(calls).toBeGreaterThanOrEqual(2); // the failed edit attempt + the fixed step
});
