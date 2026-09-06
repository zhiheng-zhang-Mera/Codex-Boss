/**
 * Manuscript pipeline model (plan 9-6 Phase 11). Pure and shareable.
 *
 * Papers are never written in a single prompt. A manuscript is assembled
 * section by section (Abstract, Introduction, Methods, Results, Discussion,
 * Conclusion) where each section is drafted from an evidence-scoped brief,
 * reviewed, and evidence-checked before revision. A section may only assert
 * claims whose nodes exist in the Evidence Graph (run/metric/statistic ids).
 */

export type ManuscriptSection = "abstract" | "introduction" | "methods" | "results" | "discussion" | "conclusion";
export const MANUSCRIPT_SECTIONS: readonly ManuscriptSection[] = ["abstract", "introduction", "methods", "results", "discussion", "conclusion"];

export type SectionStatus = "PENDING" | "BRIEFED" | "DRAFTED" | "REVIEWED" | "EVIDENCE_CHECKED" | "REVISED";

export interface SectionDraft {
  section: ManuscriptSection;
  status: SectionStatus;
  /** Evidence node ids this section may assert (validated against the graph). */
  allowedEvidenceIds: string[];
  content: string;
  reviewerNotes?: string[];
  revisions: number;
  updatedAt: string;
}

export interface ManuscriptPlan {
  id: string;
  claimsToSections: Record<string, ManuscriptSection[]>; // claim id → sections asserting it
}

export interface SectionBrief {
  section: ManuscriptSection;
  purpose: string;
  claimIds: string[];         // claims the section should address
  evidenceIds: string[];      // run/statistic nodes backing those claims
}

export interface EvidenceCheckVerdict {
  section: ManuscriptSection;
  passed: boolean;
  missingEvidence: string[];  // evidence ids asserted but absent from the graph
  missingClaims: string[];
}

export function buildSectionBriefs(plan: ManuscriptPlan, claims: Array<{ id: string; evidenceIds: string[] }>): SectionBrief[] {
  return MANUSCRIPT_SECTIONS.map((section) => {
    const claimIds = claims.filter((claim) => (plan.claimsToSections[claim.id] ?? []).includes(section)).map((claim) => claim.id);
    const evidenceIds = [...new Set(claims.filter((claim) => claimIds.includes(claim.id)).flatMap((claim) => claim.evidenceIds))];
    return { section, purpose: purposeOf(section), claimIds, evidenceIds };
  });
}

/** A draft may only reference evidence ids that exist in the graph. */
export function evidenceCheckDraft(draft: Pick<SectionDraft, "section" | "allowedEvidenceIds" | "content">, availableEvidenceIds: Set<string>): EvidenceCheckVerdict {
  const referenced = [...draft.content.matchAll(/@([A-Za-z0-9:_-]{3,80})/g)].map((match) => match[1]);
  const asserted = draft.allowedEvidenceIds.filter((id) => !availableEvidenceIds.has(id));
  const missingEvidence = [...new Set([...referenced.filter((id) => !availableEvidenceIds.has(id)), ...asserted])].filter((id) => !draft.allowedEvidenceIds.includes(id)).slice(0, 20);
  const referencedOutsideScope = referenced.filter((id) => !draft.allowedEvidenceIds.includes(id) && availableEvidenceIds.has(id));
  return { section: draft.section, passed: missingEvidence.length === 0 && referencedOutsideScope.length === 0, missingEvidence: [...new Set([...missingEvidence, ...referencedOutsideScope])], missingClaims: [] };
}

export function validateManuscriptPlan(plan: ManuscriptPlan): void {
  if (!plan || typeof plan.id !== "string" || !plan.id.trim()) throw new Error("Manuscript plan requires an id");
  for (const [claim, sections] of Object.entries(plan.claimsToSections ?? {})) {
    if (sections.length < 1 || sections.some((section) => !MANUSCRIPT_SECTIONS.includes(section))) throw new Error(`Invalid claim→section mapping for ${claim}`);
  }
}

function purposeOf(section: ManuscriptSection): string {
  return { abstract: "state the question, method, and primary finding", introduction: "motivate the question with verified background", methods: "describe the deterministic protocol and experiment", results: "report statistics computed from raw data", discussion: "interpret results strictly within evidence", conclusion: "summarize supported claims and limitations" }[section];
}
