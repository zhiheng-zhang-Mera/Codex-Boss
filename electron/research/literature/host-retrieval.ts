/**
 * Host-backed literature retrieval (Overcomplete §9.3–§9.5). Real source
 * acquisition is a HOST responsibility: AI only proposes search terms and
 * relevance; the host performs actual retrieval, verifies metadata against the
 * provider response, and locates passages inside the acquired text. An AI
 * self-supplied `sourceText` is never treated as an external source.
 *
 * Engines are read-only public scholarly APIs (OpenAlex / Crossref). Fetch is
 * injected so deterministic tests run offline with canned responses; the
 * default uses global fetch with a short timeout. Every failure is recorded
 * honestly (empty result + reason) — no candidate is invented.
 */

import { createHash } from "node:crypto";

export interface HostSourceRecord {
  id: string;
  title: string;
  authors?: string[];
  venue?: string;
  year?: number;
  sourceRef: string;
  doi?: string;
  /** Verbatim text acquired from the source (abstract or accessible full text). */
  sourceText: string;
  /** Metadata fields were verified against the provider response. */
  metadataVerified: boolean;
  /** A passage matching the RQ was mechanically located inside the text. */
  passageLocated: boolean;
  quote?: string;
}

export interface HostLiteratureOutcome {
  records: HostSourceRecord[];
  attempted: number;
  failed: string[];
  reasons: string[];
}

export interface HostLiteratureDeps {
  /** Semantic/metadata search over a query → candidate list (bounded). */
  search: (query: string, max: number) => Promise<HostCandidate[]>;
  /** Acquires + verifies the source for one candidate; null when unretrievable. */
  acquire: (candidate: HostCandidate) => Promise<HostAcquisition | null>;
}

export interface HostCandidate {
  id: string;
  title: string;
  authors?: string[];
  venue?: string;
  year?: number;
  sourceRef: string;
  doi?: string;
}

export interface HostAcquisition {
  text: string;
  metadataVerified: boolean;
  doi?: string;
}

export const HOST_LITERATURE_LIMIT = 5;
const HOST_RECORD_KEYWORDS = 2;

function recordKey(candidate: HostCandidate): string {
  return candidate.doi ? `doi:${candidate.doi.trim().toLowerCase()}` : candidate.sourceRef ? `ref:${candidate.sourceRef}` : `title:${createHash("sha256").update(candidate.title.toLowerCase()).digest("hex").slice(0, 16)}`;
}

/** Mechanical passage location: first sentence containing ≥2 RQ keywords. */
export function locatePassage(text: string, query: string): string | undefined {
  const tokens = query.toLowerCase().split(/\W+/).map((token) => token.trim()).filter((token) => token.length > 3);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const hits = tokens.filter((token) => lower.includes(token)).length;
    if (hits >= HOST_RECORD_KEYWORDS) return sentence.slice(0, 4000);
  }
  return undefined;
}

/**
 * One bounded host literature pass: search → dedupe → acquire → verify.
 * Returns acquired records only (callers store them in the citation ledger);
 * candidates with no accessible text are reported in `failed` — never dropped
 * silently, never replaced by an invented citation.
 */
