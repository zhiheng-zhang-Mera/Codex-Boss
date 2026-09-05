import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CircuitBreaker, providerTechnicalInterruption } from "../electron/commander/circuit-breaker";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-breaker-")); dirs.push(dir); return dir; }

describe("CircuitBreaker provider health", () => {
  it("stays CLOSED and admits by default, and trips OPEN after the failure threshold", () => {
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 3, now: () => 1000 });
    expect(breaker.state("api:x")).toBe("CLOSED");
    expect(breaker.admit("api:x")).toBe(true);
    expect(breaker.observeFailure("api:x")).toBe("CLOSED");
    expect(breaker.observeFailure("api:x")).toBe("CLOSED");
    expect(breaker.state("api:x")).toBe("CLOSED");
    expect(breaker.observeFailure("api:x")).toBe("OPEN");
    expect(breaker.isOpen("api:x")).toBe(true);
    expect(breaker.admit("api:x")).toBe(false);
  });

  it("resets the consecutive-failure streak on success before the threshold", () => {
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 3, now: () => 1000 });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    expect(breaker.observeSuccess("api:x")).toBe("CLOSED");
    expect(breaker.observeFailure("api:x")).toBe("CLOSED");
    expect(breaker.state("api:x")).toBe("CLOSED");
  });

  it("goes HALF_OPEN after the cooldown and admits exactly one probe", () => {
    let now = 0;
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    expect(breaker.state("api:x")).toBe("OPEN");
    now = 150; // cooldown elapsed
    expect(breaker.state("api:x")).toBe("HALF_OPEN");
    expect(breaker.isOpen("api:x")).toBe(false);
    expect(breaker.admit("api:x")).toBe(true); // first probe admitted
    expect(breaker.admit("api:x")).toBe(false); // no concurrent probes
    expect(breaker.cancelProbe("api:x"));
    expect(breaker.admit("api:x")).toBe(true); // freed by cancellation
    expect(breaker.observeSuccess("api:x")).toBe("CLOSED");
    expect(breaker.admit("api:x")).toBe(true);
  });

  it("reopens with a fresh cooldown when the HALF_OPEN probe fails", () => {
    let now = 0;
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    now = 150;
    expect(breaker.admit("api:x")).toBe(true); // probe
    expect(breaker.observeFailure("api:x")).toBe("OPEN");
    expect(breaker.isOpen("api:x")).toBe(true);
    now = 200; // only 50ms since probe failure: still cooling down
    expect(breaker.state("api:x")).toBe("OPEN");
    now = 260; // 110ms after probe failure
    expect(breaker.state("api:x")).toBe("HALF_OPEN");
  });

  it("persists breaker state across restart and fails closed on corrupt files", () => {
    const file = path.join(root(), "circuit-breaker.json");
    const breaker = new CircuitBreaker(file, { failureThreshold: 2, now: () => 1000 });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    expect(breaker.isOpen("api:x")).toBe(true);
    const restored = new CircuitBreaker(file, { failureThreshold: 2, now: () => 1000 });
    expect(restored.isOpen("api:x")).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, records: [{ runtimeId: 42, state: "OPEN", consecutiveFailures: -1 }] }));
    expect(() => new CircuitBreaker(file)).toThrow(/Invalid/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, records: [] }));
    expect(() => new CircuitBreaker(file)).toThrow(/Invalid/);
  });

  it("only treats provider-technical interruptions as breaker failures", () => {
    expect(providerTechnicalInterruption("NETWORK_FAILURE")).toBe(true);
    expect(providerTechnicalInterruption("PROVIDER_5XX")).toBe(true);
    expect(providerTechnicalInterruption("TOOL_TIMEOUT")).toBe(true);
    expect(providerTechnicalInterruption("PROCESS_CRASH")).toBe(true);
    expect(providerTechnicalInterruption("RATE_LIMIT")).toBe(false);
    expect(providerTechnicalInterruption("QUOTA_EXHAUSTED")).toBe(false);
    expect(providerTechnicalInterruption("AUTH_EXPIRED")).toBe(false);
    expect(providerTechnicalInterruption("HUMAN_APPROVAL_REQUIRED")).toBe(false);
    expect(providerTechnicalInterruption("UNKNOWN_INTERRUPTION")).toBe(false);
  });
});

describe("CircuitBreaker integration with ExecutionSupervisor", () => {
  function worker(execute: RuntimeAdapter["execute"], id = "api:x"): RuntimeAdapter {
    return { id, kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; } };
  }

  it("skips an OPEN runtime without dispatching to it", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    let now = 0;
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 2, cooldownMs: 1000, now: () => now });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    expect(breaker.isOpen("api:x")).toBe(true);
    let calls = 0;
    const runtime = worker(async (item) => { calls++; return { runtimeId: "api:x", jobId: item.jobId, status: "SUCCESS", content: "ok" }; });
    const request = { taskId: "task1", jobId: "job1", role: "coding" as const, prompt: "work", replaySafe: true };
    const supervisor = new ExecutionSupervisor(ledger, undefined, undefined, undefined, undefined, breaker);
    const result = await supervisor.execute(request, [runtime]);
    expect(result.status).toBe("PERMANENT_FAILURE");
    expect(result.failure?.code).toBe("UNSUPPORTED");
    expect(calls).toBe(0);
  });

  it("reopens after a failed probe and closes after a successful HALF_OPEN probe", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    let now = 0;
    const breaker = new CircuitBreaker(undefined, { failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.observeFailure("api:x");
    breaker.observeFailure("api:x");
    const runtime = worker(async (item) => {
      if (item.jobId === "probe-fail") return { runtimeId: "api:x", jobId: item.jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "timeout", retryable: true } };
      return { runtimeId: "api:x", jobId: item.jobId, status: "SUCCESS", content: "ok" };
    });
    const supervisor = new ExecutionSupervisor(ledger, undefined, undefined, undefined, undefined, breaker);

    // Probe after cooldown fails → breaker reopens.
    now = 150;
    const probeFail = await supervisor.execute({ taskId: "task2", jobId: "probe-fail", role: "coding", prompt: "probe fail", replaySafe: false }, [runtime]);
    expect(breaker.state("api:x")).toBe("OPEN");
    expect(probeFail.status).not.toBe("SUCCESS");
    now = 300; // fresh cooldown elapsed
    expect(breaker.state("api:x")).toBe("HALF_OPEN");

    // Probe succeeds → breaker closes and the step completes.
    const probeOk = await supervisor.execute({ taskId: "task3", jobId: "probe-ok", role: "coding", prompt: "probe ok", replaySafe: true }, [runtime]);
    expect(probeOk.status).toBe("SUCCESS");
    expect(breaker.state("api:x")).toBe("CLOSED");
  });
});
