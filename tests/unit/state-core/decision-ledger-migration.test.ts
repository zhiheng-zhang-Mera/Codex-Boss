import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DecisionLedgerEntry } from "../../../src/shared/decision-ledger";
import { DecisionLedgerStore } from "../../../electron/commander/decision-ledger-store";
import { openDatabase, stateDatabasePath, type DatabaseHandle } from "../../../electron/state-core/database";
import { createNamespaceMigrationRegistry } from "../../../electron/state-core/namespace-migration";
import {
  DECISION_LEDGER_NAMESPACE,
  DECISION_LEDGER_REQUIRED_CLEAN,
  canonicalLedger,
  createDecisionLedgerMigration
} from "../../../electron/state-core/decision-ledger-migration";
import { createStateRepository } from "../../../electron/state-core/state-repository";
import { createEventJournal } from "../../../electron/state-core/event-journal";
import { canonicalEquals } from "../../../electron/state-core/shadow-compare";
import { withTransaction } from "../../../electron/state-core/transaction";

/**
 * Phase 02 Task C — the decision-ledger pilot migration.
 *
 * This is the acceptance the book specifies for a pilot: read the old baseline, shadow
 * read/compare, write authoritatively to the database, prove restart/replay, then retire
 * the old authoritative write. Gates 3 (atomic multi-state change), 5 (replay must not
 * repeat an external mutation) and 6 (no promotion without a passing comparison battery)
 * are all decided here.
 *
 * The tests drive the REAL `DecisionLedgerStore` over a REAL JSON file and the REAL state
 * database, so the comparison is between two actual durable representations rather than
 * between a representation and a stub.
 */

const dirs: string[] = [];
const handles: DatabaseHandle[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-pilot-"));
  dirs.push(dir);
  return dir;
}

function open(root: string): DatabaseHandle {
  const handle = openDatabase(stateDatabasePath(root));
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    try { handle.close(); } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

let counter = 0;
function decision(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  counter++;
  return {
    id: overrides.id ?? `dec-${String(counter).padStart(4, "0")}`,
    taskId: overrides.taskId ?? "task-1",
    createdAt: overrides.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString(),
    question: overrides.question ?? "should the task escalate to WORK?",
    candidates: overrides.candidates ?? ["stay in chat", "escalate"],
    chosen: overrides.chosen ?? "escalate",
    evidence: overrides.evidence ?? ["requiredCapabilities: browser"],
    outcome: overrides.outcome ?? "APPLIED",
    source: overrides.source ?? "question-interceptor",
    ...(overrides.policy ? { policy: overrides.policy } : {}),
    ...(overrides.rollback ? { rollback: overrides.rollback } : {})
  };
}

interface Pilot {
  root: string;
  handle: DatabaseHandle;
  legacyFile: string;
  legacy: DecisionLedgerStore;
  migration: ReturnType<typeof createDecisionLedgerMigration>;
  registry: ReturnType<typeof createNamespaceMigrationRegistry>;
}

function pilot(existing: DecisionLedgerEntry[] = []): Pilot {
  const root = tempRoot();
  const legacyFile = path.join(root, ".boss", "decision-ledger.json");
  if (existing.length > 0) {
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify({ schemaVersion: 1, entries: existing }, null, 2), "utf8");
  }
  const handle = open(root);
  const registry = createNamespaceMigrationRegistry(handle);
  const legacy = new DecisionLedgerStore(legacyFile);
  registry.declare({
    namespace: DECISION_LEDGER_NAMESPACE,
    owner: "persistence",
    requiredClean: DECISION_LEDGER_REQUIRED_CLEAN,
    jsonSunset: "removed once the database has been authoritative across two releases"
  });
  const migration = createDecisionLedgerMigration({ handle, registry, legacy });
  return { root, handle, legacyFile, legacy, migration, registry };
}

/** Drive the comparison battery to readiness. */
function fillBattery(target: Pilot): void {
  target.migration.beginShadow();
  for (let index = 0; index < DECISION_LEDGER_REQUIRED_CLEAN; index++) {
    target.migration.append(decision());
  }
}

