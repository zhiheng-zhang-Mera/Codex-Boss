import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, stateDatabasePath, type DatabaseHandle } from "../../electron/state-core/database";
import { createEventJournal } from "../../electron/state-core/event-journal";
import { createStateRepository } from "../../electron/state-core/state-repository";
import { withTransaction } from "../../electron/state-core/transaction";

/**
 * One durable-event contract, shared by two evidence classes.
 *
 * `tests/unit/platform/durable-event-correctness.test.ts` runs it at a bounded volume in the hosted required
 * CI; `tests/unit/platform/durable-event-real-host-scale.test.ts` runs it at 100 000 events on the real host
 * under the `REAL_HOST_SCALE` tier. They call the SAME function on purpose: the contract must not have two
 * independently drifting implementations, because then the hosted case would be proving a different thing
 * from the scale case while wearing the same name.
 *
 * What the volume changes is the CLAIM, not the contract:
 *
 *   - bounded volume  -> the contract holds (correctness evidence)
 *   - 100 000 events  -> the contract holds AT SCALE on a real host (scale evidence)
 *
 * The helper is deliberately free of the test framework: it throws a plain `Error` naming the violated
 * property, and the callers assert the returned facts. That keeps it usable from a script or from the
 * control plane without dragging vitest in, and it means a failure message says which property broke rather
 * than which `expect` line ran.
 *
 * NOTHING here touches production code. It drives the shipped modules exactly as an application would.
 */

export interface DurableEventContractInput {
  /** How many events the scenario appends. */
  readonly eventCount: number;
  /** A database root. The scenario creates nothing outside it and never deletes it. */
  readonly root: string;
  /** Distinct aggregates the events are spread over. */
  readonly aggregates?: number;
  /** Timestamp stamped on every event, so two runs are byte-comparable. */
  readonly createdAt?: string;
  /** Producer name for the events. */
  readonly producer?: string;
}

export interface DurableEventMeasurement {
  readonly eventCount: number;
  readonly appendMillis: number;
  readonly readbackMillis: number;
  readonly reopenMillis: number;
  readonly totalMillis: number;
}

export interface DurableEventOutcome {
  readonly eventCount: number;
  readonly head: number;
  readonly statsEvents: number;
  readonly statsMaxSequence: number;
  readonly quarantined: number;
  readonly distinctIds: number;
  readonly aggregateEvents: number;
  /** The idempotency key whose replay was required to return the ORIGINAL durable row. */
  readonly replayedKey: string;
  readonly recountedEvents: number;
  readonly reopenedEvents: number;
  readonly reopenedHead: number;
  readonly lastIdempotencyKey: string;
  readonly measurement: DurableEventMeasurement;
}

const DEFAULT_AT = "2026-09-16T00:00:00.000Z";

/** Which keys the idempotency replay samples, for a given volume. */
function replaySample(eventCount: number): number[] {
  const wanted = [0, 1, 12_345, 50_000, eventCount - 1].filter((index) => index >= 0 && index < eventCount);
  return [...new Set(wanted)];
}

/**
 * Run the whole durable-event contract against one real database file.
 *
 * The order is the contract: append durably one call at a time, verify stats/head, read the whole journal
 * back through the paged cursor, verify per-aggregate ordering, replay a sample and require the ORIGINAL
 * rows, then close and reopen and require the counts and the last event to still be there.
 */
