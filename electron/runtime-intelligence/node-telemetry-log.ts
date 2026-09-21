/**
 * Runtime Intelligence Plane — the node telemetry log.
 *
 * Phase I's long-term sampler. Alienware-2 is the first node this runs against, but nothing
 * here knows that: the node id comes from the profiler's own observation of `os.hostname()`,
 * it is data, and no branch in this file compares it to a literal. A second machine needs no
 * code change.
 *
 * Growth is controlled at write time and at compaction time:
 *
 *   - `append` refuses to write a snapshot whose substance is identical to the last one
 *     WITHIN the sampling interval. Outside the interval it writes, because a periodic
 *     identical sample is evidence the node is still there with the same capabilities;
 *   - `compact` collapses the consecutive duplicates that the interval allowed through and
 *     archives the overflow beyond the retention limit, so the stored series cannot grow
 *     without bound while nothing is deleted.
 *
 * The suppressed count is persisted in a small index, not merely held in memory, so the
 * report can say how many samples were skipped and why rather than silently dropping them.
 */

import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import { collectNodeSnapshot, type NodeProfilerOptions } from "./node-profiler";
import { RUNTIME_INTELLIGENCE_SCHEMA_VERSION, type NodeCapabilitySnapshot } from "../../src/shared/runtime-intelligence/contracts";
import { DEFAULT_MAX_SNAPSHOTS_PER_NODE, compactSnapshotSeries, planSnapshotRetention, snapshotDigest, type SnapshotCompactionReport, type SnapshotRetentionPlan, type SnapshotSeriesEntry } from "../../src/shared/runtime-intelligence/snapshot-retention";

/** The default sampling interval: one stored sample per node per interval at most. */
export const DEFAULT_SAMPLING_INTERVAL_MS = 5 * 60 * 1000;

export interface NodeTelemetryLogOptions {
  rootDir: string;
  maxPerNode?: number;
  minIntervalMs?: number;
  now?: () => string;
}

export interface NodeSampleResult {
  stored: boolean;
  reason: string;
  nodeId: string;
  digest: string;
  capturedAt: string;
}

interface NodeTelemetryIndex {
  schemaVersion: number;
  nodes: Record<string, { lastDigest: string; lastCapturedAt: string; stored: number; suppressed: number }>;
}

export interface NodeTelemetryStatus {
  rootDir: string;
  /** Stored samples on disk, which is what the growth question is about. */
  storedSamples: number;
  suppressedSamples: number;
  /** Distinct entries after collapsing consecutive duplicates. */
  afterCompaction: number;
  archivedEntries: number;
  bytes: { samples: number; archive: number; index: number };
  nodes: string[];
  degradedReason?: string;
  schemaVersion: number;
}

export class NodeTelemetryLog {
  private readonly options: NodeTelemetryLogOptions;
  private readonly now: () => string;
  private degradedReason?: string;

