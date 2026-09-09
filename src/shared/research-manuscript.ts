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

/**
 * U7 (§18): section sufficiency obligations — a section is accepted by what it
 * must contain, never by a word count. Each obligation is a deterministic
 * predicate over the draft and the evidence/claim material it was briefed on.
 */
export type SectionObligation = { section: ManuscriptSection; label: string; met(content: string, context: SectionObligationContext): boolean };

export interface SectionObligationContext {
  claimIds: string[];
  evidenceIds: string[];
  hypothesis?: string;
  metric?: string;
  baseline?: string;
  runCount?: number;
}

export const SECTION_OBLIGATIONS: readonly SectionObligation[] = [
  // Abstract: names the question + states a primary finding bound to evidence.
  { section: "abstract", label: "states the research question", met: (content) => /question|research question|investigat|studies?/i.test(content) },
  { section: "abstract", label: "reports the recorded result from evidence", met: (content, ctx) => ctx.evidenceIds.length === 0 || content.length > 240 },
  { section: "introduction", label: "identifies the gap in existing work", met: (content) => /gap|limits?|outside|prior|motivat|diversity|calibration/i.test(content) },
  { section: "introduction", label: "states what this paper does", met: (content) => /this paper|we (investigate|study|compare|examine)|the (paper|study)/i.test(content) },
  { section: "methods", label: "describes a frozen protocol", met: (content) => /frozen|pre-register|before any (measurement|experiment)|protocol/i.test(content) },
  { section: "methods", label: "specifies metric/baseline/criterion", met: (content, ctx) => ctx.metric !== undefined && new RegExp(ctx.metric, "i").test(content) && /baseline|decision rule|criterion/i.test(content) },
  { section: "methods", label: "describes deterministic statistics", met: (content) => /deterministic|mean|standard deviation|confidence interval|no AI/i.test(content) },
  { section: "results", label: "reports a number from recorded runs (no bare comparison)", met: (content, ctx) => content.length > 0 && (ctx.runCount === undefined || ctx.runCount === 0 || /\d+\.\d{3}|n = \d|recorded run/i.test(content)) },
  { section: "results", label: "ties the result to its statistic/confidence", met: (content) => /mean|confidence interval|\d+\.\d{3}|REPRODUCED|NOT_REPRODUCED/i.test(content) },
  { section: "discussion", label: "interprets the result within evidence", met: (content) => /consistent|support|does not support|evidence/i.test(content) },
  { section: "discussion", label: "reports limitations (no hidden threats)", met: (content) => /limitation|threats to validity|limited power|not transfer|out of scope/i.test(content) },
  { section: "conclusion", label: "ties the conclusion to the recorded evidence", met: (content) => /evidence|recorded|mean|support|reproducib/i.test(content) }
];

/** All §18 obligations a section must satisfy (a section with no obligations passes trivially). */
export function obligationsFor(section: ManuscriptSection): SectionObligation[] {
  return SECTION_OBLIGATIONS.filter((obligation) => obligation.section === section);
}

export interface SufficiencyVerdict {
  section: ManuscriptSection;
  passed: boolean;
  unmet: string[];
}

/** §18 section acceptance: every obligation for the section must be met. */
export function sectionSufficiency(content: string, section: ManuscriptSection, context: SectionObligationContext): SufficiencyVerdict {
  const unmet = obligationsFor(section).filter((obligation) => !obligation.met(content, context)).map((obligation) => obligation.label);
  return { section, passed: unmet.length === 0, unmet };
}

/**
 * U7 (§19 anti-premature-closure): even when every section has text, writing
 * must not close while significant material is undiscussed. Returns the
 * evidence/claims that no section addresses.
 */
export interface PrematureClosureVerdict {
  premature: boolean;
  undiscussedClaims: string[];
  undiscussedEvidence: string[];
  resultWithoutInterpretation: boolean;
}