export function runDurableEventContract(input: DurableEventContractInput): DurableEventOutcome {
  const eventCount = Math.trunc(input.eventCount);
  if (!Number.isFinite(eventCount) || eventCount <= 0) throw new Error(`eventCount must be positive, got ${input.eventCount}`);
  const aggregates = Math.trunc(input.aggregates ?? 500);
  if (aggregates <= 0) throw new Error(`aggregates must be positive, got ${aggregates}`);
  const createdAt = input.createdAt ?? DEFAULT_AT;
  const producer = input.producer ?? "scale-test";
  const root = input.root;
  if (!fs.existsSync(root)) throw new Error(`the database root does not exist: ${root}`);

  const startedAt = Date.now();
  const handle: DatabaseHandle = openDatabase(stateDatabasePath(root));
  const journal = createEventJournal(handle);

  // 1. Append, one durable call at a time, and refuse a duplicate on a first write: the append path must
  //    neither start refusing under volume nor silently absorb a key it has never seen.
  const appendStarted = Date.now();
  for (let index = 0; index < eventCount; index++) {
    const result = journal.append({
      type: index % 5 === 0 ? "TASK_STATE_CHANGED" : "WORKER_COMPLETED",
      aggregateId: `task-${index % aggregates}`,
      producer,
      idempotencyKey: `k-${index}`,
      payload: { index, bucket: index % 97 },
      createdAt
    });
    if (result.duplicate) throw new Error(`event ${index} was reported as a duplicate on first write`);
  }
  const appendMillis = Date.now() - appendStarted;

  // 2. Stats and head describe exactly what was written.
  const stats = journal.stats();
  if (stats.events !== eventCount) throw new Error(`stats.events is ${stats.events}, expected ${eventCount}`);
  if (stats.maxSequence !== eventCount) throw new Error(`stats.maxSequence is ${stats.maxSequence}, expected ${eventCount}`);
  if (stats.quarantined !== 0) throw new Error(`an event was quarantined during a clean write sequence: ${stats.quarantined}`);
  if (journal.head() !== eventCount) throw new Error(`head is ${journal.head()}, expected ${eventCount}`);

  // 3. Read the whole journal back through the paged cursor: strictly monotone sequence, no repeated id,
  //    nothing lost.
  const readbackStarted = Date.now();
  const seenIds = new Set<string>();
  let previousSequence = 0;
  let read = 0;
  for (;;) {
    const batch = journal.read(previousSequence, 5000);
    if (batch.length === 0) break;
    for (const event of batch) {
      if (!(event.sequence > previousSequence)) throw new Error(`sequence did not increase at ${event.sequence} after ${previousSequence}`);
      previousSequence = event.sequence;
      if (seenIds.has(event.id)) throw new Error(`durable id ${event.id} appears twice`);
      seenIds.add(event.id);
      read++;
    }
  }
  const readbackMillis = Date.now() - readbackStarted;
  if (read !== eventCount) throw new Error(`the paged read returned ${read} events, expected ${eventCount}`);
  if (seenIds.size !== eventCount) throw new Error(`the journal holds ${seenIds.size} distinct ids, expected ${eventCount}`);

  // 4. Per-aggregate ordering is ascending, which is what a replay depends on.
  const aggregateEvents = journal.forAggregate("task-0");
  const expectedPerAggregate = Math.ceil(eventCount / aggregates);
  if (aggregateEvents.length !== expectedPerAggregate) {
    throw new Error(`aggregate task-0 holds ${aggregateEvents.length} events, expected ${expectedPerAggregate}`);
  }
  for (let index = 1; index < aggregateEvents.length; index++) {
    if (!(aggregateEvents[index].sequence > aggregateEvents[index - 1].sequence)) {
      throw new Error(`aggregate task-0 is not in ascending sequence order at index ${index}`);
    }
  }

  // 5. Idempotency: a replay re-uses the row rather than adding one, and — the failure the append hot path
  //    invites — the replay returns the ORIGINAL durable row, not the id, timestamp or payload this call
  //    supplied.
  const replayedKeyIndex = replaySample(eventCount)[0];
  for (const index of replaySample(eventCount)) {
    const replay = journal.append({
      type: "WORKER_COMPLETED",
      aggregateId: `task-${index % aggregates}`,
      producer,
      idempotencyKey: `k-${index}`,
      payload: { index, bucket: index % 97 },
      createdAt
    });
    if (!replay.duplicate) throw new Error(`event ${index} was appended twice on replay`);
    if (replay.event.sequence !== index + 1) throw new Error(`replay of event ${index} returned sequence ${replay.event.sequence}`);
  }
  {
    const original = journal.bySequence(replayedKeyIndex + 1);
    if (!original) throw new Error(`the original row for key k-${replayedKeyIndex} is missing`);
    const replay = journal.append({
      type: "TASK_STATE_CHANGED",
      aggregateId: "different-aggregate",
      producer,
      idempotencyKey: `k-${replayedKeyIndex}`,
      payload: { index: replayedKeyIndex, replaced: true },
      createdAt: "2027-01-01T00:00:00.000Z"
    });
    if (!replay.duplicate) throw new Error(`a replay with a different payload was not reported as a duplicate`);
    if (replay.event.id !== original.id) throw new Error(`a replay returned a different id (${replay.event.id} != ${original.id})`);
    if (replay.event.createdAt !== original.createdAt) throw new Error("a replay returned a different createdAt");
    if (replay.event.payload.index !== replayedKeyIndex && (replay.event.payload as { index?: number }).index !== replayedKeyIndex) {
      throw new Error("a replay returned a different payload");
    }
  }
  const recountedEvents = journal.stats().events;
  if (recountedEvents !== eventCount) throw new Error(`replays changed the row count: ${recountedEvents}`);

  // 6. Durability: the counts survive a close and reopen of the same file. Events accepted into WAL but
  //    never committed look identical to committed ones until the process that could tell them apart exits.
  const reopenStarted = Date.now();
  handle.close();
  const reopened = openDatabase(stateDatabasePath(root));
  const reopenedJournal = createEventJournal(reopened);
  const reopenedEvents = reopenedJournal.stats().events;
  const reopenedHead = reopenedJournal.head();
  const last = reopenedJournal.bySequence(eventCount);
  const reopenMillis = Date.now() - reopenStarted;
  reopened.close();
  if (reopenedEvents !== eventCount) throw new Error(`after reopen the journal holds ${reopenedEvents} events, expected ${eventCount}`);
  if (reopenedHead !== eventCount) throw new Error(`after reopen the head is ${reopenedHead}, expected ${eventCount}`);
  if (!last) throw new Error("after reopen the last event could not be read");
  if (last.idempotencyKey !== `k-${eventCount - 1}`) throw new Error(`after reopen the last event is ${last.idempotencyKey}`);

  return {
    eventCount,
    head: eventCount,
    statsEvents: stats.events,
    statsMaxSequence: stats.maxSequence,
    quarantined: stats.quarantined,
    distinctIds: seenIds.size,
    aggregateEvents: aggregateEvents.length,
    replayedKey: `k-${replayedKeyIndex}`,
    recountedEvents,
    reopenedEvents,
    reopenedHead,
    lastIdempotencyKey: last.idempotencyKey,
    measurement: {
      eventCount,
      appendMillis,
      readbackMillis,
      reopenMillis,
      totalMillis: Date.now() - startedAt
    }
  };
}

