import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import type { KnowledgeRecordVNext, KnowledgeScope } from "../../src/shared/tenx/knowledge";

/**
 * 10G: shared knowledge space vNext (forward, durable).
 *
 * One user → one Global Knowledge Space. Every node contributes to this same
 * space — node-local storage is only a cache/fallback (10J), never a separate
 * long-term personality. Records are provenance-rich (createdByNode,
 * artifactRef, confidence, scope, validity, version, state) and versioned:
 * updates never silently overwrite — a new version is appended and the
 * previous ACTIVE record becomes SUPERSEDED (10I consumes these states).
 *
 * The pipeline (10H), dedup/conflict (10I) and fallback/sync (10J) layers sit
 * on top of this store; this module owns durable storage + retrieval only.
 */

export interface TenxKnowledgeSpaceFile {
  schemaVersion: 1;
  /** All versions of all knowledgeIds (ACTIVE + SUPERSEDED). */
  records: KnowledgeRecordVNext[];
}

export interface KnowledgePutInput {
  content: string;
  source: string;
  createdByNode: string;
  artifactRef?: string;
  scope?: KnowledgeScope;
  validity?: KnowledgeRecordVNext["validity"];
  confidence?: number;
  provenanceChain?: string[];
  knowledgeId?: string;
  createdAt?: string;
}

export function knowledgeContentId(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 32);
}

export class TenxKnowledgeSpace {
  /** knowledgeId → every version, ascending by version. */
  private readonly versions = new Map<string, KnowledgeRecordVNext[]>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Add the first version of a knowledge record. */
  contribute(input: KnowledgePutInput): KnowledgeRecordVNext {
    const createdAt = input.createdAt ?? this.now();
    const existing = this.versions.get(input.knowledgeId ?? "");
    if (existing?.length) return structuredClone(existing[existing.length - 1]); // id already known → use supersede instead
    const knowledgeId = input.knowledgeId ?? `k-${knowledgeContentId(input.content)}`;
    const record: KnowledgeRecordVNext = {
      knowledgeId,
      content: input.content,
      source: input.source,
      artifactRef: input.artifactRef,
      createdByNode: input.createdByNode,
      createdAt,
      updatedAt: createdAt,
      confidence: input.confidence ?? 0,
      scope: input.scope ?? "global",
      validity: input.validity ?? {},
      version: 1,
      provenance: { chain: [...(input.provenanceChain ?? []), `artifact:${input.artifactRef ?? "none"}`] },
      state: "ACTIVE"
    };
    this.versions.set(knowledgeId, [record]);
    this.persist();
    return structuredClone(record);
  }

  /** Versioned update: previous ACTIVE → SUPERSEDED, new version appended. */
  supersede(knowledgeId: string, input: Omit<KnowledgePutInput, "knowledgeId">): KnowledgeRecordVNext | undefined {
    const chain = this.versions.get(knowledgeId) ?? [];
    const active = [...chain].reverse().find((record) => record.state === "ACTIVE");
    if (!active) return this.contribute({ ...input, knowledgeId });
    const now = this.now();
    const superseded: KnowledgeRecordVNext = { ...active, state: "SUPERSEDED", updatedAt: now };
    const next: KnowledgeRecordVNext = {
      knowledgeId,
      content: input.content,
      source: input.source,
      artifactRef: input.artifactRef ?? active.artifactRef,
      createdByNode: active.createdByNode,
      createdAt: active.createdAt,
      updatedAt: now,
      confidence: input.confidence ?? active.confidence,
      scope: input.scope ?? active.scope,
      validity: input.validity ?? active.validity,
      version: active.version + 1,
      provenance: { chain: [...active.provenance.chain, `artifact:${input.artifactRef ?? "none"}`] },
      state: "ACTIVE"
    };
    this.versions.set(knowledgeId, [...chain.map((record) => (record.knowledgeId === knowledgeId && record.state === "ACTIVE" ? superseded : record)), next]);
    this.persist();
    return structuredClone(next);
  }

  /** Latest ACTIVE version (undefined when only superseded/stale versions remain). */
  get(knowledgeId: string): KnowledgeRecordVNext | undefined {
    const chain = this.versions.get(knowledgeId) ?? [];
    const active = [...chain].reverse().find((record) => record.state === "ACTIVE");
    return active ? structuredClone(active) : undefined;
  }

  /** Full version history ascending by version. */
  history(knowledgeId: string): KnowledgeRecordVNext[] {
    return (this.versions.get(knowledgeId) ?? []).map((record) => structuredClone(record));
  }

  /** Latest ACTIVE record per knowledgeId, newest-updated first. */
  list(scope?: KnowledgeScope): KnowledgeRecordVNext[] {
    const latest: KnowledgeRecordVNext[] = [];
    for (const chain of this.versions.values()) {
      const active = [...chain].reverse().find((record) => record.state === "ACTIVE");
      if (active && (!scope || active.scope === scope)) latest.push(structuredClone(active));
    }
    return latest.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  count(): number {
    return this.list().length;
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxKnowledgeSpaceFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid tenx knowledge space");
    for (const record of parsed.records) {
      if (!record || typeof record.knowledgeId !== "string" || !record.content || typeof record.version !== "number") throw new Error("Invalid tenx knowledge record");
      const chain = this.versions.get(record.knowledgeId) ?? [];
      chain.push(record);
      this.versions.set(record.knowledgeId, chain);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxKnowledgeSpaceFile = { schemaVersion: 1, records: [...this.versions.values()].flat() };
    writeJson(this.filePath, file);
  }
}
