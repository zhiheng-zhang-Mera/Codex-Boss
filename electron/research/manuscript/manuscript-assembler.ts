import fs from "node:fs";
import path from "node:path";
import { validId } from "../../commander/durable-json";
import { MANUSCRIPT_SECTIONS, evidenceCheckDraft, resultTableToLatex, resultTableToMarkdown, type ManuscriptPlan, type ManuscriptSection, type ResultTable, type SectionBrief, type SectionDraft } from "../../../src/shared/research-manuscript";
import { summarizeCitationAudit, type CitationRecord } from "../../../src/shared/research-citation";
import { referencesBib } from "../../../src/shared/research-bibliography";

/**
 * Manuscript assembler (plan 9-6 Phase 11). Runs the section pipeline with an
 * injected per-section writer (live model in production, deterministic fake in
 * tests) and writes the plan's output tree: paper.md, paper.tex, references.bib
 * and the audit folder. Drafting is bounded: each section is written from its
 * brief, evidence-checked, and revised at most N times.
 */

export interface SectionWriter {
  write(brief: SectionBrief, revision: number): Promise<string>;
}

/**
 * Deterministic/live reviewer of one drafted section (plan Phase 11: brief →
 * draft → reviewer → evidence check → revision). Returning approved:false adds
 * notes and forces another revision (bounded by maxRevisions).
 */
export interface SectionReviewer {
  review(input: { section: ManuscriptSection; content: string; revision: number }): Promise<{ approved: boolean; notes: string[] }>;
}

export interface ManuscriptOptions {
  title: string;
  authors?: string[];
  plan: ManuscriptPlan;
  claims: Array<{ id: string; evidenceIds: string[] }>;
  evidenceIds: string[];             // available evidence node ids (from EvidenceGraph)
  writer: SectionWriter;
  reviewer?: SectionReviewer;
  maxRevisions?: number;
  /** Deterministic reproducibility audit (round 11); written when supplied. */
  reproducibility?: import("../evidence/repro-audit").ReproducibilityAudit;
  /** Citation records to audit (round 14); written into audit/citations.json when supplied. */
  citations?: CitationRecord[];
  /** Deterministic SVG figures (round 21); written into manuscript/figures/ when supplied. */
  figures?: Array<{ name: string; svg: string }>;
  /** Deterministic result tables (U7 §21); embedded into paper.md AND paper.tex. */
  tables?: ResultTable[];
}

export interface ManuscriptOutput {
  paperMd: string;
  paperTex: string;
  referencesBib: string;
  /** Names of figure files actually written into manuscript/figures/. */
  figures: string[];
  sections: Record<ManuscriptSection, SectionDraft>;
  audit: { citationsFile: string; reproducibilityFile: string; finalAuditFile: string; passed: boolean };
}

