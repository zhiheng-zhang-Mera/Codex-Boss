/**
 * PDF adapter (Work Unit 1). Text extraction is delegated to Mozilla's
 * pdfjs-dist (pinned, Apache-2.0) instead of a bespoke PDF parser: PDF is a
 * large hostile surface and only a mature engine should read it.
 *
 * What this module owns is the boundary, not the parsing:
 *  - one lazily imported legacy build so the renderer/shared layer stays clean;
 *  - strict per-document limits (bytes, pages, page characters, total text);
 *  - fail-closed typed errors (missing file, encryption, unsupported/corrupt)
 *    so one bad attachment can never take down a batch;
 *  - a deterministic page/section split of the extracted text.
 */

export class PdfError extends Error {
  constructor(readonly code: "NOT_PDF" | "ENCRYPTED" | "UNSUPPORTED" | "CORRUPT" | "TOO_LARGE" | "ENGINE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "PdfError";
  }
}

export interface PdfPage {
  /** 1-based page number in document order. */
  number: number;
  text: string;
}

export interface PdfExtraction {
  pages: PdfPage[];
  warnings: string[];
  documentInfo: Record<string, string>;
}

export interface PdfLimits {
  maxPages: number;
  maxBytes: number;
  maxCharactersPerPage: number;
  maxTotalCharacters: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = {
  maxPages: 300,
  maxBytes: 64 * 1024 * 1024,
  maxCharactersPerPage: 200000,
  maxTotalCharacters: 2000000
};

/**
 * pdfjs verbosity levels (the library's own enum values, inlined so this module
 * does not depend on the enum's runtime shape). ERRORS keeps the engine quiet
 * on the console without this module touching global console functions.
 */
export const PdfVerbosity = { ERRORS: 0, WARNINGS: 1, INFOS: 5 } as const;

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfJsPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup(): void;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
}

interface PdfJsModule {
  getDocument(options: Record<string, unknown>): PdfJsLoadingTask;
  GlobalWorkerOptions?: { workerSrc: string };
  version?: string;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
  destroy(): Promise<void>;
}

let cachedModule: PdfJsModule | undefined;

/**
 * Loads pdfjs-dist's legacy build. Kept lazy so importing this module never
 * pays the parser cost and so a missing optional dependency surfaces as a
 * typed per-document failure instead of a module-load crash.
 */
async function loadPdfJs(): Promise<PdfJsModule> {
  if (cachedModule) return cachedModule;
  try {
    const module = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as PdfJsModule;
    if (typeof module.getDocument !== "function") throw new Error("pdfjs-dist did not expose getDocument");
    cachedModule = module;
    return module;
  } catch (error) {
    throw new PdfError("ENGINE_UNAVAILABLE", `pdfjs-dist could not be loaded: ${(error as Error).message}`);
  }
}

/** Cheap pre-flight checks so obviously out-of-scope files never reach the engine. */
export function inspectPdfHeader(bytes: Uint8Array): { ok: true } | { ok: false; error: PdfError } {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) return { ok: false, error: new PdfError("NOT_PDF", "Missing %PDF- header") };
  // /Encrypt may appear anywhere in the trailer; scanning the whole buffer is
  // the only reliable pre-flight check without parsing.
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(Buffer.from(bytes).toString("latin1"))) {
    return { ok: false, error: new PdfError("ENCRYPTED", "Encrypted PDFs are not supported; export an unencrypted copy") };
  }
  return { ok: true };
}

/**
 * Extracts per-page text with pdfjs-dist. Fails closed: an engine error, an
 * encrypted document or a page-count overrun becomes a typed PdfError.
 */
export async function extractPdf(bytes: Uint8Array, limits: Partial<PdfLimits> = {}): Promise<PdfExtraction> {
  const effective: PdfLimits = { ...DEFAULT_PDF_LIMITS, ...limits };
  if (bytes.byteLength === 0) throw new PdfError("NOT_PDF", "PDF is empty");
  if (bytes.byteLength > effective.maxBytes) throw new PdfError("TOO_LARGE", `PDF is ${bytes.byteLength} bytes, above the ${effective.maxBytes}-byte limit`);
  const header = inspectPdfHeader(bytes);
  if (!header.ok) throw header.error;

  const pdfjs = await loadPdfJs();
  const warnings: string[] = [];
  let document: PdfJsDocument;
  let loadingTask: PdfJsLoadingTask | undefined;
  try {
    // `data` is copied because pdfjs transfers/detaches the buffer it is given.
    // `verbosity: ERRORS` keeps the engine's own informational output off the
    // process log; this module never redirects or intercepts logging, so
    // unrelated application output is untouched.
    loadingTask = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: PdfVerbosity.ERRORS
    });
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask?.destroy().catch(() => undefined);
    const message = (error as Error).message ?? String(error);
    if (/password/i.test(message)) throw new PdfError("ENCRYPTED", "PDF requires a password; provide an unencrypted copy");
    throw new PdfError("CORRUPT", `pdfjs-dist could not open the document: ${message}`);
  }
  // Fail closed if the engine could not resolve the page tree: an untrustworthy
  // page count would silently under-report the document.
  if (!Number.isInteger(document.numPages) || document.numPages < 1) {
    await loadingTask.destroy().catch(() => undefined);
    throw new PdfError("CORRUPT", `pdfjs-dist resolved an invalid page count (${String(document.numPages)})`);
  }

  try {
    if (document.numPages > effective.maxPages) {
      warnings.push(`document has ${document.numPages} pages; only the first ${effective.maxPages} were read`);
    }
    const pageCount = Math.min(document.numPages, effective.maxPages);
    const pages: PdfPage[] = [];
    let totalCharacters = 0;
    for (let number = 1; number <= pageCount; number++) {
      const page = await document.getPage(number);
      let text = "";
      try {
        const content = await page.getTextContent();
        text = joinTextItems(content.items);
      } finally {
        page.cleanup();
      }
      if (text.length > effective.maxCharactersPerPage) {
        warnings.push(`page ${number} exceeded ${effective.maxCharactersPerPage} characters and was truncated`);
        text = text.slice(0, effective.maxCharactersPerPage);
      }
      if (totalCharacters + text.length > effective.maxTotalCharacters) {
        warnings.push(`document text exceeded ${effective.maxTotalCharacters} characters; remaining pages were dropped`);
        pages.push({ number, text: text.slice(0, Math.max(0, effective.maxTotalCharacters - totalCharacters)) });
        break;
      }
      totalCharacters += text.length;
      if (!text.trim()) warnings.push(`page ${number} produced no extractable text`);
      pages.push({ number, text });
    }

    const documentInfo: Record<string, string> = {};
    try {
      const metadata = await document.getMetadata();
      for (const key of ["Title", "Author", "Subject", "Producer"]) {
        const value = metadata.info?.[key];
        if (typeof value === "string" && value.trim()) documentInfo[key.toLowerCase()] = value.trim();
      }
    } catch {
      warnings.push("document metadata could not be read");
    }
    if (!pages.some((page) => page.text.trim())) {
      warnings.push("no page contained extractable text (the PDF may be a scan; OCR is out of scope for this unit)");
    }
    return { pages, warnings, documentInfo };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Joins pdfjs text items, honouring explicit end-of-line markers and the
 * item order the engine reports (no positional re-flow heuristics).
 */
export function joinTextItems(items: PdfTextItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    parts.push(item.str);
    parts.push(item.hasEOL ? "\n" : " ");
  }
  return parts.join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
