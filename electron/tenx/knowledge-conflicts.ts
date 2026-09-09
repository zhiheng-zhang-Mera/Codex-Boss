import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import {
  compareClaims,
  detectDedup,
  isStale,
  mergeClaims,
  type DedupOutcome,
  type KnowledgeConflictRecord,
  type KnowledgeRecordVNext
} from "../../src/shared/tenx/knowledge";
import { TenxKnowledgeSpace } from "./knowledge-space";

/**
 * 10I: knowledge dedup & conflict (forward, durable).
 *
 * - exact dedup + semantic dedup (deterministic token-overlap) gate new records;
 * - conflicting claims are NOT deleted: the incoming claim is stored as
 *   CONFLICTING and a conflict record keeps claim A + claim B + confidence /
 *   provenance for the runtime to decide;
 * - superseded state (version chain) and stale state (temporal validity lapse)
 *   are recorded, never silently removed;
 * - source-aware merge folds agreeing claims with the same meaning together.
 */

export interface TenxConflictFile {
  schemaVersion: 1;
  conflicts: KnowledgeConflictRecord[];
}

export type ConflictResolution = "keep-a" | "keep-b" | "supersede" | "merged";

export interface SubmitResult {
  outcome: DedupOutcome | "new" | "conflict";
  reason: string;
  record?: KnowledgeRecordVNext;
  conflict?: KnowledgeConflictRecord;
}

export class TenxKnowledgeConflicts {
  private readonly conflicts = new Map<string, KnowledgeConflictRecord>();
  private readonly store: TenxKnowledgeSpace;

  constructor(
    store: TenxKnowledgeSpace,
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.store = store;
    this.restore();
  }

  /** Gate a new knowledge record: duplicate → reject; conflict → both stored CONFLICTING;
   *  otherwise → new ACTIVE record. */
  submit(incoming: KnowledgeRecordVNext): SubmitResult {
    const existing = this.store.list();
    const dup = detectDedup(incoming, existing, 0.85);
    if (dup !== "new") return { outcome: dup, reason: `${dup}: knowledge already present` };
    for (const record of existing) {
      const cmp = compareClaims(incoming, record);
      if (cmp.conflict) {
        // persist BOTH claims, explicitly flagged as conflicting
        const claimA = this.store.get(record.knowledgeId) ?? this.store.contribute(recordToInput(record));
        const claimB = this.store.contribute(recordToInput(incoming));
        if (claimA.state !== "CONFLICTING") this.store.markConflicting(claimA.knowledgeId);
        this.store.markConflicting(claimB.knowledgeId);
        const conflict = this.openConflict(claimA, claimB, cmp.conflictGroup ?? `cg-${claimA.knowledgeId}`);
        return { outcome: "conflict", reason: cmp.reason ?? "conflicting claims", record: claimB, conflict };
      }
    }
    const record = this.store.contribute(recordToInput(incoming));
    return { outcome: "new", reason: "no duplicate or conflict", record };
  }

  openConflict(a: KnowledgeRecordVNext, b: KnowledgeRecordVNext, conflictGroup?: string): KnowledgeConflictRecord {
    const group = conflictGroup ?? `cg-${a.knowledgeId}-${b.knowledgeId}`;
    const existing = [...this.conflicts.values()].find((record) => record.conflictGroup === group && !record.resolved);
    if (existing) return structuredClone(existing);
    const conflict: KnowledgeConflictRecord = {
      conflictId: `conflict-${group}`,
      claims: [
        { knowledgeId: a.knowledgeId, content: a.content, nodeId: a.createdByNode, confidence: a.confidence, provenance: a.provenance },
        { knowledgeId: b.knowledgeId, content: b.content, nodeId: b.createdByNode, confidence: b.confidence, provenance: b.provenance }
      ],
      conflictGroup: group,
      resolved: false,
      createdAt: this.now()
    };
    this.conflicts.set(conflict.conflictId, conflict);
    this.persist();
    return structuredClone(conflict);
  }

  /** Resolve a conflict without deleting the loser: winner → ACTIVE, loser → SUPERSEDED. */
  resolve(conflictId: string, resolution: ConflictResolution, decidingNode: string): { ok: boolean; reason: string } {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) return { ok: false, reason: "unknown or already resolved conflict" };
    if (resolution === "merged") {
      const [a, b] = conflict.claims;
      const recordA = this.store.get(a.knowledgeId);
      const recordB = this.store.get(b.knowledgeId);
      if (!recordA || !recordB) return { ok: false, reason: "missing claim record for merge" };
      const { merged } = mergeClaims(recordA, recordB);
      this.store.supersede(merged.knowledgeId, recordToInput(merged));
      this.store.markSuperseded(recordB.knowledgeId);
    } else if (resolution === "keep-a" || resolution === "keep-b") {
      const winnerId = resolution === "keep-a" ? conflict.claims[0].knowledgeId : conflict.claims[1].knowledgeId;
      const loserId = resolution === "keep-a" ? conflict.claims[1].knowledgeId : conflict.claims[0].knowledgeId;
      if (!this.store.get(winnerId) || !this.store.get(loserId)) return { ok: false, reason: "missing claim record" };
      this.store.markActive(winnerId); // winner stays live
      this.store.markSuperseded(loserId); // loser superseded (kept in history, never deleted)
    } else if (resolution === "supersede") {
      // the deciding node replaced the knowledge with something better; mark both superseded
      for (const claim of conflict.claims) this.store.markSuperseded(claim.knowledgeId);
    }
    this.conflicts.set(conflictId, { ...conflict, resolved: true });
    this.persist();
    return { ok: true, reason: `resolved by ${decidingNode}: ${resolution}` };
  }

  /** Mark records whose temporal validity lapsed as STALE (records kept, state updated). */
  sweepStale(): { stale: string[] } {
    const stale: string[] = [];
    for (const record of this.store.list()) {
      if (isStale(record, this.now())) {
        this.store.markStale(record.knowledgeId);
        stale.push(record.knowledgeId);
      }
    }
    return { stale };
  }

  unresolved(): KnowledgeConflictRecord[] {
    return [...this.conflicts.values()].filter((record) => !record.resolved).map((record) => structuredClone(record));
  }

  list(): KnowledgeConflictRecord[] {
    return [...this.conflicts.values()].map((record) => structuredClone(record)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxConflictFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.conflicts)) throw new Error("Invalid tenx conflict store");
    for (const conflict of parsed.conflicts) {
      if (!conflict || typeof conflict.conflictId !== "string") throw new Error("Invalid tenx conflict record");
      this.conflicts.set(conflict.conflictId, conflict);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxConflictFile = { schemaVersion: 1, conflicts: [...this.conflicts.values()] };
    writeJson(this.filePath, file);
  }
}

function recordToInput(record: KnowledgeRecordVNext): Parameters<TenxKnowledgeSpace["contribute"]>[0] {
  return {
    content: record.content,
    source: record.source,
    createdByNode: record.createdByNode,
    artifactRef: record.artifactRef,
    scope: record.scope,
    validity: record.validity,
    confidence: record.confidence,
    provenanceChain: record.provenance.chain,
    knowledgeId: record.knowledgeId,
    createdAt: record.createdAt
  };
}
