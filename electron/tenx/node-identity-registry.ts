import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import { heartbeat, rederiveState, refreshAdvertisement, type NodeCapabilityAdvertisement, type NodeIdentity, type NodeOperationalState, type NodeRefreshFacts } from "../../src/shared/tenx/node";

/**
 * 10B: durable per-node identity + capability registry (forward layer).
 *
 * One record per nodeId; the nodeId is stable (persisted, never re-rolled on
 * restart), sessionId/runId stay out of the record. Capabilities refresh
 * dynamically without re-creating the record. One node's state never mutates
 * another node's record, and a corrupted file fails closed (registry throws on
 * restore, it never silently fabricates a READY state).
 *
 * This is additive forward development: it does not touch the R43
 * node-capability-registry or any other closure file.
 */

export interface TenxNodeRegistryFile {
  schemaVersion: 1;
  records: Array<{
    nodeId: string;
    identity: NodeIdentity;
    advertisement: NodeCapabilityAdvertisement;
    updatedAt: string;
  }>;
}

export interface RegisteredNode {
  nodeId: string;
  identity: NodeIdentity;
  advertisement: NodeCapabilityAdvertisement;
  updatedAt: string;
}

export class TenxNodeRegistry {
  private readonly records = new Map<string, RegisteredNode>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => number = Date.now,
    private readonly nodeIdProvider: () => string = () => `node-${Math.random().toString(36).slice(2, 10)}`
  ) {
    this.restore();
  }

  /** Register (or update) a node identity. nodeId comes from identity unless the caller forces one. */
  register(identity: NodeIdentity, forcedNodeId?: string): RegisteredNode {
    const nodeId = forcedNodeId ?? identity.nodeId;
    const existing = this.records.get(nodeId);
    const record: RegisteredNode = existing
      ? { ...existing, identity, advertisement: { ...existing.advertisement, identity }, updatedAt: new Date(this.now()).toISOString() }
      : { nodeId, identity, advertisement: emptyAdvertisement(identity, this.now()), updatedAt: new Date(this.now()).toISOString() };
    this.records.set(nodeId, record);
    this.persist();
    return structuredClone(record);
  }

  /** Stable nodeId: reuse the persisted one when present; otherwise mint once and keep it. */
  ensureNodeId(identity: NodeIdentity): string {
    const existing = this.records.get(identity.nodeId);
    if (existing) return existing.nodeId;
    const nodeId = this.nodeIdProvider();
    this.register({ ...identity, nodeId });
    return nodeId;
  }

  /** Dynamic capability refresh; keeps nodeId + identity stable. */
  refresh(nodeId: string, facts: NodeRefreshFacts): RegisteredNode | undefined {
    const current = this.records.get(nodeId);
    if (!current) return undefined;
    const advertisement = refreshAdvertisement(current.advertisement, facts);
    const next: RegisteredNode = { ...current, advertisement, updatedAt: new Date(this.now()).toISOString() };
    this.records.set(nodeId, next);
    this.persist();
    return structuredClone(next);
  }

  /** Heartbeat bumps liveness; state re-derivation happens lazily on status()/list(). */
  heartbeat(nodeId: string): RegisteredNode | undefined {
    const current = this.records.get(nodeId);
    if (!current) return undefined;
    const advertisement = heartbeat(current.advertisement, this.now());
    const next: RegisteredNode = { ...current, advertisement, updatedAt: new Date(this.now()).toISOString() };
    this.records.set(nodeId, next);
    this.persist();
    return structuredClone(next);
  }

  status(nodeId: string): RegisteredNode | undefined {
    const record = this.records.get(nodeId);
    if (!record) return undefined;
    const derived = rederiveState(this.now(), record.advertisement);
    return structuredClone({ ...record, advertisement: { ...record.advertisement, state: derived.state, degradedReasons: derived.degradedReasons } });
  }

  /** Deterministic snapshot with liveness re-derived, sorted by nodeId. */
  list(): RegisteredNode[] {
    return [...this.records.values()]
      .map((record) => {
        const derived = rederiveState(this.now(), record.advertisement);
        return { ...record, advertisement: { ...record.advertisement, state: derived.state, degradedReasons: derived.degradedReasons } };
      })
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
      .map((record) => structuredClone(record));
  }

  setState(nodeId: string, state: NodeOperationalState, reason?: string): RegisteredNode | undefined {
    const current = this.records.get(nodeId);
    if (!current) return undefined;
    const next: RegisteredNode = {
      ...current,
      advertisement: { ...current.advertisement, state, degradedReasons: reason ? [...new Set([...current.advertisement.degradedReasons, reason])] : current.advertisement.degradedReasons, seq: current.advertisement.seq + 1 },
      updatedAt: new Date(this.now()).toISOString()
    };
    this.records.set(nodeId, next);
    this.persist();
    return structuredClone(next);
  }

  deregister(nodeId: string): boolean {
    const existed = this.records.delete(nodeId);
    if (existed) this.persist();
    return existed;
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxNodeRegistryFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid tenx node registry");
    for (const record of parsed.records) {
      if (!record || typeof record.nodeId !== "string" || !record.identity || !record.advertisement) throw new Error("Invalid tenx node registry record");
      this.records.set(record.nodeId, record);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxNodeRegistryFile = { schemaVersion: 1, records: [...this.records.values()] };
    writeJson(this.filePath, file);
  }
}

export function emptyAdvertisement(identity: NodeIdentity, now: number): NodeCapabilityAdvertisement {
  return {
    schemaVersion: 1,
    identity,
    hardware: { cpu: { cores: 0 }, memory: { totalMb: 0 }, gpu: [], storage: {} },
    capabilities: { networkRoutes: [], proxyCapable: false, providers: [], browser: false, localModel: false },
    state: "UNKNOWN",
    busy: false,
    degradedReasons: ["no self-inspection yet"],
    lastHeartbeatAt: now,
    seq: 0
  };
}
