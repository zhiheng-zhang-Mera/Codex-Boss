import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneTaskCheckpoints } from "../electron/commander/storage-budget";
import { TaskLedger } from "../electron/commander/task-ledger";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-storage-")); dirs.push(dir); return dir; }

describe("storage budget / checkpoint retention", () => {
  it("prunes old generations keeping the newest ones", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("task", "objective"); // revision 1
    for (let i = 0; i < 30; i++) ledger.update("task", "step " + i, (record) => { record.checkpointReason = "step " + i; }); // revision 31
    const checkpoints = path.join(dir, "task", "checkpoints");
    expect(fs.readdirSync(checkpoints).length).toBe(31); // revisions 1..31
    const report = pruneTaskCheckpoints(dir, "task", { keepGenerations: 5 });
    expect(report.before).toBe(31);
    expect(report.removed).toBe(26);
    expect(report.after).toBe(5);
    const remaining = fs.readdirSync(checkpoints).filter((name) => name.endsWith(".json")).sort();
    expect(remaining).toEqual(["00000027.json", "00000028.json", "00000029.json", "00000030.json", "00000031.json"]);
    // Newest generation still loads and revision stays monotonic.
    expect(ledger.load("task")?.revision).toBe(31);
  });

  it("rejects a retention that is too small and no-ops when within budget", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("task", "objective");
    expect(() => pruneTaskCheckpoints(dir, "task", { keepGenerations: 1 })).toThrow(/at least 5/);
    expect(pruneTaskCheckpoints(dir, "task", { keepGenerations: 50 })).toMatchObject({ before: 1, removed: 0 });
  });

  it("bounds generations through the ledger save path", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("task", "objective"); // revision 1
    for (let i = 0; i < 130; i++) ledger.update("task", "step " + i, (record) => { record.checkpointReason = "step " + i; }); // revision 131
    const checkpoints = path.join(dir, "task", "checkpoints");
    const remaining = fs.readdirSync(checkpoints).filter((name) => name.endsWith(".json")).sort();
    // Amortized prune at revision multiples of 20 keeps the newest generation
    // set bounded and preserves the newest revision.
    expect(remaining.length).toBeGreaterThanOrEqual(50);
    expect(remaining.length).toBeLessThanOrEqual(70);
    expect(remaining[remaining.length - 1]).toBe("00000131.json");
    expect(ledger.load("task")?.revision).toBe(131);
    // An explicit prune reduces to the configured retention.
    expect(pruneTaskCheckpoints(dir, "task", { keepGenerations: 50 }).after).toBe(50);
  });
});
