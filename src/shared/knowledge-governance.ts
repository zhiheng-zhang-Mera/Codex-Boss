/**
 * Knowledge governance + hybrid storage tiers (plan AP20). Pure and shareable.
 *
 * AP10a gave the local backend with reserved §15 fields (trust, validFrom/Until,
 * supersedes, conflictGroup). This module activates the v3 governance half:
 *  - auto-ingestion decision (when a new entry supersedes/dedupes existing ones);
 *  - conflict resolution over a conflictGroup (wins by explicit supersede, then
 *    trust, then recency; unresolved groups surface for a human decision);
 *  - trust scoring (source base score adjusted by observed success/failure);
 *  - knowledge aging (validUntil/expiry ⇒ keep as archive or drop);
 *  - cross-domain association (entries that link shelves/tags across domains);
 * and the hybrid storage placement rule (LocalHot → LocalWarm → EncryptedCold).
 * Deterministic and offline; cloud backends stay injected interfaces.
 */

import type { KnowledgeEntry, KnowledgeTrust } from "./knowledge";

export type StorageTier = "LocalHot" | "LocalWarm" | "EncryptedCold";
export const STORAGE_TIERS: readonly StorageTier[] = ["LocalHot", "LocalWarm", "EncryptedCold"];

export type IngestionDecision = "ADD" | "SUPERSEDE" | "DUPLICATE" | "REJECT";

export interface IngestionVerdict {
  decision: IngestionDecision;
  /** Entry id this one supersedes when ADD/SUPERSEDE. */
  supersedes?: string;
  reason: string;
}

/** §20 auto-ingestion: reject stale/empty, supersede an explicit target, dedupe exact content. */
export function decideIngestion(candidate: KnowledgeEntry, existing: KnowledgeEntry[]): IngestionVerdict {
  if (!candidate.content?.trim() || !candidate.title?.trim()) return { decision: "REJECT", reason: "candidate has no content or title" };
  const duplicate = existing.find((entry) => entry.content === candidate.content && entry.shelf === candidate.shelf);
  if (duplicate) return { decision: "DUPLICATE", supersedes: duplicate.id, reason: "identical content already stored" };
  if (candidate.supersedes) {
    const target = existing.find((entry) => entry.id === candidate.supersedes);
    if (!target) return { decision: "REJECT", reason: "supersedes target does not exist" };
    return { decision: "SUPERSEDE", supersedes: candidate.supersedes, reason: "explicit supersede" };
  }
  return { decision: "ADD", reason: "new entry accepted" };
}

export interface ConflictResolution {
  winnerId: string | null;
  loserIds: string[];
  unresolved: boolean;
  reason: string;
}

/** §20 conflict resolution inside one conflictGroup. */
export function resolveConflictGroup(groupId: string, entries: KnowledgeEntry[]): ConflictResolution {
  const members = entries.filter((entry) => entry.conflictGroup === groupId);
  if (members.length <= 1) return { winnerId: members[0]?.id ?? null, loserIds: [], unresolved: false, reason: members.length === 0 ? "empty group" : "single member" };
  const superseding = members.filter((entry) => entry.supersedes && members.some((other) => other.id === entry.supersedes));
  if (superseding.length) {
    const winner = superseding[0];
    return { winnerId: winner.id, loserIds: members.filter((entry) => entry.id !== winner.id).map((entry) => entry.id), unresolved: false, reason: `explicit supersede chooses ${winner.id}` };
  }
  const sorted = [...members].sort((a, b) => TRUST_WEIGHT[b.trust] - TRUST_WEIGHT[a.trust] || b.updatedAt.localeCompare(a.updatedAt));
  const winner = sorted[0];
  // If the top two tie on both trust and recency the conflict needs a human.
  const runnerUp = sorted[1];
  if (runnerUp && TRUST_WEIGHT[winner.trust] === TRUST_WEIGHT[runnerUp.trust] && winner.updatedAt === runnerUp.updatedAt) {
    return { winnerId: null, loserIds: members.map((entry) => entry.id), unresolved: true, reason: `conflict ${groupId} ties on trust and recency` };
  }
  return { winnerId: winner.id, loserIds: members.filter((entry) => entry.id !== winner.id).map((entry) => entry.id), unresolved: false, reason: `higher trust / newer wins in ${groupId}` };
}

/** Trust scoring: source base adjusted by observed success/failure (deterministic). */
export function scoreTrust(input: { entry: KnowledgeEntry; successes: number; failures: number; sourceBase?: KnowledgeTrust }): number {
  const base = TRUST_WEIGHT[input.sourceBase ?? input.entry.trust];
  const observed = input.successes + input.failures;
  if (observed === 0) return base;
  const rate = input.successes / observed;
  // Weighted blend: sustained evidence dominates the prior; perfect evidence can
  // lift a low-prior entry to HIGH, total failure drops it to UNVERIFIED.
  return base * 0.35 + 6 * rate * 0.65;
}

export function trustFromScore(score: number): KnowledgeTrust {
  if (score >= 3.5) return "HIGH";
  if (score >= 2.5) return "MEDIUM";
  if (score >= 1.5) return "LOW";
  return "UNVERIFIED";
}

/** Knowledge aging: expired entries may be archived or dropped per policy. */
export function agingState(entry: KnowledgeEntry, now = Date.now()): "VALID" | "EXPIRED" | "NEVER_VALID" {
  if (entry.validUntil && Date.parse(entry.validUntil) < now) return "EXPIRED";
  if (entry.validFrom && Date.parse(entry.validFrom) > now) return "NEVER_VALID";
  return "VALID";
}

export interface AssociationEdge {
  fromEntryId: string;
  toEntryId: string;
  kind: "shared-tag" | "cross-domain" | "references";
  weight: number;
}

/** Cross-domain association over the catalog (deterministic, bounded). */
export function associateAcrossDomains(entries: KnowledgeEntry[], options: { maxPerEntry?: number } = {}): AssociationEdge[] {
  const maxPerEntry = options.maxPerEntry ?? 5;
  const edges: AssociationEdge[] = [];
  for (const entry of entries) {
    const candidates = entries.filter((other) => other.id !== entry.id && other.domain !== entry.domain).map((other) => {
      const shared = other.tags.filter((tag) => entry.tags.includes(tag)).length;
      const weight = shared > 0 ? 1 + shared : entry.content.includes(other.id) || other.content.includes(entry.id) ? 1 : 0;
      return { other, shared, weight };
    }).filter((candidate) => candidate.weight > 0).sort((a, b) => b.weight - a.weight || a.other.id.localeCompare(b.other.id)).slice(0, maxPerEntry);
    for (const candidate of candidates) {
      edges.push({ fromEntryId: entry.id, toEntryId: candidate.other.id, kind: candidate.shared > 0 ? "cross-domain" : "references", weight: candidate.weight });
    }
  }
  return edges;
}

/** Hybrid storage placement: cold when expired or encrypted-sensitive; warm after age. */
export function placementFor(entry: KnowledgeEntry, options: { now?: number; warmAfterDays?: number; sensitive?: boolean } = {}): StorageTier {
  const now = options.now ?? Date.now();
  if (options.sensitive) return "EncryptedCold";
  const ageDays = Math.max(0, now - Date.parse(entry.updatedAt || new Date(0).toISOString())) / 86400000;
  if (agingState(entry, now) === "EXPIRED" || ageDays > (options.warmAfterDays ?? 30)) return "EncryptedCold";
  return ageDays > 7 ? "LocalWarm" : "LocalHot";
}

const TRUST_WEIGHT: Record<KnowledgeTrust, number> = { UNVERIFIED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
