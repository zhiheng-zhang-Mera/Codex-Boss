import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";
import { capabilityVerdicts, nodeStateFor, type CapabilityVerdict, type NodeProbeData, type NodeState } from "../../src/shared/node-capabilities";

/**
 * R43 Phase C (R-302): durable per-node capability registry.
 * One record per node; self-inspection facts are re-derived into verdicts and a
 * node state on every refresh. Records are isolated per node (one node's
 * DEGRADED/FAILED never touches another) and fail closed on corruption.
 */
export interface NodeRegistryFile {
  schemaVersion: 1;
  records: Array<{
    nodeId: string;
    probe: NodeProbeData;
    verdicts: CapabilityVerdict[];
    state: NodeState;
    reason: string;
    updatedAt: string;
  }>;
}

export class NodeCapabilityRegistry {
  private readonly records = new Map<string, NodeRegistryFile["records"][number]>();

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  refresh(nodeId: string, probe: NodeProbeData, now = new Date().toISOString()): { state: NodeState; reason: string; verdicts: CapabilityVerdict[] } {
    const verdicts = capabilityVerdicts(probe);
    const { state, reason } = nodeStateFor(probe, verdicts);
    this.records.set(nodeId, { nodeId, probe, verdicts, state, reason, updatedAt: now });
    this.persist();
    return { state, reason, verdicts };
  }

  status(nodeId: string): { nodeId: string; state: NodeState; reason: string; verdicts: CapabilityVerdict[]; updatedAt?: string } | undefined {
    const record = this.records.get(nodeId);
    if (!record) return undefined;
    return { nodeId: record.nodeId, state: record.state, reason: record.reason, verdicts: record.verdicts, updatedAt: record.updatedAt };
  }

  list(): Array<{ nodeId: string; state: NodeState; updatedAt: string }> {
    return [...this.records.values()].map((record) => ({ nodeId: record.nodeId, state: record.state, updatedAt: record.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<NodeRegistryFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid node registry");
    for (const record of parsed.records) {
      if (!record || typeof record.nodeId !== "string" || !record.verdicts || !record.state) throw new Error("Invalid node registry record");
      this.records.set(record.nodeId, record);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: NodeRegistryFile = { schemaVersion: 1, records: [...this.records.values()] };
    writeJson(this.filePath, file);
  }
}