describe("Phase 02 Task C — the legacy baseline is imported, not assumed", () => {
  it("copies the existing JSON entries into the database without duplicating them", () => {
    const existing = [decision({ id: "legacy-1" }), decision({ id: "legacy-2" }), decision({ id: "legacy-3" })];
    const target = pilot(existing);
    const first = target.migration.importLegacy();
    expect(first.imported).toBe(3);
    expect(first.alreadyPresent).toBe(0);
    // Idempotent: a second import adds nothing, so a restart cannot double the ledger.
    const second = target.migration.importLegacy();
    expect(second.imported).toBe(0);
    expect(second.alreadyPresent).toBe(3);

    const repository = createStateRepository(target.handle);
    expect(repository.count(DECISION_LEDGER_NAMESPACE)).toBe(3);
  });

  it("refuses to migrate a ledger the legacy store itself rejects", () => {
    const target = pilot();
    const invalid = { ...decision(), outcome: "NOT_A_REAL_OUTCOME" } as unknown as DecisionLedgerEntry;
    expect(() => target.migration.append(invalid)).toThrow();
  });

  it("compares the same set on both sides regardless of stored order", () => {
    const a = decision({ id: "b-id", createdAt: "2026-01-01T00:00:01.000Z" });
    const b = decision({ id: "a-id", createdAt: "2026-01-01T00:00:01.000Z" });
    // Same instant, different ids: a raw array comparison would call this a divergence.
    expect(canonicalEquals(canonicalLedger([a, b]), canonicalLedger([b, a]))).toBe(true);
  });
});

describe("Phase 02 Task C — the shadow comparison window", () => {
  it("writes both sides and agrees while JSON is still authoritative", () => {
    const target = pilot();
    target.migration.beginShadow();
    const result = target.migration.append(decision({ id: "shadow-1" }));
    expect(result.decision).toBe("agree");
    expect(target.migration.authority()).toBe("json");
    expect(target.migration.state()?.consecutiveClean).toBe(1);
    // Both durable representations really hold the entry.
    expect(target.legacy.list().map((entry) => entry.id)).toContain("shadow-1");
    expect(createStateRepository(target.handle).get(DECISION_LEDGER_NAMESPACE, "shadow-1")).toBeTruthy();
  });

  it("does NOT write the database before shadow comparison begins", () => {
    const target = pilot();
    target.migration.append(decision({ id: "unshadowed" }));
    expect(target.legacy.list().map((entry) => entry.id)).toContain("unshadowed");
    expect(createStateRepository(target.handle).get(DECISION_LEDGER_NAMESPACE, "unshadowed")).toBeUndefined();
  });

  it("DETECTS a divergence and refuses to advance authority", () => {
    const target = pilot();
    target.migration.beginShadow();
    target.migration.append(decision({ id: "base" }));
    expect(target.migration.state()?.consecutiveClean).toBe(1);

    // Corrupt the database side behind the migration's back, the way a partial write or a
    // bad migration would.
    const repository = createStateRepository(target.handle);
    repository.remove(DECISION_LEDGER_NAMESPACE, "base");

    const result = target.migration.compare();
    expect(result.decision).toBe("diverged");
    expect(target.migration.state()?.phase).toBe("diverged");
    expect(target.migration.state()?.consecutiveClean).toBe(0);
    expect(target.migration.state()?.divergences[0].detail).toContain("authoritative=");
    // Authority never moved, so the authoritative side is unharmed.
    expect(target.migration.authority()).toBe("json");
    expect(target.legacy.list().map((entry) => entry.id)).toContain("base");
  });

  it("refuses promotion until the battery has actually passed", () => {
    const target = pilot();
    target.migration.beginShadow();
    target.migration.append(decision());
    expect(target.migration.state()?.consecutiveClean).toBe(1);
    expect(target.migration.state()?.phase).toBe("shadow-comparing");
    expect(() => target.migration.promote()).toThrow(/comparison battery has not passed/);
    expect(target.migration.state()?.phase).toBe("shadow-comparing");
    expect(target.migration.authority()).toBe("json");
  });

  it("resets a clean run to zero when a divergence appears partway through", () => {
    const target = pilot();
    target.migration.beginShadow();
    for (let index = 0; index < DECISION_LEDGER_REQUIRED_CLEAN - 1; index++) target.migration.append(decision());
    expect(target.migration.state()?.consecutiveClean).toBe(DECISION_LEDGER_REQUIRED_CLEAN - 1);
    // One divergence destroys the run: it is not "mostly clean".
    createStateRepository(target.handle).clear(DECISION_LEDGER_NAMESPACE);
    expect(target.migration.compare().decision).toBe("diverged");
    expect(target.migration.state()?.consecutiveClean).toBe(0);
    expect(target.migration.state()?.phase).toBe("diverged");
  });
});

