import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import { exactDedupKey, type KnowledgeRecordVNext } from "../../src/shared/tenx/knowledge";
import { TenxKnowledgeSpace } from "./knowledge-space";

/**
 * 10J: local fallback + deferred sync (forward, durable).
 *
 *   Global KB reachable   → normal mode (contributions pushed through)
 *   Global KB unreachable → local fallback (never blocks main tasks)
 *   network restored      → deferred sync (dedup; never overwrite newer)
 *
 * The local store stays authoritative + usable while offline. Pending
 * contributions keep full provenance. Sync dedups against the target and never
 * overwrites a target record that is newer (updatedAt newer, or same identity
 * with a higher version).
 */

export interface TenxKnowledgeSyncStateFile {
  schemaVersion: 1;
  pending: Array<{ localId: string; at: string }>;
}

/** Remote/shared KB gateway. isOnline is cheap; push returns success. */
export interface KnowledgeGateway {
  isOnline(): boolean;
  /** Returns 'pushed' when accepted, 'newer-exists' when target has newer knowledge, 'error' otherwise. */
  push(record: KnowledgeRecordVNext): Promise<"pushed" | "newer-exists" | "error">;
  /** Deterministic view of what the target already holds (for dedup pre-checks). */
  snapshot(): Promise<KnowledgeRecordVNext[]>;
}

export class TenxKnowledgeSync {
  private readonly pending: Array<{ localId: string; at: string }> = [];

  constructor(
    private readonly local: TenxKnowledgeSpace,
    private readonly gateway: KnowledgeGateway,
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Contribute from any node: normal mode when online, else local fallback + queued sync. */
  async contribute(input: Parameters<TenxKnowledgeSpace["contribute"]>[0]): Promise<{ record: KnowledgeRecordVNext; mode: "normal" | "local-fallback" }> {
    if (this.gateway.isOnline()) {
      const remote = await this.recordToGateway(input);
      if (remote) {
        // normal mode: still keep a local copy for the node's cache
        const record = this.local.contribute(input);
        return { record, mode: "normal" };
      }
    }
    // local fallback: never blocks the main task; queued for deferred sync
    const record = this.local.contribute(input);
    this.enqueue(record.knowledgeId);
    return { record, mode: "local-fallback" };
  }

  /** Drain pending contributions to the (now restored) global KB. */
  async sync(): Promise<{ pushed: number; skippedNewer: number; remaining: number }> {
    const snapshot = await this.gateway.snapshot();
    let pushed = 0;
    let skippedNewer = 0;
    const stillPending: Array<{ localId: string; at: string }> = [];
    for (const item of [...this.pending]) {
      const record = this.local.get(item.localId);
      if (!record) continue; // superseded/stale locally → drop the pending item
      const targetSameId = snapshot.find((existing) => existing.knowledgeId === record.knowledgeId);
      // identity + version rule: never overwrite a target that is newer.
      if (targetSameId && (targetSameId.version > record.version || (targetSameId.version === record.version && targetSameId.updatedAt > record.updatedAt))) {
        skippedNewer++;
        this.local.markSuperseded(record.knowledgeId);
        continue;
      }
      // content dedup: identical content already on the target contributes once
      // (same identity at equal version, or a different identity with same content).
      const dup = snapshot.find(
        (existing) => exactDedupKey(existing) === exactDedupKey(record) && existing.version >= record.version
      );
      if (dup) {
        this.local.markSuperseded(record.knowledgeId); // this local copy is redundant
        continue;
      }
      const result = await this.gateway.push(record);
      if (result === "pushed") {
        pushed++;
      } else if (result === "newer-exists") {
        skippedNewer++;
        this.local.markSuperseded(record.knowledgeId);
      } else {
        stillPending.push(item);
      }
    }
    this.pending.length = 0;
    this.pending.push(...stillPending);
    this.persist();
    return { pushed, skippedNewer, remaining: stillPending.length };
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private async recordToGateway(input: Parameters<TenxKnowledgeSpace["contribute"]>[0]): Promise<KnowledgeRecordVNext | undefined> {
    const probe: KnowledgeRecordVNext = {
      knowledgeId: input.knowledgeId ?? `k-probe`,
      content: input.content,
      source: input.source,
      artifactRef: input.artifactRef,
      createdByNode: input.createdByNode,
      createdAt: input.createdAt ?? this.now(),
      updatedAt: this.now(),
      confidence: input.confidence ?? 0,
      scope: input.scope ?? "global",
      validity: input.validity ?? {},
      version: 1,
      provenance: { chain: [...(input.provenanceChain ?? []), `artifact:${input.artifactRef ?? "none"}`] },
      state: "ACTIVE"
    };
    const result = await this.gateway.push(probe);
    return result === "pushed" ? probe : undefined;
  }

  private enqueue(localId: string): void {
    this.pending.push({ localId, at: this.now() });
    this.persist();
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxKnowledgeSyncStateFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.pending)) throw new Error("Invalid tenx knowledge sync state");
    this.pending.push(...parsed.pending);
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxKnowledgeSyncStateFile = { schemaVersion: 1, pending: this.pending };
    writeJson(this.filePath, file);
  }
}
