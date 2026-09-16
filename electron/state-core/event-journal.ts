import { randomUUID } from "node:crypto";
import type { DatabaseHandle } from "./database";
import { withTransaction } from "./transaction";

/**
 * Durable event journal (platform foundation, Phase 02 Task B).
 *
 * An append-only log written in the SAME database as `state_record`, which is what makes
 * "change the state and publish the event" a single atomic commit. It is the durable
 * source of truth; the in-process `DomainEventBus` stays as the low-latency notification
 * layer downstream of it (Task D).
 *
 * ## The ten fields the book requires
 *
 * `id`, `sequence`, `type`, `aggregateId`, `payload`, `createdAt`, `schemaVersion`,
 * `idempotencyKey`, `producer` — all present, with `sequence` assigned by SQLite as a
 * rowid alias so it is strictly increasing in commit order without a counter table.
 *
 * ## Idempotency
 *
 * `(producer, idempotencyKey)` is uniquely indexed. A replay of the same logical event
 * therefore does not append a second row: `append` returns the EXISTING row with
 * `duplicate: true`, so a caller can distinguish "I appended this" from "this was
 * already appended" without guessing. This is the storage-layer half of the book's
 * "replay must not repeat an external side effect" rule; the consumer-cursor half lives
 * in `event-consumer.ts`.
 *
 * ## Quarantine
 *
 * A malformed event must not block the journal forever. `read` therefore SKIPS a row
 * that cannot be decoded and records it in `event_quarantine`, rather than throwing —
 * because throwing would leave the cursor stuck on the same bad row on every restart.
 * The original row is stored verbatim so it can still be inspected. Quarantining is a
 * decision that leaves evidence, which is what the book asks for instead of a silent
 * repair.
 */

interface JournalEventInput<T = unknown> {
  type: string;
  aggregateId: string;
  payload: T;
  producer: string;
  /** Stable key identifying this logical event; a replay reuses it. */
  idempotencyKey: string;
  schemaVersion?: number;
  /** Defaults to now. Supplied by a caller that wants a deterministic timestamp. */
  createdAt?: string;
  /** Defaults to a fresh uuid. Stable across a replay so the durable id does not churn. */
  id?: string;
}

export interface JournalEvent<T = unknown> {
  id: string;
  sequence: number;
  type: string;
  aggregateId: string;
  payload: T;
  createdAt: string;
  schemaVersion: number;
  idempotencyKey: string;
  producer: string;
}

interface AppendResult<T> {
  event: JournalEvent<T>;
  /** True when an event with this (producer, idempotencyKey) already existed. */
  duplicate: boolean;
  /** How many rows were read and quarantined while getting here (normally 0). */
  quarantined: number;
}

interface QuarantineEntry {
  id: string;
  sequence: number | null;
  type: string | null;
  raw: string;
  reason: string;
  quarantinedAt: string;
}

interface JournalStats {
  events: number;
  maxSequence: number;
  quarantined: number;
  consumers: number;
}

export interface EventJournal {
  append<T>(input: JournalEventInput<T>, now?: string): AppendResult<T>;
  /** Events with `sequence > after`, ascending, bounded by `limit`. */
  read(after: number, limit?: number): JournalEvent[];
  /** One event by durable id, or by sequence. */
  byId(id: string): JournalEvent | undefined;
  bySequence(sequence: number): JournalEvent | undefined;
  head(): number;
  /** Events for one aggregate, ascending. */
  forAggregate(aggregateId: string): JournalEvent[];
  hasIdempotencyKey(producer: string, idempotencyKey: string): boolean;
  quarantined(): QuarantineEntry[];
  quarantine(raw: string, reason: string, meta?: { id?: string; sequence?: number; type?: string }): QuarantineEntry;
  stats(): JournalStats;
}

interface EventRow {
  sequence: number;
  id: string;
  type: string;
  aggregate_id: string;
  payload: string;
  created_at: string;
  schema_version: number;
  idempotency_key: string;
  producer: string;
}

/** The event shape, validated field by field, so a bad row can be named precisely. */
export function validateEventRow(row: Partial<EventRow>): string[] {
  const problems: string[] = [];
  if (typeof row.id !== "string" || row.id.trim() === "") problems.push("id must be a non-empty string");
  if (row.sequence !== undefined && !Number.isInteger(Number(row.sequence))) problems.push("sequence must be an integer");
  if (typeof row.type !== "string" || row.type.trim() === "") problems.push("type must be a non-empty string");
  if (typeof row.aggregate_id !== "string" || row.aggregate_id.trim() === "") problems.push("aggregateId must be a non-empty string");
  if (typeof row.created_at !== "string" || Number.isNaN(Date.parse(row.created_at))) problems.push("createdAt must be an ISO timestamp");
  if (!Number.isInteger(Number(row.schema_version))) problems.push("schemaVersion must be an integer");
  if (typeof row.idempotency_key !== "string" || row.idempotency_key.trim() === "") problems.push("idempotencyKey must be a non-empty string");
  if (typeof row.producer !== "string" || row.producer.trim() === "") problems.push("producer must be a non-empty string");
  if (typeof row.payload !== "string") problems.push("payload must be stored as text");
  return problems;
}

