/**
 * Native + structured format parsing (Work Unit 1): markdown/txt, json,
 * yaml/yml and csv/tsv. Every function here is pure (bytes in, sections out)
 * so the ingestion pipeline owns identity, hashing and redaction.
 *
 * Section splitting is deterministic and offset-preserving: the pipeline maps
 * these raw sections back onto the exact source content.
 */
import { parse as parseYamlDocument, YAMLParseError } from "yaml";

export type RawSectionKind = "TITLE" | "HEADING" | "PARAGRAPH" | "BULLET" | "NUMBERED" | "TABLE" | "KEYVALUE" | "CODE";

export interface RawSection {
  kind: RawSectionKind;
  heading?: string;
  level?: number;
  text: string;
  /** Offset of this block in the decoded source text. */
  start: number;
  end: number;
}

export interface TextParseLimits {
  maxSections: number;
  /**
   * Hard input guard for the parser (decoded characters). The canonical content
   * budget is enforced later by the ingestion pipeline, which clips whole
   * sections; this bound only refuses input too large to tokenize at all.
   */
  maxBytes: number;
  maxContentLength: number;
  maxCsvRows: number;
  maxJsonNodes: number;
}

export const DEFAULT_TEXT_LIMITS: TextParseLimits = {
  maxSections: 4000,
  maxBytes: 8 * 1024 * 1024,
  maxContentLength: 4 * 1024 * 1024,
  maxCsvRows: 20000,
  maxJsonNodes: 20000
};

export class TextParseError extends Error {
  constructor(readonly code: "UNSUPPORTED_ENCODING" | "CORRUPT_INPUT" | "TOO_LARGE", message: string) {
    super(message);
    this.name = "TextParseError";
  }
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

const ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "gbk"] as const;
export type TextEncoding = (typeof ENCODINGS)[number] | "utf-8-lossy";

/** Decodes bytes using BOM/UTF-8 validation, falling back to GBK then lossy UTF-8. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding; warnings: string[] } {
  const warnings: string[] = [];
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8", warnings };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le", warnings };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be", warnings };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", warnings };
  } catch {
    // Not valid UTF-8: a Chinese WorkBook is far more likely GBK than corrupt.
    try {
      const decoded = new TextDecoder("gbk", { fatal: true }).decode(bytes);
      warnings.push("file was not valid UTF-8; decoded as GBK");
      return { text: decoded, encoding: "gbk", warnings };
    } catch {
      warnings.push("file was neither valid UTF-8 nor GBK; decoded lossily as UTF-8");
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8-lossy", warnings };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Markdown / plain text
 * ------------------------------------------------------------------ */

