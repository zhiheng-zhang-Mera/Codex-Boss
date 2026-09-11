import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingestDocument, ingestDocuments, type DocumentSource } from "../../electron/ingestion/ingest";

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function source(fileName: string, text: string): DocumentSource {
  return { file_name: fileName, bytes: bytes(text), source_type: "UPLOAD", created_at: "2026-01-01T00:00:00.000Z" };
}

const MARKDOWN_SPEC = [
  "# 支付模块改造",
  "",
  "## Goal",
  "",
  "允许用户在结算页选择分期付款。",
  "",
  "## Scope",
  "",
  "- 结算页 UI",
  "- 支付网关适配层",
  "",
  "## Deliverables",
  "",
  "- 分期选择组件",
  "- 网关适配实现",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] 分期选项在结算页可见",
  "- [ ] 网关失败时回退到全额支付",
  "",
  "```ts",
  "export const installments = [3, 6, 12];",
  "```"
].join("\n");

describe("WorkBook ingestion — native types", () => {
  it("parses markdown into ordered, offset-mapped sections", async () => {
    const document = await ingestDocument(source("spec.md", MARKDOWN_SPEC));
    expect(document.status).toBe("OK");
    expect(document.title).toBe("支付模块改造");
    expect(document.kind).toBe("TEXT");
    expect(document.mime_type).toBe("text/markdown");
    expect(document.language).toBe("mixed");

    const headings = document.sections.filter((section) => section.heading).map((section) => section.heading);
    expect(headings).toContain("Goal");
    expect(headings).toContain("Scope");
    expect(headings).toContain("Acceptance Criteria");

    const goalIndex = document.sections.findIndex((section) => section.heading === "Goal")!;
    const goal = document.sections[goalIndex];
    expect(goal.level).toBe(2);
    expect(goal.text).toBe("Goal");
    // The heading is its own section; its body is the following section.
    expect(document.sections[goalIndex + 1].text).toContain("分期付款");

    // Code fences are one section and never split internally.
    const code = document.sections.find((section) => section.kind === "CODE")!;
    expect(code.text).toContain("installments = [3, 6, 12]");
    expect(code.text.trim().split("\n")).toHaveLength(3);

    // Offsets must map back onto the canonical content exactly.
    for (const section of document.sections) {
      expect(section.startOffset).toBeLessThanOrEqual(section.endOffset);
      expect(document.content.slice(section.startOffset, section.endOffset)).toBe(section.text);
    }
    // Section order is stable and contiguous.
    expect(document.sections.map((section) => section.order)).toEqual(document.sections.map((_, index) => index + 1));
  });

  it("is deterministic: identical bytes produce an identical canonical document", async () => {
    const first = await ingestDocument(source("spec.md", MARKDOWN_SPEC));
    const second = await ingestDocument(source("spec.md", MARKDOWN_SPEC));
    expect(second.hash).toBe(first.hash);
    expect(second.sections.map((section) => section.hash)).toEqual(first.sections.map((section) => section.hash));
    expect(second.content).toBe(first.content);
  });

  it("parses plain text with Chinese numbered headings", async () => {
    const document = await ingestDocument(source("notes.txt", [
      "一、目标",
      "把日报自动化。",
      "",
      "二、验收标准",
      "1. 每天 9 点生成",
      "2. 邮件送达"
    ].join("\n")));
    expect(document.status).toBe("OK");
    expect(document.kind).toBe("TEXT");
    expect(document.language).toBe("zh");
    expect(document.sections.filter((section) => section.heading).map((section) => section.heading)).toEqual(["一、目标", "二、验收标准"]);
  });

  it("reads a file from disk and fails closed when the path is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wb-ingest-"));
    const file = path.join(directory, "plan.md");
    fs.writeFileSync(file, "# Disk Plan\n\nDo the thing.\n", "utf8");
    const fromDisk = await ingestDocument({ file_name: "plan.md", path: file, source_type: "LOCAL_PATH" });
    expect(fromDisk.status).toBe("OK");
    expect(fromDisk.title).toBe("Disk Plan");

    const missing = await ingestDocument({ file_name: "gone.md", path: path.join(directory, "gone.md") });
    expect(missing.status).toBe("FAILED");
    expect(missing.diagnostics.map((entry) => entry.code)).toEqual(["SOURCE_UNREADABLE"]);
  });

  it("fails closed for an unsupported type, an empty file and an oversized file", async () => {
    const unsupported = await ingestDocument(source("archive.zip", "PK"));
    expect(unsupported.status).toBe("FAILED");
    expect(unsupported.diagnostics[0].code).toBe("UNSUPPORTED_TYPE");
    expect(unsupported.content).toBe("");

    const empty = await ingestDocument({ file_name: "empty.md", bytes: new Uint8Array(0) });
    expect(empty.status).toBe("FAILED");
    expect(empty.diagnostics[0].code).toBe("SOURCE_EMPTY");

    const oversized = await ingestDocument(source("big.md", "x".repeat(100)), { limits: { maxBytes: 10 } });
    expect(oversized.status).toBe("FAILED");
    expect(oversized.diagnostics[0].code).toBe("SIZE_LIMIT");

    const noBytes = await ingestDocument({ file_name: "nothing.md" });
    expect(noBytes.status).toBe("FAILED");
    expect(noBytes.diagnostics[0].code).toBe("SOURCE_EMPTY");
  });

  it("decodes UTF-16 and GBK text instead of failing", async () => {
    const utf16 = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# 目标\n\n实现分期付款。\n", "utf16le")]));
    const utf16Document = await ingestDocument({ file_name: "utf16.md", bytes: utf16 });
    expect(utf16Document.status).toBe("OK");
    expect(utf16Document.content).toContain("实现分期付款");
    expect(utf16Document.language).toBe("zh");

    const gbk = new Uint8Array(Buffer.from([0xc4, 0xbf, 0xb1, 0xea, 0x3a, 0x20, 0x61, 0x62, 0x63, 0x0a, 0x64, 0x65, 0x66]));
    const gbkDocument = await ingestDocument({ file_name: "gbk.txt", bytes: gbk });
    expect(gbkDocument.status).toBe("PARTIAL");
    expect(gbkDocument.content).toContain("目标");
    expect(gbkDocument.diagnostics.some((entry) => entry.message.includes("GBK"))).toBe(true);
  });

  it("keeps a batch alive when one document is corrupt", async () => {
    const result = await ingestDocuments([
      source("good.md", "# Good\n\n内容。"),
      source("broken.pdf", "not a pdf at all"),
      source("bad.bin", "junk"),
      source("good2.txt", "验收标准\n通过测试")
    ]);
    expect(result.documents).toHaveLength(4);
    const statuses = result.documents.map((document) => `${document.file_name}:${document.status}`);
    expect(statuses).toEqual(["good.md:OK", "broken.pdf:FAILED", "bad.bin:FAILED", "good2.txt:OK"]);
    expect(result.documents[1].diagnostics[0].code).toBe("PDF_NOT_PDF");
    expect(result.documents[1].hash).toMatch(/^[0-9a-f]{64}$/);
    // Batch diagnostics carry the owning document id.
    const brokenEntry = result.diagnostics.find((entry) => entry.code === "PDF_NOT_PDF")!;
    expect(brokenEntry.documentId).toBe(result.documents[1].id);
  });
});
