import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PlanCompiler, needsPlanning } from "../electron/commander/plan-compiler";
import { GraphDeferred } from "../electron/engineering/engineering-runtime";
import { PlanRunner } from "../electron/commander/plan-runner";
import { TaskLedger } from "../electron/commander/task-ledger";
import { MainCommander } from "../electron/commander/main-commander";
import { StateStore } from "../electron/store";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { Scheduler } from "../electron/commander/scheduler";
import { ContextManager } from "../electron/commander/context-manager";
import { ExecutionGate } from "../electron/commander/execution-gate";
import { compileIntent, type TaskStep } from "../src/shared/task-ir";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-plan-")); dirs.push(dir); return dir; }
const step = (id: string, dependencies: string[] = []): TaskStep => ({ id, kind: "worker", description: id, dependencies, requiredFiles: [] });
it("keeps ordinary requests out of the planner", async () => {
  let calls = 0; const compiler = new PlanCompiler(async () => { calls++; throw Error("unexpected"); });
  for (const text of ["hello", "summarize this", "read file README.md", "implement a parser", "解释这段代码"]) await compiler.compile(text);
  expect(calls).toBe(0); expect(needsPlanning("First compare options then summarize")).toBe(true);
});
it("automatically loads the named plan and compiles a validated graph", async () => {
  const dir = root(); fs.writeFileSync(path.join(dir, "tasks.md"), "Read a then summarize"); let prompt = "";
  const goal = "按照 tasks.md 重构项目并测试";
  const compiler = new PlanCompiler(async (input) => { prompt = input; return JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [step("a"), step("b", ["a"])] }); });
  expect((await compiler.compile(goal, dir)).estimatedComplexity).toBe("L2"); expect(prompt).toContain("Read a then summarize");
  expect(() => compiler.parse(JSON.stringify({ version: 1, goal, steps: [{ ...step("bad"), kind: "shell", operation: { kind: "exec" } }] }), goal)).toThrow();
});
it("runs safe independent workers in parallel and joins their dependency outputs", async () => {
  const dir = root(); const ledger = new TaskLedger(dir); const plan = compileIntent("parallel", { steps: [step("a"), step("b"), step("join", ["a", "b"])], allowParallel: true });
  let active = 0; let peak = 0; const order: string[] = [];
  const result = await new PlanRunner(ledger).run("task", plan, { readOnly: true, async execute(item) { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; order.push(item.id); return item.id; }, async verify() { return true; } });
  expect(result.status).toBe("COMPLETED"); expect(peak).toBe(2); expect(order.at(-1)).toBe("join");
});
it("replans failed pending work while preserving completed steps", async () => {
  const ledger = new TaskLedger(root()); const plan = compileIntent("sequential", { steps: [step("a"), step("b", ["a"])] });
  const calls: string[] = []; let replans = 0;
  const result = await new PlanRunner(ledger).run("task", plan, { async execute(item) { calls.push(item.id); return item.id; }, async verify(item) { return item.id !== "b"; } }, async (previous, frozen) => { replans++; expect(frozen.map(s => s.id)).toEqual(["a"]); return { ...previous, steps: [...frozen, step("fixed", ["a"])] }; });
  expect(result.status).toBe("COMPLETED"); expect(calls).toEqual(["a", "b", "fixed"]); expect(replans).toBe(1);
});
it("delivers a natural-language graph through Commander, ledger and FinalResponse", async () => {
  const dir = root(); const store = new StateStore(path.join(dir, "state.json")); const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
  const goal = "First derive a small fact then summarize it"; let calls = 0;
  registry.register({ id: "local:planner", kind: "local", capabilities: { roles: ["planning", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
    calls++; let content: string;
    if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [step("derive"), step("summarize", ["derive"])] });
    else { const scoped = JSON.parse(request.prompt); expect(request.context).toBe(""); if (scoped.currentStep.id === "summarize") expect(scoped.dependencyOutputs).toEqual({ derive: "fact" }); content = scoped.currentStep.id === "derive" ? "fact" : "Final integrated answer"; }
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), new TaskLedger(path.join(dir, ".boss", "tasks")));
  const task = commander.createTask({ title: "graph", objective: goal, providerIds: ["chatgpt"] });
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  expect(store.snapshot().tasks[0].plan?.estimatedComplexity).toBe("L2");
  expect(store.snapshot().finalResponses[0].content).toBe("Final integrated answer");
  await commander.executePlan(task.id, dir); expect(calls).toBe(3);
  expect(new StateStore(path.join(dir, "state.json")).snapshot().finalResponses).toHaveLength(1);
});

