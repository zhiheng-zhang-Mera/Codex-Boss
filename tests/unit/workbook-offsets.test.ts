/**
 * Adversarial offset-invariant tests (REPAIR_BATCH_1, fix 1).
 *
 * The invariant is absolute: for every returned section,
 * `document.content.slice(section.startOffset, section.endOffset) === section.text`.
 *
 * The cases below specifically defeat a "reuse the extractor's own offsets"
 * fast path: joining N sections inserts N-1 two-character separators, so an
 * extractor offset is only ever correct for the first section. Redaction and
 * truncation change the assembled length again, so offsets must be re-derived
 * after both.
 */
import { describe, expect, it } from "vitest";
import { ingestDocument, type DocumentSource } from "../../electron/ingestion/ingest";
import { DocxError, extractDocxHtml, setDocxHtmlConverter, setDocxConverter } from "../../electron/ingestion/docx-reader";
import type { CanonicalTaskDocument } from "../../src/shared/workbook";
import { buildDocx, buildPdf, buildXlsx } from "../fixtures/workbook-fixtures";
import { FIXED_NOW } from "../helpers/workbook-test-helpers";

function source(fileName: string, data: Uint8Array | string): DocumentSource {
  return {
    file_name: fileName,
    bytes: typeof data === "string" ? new Uint8Array(Buffer.from(data, "utf8")) : data,
    source_type: "UPLOAD",
    created_at: FIXED_NOW
  };
}

/** The invariant under test, applied to every section of a document. */
function expectOffsetsExact(document: CanonicalTaskDocument): void {
  for (const section of document.sections) {
    const sliced = document.content.slice(section.startOffset, section.endOffset);
    expect(sliced).toBe(section.text);
  }
  // Sections are ordered, non-overlapping and inside the content bounds.
  let previousEnd = 0;
  for (const section of document.sections) {
    expect(section.startOffset).toBeGreaterThanOrEqual(previousEnd);
    expect(section.endOffset).toBeGreaterThanOrEqual(section.startOffset);
    expect(section.endOffset).toBeLessThanOrEqual(document.content.length);
    previousEnd = section.endOffset;
  }
}

/** Every section must also occupy a contiguous, separator-separated span. */
function expectLayoutExact(document: CanonicalTaskDocument): void {
  if (!document.sections.length) {
    expect(document.content).toBe("");
    return;
  }
  const rebuilt = document.sections.map((section) => section.text).join("\n\n");
  expect(document.content).toBe(rebuilt);
  let cursor = 0;
  for (const section of document.sections) {
    expect(section.startOffset).toBe(cursor);
    cursor += section.text.length + 2;
  }
}

const ADVERSARIAL = [
  "# Alpha",
  "",
  "## Goal",
  "Ship the installment flow with a fixed boundary string AAAAAAAAAAAAAAAAAAAA.",
  "",
  "## Scope",
  "- checkout UI with a deliberately long line BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "- gateway adapter",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-1 selector visible",
  "- [ ] AC-2 fallback to full payment",
  "",
  "```ts",
  "export const installments = [3, 6, 12];",
  "```",
  "",
  "## Tasks",
  "1. implement the selector",
  "2. update the adapter"
].join("\n");

