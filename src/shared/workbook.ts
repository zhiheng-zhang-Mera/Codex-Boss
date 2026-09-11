/**
 * WorkBook core vocabulary (Work Unit 1). Pure and shareable — no fs, no
 * network, no model call: everything here is deterministic given its input.
 *
 * A WorkBook is the user's uploaded specification payload (markdown, txt,
 * json/yaml/csv, pdf, docx, xlsx). Deterministic ingestion turns it into a
 * CanonicalTaskDocument; this module owns the document shape, the section
 * model, content-feature classification and hash identity. File parsing lives
 * in electron/ingestion (it needs zip/deflate); classification lives here so
 * renderer and main share one verdict vocabulary.
 *
 * Reuses InputObjectKind / kindForFileName from input-object.ts so an ingested
 * document never invents a second file-type vocabulary.
 */
import type { InputObjectKind } from "./input-object";
import { sha256Bytes, sha256Hex, utf8Bytes } from "./hash";

export { sha256Hex };

export type DocumentSectionKind =
  | "TITLE"
  | "HEADING"
  | "PARAGRAPH"
  | "BULLET"
  | "NUMBERED"
  | "TABLE"
  | "KEYVALUE"
  | "CODE";

/** One canonical, ordered, position-mapped block of extracted document text. */
export interface CanonicalSection {
  id: string;
  order: number;
  kind: DocumentSectionKind;
  /** Heading text when the extractor could determine one. */
  heading?: string;
  /** 1-based heading depth (1 = title/H1) when known. */
  level?: number;
  text: string;
  /** Character offsets into the pre-redaction source content. */
  startOffset: number;
  endOffset: number;
  /** Deterministic per-section content hash (duplicate/conflict detection). */
  hash: string;
}

export type IngestionStatus = "OK" | "PARTIAL" | "FAILED";

export interface IngestionDiagnostic {
  code: string;
  message: string;
  documentId?: string;
  sectionOrder?: number;
  severity: "INFO" | "WARN" | "ERROR";
}

export interface CanonicalTaskDocument {
  id: string;
  source_input_id: string;
  source_type: "UPLOAD" | "PASTE" | "LOCAL_PATH" | "GITHUB" | "URL";
  file_name: string;
  mime_type: string;
  /** SHA-256 of the raw bytes; identity for duplicate/resume. */
  hash: string;
  title: string;
  content: string;
  sections: CanonicalSection[];
  created_at: string;
  diagnostics: IngestionDiagnostic[];
  /** Extension/vocabulary agreement without an extractor. */
  kind: InputObjectKind;
  status: IngestionStatus;
  byte_length: number;
  language: "zh" | "en" | "mixed" | "unknown";
  /** Logical (amended) workbook identity: renamed revisions stay comparable. */
  logical_key: string;
  /** Secret shapes removed before this document may reach a provider. */
  redactions: { shape: string; label: string; count: number }[];
}

export type WorkBookClassification = "EXECUTABLE_WORKBOOK" | "REFERENCE" | "AMBIGUOUS";

export interface WorkBookReason {
  code: string;
  detail: string;
  /** Signed contribution to the executable score. */
  weight: number;
}

export interface WorkBookFeatures {
  characters: number;
  lines: number;
  sectionCount: number;
  /** Share of CJK characters over all letters/CJK. */
  cjkRatio: number;
  headings: string[];
  bulletLines: number;
  numberedLines: number;
  directiveLines: number;
  imperativeHits: number;
  deliverableHits: number;
  constraintHits: number;
  acceptanceHits: number;
  goalHits: number;
  referenceHits: number;
  revisionHits: number;
  tableRows: number;
  identifierCount: number;
  checklistCount: number;
}

export interface WorkBookVerdict {
  kind: WorkBookClassification;
  /** 0–1; how strongly the features support `kind`. */
  confidence: number;
  /** Signed score: >= EXECUTABLE_THRESHOLD is executable work. */
  score: number;
  reasons: WorkBookReason[];
  features: WorkBookFeatures;
}

export const EXECUTABLE_SCORE_THRESHOLD = 2;
export const REFERENCE_SCORE_THRESHOLD = -2;
/** Below this many characters no verdict is trustworthy (short notes). */
export const MIN_CLASSIFIABLE_CHARACTERS = 160;

