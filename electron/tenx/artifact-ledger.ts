import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import type { ArtifactRecordVNext, ArtifactType } from "../../src/shared/tenx/artifact";

/**
 * 10K: artifact/memory architecture (forward, durable).
 *
 * Append-oriented artifact ledger with real SHA-256 integrity. A later failure
 * never erases an earlier successful artifact: each record is appended and the
 * ledger keeps failure records, checkpoints and decision provenance. Failed
 * runs are preserved (never pruned by success). Artifacts carry runId/taskId/
 * nodeId/provenance so knowledge can trace back to its source artifact.
 *
 * Blob bytes are stored under <root>/<artifactId>.json (utf8 text payloads by
 * default; binary callers should pre-hash and store the blob themselves). The
 * ledger holds the integrity hash so tampering is detectable on read.
 */

export interface TenxArtifactFile {
  schemaVersion: 1;
  records: ArtifactRecordVNext[];
}

export interface ArtifactWriteInput {
  type: ArtifactType;
  runId: string;
  taskId?: string;
  nodeId: string;
  source: string;
  provenance: string;
  content: string;
  stage?: ArtifactRecordVNext["stage"];
  checkpointRef?: string;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class TenxArtifactLedger {
  private readonly records: ArtifactRecordVNext[] = [];

  constructor(
    private readonly rootDir?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Append an artifact; never deletes or rewrites prior records. */
  write(input: ArtifactWriteInput): ArtifactRecordVNext {
    const artifactId = `art-${randomUUID()}`;
    const digest = sha256(input.content);
    const record: ArtifactRecordVNext = {
      artifactId,
      type: input.type,
      runId: input.runId,
      taskId: input.taskId,
      nodeId: input.nodeId,
      createdAt: this.now(),
      sha256: digest,
      version: this.nextVersion(input.runId),
      source: input.source,
      provenance: input.provenance,
      stage: input.stage ?? "RAW",
      status: "ACTIVE",
      checkpointRef: input.checkpointRef
    };
    this.records.push(record);
    if (this.rootDir) {
      fs.mkdirSync(this.rootDir, { recursive: true });
      fs.writeFileSync(path.join(this.rootDir, `${artifactId}.json`), input.content, "utf8");
    }
    this.persist();
    return structuredClone(record);
  }

  /** Record a failure artifact for a run — failed runs must be preserved. */
  recordFailure(runId: string, taskId: string | undefined, nodeId: string, reason: string): ArtifactRecordVNext {
    return this.write({ type: "failure-record", runId, taskId, nodeId, source: "run", provenance: `failure:${reason}`, content: JSON.stringify({ runId, taskId, reason, at: this.now() }) });
  }

  /** Verify an artifact's recorded sha256 against its stored content. */
  verify(record: Pick<ArtifactRecordVNext, "artifactId" | "sha256">): { ok: boolean; reason: string } {
    if (!this.rootDir) return { ok: true, reason: "in-memory ledger (no blob to verify)" };
    const file = path.join(this.rootDir, `${record.artifactId}.json`);
    if (!fs.existsSync(file)) return { ok: false, reason: `blob missing for ${record.artifactId}` };
    const actual = sha256(fs.readFileSync(file, "utf8"));
    return actual === record.sha256 ? { ok: true, reason: "integrity ok" } : { ok: false, reason: "sha256 mismatch (tamper/corruption)" };
  }

  list(runId?: string): ArtifactRecordVNext[] {
    const filtered = runId ? this.records.filter((record) => record.runId === runId) : this.records;
    return filtered.map((record) => structuredClone(record)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** All artifacts traceable to a knowledge source (knowledge → artifact traceability). */
  bySourceArtifact(knowledgeArtifactRef: string): ArtifactRecordVNext[] {
    return this.records
      .filter((record) => record.artifactId === knowledgeArtifactRef || record.provenance.includes(knowledgeArtifactRef))
      .map((record) => structuredClone(record));
  }

  private nextVersion(runId: string): number {
    return this.records.filter((record) => record.runId === runId).length + 1;
  }

  private restore(): void {
    if (!this.rootDir) return;
    const file = path.join(this.rootDir, "ledger.json");
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TenxArtifactFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid tenx artifact ledger");
    this.records.push(...parsed.records);
  }

  private persist(): void {
    if (!this.rootDir) return;
    const file: TenxArtifactFile = { schemaVersion: 1, records: this.records };
    writeJson(path.join(this.rootDir, "ledger.json"), file);
  }
}
