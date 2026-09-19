import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkIntegrity,
  copyDatabaseTo,
  describeDatabase,
  openDatabase,
  openDatabaseFile,
  stateDatabasePath,
  type DatabaseHandle
} from "../../../electron/state-core/database";
import { TransactionError, inTransaction, transactionDepthOf, withTransaction } from "../../../electron/state-core/transaction";
import { createStateRepository, OwnershipConflictError } from "../../../electron/state-core/state-repository";
import { createEventJournal, validateEventRow } from "../../../electron/state-core/event-journal";
import { createEventConsumer } from "../../../electron/state-core/event-consumer";
import { createStateQuarantine } from "../../../electron/state-core/state-quarantine";
import { inspectRecovery } from "../../../electron/state-core/recovery";
import { readSchemaState, appliedMigrations, validateMigrationPlan, MigrationPlanError, SchemaAheadError } from "../../../electron/state-core/schema-version";
import { CheckpointError, createCheckpoint, listCheckpoints, runMigrations } from "../../../electron/state-core/migration-runner";

/**
 * Phase 02 — the transactional state and event core.
 *
 * These are the acceptance tests the engineering book names: transaction rollback,
 * WAL/restart durability, schema migration, quarantine, consumer cursor and idempotent
 * replay. They run against a REAL SQLite file in a temporary directory, never a mock,
 * because every property being claimed is a property of the storage engine plus this
 * code — a fake would only prove the fake.
 *
 * Crash behaviour is exercised by actually killing a child process (see
 * `state-core-crash-child.cjs`), which is the only way to establish "a hard kill does not
 * lose a committed event".
 */

const dirs: string[] = [];
const handles: DatabaseHandle[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-state-core-"));
  dirs.push(dir);
  return dir;
}

function openTestDatabase(root: string): DatabaseHandle {
  const handle = openDatabase(stateDatabasePath(root));
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    try { handle.close(); } catch { /* already closed by the test */ }
  }
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A minimal decode for the quarantine tests: the payload must be an object with `v`. */
function decodeVersioned(payload: unknown): { v: number } {
  if (typeof payload !== "object" || payload === null) throw new Error("payload must be an object");
  const value = (payload as { v?: unknown }).v;
  if (typeof value !== "number") throw new Error("payload.v must be a number");
  return { v: value };
}

describe("Phase 02 Task A — database lifecycle", () => {
  it("creates a WAL database with foreign keys enforced and reports its own state", () => {
    const handle = openTestDatabase(tempRoot());
    const info = handle.info();
    expect(info.journalMode).toBe("wal");
    expect(info.foreignKeys).toBe(true);
    // `user_version` is the domain migration version, so a fresh store is at 0: the core
    // tables exist because their DDL is idempotent, not because a migration ran.
    expect(info.schemaVersion).toBe(0);
    expect(info.existed).toBe(false);
    expect(describeDatabase(info)).toContain("journal=wal");
    expect(checkIntegrity(handle).ok).toBe(true);
  });

  it("is the single lifecycle owner: close is idempotent and use-after-close is refused", () => {
    const handle = openTestDatabase(tempRoot());
    expect(handle.closed()).toBe(false);
    handle.close();
    handle.close();
    expect(handle.closed()).toBe(true);
    expect(() => withTransaction(handle, () => 1)).toThrow(TransactionError);
  });

  it("opens an existing file without recreating it", () => {
    const root = tempRoot();
    const first = openDatabase(stateDatabasePath(root));
    first.close();
    const second = openTestDatabase(root);
    expect(second.info().existed).toBe(true);
  });

  it("refuses a file that is not a database instead of reading it as empty", () => {
    const root = tempRoot();
    const file = stateDatabasePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("not a database at all, just some bytes to confuse the opener, padded out"));
    expect(() => openDatabase(file)).toThrow();
  });

  it("copies the live database consistently, rather than copying files", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    repo.put("demo", "a", { v: 1 }, "2026-01-01T00:00:00.000Z");
    const copy = path.join(root, "copy.db");
    copyDatabaseTo(handle, copy);
    const opened = openDatabaseFile(copy);
    handles.push(opened);
    expect(createStateRepository(opened).get("demo", "a")?.value).toEqual({ v: 1 });
  });
});

