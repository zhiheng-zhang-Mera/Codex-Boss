/**
 * R43 Phase F (R-601/R-602/R-603): user-level knowledge space model (pure,
 * no node APIs).
 *
 * All nodes contribute to ONE user knowledge space (no per-device knowledge
 * silos). Retrieval only pulls what a task needs. A remote/shared backend may
 * be unavailable: local storage stays authoritative + usable, and writes are
 * queued for deferred synchronization — KB down is never Boss down.
 */

export interface KnowledgeEntry {
  id: string;
  spaceId: "user";
  /** Owning node when locally produced. */
  ownerNode: string;
  content: string;
  tags: string[];
  source: "local" | "shared";
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Deterministic dedupe by normalized content: identical knowledge contributes once. */
export function dedupeContributions(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const seen = new Set<string>();
  const result: KnowledgeEntry[] = [];
  for (const entry of entries) {
    const normalized = entry.content.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(entry);
  }
  return result;
}

/** Pull only the sub-set relevant to a task (tag/intent match). */
export function retrieveRelevant(entries: KnowledgeEntry[], query: { text?: string; tags?: string[] }): KnowledgeEntry[] {
  const lower = (query.text ?? "").toLowerCase();
  return entries.filter((entry) => {
    const tagHit = query.tags?.length ? query.tags.some((tag) => entry.tags.includes(tag)) : false;
    const textHit = lower.length ? entry.content.toLowerCase().includes(lower) || entry.tags.some((tag) => tag.toLowerCase().includes(lower)) : false;
    return tagHit || textHit;
  });
}
