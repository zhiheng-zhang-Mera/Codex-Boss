import { describe, expect, it } from "vitest";
import { redactSecrets, scanSecrets } from "../../src/shared/secret-scan";
import { compileTaskContract } from "../../src/shared/task-contract";
import {
  DeterministicContextBuilder,
  DeterministicKnowledgeIntake,
  DeterministicValidator,
  DocumentProvenanceIndex,
  InMemoryKnowledgeStore,
  LexicalRetrieval,
  hasRedactionMarker,
  knowledgeItemFrom
} from "../../src/shared/workbook-knowledge";
import { buildDocx, buildPdf, buildXlsx } from "../fixtures/workbook-fixtures";
import { ingestDocument, type DocumentSource } from "../../electron/ingestion/ingest";
import { ingressFromText } from "../helpers/workbook-test-helpers";

/** Every distinct secret shape the scanner knows, planted in one document. */
const SECRET_FIXTURE = [
  "# 部署说明",
  "",
  "## Credentials",
  "",
  `OPENAI_API_KEY=sk-proj-${"A1b2C3d4E5f6G7h8I9j0K1l2"}`,
  `GITHUB_TOKEN=ghp_${"0123456789abcdefghijklmnopqrstuvwxyz"}`,
  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
  ["Authorization", ": ", "Bearer ", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"].join(""),
  "database_password: hunter2hunter2hunter2",
  "token: 0123456789abcdefghijklmnopqrstuvwxyz",  "",
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz",
  "-----END RSA PRIVATE KEY-----",
  "",
  "## Goal",
  "部署分期付款服务。",
  "",
  "## Acceptance Criteria",
  "- [ ] 密钥不出现在任何日志中"
].join("\n");

function source(fileName: string, text: string): DocumentSource {
  return { file_name: fileName, bytes: new Uint8Array(Buffer.from(text, "utf8")), created_at: "2026-01-01T00:00:00.000Z" };
}

describe("deterministic secret redaction before any provider context", () => {
  it("redacts every secret shape in the ingested document and its sections", async () => {
    const document = await ingestDocument(source("deploy.md", SECRET_FIXTURE));

    // The scanner found several shapes, and all of them were replaced.
    const shapes = document.redactions.map((entry) => entry.shape);
    expect(shapes).toContain("api-key-sk");
    expect(shapes).toContain("github-token");
    expect(shapes).toContain("aws-access-key");
    expect(shapes).toContain("bearer-token");
    expect(shapes).toContain("jwt");
    expect(shapes).toContain("generic-long-token");
    expect(shapes).toContain("private-key");

    // No raw secret survives anywhere in the canonical document.
    expect(document.content).not.toContain("sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2");
    expect(document.content).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(document.content).not.toContain("MIIEowIBAAKCAQEA1234567890");
    expect(document.content).toContain("[REDACTED:");
    for (const section of document.sections) {
      expect(scanSecrets(section.text)).toEqual([]);
    }
    expect(hasRedactionMarker(document.content)).toBe(true);

    // Redaction is deterministic and idempotent.
    expect(redactSecrets(document.content)).toBe(document.content);
  });

  it("redacts secrets inside a WorkBook before they reach the contract", async () => {
    const document = await ingestDocument(source("deploy.md", SECRET_FIXTURE));
    const contract = compileTaskContract({
      documents: [document],
      userText: "请分析，API key 是 sk-proj-ZZZZZZZZZZZZZZZZZZZZ"
    });
    const serialized = JSON.stringify(contract);
    expect(serialized).not.toContain("sk-proj-ZZZZZZZZZZZZZZZZZZZZ");
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialized).not.toContain("sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2");
    // The override text itself is redacted, not dropped.
    expect(contract.overrides[0].text).toContain("[REDACTED:api-key]");
  });

  it("redacts secrets in binary documents too", async () => {
    const withSecret = `sk-proj-${"S".repeat(24)}`;
    const xlsx = await ingestDocument({ file_name: "plan.xlsx", bytes: buildXlsx([{ name: "Keys", rows: [["key"], [withSecret]] }]) });
    expect(xlsx.redactions.map((entry) => entry.shape)).toContain("api-key-sk");
    expect(xlsx.content).not.toContain(withSecret);

    const pdf = await ingestDocument({ file_name: "doc.pdf", bytes: buildPdf([{ lines: [`token: ${withSecret}`] }]) });
    expect(pdf.content).not.toContain(withSecret);
    expect(pdf.redactions.length).toBeGreaterThan(0);
  });

  it("is pure: the scanner never mutates its input", () => {
    const input = SECRET_FIXTURE;
    const before = String(input);
    redactSecrets(input);
    expect(String(input)).toBe(before);
  });
});

