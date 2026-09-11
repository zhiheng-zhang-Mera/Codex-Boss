/**
 * XLSX adapter (Work Unit 1). Container handling is delegated to fflate
 * (pinned, MIT) instead of a bespoke ZIP reader; only the small, well-specified
 * OOXML parts needed to recover a sheet as text are read here.
 *
 * Boundary rules:
 *  - strict limits on archive bytes, entry count, per-entry and total
 *    decompressed output (decompression-bomb defence);
 *  - encrypted/large/unsupported parts fail closed with typed diagnostics;
 *  - sheets render as markdown tables so the canonical document keeps
 *    row/column structure instead of losing it to a flat text dump;
 *  - a formula without a cached value is reported, never silently invented.
 */
import { unzipSync } from "fflate";
import { decodeUtf8, extractTextRuns, matchBlocks, unescapeXml } from "./xml-text";

export class XlsxError extends Error {
  constructor(readonly code: "NOT_XLSX" | "CORRUPT_XLSX" | "TOO_LARGE" | "ENCRYPTED_XLSX" | "ENGINE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

export interface XlsxSheet {
  name: string;
  part: string;
  rows: string[][];
  usedRange: { rows: number; columns: number };
}

export interface XlsxExtraction {
  sheets: XlsxSheet[];
  /** Markdown rendering, one table per sheet: the canonical section body. */
  markdown: string;
  warnings: string[];
}

export interface XlsxLimits {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumns: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxSheets: 50,
  maxRowsPerSheet: 5000,
  maxColumns: 256
};

/** Decompresses the archive with hard limits. Throws XlsxError fail-closed. */
export function readArchiveEntries(bytes: Uint8Array, limits: Partial<XlsxLimits> = {}): Record<string, Uint8Array> {
  const effective: XlsxLimits = { ...DEFAULT_XLSX_LIMITS, ...limits };
  if (bytes.byteLength === 0) throw new XlsxError("NOT_XLSX", "XLSX is empty");
  if (bytes.byteLength > effective.maxBytes) throw new XlsxError("TOO_LARGE", `XLSX is ${bytes.byteLength} bytes, above the ${effective.maxBytes}-byte limit`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new XlsxError("NOT_XLSX", "Missing ZIP container signature (PK)");

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.startsWith("xl/") || file.name === "[Content_Types].xml") return true;
        // Other parts (media, printer settings) are never needed for text.
        return false;
      }
    });
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    if (/encrypt|password/i.test(message)) throw new XlsxError("ENCRYPTED_XLSX", "Encrypted workbooks are not supported");
    throw new XlsxError("CORRUPT_XLSX", `Archive could not be decompressed: ${message}`);
  }

  const names = Object.keys(entries);
  if (names.length > effective.maxEntries) throw new XlsxError("TOO_LARGE", `Archive has ${names.length} entries, above the ${effective.maxEntries}-entry limit`);
  let total = 0;
  for (const name of names) {
    const size = entries[name].byteLength;
    if (size > effective.maxEntryBytes) throw new XlsxError("TOO_LARGE", `Entry ${name} expands to ${size} bytes, above the ${effective.maxEntryBytes}-byte limit`);
    total += size;
  }
  if (total > effective.maxTotalBytes) throw new XlsxError("TOO_LARGE", `Archive expands to ${total} bytes, above the ${effective.maxTotalBytes}-byte limit`);
  return entries;
}

function columnIndexFor(reference: string, fallback: number): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1];
  if (!letters) return fallback;
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  return matchBlocks(xml, "si").map((item) => extractTextRuns(item));
}

/** Resolves sheet display names to worksheet parts via workbook.xml.rels. */
function sheetOrder(workbookXml: string, relsXml: string | undefined): { name: string; part: string }[] {
  const relationships = new Map<string, string>();
  if (relsXml) {
    for (const token of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      const id = /Id="([^"]*)"/.exec(token)?.[1];
      const target = /Target="([^"]*)"/.exec(token)?.[1];
      if (!id || !target) continue;
      relationships.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }
  const sheets: { name: string; part: string }[] = [];
  for (const token of workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = unescapeXml(/name="([^"]*)"/.exec(token)?.[1] ?? "");
    const relId = /r:id="([^"]*)"/.exec(token)?.[1];
    const target = relId ? relationships.get(relId) : undefined;
    if (!name || !target) continue;
    sheets.push({ name, part: `xl/${target.replace(/^xl\//, "")}` });
  }
  return sheets;
}

