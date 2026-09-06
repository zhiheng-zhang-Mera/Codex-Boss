import type { DomainEvent, DomainEventBus } from "../commander/event-bus";
import { ProgressAggregator, type ProgressEvent, type ProgressSource, type ProgressSummary, type ProgressStatus } from "../../src/shared/progress";

/**
 * Bridges domain events (plan §13.1) into live progress (plan 9-6 Phase 3).
 * Each WORKER_COMPLETED/FAILED/DEPENDENCY_READY/HUMAN_APPROVED/TOOL_RESULT_READY
 * event becomes an operational ProgressEvent. The aggregator dedupes/coalesces,
 * so the controller can show a summary line (waiting/collecting/…) instead of
 * raw log spam — without ever exposing private chain-of-thought.
 */

export interface ProgressBridgeOptions {
  now?: () => string;
  maxTimeline?: number;
}

function stageOf(event: DomainEvent): { stage: string; label: string; status: ProgressStatus; source: ProgressSource; detail?: string } {
  switch (event.type) {
    case "WORKER_COMPLETED":
      return { stage: "dispatch", label: "回答已收到", status: "SUCCESS", source: "WEB" };
    case "WORKER_FAILED":
      return { stage: "dispatch", label: "回答失败，正在恢复", status: "FAILED", source: "WEB", detail: event.message };
    case "HUMAN_APPROVED":
      return { stage: "approval", label: "已确认，继续", status: "SUCCESS", source: "COMMANDER" };
    case "TOOL_RESULT_READY":
      return { stage: "collect", label: "回答已采集", status: "SUCCESS", source: "WEB" };
    case "DEPENDENCY_READY":
      return { stage: "recovery", label: "恢复就绪，继续执行", status: "RECOVERING", source: "SYSTEM", detail: event.message };
    default:
      return { stage: "dispatch", label: "处理中", status: "RUNNING", source: "SYSTEM" };
  }
}

export function attachProgressRecorder(events: DomainEventBus, options: ProgressBridgeOptions = {}): { aggregator: ProgressAggregator; detach: () => void } {
  const aggregator = new ProgressAggregator(options.maxTimeline ?? 200, options.now);
  const record = (event: DomainEvent) => {
    if (!event.taskId) return;
    aggregator.apply({ taskId: event.taskId, ...stageOf(event) });
  };
  const off = [
    events.subscribe("WORKER_COMPLETED", record),
    events.subscribe("WORKER_FAILED", record),
    events.subscribe("HUMAN_APPROVED", record),
    events.subscribe("TOOL_RESULT_READY", record),
    events.subscribe("DEPENDENCY_READY", record)
  ];
  return { aggregator, detach: () => off.forEach((unsubscribe) => unsubscribe()) };
}

export type { ProgressEvent, ProgressSummary };