describe("canonical offsets are exact for every section", () => {
  it("holds across a many-section markdown document (separator drift)", async () => {
    const document = await ingestDocument(source("spec.md", ADVERSARIAL));
    expect(document.sections.length).toBeGreaterThan(8);
    expectOffsetsExact(document);
    expectLayoutExact(document);
  });

  it("holds when the first section is tiny, which maximises separator drift", async () => {
    // An 8-character first section followed by a long body: reusing extractor
    // offsets here would misplace every later section by hundreds of characters.
    const document = await ingestDocument(source("tiny.md", "# T\n\nbody ".repeat(1) + "x".repeat(4000) + "\n"));
    expectOffsetsExact(document);
    expectLayoutExact(document);
    expect(document.sections[0].text).toBe("T");
    expect(document.content.slice(document.sections[0].startOffset, document.sections[0].endOffset)).toBe("T");
  });

  it("keeps offsets exact in the first section too (the only one a stale offset gets right)", async () => {
    const document = await ingestDocument(source("spec.md", ADVERSARIAL));
    for (const section of document.sections) {
      // A stale extractor offset would satisfy this only for section 1.
      expect(document.content.slice(section.startOffset, section.endOffset)).toBe(section.text);
    }
    // Every section after the first is preceded by the inserted separator, which
    // the raw source does not contain at that position.
    for (const section of document.sections.slice(1)) {
      expect(document.content.slice(section.startOffset - 2, section.startOffset)).toBe("\n\n");
    }
  });

  it("holds for structured, spreadsheet and pdf documents", async () => {
    const json = await ingestDocument(source("spec.json", JSON.stringify({
      goal: "installments",
      scope: ["checkout UI", "gateway adapter"],
      acceptance_criteria: ["AC-1 visible", "AC-2 fallback"]
    }, null, 2)));
    expectOffsetsExact(json);

    const yaml = await ingestDocument(source("plan.yaml", "goal: installments\nscope:\n  - checkout\n  - gateway\ndeliverables:\n  - selector\n"));
    expectOffsetsExact(yaml);

    const csv = await ingestDocument(source("matrix.csv", "Section,Requirement\nScope,checkout UI\nScope,gateway adapter\nAcceptance,AC-1 visible\n"));
    expectOffsetsExact(csv);

    const xlsx = await ingestDocument(source("plan.xlsx", buildXlsx([
      { name: "Plan", rows: [["ID", "Task"], ["FR-1", "checkout UI"], ["AC-1", "visible"]] },
      { name: "Acceptance", rows: [["Criteria"], ["passes"]] }
    ])));
    expectOffsetsExact(xlsx);

    const pdf = await ingestDocument(source("doc.pdf", buildPdf([{ lines: ["Specification"] }, { lines: ["Acceptance Criteria"] }])));
    expectOffsetsExact(pdf);
  });

  it("holds after redaction rewrites section texts (second drift source)", async () => {
    const document = await ingestDocument(source("deploy.md", [
      "# Deploy",
      "",
      "## Credentials",
      `OPENAI_API_KEY=sk-proj-${"A1b2C3d4E5f6G7h8I9j0K1l2"}`,
      ["Authorization", ": ", "Bearer ", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"].join(""),
      "",
      "## Goal",
      "Deploy the installment service to staging with a fixed marker CCCCCCCCCCCCCCCCCCCC.",
      "",
      "## Acceptance Criteria",
      "- [ ] AC-1 no secret appears in logs"
    ].join("\n")));

    // Redaction really happened (text lengths changed relative to the source),
    // yet the offsets still map exactly.
    expect(document.redactions.length).toBeGreaterThan(0);
    expect(document.content).toContain("[REDACTED:");
    expect(document.content).not.toContain("sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2");
    expectOffsetsExact(document);
    expectLayoutExact(document);
  });

  it("holds after truncation, dropping whole sections instead of slicing", async () => {
    // The assembled content is ~300 characters; a 250-character budget keeps the
    // first sections whole and drops the later ones entirely.
    const document = await ingestDocument(source("spec.md", ADVERSARIAL), { limits: { maxContentLength: 250 } });
    expect(document.content.length).toBeLessThanOrEqual(250);
    expect(document.diagnostics.some((entry) => entry.code === "CONTENT_TRUNCATED")).toBe(true);
    expectOffsetsExact(document);
    expectLayoutExact(document);

    // A slice-based truncation would leave a partially-covered final section.
    const kept = document.sections;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(ADVERSARIAL.length);
    expect(document.content).toBe(kept.map((section) => section.text).join("\n\n"));
    expect(document.content).not.toMatch(/\s$/);
  });

  it("drops sections larger than the whole budget instead of keeping a fragment", async () => {
    // One small heading and one 500-character body under a 50-character budget:
    // the body cannot fit whole, so it is dropped and only the heading survives.
    const document = await ingestDocument(source("spec.md", `# A\n\n## Goal\n${"x".repeat(500)}\n`), { limits: { maxContentLength: 50 } });
    expect(document.content.length).toBeLessThanOrEqual(50);
    expect(document.status).toBe("PARTIAL");
    expect(document.sections.map((section) => section.text)).toEqual(["A", "Goal"]);
    // No fragment of the oversized body leaked into the content.
    expect(document.content).not.toContain("x");
    expectOffsetsExact(document);
    expectLayoutExact(document);
    const truncated = document.diagnostics.find((entry) => entry.code === "CONTENT_TRUNCATED")!;
    expect(truncated.message).toContain("budget were dropped");
  });

  it("defeats a stale-offset fast path: DOCX headings are remapped after joining", async () => {
    // The legacy DOCX mapper advanced a cursor by heading + body + separator,
    // producing offsets that are provably wrong once sections are joined.
    setDocxHtmlConverter(async () => ({
      html: "<h1>Title ZZZZZZZZZZ</h1><h2>Goal</h2><p>Ship it with marker DDDDDDDDDDDDDDDDDDDD.</p><h2>Acceptance Criteria</h2><ul><li>AC-1 passes</li></ul>",
      messages: []
    }));
    setDocxConverter(async () => { throw new DocxError("CORRUPT_DOCX", "not used"); });
    try {
      const converted = await extractDocxHtml(buildDocx([{ text: "x" }]));
      const first = converted.paragraphs[0].text;
      const document = await ingestDocument(source("spec.docx", buildDocx([{ text: "x" }])));
      expectOffsetsExact(document);
      expectLayoutExact(document);
      // Sanity: the shifted-stale layout would have pointed the first section at
      // the wrong span; confirm the remapped span is the heading itself.
      const heading = document.sections.find((section) => section.text === first)!;
      expect(document.content.slice(heading.startOffset, heading.endOffset)).toBe(first);
      expect(document.content.slice(heading.startOffset + 3, heading.endOffset + 3)).not.toBe(first);
    } finally {
      setDocxHtmlConverter(undefined);
      setDocxConverter(undefined);
    }
  });

  it("preserves the invariant when a single document repeats a separator-like section", async () => {
    const document = await ingestDocument(source("edges.txt", "A\n\nB\n\nC\n\nD\n\nE\n"));
    expectOffsetsExact(document);
    expectLayoutExact(document);
    // Distinct sections never resolve to the same span.
    const spans = document.sections.map((section) => `${section.startOffset}-${section.endOffset}`);
    expect(new Set(spans).size).toBe(spans.length);
  });
});
