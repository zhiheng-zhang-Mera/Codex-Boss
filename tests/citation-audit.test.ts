import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeCitationAudit, type CitationRecord } from "../src/shared/research-citation";
import { referencesBib, bibliographyEntries } from "../src/shared/research-bibliography";
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
  it("counts verified citations and flags UNSUPPORTED + CONTRADICTED ones (primary-claim rule)", () => {
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
    expect(audit.contradictedIds).toEqual(["e"]);
    expect(audit.ok).toBe(false);
    expect(summarizeCitationAudit([citation("a", "CLAIM_SUPPORTED"), citation("b", "SOURCE_RETRIEVED")]).ok).toBe(true);
    // A CONTRADICTED source must never back a primary claim either.
    expect(summarizeCitationAudit([citation("a", "CONTRADICTED")]).ok).toBe(false);
    expect(summarizeCitationAudit([])).toEqual({ total: 0, perStatus: {}, verified: 0, unsupportedIds: [], contradictedIds: [], ok: true });
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

  it("fails the final audit when a citation contradicts the claim", async () => {
    const dir = root();
    const output = await assembleManuscript(path.join(dir, "research"), options({ citations: [citation("a", "CONTRADICTED")] }));
    const citations = JSON.parse(fs.readFileSync(output.audit.citationsFile, "utf8"));
    expect(citations.contradictedIds).toEqual(["a"]);
    expect(citations.ok).toBe(false);
    const final = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(final.citations.contradicted).toEqual(["a"]);
    expect(final.passed).toBe(false);
  });
});

describe("bibliography from verified citations (round 20)", () => {
  it("emits bib entries only for verified non-contradicting records", () => {
    const verified: CitationRecord = { id: "doi:10.1000/xyz", proposedTitle: "A {Study} of Systems", proposedAuthors: ["Ada Lovelace", "Grace Hopper"], proposedVenue: "ICSE", sourceRef: "https://doi.org/10.1000/xyz", status: "CLAIM_SUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() };
    const entries = bibliographyEntries([verified, citation("unsup", "UNSUPPORTED"), citation("contra", "CONTRADICTED"), citation("meta", "METADATA_ONLY")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("@misc{doi:10-1000-xyz");
    expect(entries[0]).toContain("Ada Lovelace and Grace Hopper");
    expect(entries[0]).toContain("{A \\{Study\\} of Systems}");
    expect(entries[0]).toContain("https://doi.org/10.1000/xyz");
  });

  it("writes verified references into manuscript references.bib, stub without records", async () => {
    const dir = root();
    const verified: CitationRecord = { id: "cite:a", proposedTitle: "Verified paper", proposedAuthors: ["Author A"], proposedVenue: "VENUE", sourceRef: "https://x.test/a", status: "CLAIM_SUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() };
    const bib = referencesBib([verified]);
    expect(bib).toContain("@misc{cite:a");
    expect(bib).toContain("% References generated deterministically");

    const manuscriptOptions = (records?: CitationRecord[]) => ({ title: "T", plan, claims, evidenceIds: ["stat:s1"], writer, citations: records });
    const withRecords = await assembleManuscript(path.join(dir, "research"), manuscriptOptions([verified]));
    const written = fs.readFileSync(path.join(dir, "research", "r1", "manuscript", "references.bib"), "utf8");
    expect(written).toContain("@misc{cite:a");

    const without = await assembleManuscript(path.join(dir, "research"), manuscriptOptions());
    const stub = fs.readFileSync(path.join(dir, "research", "r1", "manuscript", "references.bib"), "utf8");
    expect(stub).toContain("% References for T");
  });
});