export async function runHostLiteraturePass(input: { rq: string; hypothesis?: string; maxSources?: number }, deps: HostLiteratureDeps): Promise<HostLiteratureOutcome> {
  const maxSources = Math.max(1, Math.min(input.maxSources ?? HOST_LITERATURE_LIMIT, 10));
  const reasons: string[] = [];
  const queries = compactQueries(input.rq, input.hypothesis);
  let candidates: HostCandidate[] = [];
  try {
    candidates = (await Promise.all(queries.map((query) => deps.search(query, maxSources).catch(() => [])))).flat();
  } catch (error) {
    return { records: [], attempted: 0, failed: [], reasons: [`host search failed: ${String(error).slice(0, 200)}`] };
  }
  if (!candidates.length) return { records: [], attempted: 0, failed: [], reasons: ["host search returned no candidates (offline or no results)"] };

  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => { const key = recordKey(candidate); if (seen.has(key)) return false; seen.add(key); return true; });
  if (unique.length > maxSources) reasons.push(`candidate list truncated to ${maxSources} after dedup`);
  const bounded = unique.slice(0, maxSources);

  const records: HostSourceRecord[] = [];
  const failed: string[] = [];
  for (const candidate of bounded) {
    try {
      const acquisition = await deps.acquire(candidate);
      if (!acquisition || !acquisition.text.trim()) { failed.push(candidate.sourceRef); continue; }
      const quote = locatePassage(acquisition.text, input.rq);
      records.push({
        id: candidate.id,
        title: candidate.title.slice(0, 500),
        ...(candidate.authors?.length ? { authors: candidate.authors.slice(0, 20) } : {}),
        ...(candidate.venue ? { venue: candidate.venue } : {}),
        ...(candidate.year ? { year: candidate.year } : {}),
        sourceRef: candidate.sourceRef,
        ...(candidate.doi ?? acquisition.doi ? { doi: candidate.doi ?? acquisition.doi } : {}),
        sourceText: acquisition.text.slice(0, 200000),
        metadataVerified: acquisition.metadataVerified === true,
        passageLocated: Boolean(quote),
        ...(quote ? { quote } : {})
      });
    } catch (error) {
      failed.push(candidate.sourceRef);
      reasons.push(`${candidate.sourceRef}: ${String(error).slice(0, 120)}`);
    }
  }
  if (!records.length) reasons.push("no acquired text passed host verification");
  return { records, attempted: bounded.length, failed, reasons };
}

/** Host search/acquire implementation over the public OpenAlex REST API. */
export function createOpenAlexLiteratureDeps(options: { fetchFn?: typeof fetch; timeoutMs?: number; userAgent?: string } = {}): HostLiteratureDeps {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20000;
  const userAgent = options.userAgent ?? "codex-boss-research/1.0 (autonomous research; mailto:research@codex-boss.local)";
  const request = async (url: string): Promise<unknown> => {
    const response = await fetchFn(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`);
    return response.json();
  };
  return {
    async search(query, max) {
      const payload = await request(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(max, 25)}`) as { results?: Array<Record<string, unknown>> };
      return (payload.results ?? []).map(openAlexWorkToCandidate).filter((candidate): candidate is HostCandidate => Boolean(candidate));
    },
    async acquire(candidate) {
      // Prefer the work's abstract; otherwise re-fetch the record by DOI id
      // when the search result omitted the abstract index.
      const selector = candidate.doi ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(candidate.doi)}` : candidate.sourceRef;
      const payload = await request(selector) as Record<string, unknown>;
      const title = typeof payload.title === "string" ? payload.title : undefined;
      const abstract = reconstructAbstract(payload.abstract_inverted_index);
      if (!abstract) return null;
      const metadataVerified = title !== undefined && (!candidate.title || similar(title, candidate.title));
      return { text: abstract, metadataVerified, doi: typeof payload.doi === "string" ? payload.doi : candidate.doi };
    }
  };
}

/** Host search/acquire over Crossref REST (fallback engine). */
export function createCrossrefLiteratureDeps(options: { fetchFn?: typeof fetch; timeoutMs?: number; userAgent?: string } = {}): HostLiteratureDeps {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20000;
  const userAgent = options.userAgent ?? "codex-boss-research/1.0 (autonomous research; mailto:research@codex-boss.local)";
  const request = async (url: string): Promise<unknown> => {
    const response = await fetchFn(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    return response.json();
  };
  return {
    async search(query, max) {
      const payload = await request(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${Math.min(max, 25)}&select=DOI,title,author,container-title,issued,type`) as { message?: { items?: Array<Record<string, unknown>> } };
      return (payload.message?.items ?? []).map(crossrefItemToCandidate).filter((candidate): candidate is HostCandidate => Boolean(candidate));
    },
    async acquire(candidate) {
      if (!candidate.doi) return null;
      const payload = await request(`https://api.crossref.org/works/${encodeURIComponent(candidate.doi)}`) as { message?: Record<string, unknown> };
      const message = payload.message;
      const title = message && Array.isArray(message.title) && typeof message.title[0] === "string" ? message.title[0] : undefined;
      if (!title) return null;
      const metadataVerified = !candidate.title || similar(title, candidate.title);
      return { text: "", metadataVerified, doi: candidate.doi };
    }
  };
}