export async function assembleManuscript(directory: string, options: ManuscriptOptions): Promise<ManuscriptOutput> {
  const safeId = validId(options.plan.id);
  const manuscriptDir = path.join(directory, safeId, "manuscript");
  const auditDir = path.join(directory, safeId, "audit");
  fs.mkdirSync(manuscriptDir, { recursive: true });
  fs.mkdirSync(path.join(manuscriptDir, "figures"), { recursive: true });
  fs.mkdirSync(auditDir, { recursive: true });

  const available = new Set(options.evidenceIds);
  const sections: Record<string, SectionDraft> = {};
  const maxRevisions = options.maxRevisions ?? 3;
  for (const section of MANUSCRIPT_SECTIONS) {
    const brief = sectionBriefFor(options, section);
    let content = "";
    let status: SectionDraft["status"] = "REVISED";
    const reviewerNotes: string[] = [];
    for (let revision = 0; revision <= maxRevisions; revision += 1) {
      content = await options.writer.write(brief, revision);
      // Reviewer gate (plan Phase 11): draft → reviewer → evidence check.
      if (options.reviewer) {
        const review = await options.reviewer.review({ section, content, revision });
        reviewerNotes.push(...review.notes);
        if (!review.approved) {
          status = "REVIEWED";
          if (revision < maxRevisions) continue; // force another revision
        }
      }
      const verdict = evidenceCheckDraft({ section, allowedEvidenceIds: brief.evidenceIds, content }, available);
      if (verdict.passed) {
        status = "REVISED"; // reviewer approved (or absent) AND evidence check cleared
        break;
      }
      status = "EVIDENCE_CHECKED";
      if (revision === maxRevisions) content += "\n\n<!-- evidence check: " + verdict.missingEvidence.join(", ") + " -->";
    }
    sections[section] = { section, status, allowedEvidenceIds: brief.evidenceIds, content, reviewerNotes, revisions: content.includes("evidence check") ? maxRevisions : 0, updatedAt: new Date().toISOString() };
  }

  // Round-20: references.bib is generated from verified citation records when
  // supplied (never from AI-suggested titles alone); otherwise a stub header.
  const bibliography = options.citations ? referencesBib(options.citations) : `% References for ${options.title}\n`;
  fs.writeFileSync(path.join(manuscriptDir, "references.bib"), bibliography, "utf8");
  // Round-21: write deterministic SVG figures (real recorded metrics) into
  // manuscript/figures/; never invented, only what the caller supplies.
  const writtenFigures: string[] = [];
  for (const figure of options.figures ?? []) {
    const safeName = figure.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "figure.svg";
    fs.writeFileSync(path.join(manuscriptDir, "figures", safeName), figure.svg, "utf8");
    writtenFigures.push(safeName);
  }
  // Build the paper bodies once the written figure names are known, so
  // paper.md/paper.tex reference exactly the figures that exist on disk.
  const paperMd = assembleMarkdown(options, sections, writtenFigures);
  const paperTex = assembleLatex(options, sections, writtenFigures);
  fs.writeFileSync(path.join(manuscriptDir, "paper.md"), paperMd, "utf8");
  fs.writeFileSync(path.join(manuscriptDir, "paper.tex"), paperTex, "utf8");
  const citationsFile = path.join(auditDir, "citations.json");
  const reproducibilityFile = path.join(auditDir, "reproducibility.json");
  const finalAuditFile = path.join(auditDir, "final-audit.json");
  // Round-14: real citation audit replaces the static PENDING stub when records
  // are supplied (never fabricated; primary claims must not bind UNSUPPORTED).
  const citationAudit = options.citations ? summarizeCitationAudit(options.citations) : null;
  fs.writeFileSync(citationsFile, JSON.stringify(citationAudit ?? { status: "PENDING" }, null, 2));
  // Round-11: a real reproducibility audit replaces the static PENDING stub when
  // the caller supplies recorded-run analysis (never fabricated).
  const reproducibility = options.reproducibility ?? { status: "PENDING", reason: "not audited", at: new Date().toISOString() };
  fs.writeFileSync(reproducibilityFile, JSON.stringify(reproducibility, null, 2));
  const passed = Object.values(sections).every((section) => section.status === "REVISED") && (options.citations ? citationAudit!.ok : true);
  fs.writeFileSync(finalAuditFile, JSON.stringify({
    passed,
    sections: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.status])),
    reproducibility: reproducibility.status,
    citations: citationAudit ? { ok: citationAudit.ok, verified: citationAudit.verified, unsupported: citationAudit.unsupportedIds, contradicted: citationAudit.contradictedIds } : "PENDING"
  }, null, 2));

  return { paperMd, paperTex, referencesBib: bibliography, figures: writtenFigures, sections, audit: { citationsFile, reproducibilityFile, finalAuditFile, passed } };
}

function sectionBriefFor(options: ManuscriptOptions, section: ManuscriptSection): SectionBrief {
  const claimIds = options.claims.filter((claim) => (options.plan.claimsToSections[claim.id] ?? []).includes(section)).map((claim) => claim.id);
  const evidenceIds = [...new Set(options.claims.filter((claim) => claimIds.includes(claim.id)).flatMap((claim) => claim.evidenceIds))];
  return { section, purpose: "", claimIds, evidenceIds };
}