/** Deterministic SHA-256 helpers (pure, environment-free). */
export function sha256OfBytes(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}

export function sha256OfText(text: string): string {
  return sha256Bytes(utf8Bytes(text));
}

export function contentHashOf(content: string): string {
  return sha256OfText(content);
}

export function sectionHashOf(kind: string, heading: string, text: string): string {
  return sha256OfText(`${kind}\u0000${heading}\u0000${text}`);
}

/**
 * Normalizes a file name into a logical workbook key so `spec.md` and
 * `spec-v2.md` / `spec (1).md` group as revisions of one logical workbook,
 * while unrelated documents stay separate.
 */
export function logicalKeyFor(fileName: string, fallbackHash: string): string {
  const base = (fileName ?? "").trim().replace(/\\/g, "/").split("/").pop() ?? "";
  let stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  stem = stem
    .replace(/\((?:copy|副本)?\s*\d*\)$/i, "")
    .replace(/[-_\s]*(?:v|ver|version|rev|r|第)?\s*\d+(?:\.\d+)*\s*(?:版|次)?$/i, "")
    .replace(/[-_\s]*(?:final|draft|草稿|终版|定稿|copy|副本)$/i, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^0-9A-Za-z\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return stem ? `wb:${stem}` : `wb:${fallbackHash.slice(0, 16)}`;
}

export function cjkRatioOf(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const total = cjk + letters;
  return total === 0 ? 0 : cjk / total;
}

export function languageOf(text: string): CanonicalTaskDocument["language"] {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cjk === 0 && letters === 0) return "unknown";
  if (cjk === 0) return "en";
  if (letters === 0) return "zh";
  const ratio = cjk / (cjk + letters);
  if (ratio >= 0.7) return "zh";
  if (ratio <= 0.2) return "en";
  return "mixed";
}

export function mimeForFileName(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const map: Record<string, string> = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".text": "text/plain",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return map[ext] ?? "application/octet-stream";
}

/** File types this unit can extract text from without a model. */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  ".md", ".markdown", ".txt", ".text",
  ".json", ".yaml", ".yml", ".csv", ".tsv",
  ".pdf", ".docx", ".xlsx"
];

export function extensionOf(fileName: string): string {
  const base = (fileName ?? "").trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function isSupportedFileName(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(fileName));
}

/* ------------------------------------------------------------------ *
 * Analysis-only requests
 * ------------------------------------------------------------------ */

export type AnalysisOnlyKind = "ANALYSIS_ONLY" | "EXECUTION_REQUESTED" | "UNSPECIFIED";

export interface AnalysisOnlyVerdict {
  kind: AnalysisOnlyKind;
  confidence: number;
  reasons: string[];
  /** Matched analysis-intent phrases (deterministic, ordered). */
  matched: string[];
  /** Execution phrases that cancel analysis-only intent. */
  executionMatches: string[];
}

