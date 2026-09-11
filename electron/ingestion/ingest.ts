/**
 * Deterministic WorkBook ingestion pipeline (Work Unit 1).
 *
 * One entry point turns raw file sources into CanonicalTaskDocuments:
 *   bytes -> hash -> format extractor -> raw sections -> redaction -> canonical
 *
 * Failure is per document: an unsupported, encrypted or corrupt file yields a
 * FAILED document carrying diagnostics while the rest of the batch completes.
 * Nothing here calls a model, the network, or the renderer.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets, scanSecrets } from "../../src/shared/secret-scan";
import {
  contentHashOf,
  extensionOf,
  isSupportedFileName,
  languageOf,
  logicalKeyFor,
  mimeForFileName,
  sectionHashOf,
  sha256OfBytes,
  type CanonicalSection,
  type CanonicalTaskDocument,
  type DocumentSectionKind,
  type IngestionDiagnostic,
  type IngestionStatus
} from "../../src/shared/workbook";
import { kindForFileName, type InputObjectKind, type InputObjectSource } from "../../src/shared/input-object";
import { DocxError, extractDocx, extractDocxHtml } from "./docx-reader";
import { PdfError, extractPdf } from "./pdf-reader";
import {
  DEFAULT_TEXT_LIMITS,
  TextParseError,
  decodeText,
  detectDelimiter,
  parseDelimited,
  parseStructuredText,
  parseTextSections,
  renderStructured,
  sectionsFromDelimited,
  sectionsFromStructured,
  type RawSection,
  type TextParseLimits
} from "./text-parsers";
import { XlsxError, extractXlsx } from "./xlsx-reader";

export interface IngestionLimits extends TextParseLimits {
  maxBytes: number;
}

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = {
  ...DEFAULT_TEXT_LIMITS,
  maxBytes: 64 * 1024 * 1024
};

export interface DocumentSource {
  file_name: string;
  /** Durable identity from AttachmentStore/InputObject, when the bytes came from a ref. */
  source_input_id?: string;
  source_type?: InputObjectSource;
  mime_type?: string;
  bytes?: Uint8Array;
  /** Local file to read instead of `bytes`. */
  path?: string;
  kind?: InputObjectKind;
  created_at?: string;
  /** Deterministic document id; derived from the content hash when omitted. */
  id?: string;
}

export interface BatchIngestionResult {
  documents: CanonicalTaskDocument[];
  diagnostics: IngestionDiagnostic[];
}

/** Emitted when a corrupt container/part forces a documented fallback. */
export const DEGRADED_EXTRACTION_CODE = "EXTRACTION_DEGRADED";

function canonicalIdFor(hash: string, fileName: string, explicit?: string): string {
  if (explicit?.trim()) return explicit;
  return `doc-${hash.slice(0, 16)}-${contentHashOf(fileName).slice(0, 8)}`;
}

function diagnostic(code: string, message: string, severity: IngestionDiagnostic["severity"], extra: Partial<IngestionDiagnostic> = {}): IngestionDiagnostic {
  return { code, message, severity, ...extra };
}

function failingKindFor(fileName: string, bytesLength: number): InputObjectKind {
  return kindForFileName(fileName) ?? (bytesLength ? "DOCUMENT" : "TEXT");
}

/** Builds canonical sections from raw sections, preserving offsets into `content`. */
function toCanonicalSections(raw: RawSection[], content: string): CanonicalSection[] {
  const sections: CanonicalSection[] = [];
  raw.forEach((section, index) => {
    const start = Math.max(0, Math.min(section.start, content.length));
    const end = Math.max(start, Math.min(section.end, content.length));
    const heading = section.heading?.trim();
    const canonical: CanonicalSection = {
      id: `s${index + 1}`,
      order: index + 1,
      kind: section.kind as DocumentSectionKind,
      text: section.text,
      startOffset: start,
      endOffset: end,
      hash: sectionHashOf(section.kind, heading ?? "", section.text)
    };
    if (heading) canonical.heading = heading;
    if (section.level !== undefined) canonical.level = section.level;
    sections.push(canonical);
  });
  return sections;
}

/** Separator inserted between canonical sections. */
const SECTION_SEPARATOR = "\n\n";

/**
 * Builds canonical content and section offsets together so that
 * `content.slice(section.startOffset, section.endOffset) === section.text`
 * holds for every section, unconditionally.
 *
 * The content is assembled from the section texts themselves rather than
 * trusting extractor offsets: joining N sections inserts N-1 two-character
 * separators, so an extractor's own offsets can only be correct for the first
 * section and are guaranteed wrong afterwards. A fast path that reused them
 * would silently produce sections pointing at the wrong text.
 */
