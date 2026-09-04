import { describe, expect, it } from "vitest";
import { Scheduler } from "../electron/commander/scheduler";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../electron/runtimes/runtime";

const request = (jobId: string): RuntimeRequest => ({ jobId, taskId: "task", role: "coding", prompt: "work" });
function adapter(id: string, execute: (request: RuntimeRequest) => Promise<RuntimeResult>): RuntimeAdapter { return { id, kind: "local", capabilities: { roles: ["coding"], supportsCancellation: false, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }; }, execute }; }
const policy = { maxParallel: 3, timeoutMs: 1000, maxRetries: 0, allowFallback: true, requireAll: true };

describe("Scheduler", () => {
  it("isolates budget exhaustion and falls back", async () => {
    const exhausted = adapter("codex:cli", async (item) => ({ runtimeId: "codex:cli", jobId: item.jobId, status: "RETRYABLE_FAILURE", failure: { code: "BUDGET_EXHAUSTED", message: "quota exhausted", retryable: true } }));
    const web = adapter("web:chatgpt", async (item) => ({ runtimeId: "web:chatgpt", jobId: item.jobId, status: "SUCCESS", content: "ok" }));
    const result = await new Scheduler().dispatch({ request: request("fallback"), candidates: [exhausted, web] }, policy);
    expect(result).toMatchObject({ runtimeId: "web:chatgpt", status: "SUCCESS" });
  });

  it("collects jobs concurrently and preserves the commit barrier", async () => {
    let active = 0; let peak = 0;
    const slow = adapter("local:test", async (item) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 40)); active -= 1; return { runtimeId: "local:test", jobId: item.jobId, status: "SUCCESS" }; });
    const scheduler = new Scheduler();
    const batch = await scheduler.runBatch([1, 2, 3].map((id) => ({ request: request(String(id)), candidates: [slow] })), policy);
    expect(peak).toBe(3);
    expect(batch).toMatchObject({ successCount: 3, state: "READY_TO_COMMIT" });
    const failing = adapter("local:fail", async (item) => ({ runtimeId: "local:fail", jobId: item.jobId, status: "PERMANENT_FAILURE", failure: { code: "DOWN", message: "down", retryable: false } }));
    const partial = await scheduler.runBatch([{ request: request("ok"), candidates: [slow] }, { request: request("fail"), candidates: [failing] }], { ...policy, maxParallel: 2 });
    expect(partial.state).toBe("RECONCILIATION_REQUIRED");
    const direct = await scheduler.runBatch([{ request: request("ok-direct"), candidates: [slow] }, { request: request("fail-direct"), candidates: [failing] }], { ...policy, maxParallel: 2, requireAll: false, minSuccess: 1 });
    expect(direct.state).toBe("READY_TO_COMMIT");
  });
});
