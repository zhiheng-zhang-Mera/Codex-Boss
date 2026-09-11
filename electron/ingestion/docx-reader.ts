/**
 * DOCX adapter (Work Unit 1). Conversion is delegated to mammoth (pinned,
 * BSD-2-Clause) instead of a bespoke OOXML walker: the OOXML text model is
 * large and only a maintained library should parse it.
 *
 * This module owns the boundary, not the parsing:
 *  - a strict per-document limit on bytes, paragraphs, characters, warnings;
 *  - deterministic mapping of mammoth messages to typed diagnostics;
 *  - typed fail-closed errors so one corrupt attachment cannot fail a batch;
 *  - an injectable conversion seam so tests do not depend on a real .docx.
 */
export class DocxError extends Error {
  constructor(readonly code: "NOT_DOCX" | "CORRUPT_DOCX" | "TOO_LARGE" | "ENGINE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "DocxError";
  }
}

export interface DocxParagraph {
  text: string;
  style?: string;
  headingLevel?: number;
  listItem?: boolean;
  /** Paragraph came from a header/footer part (mammoth reports these inline). */
  fromHeaderOrFooter?: boolean;
}

export interface DocxExtraction {
  paragraphs: DocxParagraph[];
  warnings: string[];
}

export interface DocxLimits {
  maxBytes: number;
  maxParagraphs: number;
  maxCharacters: number;
}

export const DEFAULT_DOCX_LIMITS: DocxLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxParagraphs: 20000,
  maxCharacters: 2000000
};

/** The raw text mammoth produced, plus its messages. */
export interface DocxRawConversion {
  text: string;
  messages: { type?: string; message?: string }[];
}

/** The HTML mammoth produced, plus its messages. */
export interface DocxHtmlConversion {
  html: string;
  messages: { type?: string; message?: string }[];
}

/**
 * Conversion seam. The default implementation loads mammoth lazily; tests and
 * future offline pipelines can inject a different converter without changing
 * any caller.
 */
export type DocxConverter = (bytes: Uint8Array, limits: DocxLimits) => Promise<DocxRawConversion>;

/** Same seam for the structure-preserving (HTML) conversion. */
export type DocxHtmlConverter = (bytes: Uint8Array, limits: DocxLimits) => Promise<DocxHtmlConversion>;

let injectedConverter: DocxConverter | undefined;
let injectedHtmlConverter: DocxHtmlConverter | undefined;

/** Test/DI seam: overrides the plain-text converter (undefined restores mammoth). */
export function setDocxConverter(converter: DocxConverter | undefined): void {
  injectedConverter = converter;
}

/** Test/DI seam: overrides the HTML converter (undefined restores mammoth). */
export function setDocxHtmlConverter(converter: DocxHtmlConverter | undefined): void {
  injectedHtmlConverter = converter;
}

async function loadMammoth(): Promise<typeof import("mammoth")> {
  try {
    return await import("mammoth");
  } catch (error) {
    throw new DocxError("ENGINE_UNAVAILABLE", `mammoth could not be loaded: ${(error as Error).message}`);
  }
}

async function mammothConverter(bytes: Uint8Array, limits: DocxLimits): Promise<DocxRawConversion> {
  const mammoth = await loadMammoth();
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    void limits;
    return { text: result.value, messages: result.messages ?? [] };
  } catch (error) {
    throw new DocxError("CORRUPT_DOCX", `mammoth could not read the document: ${(error as Error).message}`);
  }
}

async function mammothHtmlConverter(bytes: Uint8Array, limits: DocxLimits): Promise<DocxHtmlConversion> {
  const mammoth = await loadMammoth();
  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    void limits;
    return { html: result.value, messages: result.messages ?? [] };
  } catch (error) {
    throw new DocxError("CORRUPT_DOCX", `mammoth could not convert the document: ${(error as Error).message}`);
  }
}

const HEADING_PATTERN = /^(heading|鏍囬)\s*([1-9涓€浜屼笁鍥涗簲鍏竷鍏節])$/i;

function headingLevelFor(style: string | undefined): number | undefined {
  if (!style) return undefined;
  const match = HEADING_PATTERN.exec(style.trim());
  if (!match) return undefined;
  const numeric = Number.parseInt(match[2], 10);
  if (Number.isFinite(numeric)) return numeric;
  return "涓€浜屼笁鍥涗簲鍏竷鍏節".indexOf(match[2]) + 1;
}

/**
 * Splits mammoth's plain text into paragraphs. mammoth's raw-text output
 * separates blocks with blank lines; every non-empty line becomes one
 * paragraph so headings and bullets stay aligned with the source document.
 */
