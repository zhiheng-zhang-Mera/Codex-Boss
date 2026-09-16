import type { DatabaseHandle } from "./database";
import { createEventJournal, type EventJournal, type JournalEvent } from "./event-journal";
import { createEventConsumer, type DeliveryOutcome, type EventConsumer } from "./event-consumer";

/**
 * Journal-to-bus bridge (platform foundation, Phase 02 Task D).
 *
 * Enforces the ordering the book specifies and nothing else:
 *
 *   transaction commit → durable journal → in-process notification
 *
 * The bus stays exactly what it was — a low-latency, fire-and-forget notification layer —
 * and this bridge is what makes it a notification OF something durable rather than the
 * only record of it. The direction is never reversed: nothing writes state in response to
 * a bus publish, and a bus handler that fails cannot affect what the journal holds.
 *
 * ## Why a separate notification channel rather than `DomainEventBus`
 *
 * `DomainEventBus` is typed to a closed union of twelve event types and its handlers
 * receive a `DomainEvent` with that type. The journal carries domain-specific events such
 * as `DECISION_RECORDED` that are deliberately NOT in that union — widening the union to
 * accept anything would destroy the compile-time exhaustiveness the bus currently gives
 * its subscribers.
 *
 * So the bridge exposes its own typed notification, and additionally forwards to a
 * `DomainEventBus` for the events whose type IS in the union. A caller that wants
 * low-latency notice of a durable fact subscribes here; a caller that wants the existing
 * typed domain events keeps using the bus unchanged.
 *
 * ## Crash and replay
 *
 * The cursor is the durable consumer cursor from `event-consumer.ts`, so a restart
 * resumes at the last DELIVERED event. A handler failure stops delivery rather than
 * skipping the event, and the failure is reported. A handler is told whether the event is
 * a replay, so an external effect can be made conditional on the idempotency key — which
 * is what lets the same notification path be safe to replay.
 */

export interface JournalNotification<T = unknown> {
  /** The journal's event type, e.g. `DECISION_RECORDED`. */
  type: string;
  sequence: number;
  id: string;
  aggregateId: string;
  idempotencyKey: string;
  producer: string;
  createdAt: string;
  payload: T;
  /** True when this event was already delivered to this consumer in an earlier run. */
  replayed: boolean;
}

type JournalSubscriber<T = unknown> = (notification: JournalNotification<T>) => void | Promise<void>;

/** The consumer name the bridge records its durable cursor under. */
export const JOURNAL_BRIDGE_CONSUMER = "journal-bridge";

interface JournalBridge {
  /** Deliver everything committed since the cursor, in order. */
  pump(): Promise<DeliveryOutcome>;
  /** Subscribe to one event type, or to every type with `"*"`. */
  subscribe(type: string, subscriber: JournalSubscriber): () => void;
  /** The number of registered subscribers for a type (including the wildcard). */
  subscriberCount(type?: string): number;
  /** The durable cursor position. */
  cursor(): number;
  /** How many notifications the bridge has delivered in this process. */
  delivered(): number;
  /** Notifications whose subscriber threw, newest last. */
  failures(): Array<{ sequence: number; type: string; message: string }>;
  /** The underlying durable consumer, for a diagnostic. */
  readonly consumer: EventConsumer;
  readonly journal: EventJournal;
}

interface JournalBridgeOptions {
  handle: DatabaseHandle;
  journal?: EventJournal;
  consumerName?: string;
  /**
   * An optional `DomainEventBus`-shaped sink. Only events whose type is one of the bus's
   * own twelve are forwarded, so the bus's type contract is respected rather than widened.
   *
   * The parameter is deliberately loose (`unknown` payload) and the caller narrows it:
   * `DomainEventBus.publish` takes the closed `Omit<DomainEvent, "at">` union, and this
   * module must not have to import that union to be usable. A caller passing a real bus
   * supplies `domainEventTypes`, which is what guarantees only valid types are forwarded.
   */
  domainBus?: { publish: (event: never) => void };
  /**
   * The bus event types this bridge may forward. Supplied by the caller so this module does
   * not have to import the bus's union — keeping the bridge usable without the bus.
   */
  domainEventTypes?: readonly string[];
}

/** How many subscriber failures the bridge retains. */
const FAILURE_RETENTION = 50;

export function createJournalBridge(options: JournalBridgeOptions): JournalBridge {
  const journal = options.journal ?? createEventJournal(options.handle);
  const consumer = createEventConsumer(options.handle, journal, options.consumerName ?? JOURNAL_BRIDGE_CONSUMER);
  const subscribers = new Map<string, Set<JournalSubscriber>>();
  const failures: Array<{ sequence: number; type: string; message: string }> = [];
  const forwardable = new Set(options.domainEventTypes ?? []);
  let delivered = 0;

  function subscribersFor(type: string): JournalSubscriber[] {
    return [...(subscribers.get(type) ?? []), ...(subscribers.get("*") ?? [])];
  }

  function recordFailure(sequence: number, type: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[journal-bridge] ${type} subscriber failed at #${sequence}: ${message}`);
    failures.push({ sequence, type, message });
    if (failures.length > FAILURE_RETENTION) failures.splice(0, failures.length - FAILURE_RETENTION);
  }

  const bridge: JournalBridge = {
    async pump(): Promise<DeliveryOutcome> {
      return consumer.deliver((event: JournalEvent, context) => {
        const notification: JournalNotification = {
          type: event.type,
          sequence: event.sequence,
          id: event.id,
          aggregateId: event.aggregateId,
          idempotencyKey: event.idempotencyKey,
          producer: event.producer,
          createdAt: event.createdAt,
          payload: event.payload,
          replayed: context.replayed
        };

        // A subscriber failure must stop the cursor rather than be swallowed: the book's
        // rule is that a committed event is not lost, and advancing past a failed
        // notification would be exactly that loss.
        const handlers = subscribersFor(event.type);
        for (const subscriber of handlers) {
          try {
            const result = subscriber(notification) as void | Promise<void>;
            if (result && typeof (result as Promise<void>).then === "function") {
              return (result as Promise<void>).then(() => { delivered++; });
            }
          } catch (error) {
            recordFailure(event.sequence, event.type, error);
            throw error;
          }
        }

        // Forwarding to the domain bus is best-effort by design: the bus is a notification
        // layer, so a bus failure must not stall the durable cursor.
        if (options.domainBus && forwardable.has(event.type)) {
          try {
            (options.domainBus.publish as (value: unknown) => void)({
              type: event.type,
              ...(typeof event.payload === "object" && event.payload !== null ? event.payload as Record<string, unknown> : {})
            });
          } catch (error) {
            recordFailure(event.sequence, event.type, error);
          }
        }
        delivered++;
      });
    },

    subscribe(type, subscriber) {
      const set = subscribers.get(type) ?? new Set<JournalSubscriber>();
      set.add(subscriber);
      subscribers.set(type, set);
      return () => { set.delete(subscriber); };
    },

    subscriberCount(type) {
      if (type === undefined) {
        let total = 0;
        for (const set of subscribers.values()) total += set.size;
        return total;
      }
      return subscribersFor(type).length;
    },

    cursor: () => consumer.cursor().lastSequence,
    delivered: () => delivered,
    failures: () => [...failures],
    consumer,
    journal
  };

  return bridge;
}
