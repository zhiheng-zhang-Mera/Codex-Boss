import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TaskLedger, type TaskLedgerRecord } from "../../electron/commander/task-ledger";

function ledgerAt(): TaskLedger {
  return new TaskLedger(fs.mkdtempSync(path.join(os.tmpdir(), "boss-ledger-")));
}

describe("durable ledger guards (Overcomplete §16.2/16.3)", () => {
  it("rejects a stale checkpoint write instead of silently rolling back a side effect", () => {
    const ledger = ledgerAt();
    const created = ledger.create("t1", "objective", []);
    ledger.update("t1", "first change", (record) => { record.nextAction = "STEP_1"; });
    const stale = structuredClone(ledger.load("t1")) as TaskLedgerRecord;
    // Simulate a second actor that loaded the pre-update revision and now writes.
    stale.revision = created.revision;
    stale.nextAction = "STEP_2";
    expect(() => ledger.save(stale, "stale writer")).toThrow(/Stale task checkpoint/);
    // Newest generation remains authoritative.
    expect(ledger.load("t1")?.nextAction).toBe("STEP_1");
  });

  it("creates once (idempotent) and survives an explicit purge", () => {
    const ledger = ledgerAt();
    const first = ledger.create("t2", "objective", []);
    expect(ledger.create("t2", "objective", []).revision).toBe(first.revision);
    ledger.update("t2", "worked", (record) => { record.nextAction = "DONE"; });
    ledger.purgeTask("t2");
    expect(ledger.load("t2")).toBeUndefined();
    // After purge a fresh run starts clean (no resurrected side-effect state).
    expect(ledger.create("t2", "objective", []).completedSteps).toEqual([]);
  });

  it("records durable startedAt on running jobs and completedAt on terminal ones", async () => {
    const ledger = ledgerAt();
    ledger.create("t3", "objective", []);
    ledger.update("t3", "start", (record) => {
      record.jobs["graph_step"] = { id: "graph_step", fingerprint: "fp", state: "RUNNING", sessionId: "s", attempts: 1, startedAt: "2026-01-01T00:00:00.000Z" };
    });
    ledger.update("t3", "done", (record) => {
      record.jobs["graph_step"].state = "COMPLETED";
      record.jobs["graph_step"].completedAt = "2026-01-01T00:01:00.000Z";
      record.jobs["graph_step"].result = { runtimeId: "r", jobId: "graph_step", status: "SUCCESS", content: "ok" };
    });
    const job = ledger.load("t3")!.jobs["graph_step"];
    expect(job.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(job.completedAt).toBe("2026-01-01T00:01:00.000Z");
  });
});
