/** Knowledge core contracts (plan AP10/§15 reserved metadata). Pure and renderer-shareable. */

export type KnowledgeTrust = "LOW" | "MEDIUM" | "HIGH" | "UNVERIFIED";

export interface KnowledgeEntry {
  id: string;
  domain: string;
  shelf: string;            // workspace/project shelf id
  tags: string[];
  title: string;
  content: string;
  source: string;
  trust: KnowledgeTrust;
  validFrom?: string;
  validUntil?: string;
  supersedes?: string;      // entry id this one replaces
  conflictGroup?: string;   // entries sharing a group are mutually conflicting
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeQuery {
  domain?: string;
  shelf?: string;
  tags?: string[];
  maxChars?: number;        // retrieval budget (plan §10: knowledge size != context size)
  trustAtLeast?: KnowledgeTrust;
}

export const TRUST_ORDER: Record<KnowledgeTrust, number> = { UNVERIFIED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export function entryMatches(query: KnowledgeQuery, entry: KnowledgeEntry): boolean {
  if (query.domain && entry.domain !== query.domain) return false;
  if (query.shelf && entry.shelf !== query.shelf) return false;
  if (query.tags?.length && !query.tags.every((tag) => entry.tags.includes(tag))) return false;
  if (query.trustAtLeast && (TRUST_ORDER[entry.trust] ?? 0) < TRUST_ORDER[query.trustAtLeast]) return false;
  if (entry.validUntil && Date.parse(entry.validUntil) < Date.now()) return false;
  if (entry.validFrom && Date.parse(entry.validFrom) > Date.now()) return false;
  return true;
}

/**
 * Deterministic retrieval honoring the character budget: a knowledge base may
 * be arbitrarily large but the assembled context stays bounded.
 */
export function retrieveWithinBudget(entries: KnowledgeEntry[], query: KnowledgeQuery): KnowledgeEntry[] {
  const candidates = entries.filter((entry) => entryMatches(query, entry)).sort((a, b) => TRUST_ORDER[b.trust] - TRUST_ORDER[a.trust] || b.updatedAt.localeCompare(a.updatedAt));
  const budget = query.maxChars ?? 8000;
  const result: KnowledgeEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    if (used + entry.content.length > budget && result.length > 0) break;
    result.push(entry);
    used += entry.content.length;
  }
  return result;
}

export function taxonomyOf(entries: KnowledgeEntry[]): { domains: string[]; shelves: string[]; tags: string[] } {
  return {
    domains: [...new Set(entries.map((entry) => entry.domain))].sort(),
    shelves: [...new Set(entries.map((entry) => entry.shelf))].sort(),
    tags: [...new Set(entries.flatMap((entry) => entry.tags))].sort()
  };
}
