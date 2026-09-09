import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";
import { canTransition, type SessionLifecycle, type SessionLifecycleRecord, type SessionTransition } from "../../src/shared/session-lifecycle";

/**
 * R43 Phase B (R-203): durable per-account session-lifecycle ledger.
 * One record per provider/account ⇒ session expiry on one provider never
 * touches another (failure isolation at the storage level). Transitions are
 * validated against the shared edge table; fail-closed restore: a corrupt file
 * throws instead of silently dropping the lifecycle state.
 */
export interface SessionLifecycleLedgerFile {
  schemaVersion: 1;
  records: SessionLifecycleRecord[];
}

export class SessionLifecycleLedger {
  private readonly records = new Map<string, SessionLifecycleRecord>();

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  private key(providerId: string, account: string): string {
    return `${providerId}:${account}`;
  }

  state(providerId: string, account = "default"): SessionLifecycle {
    return this.records.get(this.key(providerId, account))?.state ?? "UNKNOWN";
  }

  /** Records a validated transition; returns the new record (or undefined when illegal). */
  record(providerId: string, to: SessionLifecycle, reason: string, account = "default", now = new Date().toISOString()): SessionLifecycleRecord | undefined {
    const key = this.key(providerId, account);
    const current = this.records.get(key);
    const from: SessionLifecycle = current?.state ?? "UNKNOWN";
    if (!canTransition(from, to)) return undefined;
    const transition: SessionTransition = { from, to, reason: reason.slice(0, 300), at: now };
    const next: SessionLifecycleRecord = {
      schemaVersion: 1,
      providerId,
      account,
      state: to,
      ...(to === "LOGGED_IN" ? { lastSuccessAt: now } : {}),
      ...(to === "FAILED" ? { lastFailureReason: reason.slice(0, 300) } : {}),
      transitions: [...(current?.transitions ?? []), transition],
      updatedAt: now
    };
    this.records.set(key, next);
    this.persist();
    return structuredClone(next);
  }

  list(): SessionLifecycleRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  reset(providerId: string, account = "default"): void {
    this.records.delete(this.key(providerId, account));
    this.persist();
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<SessionLifecycleLedgerFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid session-lifecycle ledger");
    for (const record of parsed.records) {
      if (!record || typeof record.providerId !== "string" || !SESSION_STATES.has(record.state)) throw new Error("Invalid session-lifecycle record");
      this.records.set(this.key(record.providerId, record.account ?? "default"), record);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: SessionLifecycleLedgerFile = { schemaVersion: 1, records: [...this.records.values()] };
    writeJson(this.filePath, file);
  }
}

const SESSION_STATES = new Set<string>(["UNKNOWN", "CHECKING", "LOGGED_IN", "EXPIRED", "REAUTH_REQUIRED", "FAILED"]);
