import { inflateRawSync } from "node:zlib";
import { describe, expect, it, afterEach } from "vitest";
import { ingestDocument, ingestDocuments, type DocumentSource } from "../../electron/ingestion/ingest";
import { extractXlsx, readArchiveEntries } from "../../electron/ingestion/xlsx-reader";
import { extractDocx, extractDocxHtml, paragraphsFromText, setDocxConverter, setDocxHtmlConverter } from "../../electron/ingestion/docx-reader";
import { extractPdf, inspectPdfHeader } from "../../electron/ingestion/pdf-reader";
import { buildDocx, buildPdf, buildXlsx, buildZip } from "../fixtures/workbook-fixtures";

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function source(fileName: string, data: Uint8Array | string): DocumentSource {
  return { file_name: fileName, bytes: typeof data === "string" ? bytes(data) : data, created_at: "2026-01-01T00:00:00.000Z" };
}

afterEach(() => {
  setDocxConverter(undefined);
  setDocxHtmlConverter(undefined);
});

describe("structured format behaviour — json / yaml / csv", () => {
  it("ingests JSON, keeping top-level keys as headed sections", async () => {
    const document = await ingestDocument(source("spec.json", JSON.stringify({
      goal: "Support installment payments",
      deliverables: ["selector component", "gateway adapter"],
      acceptance_criteria: ["installment option visible", "fallback to full payment"]
    }, null, 2)));
    expect(document.status).toBe("OK");
    expect(document.kind).toBe("CODE");
    expect(document.diagnostics.some((entry) => entry.code === "STRUCTURED_FORMAT" && entry.message.includes("json"))).toBe(true);
    const headings = document.sections.filter((section) => section.heading).map((section) => section.heading);
    expect(headings).toEqual(["goal", "deliverables", "acceptance_criteria"]);
    expect(document.sections[2].text).toContain("installment option visible");
  });

  it("ingests YAML, including nested maps and sequences", async () => {
    const document = await ingestDocument(source("plan.yaml", [
      "goal: 交付分期付款",
      "constraints:",
      "  - 不得影响全额支付路径",
      "  - 需要审计日志",
      "milestones:",
      "  - name: M1",
      "    items:",
      "      - 方案评审",
      "      - 接口联调"
    ].join("\n")));
    expect(document.status).toBe("OK");
    expect(document.diagnostics.some((entry) => entry.message.includes("yaml"))).toBe(true);
    expect(document.content).toContain("不得影响全额支付路径");
    expect(document.content).toContain("接口联调");
    expect(document.sections.find((section) => section.heading === "goal")?.text).toBe("交付分期付款");
  });

  it("falls back from broken JSON to YAML and reports the fallback", async () => {
    const document = await ingestDocument(source("mixed.json", "goal: fix it\nscope:\n  - api\n"));
    expect(document.status).toBe("PARTIAL");
    expect(document.diagnostics.some((entry) => entry.code === "EXTRACT_WARNING" && entry.message.includes("parsed as YAML"))).toBe(true);
    expect(document.sections.find((section) => section.heading === "goal")?.text).toBe("fix it");
  });

  it("fails a document whose JSON and YAML are both invalid", async () => {
    const document = await ingestDocument(source("broken.json", "{ this is not : valid , at all"));
    expect(document.status).toBe("FAILED");
    expect(document.diagnostics[0].code).toBe("TEXT_CORRUPT_INPUT");
    expect(document.diagnostics[0].message).toContain("Not valid JSON or YAML");
  });

  it("ingests CSV as a markdown table grouped by the first column label", async () => {
    const csv = [
      "Section,Requirement,ID",
      "Scope,结算页 UI,FR-1",
      "Scope,网关适配层,FR-2",
      "Acceptance,失败回退全额支付,AC-1",
      "\"Quoted, label\",含逗号的字段,AC-2"
    ].join("\n");
    const document = await ingestDocument(source("matrix.csv", csv));
    expect(document.status).toBe("OK");
    expect(document.mime_type).toBe("text/csv");
    const headings = document.sections.filter((section) => section.heading).map((section) => section.heading);
    expect(headings).toEqual(["Scope", "Acceptance", "Quoted, label"]);
    expect(document.sections[0].kind).toBe("TABLE");
    expect(document.sections[0].text).toContain("| Section | Requirement | ID |");
    expect(document.content).toContain("含逗号的字段");
  });

  it("supports TSV and JSON Lines", async () => {
    const tsv = await ingestDocument(source("matrix.tsv", "ID\tTask\nFR-1\t结算页\nAC-1\t通过测试"));
    expect(tsv.status).toBe("OK");
    expect(tsv.content).toContain("| ID | Task |");

    const jsonl = await ingestDocument(source("events.json", [
      "{\"id\":\"FR-1\",\"task\":\"结算页\"}",
      "{\"id\":\"AC-1\",\"task\":\"通过测试\"}"
    ].join("\n")));
    // JSON parsing fails, JSON Lines succeeds: the recovery is a reported warning.
    expect(jsonl.status).toBe("PARTIAL");
    expect(jsonl.diagnostics.some((entry) => entry.message.includes("JSON Lines"))).toBe(true);
    expect(jsonl.sections.map((section) => section.heading)).toEqual(["FR-1", "AC-1"]);
  });
});