describe("Phase 02 Task C — gate 6: promotion only after the battery", () => {
  it("becomes ready exactly at the required clean count, then promotes", () => {
    const target = pilot();
    fillBattery(target);
    expect(target.migration.state()?.phase).toBe("ready-to-promote");
    expect(target.migration.state()?.consecutiveClean).toBe(DECISION_LEDGER_REQUIRED_CLEAN);

    const promoted = target.migration.promote();
    expect(promoted.authority).toBe("database");
    expect(promoted.phase).toBe("migrated");
    expect(promoted.promotedAt).toBeTruthy();
    expect(promoted.jsonSunset).toBeTruthy();
  });

  it("routes the authoritative write to the database after promotion", () => {
    const target = pilot();
    fillBattery(target);
    target.migration.promote();

    const jsonBefore = target.legacy.list().length;
    const result = target.migration.append(decision({ id: "post-promotion" }));
    // `authoritative-only` is the CORRECT answer once the phase is `migrated`: the
    // comparison window is closed, so the retired side is no longer written at all. That
    // is the book's final step ("remove old authoritative write") made observable.
    expect(result.decision).toBe("authoritative-only");
    const repository = createStateRepository(target.handle);
    expect(repository.get(DECISION_LEDGER_NAMESPACE, "post-promotion"), "the database side must have it").toBeTruthy();
    expect(target.legacy.list().length, "the retired JSON side must NOT receive post-promotion writes").toBe(jsonBefore);
    // The event is still published: retirement of the storage does not retire the journal.
    expect(createEventJournal(target.handle).hasIdempotencyKey("persistence", "post-promotion")).toBe(true);
  });

  it("stops writing the retired side once the comparison window is over", () => {
    const target = pilot();
    fillBattery(target);
    target.migration.promote();
    const repository = createStateRepository(target.handle);
    const jsonBefore = target.legacy.list().length;

    // The window is closed by the `migrated` phase itself, so a promoted namespace writes
    // ONLY the database. Asserted on the durable effect rather than on intent.
    target.migration.append(decision({ id: "after-window" }));
    expect(repository.get(DECISION_LEDGER_NAMESPACE, "after-window")).toBeTruthy();
    expect(target.legacy.list().length, "the retired side must be read-only after promotion").toBe(jsonBefore);
    // It is still readable, which is what "retained read-only compatibility" means.
    expect(target.migration.state()?.jsonSunset).toBeTruthy();
  });

  it("persists the promoted authority across a restart, and reads from the database", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    const first = open(root);
    const firstRegistry = createNamespaceMigrationRegistry(first);
    const firstLegacy = new DecisionLedgerStore(legacyFile);
    firstRegistry.declare({
      namespace: DECISION_LEDGER_NAMESPACE,
      owner: "persistence",
      requiredClean: 2,
      jsonSunset: "removed once stable"
    });
    const firstMigration = createDecisionLedgerMigration({ handle: first, registry: firstRegistry, legacy: firstLegacy });
    firstMigration.beginShadow();
    firstMigration.append(decision({ id: "a" }));
    firstMigration.append(decision({ id: "b" }));
    expect(firstMigration.state()?.phase).toBe("ready-to-promote");
    firstMigration.promote();
    expect(firstMigration.authority()).toBe("database");
    first.close();

    // A new process opens the same root: authority must still be the database.
    const second = open(root);
    const secondRegistry = createNamespaceMigrationRegistry(second);
    const secondMigration = createDecisionLedgerMigration({
      handle: second,
      registry: secondRegistry,
      legacy: new DecisionLedgerStore(legacyFile)
    });
    expect(secondMigration.authority(), "authority must survive a restart").toBe("database");
    expect(secondMigration.state()?.phase).toBe("migrated");
    expect(secondMigration.list().map((entry) => entry.id).sort()).toEqual(["a", "b"]);
  });

  it("can demote back to JSON and records why", () => {
    const target = pilot();
    fillBattery(target);
    target.migration.promote();
    const demoted = target.migration.demote("a divergence was found in production");
    expect(demoted.authority).toBe("json");
    expect(demoted.phase).toBe("diverged");
    expect(demoted.consecutiveClean).toBe(0);
    expect(demoted.divergences[0].operation).toBe("demote");
    expect(demoted.divergences[0].detail).toContain("divergence was found");
  });
});