describe("Phase 02 Task A — transactions", () => {
  it("commits a body's writes and returns its value", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    const result = withTransaction(handle, () => {
      repo.put("demo", "x", { v: 1 });
      repo.put("demo", "y", { v: 2 });
      return "done";
    });
    expect(result).toBe("done");
    expect(repo.count("demo")).toBe(2);
    expect(transactionDepthOf(handle)).toBe(0);
    expect(inTransaction(handle)).toBe(false);
  });

  it("ROLLS BACK every write in the body when the body throws, and leaves no depth behind", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    repo.put("demo", "before", { v: 0 });
    expect(() =>
      withTransaction(handle, () => {
        repo.put("demo", "during", { v: 1 });
        expect(repo.count("demo")).toBe(2);
        throw new Error("the body failed");
      })
    ).toThrow("the body failed");
    // The write is gone, and the pre-existing row survived.
    expect(repo.count("demo")).toBe(1);
    expect(repo.get("demo", "during")).toBeUndefined();
    expect(repo.get("demo", "before")?.value).toEqual({ v: 0 });
    expect(transactionDepthOf(handle)).toBe(0);
  });

  it("nests as a savepoint, so an inner failure does not discard the outer work", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    withTransaction(handle, () => {
      repo.put("demo", "outer", { v: 1 });
      expect(() =>
        withTransaction(handle, () => {
          repo.put("demo", "inner", { v: 2 });
          throw new Error("inner failed");
        })
      ).toThrow("inner failed");
      // The outer transaction is still alive and still writable.
      repo.put("demo", "after-inner", { v: 3 });
    });
    const keys = repo.list("demo").map((record) => record.key).sort();
    expect(keys).toEqual(["after-inner", "outer"]);
    expect(transactionDepthOf(handle)).toBe(0);
  });

  it("restores depth after a failed body so a later transaction still works", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(() => withTransaction(handle, () => { throw new Error("boom"); })).toThrow("boom");
      expect(transactionDepthOf(handle)).toBe(0);
    }
    repo.put("demo", "survivor", { v: 1 });
    expect(repo.count("demo")).toBe(1);
  });

  it("reports the depth inside the body, so nesting is observable", () => {
    const handle = openTestDatabase(tempRoot());
    const depths: number[] = [];
    withTransaction(handle, (outer) => {
      depths.push(outer.depth);
      expect(outer.savepointName).toBeUndefined();
      withTransaction(handle, (inner) => {
        depths.push(inner.depth);
        expect(inner.savepointName).toBeTruthy();
      });
    });
    expect(depths).toEqual([1, 2]);
  });
});

describe("Phase 02 Task A/C — the state repository", () => {
  it("refuses to reassign a namespace owner, because Phase 01 allows exactly one", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });
    // Re-asserting the same owner is idempotent, so a boot path can declare every time.
    expect(() => repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" })).not.toThrow();
    expect(() => repo.declareNamespace({ namespace: "tasks", owner: "somebody.else", kind: "document" })).toThrow(OwnershipConflictError);
  });

  it("refuses a write to an undeclared namespace", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    expect(() => repo.put("ghost", "k", { v: 1 })).toThrow(/not declared/);
  });

  it("keeps append order stable and independent of key order", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "ledger", owner: "persistence", kind: "append-only" });
    // Deliberately not in key order: `position` is what defines the read order.
    for (const key of ["z", "a", "m"]) repo.append("ledger", key, { key });
    expect(repo.list("ledger").map((record) => record.key)).toEqual(["z", "a", "m"]);
    expect(repo.list("ledger").map((record) => record.position)).toEqual([1, 2, 3]);
  });

  it("tracks a revision per namespace so a shadow compare can tell changed from unchanged", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    const start = repo.namespaceInfo("demo")?.revision;
    repo.put("demo", "a", { v: 1 });
    const afterWrite = repo.namespaceInfo("demo")?.revision;
    repo.put("demo", "a", { v: 1 });
    const afterSameValue = repo.namespaceInfo("demo")?.revision;
    expect(afterWrite).toBeGreaterThan(start as number);
    // A write of the same value still bumps the revision: the revision reports that a
    // write happened, which is what makes it usable as a change detector.
    expect(afterSameValue).toBeGreaterThan(afterWrite as number);
  });

  it("removes and clears without losing the declaration", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    repo.put("demo", "a", { v: 1 });
    repo.put("demo", "b", { v: 2 });
    expect(repo.remove("demo", "a")).toBe(true);
    expect(repo.remove("demo", "a")).toBe(false);
    expect(repo.clear("demo")).toBe(1);
    expect(repo.count("demo")).toBe(0);
    expect(repo.namespaceInfo("demo")).toBeTruthy();
  });
});