  constructor(options: NodeTelemetryLogOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private get minIntervalMs(): number {
    return this.options.minIntervalMs ?? DEFAULT_SAMPLING_INTERVAL_MS;
  }

  private get maxPerNode(): number {
    return this.options.maxPerNode ?? DEFAULT_MAX_SNAPSHOTS_PER_NODE;
  }

  private file(name: string): string {
    return path.join(this.options.rootDir, name);
  }

  private readIndex(): NodeTelemetryIndex {
    try {
      const value = readJson<NodeTelemetryIndex>(this.file("nodes-index.json"));
      if (!value || typeof value !== "object" || typeof value.nodes !== "object" || value.nodes === null) {
        if (value !== undefined) this.degradedReason = "nodes-index.json is not a node index";
        return { schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION, nodes: {} };
      }
      return value;
    } catch (error) {
      this.degradedReason = `nodes-index.json could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return { schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION, nodes: {} };
    }
  }

  /**
   * Profiles this host and stores the snapshot when it says something new or the interval has
   * elapsed. This is the real dogfooding call: the snapshot comes from `collectNodeSnapshot`.
   */
  sample(input: Partial<Omit<NodeProfilerOptions, "capturedAt">> = {}): NodeSampleResult {
    const snapshot = collectNodeSnapshot({ ...input, capturedAt: this.now() });
    return this.append(snapshot);
  }

  /** Stores one snapshot unless it is an in-interval duplicate of the last one. */
  append(snapshot: NodeCapabilitySnapshot): NodeSampleResult {
    const digest = snapshotDigest(snapshot);
    const index = this.readIndex();
    const previous = index.nodes[snapshot.nodeId];
    if (previous !== undefined && previous.lastDigest === digest) {
      const elapsed = Date.parse(snapshot.capturedAt) - Date.parse(previous.lastCapturedAt);
      if (Number.isFinite(elapsed) && elapsed < this.minIntervalMs) {
        index.nodes[snapshot.nodeId] = { ...previous, suppressed: previous.suppressed + 1 };
        writeJson(this.file("nodes-index.json"), index);
        return {
          stored: false,
          reason: `substance unchanged ${Number.isFinite(elapsed) ? `after ${elapsed}ms` : "with an unparseable interval"}, which is inside the ${this.minIntervalMs}ms sampling interval`,
          nodeId: snapshot.nodeId,
          digest,
          capturedAt: snapshot.capturedAt
        };
      }
    }
    fs.mkdirSync(this.options.rootDir, { recursive: true });
    fs.appendFileSync(this.file("nodes-sampled.jsonl"), `${JSON.stringify(snapshot)}\n`, "utf8");
    index.nodes[snapshot.nodeId] = { lastDigest: digest, lastCapturedAt: snapshot.capturedAt, stored: (previous?.stored ?? 0) + 1, suppressed: previous?.suppressed ?? 0 };
    writeJson(this.file("nodes-index.json"), index);
    return { stored: true, reason: "stored", nodeId: snapshot.nodeId, digest, capturedAt: snapshot.capturedAt };
  }

  /** Every stored sample, optionally for one node. */
  snapshots(nodeId?: string): NodeCapabilitySnapshot[] {
    const file = this.file("nodes-sampled.jsonl");
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      this.degradedReason = `nodes-sampled.jsonl could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
    const rows: NodeCapabilitySnapshot[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as NodeCapabilitySnapshot;
        if (nodeId === undefined || parsed.nodeId === nodeId) rows.push(parsed);
      } catch {
        // One unparseable row costs one row, not the series.
      }
    }
    return rows;
  }

  /** The compacted series for one node, without writing anything. */
  entries(nodeId: string): SnapshotSeriesEntry[] {
    return compactSnapshotSeries(this.snapshots(nodeId), { nodeId, maxPerNode: Number.MAX_SAFE_INTEGER }).entries;
  }

  /** The retention plan for everything stored. Pure: it writes nothing. */
  plan(): SnapshotRetentionPlan {
    return planSnapshotRetention(this.snapshots(), { maxPerNode: this.maxPerNode });
  }

  /**
   * Applies the plan: the archive receives the overflow, so no stored sample disappears.
   *
   * Returns the plan it applied, so a caller can report exactly what moved.
   */
  compact(): SnapshotRetentionPlan {
    const plan = this.plan();
    const archived = plan.reports.flatMap((report) => report.archivedEntries.map((entry) => entry.snapshot));
    if (archived.length > 0) {
      fs.mkdirSync(this.options.rootDir, { recursive: true });
      fs.appendFileSync(this.file("nodes-archive.jsonl"), `${archived.map((snapshot) => JSON.stringify(snapshot)).join("\n")}\n`, "utf8");
    }
    return plan;
  }

  /** The archived samples, which is where compaction moved things rather than deleting them. */
  archived(): NodeCapabilitySnapshot[] {
    const file = this.file("nodes-archive.jsonl");
    if (!fs.existsSync(file)) return [];
    try {
      return fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as NodeCapabilitySnapshot];
          } catch {
            return [];
          }
        });
    } catch (error) {
      this.degradedReason = `nodes-archive.jsonl could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
  }

  /** The one compaction report for a node, for a report or a test. */
  report(nodeId: string): SnapshotCompactionReport {
    return compactSnapshotSeries(this.snapshots(nodeId), { nodeId, maxPerNode: this.maxPerNode });
  }

  status(): NodeTelemetryStatus {
    const index = this.readIndex();
    const snapshots = this.snapshots();
    const plan = planSnapshotRetention(snapshots, { maxPerNode: this.maxPerNode });
    const sizeOf = (name: string): number => {
      const target = this.file(name);
      try {
        return fs.existsSync(target) ? fs.statSync(target).size : 0;
      } catch {
        return 0;
      }
    };
    return {
      rootDir: this.options.rootDir,
      storedSamples: snapshots.length,
      suppressedSamples: Object.values(index.nodes).reduce((total, entry) => total + entry.suppressed, 0),
      afterCompaction: plan.totalKept,
      archivedEntries: plan.totalArchived,
      bytes: { samples: sizeOf("nodes-sampled.jsonl"), archive: sizeOf("nodes-archive.jsonl"), index: sizeOf("nodes-index.json") },
      nodes: Object.keys(index.nodes).sort(),
      ...(this.degradedReason === undefined ? {} : { degradedReason: this.degradedReason }),
      schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION
    };
  }
}