const ANALYSIS_ONLY_PATTERNS: { id: string; phrase: string; regex: RegExp; weight: number }[] = [
  { id: "analyze", phrase: "分析", regex: /分析|剖析|解读|审阅|评估/g, weight: 1 },
  { id: "review", phrase: "review", regex: /\breview\b|\bassess(?:ment)?\b|\bevaluate\b/gi, weight: 1 },
  { id: "summarize", phrase: "总结", regex: /总结|归纳|摘要|概括|\bsummar(?:y|ize|ise)\b/gi, weight: 1 },
  { id: "explain", phrase: "解读/说明", regex: /说明|解释|讲解|\bexplain\b|\bdescribe\b/gi, weight: 1 },
  { id: "compare", phrase: "对比", regex: /对比|比较|差异|\bcompare\b|\bdiff(?:erence)?s?\b/gi, weight: 1 },
  { id: "read_only", phrase: "只读", regex: /只读|不要修改|不要改动|请勿修改|仅阅读|read[-\s]?only|do not (?:modify|change|edit)|no changes?/gi, weight: 2 },
  { id: "explain_only", phrase: "无需执行", regex: /无需执行|不需要执行|不要执行|仅分析|只分析|只做分析|analysis only|just analyze|without (?:implementing|executing|making changes)/gi, weight: 3 },
  { id: "no_write", phrase: "无文件产出", regex: /不(?:要)?(?:生成|产出|提交|修改)文件|不要写文件|no file (?:changes|writes)|don'?t write files/gi, weight: 3 },
  { id: "comment_only", phrase: "给意见", regex: /给(?:出)?(?:意见|建议)|提(?:出)?建议|反馈意见|give (?:me )?(?:feedback|opinions?|comments?)/gi, weight: 1 },
  { id: "question", phrase: "是什么", regex: /是什么|有哪些|是否|能否(?:分析|解释)|what is|what are|how does|is there/gi, weight: 1 }
];

const EXECUTION_PATTERNS: { id: string; phrase: string; regex: RegExp; weight: number }[] = [
  { id: "implement", phrase: "实现/开发", regex: /实现|开发|编写代码|落地|搭建|\bimplement\b|\bdevelop\b|\bbuild\b|\bcode\b/gi, weight: 3 },
  { id: "refactor", phrase: "重构/修改", regex: /重构|修改|改动|调整代码|\brefactor\b|\bmodify\b|\bchange\b|\bedit\b/gi, weight: 3 },
  { id: "fix", phrase: "修复", regex: /修复|修好|\bfix\b|\brepair\b/gi, weight: 3 },
  { id: "deploy", phrase: "部署/发布/提交", regex: /部署|发布|上线|提交(?:代码|PR|pr)|\bdeploy\b|\brelease\b|\bcommit\b|\bpush\b/gi, weight: 3 },
  { id: "migrate", phrase: "迁移/升级", regex: /迁移|升级|\bmigrat(?:e|ion)\b|\bupgrade\b/gi, weight: 2 },
  { id: "generate_files", phrase: "生成文件", regex: /生成(?:文件|代码|文档)|产出(?:文件|代码)|写出文件|\bproduce files?\b|\bwrite (?:the )?(?:files?|code)\b/gi, weight: 3 },
  { id: "run", phrase: "运行/执行", regex: /运行(?:测试|脚本|命令)|执行(?:测试|命令)|\brun (?:the )?(?:tests?|scripts?|commands?)\b|\bexecute\b/gi, weight: 2 }
];

/**
 * Detects whether the user asked for analysis only. Deterministic phrase
 * matching, bilingual, with execution verbs overriding analysis phrasing so
 * "分析需求并实现" is never treated as read-only.
 */
export function detectAnalysisOnly(text: string): AnalysisOnlyVerdict {
  const source = text ?? "";
  const matched: string[] = [];
  const reasons: string[] = [];
  let analysisScore = 0;
  for (const pattern of ANALYSIS_ONLY_PATTERNS) {
    const hits = source.match(pattern.regex);
    if (!hits?.length) continue;
    analysisScore += pattern.weight * Math.min(hits.length, 2);
    matched.push(pattern.phrase);
    reasons.push(`${pattern.phrase} ×${hits.length}`);
  }
  const executionMatches: string[] = [];
  let executionScore = 0;
  for (const pattern of EXECUTION_PATTERNS) {
    const hits = source.match(pattern.regex);
    if (!hits?.length) continue;
    executionScore += pattern.weight * Math.min(hits.length, 2);
    executionMatches.push(pattern.phrase);
    reasons.push(`execution: ${pattern.phrase} ×${hits.length}`);
  }
  if (analysisScore === 0 && executionScore === 0) {
    return { kind: "UNSPECIFIED", confidence: 0, reasons: [], matched, executionMatches };
  }
  if (analysisScore > executionScore) {
    return {
      kind: "ANALYSIS_ONLY",
      confidence: Math.min(0.95, 0.5 + 0.1 * (analysisScore - executionScore)),
      reasons,
      matched,
      executionMatches
    };
  }
  return {
    kind: "EXECUTION_REQUESTED",
    confidence: Math.min(0.95, 0.5 + 0.1 * (executionScore - analysisScore)),
    reasons,
    matched,
    executionMatches
  };
}

/* ------------------------------------------------------------------ *
 * Content-feature classification
 * ------------------------------------------------------------------ */

export interface WorkBookFeatureInput {
  content: string;
  /**
   * Optional extractor sections. When absent, headings are derived from the
   * content itself (ATX headings, Chinese numbered headings), so a caller with
   * only raw text still gets heading-based features.
   */
  sections?: { heading?: string; kind?: DocumentSectionKind; text: string }[];
}

const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const CJK_HEADING = /^\s*(?:第[一二三四五六七八九十百\d]+[章节条]|[一二三四五六七八九十]+[、.]|\d+[、])\s*\S/;

/**
 * Deterministic heading detection shared by the feature extractor: ATX
 * markdown headings plus the Chinese numbered headings plain-text WorkBooks use.
 * Arabic list items (`1.`) are body content and are never treated as headings.
 */
export function deriveHeadings(content: string): { heading: string; level: number }[] {
  const headings: { heading: string; level: number }[] = [];
  for (const raw of content.split(/\r\n|\r|\n/)) {
    const atx = ATX_HEADING.exec(raw);
    if (atx) {
      const text = atx[2].replace(/\s+#*\s*$/, "").trim();
      if (text) headings.push({ heading: text, level: atx[1].length });
      continue;
    }
    const line = raw.trim();
    if (line && line.length <= 60 && CJK_HEADING.test(line) && !/[。；;，,]$/.test(line)) {
      headings.push({ heading: line, level: 2 });
    }
  }
  return headings;
}

function pushHit(reasons: WorkBookReason[], code: string, detail: string, weight: number): number {
  reasons.push({ code, detail, weight });
  return weight;
}

/**
 * Extracts deterministic content features. Filenames are never consulted: a
 * document called `final-spec.md` that only cites standards classifies as
 * REFERENCE, and a `.txt` full of acceptance criteria classifies as executable.
 */

/**
 * Heading match that works for both scripts: `\b` is unusable after a CJK
 * character (CJK chars are word characters, so `目标\b` never matches), so the
 * boundary is expressed as "end of heading or a non-letter/digit".
 */
const HEADING_END = "(?=$|[\\s:：\\-—(（\\[].*$)";
const headingPattern = (body: string) => new RegExp(`^(?:${body})${HEADING_END}`, "i");

const GOAL_PATTERNS = [headingPattern("goal|objective|background\\s*(?:and|&)\\s*goal|purpose|目标|任务目标|项目目标|背景与目标|目的")];
const CONSTRAINT_PATTERNS = [headingPattern("constraints?|restrictions?|limitations?|约束|限制|前提|边界条件")];
const DELIVERABLE_PATTERNS = [headingPattern("deliverables?|outputs?|artifacts?|交付物|产出|交付清单|输出")];
const ACCEPTANCE_PATTERNS = [headingPattern("acceptance\\s+criteria|definition\\s+of\\s+done|done\\s+criteria|验收标准|验收条件|完成标准|测试标准|成功标准")];
const REFERENCE_PATTERNS = [
  headingPattern("references?|appendix|appendices|bibliography|citations?|glossary|参考文献|附录|术语表|引用|参考资料"),
  /\brevision\s+history\b|\bchangelog\b|修订历史|版本历史|变更记录/i,
  /\bRFC\s?\d+|\bISO\s?\d+|\bDOI\b|\bet\s+al\.|\[[0-9]{1,3}\]/i,
  headingPattern("copyright|版权所有"),
  /标准(?:规范|条款)|规范(?:条文|要求)/
];

const IMPERATIVE_VERBS = /\b(?:implement|create|add|remove|refactor|migrate|write|build|update|fix|ensure|verify|test|deploy|configure|expose|extract|validate|document)\b/gi;
const IMPERATIVE_CJK = /(?:实现|新增|增加|删除|移除|重构|迁移|编写|构建|更新|修复|确保|校验|验证|测试|部署|配置|暴露|抽取|输出|落地|接入|改造)/;
/** Global twin used only for counting (`String.match` ignores lastIndex). */
const IMPERATIVE_CJK_GLOBAL = new RegExp(IMPERATIVE_CJK.source, "g");
const REQUIREMENT_MODAL = /\b(?:must|shall|should|required|need to|has to)\b|(?:必须|应当|应该|需要|不得|禁止)/gi;
const DIRECTIVE_LINE = new RegExp(`(?:${IMPERATIVE_VERBS.source})|(?:${IMPERATIVE_CJK.source})|(?:${REQUIREMENT_MODAL.source})`, "i");
const CHECKLIST = /^\s*(?:[-*+]\s*)?\[[ xX]\]/gm;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)、]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十百\d]+[条章节步])/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const IDENTIFIER = /\b(?:[A-Z]{2,6}-\d{1,5}|AC-\d+|FR-\d+|NFR-\d+)\b|(?:验收(?:标准)?\s*\d+)/g;