describe("Phase 02 Task B — the durable event journal", () => {
  it("appends the ten required fields with a monotonic sequence", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    const first = journal.append({ type: "TASK_CREATED", aggregateId: "task-1", payload: { a: 1 }, producer: "persistence", idempotencyKey: "k1" });
    const second = journal.append({ type: "TASK_UPDATED", aggregateId: "task-1", payload: { a: 2 }, producer: "persistence", idempotencyKey: "k2" });
    expect(first.duplicate).toBe(false);
    expect(second.event.sequence).toBeGreaterThan(first.event.sequence);
    for (const field of ["id", "sequence", "type", "aggregateId", "payload", "createdAt", "schemaVersion", "idempotencyKey", "producer"]) {
      expect(second.event, `missing ${field}`).toHaveProperty(field);
    }
    expect(second.event.payload).toEqual({ a: 2 });
  });

  it("treats a repeated idempotency key as the SAME event rather than a second one", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    const first = journal.append({ type: "TASK_CREATED", aggregateId: "t", payload: {}, producer: "p", idempotencyKey: "same" });
    const again = journal.append({ type: "TASK_CREATED", aggregateId: "t", payload: {}, producer: "p", idempotencyKey: "same" });
    expect(again.duplicate).toBe(true);
    expect(again.event.id).toBe(first.event.id);
    expect(again.event.sequence).toBe(first.event.sequence);
    expect(journal.stats().events).toBe(1);
  });

  it("returns the ORIGINAL durable row on a replay, never the id or timestamp the replay supplied", () => {
    // The append hot path writes with
    // `INSERT ... ON CONFLICT(producer, idempotency_key) DO NOTHING RETURNING *` and reads the durable row
    // back on conflict. That design invites one specific failure — returning the values THIS call generated
    // (its fresh `randomUUID()`, its `createdAt`, its payload) instead of the stored event — so it is pinned
    // with a replay that deliberately supplies different ones of every field.
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    const first = journal.append({
      type: "TASK_CREATED", aggregateId: "t", payload: { a: 1 }, producer: "p", idempotencyKey: "same",
      id: "original-id", createdAt: "2026-01-01T00:00:00.000Z"
    });
    expect(first.event.id).toBe("original-id");
    expect(first.duplicate).toBe(false);

    const replay = journal.append({
      type: "TASK_COMPLETED", aggregateId: "different-aggregate", payload: { a: 2 }, producer: "p",
      idempotencyKey: "same", id: "replay-id", createdAt: "2026-09-09T09:09:09.000Z"
    });

    expect(replay.duplicate).toBe(true);
    expect(replay.event.id).toBe("original-id");
    expect(replay.event.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(replay.event.type).toBe("TASK_CREATED");
    expect(replay.event.aggregateId).toBe("t");
    expect(replay.event.payload).toEqual({ a: 1 });
    expect(replay.event.sequence).toBe(first.event.sequence);
    // Nothing was written under the id the replay supplied, and the journal still holds one row.
    expect(journal.byId("replay-id"), "the replay wrote its own row").toBeUndefined();
    expect(journal.stats().events).toBe(1);
    expect(journal.head()).toBe(first.event.sequence);
  });

  it("requires an idempotency key, because a replayable event needs one", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    expect(() => journal.append({ type: "X", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "" })).toThrow(/idempotencyKey/);
    expect(() => journal.append({ type: "X", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "  " })).toThrow(/idempotencyKey/);
    expect(() => journal.append({ type: "X", aggregateId: "", payload: {}, producer: "p", idempotencyKey: "k" })).toThrow(/aggregateId/);
    expect(() => journal.append({ type: "", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "k" })).toThrow(/type/);
  });

  it("reads in sequence order, after a cursor, bounded by a limit", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    for (let index = 0; index < 5; index++) {
      journal.append({ type: "E", aggregateId: "a", payload: { index }, producer: "p", idempotencyKey: `k${index}` });
    }
    const all = journal.read(0);
    expect(all.map((event) => (event.payload as { index: number }).index)).toEqual([0, 1, 2, 3, 4]);
    expect(journal.read(all[1].sequence).map((event) => (event.payload as { index: number }).index)).toEqual([2, 3, 4]);
    expect(journal.read(0, 2)).toHaveLength(2);
    expect(journal.head()).toBe(all[4].sequence);
    expect(journal.byId(all[0].id)?.sequence).toBe(all[0].sequence);
    expect(journal.bySequence(all[2].sequence)?.id).toBe(all[2].id);
    expect(journal.forAggregate("a")).toHaveLength(5);
  });

  it("names every problem of a malformed row instead of guessing", () => {
    const problems = validateEventRow({ id: "", type: "", aggregate_id: "", created_at: "not-a-date", schema_version: 1.5, idempotency_key: "", producer: "" } as never);
    expect(problems.length).toBeGreaterThanOrEqual(6);
    expect(validateEventRow({ id: "a", sequence: 1, type: "T", aggregate_id: "a", payload: "{}", created_at: "2026-01-01T00:00:00.000Z", schema_version: 1, idempotency_key: "k", producer: "p" })).toEqual([]);
  });
});