function assembleSections(sections: RawSection[]): { content: string; remapped: RawSection[] } {
  const remapped: RawSection[] = [];
  let cursor = 0;
  for (const section of sections) {
    remapped.push({ ...section, start: cursor, end: cursor + section.text.length });
    cursor += section.text.length + SECTION_SEPARATOR.length;
  }
  return { content: remapped.map((section) => section.text).join(SECTION_SEPARATOR), remapped };
}

/**
 * Truncates to a section boundary so the offset invariant survives: a section
 * is either kept whole or dropped, never sliced in half.
 */
function truncateToSections(
  content: string,
  sections: CanonicalSection[],
  maxLength: number
): { content: string; sections: CanonicalSection[]; dropped: number } {
  if (content.length <= maxLength) return { content, sections, dropped: 0 };
  const kept = sections.filter((section) => section.endOffset <= maxLength);
  const truncatedContent = kept.map((section) => section.text).join(SECTION_SEPARATOR);
  return { content: truncatedContent, sections: kept, dropped: sections.length - kept.length };
}

function joinContent(sections: RawSection[]): string {
  return sections.map((section) => section.text).join(SECTION_SEPARATOR);
}

function titleFor(sections: RawSection[], fileName: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const title = sections.find((section) => section.kind === "TITLE" && section.heading)?.heading;
  if (title?.trim()) return title.trim();
  const firstHeading = sections.find((section) => section.heading && section.heading.trim())?.heading;
  if (firstHeading?.trim() && firstHeading.trim().length <= 120) return firstHeading.trim();
  const stem = path.basename(fileName).replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return stem || fileName;
}

interface ExtractionOutcome {
  rawSections: RawSection[];
  warnings: string[];
  infoDiagnostics: IngestionDiagnostic[];
  titleHint?: string;
  /** Extractor replaced section splitting entirely (xlsx markdown). */
  precomputed?: { content: string; sections: CanonicalSection[] };
}

function extractNative(bytes: Uint8Array, fileName: string, limits: IngestionLimits): ExtractionOutcome {
  const extension = extensionOf(fileName);
  const decoded = decodeText(bytes);
  const warnings = [...decoded.warnings];
  let raw: RawSection[];
  if (extension === ".csv" || extension === ".tsv" || (extension === ".txt" && looksDelimited(decoded.text, fileName))) {
    const delimiter = detectDelimiter(decoded.text, fileName);
    const table = parseDelimited(decoded.text, { delimiter, limits });
    warnings.push(...table.warnings);
    raw = sectionsFromDelimited(table, { fileName: path.basename(fileName), maxColumns: 64 });
    if (!raw.length) raw = parseTextSections(decoded.text, { plainText: true, limits });
  } else {
    raw = parseTextSections(decoded.text, { plainText: extension !== ".md" && extension !== ".markdown", limits });
  }
  const diagnostics = decoded.encoding === "utf-8" ? [] : [
    diagnostic("ENCODING_FALLBACK", `decoded as ${decoded.encoding}`, "INFO", {})
  ];
  return { rawSections: raw, warnings, infoDiagnostics: diagnostics };
}

function looksDelimited(text: string, fileName: string): boolean {
  if (extensionOf(fileName) === ".csv" || extensionOf(fileName) === ".tsv") return true;
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  if (lines.length < 2) return false;
  const counts = lines.map((line) => (line.match(/,/g) ?? []).length);
  return counts[0] >= 1 && counts.every((count) => count === counts[0]);
}

function extractStructured(bytes: Uint8Array, fileName: string, limits: IngestionLimits): ExtractionOutcome {
  const decoded = decodeText(bytes);
  const parsed = parseStructuredText(decoded.text, fileName);
  const raw = sectionsFromStructured(parsed.value, limits);
  const warnings = [...decoded.warnings, ...parsed.warnings];
  const rendered = renderStructured(parsed.value);
  const firstHeading = raw.find((section) => section.heading)?.heading;
  return {
    rawSections: raw,
    warnings,
    infoDiagnostics: [diagnostic("STRUCTURED_FORMAT", `parsed as ${parsed.format}`, "INFO", {})],
    titleHint: firstHeading,
    ...(raw.length ? {} : { precomputed: { content: rendered, sections: toCanonicalSections(parseTextSections(rendered, { limits }), rendered) } })
  };
}

