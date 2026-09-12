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
 */
export class DomainEventBus {
  private readonly handlers = new Map<DomainEventType, Set<DomainEventHandler>>();

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
        if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch(() => {});
      } catch { /* handler isolation */ }
    }
  }
}
