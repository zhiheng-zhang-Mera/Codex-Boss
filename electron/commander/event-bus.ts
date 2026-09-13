import type { RuntimeResult } from "../runtimes/runtime";

/** Domain events (plan §13.1) the scheduler/runtime layers publish and consume. */
export type DomainEventType =
  | "WORKER_COMPLETED"
  | "WORKER_FAILED"
  | "DEPENDENCY_READY"
  | "PROVIDER_AVAILABLE"
  | "TOOL_RESULT_READY"
  | "HUMAN_APPROVED"
  // checkpoint-1 §56: the structured theme lifecycle events.
  | "THEME_DRAFT_CREATED"
  | "THEME_PREVIEWED"
  | "THEME_VALIDATED"
  | "THEME_INSTALLED"
  | "THEME_ACTIVATED"
  | "THEME_FALLBACK";

export interface DomainEvent {
  type: DomainEventType;
  taskId?: string;
  jobId?: string;
  runtimeId?: string;
  retryAt?: number;
  message?: string;
  result?: RuntimeResult;
  at: number;
}

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * In-process, typed domain event bus. Handlers are isolated: one throwing or
 * rejecting handler never prevents the rest from receiving the event, and
 * publish never blocks the publisher on handler work.
 *
 * Isolation is not silence. Durable-state writers subscribe here — the telemetry
 * and experience recorders both write files — so a handler failure is retained on
 * the bus (`handlerFailures()`) and reported instead of vanishing into an empty
 * catch. A reader can then tell "no events" apart from "events whose effect was
 * lost".
 */
export interface HandlerFailure {
  type: DomainEventType;
  message: string;
  at: number;
}

/** How many handler failures are retained (bounded; oldest are dropped). */
export const HANDLER_FAILURE_RETENTION = 50;

export class DomainEventBus {
  private readonly handlers = new Map<DomainEventType, Set<DomainEventHandler>>();
  private readonly failures: HandlerFailure[] = [];

  /** Handler failures observed so far, oldest first. */
  handlerFailures(): HandlerFailure[] {
    return [...this.failures];
  }

  private recordFailure(type: DomainEventType, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // stderr as well: the bus is used by a desktop app whose logs are the only
    // place a background handler's failure can surface while it is running.
    console.error(`[event-bus] ${type} handler failed: ${message}`);
    this.failures.push({ type, message, at: Date.now() });
    if (this.failures.length > HANDLER_FAILURE_RETENTION) this.failures.splice(0, this.failures.length - HANDLER_FAILURE_RETENTION);
  }

  subscribe(type: DomainEventType, handler: DomainEventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
    return () => set.delete(handler);
  }

  on(type: DomainEventType, handler: DomainEventHandler): () => void { return this.subscribe(type, handler); }

  publish(event: Omit<DomainEvent, "at">): void {
    const full: DomainEvent = { ...event, at: Date.now() };
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        const result = handler(full) as void | Promise<void>;
        if (result && typeof (result as Promise<void>).catch === "function") {
          void (result as Promise<void>).catch((error: unknown) => this.recordFailure(event.type, error));
        }
      } catch (error) {
        this.recordFailure(event.type, error);
      }
    }
  }
}