const MD_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT_UNDERLINE = /^(=+|-{2,})\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const NUMBERED_CJK = /^\s*(?:第[一二三四五六七八九十百\d]+[章节条]|[一二三四五六七八九十]+[、.]|\d+[、]|[（(]\d+[)）])\s*/;
const KEY_VALUE = /^\s*(?:[-*+]\s*)?([^:：]{1,60})[:：]\s*(\S.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;

function headingLevelForLine(line: string, nextLine: string | undefined, plainText: boolean): { level: number; heading: string } | undefined {
  const atx = MD_HEADING.exec(line);
  if (atx) return { level: atx[1].length, heading: atx[2].trim() };
  if (nextLine !== undefined && SETEXT_UNDERLINE.test(nextLine) && line.trim() && !LIST_ITEM.test(line)) {
    return { level: nextLine.trim().startsWith("=") ? 1 : 2, heading: line.trim() };
  }
  if (plainText) {
    // Chinese WorkBooks head sections with 「一、目标」 or 「第一章 范围」. Arabic
    // list items (`1.`) are body content, so they are deliberately excluded.
    if (NUMBERED_CJK.test(line) && line.trim().length <= 60 && !/[。；;]$/.test(line.trim())) {
      return { level: 2, heading: line.trim() };
    }
  }
  return undefined;
}

/**
 * Splits markdown/plain text into ordered sections. Fenced code blocks are
 * never split internally; headings carry their level and text.
 */
export function parseTextSections(text: string, options: { plainText?: boolean; limits?: Partial<TextParseLimits> } = {}): RawSection[] {
  const limits = { ...DEFAULT_TEXT_LIMITS, ...options.limits };
  const plainText = options.plainText ?? false;
  if (text.length > limits.maxBytes) throw new TextParseError("TOO_LARGE", `Document exceeds the ${limits.maxBytes}-character parser guard`);
  const lines = text.split("\n");
  const sections: RawSection[] = [];
  let offset = 0;
  let current: RawSection | undefined;
  let inFence = false;
  let fenceMarker = "";

  const pushCurrent = (end: number) => {
    if (!current) return;
    current.text = current.text.replace(/\s+$/g, "");
    current.end = current.text ? current.end : end;
    if (current.text.trim() || current.heading) sections.push(current);
    current = undefined;
  };

  for (let index = 0; index < lines.length && sections.length < limits.maxSections; index++) {
    const line = lines[index];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    const fence = FENCE.exec(line);
    if (fence) {
      if (!inFence) {
        pushCurrent(lineStart);
        inFence = true;
        fenceMarker = fence[1][0];
        current = { kind: "CODE", text: line, start: lineStart, end: lineEnd };
      } else if (fence[1][0] === fenceMarker) {
        current = current ?? { kind: "CODE", text: "", start: lineStart, end: lineEnd };
        current.text += `\n${line}`;
        current.end = lineEnd;
        inFence = false;
        pushCurrent(lineEnd);
      } else {
        current = current ?? { kind: "CODE", text: "", start: lineStart, end: lineEnd };
        current.text += `\n${line}`;
        current.end = lineEnd;
      }
      continue;
    }
    if (inFence) {
      if (current) { current.text += `\n${line}`; current.end = lineEnd; }
      continue;
    }

    const heading = headingLevelForLine(line, lines[index + 1], plainText);
    if (heading) {
      pushCurrent(lineStart);
      const isSetext = !MD_HEADING.test(line) && SETEXT_UNDERLINE.test(lines[index + 1] ?? "");
      const end = isSetext ? lineEnd + (lines[index + 1]?.length ?? 0) + 1 : lineEnd;
      // A heading is self-contained: its body starts as its own section, never
      // merged into the heading block.
      sections.push({
        kind: heading.level === 1 ? "TITLE" : "HEADING",
        heading: heading.heading,
        level: heading.level,
        text: heading.heading,
        start: lineStart,
        end
      });
      if (isSetext) {
        offset = end;
        index++;
      }
      continue;
    }

    if (!line.trim()) {
      pushCurrent(lineStart);
      continue;
    }

    const kind: RawSectionKind = TABLE_ROW.test(line)
      ? "TABLE"
      : LIST_ITEM.test(line)
        ? (/^\s*\d/.test(line) ? "NUMBERED" : "BULLET")
        : KEY_VALUE.test(line) && !plainText
          ? "KEYVALUE"
          : "PARAGRAPH";

    if (!current) {
      current = { kind, text: line, start: lineStart, end: lineEnd };
      if (kind === "TABLE") current.heading = undefined;
      continue;
    }
    // Continue the same block when the kind matches; otherwise start a new one.
    const continues = current.kind === kind
      || (current.kind === "PARAGRAPH" && kind === "PARAGRAPH")
      || (current.kind === "TABLE" && kind === "TABLE");
    if (continues) {
      current.text += `\n${line}`;
      current.end = lineEnd;
    } else {
      pushCurrent(lineStart);
      current = { kind, text: line, start: lineStart, end: lineEnd };
    }
  }
  pushCurrent(offset);
  return sections;
}

/* ------------------------------------------------------------------ *
 * Structured data (JSON / YAML / JSON Lines)
 * ------------------------------------------------------------------ */

/** Deterministic YAML-ish rendering used for section bodies and the merged view. */
export function renderStructured(value: unknown, indent = 0, depth = 0): string {
  const pad = "  ".repeat(indent);
  if (depth > 12) return `${pad}...`;
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value.map((item) => {
      if (item !== null && typeof item === "object") return `${pad}-\n${renderStructured(item, indent + 1, depth + 1)}`;
      return `${pad}- ${renderScalar(item)}`;
    }).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "{}";
    return entries.map(([key, item]) => {
      if (item !== null && typeof item === "object") return `${pad}${key}:\n${renderStructured(item, indent + 1, depth + 1)}`;
      return `${pad}${key}: ${renderScalar(item)}`;
    }).join("\n");
  }
  return `${pad}${renderScalar(value)}`;
}

