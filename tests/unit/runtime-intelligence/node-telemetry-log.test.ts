import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SAMPLING_INTERVAL_MS,
  NodeTelemetryLog,
  type NodeSampleResult,
  type NodeTelemetryLogOptions,
  type NodeTelemetryStatus
} from "../../../electron/runtime-intelligence/node-telemetry-log";
import { nodeReadiness } from "../../../src/shared/runtime-intelligence/node-profile";
import type { NodeCapabilitySnapshot } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase I — the real node sampler. These tests run against THIS machine: the snapshots come
 * from the real profiler reading `node:os`/`node:fs`, so the log is dogfooded rather than
 * simulated. The deterministic probes only fix the values so deduplication can be asserted
 * exactly.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-node-log-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** A clock that only moves when a test moves it, so intervals are exact. */
function clock(startIso = "2026-01-01T00:00:00.000Z"): { now: () => string; advance: (ms: number) => void } {
  let current = Date.parse(startIso);
  return { now: () => new Date(current).toISOString(), advance: (ms: number) => { current += ms; } };
}

/** Deterministic probes, so the substance of a snapshot changes only when a test says so. */
function probes(freeMb: number) {
  return {
    cpu: () => ({ logicalCores: 16, model: "test-cpu" }),
    memory: () => ({ totalMb: 32768, freeMb }),
    // Disk is fixed too: real free space moves between samples, and the digest covers every
    // measured fact on purpose, so a volatile metric would make every sample distinct.
    disk: () => ({ freeMb: 500_000, totalMb: 1_000_000 }),
    currentTasks: () => 0,
    repoRoot: process.cwd()
  };
}

function log(options: { rootDir: string; time: { now: () => string }; maxPerNode?: number; minIntervalMs?: number }): NodeTelemetryLog {
  const settings: NodeTelemetryLogOptions = { rootDir: options.rootDir, now: options.time.now };
  if (options.maxPerNode !== undefined) settings.maxPerNode = options.maxPerNode;
  if (options.minIntervalMs !== undefined) settings.minIntervalMs = options.minIntervalMs;
  return new NodeTelemetryLog(settings);
}

describe("the sampler reads this machine", () => {
  it("takes a real snapshot of the host it runs on", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time });
    const result = store.sample({ probes: probes(16384) });
    expect(result.stored).toBe(true);
    const [snapshot] = store.snapshots();
    expect(snapshot.nodeId).toBeTruthy();
    // Real identity from node:os, and a readiness the pure rule can judge.
    expect(snapshot.identity.os).toBe(process.platform);
    expect(snapshot.identity.arch).toBe(process.arch);
    expect(nodeReadiness(snapshot).readiness).toBe("READY");
  });

  it("records a snapshot even when a probe fails, with the absence visible", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time });
    store.sample({ probes: { ...probes(16384), gpu: () => { throw new Error("no gpu probe"); } } });
    const [snapshot] = store.snapshots();
    expect(snapshot.gpu.devices.status).toBe("UNREADABLE");
  });

  it("dogs the real thing: a sample with no injected probes reads every metric it can", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time });
    const result = store.sample({ repoRoot: process.cwd() });
    expect(result.stored).toBe(true);
    const [snapshot] = store.snapshots();
    expect(snapshot.cpu.logicalCores.status).toBe("MEASURED");
    expect(snapshot.memory.totalMb.status).toBe("MEASURED");
    // Real disk and real PATH: whatever this host reports, it is a measurement or an absence.
    expect(["MEASURED", "UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"]).toContain(snapshot.disk.freeMb.status);
    expect(snapshot.tools.status).toBe("MEASURED");
    expect(nodeReadiness(snapshot).readiness).not.toBe("FAILED");
  });

  it("stores a sample whose measured facts moved, rather than collapsing it", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time, minIntervalMs: 60_000 });
    store.sample({ probes: probes(16384) });
    time.advance(1000);
    // The digest covers every measured fact, so a moved metric is a new entry even inside
    // the interval. Only an exactly unchanged substance is suppressed.
    const moved = store.sample({ probes: { ...probes(16384), disk: () => ({ freeMb: 499_000, totalMb: 1_000_000 }) } });
    expect(moved.stored).toBe(true);
    expect(store.snapshots()).toHaveLength(2);
  });
});