/**
 * Extracts deterministic content features. Filenames are never consulted: a
 * document called `final-spec.md` that only cites standards classifies as
 * REFERENCE, and a `.txt` full of acceptance criteria classifies as executable.
 */
export function extractWorkBookFeatures(input: WorkBookFeatureInput): WorkBookFeatures {
  const content = input.content ?? "";
  const lines = content.split(/\r\n|\r|\n/);
  const sections = input.sections?.length
    ? input.sections
    : [{ text: content, kind: "PARAGRAPH" as DocumentSectionKind, heading: undefined as string | undefined }];
  const headings = input.sections?.length
    ? sections.map((section) => section.heading).filter((heading): heading is string => Boolean(heading?.trim()))
    : deriveHeadings(content).map((entry) => entry.heading);
  let bulletLines = 0;
  let numberedLines = 0;
  let directiveLines = 0;
  let referenceHits = 0;
  let tableRows = 0;
  let goalHits = 0;
  let deliverableHits = 0;
  let constraintHits = 0;
  let acceptanceHits = 0;
  let revisionHits = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (LIST_ITEM.test(raw)) {
      if (/^\s*(?:[-*+]|\[\s?[xX]?\s?\])/.test(raw)) bulletLines++;
      else numberedLines++;
    }
    if (TABLE_ROW.test(raw)) tableRows++;
    if (DIRECTIVE_LINE.test(line)) directiveLines++;
  }

  for (const rawHeading of headings) {
    const heading = rawHeading.trim();
    if (GOAL_PATTERNS.some((pattern) => pattern.test(heading))) goalHits++;
    if (DELIVERABLE_PATTERNS.some((pattern) => pattern.test(heading))) deliverableHits++;
    if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(heading))) constraintHits++;
    if (ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(heading))) acceptanceHits++;
    if (REFERENCE_PATTERNS.some((pattern) => pattern.test(heading))) {
      referenceHits++;
      if (/revision\s+history|changelog|修订历史|版本历史|变更记录/i.test(heading)) revisionHits++;
    }
  }
  const imperativeHits = (content.match(IMPERATIVE_VERBS)?.length ?? 0)
    + (content.match(IMPERATIVE_CJK_GLOBAL)?.length ?? 0)
    + (content.match(REQUIREMENT_MODAL)?.length ?? 0);
  const identifierCount = content.match(IDENTIFIER)?.length ?? 0;
  const checklistCount = content.match(CHECKLIST)?.length ?? 0;

  return {
    characters: content.length,
    lines: lines.length,
    sectionCount: Math.max(headings.length, sections.length > 1 ? sections.length : 0, 1),
    cjkRatio: cjkRatioOf(content),
    headings,
    bulletLines,
    numberedLines,
    directiveLines,
    imperativeHits,
    deliverableHits,
    constraintHits,
    acceptanceHits,
    goalHits,
    referenceHits,
    revisionHits,
    tableRows,
    identifierCount,
    checklistCount
  };
}

