import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DecisionLedgerStore } from "../../electron/commander/decision-ledger-store";
import { appendToLedger, summarizeLedger, validateLedgerEntry, type DecisionLedgerEntry } from "../../src/shared/decision-ledger";

function entry(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  return {
    id: "dec-1",
    taskId: "task-1",
    createdAt: "2026-09-09T06:00:00.000Z",
    question: "是否继续执行？",
    candidates: ["继续", "暂停"],
    chosen: "继续（auto-continue）",
    evidence: ["policy owner-result:continue:v1"],
    outcome: "APPLIED",
    source: "question-interceptor",
    ...overrides
  };
}

describe("decision-ledger: pure model (§38)", () => {
  it("validates and appends immutably", () => {
    expect(() => validateLedgerEntry(entry())).not.toThrow();
    expect(() => validateLedgerEntry(entry({ id: "" }))).toThrow();
    expect(() => validateLedgerEntry(entry({ createdAt: "nope" }))).toThrow();
    const base: DecisionLedgerEntry[] = [entry()];
    const next = appendToLedger(base, entry({ id: "dec-2", taskId: "task-2" }));
    expect(base.length).toBe(1);
    expect(next.length).toBe(2);
    expect(() => appendToLedger(base, entry())).toThrow(); // duplicate id
  });

  it("summarizes by source/outcome with rollback counts", () => {
    const stats = summarizeLedger([
      entry(),
      entry({ id: "dec-2", taskId: "task-2", outcome: "ROLLED_BACK", rollback: "reverted change" }),
      entry({ id: "dec-3", taskId: "task-2", outcome: "APPLIED", source: "planner" })
    ]);
    expect(stats.total).toBe(3);
    expect(stats.rollbacks).toBe(1);
    expect(stats.bySource["question-interceptor"]).toBe(2);
    expect(stats.bySource.planner).toBe(1);
  });
});

describe("decision-ledger: durable store", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "decision-ledger-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists entries across reopen (atomic file, newest-first list)", () => {
    const file = path.join(dir, "ledger.json");
    const store = new DecisionLedgerStore(file);
    store.append(entry());
    store.append(entry({ id: "dec-2", taskId: "task-2", createdAt: "2026-09-09T07:00:00.000Z" }));
    const reopened = new DecisionLedgerStore(file);
    const list = reopened.list();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("dec-2"); // newest first
    expect(reopened.stats("task-2").total).toBe(1);
  });

  it("appends many entries in one atomic write and rejects duplicate ids", () => {
    const file = path.join(dir, "ledger.json");
    const store = new DecisionLedgerStore(file);
    store.appendAll([entry(), entry({ id: "dec-2", taskId: "task-1" })]);
    expect(() => store.appendAll([entry()])).toThrow();
    expect(new DecisionLedgerStore(file).list().length).toBe(2);
  });

  it("fails closed on a corrupt store instead of dropping the ledger", () => {
    const file = path.join(dir, "ledger.json");
    fs.writeFileSync(file, '{"schemaVersion":1,"entries":[{"id":"x"}]}', "utf8");
    expect(() => new DecisionLedgerStore(file)).toThrow();
  });
});
