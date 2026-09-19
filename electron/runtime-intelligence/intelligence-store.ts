/**
 * Runtime Intelligence Plane — durable storage for the plane's records.
 *
 * The layout follows the repository's established pattern rather than inventing one:
 * atomic whole-file JSON through `durable-json` for derived state that is small and
 * replaceable (`models.json`, `nodes.json`, `context-records.json`), and append-only
 * JSONL for the two logs that grow (`observations.jsonl`, `skill-telemetry.jsonl`) — the
 * same split `EpisodeStore` already uses.
 *
 * Reads degrade instead of throwing. A corrupt file yields an empty result plus a
 * `degradedReason`, because this plane is an observer: a damaged observation log must
 * never be able to stop the work it is observing. Nothing here is authoritative for
 * anything else in Boss.
 *
 * The root is supplied by the caller (from `runtimeRoots`), never built by hand here.
 */

import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import { RUNTIME_INTELLIGENCE_SCHEMA_VERSION, type ContextRecord, type ModelCapabilityRecord, type NodeCapabilitySnapshot, type RuntimeObservation, type SkillUsageTelemetry } from "../../src/shared/runtime-intelligence/contracts";

/** How many node snapshots are kept per node, so a time series cannot grow without bound. */
export const NODE_SNAPSHOT_HISTORY_LIMIT = 200;

/** How many observation rows are read by default. */
export const OBSERVATION_READ_LIMIT = 500;

export interface RuntimeIntelligenceStoreOptions {
  rootDir: string;
}

export interface RuntimeIntelligenceStoreStatus {
  rootDir: string;
  files: Record<string, number>;
  counts: { observations: number; models: number; nodes: number; skillTelemetry: number; contextRecords: number };
  degradedReason?: string;
  schemaVersion: number;
}

interface ModelLedgerFile {
  schemaVersion: number;
  models: ModelCapabilityRecord[];
}

interface NodeSnapshotFile {
  schemaVersion: number;
  snapshots: NodeCapabilitySnapshot[];
}

interface ContextRecordFile {
  schemaVersion: number;
  records: ContextRecord[];
}

export class RuntimeIntelligenceStore {
  readonly rootDir: string;
  private degradedReason?: string;

  constructor(options: RuntimeIntelligenceStoreOptions) {
    this.rootDir = options.rootDir;
  }

  private file(name: string): string {
    return path.join(this.rootDir, name);
  }

  /** Append-only log. Each row is one JSON object, so a torn last line costs one row. */
  private appendJsonl(file: string, rows: readonly unknown[]): void {
    if (rows.length === 0) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
  }

