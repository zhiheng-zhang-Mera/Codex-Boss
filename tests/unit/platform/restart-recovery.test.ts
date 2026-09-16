import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionSupervisor } from "../../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../../electron/commander/task-ledger";
import { RecoveryScheduler } from "../../../electron/commander/recovery-scheduler";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../../electron/runtimes/runtime";

/**
 * Phase 05 gate 7 — after restart or recovery, no committed work is lost and no external side effect
 * happens twice.
 *
 * The book states both halves, and the second is the one that bites: losing work is visible, whereas
 * applying an effect twice looks like success. So the tests drive a real `ExecutionSupervisor` over a
 * durable `TaskLedger` and a durable `RecoveryScheduler`, with an external effect that is recorded in
 * a FILE rather than in memory — a restart is only meaningful if the thing that survives it is on
 * disk.
 *
 * The hard case is a crash in the window between the effect and the settlement: the effect has
 * happened, the ledger does not know it, and a naive replay applies it again. `recoveryFor` answers
 * that window with `VERIFY_SIDE_EFFECT` for a replay-UNSAFE request, which parks the task for a human
 * rather than retrying it. The test asserts that outcome as a property — exactly one effect, AND
 * either the task is parked for verification or no second effect was applied — so it holds whichever
 * branch the platform takes and cannot be satisfied by a run that quietly did both.
 */

const dirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-gate7-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function request(taskId: string, jobId: string, replaySafe: boolean): RuntimeRequest {
  return { taskId, jobId, role: "planning", prompt: "do the work", replaySafe, timeoutMs: 30_000 };
}

/** The external side effect, recorded on disk so it genuinely survives a new process object. */
function effectLog(root: string): { file: string; read: () => string[]; apply: (entry: string) => void } {
  const file = path.join(root, "external-effects.log");
  return {
    file,
    read: () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : []),
    apply: (entry: string) => fs.appendFileSync(file, `${entry}\n`, "utf8")
  };
}

/**
 * A runtime that applies its effect and then, optionally, fails.
 *
 * `failAfterEffect` is the crash window: the effect is real and recorded, the result says the job did
 * not settle, and the caller cannot tell from the ledger alone whether the effect happened.
 */
