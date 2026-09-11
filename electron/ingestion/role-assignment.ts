/**
 * Multi-file role assignment + conflict diagnostics (Work Unit 1).
 *
 * When a user attaches several files at once, this decides which one is the
 * primary specification, which are sub-plans, references or acceptance
 * criteria — from content features, never from the file name alone — and then
 * isolates the sections that disagree so a human sees exactly which two blocks
 * conflict instead of a vague "documents differ".
 *
 * Conflicts are deterministic: they are exact duplicates (same section hash),
 * near-duplicates (token similarity >= 0.9) and heading-aligned disagreements
 * (same normalized heading, similarity <= 0.5). Everything in between is
 * reported as "review" for a model or human, never silently resolved.
 */
import {
  classifyWorkBook,
  isSameText,
  normalizeHeading,
  similarityOf,
  type CanonicalTaskDocument,
  type CanonicalSection,
  type WorkBookVerdict
} from "../../src/shared/workbook";

export type SourceRole = "PRIMARY_SPEC" | "SUB_PLAN" | "REFERENCE" | "ACCEPTANCE_CRITERIA";

export const SOURCE_ROLES: readonly SourceRole[] = ["PRIMARY_SPEC", "SUB_PLAN", "REFERENCE", "ACCEPTANCE_CRITERIA"];

export interface DocumentAnalysis {
  document_id: string;
  file_name: string;
  verdict: WorkBookVerdict;
  role: SourceRole;
  /** Deterministic score that produced the role (higher wins per role). */
  role_score: number;
  /** Every role score, for auditability. */
  role_scores: Record<SourceRole, number>;
}

export interface RoleAssignment {
  assignments: DocumentAnalysis[];
  /** At most one document per role. */
  winners: Partial<Record<SourceRole, string>>;
  primary_document_id?: string;
  /** Deterministic order used to break ties (input order). */
  order: string[];
  diagnostics: ConflictDiagnostic[];
}

export type ConflictKind = "DUPLICATE_SECTION" | "CONFLICTING_SECTION" | "ROLE_CONFLICT" | "NEAR_DUPLICATE_SECTION" | "REVIEW_SECTION";

export interface ConflictDiagnostic {
  kind: ConflictKind;
  severity: "INFO" | "WARN" | "ERROR";
  message: string;
  /** The isolated conflicting blocks, when the conflict is section-level. */
  sections: { document_id: string; file_name: string; section_id: string; heading?: string; hash: string }[];
  similarity?: number;
  normalized_heading?: string;
}

const PLAN_PATTERNS = [/^(?:tasks?|steps?|work\s*items?|sub-?tasks?|milestones?|plan|实施步骤|任务列表|执行步骤|子任务|阶段|里程碑)\b/i];
const ACCEPTANCE_PATTERNS = [/^(?:acceptance\s+criteria|definition\s+of\s+done|done\s+criteria|验收标准|验收条件|完成标准|测试标准|成功标准)\b/i];
const REFERENCE_PATTERNS = [/^(?:references?|appendix|appendices|bibliography|glossary|参考文献|附录|术语表|参考资料)\b/i, /revision\s+history|changelog|修订历史|版本历史|变更记录/i];

function headingMatches(section: CanonicalSection, patterns: RegExp[]): boolean {
  if (!section.heading) return false;
  return patterns.some((pattern) => pattern.test(section.heading!.trim()));
}

function countMatches(document: CanonicalTaskDocument, patterns: RegExp[]): number {
  return document.sections.filter((section) => headingMatches(section, patterns)).length;
}

/**
 * Scores every role for one document. Role scores are content-derived:
 * acceptance criteria weigh by explicit acceptance items, sub-plan by
 * executable plan sections, reference by citation/appendix features, and the
 * primary spec by executable score plus overall declaration density.
 */
