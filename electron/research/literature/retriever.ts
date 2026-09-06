/**
 * Literature retrieval closure (milestone §9). Deterministic core for the
 * bounded research literature loop:
 *
 *   RQ → bounded search query → candidate metadata → DOI/title dedup →
 *   source acquisition → CitationSourceStore → metadata verify → passage verify
 *
 * The search/acquire steps are injected (a fixture or a live web/API adapter);
 * the loop itself is host-deterministic: bounded passes (search budget),
 * dedup by DOI/title before acquisition, and every acquired source lands in
 * the CitationSourceStore (never an AI title alone). No infinite
 * "keep finding literature" is possible — pass 2/3 only run when explicitly
 * requested (context/novelty gap) and each pass is bounded.
 */

import type { CitationRecord } from "../../../src/shared/research-citation";
import type { CitationSourceStore } from "./source-store";
import { createHash } from "node:crypto";

export interface LiteratureCandidate {
  id: string;
  title: string;
  authors?: string[];
  venue?: string;
  year?: number;
  sourceRef?: string;
  doi?: string;
}

export interface LiteratureAcquisition {
  /** Full acquired source text (content-addressed cache fodder). */
  text: string;
  /** Structural metadata was verified against the source. */
  metadataVerified: boolean;
  /** A passage located verbatim inside the text (mechanical check). */
  quote?: string;
}

/** Literature search budget: Pass 1 is the default; 2/3 only on explicit gaps. */
export type LiteraturePass = 1 | 2 | 3;
export const MAX_PASS_SOURCES = 10; // §9: Pass 1 is 5–10 highly relevant sources

/** Builds bounded search queries from the RQ (+hypothesis when present). */
export function planLiteratureQueries(rq: string, hypothesis?: string, pass: LiteraturePass = 1): string[] {
  const seed = compact(rq).split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const queries: string[] = [];
  if (pass === 1) {
    queries.push(seed ? `evidence for: ${seed}` : rq);
    if (hypothesis && hypothesis.trim()) queries.push(`methodology: ${compact(hypothesis).slice(0, 200)}`);
    // Bound: Pass 1 never fans out beyond a small set.
    queries.splice(1);
  } else if (pass === 2) {
    queries.push(`context and novelty: ${seed || rq}`);
  } else {
    queries.push(`reviewer-identified gap: ${seed || rq}`);
  }
  return queries.slice(0, 2);
}

/** DOI/title-based dedup before acquisition (no duplicate source fetches). */
export function dedupeLiteratureCandidates(candidates: LiteratureCandidate[]): LiteratureCandidate[] {
  const seen = new Set<string>();
  const out: LiteratureCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.doi ? `doi:${candidate.doi.trim().toLowerCase()}` : candidate.sourceRef ? `ref:${candidate.sourceRef.trim()}` : `title:${slug(candidate.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export interface LiteratureRetrieveResult {
  pass: LiteraturePass;
  candidates: number;
  acquired: string[];      // candidate ids whose sources were acquired + stored
  failed: string[];        // candidate ids whose acquisition failed
  verified: number;        // records that reached ≥ SOURCE_RETRIEVED
  reasons: string[];
}

export interface LiteratureRetrieverDeps {
  store: CitationSourceStore;
  /** Semantic/metadata search over a query → candidate list (bounded by max). */
  search: (query: string, max: number) => Promise<LiteratureCandidate[]>;
  /** Acquires the full source text for a candidate; null when unretrievable. */
  acquire: (candidate: LiteratureCandidate) => Promise<LiteratureAcquisition | null>;
}

/**
 * One bounded literature retrieval loop. Every acquired source is stored
 * (saveSource + verification ladder) through the CitationSourceStore — never
 * recorded on an AI title alone. Returns what was acquired/verified/failed so
 * the caller can decide whether a further explicit pass is warranted.
 */
export async function retrieveLiterature(input: { researchId: string; rq: string; hypothesis?: string; pass?: LiteraturePass }, deps: LiteratureRetrieverDeps): Promise<LiteratureRetrieveResult> {
  const pass = input.pass ?? 1;
  const reasons: string[] = [];
  const queries = planLiteratureQueries(input.rq, input.hypothesis, pass);
  const candidates = dedupeLiteratureCandidates((await Promise.all(queries.map((query) => deps.search(query, MAX_PASS_SOURCES)))).flat());
  if (candidates.length === 0) return { pass, candidates: 0, acquired: [], failed: [], verified: 0, reasons: ["no candidates returned"] };
  if (candidates.length > MAX_PASS_SOURCES * 2) reasons.push("candidate list truncated to bound");
  const bounded = candidates.slice(0, MAX_PASS_SOURCES * 2);
  const acquired: string[] = [];
  const failed: string[] = [];
  for (const candidate of bounded) {
    const acquisition = await deps.acquire(candidate);
    if (!acquisition) {
      failed.push(candidate.id);
      continue;
    }
    const citationId = candidate.id;
    const sourceRef = candidate.sourceRef ?? `lit:${candidate.id}`;
    deps.store.put({
      id: citationId,
      proposedTitle: candidate.title.slice(0, 500),
      proposedAuthors: candidate.authors,
      proposedVenue: candidate.venue,
      sourceRef,
      status: "UNSUPPORTED",
      reasons: ["acquired by literature retriever; verification pending"],
      updatedAt: new Date().toISOString()
    });
    deps.store.saveSource(sourceRef, acquisition.text);
    const quote = acquisition.quote ?? "";
    const passageLocated = Boolean(quote) && acquisition.text.includes(quote);
    deps.store.verifySource(citationId, {
      metadataVerified: acquisition.metadataVerified,
      passageLocated,
      passages: passageLocated ? [{ quote: quote.slice(0, 4000) }] : undefined
    });
    acquired.push(citationId);
  }
  const records = deps.store.list().filter((record) => acquired.includes(record.id));
  return { pass, candidates: bounded.length, acquired, failed, verified: records.filter((record) => record.status !== "UNSUPPORTED" && record.status !== "METADATA_ONLY").length, reasons };
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function slug(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase(), "utf8").digest("hex").slice(0, 24);
}
