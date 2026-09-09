/**
 * 10G/10H/10I/10J knowledge vNext (pure skeleton).
 *
 * One user-level Global Knowledge Space; every node contributes to the same
 * space (never per-node personality knowledge). Knowledge is versioned,
 * provenance-backed, dedupable, conflict-explicit and synchronizable.
 */

export type KnowledgeScope = "global" | `project:${string}` | `task:${string}` | `user:${string}`;

export interface TemporalValidity {
  validFrom?: string; // ISO
  validUntil?: string; // ISO
}

export type KnowledgeState = "ACTIVE" | "SUPERSEDED" | "STALE" | "CONFLICTING";

export interface KnowledgeProvenance {
  /** event → artifact → knowledge chain as an ordered list of refs. */
  chain: string[];
  conflictGroup?: string;
}

/** Full knowledge record (taskbook §10). */
export interface KnowledgeRecordVNext {
  knowledgeId: string;
  content: string;
  source: string;
  artifactRef?: string;
  createdByNode: string;
  createdAt: string;
  updatedAt: string;
  confidence: number; // 0..1; 0 + source note when unknown
  scope: KnowledgeScope;
  validity: TemporalValidity;
  version: number;
  provenance: KnowledgeProvenance;
  state: KnowledgeState;
}

/** Raw event and candidate knowledge (10H pipeline). */
export interface RawKnowledgeEvent {
  eventId: string;
  nodeId: string;
  kind: string;
  payload: unknown;
  occurredAt: string;
}

export interface CandidateKnowledge {
  candidateId: string;
  artifactRef: string;
  content: string;
  source: string;
  nodeId: string;
  proposedAt: string;
}

/** Dedup + conflict outcomes (10I). */
export type DedupOutcome = "exact-duplicate" | "semantic-duplicate" | "new" | "conflict";

export interface KnowledgeConflictRecord {
  conflictId: string;
  claims: Array<{ knowledgeId: string; content: string; nodeId: string; confidence: number; provenance: KnowledgeProvenance }>;
  conflictGroup: string;
  resolved: boolean;
  createdAt: string;
}

/** Deterministic helpers (exact dedup is canonical; semantic is token-overlap based, no magic). */

export function exactDedupKey(record: Pick<KnowledgeRecordVNext, "content">): string {
  return record.content.trim().toLocaleLowerCase();
}

/** Token overlap similarity 0..1 over lowercase word tokens (no embeddings). */
export function tokenSimilarity(left: string, right: string): number {
  const tokens = (text: string) => new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => token.trim()));
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

export function detectDedup(incoming: KnowledgeRecordVNext, existing: KnowledgeRecordVNext[], threshold = 0.85): DedupOutcome {
  for (const record of existing) {
    if (exactDedupKey(record) === exactDedupKey(incoming)) return "exact-duplicate";
    if (tokenSimilarity(record.content, incoming.content) >= threshold) return "semantic-duplicate";
  }
  return "new";
}
