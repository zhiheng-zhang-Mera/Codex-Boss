import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, writeJson, validId } from "../../commander/durable-json";
import { verifyCitation, type CitationRecord, type CitationStatus } from "../../../src/shared/research-citation";

/**
 * Citation source store (plan 9-6 Phase 9). Durable per-research citation
 * records + source text cache (hashed), so the verification ladder can be
 * re-run after a restart and each citation keeps its exact evidence state.
 */

export interface CitationSource {
  ref: string;
  contentHash: string;
  text: string;
  fetchedAt: string;
}

export interface CitationFile {
  schemaVersion: 1;
  citations: CitationRecord[];
}

export class CitationSourceStore {
  private readonly citations: Map<string, CitationRecord> = new Map();

  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.restore();
  }

  put(record: CitationRecord): void {
    this.citations.set(record.id, structuredClone(record));
    this.persist();
  }

  /** Advances one citation through the verification ladder given observed evidence. */
  verify(id: string, evidence: { sourceAcquired: boolean; metadataVerified: boolean; passageLocated: boolean; passageSupports: boolean; passageContradicts?: boolean; passages?: Array<{ quote: string; page?: string }> }): CitationStatus {
    const record = this.require(id);
    const status = verifyCitation(evidence);
    const next: CitationRecord = { ...record, status, reasons: statusReason(status), ...(evidence.passages ? { passages: evidence.passages } : {}), updatedAt: new Date().toISOString() };
    this.put(next);
    return status;
  }

  /**
   * Verifies a citation where `sourceAcquired` is derived from this store's own
   * content-addressed cache (round 30): if the record's sourceRef was saved via
   * saveSource(), the ladder advances past UNSUPPORTED to at least
   * SOURCE_RETRIEVED deterministically. Metadata/passage flags are still caller
   * evidence — a cached file alone never fabricates claim support.
   */
  verifySource(id: string, evidence: { metadataVerified: boolean; passageLocated?: boolean; passageSupports?: boolean; passageContradicts?: boolean; passages?: Array<{ quote: string; page?: string }> }): CitationStatus {
    const record = this.require(id);
    const sourceAcquired = !!record.sourceRef && !!this.loadSource(record.sourceRef);
    return this.verify(id, { sourceAcquired, metadataVerified: evidence.metadataVerified, passageLocated: evidence.passageLocated ?? false, passageSupports: evidence.passageSupports ?? false, passageContradicts: evidence.passageContradicts ?? false, passages: evidence.passages });
  }

  /** Caches an acquired source by its ref (content-addressed). */
  saveSource(ref: string, text: string): CitationSource {
    const source: CitationSource = { ref, text: text.slice(0, 200000), contentHash: createHash("sha256").update(text, "utf8").digest("hex"), fetchedAt: new Date().toISOString() };
    writeJson(this.sourcePath(ref), source);
    return source;
  }

  loadSource(ref: string): CitationSource | undefined {
    return readJson<CitationSource>(this.sourcePath(ref));
  }

  list(): CitationRecord[] { return [...this.citations.values()].map((item) => structuredClone(item)); }

  statuses(): CitationStatus[] { return [...this.citations.values()].map((item) => item.status); }

  private require(id: string): CitationRecord {
    const record = this.citations.get(id);
    if (!record) throw new Error(`Unknown citation: ${id}`);
    return record;
  }

  private restore(): void {
    const file = this.filePath();
    const value = readJson<Partial<CitationFile>>(file);
    if (!value) return;
    if (value.schemaVersion !== 1 || !Array.isArray(value.citations)) throw new Error("Invalid citation store");
    for (const record of value.citations) this.citations.set(record.id, record);
  }

  private persist(): void {
    writeJson(this.filePath(), { schemaVersion: 1, citations: [...this.citations.values()] } satisfies CitationFile);
  }

  private filePath(): string { return path.join(this.root, "citations.json"); }
  private sourcePath(ref: string): string { return path.join(this.root, `source-${validId(createHash("sha256").update(ref, "utf8").digest("hex").slice(0, 24))}.json`); }
}

function statusReason(status: CitationStatus): string[] {
  return [{ status: "UNSUPPORTED", reason: "suggested only; no source or metadata verified" }, { status: "METADATA_ONLY", reason: "bibliographic metadata verified" }, { status: "SOURCE_RETRIEVED", reason: "full source acquired" }, { status: "PASSAGE_VERIFIED", reason: "relevant passage located" }, { status: "CLAIM_SUPPORTED", reason: "passage supports the claim" }, { status: "PARTIAL", reason: "partial support with caveats" }, { status: "CONTRADICTED", reason: "source contradicts the claim" }].filter((item) => item.status === status).map((item) => item.reason);
}
