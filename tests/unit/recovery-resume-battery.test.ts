import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ExecutionSupervisor } from "../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { Scheduler } from "../../electron/commander/scheduler";
import { RecoveryScheduler, type RecoveryResult, type RecoveryWakeup } from "../../electron/commander/recovery-scheduler";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../electron/runtimes/runtime";

/**
 * §33 / §39 — recovery resume over the REAL ExecutionSupervisor + durable
 * TaskLedger + RecoveryScheduler. A provider-technical failure schedules a
 * bounded runtime recovery instead of sleeping inside the dispatch; when the
 * provider recovers the SAME job is resumed (never restarted from zero, no
 * duplicate side effects) and completes. An always-failing provider exhausts
 * the bounded recovery attempts and is parked honestly — never COMPLETED.
 */

let dir: string;

function timeout(runtimeId: string, jobId: string): RuntimeResult {
  return { runtimeId, jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "provider timed out (technical)", retryable: true } };
}
function success(runtimeId: string, jobId: string, content: string): RuntimeResult {
  return { runtimeId, jobId, status: "SUCCESS", content };
}

function scriptedRuntime(runtimeId: string, script: Array<() => RuntimeResult>): RuntimeAdapter {
  let callsMade = 0;
  return {
    id: runtimeId,
    kind: "web",
    capabilities: { consumesModel: true, roles: ["planner"], supportsCancellation: true, supportsStreaming: true },
    healthCheck: async () => ({ runtimeId, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
    execute: async (_request: RuntimeRequest) => { callsMade++; return script[Math.min(callsMade - 1, script.length - 1)](); }
  };
}

function request(taskId: string, jobId: string): RuntimeRequest {
  return { taskId, jobId, role: "planner", prompt: "solve it", replaySafe: true, timeoutMs: 30_000 };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-resume-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness(runtimeId: string, script: Array<() => RuntimeResult>) {
  const ledger = new TaskLedger(path.join(dir, "ledger"));
  const queue = new RecoveryScheduler(path.join(dir, "recovery.json"));
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, queue);
  const adapter = scriptedRuntime(runtimeId, script);
  const adapters = new Map<string, RuntimeAdapter>([[runtimeId, adapter]]);
  queue.register("runtime", async (record: RecoveryWakeup): Promise<RecoveryResult> => {
    const payload = record.payload as { request: RuntimeRequest; runtimeIds: string[] };
    const candidates = payload.runtimeIds.map((id) => adapters.get(id)).filter((item) => item !== undefined) as RuntimeAdapter[];
    const result = await supervisor.execute(payload.request, candidates);
    return result.status === "SUCCESS" ? { done: true } : { done: false, retryAt: Date.now() + 50, error: result.failure?.message ?? "still failing" };
  });
  return { ledger, queue, supervisor, adapter };
}

it("§33: a technical failure schedules a bounded recovery; once the provider recovers the SAME job resumes and completes (no restart, no double side effect)", async () => {
  const { ledger, queue, supervisor, adapter } = harness("web:provider", [() => timeout("web:provider", "job-r1"), () => success("web:provider", "job-r1", "OK-R1")]);

  // First dispatch: technical failure → the supervisor parks via a scheduled recovery (no inline sleep).
  const first = await supervisor.execute(request("task-r1", "job-r1"), [adapter]);
  expect(first.status).not.toBe("SUCCESS");
  expect(queue.list().some((record) => record.kind === "runtime")).toBe(true);

  // Wait out the real retry deadline (2s backoff on the first attempt), then the
  // due recovery resumes the SAME job and completes it.
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await queue.runDue(Date.now());
  const record = ledger.load("task-r1")!;
  expect(record.jobs["job-r1"].state).toBe("COMPLETED");
  expect(record.completedSteps).toContain("job-r1");
  expect(record.usage.retries).toBeGreaterThanOrEqual(1);
  expect(queue.list()).toHaveLength(0); // recovery consumed
}, 15000);

it("§39: an always-failing provider parks honestly via bounded recovery scheduling (never COMPLETED, scheduler PAUSED)", async () => {
  const { ledger, queue, supervisor, adapter } = harness("web:bad", [() => timeout("web:bad", "job-r2")]);

  await supervisor.execute(request("task-r2", "job-r2"), [adapter]);
  // Drive the recovery scheduler until its bounded attempts cap (3) parks the record.
  for (let attempt = 0; attempt < 8; attempt += 1) await queue.runDue(Date.now() + 100000);

  const record = ledger.load("task-r2")!;
  expect(record.jobs["job-r2"].state).not.toBe("COMPLETED");
  expect(record.jobs["job-r2"].state).toBe("WAITING");
  const parked = queue.list().filter((item) => item.kind === "runtime");
  expect(parked.length).toBeGreaterThan(0);
  expect(parked.some((item) => item.state === "PAUSED" && item.attempts >= 3)).toBe(true);
});
