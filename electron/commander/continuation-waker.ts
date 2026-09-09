import type { DomainEvent, DomainEventBus, DomainEventType } from "./event-bus";

/**
 * Event-driven automation/council continuation (plan §13.1, AP13 seam).
 *
 * Today council and automation rounds advance through explicit calls
 * (`continueIfReady`) at dispatch/capture/human-release sites. This adapter
 * lets the domain bus wake continuation instead: WORKER_COMPLETED,
 * TOOL_RESULT_READY and HUMAN_APPROVED events carrying a taskId invoke the
 * supplied waker, with a per-task cooldown so a burst of events coalesces into
 * one continuation pass (the continuation logic itself is idempotent).
 */

/** Event kinds that can make an automation round ready to continue. */
export const CONTINUATION_EVENT_TYPES: readonly DomainEventType[] = ["WORKER_COMPLETED", "TOOL_RESULT_READY", "HUMAN_APPROVED"];

export interface ContinuationWakerOptions {
  /** Cooldown between wakeups of the same task (ms). Default 500. */
  cooldownMs?: number;
  /** Additional event types to wake on (e.g. DEPENDENCY_READY). */
  extraTypes?: DomainEventType[];
  now?: () => number;
}

export function taskIdForEvent(event: DomainEvent, types: readonly DomainEventType[] = CONTINUATION_EVENT_TYPES): string | undefined {
  if (!types.includes(event.type)) return undefined;
  // Only events that carry a concrete result/approval should wake a round.
  if (event.type === "WORKER_COMPLETED" && event.result?.status !== "SUCCESS") return undefined;
  return event.taskId;
}

/**
 * Subscribes the waker to continuation-relevant events. Returns a detach
 * function. Handler failures are isolated (never break the bus) and each task
 * is woken at most once per cooldown window.
 */
export function attachContinuationWaker(events: DomainEventBus, waker: (taskId: string) => void | Promise<void>, options: ContinuationWakerOptions = {}): () => void {
  const cooldownMs = options.cooldownMs ?? 500;
  const now = options.now ?? Date.now;
  const types = [...new Set([...CONTINUATION_EVENT_TYPES, ...(options.extraTypes ?? [])])];
  const lastWake = new Map<string, number>();

  const handler = (event: DomainEvent) => {
    const taskId = taskIdForEvent(event, types);
    if (!taskId) return;
    const last = lastWake.get(taskId) ?? 0;
    if (now() - last < cooldownMs) return;
    lastWake.set(taskId, now());
    try {
      const result = waker(taskId) as void | Promise<void>;
      if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch(() => {});
    } catch { /* continuation is advisory; store state decides */ }
  };
  const detach = types.map((type) => events.subscribe(type, handler));
  return () => { detach.forEach((off) => off()); };
}