export interface RollbackAtomicityInput {
  readonly root: string;
  /** How many events and state writes the doomed transaction performs before throwing. */
  readonly writes: number;
}

export interface RollbackAtomicityOutcome {
  readonly writes: number;
  readonly rolledBackEvents: number;
  readonly rolledBackStateRows: number;
  readonly committedEvents: number;
  readonly committedStateRows: number;
}

/**
 * A failed transaction leaves the journal and the state store untouched, and the same work committed DOES
 * land — so the check cannot pass because nothing works.
 *
 * Shared for the same reason as the contract above: the hosted case and the real-host scale case must not
 * grow two different definitions of "atomic".
 */
export function runRollbackAtomicityCheck(input: RollbackAtomicityInput): RollbackAtomicityOutcome {
  const writes = Math.trunc(input.writes);
  if (writes <= 0) throw new Error(`writes must be positive, got ${input.writes}`);
  const handle = openDatabase(stateDatabasePath(input.root));
  const journal = createEventJournal(handle);
  const repository = createStateRepository(handle);
  repository.declareNamespace({ namespace: "tasks", owner: "persistence", kind: "document" });

  const before = journal.head();
  let threw = false;
  try {
    withTransaction(handle, () => {
      for (let index = 0; index < writes; index++) {
        repository.put("tasks", `key-${index}`, { index });
        journal.append({
          type: "TASK_STATE_CHANGED",
          aggregateId: `task-${index}`,
          producer: "scale-test",
          idempotencyKey: `r-${index}`,
          payload: { index },
          createdAt: DEFAULT_AT
        });
      }
      throw new Error("deliberate failure after the doomed writes");
    });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("the doomed transaction did not throw, so nothing was rolled back");
  const rolledBackEvents = journal.head() - before;
  const rolledBackStateRows = repository.count("tasks");
  if (rolledBackEvents !== 0) throw new Error(`a rolled-back transaction left ${rolledBackEvents} events in the journal`);
  if (journal.stats().events !== before) throw new Error("a rolled-back transaction left rows in the journal");
  if (rolledBackStateRows !== 0) throw new Error(`a rolled-back transaction left ${rolledBackStateRows} state rows behind`);

  withTransaction(handle, () => {
    for (let index = 0; index < writes; index++) {
      repository.put("tasks", `key-${index}`, { index });
      journal.append({
        type: "TASK_STATE_CHANGED",
        aggregateId: `task-${index}`,
        producer: "scale-test",
        idempotencyKey: `c-${index}`,
        payload: { index },
        createdAt: DEFAULT_AT
      });
    }
  });
  const committedEvents = journal.head() - before;
  const committedStateRows = repository.count("tasks");
  handle.close();
  if (committedEvents !== writes) throw new Error(`the committed transaction landed ${committedEvents} events, expected ${writes}`);
  if (committedStateRows !== writes) throw new Error(`the committed transaction landed ${committedStateRows} state rows, expected ${writes}`);

  return { writes, rolledBackEvents, rolledBackStateRows, committedEvents, committedStateRows };
}

/** A temp database root the caller owns and cleans up. */
export function temporaryDatabaseRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
