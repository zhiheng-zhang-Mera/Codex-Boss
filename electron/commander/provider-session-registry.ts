import type { TaskLedger, WorkerSession } from "./task-ledger";
export class ProviderSessionRegistry {
  constructor(private readonly ledger: TaskLedger) {}
  list(taskId: string): WorkerSession[] { return this.ledger.load(taskId)?.sessions ?? []; }
  save(session: WorkerSession): void {
    this.ledger.update(session.taskId, "session checkpoint", (record) => {
      const previous = record.sessions.findIndex((item) => item.id === session.id);
      if (previous < 0) record.sessions.push(session); else record.sessions[previous] = session;
    });
  }
  forRuntime(taskId: string, runtimeId: string): WorkerSession | undefined { return this.list(taskId).find((item) => item.provider === runtimeId); }
}
