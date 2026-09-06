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
  return applyBudget(candidates, query.maxChars ?? 8000);
}

export function taxonomyOf(entries: KnowledgeEntry[]): { domains: string[]; shelves: string[]; tags: string[] } {
  return {
    domains: [...new Set(entries.map((entry) => entry.domain))].sort(),
    shelves: [...new Set(entries.map((entry) => entry.shelf))].sort(),
    tags: [...new Set(entries.flatMap((entry) => entry.tags))].sort()
  };
}

/**
 * Deterministic domain router (plan AP10 / AP11 rerank seam). Given a goal and
 * the catalog taxonomy, returns the query that routes to the most specific
 * relevant domain + tags — so context assembly retrieves knowledge for the
 * domain the task actually lives in, not the whole library.
 */
export function routeKnowledgeQuery(goal: string, entries: KnowledgeEntry[]): KnowledgeQuery {
  const taxonomy = taxonomyOf(entries);
  const goalTokens = tokenize(goal);
  const domainScores = taxonomy.domains.map((domain) => ({ domain, score: overlapScore(tokenize(domain), goalTokens) }));
  const bestDomain = domainScores.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))[0];
  const query: KnowledgeQuery = {};
  if (bestDomain && bestDomain.score > 0) {
    query.domain = bestDomain.domain;
    // Route to the tags shared between the best domain's entries and the goal.
    const domainTags = [...new Set(entries.filter((entry) => entry.domain === bestDomain.domain).flatMap((entry) => entry.tags))];
    const matched = domainTags.map((tag) => ({ tag, score: overlapScore(tokenize(tag), goalTokens) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (matched.length) query.tags = matched.slice(0, 3).map((item) => item.tag);
  }
  return query;
}

/** Relevance score for goal tokens (plan §11 rerank half; deterministic no embeddings). */
export function relevanceScore(entry: KnowledgeEntry, goal: string): number {
  const tokens = tokenize(goal);
  return overlapScore(tokenize(entry.title), tokens) * 3 + overlapScore(tokenize(entry.tags.join(" ")), tokens) * 2 + overlapScore(tokenize(entry.domain), tokens) * 2 + overlapScore(tokenize(entry.content), tokens);
}

/**
 * Deterministic rerank: order candidates by relevance to the goal first, then
 * trust, then recency — still within the same character budget.
 */
export function retrieveReranked(entries: KnowledgeEntry[], query: KnowledgeQuery, goal: string): KnowledgeEntry[] {
  const candidates = entries.filter((entry) => entryMatches(query, entry)).sort((a, b) => {
    const delta = relevanceScore(b, goal) - relevanceScore(a, goal);
    if (delta !== 0) return delta;
    return TRUST_ORDER[b.trust] - TRUST_ORDER[a.trust] || b.updatedAt.localeCompare(a.updatedAt);
  });
  return applyBudget(candidates, query.maxChars ?? 8000);
}

function applyBudget(sorted: KnowledgeEntry[], budget: number): KnowledgeEntry[] {
  const result: KnowledgeEntry[] = [];
  let used = 0;
  for (const entry of sorted) {
    if (used + entry.content.length > budget && result.length > 0) break;
    result.push(entry);
    used += entry.content.length;
  }
  return result;
}

function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length > 1);
}

function overlapScore(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}
