import type { DomainEvent, DomainEventBus } from "../commander/event-bus";
import type { TelemetryStore, TelemetryOutcome } from "./telemetry-store";

/**
 * Bridges the domain bus (plan §13.1) into the Performance DB (plan §16): each
 * WORKER_COMPLETED / WORKER_FAILED event becomes a durable telemetry record
 * with decision → reason → outcome semantics.
 */
export function attachTelemetryRecorder(events: DomainEventBus, store: TelemetryStore, estimateTokens: (chars: number) => number = (chars) => Math.ceil(chars / 4)): () => void {
  const record = (event: DomainEvent, outcome: TelemetryOutcome, reason?: string) => {
    if (!event.taskId || !event.jobId) return;
    const durationMs = event.result?.metrics?.durationMs ?? 0;
    store.record({
      taskId: event.taskId,
      jobId: event.jobId,
      runtimeId: event.runtimeId ?? "unknown",
      role: event.type === "WORKER_COMPLETED" ? "worker" : "worker",
      outcome,
      ...(reason ? { reason } : {}),
      modelCalls: 1,
      estimatedTokens: estimateTokens(event.message?.length ?? 0),
      latencyMs: durationMs,
      retries: 0,
      at: new Date(event.at).toISOString()
    });
  };
  const offCompleted = events.subscribe("WORKER_COMPLETED", (event) => record(event, "SUCCESS"));
  const offFailed = events.subscribe("WORKER_FAILED", (event) => record(event, "FAILED", event.message));
  return () => { offCompleted(); offFailed(); };
}