function renderScalar(value: unknown): string {
  if (typeof value === "string") return /[:#\-?[\]{},&*!|>'"%@`]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

export interface StructuredParseResult {
  value: unknown;
  format: "json" | "jsonl" | "yaml";
  warnings: string[];
}

/** Parses JSON first, then JSON Lines, then YAML — all deterministic. */
export function parseStructuredText(text: string, fileName: string): StructuredParseResult {
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) throw new TextParseError("CORRUPT_INPUT", "Structured document is empty");
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  const preferYaml = extension === ".yaml" || extension === ".yml";

  const tryJson = (): { ok: true; value: unknown } | { ok: false; error: string } => {
    try {
      return { ok: true, value: JSON.parse(trimmed) as unknown };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  };

  if (!preferYaml) {
    const json = tryJson();
    if (json.ok) return { value: json.value, format: "json", warnings };
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > 1 && lines.every((line) => line.trim().startsWith("{") && line.trim().endsWith("}"))) {
      const rows: unknown[] = [];
      for (const line of lines) {
        try { rows.push(JSON.parse(line) as unknown); }
        catch { rows.length = 0; break; }
      }
      if (rows.length) {
        warnings.push(`parsed ${rows.length} JSON Lines records`);
        return { value: rows, format: "jsonl", warnings };
      }
    }
    try {
      const value = parseYamlDocument(trimmed, { maxAliasCount: 100 }) as unknown;
      warnings.push(`JSON parsing failed (${json.error}); parsed as YAML`);
      return { value, format: "yaml", warnings };
    } catch (error) {
      const detail = error instanceof YAMLParseError ? error.message : (error as Error).message;
      throw new TextParseError("CORRUPT_INPUT", `Not valid JSON or YAML: ${json.error} | ${detail}`);
    }
  }

  try {
    const value = parseYamlDocument(trimmed, { maxAliasCount: 100 }) as unknown;
    return { value, format: "yaml", warnings };
  } catch (error) {
    const detail = error instanceof YAMLParseError ? error.message : (error as Error).message;
    throw new TextParseError("CORRUPT_INPUT", `Not valid YAML: ${detail}`);
  }
}

/** Flattens a parsed structure into headed sections (one per top-level key). */
export function sectionsFromStructured(value: unknown, limits: Partial<TextParseLimits> = {}): RawSection[] {
  const effective = { ...DEFAULT_TEXT_LIMITS, ...limits };
  const sections: RawSection[] = [];
  let cursor = 0;
  const push = (kind: RawSectionKind, heading: string | undefined, text: string, level?: number) => {
    if (sections.length >= effective.maxSections) return;
    const rendered = text.trim();
    if (!rendered && !heading) return;
    const section: RawSection = { kind, text: rendered, start: cursor, end: cursor + rendered.length };
    if (heading !== undefined) section.heading = heading;
    if (level !== undefined) section.level = level;
    sections.push(section);
    cursor = section.end + 1;
  };

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (sections.length >= effective.maxSections) break;
      if (typeof item === "string") push("KEYVALUE", key, item, 2);
      else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
        push("HEADING", key, item.map((entry) => `- ${String(entry)}`).join("\n"), 2);
      } else push("HEADING", key, renderStructured(item, 0), 2);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (sections.length >= effective.maxSections) return;
      const heading = item !== null && typeof item === "object" && "id" in (item as Record<string, unknown>)
        ? String((item as Record<string, unknown>).id)
        : `item-${index + 1}`;
      push("HEADING", heading, renderStructured(item, 0), 2);
    });
  } else {
    push("PARAGRAPH", undefined, renderStructured(value, 0));
  }
  return sections;
}

/* ------------------------------------------------------------------ *
 * CSV / TSV
 * ------------------------------------------------------------------ */

export interface CsvTable {
  rows: string[][];
  delimiter: string;
  warnings: string[];
}