describe("Phase 02 Task A/B — atomicity ACROSS state and event", () => {
  it("commits the state change and the event together, in one transaction", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const journal = createEventJournal(handle);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });

    withTransaction(handle, () => {
      repo.put("tasks", "task-1", { status: "RUNNING" });
      journal.append({ type: "TASK_CREATED", aggregateId: "task-1", payload: { status: "RUNNING" }, producer: "persistence", idempotencyKey: "task-1:created" });
    });

    expect(repo.get("tasks", "task-1")?.value).toEqual({ status: "RUNNING" });
    expect(journal.stats().events).toBe(1);
  });

  it("rolls BOTH back when the combined transaction fails — the case the book exists for", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const journal = createEventJournal(handle);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });
    repo.put("tasks", "task-1", { status: "RUNNING" });
    journal.append({ type: "TASK_CREATED", aggregateId: "task-1", payload: {}, producer: "persistence", idempotencyKey: "task-1:created" });
    const eventsBefore = journal.stats().events;

    expect(() =>
      withTransaction(handle, () => {
        repo.put("tasks", "task-1", { status: "COMPLETED" });
        journal.append({ type: "TASK_COMPLETED", aggregateId: "task-1", payload: {}, producer: "persistence", idempotencyKey: "task-1:completed" });
        throw new Error("publish failed after the state change");
      })
    ).toThrow("publish failed");

    // Neither half survived: this is the inconsistency Phase 02 removes.
    expect(repo.get("tasks", "task-1")?.value).toEqual({ status: "RUNNING" });
    expect(journal.stats().events).toBe(eventsBefore);
    expect(journal.hasIdempotencyKey("persistence", "task-1:completed")).toBe(false);
  });

  it("cannot be half-committed by a failure between the two writes", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const journal = createEventJournal(handle);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });
    // Fail on the SECOND write, after the state write has already happened inside the txn.
    expect(() =>
      withTransaction(handle, () => {
        repo.put("tasks", "task-9", { status: "RUNNING" });
        journal.append({ type: "TASK_CREATED", aggregateId: "task-9", payload: {}, producer: "persistence", idempotencyKey: "" });
      })
    ).toThrow();
    expect(repo.get("tasks", "task-9")).toBeUndefined();
    expect(journal.stats().events).toBe(0);
  });
});