function extractSpreadsheet(bytes: Uint8Array, fileName: string): ExtractionOutcome {
  const result = extractXlsx(bytes);
  const content = result.markdown;
  const raw = parseTextSections(content, { plainText: true });
  const warnings = [...result.warnings];
  const diagnostics = result.sheets.map((sheet) => diagnostic(
    "SHEET_READ",
    `sheet "${sheet.name}": ${sheet.usedRange.rows} row(s) × ${sheet.usedRange.columns} column(s)`,
    "INFO",
    {}
  ));
  if (!result.sheets.length) warnings.push("no sheet produced content");
  return {
    rawSections: raw.length ? raw : [{ kind: "TABLE", heading: path.basename(fileName), text: content, start: 0, end: content.length }],
    warnings,
    infoDiagnostics: diagnostics,
    titleHint: result.sheets[0]?.name
  };
}

async function extractWord(bytes: Uint8Array, fileName: string): Promise<ExtractionOutcome> {
  const warnings: string[] = [];
  let paragraphs: Awaited<ReturnType<typeof extractDocxHtml>>["paragraphs"];
  try {
    // Heading structure comes from the converter's HTML so the document
    // outline survives even though mammoth owns the DOCX parsing.
    const html = await extractDocxHtml(bytes);
    paragraphs = html.paragraphs;
    warnings.push(...html.warnings);
  } catch (error) {
    // A container the structured pass cannot traverse may still hold readable
    // text; the fallback never fabricates structure and the loss is reported.
    const raw = await extractDocx(bytes);
    paragraphs = raw.paragraphs.map((paragraph) => ({ text: paragraph.text, listItem: paragraph.listItem }));
    warnings.push(`${DEGRADED_EXTRACTION_CODE}: heading structure could not be read (${(error as Error).message}); text was recovered without heading levels`);
    warnings.push(...raw.warnings);
  }

  const raw: RawSection[] = [];
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim();
    if (!text) continue;
    const headingLevel = paragraph.headingLevel;
    const kind: RawSection["kind"] = headingLevel === 1 ? "TITLE" : headingLevel ? "HEADING" : paragraph.listItem ? "BULLET" : "PARAGRAPH";
    const section: RawSection = { kind, text, start: cursor, end: cursor + text.length };
    if (headingLevel) { section.heading = text; section.level = headingLevel; }
    raw.push(section);
    cursor = section.end + 2;
  }
  if (!raw.length) warnings.push("document body produced no readable paragraph");
  void fileName;
  return { rawSections: raw, warnings, infoDiagnostics: [] };
}

async function extractPortableDocument(bytes: Uint8Array, fileName: string): Promise<ExtractionOutcome> {
  const result = await extractPdf(bytes);
  const raw: RawSection[] = [];
  let cursor = 0;
  for (const page of result.pages) {
    for (const section of parseTextSections(page.text, { plainText: true })) {
      const shifted: RawSection = {
        kind: section.kind,
        text: section.text,
        start: cursor + section.start,
        end: cursor + section.end
      };
      if (section.heading) shifted.heading = section.heading;
      if (section.level !== undefined) shifted.level = section.level;
      raw.push(shifted);
    }
    // Page boundary kept explicit so page jumps never concatenate words.
    const marker = `— page ${page.number} —`;
    raw.push({ kind: "KEYVALUE", text: marker, start: cursor, end: cursor + marker.length });
    cursor += page.text.length + 4;
  }
  void fileName;
  const title = result.documentInfo.title;
  return {
    rawSections: raw,
    warnings: [...result.warnings],
    infoDiagnostics: Object.entries(result.documentInfo).map(([key, value]) => diagnostic("PDF_INFO", `${key}: ${value}`, "INFO", {})),
    titleHint: title
  };
}

/**
 * Ingests one document. Never throws for document-level problems: the failure
 * is reported as a FAILED CanonicalTaskDocument with diagnostics.
 */
