import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import { classifyInterruption, recoveryFor, interruptions } from "../electron/commander/interruption";
import type { RuntimeAdapter, RuntimeRequest } from "../electron/runtimes/runtime";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function ledger() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ledger-")); dirs.push(dir); return new TaskLedger(dir); }
function worker(execute: RuntimeAdapter["execute"], id = "local:test"): RuntimeAdapter { return { id, kind: "local", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; } }; }
const request: RuntimeRequest = { taskId: "task", jobId: "step", prompt: "implement", role: "coding", replaySafe: true };
describe("reliable execution", () => {
  it("classifies every interruption and bounds recovery", () => {
    for (const kind of interruptions) { expect(classifyInterruption(kind, "failure").kind).toBe(kind); expect(recoveryFor({ kind, message: "failure" }, 0).action).toBeTruthy(); }
    expect(recoveryFor({ kind: "NETWORK_FAILURE", message: "offline" }, 3).action).toBe("DEFER");
    expect(recoveryFor({ kind: "NETWORK_FAILURE", message: "offline" }, 0, true).action).toBe("VERIFY_SIDE_EFFECT");
  });
  it("survives restart without repeating completed work", async () => {
    const store = ledger(); let calls = 0;
    const runtime = worker(async (item) => { calls++; return { runtimeId: "local:test", jobId: item.jobId, status: "SUCCESS", content: "verified response" }; });
    await new ExecutionSupervisor(store).execute(request, [runtime]);
    await new ExecutionSupervisor(new TaskLedger(store.root)).execute(request, [runtime]);
    expect(calls).toBe(1); expect(store.load("task")?.usage.modelCalls).toBe(1);
    await expect(new ExecutionSupervisor(store).execute({ ...request, prompt: "different" }, [runtime])).rejects.toThrow("different input");
  });
  it("fails over only to a compatible worker and captures exceptions", async () => {
    const store = ledger();
    const broken = worker(async () => { throw new Error("network failure"); }, "local:broken");
    const good = worker(async (item) => ({ runtimeId: "local:test", jobId: item.jobId, status: "SUCCESS", content: "ok" }));
    expect((await new ExecutionSupervisor(store).execute(request, [broken, good])).status).toBe("SUCCESS");
    expect(store.load("task")?.failureHistory[0].kind).toBe("NETWORK_FAILURE");
    expect(store.load("task")?.sessions).toHaveLength(2);
  });
  it("does not retry an uncertain effect and does not run past budgets", async () => {
    const store = ledger(); let calls = 0;
    const fail = worker(async (item) => { calls++; return { runtimeId: "local:test", jobId: item.jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "timeout", retryable: true } }; });
    await new ExecutionSupervisor(store).execute({ ...request, replaySafe: false }, [fail, fail]);
    expect(calls).toBe(1); expect(store.load("task")?.nextAction).toBe("VERIFY_SIDE_EFFECT");
    store.update("task", "budget", (state) => { state.limits.modelCalls = 1; });
    await new ExecutionSupervisor(store).execute({ ...request, jobId: "other" }, [fail]); expect(calls).toBe(1);
  });
  it("rejects path traversal and corrupt newest checkpoints", () => {
    const store = ledger(); expect(() => store.create("../escape", "bad")).toThrow();
    store.create("task", "objective"); fs.writeFileSync(path.join(store.root, "task", "checkpoints", "00000001.json"), "corrupt");
    expect(() => store.load("task")).toThrow();
  });
});
