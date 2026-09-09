import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExecutionSupervisor } from "../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { Scheduler } from "../../electron/commander/scheduler";
import { CircuitBreaker } from "../../electron/commander/circuit-breaker";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../electron/runtimes/runtime";

/**
 * §38 Scenario G / §39 DoD — multi-fault isolation over the REAL
 * ExecutionSupervisor + durable TaskLedger + CircuitBreaker.
 *
 * Three providers work in parallel: web:a breaks (provider-technical failures
 * trip its breaker OPEN), web:b fails with a session expiry (honest recovery,
 * never COMPLETED), web:c stays healthy. Assertions:
 *  - the healthy provider's task COMPLETEs while the two faulted providers are
 *    parked honestly (no fake completion, no global crash);
 *  - the failed provider is isolated (breaker OPEN) and a later task is
 *    rerouted to the healthy provider and completes — Boss remains alive with
 *    part of the fleet down.
 */

let dir: string;

function successContent(runtimeId: string, jobId: string, content: string): RuntimeResult {
  return { runtimeId, jobId, status: "SUCCESS", content };
}
function technicalFailure(runtimeId: string, jobId: string): RuntimeResult {
  return { runtimeId, jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "provider timed out (technical)", retryable: true } };
}
function sessionFailure(runtimeId: string, jobId: string): RuntimeResult {
  return { runtimeId, jobId, status: "RETRYABLE_FAILURE", failure: { code: "SESSION_EXPIRED", message: "provider session expired", retryable: true } };
}

function scriptedRuntime(runtimeId: string, script: Array<() => RuntimeResult>): RuntimeAdapter {
  let calls = 0;
  return {
    id: runtimeId,
    kind: "web",
    capabilities: { consumesModel: true, roles: ["planner"], supportsCancellation: true, supportsStreaming: true },
    healthCheck: async () => ({ runtimeId, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
    execute: async (_request: RuntimeRequest) => script[Math.min(calls++, script.length - 1)]()
  };
}

function request(taskId: string, jobId: string): RuntimeRequest {
  return { taskId, jobId, role: "planner", prompt: "solve it", replaySafe: true, timeoutMs: 30_000 };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-fault-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

it("Scenario G: simultaneous partial failures — healthy provider completes, faulted ones never fake completion, broken provider is isolated and later work reroutes", async () => {
  const ledger = new TaskLedger(path.join(dir, "ledger"));
  const breaker = new CircuitBreaker(path.join(dir, "breaker.json"), { failureThreshold: 1, cooldownMs: 600000, now: () => Date.now() });
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, undefined, undefined, breaker, undefined);

  const runtimeA = scriptedRuntime("web:a", [technicalFailure, technicalFailure]);
  const runtimeB = scriptedRuntime("web:b", [sessionFailure, sessionFailure, sessionFailure]);
  const runtimeC = scriptedRuntime("web:c", [() => successContent("web:c", "job-c", "OK-C")]);

  // Wave 1: three tasks in parallel; each pinned to one provider.
  const [resultA, resultB, resultC] = await Promise.all([
    supervisor.execute(request("task-a", "job-a"), [runtimeA]),
    supervisor.execute(request("task-b", "job-b"), [runtimeB]),
    supervisor.execute(request("task-c", "job-c"), [runtimeC])
  ]);

  // The healthy provider completed; the two faulted ones did not.
  expect(resultC.status).toBe("SUCCESS");
  expect(ledger.load("task-c")!.jobs["job-c"].state).toBe("COMPLETED");
  expect(ledger.load("task-c")!.completedSteps).toContain("job-c");

  expect(resultA.status).not.toBe("SUCCESS");
  expect(ledger.load("task-a")!.jobs["job-a"].state).not.toBe("COMPLETED");
  expect(ledger.load("task-a")!.jobs["job-a"].state).toBe("WAITING");

  expect(resultB.status).not.toBe("SUCCESS");
  expect(ledger.load("task-b")!.jobs["job-b"].state).not.toBe("COMPLETED");
  expect(ledger.load("task-b")!.jobs["job-b"].state).toBe("WAITING");

  // Provider-technical failures tripped only web:a's breaker; web:b (session)
  // and web:c never tripped theirs.
  expect(breaker.state("web:a")).toBe("OPEN");
  expect(breaker.state("web:b")).toBe("CLOSED");
  expect(breaker.state("web:c")).toBe("CLOSED");

  // Wave 2: a new task whose pool contains the broken provider and the healthy
  // one is rerouted to the healthy provider and completes — Boss remains alive
  // with web:a down.
  const resultD = await supervisor.execute(request("task-d", "job-d"), [runtimeA, runtimeC]);
  expect(resultD.status).toBe("SUCCESS");
  expect(resultD.runtimeId).toBe("web:c");
  expect(ledger.load("task-d")!.jobs["job-d"].state).toBe("COMPLETED");
  expect(breaker.isOpen("web:a")).toBe(true); // isolation persists
});

it("Scenario A-style: a single failing provider never affects unrelated healthy work on the same supervisor", async () => {
  const ledger = new TaskLedger(path.join(dir, "ledger2"));
  const breaker = new CircuitBreaker(path.join(dir, "breaker2.json"), { failureThreshold: 1, cooldownMs: 600000, now: () => Date.now() });
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, undefined, undefined, breaker, undefined);
  const failing = scriptedRuntime("web:qwen", [technicalFailure, technicalFailure]);
  const healthy = scriptedRuntime("web:chatgpt", [() => successContent("web:chatgpt", "job-e", "OK-E")]);

  const [broken, ok] = await Promise.all([
    supervisor.execute(request("task-e", "job-e1"), [failing]),
    supervisor.execute(request("task-f", "job-f"), [healthy])
  ]);
  expect(broken.status).not.toBe("SUCCESS");
  expect(ok.status).toBe("SUCCESS");
  expect(ledger.load("task-f")!.jobs["job-f"].state).toBe("COMPLETED");
  expect(breaker.state("web:qwen")).toBe("OPEN");
  expect(breaker.state("web:chatgpt")).toBe("CLOSED");
});