describe("Phase 02 Task B — durable consumer cursor", () => {
  it("delivers in order and advances the cursor only after the handler returns", async () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    for (let index = 0; index < 3; index++) {
      journal.append({ type: "E", aggregateId: "a", payload: { index }, producer: "p", idempotencyKey: `k${index}` });
    }
    const consumer = createEventConsumer(handle, journal, "test");
    const seen: number[] = [];
    const outcome = await consumer.deliver((event) => { seen.push((event.payload as { index: number }).index); });
    expect(seen).toEqual([0, 1, 2]);
    expect(outcome.delivered).toBe(3);
    expect(outcome.stalled).toBe(false);
    expect(consumer.cursor().lastSequence).toBe(journal.head());
  });

  it("persists the cursor, so a restart resumes instead of replaying from zero", async () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const journal = createEventJournal(handle);
    for (let index = 0; index < 4; index++) {
      journal.append({ type: "E", aggregateId: "a", payload: { index }, producer: "p", idempotencyKey: `k${index}` });
    }
    const first = createEventConsumer(handle, journal, "restartable");
    await first.deliver((event) => { void event; }, { limit: 2 });
    const checkpoint = first.cursor().lastSequence;
    expect(checkpoint).toBeGreaterThan(0);

    // Reopen the file as a new process would.
    handle.close();
    const reopened = openTestDatabase(root);
    const journal2 = createEventJournal(reopened);
    const consumer2 = createEventConsumer(reopened, journal2, "restartable");
    expect(consumer2.cursor().lastSequence).toBe(checkpoint);

    const seen: number[] = [];
    await consumer2.deliver((event) => { seen.push((event.payload as { index: number }).index); });
    expect(seen, "only the undelivered tail is delivered").toEqual([2, 3]);
  });

  it("STOPS at the first failing handler rather than skipping it", async () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    for (let index = 0; index < 3; index++) {
      journal.append({ type: "E", aggregateId: "a", payload: { index }, producer: "p", idempotencyKey: `k${index}` });
    }
    const consumer = createEventConsumer(handle, journal, "failing");
    const outcome = await consumer.deliver((event) => {
      if ((event.payload as { index: number }).index === 1) throw new Error("handler exploded");
    });
    expect(outcome.delivered).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.stalled).toBe(true);
    expect(outcome.failures[0].message).toBe("handler exploded");
    // The cursor is before the failure, so the event is redelivered rather than lost.
    expect(consumer.cursor().lastSequence).toBe(journal.read(0, 1)[0].sequence);
    expect(consumer.cursor().failures).toBe(1);

    // A retry starting from the cursor succeeds and moves on.
    const retried = await consumer.deliver(() => { /* now healthy */ });
    expect(retried.delivered).toBe(2);
    expect(consumer.cursor().lastSequence).toBe(journal.head());
  });

  it("marks a replay as replayed, which is what lets a handler stay idempotent", async () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    journal.append({ type: "E", aggregateId: "a", payload: { index: 0 }, producer: "p", idempotencyKey: "once" });
    const consumer = createEventConsumer(handle, journal, "replaying");
    const effects: string[] = [];
    // An idempotent handler keys its external effect on the idempotency key.
    const handler = (event: { idempotencyKey: string }, context: { replayed: boolean }): void => {
      if (context.replayed) return;
      effects.push(event.idempotencyKey);
    };
    await consumer.deliver(handler as never);
    expect(effects).toEqual(["once"]);

    // Simulate "the crash happened after the effect but before the cursor advanced" by
    // seeking back: the effect must NOT be applied a second time.
    consumer.seek(0);
    const second = await consumer.deliver(handler as never);
    expect(second.delivered).toBe(1);
    expect(effects, "a replayed event must not repeat the external mutation").toEqual(["once"]);
  });

  it("reports replayed=false on a first delivery and true afterwards", async () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    journal.append({ type: "E", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "flag" });
    const consumer = createEventConsumer(handle, journal, "flags");
    const flags: boolean[] = [];
    await consumer.deliver((_event, context) => { flags.push(context.replayed); });
    consumer.seek(0);
    await consumer.deliver((_event, context) => { flags.push(context.replayed); });
    expect(flags).toEqual([false, true]);
    expect(consumer.handled(journal.read(0)[0].id)).toBe(true);
  });

  it("refuses to be constructed without a name", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    expect(() => createEventConsumer(handle, journal, "")).toThrow(/non-empty name/);
  });
});