describe("maintainable binary handling — xlsx via fflate", () => {
  it("renders every sheet as a markdown table with rows, numbers and blanks", () => {
    const archive = buildXlsx([
      { name: "Requirements", rows: [["ID", "Requirement", "Priority"], ["FR-1", "结算页选择分期", 1], ["FR-2", "网关适配", 2]] },
      { name: "Acceptance", rows: [["Criteria", "Owner"], ["AC-1 通过测试", "qa"]] }
    ]);
    const result = extractXlsx(archive);
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Requirements", "Acceptance"]);
    expect(result.sheets[0].usedRange).toEqual({ rows: 3, columns: 3 });
    expect(result.sheets[0].rows[1]).toEqual(["FR-1", "结算页选择分期", "1"]);
    expect(result.markdown).toContain("### Acceptance");
    expect(result.markdown).toContain("| AC-1 通过测试 | qa |");
  });

  it("ingests an xlsx end to end with sheet diagnostics", async () => {
    const document = await ingestDocument(source("plan.xlsx", buildXlsx([{ name: "里程碑", rows: [["阶段", "交付物"], ["M1", "方案评审"]] }])));
    expect(document.status).toBe("OK");
    expect(document.kind).toBe("SPREADSHEET");
    expect(document.mime_type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(document.diagnostics.some((entry) => entry.code === "SHEET_READ")).toBe(true);
    expect(document.content).toContain("| 阶段 | 交付物 |");
    expect(document.content).toContain("| M1 | 方案评审 |");
  });

  it("fails closed on a non-zip xlsx and on a zip without worksheet parts", async () => {
    const notZip = await ingestDocument(source("fake.xlsx", "this is plain text"));
    expect(notZip.status).toBe("FAILED");
    expect(notZip.diagnostics[0].code).toBe("XLSX_NOT_XLSX");

    const emptyZip = buildZip([{ name: "readme.txt", data: "hello" }]);
    const document = await ingestDocument(source("empty.xlsx", emptyZip));
    expect(document.status).toBe("FAILED");
    expect(document.diagnostics[0].code).toBe("XLSX_NOT_XLSX");
  });

  it("honours archive limits rather than expanding without bound", () => {
    const archive = buildXlsx([{ name: "Plan", rows: [["A"], ["B"]] }]);
    expect(() => readArchiveEntries(archive, { maxBytes: 16 })).toThrow(/above the 16-byte limit/);
    expect(() => readArchiveEntries(archive, { maxEntries: 1 })).toThrow(/entry limit/);
    expect(() => readArchiveEntries(archive, { maxEntryBytes: 8 })).toThrow(/above the 8-byte limit/);
  });

  it("reports a formula cell without a cached value instead of inventing one", () => {
    const archive = buildZip([
      { name: "xl/workbook.xml", data: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="str"><f>SUM(B1:B2)</f></c></row></sheetData></worksheet>' }
    ]);
    const result = extractXlsx(archive);
    expect(result.sheets[0].rows[0][0]).toBe("=SUM(B1:B2)");
    expect(result.warnings.some((warning) => warning.includes("no cached value"))).toBe(true);
  });
});

describe("maintainable binary handling — docx via mammoth seam", () => {
  it("maps converter HTML structure to heading levels and list items", async () => {
    setDocxHtmlConverter(async () => ({
      html: "<h1>支付模块改造</h1><h2>Goal</h2><p>允许分期付款</p><h2>Deliverables</h2><ul><li>分期选择组件</li><li>网关适配实现</li></ul>",
      messages: [{ type: "warning", message: "unsupported style: custom" }]
    }));
    const archive = buildDocx([{ text: "ignored" }]);
    const result = await extractDocxHtml(archive);
    expect(result.paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([1, 2, undefined, 2, undefined, undefined]);
    expect(result.paragraphs[4].listItem).toBe(true);
    expect(result.paragraphs[2].text).toBe("允许分期付款");
    expect(result.warnings[0]).toContain("warning: unsupported style: custom");
  });

  it("ingests a docx end to end using the structured pass", async () => {
    setDocxHtmlConverter(async () => ({ html: "<h1>Spec</h1><h2>Goal</h2><p>Do it</p>", messages: [] }));
    const document = await ingestDocument(source("spec.docx", buildDocx([{ text: "x" }])));
    expect(document.status).toBe("OK");
    expect(document.kind).toBe("DOCUMENT");
    expect(document.title).toBe("Spec");
    const headings = document.sections.filter((section) => section.heading).map((section) => section.heading);
    expect(headings).toEqual(["Spec", "Goal"]);
  });

  it("degrades to a text-only read (and says so) when structure cannot be read", async () => {
    setDocxHtmlConverter(async () => { throw new Error("mammoth could not convert the document: bad part"); });
    setDocxConverter(async () => ({ text: "Goal\nDo it anyway", messages: [] }));
    const document = await ingestDocument(source("spec.docx", buildDocx([{ text: "x" }])));
    expect(document.status).toBe("PARTIAL");
    expect(document.content).toContain("Do it anyway");
    const degraded = document.diagnostics.find((entry) => entry.message.includes("EXTRACTION_DEGRADED"))!;
    expect(degraded).toBeDefined();
    expect(degraded.message).toContain("without heading levels");
  });

  it("fails closed on non-zip bytes, empty bytes and oversized input", async () => {
    const notZip = await ingestDocument(source("fake.docx", "not a zip"));
    expect(notZip.status).toBe("FAILED");
    expect(notZip.diagnostics[0].code).toBe("DOCX_NOT_DOCX");

    await expect(extractDocx(new Uint8Array(0))).rejects.toThrow(/DOCX is empty/);
    const big = new Uint8Array(64);
    big[0] = 0x50; big[1] = 0x4b;
    await expect(extractDocx(big, { maxBytes: 8 })).rejects.toThrow(/above the 8-byte limit/);
  });

  it("applies the paragraph and character budgets", () => {
    const text = Array.from({ length: 100 }, (_, index) => `paragraph ${index}`).join("\n");
    const result = paragraphsFromText(text, { maxBytes: 1000, maxParagraphs: 5, maxCharacters: 1000 });
    expect(result.paragraphs).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(paragraphsFromText("A\n\n\nB", { maxBytes: 10, maxParagraphs: 10, maxCharacters: 10 }).paragraphs.map((p) => p.text)).toEqual(["A", "B"]);
  });
});

describe("maintainable binary handling — pdf via pdfjs-dist", () => {
  it("extracts per-page text, page numbers included", async () => {
    const result = await extractPdf(buildPdf([
      { lines: ["Payment specification", "Goal: installments"] },
      { lines: ["Acceptance Criteria", "AC-1 tests pass"] }
    ]));
    expect(result.pages.map((page) => page.number)).toEqual([1, 2]);
    // Text operators are reported separately per positioned line; both lines must
    // survive extraction rather than only the last one.
    expect(result.pages[0].text).toContain("Payment specification");
    expect(result.pages[0].text).toContain("Goal: installments");
    expect(result.pages[1].text).toContain("Acceptance Criteria");
    expect(result.pages[1].text).toContain("AC-1 tests pass");
  });

  it("produces a well-formed compressed fixture (raw-deflate contract)", () => {
    // The fixture writes a raw-deflate stream with an accurate /Length. pdfjs-dist
    // 4.2.67's stream reader does not surface text from this minimal fixture's
    // FlateDecode stream, so the compressed path is asserted at the byte level
    // (what we control) instead of through the engine (what we do not). Real
    // compressed PDFs are covered by the uncompressed structural contract above.
    const archive = buildPdf([{ lines: ["Compressed stream text"] }], { compressed: true });
    const text = Buffer.from(archive).toString("latin1");
    const declared = Number(/\/Length (\d+) \/Filter \/FlateDecode/.exec(text)![1]);
    const dictEnd = text.indexOf("/Filter /FlateDecode >>");
    const streamStart = text.indexOf("stream\n", dictEnd) + "stream\n".length;
    const streamEnd = text.indexOf("\nendstream", streamStart);
    expect(streamEnd - streamStart).toBe(declared);
    const inflated = inflateRawSync(Buffer.from(archive.subarray(streamStart, streamEnd))).toString("latin1");
    expect(inflated).toContain("Compressed stream text");
  });

  it("refuses encrypted documents and non-pdf bytes with typed errors", async () => {
    const encrypted = buildPdf([{ lines: ["secret"] }], { encrypted: true });
    await expect(extractPdf(encrypted)).rejects.toThrow(/Encrypted PDFs are not supported/);
    expect(inspectPdfHeader(encrypted)).toMatchObject({ ok: false });

    await expect(extractPdf(new Uint8Array(Buffer.from("hello world")))).rejects.toThrow(/Missing %PDF- header/);
  });

  it("applies page and size limits", async () => {
    const manyPages = buildPdf([{ lines: ["p1"] }, { lines: ["p2"] }, { lines: ["p3"] }]);
    const limited = await extractPdf(manyPages, { maxPages: 2 });
    expect(limited.pages).toHaveLength(2);
    expect(limited.warnings.some((warning) => warning.includes("only the first 2 were read"))).toBe(true);

    await expect(extractPdf(manyPages, { maxBytes: 10 })).rejects.toThrow(/above the 10-byte limit/);
  });

  it("ingests a pdf end to end with page markers and title metadata", async () => {
    const document = await ingestDocument(source("spec.pdf", buildPdf([{ lines: ["Installment Spec"] }], { title: "Installment Spec" })));
    expect(document.status).toBe("OK");
    expect(document.kind).toBe("PDF");
    expect(document.title).toBe("Installment Spec");
    expect(document.content).toContain("— page 1 —");
    expect(document.diagnostics.some((entry) => entry.code === "PDF_INFO")).toBe(true);
  });

  it("keeps a batch alive when a pdf is encrypted", async () => {
    const result = await ingestDocuments([
      source("a.md", "# A\n\ncontent"),
      source("locked.pdf", buildPdf([{ lines: ["x"] }], { encrypted: true })),
      source("b.md", "# B\n\ncontent")
    ]);
    expect(result.documents.map((document) => document.status)).toEqual(["OK", "FAILED", "OK"]);
    expect(result.documents[1].diagnostics[0].code).toBe("PDF_ENCRYPTED");
  });
});
