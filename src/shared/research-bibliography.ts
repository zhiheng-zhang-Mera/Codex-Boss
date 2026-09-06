/**
 * Bibliography generation (plan 9-6 Phase 9/11). Pure and shareable.
 *
 * `references.bib` is generated deterministically from *verified* citation
 * records — never from AI-suggested titles alone. A record is included only
 * when its source was actually acquired and does not contradict the claim
 * (status ∈ SOURCE_RETRIEVED / PASSAGE_VERIFIED / CLAIM_SUPPORTED / PARTIAL).
 * UNSUPPORTED / METADATA_ONLY / CONTRADICTED records are excluded from the
 * bibliography, matching the citation-audit rule that a primary claim must not
 * bind unverified or contradicting sources.
 */

import type { CitationRecord, CitationStatus } from "./research-citation";

export const BIBLIOGRAPHY_STATUSES: readonly CitationStatus[] = ["SOURCE_RETRIEVED", "PASSAGE_VERIFIED", "CLAIM_SUPPORTED", "PARTIAL"];

export function bibliographyEntries(records: CitationRecord[]): string[] {
  return records.filter((record) => BIBLIOGRAPHY_STATUSES.includes(record.status)).map((record) => {
    const key = (record.id || "citation").replace(/[^a-zA-Z0-9:_-]/g, "-");
    const authors = record.proposedAuthors?.length ? record.proposedAuthors.join(" and ") : "Unknown";
    const title = (record.proposedTitle ?? "Untitled").replace(/([{}])/g, "\\$1");
    const fields = [`title = {${title}}`, `author = {${authors}}`];
    if (record.proposedVenue) fields.push(`journal = {${record.proposedVenue.replace(/([{}])/g, "\\$1")}}`);
    if (record.sourceRef) fields.push(`url = {${record.sourceRef.replace(/([{}])/g, "\\$1")}}`);
    return `@misc{${key},\n  ${fields.join(",\n  ")}\n}`;
  });
}

export function referencesBib(records: CitationRecord[]): string {
  const entries = bibliographyEntries(records);
  const header = `% References generated deterministically from verified citations (${entries.length} verified).\n`;
  return header + (entries.length ? entries.join("\n\n") + "\n" : "% no verified citations yet\n");
}