/** RFC4180-ish CSV/TSV parser: quoted fields, escaped quotes, CRLF, bounded rows. */
export function parseDelimited(text: string, options: { delimiter?: string; limits?: Partial<TextParseLimits> } = {}): CsvTable {
  const limits = { ...DEFAULT_TEXT_LIMITS, ...options.limits };
  const delimiter = options.delimiter ?? (text.includes("\t") && !text.includes(",") ? "\t" : ",");
  const rows: string[][] = [];
  const warnings: string[] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let index = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (row.length > 1 || (row[0] ?? "").trim() !== "") rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        inQuotes = false;
        index++;
        continue;
      }
      field += character;
      index++;
      continue;
    }
    if (character === '"' && field === "") { inQuotes = true; index++; continue; }
    if (character === delimiter) { endField(); index++; continue; }
    if (character === "\r") { index++; continue; }
    if (character === "\n") {
      endRow();
      index++;
      if (rows.length >= limits.maxCsvRows) {
        warnings.push(`row limit ${limits.maxCsvRows} reached; remaining rows were not read`);
        break;
      }
      continue;
    }
    field += character;
    index++;
  }
  if (field !== "" || row.length) endRow();
  if (inQuotes) warnings.push("file ended inside a quoted field; the last field may be truncated");
  return { rows, delimiter, warnings };
}

function csvMarkdown(rows: string[][], maxColumns: number): string {
  const width = Math.min(Math.max(...rows.map((row) => row.length), 1), maxColumns);
  const cell = (value: string) => (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines: string[] = [];
  const header = rows[0]?.slice(0, width) ?? [];
  lines.push(`| ${header.map(cell).join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) lines.push(`| ${row.slice(0, width).map(cell).join(" | ")} |`);
  return lines.join("\n");
}

/**
 * Turns a delimited table into sections: one table section per group of rows
 * whose first column carries a label, falling back to a single whole-file
 * table. Keeps row-to-section provenance without inventing semantics.
 */
export function sectionsFromDelimited(table: CsvTable, options: { fileName?: string; maxColumns?: number } = {}): RawSection[] {
  const maxColumns = options.maxColumns ?? 64;
  const rows = table.rows;
  if (!rows.length) return [];
  const header = rows[0];
  const body = rows.slice(1);
  const sections: RawSection[] = [];
  let cursor = 0;
  const push = (heading: string | undefined, text: string, kind: RawSectionKind = "TABLE") => {
    const rendered = text.trim();
    if (!rendered) return;
    const section: RawSection = { kind, text: rendered, start: cursor, end: cursor + rendered.length };
    if (heading) section.heading = heading;
    sections.push(section);
    cursor = section.end + 1;
  };
  if (!body.length) {
    push(options.fileName, csvMarkdown(rows, maxColumns));
    return sections;
  }
  const labelColumn = header.length > 1 && body.some((row) => (row[0] ?? "").trim().length > 0);
  if (!labelColumn) {
    push(options.fileName, csvMarkdown(rows, maxColumns));
    return sections;
  }
  let groupLabel: string | undefined;
  let groupRows: string[][] = [];
  const flush = () => {
    if (!groupRows.length) return;
    push(groupLabel, csvMarkdown([header, ...groupRows], maxColumns));
    groupRows = [];
  };
  for (const row of body) {
    const label = (row[0] ?? "").replace(/^"|"$/g, "").trim();
    if (label && label !== groupLabel) {
      flush();
      groupLabel = label;
    }
    groupRows.push(row);
  }
  flush();
  return sections;
}

/** Detects the delimiter for a `.csv`/`.tsv`/`.txt` table-ish file. */
export function detectDelimiter(text: string, fileName: string): string {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  if (extension === ".tsv") return "\t";
  if (extension === ".csv") return ",";
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const commas = (sample.match(/,/g) ?? []).length;
  const tabs = (sample.match(/\t/g) ?? []).length;
  const pipes = (sample.match(/\|/g) ?? []).length;
  if (tabs >= commas && tabs >= pipes && tabs > 0) return "\t";
  if (pipes > commas) return "|";
  return ",";
}
