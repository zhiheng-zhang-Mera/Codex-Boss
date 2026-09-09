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

/** 10H pipeline: stage order for raw event → artifact → candidate → record. */
export type PipelineStage = "RAW_EVENT" | "ARTIFACT" | "CANDIDATE" | "VALIDATION" | "DEDUP" | "RECORD" | "RETRIEVAL";
export const PIPELINE_STAGES: readonly PipelineStage[] = ["RAW_EVENT", "ARTIFACT", "CANDIDATE", "VALIDATION", "DEDUP", "RECORD", "RETRIEVAL"] as const;

export type ValidationOutcome = "valid" | "invalid-empty" | "invalid-no-provenance" | "invalid-untrusted" | "parked";

export interface ValidationVerdict {
  outcome: ValidationOutcome;
  reason: string;
}

/** Deterministic candidate validation: content must be non-empty, source/artifact
 *  provenance present, and untrusted content must be explicitly marked as such
 *  (a raw event is never directly knowledge). */
export function validateCandidate(candidate: CandidateKnowledge, opts: { requireArtifactRef?: boolean; allowUntrusted?: boolean } = {}): ValidationVerdict {
  const content = candidate.content.trim();
  if (!content) return { outcome: "invalid-empty", reason: "candidate content is empty" };
  if (!candidate.source) return { outcome: "invalid-no-provenance", reason: "candidate has no source" };
  if (opts.requireArtifactRef !== false && !candidate.artifactRef) return { outcome: "invalid-no-provenance", reason: "candidate has no artifactRef (raw events are not knowledge)" };
  return { outcome: "valid", reason: "candidate passed validation" };
}

/** Extract a candidate from a raw event payload when the payload is a string blob. */
export function candidateFromEvent(event: RawKnowledgeEvent, opts: { nodeId?: string } = {}): CandidateKnowledge | undefined {
  if (typeof event.payload !== "string") return undefined;
  return {
    candidateId: `cand-${event.eventId}`,
    artifactRef: `event:${event.eventId}`,
    content: event.payload,
    source: event.kind,
    nodeId: opts.nodeId ?? event.nodeId,
    proposedAt: event.occurredAt
  };
}
