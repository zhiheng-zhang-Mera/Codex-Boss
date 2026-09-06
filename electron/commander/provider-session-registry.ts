import type { TaskLedger, WorkerSession } from "./task-ledger";
import type { SessionLifecycleKind } from "../../src/shared/session-state";
import { isSessionLifecycleKind, sessionKindForResumeStrategy, transitionSessionKind } from "../../src/shared/session-state";

/**
 * Owns per-task worker sessions with an explicit lifecycle kind (AP07a).
 * Sessions are bound to (taskId, provider) plus the task's workspace when one
 * exists; health stays separate from lifecycle state.
 */
export class ProviderSessionRegistry {
  constructor(private readonly ledger: TaskLedger) {}

  list(taskId: string): WorkerSession[] { return this.ledger.load(taskId)?.sessions ?? []; }

  forRuntime(taskId: string, runtimeId: string): WorkerSession | undefined { return this.list(taskId).find((item) => item.provider === runtimeId); }

  /**
   * Returns the session for (task, provider), creating one as NEW when absent
   * or marking the existing one CONTINUE when work resumes on it. `kind` may
   * force a lifecycle transition (e.g. REVIEW when entering a review phase).
   */
  sessionFor(taskId: string, provider: string, workspaceId?: string, kind?: SessionLifecycleKind): WorkerSession {
    const existing = this.forRuntime(taskId, provider);
    if (existing) {
      const nextKind = kind ? transitionSessionKind(existing.kind ?? "NEW", kind) : existing.kind ?? "NEW";
      this.save({ ...existing, kind: nextKind, ...(workspaceId ? { workspaceId } : {}) });
      return this.forRuntime(taskId, provider)!;
    }
    const session: WorkerSession = {
      id: `${taskId}/${provider}/${Date.now()}`, provider, taskId, checkpoint: this.ledger.load(taskId)?.revision ?? 0, health: "AVAILABLE",
      resumeStrategy: "RECONSTRUCT", kind: kind ?? "NEW", ...(workspaceId ? { workspaceId } : {})
    };
    this.save(session);
    return session;
  }

  /** Record an explicit resume strategy and derive/validate the lifecycle kind. */
  save(session: WorkerSession): void {
    const kind = session.kind ?? sessionKindForResumeStrategy(session.resumeStrategy);
    if (!isSessionLifecycleKind(kind)) throw new Error(`Invalid session lifecycle kind: ${kind}`);
    this.ledger.update(session.taskId, "session checkpoint", (record) => {
      const previous = record.sessions.findIndex((item) => item.id === session.id);
      const entry: WorkerSession = { ...session, kind };
      if (previous < 0) record.sessions.push(entry); else record.sessions[previous] = entry;
    });
  }

  /** Move one session to ARCHIVED (validated); REVIEW → ARCHIVED or CONTINUE allowed. */
  archive(taskId: string, sessionId: string): WorkerSession | undefined {
    const session = this.list(taskId).find((item) => item.id === sessionId);
    if (!session) return undefined;
    const kind = transitionSessionKind(session.kind ?? "NEW", "ARCHIVED");
    this.save({ ...session, kind });
    return this.list(taskId).find((item) => item.id === sessionId);
  }

  lifecycle(taskId: string): Record<string, SessionLifecycleKind> {
    return Object.fromEntries(this.list(taskId).map((item) => [item.id, item.kind ?? "NEW"]));
  }
}
