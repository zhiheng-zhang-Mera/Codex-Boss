import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { MainCommander } from "../electron/commander/main-commander";
import { StateStore } from "../electron/store";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { Scheduler } from "../electron/commander/scheduler";
import { ContextManager } from "../electron/commander/context-manager";
import { ExecutionGate } from "../electron/commander/execution-gate";
import { TaskLedger } from "../electron/commander/task-ledger";
import { RecoveryScheduler } from "../electron/commander/recovery-scheduler";
import type { RuntimeAdapter, RuntimeAvailability, RuntimeRequest } from "../electron/runtimes/runtime";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture(accepted = "The accepted answer. END.") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-synthesis-")); dirs.push(dir);
  const file = path.join(dir, "state.json"); const store = new StateStore(file);
  const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const recovery = new RecoveryScheduler(path.join(dir, "recovery.json"));
  const createCommander = (state = store) => new MainCommander(state, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger, undefined, recovery);
  const commander = createCommander();
  const task = commander.createTask({ title: "final", objective: "Answer in English, ending with END.", providerIds: ["chatgpt"] });
  const checkpoint = store.beginDispatch(task.id, 1, ["chatgpt"]).checkpoint;
  store.markDispatchCollecting(checkpoint.id, ["chatgpt"]);
  store.captureArtifact(store.runsForTask(task.id)[0].id, accepted, "local:accepted");
  return { store, file, registry, budgets, ledger, recovery, commander, task, createCommander };
}
function runtime(id: string, execute: RuntimeAdapter["execute"], availability: () => RuntimeAvailability = () => "AVAILABLE"): RuntimeAdapter {
  return { id, kind: id === "codex:cli" ? "codex" : "web", capabilities: { roles: ["synthesis"], supportsCancellation: false, supportsStreaming: false },
    async healthCheck() { return { runtimeId: id, availability: availability(), message: "test", checkedAt: new Date().toISOString() }; }, execute };
}
it("uses only Codex accepted evidence and deduplicates concurrent finalization", async () => {
  const x = fixture(); const requests: RuntimeRequest[] = []; let webCalls = 0;
  x.registry.register(runtime("web:chatgpt", async r => { webCalls++; return { runtimeId: "web:chatgpt", jobId: r.jobId, status: "SUCCESS", content: "wrong provider" }; }));
  x.registry.register(runtime("codex:cli", async r => { requests.push(r); return { runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "Synthesized answer. END." }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  await Promise.all([x.commander.finalizeTask(x.task.id), x.commander.finalizeTask(x.task.id)]);
  expect(requests).toHaveLength(1); expect(webCalls).toBe(0);
  expect(requests[0].context).toBe(""); expect(requests[0].prompt).toContain("The accepted answer. END.");
  expect(x.store.finalResponseForTask(x.task.id)).toMatchObject({ source: "codex_synthesis", content: "Synthesized answer. END." });
  expect(x.ledger.load(x.task.id)?.usage.modelCalls).toBe(1);
});
it("retains accepted output when Codex is unavailable without substituting a web runtime", async () => {
  const x = fixture(); let calls = 0;
  x.registry.register(runtime("web:chatgpt", async r => { calls++; return { runtimeId: "web:chatgpt", jobId: r.jobId, status: "SUCCESS", content: "wrong" }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_IF_AVAILABLE");
  expect((await x.commander.finalizeTask(x.task.id))?.content).toBe("The accepted answer. END.");
  expect(calls).toBe(0);
});
it("restores required synthesis after restart and clears the waiting blocker", async () => {
  const x = fixture(); let available: RuntimeAvailability = "AUTH_REQUIRED"; let calls = 0;
  x.registry.register(runtime("codex:cli", async r => { calls++; return { runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "Recovered answer. END." }; }, () => available));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  expect(await x.commander.finalizeTask(x.task.id)).toBeUndefined();
  expect(x.store.snapshot().tasks[0].finalizationBlocker).toBeTruthy();
  const restored = new StateStore(x.file); available = "AVAILABLE";
  await x.createCommander(restored).finalizeTask(x.task.id);
  expect(restored.snapshot().tasks[0]).toMatchObject({ status: "completed", executionPhase: "COMPLETED" });
  expect(restored.snapshot().tasks[0].finalizationBlocker).toBeUndefined(); expect(calls).toBe(1);
});
it("never retries optional synthesis after publishing fallback", async () => {
  const x = fixture(); let calls = 0;
  x.registry.register(runtime("codex:cli", async r => { calls++; return { runtimeId: "codex:cli", jobId: r.jobId, status: "RETRYABLE_FAILURE", failure: { code: "RATE_LIMITED", message: "429", retryable: true, retryAt: Date.now() + 60000 } }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_IF_AVAILABLE");
  expect((await x.commander.finalizeTask(x.task.id))?.content).toBe("The accepted answer. END.");
  expect(x.recovery.list()).toHaveLength(1);
  await x.recovery.runDue(Date.now() + 120000);
  expect(calls).toBe(1); expect(x.recovery.list()).toHaveLength(0);
});
it("does not publish synthesis if the user cancels while it is running", async () => {
  const x = fixture();
  x.registry.register(runtime("codex:cli", async r => { x.store.setTaskStatus(x.task.id, "cancelled"); return { runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "late answer" }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  expect(await x.commander.finalizeTask(x.task.id)).toBeUndefined();
  expect(x.store.snapshot().tasks[0].status).toBe("cancelled");
});

it("finishes required synthesis from a scheduled recovery without another model call", async () => {
  const x = fixture(); let calls = 0;
  x.registry.register(runtime("codex:cli", async r => {
    calls++;
    return calls === 1
      ? { runtimeId: "codex:cli", jobId: r.jobId, status: "RETRYABLE_FAILURE", failure: { code: "RATE_LIMITED", message: "429", retryable: true, retryAt: Date.now() + 30 } }
      : { runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "Scheduled recovery answer. END." };
  }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  expect(await x.commander.finalizeTask(x.task.id)).toBeUndefined();
  await new Promise(resolve => setTimeout(resolve, Math.max(0, x.recovery.list()[0].retryAt - Date.now()) + 20));
  await x.recovery.runDue();
  expect(x.store.finalResponseForTask(x.task.id)?.content).toBe("Scheduled recovery answer. END.");
  expect(calls).toBe(2); expect(x.recovery.list()).toHaveLength(0);
});
it("validates a requested policy before creating any task", () => {
  const x = fixture(); const count = x.store.snapshot().tasks.length;
  expect(() => x.commander.createTask({ title: "bad", objective: "hello", providerIds: ["chatgpt"], finalizationPolicy: "INVALID" as never })).toThrow("Invalid finalization policy");
  expect(x.store.snapshot().tasks).toHaveLength(count);
  const task = x.commander.createTask({ title: "valid", objective: "hello", providerIds: ["chatgpt"], finalizationPolicy: "CODEX_REQUIRED" });
  expect(x.store.snapshot().tasks.find(item => item.id === task.id)?.finalizationPolicy).toBe("CODEX_REQUIRED");
});
it("preserves cancellation even when required synthesis fails", async () => {
  const x = fixture();
  x.registry.register(runtime("codex:cli", async r => { x.store.setTaskStatus(x.task.id, "cancelled"); return { runtimeId: "codex:cli", jobId: r.jobId, status: "PERMANENT_FAILURE", failure: { code: "AUTH_REQUIRED", message: "expired", retryable: false } }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  expect(await x.commander.finalizeTask(x.task.id)).toBeUndefined();
  expect(x.store.snapshot().tasks[0].status).toBe("cancelled");
});

it("publishes new accepted evidence after rehydration while retaining the earlier final", async () => {
  const x = fixture(); const first = await x.commander.finalizeTask(x.task.id);
  x.store.addRehydrationRound(x.task.id, new Map([["chatgpt", "supply new evidence"]]));
  expect(x.store.finalResponseForTask(x.task.id)).toBeUndefined();
  const checkpoint = x.store.beginDispatch(x.task.id, 2, ["chatgpt"]).checkpoint;
  x.store.markDispatchCollecting(checkpoint.id, ["chatgpt"]);
  const run = x.store.runsForTask(x.task.id).find(item => item.round === 2)!;
  x.store.captureArtifact(run.id, "Updated evidence. END.", "local:updated");
  const second = await x.commander.finalizeTask(x.task.id);
  expect(second?.content).toBe("Updated evidence. END."); expect(second?.id).not.toBe(first?.id);
  expect(x.store.snapshot().finalResponses).toHaveLength(2);
  expect(second?.evidenceBundleId).not.toBe(first?.evidenceBundleId);
  expect(new StateStore(x.file).finalResponseForTask(x.task.id)?.id).toBe(second?.id);
});

it("recovers synthesis completed before final publication even when Codex is now unavailable", async () => {
  const x = fixture(); let calls = 0;
  x.registry.register(runtime("codex:cli", async r => { calls++; return { runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "Durably synthesized. END." }; }));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  expect(await x.commander.synthesizeAccepted(x.task.id)).toBe("Durably synthesized. END.");
  expect(x.store.finalResponseForTask(x.task.id)).toBeUndefined();
  x.registry.unregister("codex:cli");
  const restored = new StateStore(x.file);
  expect((await x.createCommander(restored).finalizeTask(x.task.id))?.content).toBe("Durably synthesized. END.");
  expect(calls).toBe(1);
});

it("does not replace accepted structured output with synthesis that violates its contract", async () => {
  const x = fixture('{"answer": 5}');
  x.store.setReviewPolicy(x.task.id, { mode: "BALANCED", maxRetries: 0, output: { format: "json", requiredFields: ["answer"] } });
  x.registry.register(runtime("codex:cli", async r => ({ runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: "Five." })));
  x.store.setFinalizationPolicy(x.task.id, "CODEX_IF_AVAILABLE");
  expect((await x.commander.finalizeTask(x.task.id))?.content).toBe('{"answer": 5}');
});

it("allows a required retry to replace a rejected synthesis instead of caching it forever", async () => {
  const x = fixture('{"answer": 5}'); let calls = 0;
  x.store.setReviewPolicy(x.task.id, { mode: "BALANCED", maxRetries: 0, output: { format: "json", requiredFields: ["answer"] } });
  x.store.setFinalizationPolicy(x.task.id, "CODEX_REQUIRED");
  x.registry.register(runtime("codex:cli", async r => ({ runtimeId: "codex:cli", jobId: r.jobId, status: "SUCCESS", content: ++calls === 1 ? "Five." : '{"answer": 5}' })));
  expect(await x.commander.finalizeTask(x.task.id)).toBeUndefined();
  expect((await x.commander.finalizeTask(x.task.id))?.content).toBe('{"answer": 5}');
  expect(calls).toBe(2);
});
