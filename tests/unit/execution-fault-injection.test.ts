import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExecutionSupervisor } from "../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { Scheduler } from "../../electron/commander/scheduler";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../electron/runtimes/runtime";

/**
 * P1-5 fault injection over the real ExecutionSupervisor + durable TaskLedger.
 * A scripted fake runtime replays Rev.2 failure classes (auth required, provider
 * timeout, quota/budget, unsupported/dependency, malformed-but-SUCCESS content).
 * Assertions are about the DURABLE state: a faulted job must never look
 * COMPLETED, must be parked with the right next action / mode, and the
 * supervisor must not fabricate a success.
 */

let dir: string;

function fakeResult(runtimeId: string, jobId: string, patch: Partial<RuntimeResult> = {}): RuntimeResult {
  return {
    runtimeId,
    jobId,
    status: "RETRYABLE_FAILURE",
    ...patch
  } as RuntimeResult;
}

function successContent(runtimeId: string, jobId: string, content: string): RuntimeResult {
  return { runtimeId, jobId, status: "SUCCESS", content };
}

function scriptedRuntime(runtimeId: string, script: Array<() => RuntimeResult>): RuntimeAdapter {
  let calls = 0;
  const instance: RuntimeAdapter = {
    id: runtimeId,
    kind: "web",
    capabilities: { consumesModel: true, roles: ["planner"], supportsCancellation: true, supportsStreaming: true },
    healthCheck: async () => ({ runtimeId, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
    execute: async (_request: RuntimeRequest) => script[Math.min(calls++, script.length - 1)]()
  };
  return instance;
}

/** Stub scheduler is not used: the real Scheduler races the scripted runtime, which returns instantly. */

function request(): RuntimeRequest {
  return { taskId: "task-fault", jobId: "job-1", role: "planner", prompt: "solve it", replaySafe: true, timeoutMs: 30_000 };
}

async function runScenario(script: Array<() => RuntimeResult>): Promise<{ result: RuntimeResult; record: ReturnType<TaskLedger["load"]> }> {
  const ledger = new TaskLedger(path.join(dir, "ledger"));
  const runtime = scriptedRuntime("web:fake", script);
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, undefined, undefined, undefined, undefined);
  const result = await supervisor.execute(request(), [runtime]);
  return { result, record: ledger.load("task-fault") };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-fault-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("execution fault injection (P1-5/§22)", () => {
  it("AUTH_REQUIRED parks the job HUMAN_REQUIRED — never a fake completion", async () => {
    const { result, record } = await runScenario([() => fakeResult("web:fake", "job-1", { failure: { code: "AUTH_REQUIRED", message: "please log in", retryable: true } })]);
    expect(result.status).not.toBe("SUCCESS");
    expect(record!.jobs["job-1"].state).toBe("WAITING");
    expect(record!.nextAction).toBe("HUMAN_REQUIRED");
    expect(record!.mode).toBe("PAUSED");
    expect(record!.usage.retries).toBe(0);
  });

  it("provider timeout retries are bounded and never fabricate COMPLETED", async () => {
    const timeout = () => fakeResult("web:fake", "job-1", { failure: { code: "TIMEOUT", message: "provider timed out", retryable: true } });
    const { result, record } = await runScenario([timeout]);
    expect(result.status).not.toBe("SUCCESS");
    expect(record!.jobs["job-1"].state).toBe("WAITING");
    expect(record!.jobs["job-1"].attempts).toBeLessThanOrEqual(3);
    expect(record!.jobs["job-1"].result?.status).toBe("RETRYABLE_FAILURE");
  });

  it("quota/budget exhaustion defers instead of pretending success", async () => {
    const { result, record } = await runScenario([() => fakeResult("web:fake", "job-1", { failure: { code: "BUDGET_EXHAUSTED", message: "quota exceeded", retryable: false } })]);
    expect(result.status).not.toBe("SUCCESS");
    expect(record!.nextAction).toBe("DEFER");
    expect(record!.jobs["job-1"].state).toBe("WAITING");
    expect(record!.usage.retries).toBe(0);
  });

  it("unsupported/dependency failure parks DEFER with a durable provider reason", async () => {
    const { result, record } = await runScenario([() => fakeResult("web:fake", "job-1", { failure: { code: "UNSUPPORTED", message: "no adapter", retryable: false } })]);
    expect(result.status).not.toBe("SUCCESS");
    expect(record!.nextAction).toBe("DEFER");
    expect(record!.jobs["job-1"].state).toBe("WAITING");
  });

  it("malformed worker output (empty on SUCCESS) is not accepted as completed", async () => {
    const { result, record } = await runScenario([() => successContent("web:fake", "job-1", "   ")]);
    expect(result.status).not.toBe("SUCCESS");
    expect(record!.jobs["job-1"].state).not.toBe("COMPLETED");
    expect(record!.completedSteps).not.toContain("job-1");
  });

  it("a genuine non-empty SUCCESS completes the job and the step", async () => {
    const { result, record } = await runScenario([() => successContent("web:fake", "job-1", "done: 42")]);
    expect(result.status).toBe("SUCCESS");
    expect(record!.jobs["job-1"].state).toBe("COMPLETED");
    expect(record!.completedSteps).toContain("job-1");
    expect(record!.nextAction).toBe("NEXT_STEP");
  });
});