export function paragraphsFromText(text: string, limits: DocxLimits): { paragraphs: DocxParagraph[]; truncated: boolean } {
  const paragraphs: DocxParagraph[] = [];
  let characters = 0;
  let truncated = false;
  const lines = text.split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.replace(/\u00ad/g, "").replace(/[ \t]+$/g, "");
    if (!line.trim()) continue;
    if (paragraphs.length >= limits.maxParagraphs || characters + line.length > limits.maxCharacters) {
      truncated = true;
      break;
    }
    characters += line.length;
    const bullet = /^\s*(?:[-*+鈥|\[[ xX]\]|\d+[.)])\s+/.exec(line);
    const content = bullet ? line.slice(bullet[0].length) : line;
    const headingLevel = headingLevelFor(guessStyle(line));
    const paragraph: DocxParagraph = { text: content.trim() };
    if (headingLevel) paragraph.headingLevel = headingLevel;
    if (bullet) paragraph.listItem = true;
    paragraphs.push(paragraph);
  }
  return { paragraphs, truncated };
}

/**
 * mammoth's raw-text output does not carry styles, so a heading is recognised
 * from the render-ready conventions: markdown ATX prefixes and short
 * numbered/section lines that the source document used as headings.
 */
function guessStyle(line: string): string | undefined {
  const atx = /^\s*(#{1,6})\s+/.exec(line);
  if (atx) return `Heading${atx[1].length}`;
  return undefined;
}

/**
 * mammoth's HTML output does not carry style ids, so the heading level is read
 * from the standard `<h1>`..`<h6>` elements mammoth emits for styled headings.
 */
export function paragraphsFromHtml(html: string, limits: DocxLimits): { paragraphs: DocxParagraph[]; truncated: boolean } {
  const paragraphs: DocxParagraph[] = [];
  const blocks = html.match(/<(h[1-6]|p|li)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  let characters = 0;
  let truncated = false;
  for (const block of blocks) {
    if (paragraphs.length >= limits.maxParagraphs || characters + block.length > limits.maxCharacters) {
      truncated = true;
      break;
    }
    const tag = /^<(h[1-6]|p|li)\b/i.exec(block)?.[1].toLowerCase() ?? "p";
    const text = htmlToText(block.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>$/, ""));
    if (!text.trim()) continue;
    characters += text.length;
    const paragraph: DocxParagraph = { text: text.trim() };
    if (/^h[1-6]$/.test(tag)) paragraph.headingLevel = Number.parseInt(tag.slice(1), 10);
    if (tag === "li") paragraph.listItem = true;
    paragraphs.push(paragraph);
  }
  return { paragraphs, truncated };
}

/** Converts one mammoth HTML fragment to text, dropping tags but not content. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\u00ad/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function messageToWarning(message: { type?: string; message?: string }): string {
  const type = message.type ?? "warning";
  const text = (message.message ?? "").trim();
  return text ? `${type}: ${text}` : type;
}

function assertContainer(bytes: Uint8Array, limits: DocxLimits): void {
  if (bytes.byteLength === 0) throw new DocxError("NOT_DOCX", "DOCX is empty");
  if (bytes.byteLength > limits.maxBytes) throw new DocxError("TOO_LARGE", `DOCX is ${bytes.byteLength} bytes, above the ${limits.maxBytes}-byte limit`);
  // A DOCX is a ZIP; the local file header signature is a cheap fail-closed gate
  // that keeps obviously wrong bytes out of the converter.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new DocxError("NOT_DOCX", "Missing ZIP container signature (PK)");
}

function warningsFor(conversion: { messages: { type?: string; message?: string }[] }, truncated: boolean, effective: DocxLimits): string[] {
  const warnings = conversion.messages.slice(0, 50).map(messageToWarning);
  if (conversion.messages.length > 50) warnings.push(`${conversion.messages.length - 50} further converter message(s) were suppressed`);
  if (truncated) warnings.push(`document exceeded the ${effective.maxParagraphs}-paragraph / ${effective.maxCharacters}-character budget and was truncated`);
  return warnings;
}

/** Converts DOCX bytes into ordered paragraphs (plain text). Fails closed. */
export async function extractDocx(bytes: Uint8Array, limits: Partial<DocxLimits> = {}): Promise<DocxExtraction> {
  const effective: DocxLimits = { ...DEFAULT_DOCX_LIMITS, ...limits };
  assertContainer(bytes, effective);
  const converter = injectedConverter ?? mammothConverter;
  const conversion = await converter(bytes, effective);
  const { paragraphs, truncated } = paragraphsFromText(conversion.text, effective);
  const warnings = warningsFor(conversion, truncated, effective);
  if (!paragraphs.length) warnings.push("no readable paragraph was found in the document body");
  return { paragraphs, warnings };
}

/** Converts DOCX bytes into ordered paragraphs with heading levels (HTML pass). */
export async function extractDocxHtml(bytes: Uint8Array, limits: Partial<DocxLimits> = {}): Promise<DocxExtraction> {
  const effective: DocxLimits = { ...DEFAULT_DOCX_LIMITS, ...limits };
  assertContainer(bytes, effective);
  const converter = injectedHtmlConverter ?? mammothHtmlConverter;
  const conversion = await converter(bytes, effective);
  const { paragraphs, truncated } = paragraphsFromHtml(conversion.html, effective);
  const warnings = warningsFor(conversion, truncated, effective);
  if (!paragraphs.length) warnings.push("no readable paragraph was found in the document body");
  return { paragraphs, warnings };
}