export function scoreRoles(document: CanonicalTaskDocument, verdict: WorkBookVerdict): Record<SourceRole, number> {
  const acceptanceSections = countMatches(document, ACCEPTANCE_PATTERNS);
  const planSections = countMatches(document, PLAN_PATTERNS);
  const referenceSections = countMatches(document, REFERENCE_PATTERNS);
  const declarationSections = document.sections.filter((section) => Boolean(section.heading)).length;
  const executable = verdict.score;

  return {
    ACCEPTANCE_CRITERIA: acceptanceSections * 4 + (verdict.features.checklistCount > 0 ? 1 : 0),
    SUB_PLAN: planSections * 4 + verdict.features.numberedLines * 0.2 + (verdict.features.imperativeHits >= 5 ? 1 : 0),
    REFERENCE: referenceSections * 4 + (verdict.kind === "REFERENCE" ? 3 : 0) + verdict.features.tableRows * 0.05,
    PRIMARY_SPEC: executable * 1.5 + declarationSections * 0.5 + (verdict.kind === "EXECUTABLE_WORKBOOK" ? 2 : 0)
  };
}

/** Highest-priority role first: the primary spec is the most consequential. */
const ROLE_PRIORITY: readonly SourceRole[] = ["PRIMARY_SPEC", "ACCEPTANCE_CRITERIA", "SUB_PLAN", "REFERENCE"];

function roleFor(scores: Record<SourceRole, number>): { role: SourceRole; score: number } {
  let best: SourceRole = "REFERENCE";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const role of ROLE_PRIORITY) {
    const score = scores[role];
    if (score > bestScore) { best = role; bestScore = score; }
  }
  return { role: best, score: bestScore };
}

/**
 * Assigns exactly one role per document and isolates cross-document conflicts.
 * Contested roles are resolved deterministically (role score, then
 * classification confidence, then file name) and reported instead of guessed;
 * a losing document takes the next role that is still free.
 */
export function assignRoles(documents: CanonicalTaskDocument[]): RoleAssignment {
  const diagnostics: ConflictDiagnostic[] = [];
  const assignments: DocumentAnalysis[] = [];
  const scoresByDocument = new Map<string, Record<SourceRole, number>>();

  for (const document of documents) {
    const verdict = classifyWorkBook({ content: document.content, sections: document.sections.map((section) => ({ heading: section.heading, kind: section.kind, text: section.text })) });
    const scores = scoreRoles(document, verdict);
    scoresByDocument.set(document.id, scores);
    const preferred = roleFor(scores);
    assignments.push({
      document_id: document.id,
      file_name: document.file_name,
      verdict,
      role: preferred.role,
      role_score: Number(preferred.score.toFixed(4)),
      role_scores: scores
    });
  }

  const winners: Partial<Record<SourceRole, string>> = {};
  const assigned = new Set<string>();
  // Deterministic tie-break: role score, then classification confidence, then
  // the caller's document order (never the file name, so results are stable
  // even when a document is renamed).
  const orderIndex = new Map(documents.map((document, index) => [document.id, index]));
  for (const role of ROLE_PRIORITY) {
    const contenders = assignments
      .filter((entry) => !assigned.has(entry.document_id) && entry.role === role)
      .sort((a, b) => (b.role_score - a.role_score)
        || (b.verdict.confidence - a.verdict.confidence)
        || (orderIndex.get(a.document_id) ?? 0) - (orderIndex.get(b.document_id) ?? 0)
        || a.document_id.localeCompare(b.document_id));
    const winner = contenders[0];
    if (!winner) continue;
    winners[role] = winner.document_id;
    assigned.add(winner.document_id);
    if (contenders.length > 1) {
      diagnostics.push({
        kind: "ROLE_CONFLICT",
        severity: role === "PRIMARY_SPEC" ? "ERROR" : "WARN",
        message: `${contenders.length} documents claim ${role}; "${winner.file_name}" won deterministically (score ${winner.role_score})`,
        sections: contenders.map((entry) => ({ document_id: entry.document_id, file_name: entry.file_name, section_id: "", hash: "" }))
      });
    }
  }

  // Any document whose preferred role was taken falls back to its best free role.
  for (const entry of assignments) {
    if (assigned.has(entry.document_id)) {
      const winner = ROLE_PRIORITY.find((role) => winners[role] === entry.document_id);
      if (winner) entry.role = winner;
      continue;
    }
    const scores = scoresByDocument.get(entry.document_id)!;
    const free = ROLE_PRIORITY.filter((role) => winners[role] === undefined).sort((a, b) => scores[b] - scores[a]);
    const fallback = free[0] ?? "REFERENCE";
    entry.role = fallback;
    entry.role_score = Number(scores[fallback].toFixed(4));
    winners[fallback] = entry.document_id;
    assigned.add(entry.document_id);
    diagnostics.push({
      kind: "ROLE_CONFLICT",
      severity: "INFO",
      message: `"${entry.file_name}" took ${fallback} because its preferred role was already assigned`,
      sections: [{ document_id: entry.document_id, file_name: entry.file_name, section_id: "", hash: "" }]
    });
  }

  const primary = winners.PRIMARY_SPEC;
  diagnostics.push(...detectSectionConflicts(documents));
  const result: RoleAssignment = {
    assignments,
    winners,
    order: documents.map((document) => document.id),
    diagnostics
  };
  if (primary) result.primary_document_id = primary;
  return result;
}