function assembleMarkdown(options: ManuscriptOptions, sections: Record<string, SectionDraft>, figures: string[]): string {
  const lines = [`# ${options.title}`, ""];
  if (options.authors?.length) lines.push(...options.authors.map((author) => `- ${author}`), "");
  for (const section of MANUSCRIPT_SECTIONS) lines.push(`## ${section}`, "", sections[section].content, "");
  // Result tables (U7 §21) render between sections and figures in paper.md.
  if ((options.tables ?? []).length) {
    lines.push("## Result Tables", "");
    for (const table of options.tables ?? []) lines.push(resultTableToMarkdown(table), "");
  }
  // Figures section references only files actually written into manuscript/figures/.
  if (figures.length) {
    lines.push("## Figures", "");
    for (const figure of figures) lines.push(`![${figure}](figures/${figure})`, "");
  }
  return lines.join("\n");
}

const MANUSCRIPT_TO_LATEX: Record<ManuscriptSection, { title: string; isAbstract: boolean }> = {
  abstract: { title: "Abstract", isAbstract: true },
  introduction: { title: "Introduction", isAbstract: false },
  methods: { title: "Methods", isAbstract: false },
  results: { title: "Results", isAbstract: false },
  discussion: { title: "Discussion", isAbstract: false },
  conclusion: { title: "Conclusion", isAbstract: false }
};

function assembleLatex(options: ManuscriptOptions, sections: Record<string, SectionDraft>, figures: string[]): string {
  // Plan §32: never stuff Introduction/Methods/Results/… into the abstract.
  const body = MANUSCRIPT_SECTIONS.map((section) => {
    const spec = MANUSCRIPT_TO_LATEX[section];
    const content = latexEscapeText(sections[section].content);
    return spec.isAbstract
      ? `\\begin{abstract}\n${content}\n\\end{abstract}`
      : `\\section{${spec.title}}\n${content}`;
  }).join("\n\n");
  const figureBlock = buildLatexFigureBlock(figures);
  // U7 §21: result tables embed into paper.tex as real LaTeX tabular blocks.
  const tableBlock = (options.tables ?? []).map((table) => resultTableToLatex(table)).join("\n\n");
  const bibliography = options.citations ? "\n\\bibliographystyle{plain}\n\\bibliography{references}" : "";
  return ["\\documentclass{article}", "\\usepackage{graphicx}", "\\begin{document}", `\\title{${latexEscapeText(options.title)}}`, "\\maketitle", body, figureBlock, tableBlock, bibliography, "\\end{document}"].join("\n");
}

/**
 * Escapes plain prose for LaTeX text mode so metric names like
 * `answer_accuracy`, percentages and Unicode punctuation cannot break
 * compilation ("Missing $ inserted" etc). Writer content is pure text, never
 * LaTeX commands, so escaping is safe.
 */
function latexEscapeText(text: string): string {
  const SENTINEL = "\uFFFE"; // backslash placeholder (prose never contains this)
  return text
    .replace(/\\/g, SENTINEL)
    .replace(/([{}_#$%&])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/×/g, "x")
    .replace(/—/g, "--")
    .replace(/–/g, "--")
    .replace(new RegExp(SENTINEL, "g"), "\\textbackslash{}");
}

/**
 * LaTeX-compatible figure block. pdflatex/xelatex cannot compile SVG charts,
 * so only engine-readable files (pdf/png/jpg/eps) are embedded via
 * \includegraphics; SVG charts (kept for paper.md + the audit tree) are listed
 * as a comment so the .tex still compiles on a real TeX engine.
 */
function buildLatexFigureBlock(figures: string[]): string {
  if (figures.length === 0) return "";
  const embeddable = figures.filter((name) => /\.(pdf|png|jpg|jpeg|eps)$/i.test(name));
  const charts = figures.filter((name) => /\.svg$/i.test(name));
  const block: string[] = [];
  if (embeddable.length) {
    block.push("\\begin{figure}[h]");
    for (const figure of embeddable) block.push(`\\includegraphics[width=\\linewidth]{${figure}}`);
    block.push("\\end{figure}");
  }
  if (charts.length) block.push(`% SVG charts rendered in paper.md (not LaTeX-embeddable): ${charts.join(", ")}`);
  return block.join("\n");
}
