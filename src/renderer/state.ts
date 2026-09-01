import type { AppSnapshot, BossTask, TaskStatus } from "../shared/contracts";

export const emptySnapshot: AppSnapshot = { providers: [], tasks: [], events: [] };

export function taskCounts(tasks: BossTask[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>(
    (counts, task) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
    { queued: 0, running: 0, waiting: 0, completed: 0, failed: 0 }
  );
}

export function shortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