/**
 * Classifies a document as executable work, reference material, or ambiguous
 * from content features only, with an explicit signed score, confidence and
 * the reasons that produced them (every weight is auditable).
 */
export function classifyWorkBook(input: WorkBookFeatureInput): WorkBookVerdict {
  const features = extractWorkBookFeatures(input);
  const reasons: WorkBookReason[] = [];
  let score = 0;

  if (features.goalHits) score += pushHit(reasons, "goal_section", `${features.goalHits} goal/objective heading(s)`, 1.5 * Math.min(features.goalHits, 2));
  if (features.deliverableHits) score += pushHit(reasons, "deliverable_section", `${features.deliverableHits} deliverable heading(s)`, 2 * Math.min(features.deliverableHits, 2));
  if (features.acceptanceHits) score += pushHit(reasons, "acceptance_section", `${features.acceptanceHits} acceptance-criteria heading(s)`, 2 * Math.min(features.acceptanceHits, 2));
  if (features.constraintHits) score += pushHit(reasons, "constraint_section", `${features.constraintHits} constraint heading(s)`, 1 * Math.min(features.constraintHits, 2));
  if (features.checklistCount) score += pushHit(reasons, "checklist", `${features.checklistCount} checklist item(s)`, 2);
  if (features.identifierCount) score += pushHit(reasons, "requirement_ids", `${features.identifierCount} requirement identifier(s)`, 1.5);
  if (features.imperativeHits >= 6) score += pushHit(reasons, "imperative_verbs", `${features.imperativeHits} imperative verb(s)`, 1.5);
  else if (features.imperativeHits >= 3) score += pushHit(reasons, "imperative_verbs", `${features.imperativeHits} imperative verb(s)`, 0.5);
  if (features.numberedLines >= 5) score += pushHit(reasons, "numbered_plan", `${features.numberedLines} numbered step line(s)`, 1);
  if (features.sectionCount >= 3 && features.sectionCount <= 40) score += pushHit(reasons, "section_shape", `${features.sectionCount} section(s)`, 0.5);

  if (features.revisionHits) score += pushHit(reasons, "revision_history", `${features.revisionHits} revision-history heading(s)`, -1.5);
  if (features.referenceHits) score += pushHit(reasons, "reference_material", `${features.referenceHits} reference/appendix heading(s)`, -2 * Math.min(features.referenceHits, 2));
  const citationDensity = features.sectionCount > 0 ? features.tableRows / features.sectionCount : 0;
  if (citationDensity >= 8) score += pushHit(reasons, "dense_tables", `${features.tableRows} table row(s) across ${features.sectionCount} section(s)`, -1);
  if (!features.goalHits && !features.deliverableHits && !features.acceptanceHits && features.imperativeHits <= 2) {
    score += pushHit(reasons, "no_actionable_headings", "no goal/deliverable/acceptance heading and few imperatives", -2);
  }
  if (features.directiveLines >= 10 && features.bulletLines >= features.characters / 400) {
    score += pushHit(reasons, "directive_bullets", `${features.directiveLines} directive line(s)`, 0.5);
  }

  let kind: WorkBookClassification;
  if (features.characters < MIN_CLASSIFIABLE_CHARACTERS) {
    kind = "AMBIGUOUS";
    reasons.push({ code: "short_document", detail: `${features.characters} characters is below the ${MIN_CLASSIFIABLE_CHARACTERS}-character threshold`, weight: 0 });
  } else if (score >= EXECUTABLE_SCORE_THRESHOLD) {
    kind = "EXECUTABLE_WORKBOOK";
  } else if (score <= REFERENCE_SCORE_THRESHOLD) {
    kind = "REFERENCE";
  } else {
    kind = "AMBIGUOUS";
  }

  const distance = kind === "AMBIGUOUS" ? 0 : Math.abs(score - (kind === "EXECUTABLE_WORKBOOK" ? EXECUTABLE_SCORE_THRESHOLD : REFERENCE_SCORE_THRESHOLD));
  const lengthFactor = Math.min(1, features.characters / 1200);
  const confidence = kind === "AMBIGUOUS"
    ? Math.max(0.2, Math.min(0.5, 0.5 - Math.abs(score) * 0.05))
    : Math.min(0.95, (0.5 + 0.1 * distance) * (0.6 + 0.4 * lengthFactor));

  return { kind, confidence: Number(confidence.toFixed(4)), score, reasons, features };
}

/* ------------------------------------------------------------------ *
 * Section similarity (conflict / duplicate primitives)
 * ------------------------------------------------------------------ */

export function normalizeHeading(heading: string | undefined): string {
  if (!heading) return "";
  return heading
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/^[#*\-–—\d.、)（(第章节条]+/, "")
    .replace(/[：:。.!！?？)\]）]+$/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function tokenizeForSimilarity(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) tokens.push(word);
  for (const cjk of text.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? []) {
    if (cjk.length === 1) tokens.push(cjk);
    else for (let index = 0; index < cjk.length - 1; index++) tokens.push(cjk.slice(index, index + 2));
  }
  return tokens;
}

/** Token-set Jaccard similarity in [0,1]; empty/empty is 0 (unknown, not equal). */
export function similarityOf(a: string, b: string): number {
  const left = new Set(tokenizeForSimilarity(a));
  const right = new Set(tokenizeForSimilarity(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

/** True when two section bodies are the same content after whitespace folding. */
export function isSameText(a: string, b: string): boolean {
  const fold = (value: string) => value.replace(/\s+/g, " ").trim();
  return fold(a) === fold(b);
}