describe("Phase 02 Task E — quarantine", () => {
  it("moves an undecodable event aside without blocking the journal", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    journal.append({ type: "GOOD", aggregateId: "a", payload: { v: 1 }, producer: "p", idempotencyKey: "good" });
    journal.append({ type: "BAD", aggregateId: "a", payload: { v: 2 }, producer: "p", idempotencyKey: "bad" });
    journal.append({ type: "GOOD2", aggregateId: "a", payload: { v: 3 }, producer: "p", idempotencyKey: "good2" });

    // Corrupt the middle row's payload the way a partial write or a bad migration would.
    handle.raw.prepare("UPDATE event_journal SET payload = ? WHERE idempotency_key = ?").run("{not json", "bad");

    const read = journal.read(0);
    expect(read.map((event) => event.type), "the good rows still come through").toEqual(["GOOD", "GOOD2"]);
    const quarantined = journal.quarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].reason).toContain("payload");
    // The raw row is preserved, so nothing was destroyed by being quarantined.
    expect(quarantined[0].raw).toContain("BAD");
    expect(journal.stats().quarantined).toBe(1);
  });

  it("records a row that violates the event shape", () => {
    const handle = openTestDatabase(tempRoot());
    const journal = createEventJournal(handle);
    journal.append({ type: "OK", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "ok" });
    handle.raw.prepare("UPDATE event_journal SET created_at = ? WHERE idempotency_key = ?").run("nonsense", "ok");
    expect(journal.read(0)).toEqual([]);
    expect(journal.quarantined()[0].reason).toContain("createdAt");
  });

  it("quarantines a corrupt STATE row instead of reporting the namespace as empty", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "append-only" });
    repo.append("tasks", "good-1", { v: 1 });
    repo.append("tasks", "corrupt", { v: 2 });
    repo.append("tasks", "good-2", { v: 3 });
    handle.raw.prepare("UPDATE state_record SET payload = ? WHERE record_key = ?").run("}{", "corrupt");

    const report = quarantine.scan("tasks", decodeVersioned);
    expect(report.inspected).toBe(3);
    expect(report.healthy).toBe(2);
    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0].key).toBe("corrupt");
    // The namespace is NOT empty: the two healthy rows survived and are readable.
    expect(repo.list("tasks").map((record) => record.key)).toEqual(["good-1", "good-2"]);
    expect(quarantine.entries("tasks")).toHaveLength(1);
  });

  it("requires a stated reason, and a declared namespace", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });
    repo.put("tasks", "a", { v: 1 });
    expect(() => quarantine.quarantine("tasks", "a", "  ")).toThrow(/reason/);
    expect(() => quarantine.quarantine("undeclared", "a", "because")).toThrow(/not declared/);
    expect(() => quarantine.quarantine("tasks", "missing", "because")).toThrow(/no such record/);
  });

  it("can restore a quarantined row, for the case where the reader was wrong", () => {
    const handle = openTestDatabase(tempRoot());
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    repo.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });
    repo.put("tasks", "a", { v: 1 });
    const entry = quarantine.quarantine("tasks", "a", "test");
    expect(repo.get("tasks", "a")).toBeUndefined();
    expect(quarantine.restore(entry.id)).toBe(true);
    expect(repo.get("tasks", "a")?.value).toEqual({ v: 1 });
    expect(quarantine.entries()).toHaveLength(0);
    expect(quarantine.restore(entry.id)).toBe(false);
  });
});

