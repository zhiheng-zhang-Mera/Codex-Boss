import type { DomainEvent, DomainEventBus } from "../commander/event-bus";
import type { ExperienceStore } from "../experience/experience-store";

/**
 * Bridges the domain bus (plan §13.1) into the Experience hierarchy (plan §16):
 * every WORKER_COMPLETED / WORKER_FAILED event becomes an experience observation
 * with a worker contribution metric — the AP16 "contribution-metric wiring into
 * observe" seam. The claim is the runtime-serving-role insight; observations stay
 * bounded (200/entry) and structural promotion rules are untouched.
 */

export interface ExperienceRecorderOptions {
  /** Maps a task id to its workspace id (or task id) — the observation source. */
  sourceFor?: (taskId: string) => string;
  /** Optional contribution weight, e.g. normalized by cost/tokens (default 1). */
  weightFor?: (event: DomainEvent) => number | undefined;
}

export function attachExperienceRecorder(events: DomainEventBus, store: ExperienceStore, options: ExperienceRecorderOptions = {}): () => void {
  const observe = (event: DomainEvent, outcome: "success" | "failure") => {
    if (!event.taskId || !event.runtimeId) return;
    const source = options.sourceFor?.(event.taskId) ?? event.taskId;
    const weight = options.weightFor?.(event) ?? 1;
    store.observe(`runtime ${event.runtimeId} serves its role`, "worker-routing", { source, contribution: { outcome, weight } });
    store.observe(`runtime ${event.runtimeId} outcome ${outcome}`, "runtime-health", { source, contribution: { outcome, weight } });
  };
  const offCompleted = events.subscribe("WORKER_COMPLETED", (event) => observe(event, "success"));
  const offFailed = events.subscribe("WORKER_FAILED", (event) => observe(event, "failure"));
  return () => { offCompleted(); offFailed(); };
}
