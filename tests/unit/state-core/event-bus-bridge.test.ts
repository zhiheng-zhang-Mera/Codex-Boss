import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, stateDatabasePath, type DatabaseHandle } from "../../../electron/state-core/database";
import { createEventJournal } from "../../../electron/state-core/event-journal";
import { createJournalBridge, JOURNAL_BRIDGE_CONSUMER, type JournalNotification } from "../../../electron/state-core/event-bus-bridge";
import { DomainEventBus } from "../../../electron/commander/event-bus";
import { withTransaction } from "../../../electron/state-core/transaction";
import { createStateRepository } from "../../../electron/state-core/state-repository";

/**
 * Phase 02 Task D — the journal-to-bus bridge.
 *
 * The book's rule is an ORDERING: `transaction commit → durable journal → in-process
 * notification`, and explicitly not the reverse. These tests assert the ordering as an
 * observable property rather than as a comment:
 *
 *   - a notification is only ever seen for an event that is already durable;
 *   - a subscriber failure does NOT advance the cursor, so the notification is retried
 *     rather than lost;
 *   - a rollback produces no notification at all;
 *   - the bus is downstream, so a bus failure cannot stop the cursor.
 */

const dirs: string[] = [];
const handles: DatabaseHandle[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-bridge-"));
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

describe("Phase 02 Task D — the journal is upstream of the notification", () => {
  it("notifies subscribers for a committed event and records the cursor", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bridge = createJournalBridge({ handle, journal });
    const seen: JournalNotification[] = [];
    bridge.subscribe("DECISION_RECORDED", (notification) => { seen.push(notification); });

    journal.append({ type: "DECISION_RECORDED", aggregateId: "task-1", producer: "persistence", idempotencyKey: "d1", payload: { entryId: "d1" } });
    const outcome = await bridge.pump();

    expect(outcome.delivered).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("DECISION_RECORDED");
    expect(seen[0].idempotencyKey).toBe("d1");
    expect(seen[0].replayed).toBe(false);
    expect(bridge.cursor()).toBe(journal.head());
    expect(bridge.delivered()).toBe(1);
  });

  it("notifies ONLY after the event is durable: a rolled-back append notifies nobody", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const repository = createStateRepository(handle);
    repository.declareNamespace({ namespace: "pilot.tasks", owner: "persistence", kind: "document" });
    const bridge = createJournalBridge({ handle, journal });
    const seen: JournalNotification[] = [];
    bridge.subscribe("*", (notification) => { seen.push(notification); });

    expect(() =>
      withTransaction(handle, () => {
        repository.put("pilot.tasks", "task-1", { status: "COMPLETED" });
        journal.append({ type: "TASK_COMPLETED", aggregateId: "task-1", producer: "persistence", idempotencyKey: "t1", payload: {} });
        throw new Error("the commit failed");
      })
    ).toThrow("the commit failed");

    // Nothing was durable, so nothing is notified — even though append() ran inside the
    // transaction and returned successfully before the rollback.
    const outcome = await bridge.pump();
    expect(outcome.delivered).toBe(0);
    expect(seen).toEqual([]);
    expect(journal.stats().events).toBe(0);
    expect(repository.get("pilot.tasks", "task-1")).toBeUndefined();
  });

  it("resumes from the durable cursor after a restart", async () => {
    const root = tempRoot();
    const first = open(root);
    const journal1 = createEventJournal(first);
    const bridge1 = createJournalBridge({ handle: first, journal: journal1 });
    const seen1: string[] = [];
    bridge1.subscribe("*", (notification) => { seen1.push(notification.idempotencyKey); });
    journal1.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "a1", payload: {} });
    await bridge1.pump();
    expect(seen1).toEqual(["a1"]);
    const headBeforeClose = journal1.head();
    first.close();

    try {
      const second = open(root);
      const journal2 = createEventJournal(second);
      const bridge2 = createJournalBridge({ handle: second, journal: journal2 });
      expect(bridge2.cursor(), "the cursor survives the restart").toBe(headBeforeClose);
      const seen2: string[] = [];
      bridge2.subscribe("*", (notification) => { seen2.push(notification.idempotencyKey); });
      journal2.append({ type: "B", aggregateId: "x", producer: "p", idempotencyKey: "b1", payload: {} });
      await bridge2.pump();
      expect(seen2, "only the new event is delivered").toEqual(["b1"]);
    } catch (error) {
      // Surface where it failed rather than only that it did.
      throw new Error(`restart phase failed: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
    }
  });

  it("STOPS at a failing subscriber instead of advancing past the event", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bridge = createJournalBridge({ handle, journal });
    let calls = 0;
    bridge.subscribe("A", () => {
      calls++;
      if (calls === 1) throw new Error("subscriber exploded");
    });
    journal.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "a1", payload: {} });

    const first = await bridge.pump();
    expect(first.failed).toBe(1);
    expect(first.stalled).toBe(true);
    expect(first.delivered).toBe(0);
    // The cursor did not move, so the notification is retried rather than lost.
    expect(bridge.cursor()).toBe(0);
    expect(bridge.failures()[0].message).toBe("subscriber exploded");

    const retry = await bridge.pump();
    expect(retry.delivered).toBe(1);
    expect(bridge.cursor()).toBe(journal.head());
  });

  it("tells a subscriber that an event is a replay, so its effect can be conditional", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bridge = createJournalBridge({ handle, journal });
    const effects: string[] = [];
    bridge.subscribe("*", (notification) => {
      if (notification.replayed) return;
      effects.push(notification.idempotencyKey);
    });
    journal.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "once", payload: {} });
    await bridge.pump();
    // Rewind the cursor, which is what a crash before the cursor advanced looks like.
    bridge.consumer.seek(0);
    await bridge.pump();
    expect(effects, "a replayed notification must not repeat the effect").toEqual(["once"]);
  });
});

describe("Phase 02 Task D — the bus is downstream and never the source of truth", () => {
  it("forwards only the event types the bus declares, leaving its union closed", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bus = new DomainEventBus();
    const received: string[] = [];
    bus.subscribe("WORKER_COMPLETED", (event) => { received.push(event.type); });
    const bridge = createJournalBridge({ handle, journal, domainBus: bus, domainEventTypes: ["WORKER_COMPLETED", "HUMAN_APPROVED"] });

    journal.append({ type: "WORKER_COMPLETED", aggregateId: "job-1", producer: "commander", idempotencyKey: "w1", payload: { taskId: "task-1" } });
    // A durable event whose type is NOT in the bus union: it must reach journal subscribers
    // and must NOT be forced into the bus.
    journal.append({ type: "DECISION_RECORDED", aggregateId: "task-1", producer: "persistence", idempotencyKey: "d1", payload: { entryId: "d1" } });
    const bridged: string[] = [];
    bridge.subscribe("*", (notification) => { bridged.push(notification.type); });

    await bridge.pump();
    expect(received).toEqual(["WORKER_COMPLETED"]);
    expect(bridged).toEqual(["WORKER_COMPLETED", "DECISION_RECORDED"]);
    // The bus carries the payload through, so its subscribers see the domain fields.
    expect(bus.handlerFailures()).toEqual([]);
  });

  it("does not stall the durable cursor when the BUS throws", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bus = { publish: () => { throw new Error("the bus is broken"); } };
    const bridge = createJournalBridge({ handle, journal, domainBus: bus, domainEventTypes: ["WORKER_COMPLETED"] });
    journal.append({ type: "WORKER_COMPLETED", aggregateId: "job-1", producer: "commander", idempotencyKey: "w1", payload: {} });

    const outcome = await bridge.pump();
    // The event IS durable and WAS delivered, so the cursor advances; the bus failure is
    // recorded as a notification-layer problem, not as a loss of the durable fact.
    expect(outcome.delivered).toBe(1);
    expect(bridge.cursor()).toBe(journal.head());
    expect(bridge.failures().map((failure) => failure.message)).toContain("the bus is broken");
  });

  it("delivers an event to both a typed subscriber and a wildcard subscriber", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bridge = createJournalBridge({ handle, journal });
    const typed: string[] = [];
    const wildcard: string[] = [];
    bridge.subscribe("A", () => { typed.push("typed"); });
    bridge.subscribe("*", () => { wildcard.push("wildcard"); });
    expect(bridge.subscriberCount("A")).toBe(2);
    expect(bridge.subscriberCount()).toBe(2);

    journal.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "a1", payload: {} });
    await bridge.pump();
    expect(typed).toEqual(["typed"]);
    expect(wildcard).toEqual(["wildcard"]);
  });

  it("unsubscribes cleanly, so a disposed listener cannot be notified", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const bridge = createJournalBridge({ handle, journal });
    const seen: string[] = [];
    const off = bridge.subscribe("A", () => { seen.push("first"); });
    off();
    journal.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "a1", payload: {} });
    await bridge.pump();
    expect(seen).toEqual([]);
    expect(bridge.subscriberCount("A")).toBe(0);
  });

  it("uses one named durable consumer, so two bridges do not share a cursor", async () => {
    const handle = open(tempRoot());
    const journal = createEventJournal(handle);
    const one = createJournalBridge({ handle, journal });
    const two = createJournalBridge({ handle, journal, consumerName: "other-bridge" });
    expect(one.consumer.cursor().consumer).toBe(JOURNAL_BRIDGE_CONSUMER);
    expect(two.consumer.cursor().consumer).toBe("other-bridge");
    journal.append({ type: "A", aggregateId: "x", producer: "p", idempotencyKey: "a1", payload: {} });
    await one.pump();
    expect(one.cursor()).toBe(journal.head());
    // The second consumer has its own position and still has the event to deliver.
    expect(two.cursor()).toBe(0);
    expect((await two.pump()).delivered).toBe(1);
  });
});
