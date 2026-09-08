import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecoveryScheduler, type RecoveryWakeup } from "../../electron/commander/recovery-scheduler";

function schedulerAt(): RecoveryScheduler {
  return new RecoveryScheduler(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "boss-rec-")), "recovery.json"));
}

describe("recovery scheduler durability and retry bounds (Overcomplete §12)", () => {
  it("persists wakeups and pauses after exhausting attempts (never deletes the record silently)", async () => {
    const scheduler = schedulerAt();
    const seen: string[] = [];
    let calls = 0;
    scheduler.register("test-kind", async () => { calls++; seen.push("run"); return { done: false, retryAt: Date.now() - 1 }; });
    scheduler.schedule({ id: "w1", taskId: "t1", kind: "test-kind", retryAt: Date.now() - 1000, payload: {} });
    await scheduler.runDue(Date.now());
    expect(calls).toBe(1);
    // Past-due records stay WAITING and run again up to the cap.
    await scheduler.runDue(Date.now());
    await scheduler.runDue(Date.now());
    expect(calls).toBe(3);
    const records = scheduler.list();
    expect(records.some((record) => record.id === "w1" && record.state === "PAUSED")).toBe(true);
  });

  it("re-arms a paused wakeup via resumeTask and keeps it visible", async () => {
    const scheduler = schedulerAt();
    let calls = 0;
    scheduler.register("k", async () => { calls++; return { done: false, retryAt: Date.now() - 1 }; });
    scheduler.schedule({ id: "w", taskId: "t", kind: "k", retryAt: Date.now() - 1000, payload: {} });
    await scheduler.runDue(Date.now());
    await scheduler.runDue(Date.now());
    await scheduler.runDue(Date.now());
    expect(calls).toBe(3);
    expect(scheduler.list().find((record) => record.id === "w")?.state).toBe("PAUSED");
    expect(scheduler.resumeTask("t")).toBe(1);
    const resumed = scheduler.list().find((record) => record.id === "w");
    expect(resumed?.state).toBe("WAITING");
    expect(resumed?.attempts).toBe(0);
  });

  it("drops a wakeup record only when the handler reports done", async () => {
    const scheduler = schedulerAt();
    scheduler.register("k", async () => ({ done: true }));
    scheduler.schedule({ id: "done", taskId: "t", kind: "k", retryAt: Date.now() - 1, payload: {} });
    await scheduler.runDue(Date.now());
    expect(scheduler.list().some((record) => record.id === "done")).toBe(false);
  });
});