describe("Phase 02 Task A/E — schema version and migration", () => {
  const v1 = {
    version: 1,
    name: "create example table",
    up: (handle: DatabaseHandle): void => {
      handle.raw.exec("CREATE TABLE example(id TEXT PRIMARY KEY)");
    }
  };
  const v2 = {
    version: 2,
    name: "add example column",
    up: (handle: DatabaseHandle): void => {
      handle.raw.exec("ALTER TABLE example ADD COLUMN label TEXT");
    }
  };

  it("migrates forward, records each step, and reports the version", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const result = runMigrations(handle, [v1, v2], { root });
    expect(result.before.current).toBe(0);
    expect(result.after.current).toBe(2);
    expect(result.applied.map((record) => record.version)).toEqual([1, 2]);
    expect(result.checkpointVerified).toBe(true);
    expect(fs.existsSync(result.checkpointPath as string)).toBe(true);
    expect(readSchemaState(handle, 2).relation).toBe("current");
    // The health line reads the LIVE version, not the version at open time: a cached
    // value would report a successful migration as a no-op.
    expect(describeDatabase(handle.info())).toContain("schema=v2");
  });

  it("verifies the checkpoint by opening it, not by trusting the copy", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    repo.put("demo", "a", { v: 1 });
    const target = path.join(root, "manual-checkpoint.db");
    createCheckpoint(handle, target);
    const copy = openDatabaseFile(target);
    handles.push(copy);
    expect(checkIntegrity(copy).ok).toBe(true);
    expect(createStateRepository(copy).get("demo", "a")?.value).toEqual({ v: 1 });
    // Overwriting an existing checkpoint is refused: a rollback target must be stable.
    expect(() => createCheckpoint(handle, target)).toThrow(CheckpointError);
  });

  it("is a no-op when already current, and does not take a checkpoint for nothing", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    runMigrations(handle, [v1], { root });
    const again = runMigrations(handle, [v1], { root });
    expect(again.noop).toBe(true);
    expect(again.applied).toEqual([]);
  });

  it("REFUSES a database newer than this build instead of opening it read-write", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    runMigrations(handle, [v1, v2], { root });
    handle.raw.exec("PRAGMA user_version = 99");
    expect(() => runMigrations(handle, [v1], { root })).toThrow(SchemaAheadError);
    expect(readSchemaState(handle).relation).toBe("ahead");
  });

  it("refuses a non-contiguous plan before applying anything", () => {
    expect(() => validateMigrationPlan([v2], 0, 2)).toThrow(MigrationPlanError);
    expect(() => validateMigrationPlan([{ version: 1, name: "", up: () => {} }], 0, 1)).toThrow(MigrationPlanError);
    expect(() => validateMigrationPlan([v1, v2], 0, 2)).not.toThrow();
  });

  it("rolls a FAILED step back, leaving the version where it was", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    runMigrations(handle, [v1], { root });
    const exploding = {
      version: 2,
      name: "explodes midway",
      up: (h: DatabaseHandle): void => {
        h.raw.exec("CREATE TABLE half_written(id TEXT)");
        throw new Error("migration failed after creating a table");
      }
    };
    expect(() => runMigrations(handle, [v1, exploding], { root })).toThrow();
    // The version did not move, and the half-written table is gone with the transaction.
    expect(readSchemaState(handle).current).toBe(1);
    const table = handle.raw.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='half_written'").get();
    expect(table, "the failed step's DDL must be rolled back").toBeUndefined();
    expect(appliedMigrations(handle).map((record) => record.version)).toEqual([1]);
  });

  it("resumes deterministically when an earlier step is already recorded", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    // Hand-build a partially applied chain: v1 recorded (version bumped), v2 not yet.
    runMigrations(handle, [v1], { root });
    expect(appliedMigrations(handle).map((record) => record.version)).toEqual([1]);

    // A plain v1 -> v2 upgrade is NOT a resume, and must not be reported as one.
    const forward = runMigrations(handle, [v1, v2], { root });
    expect(forward.resumedAt, "a normal upgrade is not a resume").toBeUndefined();
    expect(forward.applied.map((record) => record.version)).toEqual([2]);
    expect(readSchemaState(handle, 2).current).toBe(2);
    const columns = handle.raw.prepare("PRAGMA table_info(example)").all().map((row) => String(row.name));
    expect(columns).toContain("label");

    // A partially applied chain IS a resume: v3 is recorded while the version is 2.
    const v3 = { version: 3, name: "third", up: (h: DatabaseHandle): void => { h.raw.exec("ALTER TABLE example ADD COLUMN note TEXT"); } };
    handle.raw.prepare("INSERT INTO state_migration(version, name, applied_at, checkpoint) VALUES (?, ?, ?, ?)").run(3, "third", new Date().toISOString(), null);
    const resumed = runMigrations(handle, [v1, v2, v3], { root });
    expect(resumed.resumedAt).toBe(3);
    expect(resumed.adopted, "the recorded step is adopted, not re-applied").toEqual([3]);
    expect(resumed.applied.map((record) => record.version)).toEqual([3]);
    expect(readSchemaState(handle, 3).current).toBe(3);
  });

  it("leaves no record behind when a step is interrupted, so a re-run applies it again", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    // The transaction that carries the DDL also carries the record, so an interrupted
    // step leaves neither. Modelled here by rolling the step's own transaction back.
    const interrupted = {
      version: 1,
      name: "interrupted",
      up: (h: DatabaseHandle): void => {
        h.raw.exec("CREATE TABLE interrupted(id TEXT)");
        throw new Error("process died mid-step");
      }
    };
    expect(() => runMigrations(handle, [interrupted], { root })).toThrow();
    expect(appliedMigrations(handle)).toEqual([]);
    expect(readSchemaState(handle, 1).current).toBe(0);
    const table = handle.raw.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='interrupted'").get();
    expect(table, "the interrupted step's table must not survive").toBeUndefined();
    // Re-running from the same state now succeeds cleanly.
    const fresh = {
      version: 1,
      name: "interrupted",
      up: (h: DatabaseHandle): void => { h.raw.exec("CREATE TABLE interrupted(id TEXT)"); }
    };
    runMigrations(handle, [fresh], { root });
    expect(appliedMigrations(handle).map((record) => record.version)).toEqual([1]);
  });

  it("refuses to migrate real data without a verified checkpoint", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const repo = createStateRepository(handle);
    repo.declareNamespace({ namespace: "demo", owner: "demo.owner", kind: "document" });
    repo.put("demo", "important", { v: "must not be lost" });
    // A checkpoint directory that cannot be created forces the checkpoint to fail.
    const blocker = path.join(root, "blocked");
    fs.writeFileSync(blocker, "this is a file, not a directory");
    expect(() => runMigrations(handle, [v1], { root, checkpointDir: path.join(blocker, "checkpoints") })).toThrow(CheckpointError);
    expect(repo.get("demo", "important")?.value).toEqual({ v: "must not be lost" });
  });

  it("lists checkpoints newest first", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    createCheckpoint(handle, path.join(root, "checkpoints", "one.db"));
    const listed = listCheckpoints(root);
    expect(listed.length).toBe(1);
    expect(listed[0].bytes).toBeGreaterThan(0);
    expect(listCheckpoints(path.join(root, "nowhere"))).toEqual([]);
  });
});

