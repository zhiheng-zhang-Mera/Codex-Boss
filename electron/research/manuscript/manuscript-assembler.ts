import fs from "node:fs";
import path from "node:path";
import { validId } from "../../commander/durable-json";
import { MANUSCRIPT_SECTIONS, evidenceCheckDraft, type ManuscriptPlan, type ManuscriptSection, type SectionBrief, type SectionDraft } from "../../../src/shared/research-manuscript";
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

export interface ManuscriptOptions {
  title: string;
  authors?: string[];
  plan: ManuscriptPlan;
  claims: Array<{ id: string; evidenceIds: string[] }>;
  evidenceIds: string[];             // available evidence node ids (from EvidenceGraph)
  writer: SectionWriter;
  maxRevisions?: number;
  /** Deterministic reproducibility audit (round 11); written when supplied. */
  reproducibility?: import("../evidence/repro-audit").ReproducibilityAudit;
  /** Citation records to audit (round 14); written into audit/citations.json when supplied. */
  citations?: CitationRecord[];
  /** Deterministic SVG figures (round 21); written into manuscript/figures/ when supplied. */
  figures?: Array<{ name: string; svg: string }>;
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
    for (let revision = 0; revision <= maxRevisions; revision += 1) {
      content = await options.writer.write(brief, revision);
      const verdict = evidenceCheckDraft({ section, allowedEvidenceIds: brief.evidenceIds, content }, available);
      if (verdict.passed) break;
      status = "EVIDENCE_CHECKED";
      if (revision === maxRevisions) content += "\n\n<!-- evidence check: " + verdict.missingEvidence.join(", ") + " -->";
    }
    sections[section] = { section, status, allowedEvidenceIds: brief.evidenceIds, content, revisions: content.includes("evidence check") ? maxRevisions : 0, updatedAt: new Date().toISOString() };
  }

  const paperMd = assembleMarkdown(options, sections);
  const paperTex = assembleLatex(options, sections);
  // Round-20: references.bib is generated from verified citation records when
  // supplied (never from AI-suggested titles alone); otherwise a stub header.
  const bibliography = options.citations ? referencesBib(options.citations) : `% References for ${options.title}\n`;
  fs.writeFileSync(path.join(manuscriptDir, "paper.md"), paperMd, "utf8");
  fs.writeFileSync(path.join(manuscriptDir, "paper.tex"), paperTex, "utf8");
  fs.writeFileSync(path.join(manuscriptDir, "references.bib"), bibliography, "utf8");
  // Round-21: write deterministic SVG figures (real recorded metrics) into
  // manuscript/figures/; never invented, only what the caller supplies.
  const writtenFigures: string[] = [];
  for (const figure of options.figures ?? []) {
    const safeName = figure.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "figure.svg";
    fs.writeFileSync(path.join(manuscriptDir, "figures", safeName), figure.svg, "utf8");
    writtenFigures.push(safeName);
  }

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

function assembleMarkdown(options: ManuscriptOptions, sections: Record<string, SectionDraft>): string {
  const lines = [`# ${options.title}`, ""];
  if (options.authors?.length) lines.push(...options.authors.map((author) => `- ${author}`), "");
  for (const section of MANUSCRIPT_SECTIONS) lines.push(`## ${section}`, "", sections[section].content, "");
  return lines.join("\n");
}

function assembleLatex(options: ManuscriptOptions, sections: Record<string, SectionDraft>): string {
  const command = { abstract: "abstract", introduction: "section{Introduction}", methods: "section{Methods}", results: "section{Results}", discussion: "section{Discussion}", conclusion: "section{Conclusion}" };
  const body = MANUSCRIPT_SECTIONS.map((section) => sections[section].content).join("\n\n");
  return ["\\documentclass{article}", "\\begin{document}", `\\title{${options.title}}`, "\\maketitle", "\\begin{abstract}" + body + "\\end{abstract}", "\\end{document}"].join("\n");
}
