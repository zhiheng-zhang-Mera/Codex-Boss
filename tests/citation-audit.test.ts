import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeCitationAudit, type CitationRecord } from "../src/shared/research-citation";
import { assembleManuscript, type ManuscriptOptions } from "../electron/research/manuscript/manuscript-assembler";
import type { ManuscriptPlan } from "../src/shared/research-manuscript";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-caudit-")); dirs.push(dir); return dir; }

function citation(id: string, status: CitationRecord["status"]): CitationRecord {
  return { id, proposedTitle: `Paper ${id}`, status, reasons: [], updatedAt: new Date(0).toISOString() };
}

const plan: ManuscriptPlan = { id: "r1", claimsToSections: { c1: ["results"] } };
const claims = [{ id: "c1", evidenceIds: ["stat:s1"] }];
const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return `draft ${brief.evidenceIds.join(",")}`; } };

describe("citation audit summary (Phase 9/14)", () => {
  it("counts verified citations and flags UNSUPPORTED ones (primary-claim rule)", () => {
    const audit = summarizeCitationAudit([
      citation("a", "CLAIM_SUPPORTED"),
      citation("b", "PASSAGE_VERIFIED"),
      citation("c", "SOURCE_RETRIEVED"),
      citation("d", "UNSUPPORTED"),
      citation("e", "CONTRADICTED")
    ]);
    expect(audit.total).toBe(5);
    expect(audit.verified).toBe(3);
    expect(audit.unsupportedIds).toEqual(["d"]);
    expect(audit.ok).toBe(false);
    expect(summarizeCitationAudit([citation("a", "CLAIM_SUPPORTED"), citation("b", "SOURCE_RETRIEVED")]).ok).toBe(true);
    expect(summarizeCitationAudit([])).toEqual({ total: 0, perStatus: {}, verified: 0, unsupportedIds: [], ok: true });
  });
});

describe("manuscript audit integration for citations", () => {
  const options = (extra: Partial<ManuscriptOptions> = {}): ManuscriptOptions => ({ title: "T", plan, claims, evidenceIds: ["stat:s1"], writer, ...extra });

  it("writes the real citation audit and gates final-audit passed on unsupported citations", async () => {
    const dir = root();
    const output = await assembleManuscript(path.join(dir, "research"), options({ citations: [citation("a", "CLAIM_SUPPORTED"), citation("b", "UNSUPPORTED")] }));
    const citations = JSON.parse(fs.readFileSync(output.audit.citationsFile, "utf8"));
    expect(citations.ok).toBe(false);
    expect(citations.unsupportedIds).toEqual(["b"]);
    expect(citations.verified).toBe(1);
    const final = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(final.citations.ok).toBe(false);
    expect(final.passed).toBe(false); // section REVISED but an UNSUPPORTED citation is bound
  });

  it("keeps the PENDING stub when no citation records are supplied", async () => {
    const dir = root();
    const output = await assembleManuscript(path.join(dir, "research"), options());
    const citations = JSON.parse(fs.readFileSync(output.audit.citationsFile, "utf8"));
    expect(citations.status).toBe("PENDING");
    const final = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(final.citations).toBe("PENDING");
    expect(final.passed).toBe(true);
  });
});
