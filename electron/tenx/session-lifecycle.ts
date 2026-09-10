import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import { decideSessionKind, reapableWhenStale, suggestPoolGc, staleSessions, type SessionKind, type SessionPoolRecord } from "../../src/shared/tenx/session";

/**
 * 10N: session lifecycle vNext (forward, durable).
 *
 * Session kinds TEMPORARY / REUSABLE / PERSISTENT / AUTO_DELETE on top of the
 * existing policy. Long autonomous tasks default to TEMPORARY unless the task
 * explicitly requires long-lived context. The manager keeps a bounded session
 * pool, reaps stale sessions, and exposes deterministic GC suggestions — so
 * multi-device chat history and many concurrent nodes of one account do not
 * grow unboundedly.
 */

export interface TenxSessionFile {
  schemaVersion: 1;
  sessions: SessionPoolRecord[];
}

export class TenxSessionLifecycle {
  private readonly sessions = new Map<string, SessionPoolRecord>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly staleAfterMs: number = 24 * 60 * 60 * 1000,
    private readonly poolLimit: number = DEFAULT_POOL_LIMIT
  ) {
    this.restore();
  }

  /** Decide the session kind for a new task and open a pooled session. */
  open(provider: string, opts: { taskKind: "autonomous" | "interactive" | "research"; longLivedContextRequired?: boolean }): { session: SessionPoolRecord; decision: { kind: SessionKind; reason: string }; gc: { overflow: number; suggestDropIds: string[] } } {
    const decision = decideSessionKind(opts);
    const session: SessionPoolRecord = {
      sessionId: `sess-${randomUUID()}`,
      provider,
      kind: decision.kind,
      lastUsedAt: this.now(),
      createdAt: this.now(),
      active: true
    };
    this.sessions.set(session.sessionId, session);
    const gc = suggestPoolGc([...this.sessions.values()], this.poolLimit);
    this.applyGc(gc);
    this.persist();
    return { session: structuredClone(session), decision, gc };
  }

  touch(sessionId: string): SessionPoolRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const next: SessionPoolRecord = { ...session, lastUsedAt: this.now() };
    this.sessions.set(sessionId, next);
    this.persist();
    return structuredClone(next);
  }

  release(sessionId: string): SessionPoolRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const next: SessionPoolRecord = { ...session, active: false };
    this.sessions.set(sessionId, next);
    this.persist();
    return structuredClone(next);
  }

  delete(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) this.persist();
    return existed;
  }

  /** Reap stale sessions (TEMPORARY/AUTO_DELETE inactive past max age). Returns removed ids. */
  reap(): { removed: string[] } {
    const stale = staleSessions([...this.sessions.values()], this.now(), this.staleAfterMs);
    const removed: string[] = [];
    for (const session of stale) {
      this.sessions.delete(session.sessionId);
      removed.push(session.sessionId);
    }
    if (removed.length) this.persist();
    return { removed };
  }

  /** Enforce the pool bound deterministically (oldest reapable dropped). */
  enforcePoolBound(): { dropped: string[] } {
    const gc = suggestPoolGc([...this.sessions.values()], this.poolLimit);
    this.applyGc(gc);
    return { dropped: gc.suggestDropIds };
  }

  list(provider?: string): SessionPoolRecord[] {
    return [...this.sessions.values()]
      .filter((session) => !provider || session.provider === provider)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((session) => structuredClone(session));
  }

  count(): number {
    return this.sessions.size;
  }

  private applyGc(gc: { overflow: number; suggestDropIds: string[] }): void {
    for (const id of gc.suggestDropIds) this.sessions.delete(id);
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxSessionFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) throw new Error("Invalid tenx session lifecycle");
    for (const session of parsed.sessions) {
      if (!session || typeof session.sessionId !== "string") throw new Error("Invalid tenx session record");
      this.sessions.set(session.sessionId, session);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxSessionFile = { schemaVersion: 1, sessions: [...this.sessions.values()] };
    writeJson(this.filePath, file);
  }
}

const DEFAULT_POOL_LIMIT = 8;
export { reapableWhenStale };
