import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectVerificationEvidence } from "../../electron/commander/verification-collector";
import { MainCommander } from "../../electron/commander/main-commander";
import { StateStore } from "../../electron/store";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { RoleRouter } from "../../electron/commander/role-router";
import { Scheduler } from "../../electron/commander/scheduler";
import { ContextManager } from "../../electron/commander/context-manager";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { verifyResult } from "../../src/shared/result-validator";
import type { TaskStep } from "../../src/shared/task-ir";

/**
 * §20–§22 (Owner-Result.md Rev.2) runtime verification seam. A task that
 * carries a verification contract may not complete on MODEL_DONE alone: its
 * risk-gated plan must PASS with real gate evidence, else the completion point
 * parks the task (REWORK, fail-closed) and never writes a final response.
 * Absent the contract the legacy completion path is byte-identical.
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
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-verify-contract-")); dirs.push(dir); return dir; }
const step = (id: string, kind: TaskStep["kind"], requiredFiles: string[], dependencies: string[] = []): TaskStep => ({ id, kind, description: id, dependencies, requiredFiles });

const FILES = ["alpha.cjs", "bravo.cjs", "charlie.cjs", "delta.cjs"];

interface Harness {
  dir: string;
  store: StateStore;
  ledger: TaskLedger;
  commander: MainCommander;
  goal: string;
  codingCalls: () => number;
}

/** Real MainCommander + durable ledger over a git workspace with a fake coder (mirrors plan-microtask-spine). */
function makeHarness(): Harness {
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
      content = JSON.stringify({ changes: data.files.map((file: { path: string; expectedSha256: string }) => ({ path: file.path, expectedSha256: file.expectedSha256, content: "module.exports=(x)=>{const y=x;return y;};" })), checks: [{ kind: "diff" }] });
    } else { content = "Refactor verified by host tests."; }
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content };
  } });
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  return { dir, store, ledger, commander, goal, codingCalls: () => codingCalls };
}

/** Pure: executed host checks map onto the standard gate vocabulary only. */
it("collectVerificationEvidence maps executed checks to standard gates and never claims non-gates", () => {
  const edits = [{ checks: [
    { passed: true, check: { kind: "typecheck" } },
    { passed: true, check: { kind: "test" } },
    { passed: true, check: { kind: "diff" } },
    { passed: false, check: { kind: "test" } }
  ] }];
  const outputs: Record<string, string> = { verify: JSON.stringify({ status: "PASS", checks: [{ kind: "test", passed: true }, { kind: "syntax", passed: true }] }) };
  const gates = collectVerificationEvidence(edits, outputs);
  expect(gates.map((gate) => gate.gate)).toEqual(["typecheck", "unit"]);
  expect(gates.every((gate) => gate.evidence && gate.evidence.length > 0)).toBe(true);
});

/** Pure: verifyResult stays fail-closed over a contract's plan (missing gates ⇒ REWORK). */
it("verification verdict is fail-closed: incomplete evidence is REWORK, full evidence is PASS", () => {
  const partial = verifyResult({ domain: "engineering", risk: "high", results: [{ gate: "unit", evidence: "test PASS" }] });
  expect(partial.verdict).toBe("REWORK");
  expect(partial.missing).toContain("typecheck");
  expect(partial.missing).toContain("build");
  expect(partial.missing).toContain("integration");
  const none = verifyResult({ domain: "engineering", risk: "high", results: [] });
  expect(none.verdict).toBe("REWORK");
  expect(none.missing).toEqual(["typecheck", "build", "unit", "integration"]);
  const full = verifyResult({ domain: "engineering", risk: "low", results: [
    { gate: "typecheck", evidence: "typecheck PASS" },
    { gate: "unit", evidence: "test PASS" }
  ] });
  expect(full.verdict).toBe("PASS");
  expect(full.missing).toEqual([]);
});

/** Integration: high-risk engineering contract whose plan only executed the unit gate ⇒ parked, never completed. */
it("runtime gate: high-risk verification contract with missing gates parks the task (no fake completion)", async () => {
  const { dir, store, ledger, commander, goal } = makeHarness();
  const task = commander.createTask({ title: "wide refactor (verified)", objective: goal, providerIds: ["chatgpt"], verification: { domain: "engineering", risk: "high" } });
  expect(await commander.executePlan(task.id, dir)).toBe(true);

  // MODEL_DONE did not become a final: the task is parked waiting with the
  // missing gates recorded, and no final response exists.
  expect(store.finalResponseForTask(task.id)).toBeUndefined();
  const current = store.snapshot().tasks.find((item) => item.id === task.id)!;
  expect(current.status).toBe("waiting");
  expect(current.recoveryMessage ?? "").toContain("typecheck");
  expect(current.recoveryMessage ?? "").toContain("build");
  expect(current.recoveryMessage ?? "").toContain("integration");
  expect(current.verificationVerdict?.verdict).toBe("REWORK");
  expect(current.verificationEvidence?.map((gate) => gate.gate)).toEqual(["unit"]);
  const state = ledger.load(task.id)!;
  expect(state.verificationState).toBe("FAILED");
  expect(state.nextAction).toBe("REPAIR_OR_REPLAN");
}, 120000);

/** Control: without a verification contract the same completion path finalizes exactly as before. */
it("runtime gate is inert without a verification contract (legacy completion preserved)", async () => {
  const { dir, store, commander, goal } = makeHarness();
  const task = commander.createTask({ title: "wide refactor (legacy)", objective: goal, providerIds: ["chatgpt"] });
  expect(await commander.executePlan(task.id, dir)).toBe(true);
  const final = store.finalResponseForTask(task.id);
  expect(final?.content).toContain("Refactor verified");
  expect(final?.content).toContain("修改文件：alpha.cjs, bravo.cjs, charlie.cjs, delta.cjs");
}, 120000);
