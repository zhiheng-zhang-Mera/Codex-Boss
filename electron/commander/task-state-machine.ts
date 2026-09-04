import type { TaskStatus } from "../../src/shared/contracts";

const transitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["waiting", "paused", "cancelled", "completed", "failed"],
  waiting: ["running", "paused", "cancelled", "completed", "failed"],
  paused: ["running", "cancelled"],
  cancelled: [],
  completed: [],
  failed: ["queued"]
};

export class TaskStateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean { return from === to || transitions[from].includes(to); }
  transition(from: TaskStatus, to: TaskStatus): TaskStatus {
    if (!this.canTransition(from, to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
    return to;
  }
}