function parseSheetRows(xml: string, shared: string[], limits: XlsxLimits, warnings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowToken of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    if (rows.length >= limits.maxRowsPerSheet) {
      warnings.push(`sheet row limit ${limits.maxRowsPerSheet} reached; remaining rows were not read`);
      break;
    }
    const cells: string[] = [];
    let position = 0;
    for (const cellToken of rowToken.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const reference = /r="([A-Z]+\d+)"/.exec(cellToken)?.[1] ?? "";
      const type = /t="([^"]*)"/.exec(cellToken)?.[1] ?? "n";
      const target = reference ? columnIndexFor(reference, position) : position;
      if (target >= limits.maxColumns) {
        warnings.push(`sheet column limit ${limits.maxColumns} reached; columns beyond it were dropped`);
        break;
      }
      while (cells.length < target) cells.push("");
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellToken)?.[1];
      let value = valueMatch === undefined ? "" : unescapeXml(valueMatch);
      if (type === "s") {
        const index = Number.parseInt(value, 10);
        value = Number.isInteger(index) && index >= 0 && index < shared.length ? shared[index] : "";
      } else if (type === "inlineStr") {
        value = extractTextRuns(cellToken);
      } else if (type === "b") {
        value = value === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        value = `#ERROR ${value}`;
      }
      if (!value && /<f\b/.test(cellToken)) {
        const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cellToken)?.[1];
        if (formula) {
          value = `=${unescapeXml(formula)}`;
          warnings.push(`a formula cell (${reference || "?"}) had no cached value; emitted the formula text`);
        }
      }
      cells[target] = value;
      position = target + 1;
    }
    rows.push(cells);
  }
  return rows;
}

function markdownFor(sheet: XlsxSheet): string {
  const width = Math.max(sheet.usedRange.columns, 1);
  const pad = (row: string[]) => {
    const copy = [...row];
    while (copy.length < width) copy.push("");
    return copy.slice(0, width);
  };
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const header = pad(sheet.rows[0] ?? []);
  const lines = [`| ${header.map(escape).join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of sheet.rows.slice(1)) lines.push(`| ${pad(row).map(escape).join(" | ")} |`);
  return lines.join("\n");
}

/** Extracts every worksheet as rows plus a markdown rendering. */
export function extractXlsx(bytes: Uint8Array, limits: Partial<XlsxLimits> = {}): XlsxExtraction {
  const effective: XlsxLimits = { ...DEFAULT_XLSX_LIMITS, ...limits };
  const warnings: string[] = [];
  const entries = readArchiveEntries(bytes, effective);
  const sheetParts = Object.keys(entries).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
  if (!entries["xl/workbook.xml"] && !sheetParts.length) {
    throw new XlsxError("NOT_XLSX", "XLSX archive has neither xl/workbook.xml nor any worksheet part");
  }

  const workbookXml = entries["xl/workbook.xml"];
  const relsData = entries["xl/_rels/workbook.xml.rels"];
  const ordered = workbookXml ? sheetOrder(decodeUtf8(workbookXml), relsData ? decodeUtf8(relsData) : undefined) : [];
  // Only resolve sheets that actually exist, and skip parts filtered out earlier.
  const discovered = (ordered.length
    ? ordered
    : sheetParts.map((part) => ({ name: part.replace(/^xl\/worksheets\//, "").replace(/\.xml$/, ""), part })))
    .filter((reference) => entries[reference.part]);
  if (!discovered.length) throw new XlsxError("CORRUPT_XLSX", "No readable worksheet part was found");
  if (discovered.length > effective.maxSheets) warnings.push(`sheet limit ${effective.maxSheets} reached; extra sheets were not read`);

  const sharedData = entries["xl/sharedStrings.xml"];
  const shared = sharedData ? parseSharedStrings(decodeUtf8(sharedData)) : [];
  if (!sharedData && Object.values(entries).some((entry) => entry.byteLength)) {
    warnings.push("workbook has no sharedStrings part; string cells use inline values only");
  }

  const sheets: XlsxSheet[] = [];
  for (const reference of discovered.slice(0, effective.maxSheets)) {
    const data = entries[reference.part];
    if (!data) { warnings.push(`worksheet part missing for sheet "${reference.name}"`); continue; }
    const rows = parseSheetRows(decodeUtf8(data), shared, effective, warnings);
    if (!rows.length) warnings.push(`sheet "${reference.name}" contains no rows`);
    const columns = Math.max(rows.reduce((max, row) => Math.max(max, row.length), 0), 1);
    sheets.push({ name: reference.name, part: reference.part, rows: rows.map((row) => row.slice(0, columns)), usedRange: { rows: rows.length, columns } });
  }
  if (!sheets.length) throw new XlsxError("CORRUPT_XLSX", "No readable worksheet was found");
  const markdown = sheets.map((sheet) => `### ${sheet.name}\n\n${markdownFor(sheet)}`).join("\n\n");
  return { sheets, markdown, warnings };
}