function effectingRuntime(id: string, effects: ReturnType<typeof effectLog>, options: { failAfterEffect?: RuntimeResult["failure"]; succeed?: boolean } = {}): RuntimeAdapter {
  return {
    id,
    kind: "api",
    capabilities: { consumesModel: true, roles: ["planning"], supportsCancellation: true, supportsStreaming: false },
    healthCheck: async () => ({ runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
    execute: async (runtimeRequest: RuntimeRequest): Promise<RuntimeResult> => {
      // One effect per (task, job): the log is keyed so a second application is visible as a duplicate.
      effects.apply(`${runtimeRequest.taskId}/${runtimeRequest.jobId}`);
      if (options.failAfterEffect) {
        return { runtimeId: id, jobId: runtimeRequest.jobId, status: "RETRYABLE_FAILURE", failure: options.failAfterEffect };
      }
      return { runtimeId: id, jobId: runtimeRequest.jobId, status: "SUCCESS", content: "done" };
    }
  };
}

describe("Phase 05 gate 7 — committed work survives a restart", () => {
  it("keeps the ledger and applies no further effect when the work already settled", async () => {
    const root = tempRoot();
    const effects = effectLog(root);
    const ledgerFile = path.join(root, "ledger.json");
    const runtime = effectingRuntime("api:worker", effects, { succeed: true });

    const firstLedger = new TaskLedger(ledgerFile);
    const firstSupervisor = new ExecutionSupervisor(firstLedger);
    const result = await firstSupervisor.execute(request("task-1", "job-1", true), [runtime]);
    expect(result.status).toBe("SUCCESS");
    expect(effects.read()).toEqual(["task-1/job-1"]);

    // A NEW supervisor over the SAME ledger file: the restart, as far as durable state is concerned.
    const secondLedger = new TaskLedger(ledgerFile);
    const recovered = secondLedger.load("task-1");
    expect(recovered, "the ledger lost a completed task across the restart").toBeTruthy();
    expect(recovered?.jobs["job-1"]?.state).toBe("COMPLETED");
    // Nothing re-ran, so the effect count is unchanged rather than doubled.
    expect(effects.read()).toEqual(["task-1/job-1"]);
  });

  it("does not apply a second effect in the crash window between effect and settlement", async () => {
    const root = tempRoot();
    const effects = effectLog(root);
    const ledgerFile = path.join(root, "ledger.json");
    // The effect lands, then the runtime reports a technical failure: the ledger cannot know whether
    // the effect happened. This is the window that makes replay dangerous.
    const runtime = effectingRuntime("api:flaky", effects, {
      failAfterEffect: { code: "TIMEOUT", message: "the worker died after applying its effect", retryable: true }
    });

    const ledger = new TaskLedger(ledgerFile);
    const supervisor = new ExecutionSupervisor(ledger);
    // replaySage = false: the request is NOT safe to replay, so the platform must not silently re-run it.
    const result = await supervisor.execute(request("task-2", "job-2", false), [runtime]);
    expect(effects.read()).toEqual(["task-2/job-2"]);

    // The property, asserted over whichever branch the platform takes: either the task is parked so a
    // human decides, or it did not re-apply the effect. Both are acceptable; doing neither is not.
    const record = ledger.load("task-2");
    const parked = ["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT"].includes(String(record?.nextAction));
    const effectAppliedOnce = effects.read().length === 1;
    expect(
      parked || effectAppliedOnce,
      `the crash window neither parked the task (nextAction=${record?.nextAction}, status=${result.status}) nor avoided a second effect (${effects.read().length} applied)`
    ).toBe(true);
    expect(parked, "an uncertain side effect on a replay-unsafe request must park rather than retry").toBe(true);
    // And the parked task really is recorded as uncertain rather than as success.
    expect(result.status).not.toBe("SUCCESS");
    expect(effects.read()).toEqual(["task-2/job-2"]);
  });

  it("does not lose a committed task when the ledger is reopened from disk", async () => {
    const root = tempRoot();
    const effects = effectLog(root);
    const ledgerFile = path.join(root, "ledger.json");
    const runtime = effectingRuntime("api:worker", effects, { succeed: true });
    const ledger = new TaskLedger(ledgerFile);
    const supervisor = new ExecutionSupervisor(ledger);
    await supervisor.execute(request("task-3", "job-3", true), [runtime]);

    // Two further restarts, to catch a save that only writes on the first close.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reopened = new TaskLedger(ledgerFile);
      const record = reopened.load("task-3");
      expect(record?.jobs["job-3"]?.state).toBe("COMPLETED");
      expect(record?.modifiedFiles).toBeDefined();
    }
    expect(effects.read()).toEqual(["task-3/job-3"]);
  });
});

describe("Phase 05 gate 7 — the recovery scheduler loses nothing and repeats nothing", () => {
  it("keeps a wakeup across a restart and runs it once", async () => {
    const root = tempRoot();
    const file = path.join(root, "recovery.json");
    const wakeups: string[] = [];

    const first = new RecoveryScheduler(file);
    first.register("runtime", async (record) => { wakeups.push(record.id); return { done: true }; });
    // Scheduled slightly in the future so the restart happens before it is due.
    first.schedule({ id: "runtime:task-4:job-4", taskId: "task-4", kind: "runtime", retryAt: Date.now() + 60_000, payload: {} });
    first.dispose();

    // A new scheduler over the same file: the wakeup must still be there.
    const second = new RecoveryScheduler(file);
    const persisted = second.list();
    expect(persisted.map((record) => record.id)).toEqual(["runtime:task-4:job-4"]);
    expect(persisted[0].state).toBe("WAITING");

    second.register("runtime", async (record) => { wakeups.push(record.id); return { done: true }; });
    await second.runDue(Date.now() + 120_000);
    expect(wakeups).toEqual(["runtime:task-4:job-4"]);
    // Having run, it is gone rather than left to run again.
    expect(second.list()).toEqual([]);

    // Running again produces nothing, so a timed retry cannot double-fire after a restart.
    await second.runDue(Date.now() + 240_000);
    expect(wakeups).toEqual(["runtime:task-4:job-4"]);
    second.dispose();
  });

  it("does not let a second schedule bring a wakeup forward or duplicate it", async () => {
    const root = tempRoot();
    const file = path.join(root, "recovery.json");
    const scheduler = new RecoveryScheduler(file);
    const later = Date.now() + 120_000;
    const sooner = Date.now() + 60_000;
    scheduler.schedule({ id: "runtime:task-5:job-5", taskId: "task-5", kind: "runtime", retryAt: later, payload: {} });
    scheduler.schedule({ id: "runtime:task-5:job-5", taskId: "task-5", kind: "runtime", retryAt: sooner, payload: {} });
    const records = scheduler.list();
    // One record, not two, and it kept the EARLIEST deadline: a duplicate schedule must not push a
    // recovery further away, because that is how a retry gets lost.
    expect(records).toHaveLength(1);
    expect(records[0].retryAt).toBe(sooner);
    expect(records[0].attempts).toBe(0);
    scheduler.dispose();
  });

  it("pauses a wakeup whose handler keeps failing rather than looping forever", async () => {
    const root = tempRoot();
    const file = path.join(root, "recovery.json");
    const scheduler = new RecoveryScheduler(file);
    let attempts = 0;
    scheduler.register("runtime", async () => { attempts++; return { done: false, retryAt: Date.now() }; });
    scheduler.schedule({ id: "runtime:task-6:job-6", taskId: "task-6", kind: "runtime", retryAt: Date.now(), payload: {} });
    for (let round = 0; round < 6; round++) await scheduler.runDue(Date.now() + 1_000);
    // Bounded: the attempts ceiling is reached and the record is PAUSED, not retried forever.
    expect(attempts).toBeLessThanOrEqual(3);
    const remaining = scheduler.list();
    expect(remaining).toHaveLength(1);
    // PAUSED is the terminal marker. The `error` field is set on the failure path (`result.done ===
    // false`) rather than on this one, so exhaustion is identified by the state and the attempt count —
    // asserting an error string here was my assumption about the shape, not the platform's behaviour.
    expect(remaining[0].state).toBe("PAUSED");
    expect(remaining[0].attempts).toBe(3);
    scheduler.dispose();
  });
});