describe("knowledge governance seams (intake / store / retrieval / context / provenance / validation)", () => {
  it("validates, stores, retrieves and builds context with provenance", async () => {
    const document = await ingressFromText("spec.md", [
      "# 支付模块改造",
      "",
      "## Goal",
      "允许用户在结算页选择分期付款。",
      "",
      "## Acceptance Criteria",
      "- [ ] 分期选项可见"
    ].join("\n"));

    const validator = new DeterministicValidator();
    const validation = validator.validate([document]);
    expect(validation.ok).toBe(true);
    expect(validation.diagnostics).toEqual([]);

    const intake = new DeterministicKnowledgeIntake(validator);
    const record = await intake.intake({ documents: [document], conversationId: "conv-1", rules: { failClosed: true } });
    expect(record.rejected).toEqual([]);
    expect(record.ids).toEqual([`kb-${document.hash.slice(0, 16)}`]);

    const store = new InMemoryKnowledgeStore();
    const item = knowledgeItemFrom(document, "conv-1", "D:/work");
    await store.put([item]);
    expect((await store.get(item.id))?.title).toBe(document.title);
    expect((await store.list({ conversationId: "conv-1" })).length).toBe(1);
    expect(await store.delete(item.id)).toBe(true);
    expect(await store.get(item.id)).toBeUndefined();
    await store.put([item]);

    const retrieval = new LexicalRetrieval();
    const found = retrieval.search({ text: "分期付款", conversationId: "conv-1", maxCharacters: 10000 }, await store.list());
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits[0].matchedTerms.length).toBeGreaterThan(0);
    const empty = retrieval.search({ text: "分期付款", maxCharacters: 1 }, await store.list());
    expect(empty.truncated).toBe(true);
    expect(empty.hits).toEqual([]);

    const provenance = new DocumentProvenanceIndex([document], { [document.id]: 2 });
    expect(provenance.forDocument(document.id)[0].revision).toBe(2);
    expect(provenance.forRecord(provenance.forDocument(document.id)[0].record_id)).toBeDefined();

    const builder = new DeterministicContextBuilder(provenance);
    const context = builder.build({ purpose: "PLANNING", goal: "分期付款", documents: [document], characterBudget: 100000 });
    expect(context.purpose).toBe("PLANNING");
    expect(context.chunks.length).toBeGreaterThan(0);
    expect(context.provenance[0].canonical_document_id).toBe(document.id);
    expect(context.chunks.every((chunk) => document.sections.some((section) => section.id === chunk.section_ids[0]))).toBe(true);
    expect(context.truncated).toBe(false);

    const tiny = builder.build({ purpose: "ANSWER", goal: "x", documents: [document], characterBudget: 5 });
    expect(tiny.truncated).toBe(true);
  });

  it("fails closed in intake when a document fails validation", async () => {
    const document = await ingressFromText("empty.md", "");
    // An empty document cannot be ingested at all; simulate a tainted one.
    const tainted = { ...document };
    const validator = new DeterministicValidator(["NON_EMPTY", "HAS_SECTIONS", "NO_SECRETS", "HASH_PRESENT", "CLASSIFIABLE", "PROVENANCE_COMPLETE"]);
    const validation = validator.validate([tainted]);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map((entry) => entry.rule)).toContain("NON_EMPTY");

    const intake = new DeterministicKnowledgeIntake(validator);
    const rejected = await intake.intake({ documents: [tainted], conversationId: "c", rules: { failClosed: true } });
    expect(rejected.accepted).toEqual([]);
    expect(rejected.rejected[0].reasons.length).toBeGreaterThan(0);

    const lenient = await intake.intake({ documents: [tainted], conversationId: "c", rules: { failClosed: false } });
    expect(lenient.accepted).toHaveLength(1);
  });

  it("flags a document whose sections still carry secret-shaped text", async () => {
    const document = await ingressFromText("spec.md", "# Spec\n\n## Goal\n\nDeploy the service.\n");
    const tainted = {
      ...document,
      sections: document.sections.map((section) => ({ ...section, text: `token: ${"ghp_"}${"a".repeat(24)}` }))
    };
    const validation = new DeterministicValidator(["NO_SECRETS"]).validate([tainted]);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostics[0].rule).toBe("NO_SECRETS");
    expect(validation.diagnostics[0].message).toContain("still contains secret-shaped text");
  });
});
