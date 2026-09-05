import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pausedForProvider, providerStateLabel, stateForRecovery, type ProviderStateRecord } from "../src/shared/provider-state";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import { StateStore } from "../electron/store";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { Scheduler } from "../electron/commander/scheduler";
import { ContextManager } from "../electron/commander/context-manager";
import { ExecutionGate } from "../electron/commander/execution-gate";
import { MainCommander } from "../electron/commander/main-commander";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-provider-state-")); dirs.push(dir); return dir; }

describe("named provider lifecycle state", () => {
  it("classifies recovery actions into WAITING_PROVIDER vs PAUSED_PROVIDER", () => {
    for (const action of ["WAIT", "RETRY", "RECONSTRUCT", "DEFER"]) {
      const record = stateForRecovery(action, "provider not ready", 1234);
      expect(record.state).toBe("WAITING_PROVIDER");
      expect(record.autoResume).toBe(true);
      expect(record.retryAt).toBe(1234);
    }
    for (const action of ["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT"]) {
      const record = stateForRecovery(action, "login required", undefined);
      expect(record.state).toBe("PAUSED_PROVIDER");
      expect(record.autoResume).toBe(false);
      expect(record.retryAt).toBeUndefined();
    }
    expect(pausedForProvider("user cancelled").state).toBe("PAUSED_PROVIDER");
    expect(providerStateLabel("WAITING_PROVIDER")).toContain("服务商");
  });

  it("serializes into the ledger record and survives reload", () => {
    const dir = root();
    const ledger = new TaskLedger(path.join(dir, "tasks"));
    const created = ledger.create("task", "objective");
    const held: ProviderStateRecord = stateForRecovery("HUMAN_REQUIRED", "login", undefined);
    ledger.update("task", "hold", (record) => { record.providerState = held; });
    const checkpoints = path.join(dir, "tasks", "task", "checkpoints");
    const files = fs.readdirSync(checkpoints).filter((name) => name.endsWith(".json"));
    const saved = JSON.parse(fs.readFileSync(path.join(checkpoints, files[files.length - 1]), "utf8")) as TaskLedger["load"] extends (id: string) => infer R ? R : never;
    expect(saved?.providerState).toMatchObject({ state: "PAUSED_PROVIDER", autoResume: false });
    const restored = new TaskLedger(path.join(dir, "tasks")).load("task");
    expect(restored?.providerState).toEqual(held);
    expect(restored?.revision).toBe(created.revision + 1);
  });

  it("writes WAITING_PROVIDER after a retryable technical interruption", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    const fail: RuntimeAdapter = { id: "api:x", kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute: async (request) => ({ runtimeId: "api:x", jobId: request.jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "worker timed out", retryable: true, retryAt: Date.now() + 120000 } }), healthCheck: async () => ({ runtimeId: "api:x", availability: "AVAILABLE", message: "ok", checkedAt: "now" }) };
    const request = { taskId: "task", jobId: "job", role: "coding" as const, prompt: "work", replaySafe: true };
    await new ExecutionSupervisor(ledger).execute(request, [fail]);
    const record = ledger.load("task");
    expect(record?.providerState?.state).toBe("WAITING_PROVIDER");
    expect(record?.providerState?.autoResume).toBe(true);
    expect(record?.providerState?.retryAt).toBeGreaterThan(Date.now());
  });

  it("writes PAUSED_PROVIDER after a user-action interruption and clears on completion", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    let userAction = true;
    const runtime: RuntimeAdapter = { id: "api:x", kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute: async (request) => userAction ? { runtimeId: "api:x", jobId: request.jobId, status: "RETRYABLE_FAILURE", failure: { code: "USER_ACTION_REQUIRED", message: "please approve", retryable: false } } : { runtimeId: "api:x", jobId: request.jobId, status: "SUCCESS", content: "ok" }, healthCheck: async () => ({ runtimeId: "api:x", availability: "AVAILABLE", message: "ok", checkedAt: "now" }) };
    const supervisor = new ExecutionSupervisor(ledger);
    const request = { taskId: "task", jobId: "job", role: "coding" as const, prompt: "work", replaySafe: false };
    await supervisor.execute(request, [runtime]);
    expect(ledger.load("task")?.providerState?.state).toBe("PAUSED_PROVIDER");
    expect(ledger.load("task")?.providerState?.autoResume).toBe(false);
    // User approves; the same identity is allowed to complete and clears the hold.
    userAction = false;
    const approved = { taskId: "task", jobId: "job2", role: "coding" as const, prompt: "work", replaySafe: true };
    await supervisor.execute(approved, [runtime]);
    expect(ledger.load("task")?.providerState).toBeUndefined();
    expect(ledger.load("task")?.jobs["job2"]?.state).toBe("COMPLETED");
  });
});

describe("resume behavior honors named provider state", () => {
  function makeCommander(store: StateStore, ledger: TaskLedger): MainCommander {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    return new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
  }

  it("does not auto-resume a PAUSED_PROVIDER task even when no legacy hold action is set", () => {
    const dir = root();
    const store = new StateStore(path.join(dir, "state.json"));
    const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
    const commander = makeCommander(store, ledger);
    const task = commander.createTask({ title: "paused", objective: "查看网页状态 chatgpt", providerIds: ["chatgpt"] });
    // nextAction is an ordinary string (not a legacy held action); only providerState pauses it.
    ledger.update(task.id, "paused provider", (record) => { record.nextAction = "WAIT_FOR_RESPONSE"; record.providerState = pausedForProvider("provider requires login"); });
    expect(commander.canResumeTask(task.id)).toBe(false);
  });

  it("auto-resumes WAITING_PROVIDER once its retry deadline has passed", () => {
    const dir = root();
    const store = new StateStore(path.join(dir, "state.json"));
    const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
    const commander = makeCommander(store, ledger);
    const task = commander.createTask({ title: "waiting", objective: "查看网页状态 chatgpt", providerIds: ["chatgpt"] });
    ledger.update(task.id, "waiting provider", (record) => { record.nextAction = "WAIT"; record.providerState = stateForRecovery("WAIT", "quota reset", Date.now() + 60000); });
    expect(commander.canResumeTask(task.id)).toBe(false);
    ledger.update(task.id, "deadline passed", (record) => { record.providerState = stateForRecovery("WAIT", "quota reset", Date.now() - 1000); });
    expect(commander.canResumeTask(task.id)).toBe(true);
  });
});
