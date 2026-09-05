import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, writeJson, validId } from "../commander/durable-json";
import { canonicalStableProtocol, validateAmendment, type ProtocolAmendment, type ProtocolFreezeResult, type ResearchProtocol, type FrozenField } from "../../src/shared/research-protocol";

/**
 * Protocol manager (plan 9-6 Phase 7). Freezes a protocol by canonical SHA-256
 * into `research/<id>/protocol.json` (moving the run to PROTOCOL_FROZEN), and
 * records scientific amendments as `protocol-amendment-<n>.json` bound to the
 * frozen hash. Mechanical fixes (syntax/path/env/package/runtime) never need
 * an amendment — only frozen-field changes do.
 */

export interface ProtocolStoreFile {
  schemaVersion: 1;
  protocolHash: string;
  protocol: ResearchProtocol;
  amendments: ProtocolAmendment[];
  frozenAt: string;
}

export class ProtocolManager {
  constructor(private readonly directory: string) {}

  freeze(id: string, protocol: ResearchProtocol): ProtocolFreezeResult {
    const hash = createHash("sha256").update(canonicalStableProtocol(protocol), "utf8").digest("hex");
    const existing = this.load(id);
    if (existing) throw new Error(`Protocol already frozen for research ${id}`);
    const file: ProtocolStoreFile = { schemaVersion: 1, protocolHash: hash, protocol, amendments: [], frozenAt: new Date().toISOString() };
    writeJson(this.protocolPath(id), file);
    return { hash, frozenAt: file.frozenAt };
  }

  load(id: string): ProtocolStoreFile | undefined {
    const value = readJson<Partial<ProtocolStoreFile>>(this.protocolPath(id));
    if (!value) return undefined;
    if (value.schemaVersion !== 1 || !value.protocol || !value.protocolHash || !Array.isArray(value.amendments)) throw new Error("Invalid protocol store");
    return { schemaVersion: 1, protocolHash: value.protocolHash, protocol: value.protocol, amendments: value.amendments, frozenAt: value.frozenAt ?? "" };
  }

  /** Records an approved frozen-field amendment (never a silent change). */
  amend(id: string, amendment: Omit<ProtocolAmendment, "protocolHash" | "approved" | "createdAt">): ProtocolAmendment {
    const store = this.require(id);
    const record: ProtocolAmendment = {
      ...amendment,
      id: amendment.id ?? `amendment-${store.amendments.length + 1}`,
      protocolHash: store.protocolHash,
      approved: true,
      createdAt: new Date().toISOString()
    };
    validateAmendment(record);
    store.amendments.push(record);
    writeJson(this.protocolPath(id), store);
    return structuredClone(record);
  }

  amendments(id: string): ProtocolAmendment[] {
    const store = this.load(id);
    return store ? store.amendments.map((amendment) => structuredClone(amendment)) : [];
  }

  private require(id: string): ProtocolStoreFile {
    const store = this.load(id);
    if (!store) throw new Error(`Research ${id} has no frozen protocol`);
    return store;
  }

  private protocolPath(id: string): string {
    const safe = validId(id);
    fs.mkdirSync(path.join(this.directory, safe), { recursive: true });
    return path.join(this.directory, safe, "protocol.json");
  }
}
