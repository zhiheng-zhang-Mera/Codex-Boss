import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { primaryClaimSupported, validateCitationRecord, verifyCitation, type CitationRecord } from "../src/shared/research-citation";
import { CitationSourceStore } from "../electron/research/literature/source-store";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-citation-")); dirs.push(dir); return dir; }

function citation(overrides: Partial<CitationRecord> = {}): CitationRecord {
  return { id: "c1", proposedTitle: "A paper", status: "UNSUPPORTED", reasons: [], updatedAt: new Date(0).toISOString(), ...overrides };
}

describe("citation verification ladder (Phase 9)", () => {
  it("verifies a citation only through acquired source → passage → support", () => {
    expect(verifyCitation({ sourceAcquired: false, metadataVerified: false, passageLocated: false, passageSupports: false })).toBe("UNSUPPORTED");
    expect(verifyCitation({ sourceAcquired: false, metadataVerified: true, passageLocated: false, passageSupports: false })).toBe("METADATA_ONLY");
    expect(verifyCitation({ sourceAcquired: true, metadataVerified: true, passageLocated: false, passageSupports: false })).toBe("SOURCE_RETRIEVED");
    expect(verifyCitation({ sourceAcquired: true, metadataVerified: true, passageLocated: true, passageSupports: false })).toBe("PASSAGE_VERIFIED");
    expect(verifyCitation({ sourceAcquired: true, metadataVerified: true, passageLocated: true, passageSupports: true })).toBe("CLAIM_SUPPORTED");
    expect(verifyCitation({ sourceAcquired: true, metadataVerified: true, passageLocated: true, passageSupports: true, passageContradicts: true })).toBe("CONTRADICTED");
  });

  it("blocks primary claims from binding UNSUPPORTED citations and validates records", () => {
    const unsupported = primaryClaimSupported([citation({ id: "x" }), citation({ id: "y", status: "CLAIM_SUPPORTED" })]);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.unsupported).toEqual(["x"]);
    expect(primaryClaimSupported([citation({ id: "y", status: "CLAIM_SUPPORTED" })]).ok).toBe(true);
    expect(() => validateCitationRecord(citation({ proposedTitle: "" }))).toThrow();
    expect(() => validateCitationRecord(citation({ status: "FAKE" as never }))).toThrow();
    expect(() => validateCitationRecord(citation({ id: "" }))).toThrow();
  });
});

describe("citation source store (Phase 9)", () => {
  it("persists ladder progress and caches acquired sources content-addressed", () => {
    const dir = root();
    const store = new CitationSourceStore(dir);
    store.put(citation());
    expect(store.verify("c1", { sourceAcquired: true, metadataVerified: true, passageLocated: true, passageSupports: true, passages: [{ quote: "…supports…" }] })).toBe("CLAIM_SUPPORTED");
    const saved = store.saveSource("https://example.test/paper.pdf", "paper text");
    expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.loadSource("https://example.test/paper.pdf")?.text).toBe("paper text");
    // Reload keeps verified status + source cache.
    const reloaded = new CitationSourceStore(dir);
    expect(reloaded.list()[0].status).toBe("CLAIM_SUPPORTED");
    expect(reloaded.loadSource("https://example.test/paper.pdf")?.contentHash).toBe(saved.contentHash);
  });

  it("derives sourceAcquired from its own cache (round 30): cached source reaches SOURCE_RETRIEVED", () => {
    const dir = root();
    const store = new CitationSourceStore(dir);
    store.put(citation({ id: "c2", sourceRef: "https://example.test/a.pdf" }));
    store.put(citation({ id: "c3", sourceRef: "https://example.test/absent.pdf" }));
    store.saveSource("https://example.test/a.pdf", "real source text");
    // Cached source + metadata verified → at least SOURCE_RETRIEVED.
    expect(store.verifySource("c2", { metadataVerified: true })).toBe("SOURCE_RETRIEVED");
    expect(store.verifySource("c2", { metadataVerified: true, passageLocated: true, passageSupports: true })).toBe("CLAIM_SUPPORTED");
    // No cached source → cannot advance past METADATA_ONLY (never fabricate acquisition).
    expect(store.verifySource("c3", { metadataVerified: true })).toBe("METADATA_ONLY");
    expect(store.list().find((item) => item.id === "c2")?.status).toBe("CLAIM_SUPPORTED");
  });

  it("fails closed on corrupt store and unknown citation verify", () => {
    const dir = root();
    const store = new CitationSourceStore(dir);
    expect(() => store.verify("ghost", { sourceAcquired: true, metadataVerified: true, passageLocated: true, passageSupports: true })).toThrow(/Unknown/);
    fs.writeFileSync(path.join(dir, "citations.json"), JSON.stringify({ schemaVersion: 9 }));
    expect(() => new CitationSourceStore(dir)).toThrow();
  });
});
