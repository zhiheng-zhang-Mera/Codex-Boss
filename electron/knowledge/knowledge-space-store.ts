import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJson, readJson } from "../commander/durable-json";
import { dedupeContributions, retrieveRelevant, type KnowledgeEntry } from "../../src/shared/knowledge-space";

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * R43 Phase F (R-601…R-603): durable user knowledge space store with a local
 * cache + deferred-sync queue. The store is always usable (local first); a
 * remote/shared backend is an OPTIONAL gateway whose availability decides
 * whether contributions are marked synced immediately or queued for later.
 * Local fallback + deferred synchronization ⇒ KB down never stops Boss.
 */

export interface KnowledgeStoreFile {
  schemaVersion: 1;
  entries: KnowledgeEntry[];
}

export interface DeferredSyncItem {
  id: string;
  kind: "knowledge" | "artifact" | "decision";
  payload: unknown;
  attempt: number;
  at: string;
}

export interface SyncGateway {
  isOnline(): boolean;
  push(item: DeferredSyncItem): Promise<boolean>;
}

export class KnowledgeSpaceStore {
  private readonly entries = new Map<string, KnowledgeEntry>();

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  put(entry: Omit<KnowledgeEntry, "id" | "spaceId" | "synced" | "createdAt" | "updatedAt"> & { id?: string }): KnowledgeEntry {
    const now = new Date().toISOString();
    const existingHash = [...this.entries.values()].find((item) => contentHash(item.content) === contentHash(entry.content));
    if (existingHash) return structuredClone(existingHash); // dedupe: identical contribution contributes once
    const created: KnowledgeEntry = {
      ...entry,
      id: entry.id ?? `kb-${contentHash(entry.content).slice(0, 16)}`,
      spaceId: "user",
      synced: false,
      createdAt: now,
      updatedAt: now
    };
    this.entries.set(created.id, created);
    this.persist();
    return structuredClone(created);
  }

  /** Local retrieval only — never blocked by a remote backend. */
  search(query: { text?: string; tags?: string[] }): KnowledgeEntry[] {
    return retrieveRelevant([...this.entries.values()], query).map((entry) => structuredClone(entry));
  }

  markSynced(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.set(id, { ...entry, synced: true, updatedAt: new Date().toISOString() });
    this.persist();
  }

  list(): KnowledgeEntry[] {
    return [...this.entries.values()].map((entry) => structuredClone(entry));
  }

  count(): number {
    return dedupeContributions(this.list()).length;
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<KnowledgeStoreFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error("Invalid knowledge store");
    for (const entry of parsed.entries) {
      if (!entry || typeof entry.id !== "string") throw new Error("Invalid knowledge entry");
      this.entries.set(entry.id, entry);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: KnowledgeStoreFile = { schemaVersion: 1, entries: [...this.entries.values()] };
    writeJson(this.filePath, file);
  }
}

export class DeferredSyncQueue {
  private readonly items: DeferredSyncItem[] = [];

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  enqueue(item: Omit<DeferredSyncItem, "attempt" | "at">): void {
    this.items.push({ ...item, attempt: 0, at: new Date().toISOString() });
    this.persist();
  }

  pending(): DeferredSyncItem[] {
    return [...this.items];
  }

  /** Drains what the gateway can accept now (bounded attempts; offline stays queued). */
  async drain(gateway: SyncGateway): Promise<{ pushed: number; remaining: number }> {
    let pushed = 0;
    const stillPending: DeferredSyncItem[] = [];
    for (const item of this.items) {
      if (gateway.isOnline() && item.attempt < 3 && (await gateway.push(item))) {
        pushed++;
        continue;
      }
      stillPending.push({ ...item, attempt: item.attempt + 1 });
    }
    this.items.length = 0;
    this.items.push(...stillPending);
    this.persist();
    return { pushed, remaining: stillPending.length };
  }

  clear(id: string): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
    this.persist();
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { schemaVersion?: number; items?: DeferredSyncItem[] };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) throw new Error("Invalid deferred-sync queue");
    this.items.push(...parsed.items);
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJson(this.filePath, { schemaVersion: 1, items: this.items });
  }
}
