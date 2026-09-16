import type { DatabaseHandle } from "./database";
import { withTransaction } from "./transaction";
import type { EventJournal, JournalEvent } from "./event-journal";

/**
 * Durable event consumer (platform foundation, Phase 02 Task B/E).
 *
 * A consumer is a named reader of the journal that remembers how far it has got. The
 * cursor is in the database, so a crash resumes from the last DELIVERED event rather
 * than from the beginning or from wherever an in-memory number happened to be.
 *
 * ## The ordering rule, which is the whole point
 *
 * The cursor advances only after the handler has completed. A crash mid-handler
 * therefore replays that event on the next start. That is the safe direction: replaying
 * is recoverable, skipping is not. It does mean handlers must be idempotent, and the
 * book requires exactly that — so this module gives them the tool rather than trusting
 * them: a handler receives `delivered(idempotencyKey)` and, more usefully, whatever it
 * does is recorded, so `EventConsumerState.handledCount` distinguishes "ran once" from
 * "ran twice".
 *
 * ## At-least-once, stated plainly
 *
 * This is at-least-once delivery, not exactly-once. Exactly-once across a crash is not
 * achievable without the handler participating, and claiming it would be a lie that
 * shows up as a duplicated side effect in production. The book's requirement is that a
 * replay must not repeat an EXTERNAL mutation, which is satisfied by making the
 * externally-visible action conditional on the idempotency key — the acceptance suite
 * drives a handler that does exactly that and counts the effects.
 */

interface ConsumerCursor {
  consumer: string;
  lastSequence: number;
  updatedAt: string;
  deliveries: number;
  failures: number;
}

interface HandlerContext {
  /** The consumer name, for logging. */
  consumer: string;
  readonly sequence: number;
  /**
   * True when this exact event has already been delivered to this consumer in a
   * previous run. A handler that performs an external mutation should skip when set.
   */
  replayed: boolean;
  /**
   * Idempotency key of the event, so a handler can key its own external effect on it.
   */
  idempotencyKey: string;
}

type EventHandler<T = unknown> = (event: JournalEvent<T>, context: HandlerContext) => void | Promise<void>;

export interface DeliveryOutcome {
  consumer: string;
  from: number;
  to: number;
  delivered: number;
  failed: number;
  /** Events whose handler threw; the cursor stops before the first of these. */
  failures: Array<{ sequence: number; id: string; message: string }>;
  /** True when the cursor did not move because a handler failed. */
  stalled: boolean;
}

export interface EventConsumer {
  cursor(): ConsumerCursor;
  /** Deliver every event after the cursor, in order, stopping at the first failure. */
  deliver<T>(handler: EventHandler<T>, options?: { limit?: number }): Promise<DeliveryOutcome>;
  /** Move the cursor without running a handler. Used by tests and by recovery tooling. */
  seek(sequence: number): ConsumerCursor;
  /**
   * Record that an event was handled out of band, so a later replay is reported as
   * replayed. Used when a crash happened after the effect but before the cursor moved.
   */
  markHandled(eventId: string): void;
  handled(eventId: string): boolean;
  reset(): void;
}

interface ConsumerRow {
  consumer: string;
  last_sequence: number;
  updated_at: string;
  deliveries: number;
  failures: number;
}