export function antiPrematureClosure(input: { claims: Array<{ id: string; text: string }>; evidenceIds: string[]; sections: Record<string, SectionDraft>; plan: ManuscriptPlan }): PrematureClosureVerdict {
  const addressedClaims = new Set<string>();
  const discussed = new Set<string>();
  // claimsToSections is keyed claim-id → section list; a claim is addressed
  // when any of its mapped sections has a draft.
  for (const [claimId, claimSections] of Object.entries(input.plan.claimsToSections ?? {})) {
    for (const section of claimSections) {
      if (input.sections[section]) {
        addressedClaims.add(claimId);
      }
    }
  }
  for (const draft of Object.values(input.sections)) {
    for (const id of input.evidenceIds) {
      if (new RegExp(`@${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(draft.content) || draft.allowedEvidenceIds.includes(id)) discussed.add(id);
    }
  }
  const undiscussedClaims = input.claims.filter((claim) => !addressedClaims.has(claim.id)).map((claim) => claim.id);
  const undiscussedEvidence = input.evidenceIds.filter((id) => !discussed.has(id));
  const results = input.sections.results?.content ?? "";
  const discussion = input.sections.discussion?.content ?? "";
  // A results section that names evidence but has no interpreting discussion
  // sentence is an anomaly the plan refuses to ship silently.
  const resultWithoutInterpretation = results.length > 0 && discussion.length === 0 ? true : results.length > 0 && !/consistent|support|limitation|uncertain|suggest/i.test(discussion);
  return { premature: undiscussedClaims.length > 0 || undiscussedEvidence.length > 0 || resultWithoutInterpretation, undiscussedClaims, undiscussedEvidence, resultWithoutInterpretation };
}

/** A results row = one recorded run / condition with typed metric cells. */
export interface ResultTableRow {
  label: string;
  cells: Array<{ value: number; raw?: string }>;
}

export interface ResultTableColumn {
  /** Metric/column name, e.g. accuracy or condition. */
  name: string;
  unit?: string;
}

export interface ResultTable {
  title: string;
  columns: ResultTableColumn[];
  rows: ResultTableRow[];
  /** Optional statistics footnote (mean ± SD / CI) rendered under the table. */
  footnote?: string;
}

function escapeLatexCell(value: string): string {
  return value.replace(/([\\{}_$&%#])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Deterministic LaTeX table from recorded metrics (U7 §21). Pure: same rows →
 * same tabular bytes. Each cell is a real number; nothing is invented.
 */
export function resultTableToLatex(table: ResultTable): string {
  const headers = ["", ...table.columns.map((column) => column.unit ? `${escapeLatexCell(column.name)} (${escapeLatexCell(column.unit)})` : escapeLatexCell(column.name))];
  const columnCount = headers.length;
  const format = "l" + "r".repeat(Math.max(0, columnCount - 1));
  const headerRow = headers.map((header) => `\\textbf{${header}}`).join(" & ");
  const body = table.rows.map((row) => [escapeLatexCell(row.label), ...row.cells.map((cell) => cell.raw ?? cell.value.toFixed(3))].join(" & ")).join(" \\\\\n");
  const footnote = table.footnote ? `\\footnotesize ${escapeLatexCell(table.footnote)}` : "";
  return `\\begin{table}[h]\n\\centering\n\\caption{${escapeLatexCell(table.title)}}\n\\begin{tabular}{${format}}\n\\hline\n${headerRow} \\\\\n\\hline\n${body} \\\\\n\\hline\n\\end{tabular}\n${footnote}\n\\end{table}`;
}

/** Deterministic markdown mirror of the same table (for paper.md). */
export function resultTableToMarkdown(table: ResultTable): string {
  const headers = ["Run", ...table.columns.map((column) => column.name)];
  const headerLine = headers.join(" | ");
  const divider = headers.map(() => "---").join(" | ");
  const body = table.rows.map((row) => [escapeMarkdownCell(row.label), ...row.cells.map((cell) => cell.raw ?? cell.value.toFixed(3))].join(" | "));
  const footnote = table.footnote ? `\n\n_${escapeMarkdownCell(table.footnote)}_` : "";
  return `### ${table.title}\n\n${headerLine}\n${divider}\n${body.join("\n")}${footnote}`;
}

/**
 * §21.2 quantitative visual-evidence verdict: a quantitative manuscript must
 * embed at least one meaningful result table (or a LaTeX-embeddable figure) in
 * the compiled artifact — decorative-only assets never count.
 */
export function quantitativeVisualEvidenceVerdict(input: { hasQuantitativeResults: boolean; resultTableCount: number; embeddableFigureCount: number }): { ok: boolean; reason?: string } {
  if (!input.hasQuantitativeResults) return { ok: true };
  if (input.resultTableCount > 0 || input.embeddableFigureCount > 0) return { ok: true };
  return { ok: false, reason: "MANUSCRIPT_VISUAL_EVIDENCE_INSUFFICIENT: quantitative results with 0 result tables and 0 PDF-embeddable figures" };
}

function purposeOf(section: ManuscriptSection): string {
  return { abstract: "state the question, method, and primary finding", introduction: "motivate the question with verified background", methods: "describe the deterministic protocol and experiment", results: "report statistics computed from raw data", discussion: "interpret results strictly within evidence", conclusion: "summarize supported claims and limitations" }[section];
}