export function createEventJournal(handle: DatabaseHandle): EventJournal {
  const nowIso = (): string => new Date().toISOString();

  function decode<T>(row: EventRow): JournalEvent<T> {
    const problems = validateEventRow(row);
    if (problems.length > 0) throw new Error(`malformed event: ${problems.join("; ")}`);
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch (error) {
      throw new Error(`malformed event payload: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      id: row.id,
      sequence: Number(row.sequence),
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: payload as T,
      createdAt: row.created_at,
      schemaVersion: Number(row.schema_version),
      idempotencyKey: row.idempotency_key,
      producer: row.producer
    };
  }

  function quarantineRow(row: EventRow, reason: string): void {
    handle.raw
      .prepare(
        `INSERT INTO event_quarantine(id, sequence, type, raw, reason, quarantined_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, quarantined_at = excluded.quarantined_at`
      )
      .run(String(row.id ?? `seq-${row.sequence}`), Number(row.sequence ?? 0), String(row.type ?? "unknown"), JSON.stringify(row), reason, nowIso());
  }

  const journal: EventJournal = {
    append<T>(input: JournalEventInput<T>, now = nowIso()): AppendResult<T> {
      const id = input.id ?? randomUUID();
      const createdAt = input.createdAt ?? now;
      const schemaVersion = input.schemaVersion ?? 1;
      const payload = JSON.stringify(input.payload ?? null);

      if (typeof input.type !== "string" || input.type.trim() === "") throw new Error("event type is required");
      if (typeof input.aggregateId !== "string" || input.aggregateId.trim() === "") throw new Error("event aggregateId is required");
      if (typeof input.producer !== "string" || input.producer.trim() === "") throw new Error("event producer is required");
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") throw new Error("event idempotencyKey is required (a replayable event needs one)");

      return withTransaction(handle, () => {
        const existing = handle.raw
          .prepare("SELECT * FROM event_journal WHERE producer = ? AND idempotency_key = ?")
          .get(input.producer, input.idempotencyKey) as unknown as EventRow | undefined;
        if (existing) return { event: decode<T>(existing), duplicate: true, quarantined: 0 };

        handle.raw
          .prepare(
            `INSERT INTO event_journal(id, type, aggregate_id, payload, created_at, schema_version, idempotency_key, producer)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, input.type, input.aggregateId, payload, createdAt, schemaVersion, input.idempotencyKey, input.producer);

        const row = handle.raw.prepare("SELECT * FROM event_journal WHERE id = ?").get(id) as unknown as EventRow;
        return { event: decode<T>(row), duplicate: false, quarantined: 0 };
      }, { label: `append ${input.type}` });
    },

    read(after: number, limit = 500): JournalEvent[] {
      const rows = handle.raw
        .prepare("SELECT * FROM event_journal WHERE sequence > ? ORDER BY sequence ASC LIMIT ?")
        .all(Math.max(0, Math.trunc(after)), Math.max(1, Math.trunc(limit))) as unknown as EventRow[];
      const events: JournalEvent[] = [];
      for (const row of rows) {
        try {
          events.push(decode(row));
        } catch (error) {
          // Skipped, not thrown: a throw here would pin the consumer cursor to this row
          // on every restart and stall the journal permanently.
          quarantineRow(row, error instanceof Error ? error.message : String(error));
        }
      }
      return events;
    },

    byId(id: string): JournalEvent | undefined {
      const row = handle.raw.prepare("SELECT * FROM event_journal WHERE id = ?").get(id) as unknown as EventRow | undefined;
      return row ? decode(row) : undefined;
    },

    bySequence(sequence: number): JournalEvent | undefined {
      const row = handle.raw.prepare("SELECT * FROM event_journal WHERE sequence = ?").get(Math.trunc(sequence)) as unknown as EventRow | undefined;
      return row ? decode(row) : undefined;
    },

    head(): number {
      const row = handle.raw.prepare("SELECT COALESCE(MAX(sequence), 0) AS head FROM event_journal").get();
      return Number(row?.head ?? 0);
    },

    forAggregate(aggregateId: string): JournalEvent[] {
      const rows = handle.raw
        .prepare("SELECT * FROM event_journal WHERE aggregate_id = ? ORDER BY sequence ASC")
        .all(aggregateId) as unknown as EventRow[];
      return rows.map((row) => decode(row));
    },

    hasIdempotencyKey(producer: string, idempotencyKey: string): boolean {
      const row = handle.raw
        .prepare("SELECT 1 AS present FROM event_journal WHERE producer = ? AND idempotency_key = ? LIMIT 1")
        .get(producer, idempotencyKey);
      return Boolean(row);
    },

    quarantined(): QuarantineEntry[] {
      const rows = handle.raw.prepare("SELECT * FROM event_quarantine ORDER BY quarantined_at ASC, id ASC").all();
      return rows.map((row) => ({
        id: String(row.id),
        sequence: row.sequence === null || row.sequence === undefined ? null : Number(row.sequence),
        type: row.type === null || row.type === undefined ? null : String(row.type),
        raw: String(row.raw),
        reason: String(row.reason),
        quarantinedAt: String(row.quarantined_at)
      }));
    },

    quarantine(raw: string, reason: string, meta = {}): QuarantineEntry {
      const entry: QuarantineEntry = {
        id: meta.id ?? randomUUID(),
        sequence: meta.sequence ?? null,
        type: meta.type ?? null,
        raw,
        reason,
        quarantinedAt: nowIso()
      };
      handle.raw
        .prepare("INSERT INTO event_quarantine(id, sequence, type, raw, reason, quarantined_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(entry.id, entry.sequence, entry.type, entry.raw, entry.reason, entry.quarantinedAt);
      return entry;
    },

    stats(): JournalStats {
      const events = handle.raw.prepare("SELECT COUNT(*) AS c FROM event_journal").get();
      const quarantined = handle.raw.prepare("SELECT COUNT(*) AS c FROM event_quarantine").get();
      const consumers = handle.raw.prepare("SELECT COUNT(*) AS c FROM event_consumer").get();
      return {
        events: Number(events?.c ?? 0),
        maxSequence: journal.head(),
        quarantined: Number(quarantined?.c ?? 0),
        consumers: Number(consumers?.c ?? 0)
      };
    }
  };

  return journal;
}
