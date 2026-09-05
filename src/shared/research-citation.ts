/**
 * Literature / citation verification (plan 9-6 Phase 9). Pure and shareable.
 *
 * A web-AI suggesting a paper is NOT a verified citation. Citations progress
 * through a strict ladder: source acquired → metadata verified → relevant
 * passage located → claim relation verified. Only CLAIM_SUPPORTED (or a
 * deliberate PARTIAL with reasons) may support a primary claim; UNSUPPORTED
 * citations must never back a primary claim.
 */

export type CitationStatus =
  | "UNSUPPORTED"        // suggested only; nothing acquired
  | "METADATA_ONLY"      // metadata verified (title/authors/venue)
  | "SOURCE_RETRIEVED"   // full source acquired
  | "PASSAGE_VERIFIED"   // relevant passage located in the source
  | "CLAIM_SUPPORTED"    // passage supports the claim
  | "PARTIAL"            // partial support with explicit caveats
  | "CONTRADICTED";      // source contradicts the claim

export const CITATION_LADDER: readonly CitationStatus[] = ["UNSUPPORTED", "METADATA_ONLY", "SOURCE_RETRIEVED", "PASSAGE_VERIFIED", "CLAIM_SUPPORTED", "PARTIAL", "CONTRADICTED"];

export interface CitationRecord {
  id: string;
  /** Bibliographic metadata proposed by an AI (never trusted as verified). */
  proposedTitle: string;
  proposedAuthors?: string[];
  proposedVenue?: string;
  /** DOI/URL the verifier attempted to acquire. */
  sourceRef?: string;
  status: CitationStatus;
  /** Passages from the acquired source that were located (bounded). */
  passages?: Array<{ quote: string; page?: string }>;
  reasons: string[];
  updatedAt: string;
}

export function validateCitationRecord(record: CitationRecord): void {
  if (!record || typeof record.id !== "string" || !record.id) throw new Error("Citation requires an id");
  if (typeof record.proposedTitle !== "string" || !record.proposedTitle.trim() || record.proposedTitle.length > 500) throw new Error("Citation title invalid");
  if (!CITATION_LADDER.includes(record.status)) throw new Error("Invalid citation status");
  if (!Array.isArray(record.reasons)) throw new Error("Citation reasons must be an array");
  if (record.passages && (record.passages.length > 50 || record.passages.some((passage) => typeof passage.quote !== "string" || !passage.quote || passage.quote.length > 4000))) throw new Error("Invalid citation passages");
}

/** Deterministic verification ladder: returns the max status reachable from evidence. */
export function verifyCitation(input: { sourceAcquired: boolean; metadataVerified: boolean; passageLocated: boolean; passageSupports: boolean; passageContradicts?: boolean }): CitationStatus {
  if (!input.sourceAcquired) return input.metadataVerified ? "METADATA_ONLY" : "UNSUPPORTED";
  if (!input.passageLocated) return "SOURCE_RETRIEVED";
  if (input.passageContradicts) return "CONTRADICTED";
  return input.passageSupports ? "CLAIM_SUPPORTED" : "PASSAGE_VERIFIED";
}

/** Primary claims may not rely on UNSUPPORTED citations (hard rule). */
export function primaryClaimSupported(records: CitationRecord[]): { ok: boolean; unsupported: string[] } {
  const unsupported = records.filter((record) => record.status === "UNSUPPORTED").map((record) => record.id);
  return { ok: unsupported.length === 0, unsupported };
}