/**
 * Compares sections across documents that share a normalized heading. A body
 * paragraph inherits the heading above it, so `## Scope` followed by an
 * unheaded paragraph — how every extractor models a document — is compared as
 * one unit. Returns one diagnostic per isolated conflicting block pair.
 */
export function detectSectionConflicts(documents: CanonicalTaskDocument[]): ConflictDiagnostic[] {
  const diagnostics: ConflictDiagnostic[] = [];
  const byHeading = new Map<string, { document: CanonicalTaskDocument; section: CanonicalSection }[]>();

  for (const document of documents) {
    // Headings are tracked per document so a body attaches to its own heading.
    let currentHeading: string | undefined;
    for (const section of document.sections) {
      const ownHeading = section.heading?.trim();
      if (ownHeading) currentHeading = ownHeading;
      const key = normalizeHeading(ownHeading ?? currentHeading);
      if (!key) continue;
      // Heading-only sections carry no comparable content of their own.
      if (!ownHeading && section.kind === "TITLE") continue;
      if (section.text.trim().length < 40) continue;
      const bucket = byHeading.get(key) ?? [];
      bucket.push({ document, section });
      byHeading.set(key, bucket);
    }
  }

  for (const [key, bucket] of byHeading) {
    if (bucket.length < 2) continue;
    for (let left = 0; left < bucket.length; left++) {
      for (let right = left + 1; right < bucket.length; right++) {
        const a = bucket[left];
        const b = bucket[right];
        if (a.document.id === b.document.id) continue;
        const similarity = similarityOf(a.section.text, b.section.text);
        const sections = [
          { document_id: a.document.id, file_name: a.document.file_name, section_id: a.section.id, heading: a.section.heading, hash: a.section.hash },
          { document_id: b.document.id, file_name: b.document.file_name, section_id: b.section.id, heading: b.section.heading, hash: b.section.hash }
        ];
        if (a.section.hash === b.section.hash || isSameText(a.section.text, b.section.text)) {
          diagnostics.push({
            kind: "DUPLICATE_SECTION",
            severity: "INFO",
            message: `"${a.section.heading}" is byte-identical in ${a.document.file_name} and ${b.document.file_name}`,
            sections,
            similarity: 1,
            normalized_heading: key
          });
          continue;
        }
        if (similarity >= 0.9) {
          diagnostics.push({
            kind: "NEAR_DUPLICATE_SECTION",
            severity: "INFO",
            message: `"${a.section.heading}" is nearly identical across ${a.document.file_name} and ${b.document.file_name} (similarity ${similarity.toFixed(2)})`,
            sections,
            similarity: Number(similarity.toFixed(4)),
            normalized_heading: key
          });
          continue;
        }
        if (similarity <= 0.5) {
          diagnostics.push({
            kind: "CONFLICTING_SECTION",
            severity: "WARN",
            message: `"${a.section.heading}" disagrees between ${a.document.file_name} (${a.section.id}) and ${b.document.file_name} (${b.section.id}): similarity ${similarity.toFixed(2)}`,
            sections,
            similarity: Number(similarity.toFixed(4)),
            normalized_heading: key
          });
          continue;
        }
        diagnostics.push({
          kind: "REVIEW_SECTION",
          severity: "INFO",
          message: `"${a.section.heading}" partially overlaps across ${a.document.file_name} and ${b.document.file_name} (similarity ${similarity.toFixed(2)}); needs review`,
          sections,
          similarity: Number(similarity.toFixed(4)),
          normalized_heading: key
        });
      }
    }
  }
  return diagnostics;
}