export async function ingestDocument(source: DocumentSource, options: { limits?: Partial<IngestionLimits>; now?: string } = {}): Promise<CanonicalTaskDocument> {
  const limits: IngestionLimits = { ...DEFAULT_INGESTION_LIMITS, ...options.limits };
  const createdAt = source.created_at ?? options.now ?? new Date().toISOString();
  const fileName = (source.file_name ?? "").trim() || "unnamed";
  const diagnostics: IngestionDiagnostic[] = [];
  let bytes: Uint8Array;

  if (source.bytes) bytes = source.bytes;
  else if (source.path) {
    try {
      const stat = fs.statSync(source.path);
      if (!stat.isFile()) throw new Error("not a regular file");
      bytes = new Uint8Array(fs.readFileSync(source.path));
    } catch (error) {
      const failureHash = contentHashOf(`missing:${source.path}`);
      return {
        id: canonicalIdFor(failureHash, fileName, source.id),
        source_input_id: source.source_input_id ?? source.id ?? source.path,
        source_type: source.source_type ?? "LOCAL_PATH",
        file_name: fileName,
        mime_type: source.mime_type ?? mimeForFileName(fileName),
        hash: failureHash,
        title: titleFor([], fileName),
        content: "",
        sections: [],
        created_at: createdAt,
        diagnostics: [diagnostic("SOURCE_UNREADABLE", `Cannot read ${source.path}: ${(error as Error).message}`, "ERROR")],
        kind: failingKindFor(fileName, 0),
        status: "FAILED",
        byte_length: 0,
        language: "unknown",
        logical_key: logicalKeyFor(fileName, failureHash),
        redactions: []
      };
    }
  } else {
    const failureHash = contentHashOf(`empty:${fileName}`);
    return {
      id: canonicalIdFor(failureHash, fileName, source.id),
      source_input_id: source.source_input_id ?? source.id ?? fileName,
      source_type: source.source_type ?? "UPLOAD",
      file_name: fileName,
      mime_type: source.mime_type ?? mimeForFileName(fileName),
      hash: failureHash,
      title: titleFor([], fileName),
      content: "",
      sections: [],
      created_at: createdAt,
      diagnostics: [diagnostic("SOURCE_EMPTY", "Document source carries neither bytes nor a path", "ERROR")],
      kind: failingKindFor(fileName, 0),
      status: "FAILED",
      byte_length: 0,
      language: "unknown",
      logical_key: logicalKeyFor(fileName, failureHash),
      redactions: []
    };
  }

  const hash = sha256OfBytes(bytes);
  const base = {
    id: canonicalIdFor(hash, fileName, source.id),
    source_input_id: source.source_input_id ?? source.id ?? `sha256:${hash.slice(0, 16)}`,
    source_type: source.source_type ?? "UPLOAD",
    file_name: fileName,
    mime_type: source.mime_type?.trim() || mimeForFileName(fileName),
    hash,
    created_at: createdAt,
    kind: (source.kind ?? kindForFileName(fileName)) as InputObjectKind,
    byte_length: bytes.byteLength,
    logical_key: logicalKeyFor(fileName, hash)
  };

  const fail = (code: string, message: string, severity: IngestionDiagnostic["severity"] = "ERROR"): CanonicalTaskDocument => ({
    ...base,
    title: titleFor([], fileName),
    content: "",
    sections: [],
    diagnostics: [...diagnostics, diagnostic(code, message, severity)],
    status: "FAILED",
    language: "unknown",
    redactions: []
  });

  if (bytes.byteLength === 0) return fail("SOURCE_EMPTY", "Document is empty (0 bytes)");
  if (bytes.byteLength > limits.maxBytes) return fail("SIZE_LIMIT", `Document is ${bytes.byteLength} bytes, above the ${limits.maxBytes}-byte limit`);
  if (!isSupportedFileName(fileName)) {
    return fail("UNSUPPORTED_TYPE", `No deterministic extractor for ${extensionOf(fileName) || "an extensionless file"}; supported: md, txt, json, yaml, yml, csv, tsv, pdf, docx, xlsx`);
  }

  let outcome: ExtractionOutcome;
  try {
    const extension = extensionOf(fileName);
    if (extension === ".pdf") outcome = await extractPortableDocument(bytes, fileName);
    else if (extension === ".docx") outcome = await extractWord(bytes, fileName);
    else if (extension === ".xlsx") outcome = extractSpreadsheet(bytes, fileName);
    else if (extension === ".json" || extension === ".yaml" || extension === ".yml") outcome = extractStructured(bytes, fileName, limits);
    else outcome = extractNative(bytes, fileName, limits);
  } catch (error) {
    if (error instanceof PdfError) return fail(`PDF_${error.code}`, error.message);
    if (error instanceof DocxError) return fail(`DOCX_${error.code}`, error.message);
    if (error instanceof XlsxError) return fail(`XLSX_${error.code}`, error.message);
    if (error instanceof TextParseError) return fail(`TEXT_${error.code}`, error.message);
    return fail("EXTRACT_FAILED", `${(error as Error).name}: ${(error as Error).message}`);
  }

  for (const warning of outcome.warnings) diagnostics.push(diagnostic("EXTRACT_WARNING", warning, "WARN"));
  diagnostics.push(...outcome.infoDiagnostics);

  const precomputed = outcome.precomputed;
  let rawSections = outcome.rawSections;
  if (!rawSections.length) {
    if (precomputed) rawSections = parseTextSections(precomputed.content, { limits });
    if (!rawSections.length) {
      return {
        ...base,
        title: titleFor([], fileName, outcome.titleHint),
        content: "",
        sections: [],
        diagnostics: [...diagnostics, diagnostic("NO_CONTENT", "Extractor found no readable text", "ERROR")],
        status: "FAILED",
        language: "unknown",
        redactions: []
      };
    }
  }

  // Redaction runs on the joined content and on every section body: nothing
  // leaves this function with raw secret material. Redacting inline preserves
  // section order, so section bodies remain a recognizable excerpt.
  const redactedSections = rawSections.map((section) => ({ ...section, text: redactSecrets(section.text) }));
  const joinedRaw = joinContent(rawSections);
  const redactedJoined = redactSecrets(joinedRaw);
  const matches = scanSecrets(joinedRaw);
  const redactionTally = new Map<string, { shape: string; label: string; count: number }>();
  for (const match of matches) {
    const key = `${match.shape}:${match.label}`;
    const entry = redactionTally.get(key) ?? { shape: match.shape, label: match.label, count: 0 };
    entry.count++;
    redactionTally.set(key, entry);
  }

  let { content, remapped } = assembleSections(redactedSections);
  if (content !== redactedJoined) {
    diagnostics.push(diagnostic("OFFSET_REMAP", "canonical content was rebuilt from section texts so every section offset maps exactly", "INFO"));
  }
  let sections = toCanonicalSections(remapped, content);

  if (precomputed && sections.length === 0) sections = precomputed.sections;

  // Offsets are computed against the redacted content so they always map.
  sections = sections.map((section, index) => ({ ...section, order: index + 1, id: `s${index + 1}` }));

  if (content.length > limits.maxContentLength) {
    // Whole sections only: slicing the content at an arbitrary character would
    // leave the last section pointing past the end of its own text.
    const truncated = truncateToSections(content, sections, limits.maxContentLength);
    content = truncated.content;
    sections = truncated.sections;
    diagnostics.push(diagnostic(
      "CONTENT_TRUNCATED",
      `content truncated to ${content.length} characters (${truncated.dropped} section(s) beyond the ${limits.maxContentLength}-character budget were dropped)`,
      "WARN"
    ));
  }

  const status: IngestionStatus = diagnostics.some((entry) => entry.severity === "WARN") ? "PARTIAL" : "OK";
  const title = titleFor(rawSections, fileName, outcome.titleHint);
  return {
    ...base,
    title,
    content,
    sections,
    diagnostics,
    status,
    language: languageOf(content),
    redactions: [...redactionTally.values()].sort((a, b) => a.shape.localeCompare(b.shape))
  };
}