  private readJsonl<T>(file: string): T[] {
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      this.degrade(file, error);
      return [];
    }
    const rows: T[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // One unparseable row is one lost row, not a lost log.
      }
    }
    return rows;
  }

  private readJsonFile<T>(file: string): T | undefined {
    try {
      return readJson<T>(file);
    } catch (error) {
      this.degrade(file, error);
      return undefined;
    }
  }

  private degrade(file: string, error: unknown): void {
    this.note(`${path.basename(file)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Records one reason the store is degraded.
   *
   * Reasons accumulate rather than replace: a store with two damaged files should report
   * both, and the second failure must not hide the first.
   */
  private note(reason: string): void {
    this.degradedReason = this.degradedReason === undefined ? reason : `${this.degradedReason}; ${reason}`;
  }

  /* ------------------------------------------------------------ observations */

  appendObservation(observation: RuntimeObservation): void {
    this.appendJsonl(this.file("observations.jsonl"), [observation]);
  }

  appendObservations(observations: readonly RuntimeObservation[]): void {
    this.appendJsonl(this.file("observations.jsonl"), observations);
  }

  observations(limit: number = OBSERVATION_READ_LIMIT): RuntimeObservation[] {
    const all = this.readJsonl<RuntimeObservation>(this.file("observations.jsonl"));
    return limit >= all.length ? all : all.slice(-limit);
  }

  observation(observationId: string): RuntimeObservation | undefined {
    return this.observations(Number.MAX_SAFE_INTEGER).find((entry) => entry.observationId === observationId);
  }

  /* ------------------------------------------------------------ model ledger */

  saveModels(records: readonly ModelCapabilityRecord[]): void {
    const value: ModelLedgerFile = { schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION, models: [...records] };
    writeJson(this.file("models.json"), value);
  }

  loadModels(): ModelCapabilityRecord[] {
    const value = this.readJsonFile<ModelLedgerFile>(this.file("models.json"));
    if (!value || !Array.isArray(value.models)) {
      if (value !== undefined && !Array.isArray(value.models)) this.note("models.json is not a model ledger");
      return [];
    }
    return value.models;
  }

  model(modelKey: string): ModelCapabilityRecord | undefined {
    return this.loadModels().find((record) => record.modelKey === modelKey);
  }

  /* ----------------------------------------------------------- node profiles */

  /** Keeps the newest `NODE_SNAPSHOT_HISTORY_LIMIT` per node, so the series is bounded. */
  saveNodes(snapshots: readonly NodeCapabilitySnapshot[]): void {
    const existing = this.loadNodes();
    const byNode = new Map<string, NodeCapabilitySnapshot[]>();
    for (const snapshot of [...existing, ...snapshots]) {
      byNode.set(snapshot.nodeId, [...(byNode.get(snapshot.nodeId) ?? []), snapshot].slice(-NODE_SNAPSHOT_HISTORY_LIMIT));
    }
    const value: NodeSnapshotFile = { schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION, snapshots: [...byNode.values()].flat() };
    writeJson(this.file("nodes.json"), value);
  }

  loadNodes(): NodeCapabilitySnapshot[] {
    const value = this.readJsonFile<NodeSnapshotFile>(this.file("nodes.json"));
    if (!value || !Array.isArray(value.snapshots)) {
      if (value !== undefined && !Array.isArray(value.snapshots)) this.note("nodes.json is not a snapshot series");
      return [];
    }
    return value.snapshots;
  }

  /** The most recent snapshot of a node. Ties are broken by `capturedAt`, then by order. */
  latestNodeSnapshot(nodeId: string): NodeCapabilitySnapshot | undefined {
    const forNode = this.loadNodes().filter((snapshot) => snapshot.nodeId === nodeId);
    return forNode.sort((left, right) => (left.capturedAt < right.capturedAt ? -1 : left.capturedAt > right.capturedAt ? 1 : 0)).at(-1);
  }

  nodeHistory(nodeId: string): NodeCapabilitySnapshot[] {
    return this.loadNodes().filter((snapshot) => snapshot.nodeId === nodeId).sort((left, right) => (left.capturedAt < right.capturedAt ? -1 : 1));
  }

  /* ---------------------------------------------------------- skill telemetry */

  appendSkillTelemetry(entries: readonly SkillUsageTelemetry[]): void {
    this.appendJsonl(this.file("skill-telemetry.jsonl"), entries);
  }

  skillTelemetry(): SkillUsageTelemetry[] {
    return this.readJsonl<SkillUsageTelemetry>(this.file("skill-telemetry.jsonl"));
  }

  /* ----------------------------------------------------------- context records */

  saveContextRecords(records: readonly ContextRecord[]): void {
    const value: ContextRecordFile = { schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION, records: [...records] };
    writeJson(this.file("context-records.json"), value);
  }

  loadContextRecords(): ContextRecord[] {
    const value = this.readJsonFile<ContextRecordFile>(this.file("context-records.json"));
    if (!value || !Array.isArray(value.records)) {
      if (value !== undefined && !Array.isArray(value.records)) this.note("context-records.json is not a record set");
      return [];
    }
    return value.records;
  }

  /* ------------------------------------------------------------------- status */

  status(): RuntimeIntelligenceStoreStatus {
    const files = ["observations.jsonl", "models.json", "nodes.json", "skill-telemetry.jsonl", "context-records.json"];
    const sizes: Record<string, number> = {};
    for (const name of files) {
      const target = this.file(name);
      try {
        sizes[name] = fs.existsSync(target) ? fs.statSync(target).size : 0;
      } catch {
        sizes[name] = 0;
      }
    }
    return {
      rootDir: this.rootDir,
      files: sizes,
      counts: {
        observations: this.observations(Number.MAX_SAFE_INTEGER).length,
        models: this.loadModels().length,
        nodes: this.loadNodes().length,
        skillTelemetry: this.skillTelemetry().length,
        contextRecords: this.loadContextRecords().length
      },
      ...(this.degradedReason === undefined ? {} : { degradedReason: this.degradedReason }),
      schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION
    };
  }
}