describe("Phase 02 Task C — gate 5: events are idempotent and recoverable", () => {
  it("publishes one durable event per decision, keyed on the entry id", () => {
    const target = pilot();
    target.migration.beginShadow();
    target.migration.append(decision({ id: "evt-1" }));
    const journal = createEventJournal(target.handle);
    const events = journal.read(0).filter((event) => event.type === "DECISION_RECORDED");
    expect(events).toHaveLength(1);
    expect(events[0].idempotencyKey).toBe("evt-1");
    expect(events[0].id).toBe(`decision-ledger:evt-1`);
  });

  it("does not record a second event when the same decision is replayed", () => {
    const target = pilot();
    target.migration.beginShadow();
    const entry = decision({ id: "once" });
    target.migration.append(entry);
    // The legacy store is fail-closed on a duplicate id and throws, which is its own
    // documented behaviour and is preserved. What must NOT happen is a second durable
    // event, so that is what is asserted.
    expect(() => target.migration.append(entry)).toThrow(/already exists/);
    const journal = createEventJournal(target.handle);
    expect(journal.read(0).filter((event) => event.type === "DECISION_RECORDED")).toHaveLength(1);
    expect(target.migration.list().filter((item) => item.id === "once")).toHaveLength(1);
  });

  it("replaying the journal's own append is a no-op rather than a duplicate event", () => {
    const target = pilot();
    const journal = createEventJournal(target.handle);
    const first = journal.append({
      type: "DECISION_RECORDED",
      aggregateId: "task-1",
      producer: "persistence",
      idempotencyKey: "replay-once",
      payload: { entryId: "replay-once" }
    });
    const again = journal.append({
      type: "DECISION_RECORDED",
      aggregateId: "task-1",
      producer: "persistence",
      idempotencyKey: "replay-once",
      payload: { entryId: "replay-once" }
    });
    expect(again.duplicate).toBe(true);
    expect(again.event.sequence).toBe(first.event.sequence);
    expect(journal.read(0).filter((event) => event.idempotencyKey === "replay-once")).toHaveLength(1);
  });

  it("re-emits an event that the crash window lost, and converges", () => {
    const target = pilot();
    fillBattery(target);
    target.migration.promote();

    // Simulate "committed the ledger row, died before publishing the event" by writing a
    // row straight to the repository and leaving the journal alone. The row must be
    // timestamped AFTER promotion: `reconcile` only repairs writes that were supposed to
    // publish an event, and promotion is the boundary.
    const repository = createStateRepository(target.handle);
    const orphan = decision({ id: "orphan", createdAt: new Date().toISOString() });
    repository.put(DECISION_LEDGER_NAMESPACE, orphan.id, orphan);

    const journal = createEventJournal(target.handle);
    expect(journal.hasIdempotencyKey("persistence", "orphan")).toBe(false);
    const first = target.migration.reconcile();
    expect(first.reEmitted).toBe(1);
    expect(journal.hasIdempotencyKey("persistence", "orphan")).toBe(true);

    // Reconciling again is a no-op: the key makes the repair idempotent.
    const second = target.migration.reconcile();
    expect(second.reEmitted).toBe(0);
    expect(journal.read(0).filter((event) => event.idempotencyKey === "orphan")).toHaveLength(1);
  });

  it("does NOT publish events for history that predates promotion", () => {
    const target = pilot([decision({ id: "old-1", createdAt: "2026-01-01T00:00:00.000Z" })]);
    target.migration.importLegacy();
    fillBattery(target);
    target.migration.promote();

    // The imported baseline was never published, because it happened before the database
    // was authoritative. Re-emitting it would announce history as if it had just been
    // committed, so `reconcile` must leave it alone — this is the boundary that makes
    // "reEmitted" mean "repaired a lost commit" rather than "published everything".
    const journal = createEventJournal(target.handle);
    const before = journal.read(0).filter((event) => event.idempotencyKey === "old-1").length;
    const result = target.migration.reconcile();
    expect(before).toBe(0);
    expect(result.reEmitted).toBe(0);
    expect(journal.read(0).filter((event) => event.idempotencyKey === "old-1")).toHaveLength(0);
    // The row is still in the ledger: not publishing it did not discard it.
    expect(createStateRepository(target.handle).get(DECISION_LEDGER_NAMESPACE, "old-1")).toBeTruthy();
  });

  it("repairs only the writes that were supposed to publish, leaving the rest counted", () => {
    const target = pilot();
    fillBattery(target);
    target.migration.promote();
    const repository = createStateRepository(target.handle);
    // One post-promotion row with its event already present, one without.
    const published = decision({ id: "published", createdAt: new Date().toISOString() });
    repository.put(DECISION_LEDGER_NAMESPACE, published.id, published);
    target.migration.reconcile();
    const lost = decision({ id: "lost", createdAt: new Date().toISOString() });
    repository.put(DECISION_LEDGER_NAMESPACE, lost.id, lost);

    const result = target.migration.reconcile();
    expect(result.reEmitted, "the freshly lost event is repaired").toBe(1);
    expect(result.alreadyPresent, "the already-published one is counted, not re-emitted").toBeGreaterThanOrEqual(1);
  });

  it("refuses to reconcile while JSON is still authoritative", () => {
    const target = pilot();
    target.migration.beginShadow();
    target.migration.append(decision());
    // Nothing has been promoted, so the database side is a mirror: publishing events from
    // it would announce data the authoritative side never agreed to.
    expect(target.migration.reconcile()).toEqual({ reEmitted: 0, alreadyPresent: 0 });
  });
});