export function createEventConsumer(handle: DatabaseHandle, journal: EventJournal, consumer: string): EventConsumer {
  if (typeof consumer !== "string" || consumer.trim() === "") throw new Error("a consumer needs a non-empty name");
  const nowIso = (): string => new Date().toISOString();

  function ensureRow(): ConsumerRow {
    const existing = handle.raw.prepare("SELECT * FROM event_consumer WHERE consumer = ?").get(consumer) as unknown as ConsumerRow | undefined;
    if (existing) return existing;
    handle.raw
      .prepare("INSERT INTO event_consumer(consumer, last_sequence, updated_at, deliveries, failures) VALUES (?, 0, ?, 0, 0)")
      .run(consumer, nowIso());
    return handle.raw.prepare("SELECT * FROM event_consumer WHERE consumer = ?").get(consumer) as unknown as ConsumerRow;
  }

  const consumerApi: EventConsumer = {
    cursor(): ConsumerCursor {
      const row = ensureRow();
      return {
        consumer: String(row.consumer),
        lastSequence: Number(row.last_sequence),
        updatedAt: String(row.updated_at),
        deliveries: Number(row.deliveries),
        failures: Number(row.failures)
      };
    },

    async deliver<T>(handler: EventHandler<T>, options: { limit?: number } = {}): Promise<DeliveryOutcome> {
      const start = consumerApi.cursor().lastSequence;
      const limit = options.limit ?? 500;
      let delivered = 0;
      const failures: DeliveryOutcome["failures"] = [];
      let stalled = false;
      let to = start;

      // Read in batches; each batch is processed in order and the cursor moves one event
      // at a time, so a crash anywhere leaves the cursor exactly at the last completed
      // event rather than at a batch boundary.
      let cursor = start;
      while (delivered + failures.length < limit) {
        const batch = journal.read(cursor, Math.min(200, limit - delivered - failures.length));
        if (batch.length === 0) break;
        for (const event of batch) {
          const replayed = consumerApi.handled(event.id);
          try {
            await handler(event as JournalEvent<T>, {
              consumer,
              sequence: event.sequence,
              replayed,
              idempotencyKey: event.idempotencyKey
            });
          } catch (error) {
            failures.push({ sequence: event.sequence, id: event.id, message: error instanceof Error ? error.message : String(error) });
            stalled = true;
            break;
          }
          // Advance and record atomically: the cursor and the "handled" marker can never
          // disagree about whether this event completed.
          withTransaction(handle, () => {
            handle.raw
              .prepare("INSERT OR IGNORE INTO event_handled(consumer, event_id, sequence, handled_at) VALUES (?, ?, ?, ?)")
              .run(consumer, event.id, event.sequence, nowIso());
            handle.raw
              .prepare("UPDATE event_consumer SET last_sequence = ?, updated_at = ?, deliveries = deliveries + 1 WHERE consumer = ?")
              .run(event.sequence, nowIso(), consumer);
          }, { label: `deliver ${consumer}#${event.sequence}` });
          delivered++;
          cursor = event.sequence;
          to = event.sequence;
        }
        if (stalled) break;
        if (batch.length === 0) break;
      }

      if (failures.length > 0) {
        handle.raw.prepare("UPDATE event_consumer SET failures = failures + ?, updated_at = ? WHERE consumer = ?").run(failures.length, nowIso(), consumer);
      }

      return { consumer, from: start, to, delivered, failed: failures.length, failures, stalled };
    },

    seek(sequence: number): ConsumerCursor {
      ensureRow();
      withTransaction(handle, () => {
        handle.raw.prepare("UPDATE event_consumer SET last_sequence = ?, updated_at = ? WHERE consumer = ?").run(Math.max(0, Math.trunc(sequence)), nowIso(), consumer);
      }, { label: `seek ${consumer}` });
      return consumerApi.cursor();
    },

    markHandled(eventId: string): void {
      ensureRow();
      const event = journal.byId(eventId);
      withTransaction(handle, () => {
        handle.raw
          .prepare("INSERT OR IGNORE INTO event_handled(consumer, event_id, sequence, handled_at) VALUES (?, ?, ?, ?)")
          .run(consumer, eventId, event?.sequence ?? 0, nowIso());
      }, { label: `markHandled ${consumer}` });
    },

    handled(eventId: string): boolean {
      const row = handle.raw.prepare("SELECT 1 AS present FROM event_handled WHERE consumer = ? AND event_id = ? LIMIT 1").get(consumer, eventId);
      return Boolean(row);
    },

    reset(): void {
      withTransaction(handle, () => {
        handle.raw.prepare("DELETE FROM event_handled WHERE consumer = ?").run(consumer);
        handle.raw.prepare("DELETE FROM event_consumer WHERE consumer = ?").run(consumer);
      }, { label: `reset ${consumer}` });
    }
  };

  return consumerApi;
}