function openAlexWorkToCandidate(work: Record<string, unknown>): HostCandidate | undefined {
  const title = typeof work.title === "string" ? work.title.trim() : "";
  const doi = typeof work.doi === "string" ? work.doi.replace(/^https:\/\/doi\.org\//, "") : undefined;
  if (!title) return undefined;
  const authors: string[] = [];
  const authorship = Array.isArray(work.authorships) ? work.authorships as Array<Record<string, unknown>> : [];
  for (const entry of authorship) {
    const author = entry.author as Record<string, unknown> | undefined;
    if (typeof author?.display_name === "string") authors.push(author.display_name);
  }
  const venue = (work.primary_location as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined;
  return {
    id: doi ? `oa:${doi}` : `oa:${createHash("sha256").update(title.toLowerCase()).digest("hex").slice(0, 16)}`,
    title, ...(authors.length ? { authors } : {}),
    ...(typeof venue?.display_name === "string" ? { venue: venue.display_name } : {}),
    ...(typeof work.publication_year === "number" ? { year: work.publication_year } : {}),
    sourceRef: doi ? `https://doi.org/${doi}` : work.id && typeof work.id === "string" ? String(work.id) : title,
    ...(doi ? { doi } : {})
  };
}

function crossrefItemToCandidate(item: Record<string, unknown>): HostCandidate | undefined {
  const title = Array.isArray(item.title) && typeof item.title[0] === "string" ? item.title[0].trim() : "";
  const doi = typeof item.DOI === "string" ? item.DOI : undefined;
  if (!title && !doi) return undefined;
  const authors = (Array.isArray(item.author) ? item.author as Array<Record<string, unknown>> : []).map((author) => [author.given, author.family].filter((part): part is string => typeof part === "string").join(" ").trim()).filter(Boolean);
  const venue = Array.isArray(item["container-title"]) && typeof item["container-title"][0] === "string" ? item["container-title"][0] : undefined;
  const issued = item.issued as { "date-parts"?: Array<Array<number | string>> } | undefined;
  const dateParts = issued?.["date-parts"]?.[0];
  const year = dateParts && typeof dateParts[0] === "number" ? dateParts[0] : undefined;
  return {
    id: doi ? `cr:${doi}` : `cr:${createHash("sha256").update(title.toLowerCase()).digest("hex").slice(0, 16)}`,
    title, ...(authors.length ? { authors } : {}),
    ...(venue ? { venue } : {}), ...(year ? { year } : {}),
    sourceRef: doi ? `https://doi.org/${doi}` : title,
    ...(doi ? { doi } : {})
  };
}

/** Reconstructs OpenAlex inverted-index abstracts into plain text. */
export function reconstructAbstract(inverted: unknown): string {
  if (!inverted || typeof inverted !== "object" || Array.isArray(inverted)) return "";
  const words: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(inverted as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (typeof position === "number") words.push({ word, position });
  }
  words.sort((a, b) => a.position - b.position);
  return words.map((entry) => entry.word).join(" ").slice(0, 50000);
}

function compactQueries(rq: string, hypothesis?: string): string[] {
  const seed = rq.replace(/\s+/g, " ").trim().slice(0, 300);
  const queries = [seed];
  if (hypothesis?.trim()) queries.push(`${seed} ${hypothesis.replace(/\s+/g, " ").trim().slice(0, 200)}`);
  return queries.slice(0, 2);
}

function similar(a: string, b: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return normalize(a).slice(0, 120) === normalize(b).slice(0, 120);
}
