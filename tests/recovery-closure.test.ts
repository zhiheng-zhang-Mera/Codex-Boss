import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RecoveryScheduler } from "../electron/commander/recovery-scheduler";
import { WebRecovery } from "../electron/commander/web-recovery";
import { StateStore, providerSeed } from "../electron/store";
import { ProviderAutomation } from "../electron/provider-automation";
import { TaskFinalizer } from "../electron/commander/task-finalizer";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-recovery-")); dirs.push(dir); return dir; }
it("retains exhausted quotas and reset deadlines across restart", () => {
  const file = path.join(root(), "budget.json"); const budgets = new BudgetManager(file);
  budgets.observeFailure("web:test", "quota exceeded", new Date(Date.now() + 60000).toISOString());
  const restored = new BudgetManager(file); expect(restored.eligible("web:test")).toBe(false); expect(restored.get("web:test").failureCount).toBe(1);
  restored.observeSuccess("web:test"); expect(new BudgetManager(file).get("web:test").state).toBe("OK");
});
it("reconstructs a due timer and coalesces duplicate wakeups", async () => {
  const file = path.join(root(), "queue.json"); const queue = new RecoveryScheduler(file);
  queue.schedule({ id: "a", taskId: "task", kind: "test", retryAt: Date.now() - 1, payload: {} });
  const restored = new RecoveryScheduler(file); let calls = 0;
  restored.register("test", async () => { calls++; return { done: true }; });
  await Promise.all([restored.runDue(), restored.runDue()]);
  expect(calls).toBe(1); expect(new RecoveryScheduler(file).list()).toHaveLength(0);
});
it("bounds failed recovery and leaves an actionable paused record", async () => {
  const queue = new RecoveryScheduler(path.join(root(), "queue.json"));
  queue.register("test", async () => { throw new Error("offline"); });
  queue.schedule({ id: "a", taskId: "task", kind: "test", retryAt: 1, payload: {} });
  for (let i = 0; i < 4; i++) await queue.runDue(Number.MAX_SAFE_INTEGER);
  expect(queue.list()[0]).toMatchObject({ state: "PAUSED", attempts: 3 });
});
it("restores runtime WAIT and resumes the same session with no duplicate completed call", async () => {
  const dir = root(); const ledger = new TaskLedger(path.join(dir, "tasks")); const file = path.join(dir, "queue.json");
  const queue = new RecoveryScheduler(file); let calls = 0; const sessions: (string | undefined)[] = [];
  const runtime: RuntimeAdapter = { id: "api:test", kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", checkedAt: "now", message: "ok" }; }, async execute(request) { calls++; sessions.push(request.sessionId); return calls === 1 ? { runtimeId: this.id, jobId: request.jobId, status: "RETRYABLE_FAILURE", failure: { code: "RATE_LIMITED", message: "rate limited", retryable: true, retryAt: Date.now() + 20 } } : { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content: "answer" }; } };
  const request = { taskId: "task", jobId: "job", role: "coding" as const, prompt: "work", replaySafe: true };
  await new ExecutionSupervisor(ledger, undefined, undefined, queue).execute(request, [runtime]);
  expect(queue.list()).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const restored = new RecoveryScheduler(file); const supervisor = new ExecutionSupervisor(new TaskLedger(ledger.root), undefined, undefined, restored);
  restored.register("runtime", async () => ({ done: (await supervisor.execute(request, [runtime])).status === "SUCCESS" }));
  await restored.runDue(Date.now() + 5000); await supervisor.execute(request, [runtime]);
  expect(calls).toBe(2); expect(sessions[0]).toBe(sessions[1]); expect(restored.list()).toHaveLength(0);
});
it("recovers pre-send web rate limiting through real automation without duplicate send", async () => {
  const dir = root(); const store = new StateStore(path.join(dir, "state.json")); const queue = new RecoveryScheduler(path.join(dir, "queue.json"));
  const task = store.createTask("rate", "question", ["chatgpt"]); let limited = true; let sends = 0; let response = "";
  const contents = { isCrashed: () => false, async loadURL() {}, async executeJavaScript(script: string) {
    if (script.includes("const responses")) return { inputFound: true, loginLikely: false, rateLimited: limited, busy: false, latestResponse: response, sourceUrl: "https://chatgpt.com/c/test" };
    if (script.includes(".click()")) { sends++; response = "Recovered answer"; }
    return { ok: true };
  } };
  const views = { get: () => ({ webContents: contents }), open: () => ({ webContents: contents }), close() {} };
  let automation: ProviderAutomation;
  const resolve = (id: string) => providerSeed.find((item) => item.id === id)!;
  const recovery = new WebRecovery(store, views as never, () => automation, resolve, queue, new BudgetManager(path.join(dir, "budget.json")));
  const finalizer = new TaskFinalizer(store);
  automation = new ProviderAutomation(store, views as never, resolve, () => {}, { recordProbe() {} } as never, {} as never, undefined, async (id) => { await finalizer.finalize(id); }, (run, strategy, retryAt) => recovery.defer(run, strategy, retryAt));
  await automation.dispatchTask(task.id); expect(sends).toBe(0); expect(queue.list()).toHaveLength(1);
  limited = false; await queue.runDue(Date.now() + 61000); await automation.captureTask(task.id); automation.dispose();
  expect(sends).toBe(1); expect(store.snapshot().finalResponses[0]?.content).toBe("Recovered answer");
});
it("does not resend a captured-session request whose URL is uncertain", async () => {
  const dir = root(); const store = new StateStore(path.join(dir, "state.json")); const queue = new RecoveryScheduler(path.join(dir, "queue.json"));
  const task = store.createTask("test", "question", ["chatgpt"]); const run = store.runsForTask(task.id)[0];
  let sent = false; const recovery = new WebRecovery(store, {} as never, () => ({ dispatchTask() { sent = true; } }) as never, () => providerSeed[0], queue, new BudgetManager());
  recovery.defer(run, "CAPTURE_EXISTING", 1); await queue.runDue();
  expect(sent).toBe(false); expect(queue.list()[0].state).toBe("PAUSED"); expect(store.snapshot().tasks[0].recoveryMessage).toContain("人工核对");
});

it("restores the recorded conversation before reading an existing provider view", async () => {
 const dir = root(); const store = new StateStore(path.join(dir, "state.json")); const queue = new RecoveryScheduler(path.join(dir, "queue.json"));
 const task = store.createTask("restore exact conversation", "question", ["chatgpt"]); const run = store.runsForTask(task.id)[0];
 const expected = "https://chatgpt.com/c/original"; store.setRunSession(run.id, "", expected);
 let current = "https://chatgpt.com/c/unrelated"; const events: string[] = []; let sends = 0;
 const contents = { isCrashed: () => false, getURL: () => current, async loadURL(url: string) { events.push("navigate"); current = url; }, async executeJavaScript() { events.push("probe"); return { sourceUrl: current, loginLikely: false, rateLimited: false }; } };
 const views = { get: () => ({ webContents: contents }), close() {}, open: () => ({ webContents: contents }) };
 const recovery = new WebRecovery(store, views as never, () => ({ async resumePending() { events.push("capture"); }, async dispatchTask() { sends++; } }) as never, () => providerSeed[0], queue, new BudgetManager());
 recovery.defer(store.runsForTask(task.id)[0], "CAPTURE_EXISTING", 1); await queue.runDue();
 expect(events).toEqual(["navigate", "probe", "capture"]); expect(current).toBe(expected); expect(sends).toBe(0);
});
it("does not collect a different conversation after a restore redirect", async () => {
 const dir = root(); const store = new StateStore(path.join(dir, "state.json")); const queue = new RecoveryScheduler(path.join(dir, "queue.json"));
 const task = store.createTask("redirect", "question", ["chatgpt"]); const run = store.runsForTask(task.id)[0];
 store.setRunSession(run.id, "", "https://chatgpt.com/c/original"); let captures = 0;
 const contents = { isCrashed: () => false, getURL: () => "https://chatgpt.com/", async loadURL() {}, async executeJavaScript() { return { sourceUrl: "https://chatgpt.com/c/different", loginLikely: false, rateLimited: false }; } };
 const recovery = new WebRecovery(store, { get: () => ({ webContents: contents }) } as never, () => ({ async resumePending() { captures++; } }) as never, () => providerSeed[0], queue, new BudgetManager());
 recovery.defer(store.runsForTask(task.id)[0], "CAPTURE_EXISTING", 1); await queue.runDue();
 expect(captures).toBe(0); expect(queue.list()[0].state).toBe("PAUSED"); expect(store.snapshot().tasks[0].recoveryMessage).toContain("原会话");
});

it("wakes paused recovery only after explicit resume and preserves future deadlines", async () => {
 const file = path.join(root(), "queue.json"); const queue = new RecoveryScheduler(file); let calls = 0;
 queue.register("web", async () => { calls++; return { done: false, error: "login required" }; });
 queue.schedule({ id: "web:task", taskId: "task", kind: "web", retryAt: 1, payload: { strategy: "CAPTURE_EXISTING" } });
 await queue.runDue(); expect(queue.list()[0].state).toBe("PAUSED");
 await queue.runDue(); expect(calls).toBe(1);
 const restored = new RecoveryScheduler(file);
 restored.register("web", async () => { calls++; return { done: true }; });
 expect(restored.resumeTask("other")).toBe(0);
 expect(restored.resumeTask("task", 1000)).toBe(1);
 await restored.runDue(999); expect(calls).toBe(1);
 await restored.runDue(1000); expect(calls).toBe(2); expect(restored.list()).toHaveLength(0);
 const delayed = new RecoveryScheduler(file);
 delayed.register("web", async () => ({ done: false, error: "paused" }));
 delayed.schedule({ id: "later", taskId: "later", kind: "web", retryAt: 5000, payload: {} });
 await delayed.runDue(5000);
 delayed.resumeTask("later", 1000); expect(delayed.list()[0].retryAt).toBe(5000);
});
