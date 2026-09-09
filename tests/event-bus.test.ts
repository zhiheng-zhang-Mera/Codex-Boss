import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainEventBus } from "../electron/commander/event-bus";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import { RecoveryScheduler } from "../electron/commander/recovery-scheduler";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-events-")); dirs.push(dir); return dir; }
function worker(execute: RuntimeAdapter["execute"], id = "api:x"): RuntimeAdapter {
  return { id, kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; } };
}

describe("domain event bus", () => {
  it("delivers typed events to subscribers and supports unsubscribe", () => {
    const bus = new DomainEventBus();
    const seen: string[] = [];
    const off = bus.subscribe("WORKER_COMPLETED", (event) => seen.push(event.type + ":" + event.jobId));
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t", jobId: "j", message: "done" });
    expect(seen).toEqual(["WORKER_COMPLETED:j"]);
    off();
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t", jobId: "j2" });
    expect(seen).toEqual(["WORKER_COMPLETED:j"]);
  });

  it("isolates throwing handlers and never blocks the publisher", () => {
    const bus = new DomainEventBus();
    const seen: string[] = [];
    bus.subscribe("WORKER_FAILED", () => { throw new Error("handler boom"); });
    bus.subscribe("WORKER_FAILED", (event) => seen.push(event.taskId ?? ""));
    expect(() => bus.publish({ type: "WORKER_FAILED", taskId: "t", message: "x" })).not.toThrow();
    expect(seen).toEqual(["t"]);
  });
});

describe("supervisor event emission", () => {
  it("publishes WORKER_COMPLETED on success and WORKER_FAILED on an interruption", async () => {
    const dir = root();
    const ledger = new TaskLedger(path.join(dir, "tasks"));
    const events = new DomainEventBus();
    const completed: string[] = [];
    const failed: string[] = [];
    events.subscribe("WORKER_COMPLETED", (event) => completed.push(`${event.taskId}:${event.jobId}`));
    events.subscribe("WORKER_FAILED", (event) => failed.push(`${event.taskId}:${event.jobId}`));
    const supervisor = new ExecutionSupervisor(ledger, undefined, undefined, undefined, undefined, undefined, events);
    const good = worker(async (item) => ({ runtimeId: "api:x", jobId: item.jobId, status: "SUCCESS", content: "ok" }), "api:good");
    const bad = worker(async (item) => ({ runtimeId: "api:bad", jobId: item.jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "timeout", retryable: true, retryAt: Date.now() + 120000 } }), "api:bad");
    await supervisor.execute({ taskId: "ok-task", jobId: "ok-job", role: "coding", prompt: "work", replaySafe: true }, [good]);
    await supervisor.execute({ taskId: "bad-task", jobId: "bad-job", role: "coding", prompt: "work", replaySafe: true }, [bad]);
    expect(completed).toEqual(["ok-task:ok-job"]);
    expect(failed).toEqual(["bad-task:bad-job"]);
  });
});

describe("recovery scheduler event-driven wakeup", () => {
  it("runs a due wakeup immediately when a DEPENDENCY_READY event is emitted", async () => {
    const bus = new DomainEventBus();
    const queue = new RecoveryScheduler(path.join(root(), "queue.json"), () => {}, bus);
    let calls = 0;
    queue.register("test", async () => { calls++; return { done: true }; });
    // A due (past) deadline triggers the DEPENDENCY_READY event which runs due work.
    queue.schedule({ id: "a", taskId: "task", kind: "test", retryAt: Date.now() - 1, payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
    expect(queue.list()).toHaveLength(0);
  });

  it("does not run a future wakeup early", async () => {
    const bus = new DomainEventBus();
    const queue = new RecoveryScheduler(path.join(root(), "queue.json"), () => {}, bus);
    let calls = 0;
    queue.register("test", async () => { calls++; return { done: true }; });
    queue.schedule({ id: "a", taskId: "task", kind: "test", retryAt: Date.now() + 60000, payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
  });
});