/**
 * Ingests a batch. Every source is isolated: a failure becomes a FAILED
 * document (and a batch diagnostic) while the remaining documents still parse.
 */
export async function ingestDocuments(sources: DocumentSource[], options: { limits?: Partial<IngestionLimits>; now?: string } = {}): Promise<BatchIngestionResult> {
  const documents: CanonicalTaskDocument[] = [];
  const diagnostics: IngestionDiagnostic[] = [];
  for (const source of sources) {
    let document: CanonicalTaskDocument;
    try {
      document = await ingestDocument(source, options);
    } catch (error) {
      // Defensive: ingestDocument should never throw, but a batch must survive it.
      const hash = contentHashOf(`crashed:${source?.file_name ?? "unknown"}`);
      document = {
        id: canonicalIdFor(hash, source?.file_name ?? "unknown", source?.id),
        source_input_id: source?.source_input_id ?? source?.id ?? "unknown",
        source_type: source?.source_type ?? "UPLOAD",
        file_name: source?.file_name ?? "unknown",
        mime_type: mimeForFileName(source?.file_name ?? ""),
        hash,
        title: source?.file_name ?? "unknown",
        content: "",
        sections: [],
        created_at: options.now ?? new Date().toISOString(),
        diagnostics: [diagnostic("INGEST_CRASH", `${(error as Error).name}: ${(error as Error).message}`, "ERROR", { documentId: source?.id })],
        kind: failingKindFor(source?.file_name ?? "", 0),
        status: "FAILED",
        byte_length: 0,
        language: "unknown",
        logical_key: logicalKeyFor(source?.file_name ?? "", hash),
        redactions: []
      };
    }
    documents.push(document);
    for (const entry of document.diagnostics) {
      diagnostics.push({ ...entry, documentId: entry.documentId ?? document.id });
    }
  }
  return { documents, diagnostics };
}
