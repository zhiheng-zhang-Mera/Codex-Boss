import type { AuditEvent } from "./contracts";

export interface TaskTimelineEntry {
  timestamp: string;
  event: AuditEvent["type"];
  message: string;
  stepId?: string;
  runtimeId?: string;
  evidenceRef?: string;
  budgetDelta?: AuditEvent["budgetDelta"];
}

export function timelineForTask(events: AuditEvent[], taskId: string, limit = 30): TaskTimelineEntry[] {
  return events.filter(event => event.taskId === taskId).slice(0, limit).reverse().map(event => ({
    timestamp: event.at, event: event.type, message: event.message,
    ...(event.stepId ? { stepId: event.stepId } : {}),
    ...(event.runtimeId ? { runtimeId: event.runtimeId } : {}),
    ...(event.evidenceRef ? { evidenceRef: event.evidenceRef } : {}),
    ...(event.budgetDelta ? { budgetDelta: event.budgetDelta } : {})
  }));
}