it("waits rather than replanning a deferred runtime and resumes its pending step", async () => {
  const ledger = new TaskLedger(root()); const plan = compileIntent("work", { steps: [step("a"), step("b", ["a"])] });
  let blocked = true; let completedCalls = 0; let replans = 0;
  const executor = { readOnly: true, async execute(item: TaskStep) { if (item.id === "a") completedCalls++; if (item.id === "b" && blocked) throw new GraphDeferred("quota wait"); return item.id; }, async verify() { return true; } };
  const runner = new PlanRunner(ledger);
  expect((await runner.run("task", plan, executor, async () => { replans++; return plan; })).status).toBe("WAITING");
  blocked = false; expect((await runner.run("task", plan, executor)).status).toBe("COMPLETED");
  expect(completedCalls).toBe(1); expect(replans).toBe(0);
});

it("executes a tasks.md refactor with real files, failed tests, repair and final delivery", async () => {
  const dir = root(); const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".boss/\n");
  fs.writeFileSync(path.join(dir, "tasks.md"), "Refactor sum.cjs while keeping addition correct and tests passing.");
  fs.writeFileSync(path.join(dir, "sum.cjs"), "module.exports=(a,b)=>a+b;");
  fs.writeFileSync(path.join(dir, "sum.test.cjs"), "const test=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(require('./sum.cjs')(2,3),5));");
  git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");
  const store = new StateStore(path.join(dir, ".boss", "state.json")); const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
  const goal = "按照 tasks.md 重构项目并确保测试通过"; let proposals = 0;
  registry.register({ id: "local:engineering", kind: "local", capabilities: { roles: ["planning", "coding", "research", "validation"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute(request) {
    let content: string;
    if (request.role === "planning") content = JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [{ ...step("refactor"), kind: "edit", requiredFiles: ["sum.cjs"] }, { ...step("verify", ["refactor"]), kind: "verify", requiredFiles: ["sum.cjs", "sum.test.cjs"] }, step("report", ["verify"])] });
    else if (request.role === "coding") { const data = JSON.parse(request.prompt); proposals++; if (proposals === 2) expect(data.failures.length).toBeGreaterThan(0); content = JSON.stringify({ changes: [{ path: "sum.cjs", expectedSha256: data.files[0].expectedSha256, content: proposals === 1 ? "module.exports=(a,b)=>a-b;" : "module.exports=(a,b)=>{const result=a+b;return result;};" }], checks: [{ kind: "diff" }] }); }
    else { expect(request.role).not.toBe("validation"); content = "Refactor verified by host tests."; }
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  const task = commander.createTask({ title: "refactor", objective: goal, providerIds: ["chatgpt"] });
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  expect(proposals).toBe(2); expect(fs.readFileSync(path.join(dir, "sum.cjs"), "utf8")).toContain("const result=a+b");
  expect(ledger.load(task.id)?.workspace?.strategy).toBe("branch");
  expect(store.finalResponseForTask(task.id)?.content).toContain("Refactor verified");
  expect(ledger.load(task.id)?.modifiedFiles).toContain("sum.cjs");
}, 30000);

it("corrects planner schema once and still rejects invalid replacement", async () => {
  const goal = "First inspect then report"; let calls = 0;
  const compiler = new PlanCompiler(async () => { calls++; return calls === 1 ? JSON.stringify({ version: 1, goal, steps: [{ ...step("read"), kind: "native", operation: { type: "read_file", path: "a.txt" } }] }) : JSON.stringify({ version: 1, goal, estimatedComplexity: "L2", steps: [step("a"), step("b", ["a"])] }); });
  expect((await compiler.compile(goal)).steps).toHaveLength(2); expect(calls).toBe(2);
  let failures = 0; const invalid = new PlanCompiler(async () => { failures++; return "not JSON"; });
  await expect(invalid.compile(goal)).rejects.toThrow(); expect(failures).toBe(2);
});