describe("Phase 02 Task C — the atomic multi-state acceptance (gate 3)", () => {
  it("commits several logical states and their event in ONE transaction", () => {
    const target = pilot();
    const repository = createStateRepository(target.handle);
    const journal = createEventJournal(target.handle);

    // Two namespaces plus an event in a single transaction: this is the "multiple logical
    // states" case the book asks a real business flow to prove.
    repository.declareNamespace({ namespace: "pilot.tasks", owner: "persistence", kind: "document" });
    withTransaction(target.handle, () => {
      repository.put("pilot.tasks", "task-1", { status: "COMPLETED" });
      repository.put(DECISION_LEDGER_NAMESPACE, "dec-atomic", decision({ id: "dec-atomic" }));
      journal.append({
        type: "TASK_COMPLETED",
        aggregateId: "task-1",
        producer: "persistence",
        idempotencyKey: "task-1:completed",
        payload: { status: "COMPLETED", decisionId: "dec-atomic" }
      });
    });

    expect(repository.get("pilot.tasks", "task-1")?.value).toEqual({ status: "COMPLETED" });
    expect(repository.get(DECISION_LEDGER_NAMESPACE, "dec-atomic")).toBeTruthy();
    expect(journal.hasIdempotencyKey("persistence", "task-1:completed")).toBe(true);
  });

  it("rolls all three back together when the transaction fails", () => {
    const target = pilot();
    const repository = createStateRepository(target.handle);
    const journal = createEventJournal(target.handle);
    repository.declareNamespace({ namespace: "pilot.tasks", owner: "persistence", kind: "document" });

    expect(() =>
      withTransaction(target.handle, () => {
        repository.put("pilot.tasks", "task-1", { status: "COMPLETED" });
        repository.put(DECISION_LEDGER_NAMESPACE, "dec-atomic", decision({ id: "dec-atomic" }));
        journal.append({ type: "TASK_COMPLETED", aggregateId: "task-1", producer: "persistence", idempotencyKey: "task-1:completed", payload: {} });
        throw new Error("the third participant refused");
      })
    ).toThrow("the third participant refused");

    expect(repository.get("pilot.tasks", "task-1")).toBeUndefined();
    expect(repository.get(DECISION_LEDGER_NAMESPACE, "dec-atomic")).toBeUndefined();
    expect(journal.hasIdempotencyKey("persistence", "task-1:completed")).toBe(false);
  });
});

describe("Phase 02 Task C — the migration registry refuses double authority", () => {
  it("refuses a namespace without a sunset condition", () => {
    const root = tempRoot();
    const handle = open(root);
    const registry = createNamespaceMigrationRegistry(handle);
    expect(() => registry.declare({ namespace: "x", owner: "o", requiredClean: 1, jsonSunset: "  " })).toThrow(/jsonSunset/);
  });

  it("refuses to redeclare a namespace under a different owner", () => {
    const root = tempRoot();
    const handle = open(root);
    const registry = createNamespaceMigrationRegistry(handle);
    registry.declare({ namespace: "x", owner: "owner-a", requiredClean: 1, jsonSunset: "later" });
    expect(() => registry.declare({ namespace: "x", owner: "owner-b", requiredClean: 1, jsonSunset: "later" })).toThrow(/recorded owner/);
  });

  it("refuses to promote a namespace it does not know", () => {
    const root = tempRoot();
    const handle = open(root);
    const registry = createNamespaceMigrationRegistry(handle);
    expect(() => registry.promote("unknown")).toThrow(/not declared/);
    expect(registry.authorityOf("unknown")).toBeUndefined();
  });
});
