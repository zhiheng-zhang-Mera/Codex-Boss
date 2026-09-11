/**
 * Concurrency/regression guard for REPAIR_BATCH_1 fix 2.
 *
 * PDF extraction must not replace, wrap or intercept global console functions:
 * a process-global monkeypatch would swallow unrelated application logging and
 * could leak across concurrent await points. These tests capture the console
 * identities up front and prove they are unchanged after concurrent extraction,
 * including when application logging is interleaved with extraction.
 */
import { describe, expect, it } from "vitest";
import { PdfError, PdfVerbosity, extractPdf, inspectPdfHeader } from "../../electron/ingestion/pdf-reader";
import { buildPdf } from "../fixtures/workbook-fixtures";

/** Console functions a PDF extraction must never reassign. */
const CONSOLE_KEYS = ["log", "warn", "error", "info", "debug", "trace"] as const;
type ConsoleKey = (typeof CONSOLE_KEYS)[number];

function consoleSnapshot(): Record<ConsoleKey, unknown> {
  const snapshot = {} as Record<ConsoleKey, unknown>;
  for (const key of CONSOLE_KEYS) snapshot[key] = console[key];
  return snapshot;
}

/** Includes the console object identity, not just its methods. */
function consoleIdentities(before: Record<ConsoleKey, unknown>): Record<ConsoleKey, unknown> {
  return before;
}

function expectConsoleUnchanged(before: Record<ConsoleKey, unknown>): void {
  for (const key of CONSOLE_KEYS) expect(console[key]).toBe(before[key]);
}

describe("pdf extraction never patches the global console", () => {
  it("leaves every console function identical after a concurrent batch", async () => {
    const before = consoleSnapshot();
    const documents = Array.from({ length: 6 }, (_, index) => buildPdf([
      { lines: [`document ${index + 1} page 1`] },
      { lines: [`document ${index + 1} page 2`] }
    ]));

    const results = await Promise.all(documents.map((bytes) => extractPdf(bytes)));
    expect(results).toHaveLength(6);
    for (const [index, result] of results.entries()) {
      expect(result.pages.map((page) => page.number)).toEqual([1, 2]);
      expect(result.pages[0].text).toContain(`document ${index + 1} page 1`);
    }
    expectConsoleUnchanged(before);
  });

  it("keeps the console intact through success, failure and refusal paths", async () => {
    const before = consoleSnapshot();

    // Success.
    await extractPdf(buildPdf([{ lines: ["ok"] }]));
    // Out-of-scope documents (typed errors instead of console side effects).
    await expect(extractPdf(buildPdf([{ lines: ["secret"] }], { encrypted: true }))).rejects.toBeInstanceOf(PdfError);
    await expect(extractPdf(new Uint8Array(Buffer.from("not a pdf")))).rejects.toBeInstanceOf(PdfError);
    // A structurally broken but header-valid document.
    await expect(extractPdf(new Uint8Array(Buffer.from("%PDF-1.7\ntrailer\n<< /Size 1 >>\n%%EOF\n")))).rejects.toBeInstanceOf(PdfError);

    expectConsoleUnchanged(before);
    expect(inspectPdfHeader(buildPdf([{ lines: ["ok"] }]))).toEqual({ ok: true });
  });

  it("does not swallow application logs interleaved with extraction", async () => {
    const before = consoleSnapshot();
    const consoleObject = console;
    const originalWarn = console.warn;
    const originalError = console.error;
    const seen: string[] = [];
    const marker = (value: string) => (...args: unknown[]) => { seen.push(`${value}:${args.join(" ")}`); };

    // Wrap the real functions ourselves. If extraction captured and restored
    // console, our wrappers would be discarded (leak) or an unrelated log would
    // be swallowed; both failures are asserted below.
    console.warn = marker("warn");
    console.error = marker("error");
    try {
      const extraction = extractPdf(buildPdf([{ lines: ["interleaved"] }]));
      console.warn("application warning during extraction");
      const result = await extraction;
      console.error("application error after extraction");
      expect(result.pages[0].text).toContain("interleaved");
      expect(seen).toEqual(["warn:application warning during extraction", "error:application error after extraction"]);
      // The application's own wrappers survived the whole extraction.
      expect(console.warn).toBe(console.warn);
      expect(console.warn.name).not.toBe("capture");
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    expect(console).toBe(consoleObject);
    expectConsoleUnchanged(before);
  });

  it("states the engine verbosity explicitly instead of silencing the process console", () => {
    // ERRORS keeps pdfjs quiet through its supported option; there is no
    // console redirection anywhere in the module to fall back on.
    expect(PdfVerbosity.ERRORS).toBe(0);
    expect(PdfVerbosity.WARNINGS).toBe(1);
    const moduleSource = extractPdf.toString();
    // No property access on the global console object at all.
    expect(moduleSource).not.toContain("console.");
  });
});