describe("an unchanged node does not accumulate objects", () => {
  it("suppresses a duplicate inside the sampling interval and counts it", () => {
    const time = clock();
    const root = makeRoot();
    const store = log({ rootDir: root, time, minIntervalMs: 60_000 });
    const first: NodeSampleResult = store.sample({ probes: probes(16384) });
    time.advance(1000);
    const second = store.sample({ probes: probes(16384) });
    expect(first.stored).toBe(true);
    expect(second.stored).toBe(false);
    expect(second.reason).toContain("inside the 60000ms sampling interval");
    expect(store.snapshots()).toHaveLength(1);
    // The suppression is persisted, not just remembered in memory.
    const status: NodeTelemetryStatus = store.status();
    expect(status.suppressedSamples).toBe(1);
    expect(status.storedSamples).toBe(1);
  });

  it("stores a duplicate once the interval has elapsed, because liveness is evidence", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time, minIntervalMs: 60_000 });
    store.sample({ probes: probes(16384) });
    time.advance(60_001);
    const later = store.sample({ probes: probes(16384) });
    expect(later.stored).toBe(true);
    expect(store.snapshots()).toHaveLength(2);
  });

  it("stores immediately when the substance changed", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time, minIntervalMs: 60_000 });
    store.sample({ probes: probes(16384) });
    time.advance(1000);
    const changed = store.sample({ probes: probes(8000) });
    expect(changed.stored).toBe(true);
    expect(store.snapshots()).toHaveLength(2);
  });

  it("collapses the periodic duplicates that did get stored, and archives the overflow", () => {
    const time = clock();
    const root = makeRoot();
    // A retention limit of one, so this test exercises BOTH mechanisms: nine duplicate samples
    // collapse into a representative, and the older of the two distinct entries is archived.
    const store = log({ rootDir: root, time, minIntervalMs: 60_000, maxPerNode: 1 });
    for (let index = 0; index < 10; index += 1) {
      store.sample({ probes: probes(16384) });
      time.advance(60_001);
    }
    store.sample({ probes: probes(4096) });

    const statusBefore = store.status();
    expect(statusBefore.storedSamples).toBe(11);
    const report = store.report(statusBefore.nodes[0]);
    expect(report.input).toBe(11);
    expect(report.kept).toBe(1);
    expect(report.archived).toBe(1);
    expect(report.collapsedDuplicates).toBe(9);

    const applied = store.compact();
    expect(applied.deletesNothing).toBe(true);
    // Eleven stored samples, one kept, one archived, nine collapsed — nothing lost.
    expect(applied.totalInput).toBe(11);
    expect(applied.totalKept).toBe(1);
    expect(applied.totalArchived).toBe(1);
    expect(store.snapshots()).toHaveLength(11);
    expect(store.archived()).toHaveLength(1);
    expect(store.status().afterCompaction).toBe(1);
  });

  it("bounds growth: a long unchanged run stores only the periodic evidence it needs", () => {
    const time = clock();
    const root = makeRoot();
    const store = log({ rootDir: root, time, minIntervalMs: 60_000 });
    // 50 samples one second apart on an unchanged machine: one stored, 49 suppressed.
    for (let index = 0; index < 50; index += 1) {
      store.sample({ probes: probes(16384) });
      time.advance(1000);
    }
    const status = store.status();
    expect(status.storedSamples).toBe(1);
    expect(status.suppressedSamples).toBe(49);
    expect(status.afterCompaction).toBe(1);
    expect(status.bytes.samples).toBeGreaterThan(0);
  });
});

describe("the log degrades rather than throwing on damaged state", () => {
  it("reports a corrupt index and still samples", () => {
    const time = clock();
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "nodes-index.json"), "{ not json", "utf8");
    const store = log({ rootDir: root, time });
    const result = store.sample({ probes: probes(16384) });
    expect(result.stored).toBe(true);
    expect(store.status().degradedReason).toContain("nodes-index.json");
    expect(store.snapshots()).toHaveLength(1);
  });

  it("skips an unparseable row instead of losing the series", () => {
    const time = clock();
    const root = makeRoot();
    const store = log({ rootDir: root, time });
    store.sample({ probes: probes(16384) });
    fs.appendFileSync(path.join(root, "nodes-sampled.jsonl"), "{ torn\n", "utf8");
    expect(store.snapshots()).toHaveLength(1);
  });

  it("reports an empty root without inventing data", () => {
    const store = log({ rootDir: makeRoot(), time: clock() });
    const status = store.status();
    expect(status.storedSamples).toBe(0);
    expect(status.suppressedSamples).toBe(0);
    expect(status.afterCompaction).toBe(0);
    expect(status.nodes).toEqual([]);
    expect(status.degradedReason).toBeUndefined();
  });

  it("compacts an empty log without writing an archive", () => {
    const root = makeRoot();
    const store = log({ rootDir: root, time: clock() });
    const plan = store.compact();
    expect(plan.totalArchived).toBe(0);
    expect(fs.existsSync(path.join(root, "nodes-archive.jsonl"))).toBe(false);
  });
});

describe("the node id is data, never a branch", () => {
  it("uses whatever the machine reports and works for any node id", () => {
    const time = clock();
    const root = makeRoot();
    const store = log({ rootDir: root, time });
    store.sample({ probes: probes(16384) });
    store.sample({ probes: { ...probes(16384), cpu: () => ({ logicalCores: 8, model: "other" }) } , nodeId: "second-machine" } as never);
    const status = store.status();
    // Whatever the host is called, it is a key in the index and nothing more.
    expect(status.nodes.length).toBeGreaterThanOrEqual(1);
    for (const nodeId of status.nodes) expect(store.snapshots(nodeId).length).toBeGreaterThan(0);
    expect(DEFAULT_SAMPLING_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("profiles an injected node id without special-casing a name", () => {
    const time = clock();
    const store = log({ rootDir: makeRoot(), time });
    const result = store.sample({ nodeId: "arbitrary-node-42", probes: probes(16384) });
    expect(result.nodeId).toBe("arbitrary-node-42");
    const snapshot: NodeCapabilitySnapshot | undefined = store.snapshots("arbitrary-node-42")[0];
    expect(snapshot?.nodeId).toBe("arbitrary-node-42");
  });
});