describe("Phase 02 Task E — recovery report", () => {
  it("reports a clean start, and says when the file was created", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const journal = createEventJournal(handle);
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    const report = inspectRecovery({ handle, journal, quarantine, consumers: [], root });
    expect(report.usable).toBe(true);
    expect(report.integrity.ok).toBe(true);
    expect(report.observations).toContain("database-created");
    expect(report.observations).toContain("integrity-ok");
    expect(report.observations).toContain("schema-current");
  });

  it("reports undelivered events and a stalled consumer as recoverable, not fatal", async () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const journal = createEventJournal(handle);
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    const consumer = createEventConsumer(handle, journal, "recovery");
    journal.append({ type: "E", aggregateId: "a", payload: {}, producer: "p", idempotencyKey: "k" });
    await consumer.deliver(() => { throw new Error("stalled"); });

    const report = inspectRecovery({ handle, journal, quarantine, consumers: [consumer], root });
    expect(report.usable, "a stalled consumer is a recoverable state, not a broken database").toBe(true);
    expect(report.observations).toContain("journal-has-undelivered-events");
    expect(report.observations).toContain("consumer-stalled");
    expect(report.consumers[0]).toMatchObject({ consumer: "recovery", pending: 1, stalled: true });
  });

  it("reports the schema as behind when a migration has not run", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const journal = createEventJournal(handle);
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    // A file whose version trails the migrations it has recorded: the shape an
    // interrupted chain leaves, and the reason the report distinguishes it.
    handle.raw.prepare("INSERT INTO state_migration(version, name, applied_at, checkpoint) VALUES (?, ?, ?, ?)").run(5, "future step", new Date().toISOString(), null);
    const report = inspectRecovery({ handle, journal, quarantine, consumers: [], root });
    expect(report.observations).toContain("schema-behind");
    expect(report.schema.expected).toBe(5);
    expect(report.schema.current).toBe(0);
    // A pending migration is not corruption: the store is still usable, which is what
    // lets a caller decide to migrate rather than refuse to start.
    expect(report.usable).toBe(true);
  });

  it("treats a fresh database as usable, not as 'behind'", () => {
    const root = tempRoot();
    const handle = openTestDatabase(root);
    const journal = createEventJournal(handle);
    const repo = createStateRepository(handle);
    const quarantine = createStateQuarantine(handle, repo);
    const report = inspectRecovery({ handle, journal, quarantine, consumers: [], root });
    expect(report.schema.current).toBe(0);
    expect(report.observations).toContain("schema-current");
    expect(report.usable).toBe(true);
  });
});
