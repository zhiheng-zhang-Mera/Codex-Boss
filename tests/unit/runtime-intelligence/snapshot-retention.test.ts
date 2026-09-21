import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_SNAPSHOTS_PER_NODE,
  compactSnapshotSeries,
  describeSnapshotSubstance,
  planSnapshotRetention,
  snapshotDigest,
  snapshotSubstance,
  type SnapshotCompactionReport,
  type SnapshotRetentionPlan,
  type SnapshotSeriesEntry
} from "../../../src/shared/runtime-intelligence/snapshot-retention";
import { measured, unknown } from "../../../src/shared/runtime-intelligence/measurement";
import type { NodeCapabilitySnapshot } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase I/M, pure half. The properties under test are that an unchanged node does not
 * accumulate objects, that a change is never collapsed away, and that exceeding retention
 * archives rather than deletes.
 */

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

function minute(offset: number): string {
  return new Date(BASE + offset * 60_000).toISOString();
}

function snapshot(capturedAt: string, overrides: { freeMb?: number; nodeId?: string } = {}): NodeCapabilitySnapshot {
  const freeMb = overrides.freeMb ?? 16384;
  const at = capturedAt;
  return {
    schemaVersion: 1,
    kind: "NODE_CAPABILITY_SNAPSHOT",
    nodeId: overrides.nodeId ?? "node-a",
    hostId: measured(overrides.nodeId ?? "node-a", "test", at),
    capturedAt: at,
    identity: { deviceType: "desktop", os: "win32", arch: "x64", runtimeVersion: "v24" },
    cpu: { logicalCores: measured(16, "test", at), physicalCores: unknown("no probe"), model: measured("cpu", "test", at), loadPercent: unknown("windows") },
    memory: { totalMb: measured(32768, "test", at), freeMb: measured(freeMb, "test", at) },
    gpu: { devices: unknown("no probe"), totalVramMb: unknown("no probe") },
    disk: { freeMb: measured(500_000, "test", at), totalMb: measured(1_000_000, "test", at) },
    network: { availability: unknown("no probe"), latencyMs: unknown("no probe"), quality: unknown("no probe") },
    load: { currentTasks: measured(0, "test", at), processPressure: measured(0.5, "test", at) },
    localModels: unknown("no probe"),
    apis: measured(["openai"], "test", at),
    tools: measured(["git"], "test", at),
    plugins: unknown("no probe"),
    repo: { locality: measured("LOCAL", "test", at), warmCacheHints: measured(["git-objects"], "test", at) },
    trust: { trustClass: "TRUSTED_HOST", executionRestrictions: ["no-owner-credentials"] }
  };
}

describe("the digest covers the substance and not the timestamp", () => {
  it("gives two samples of an unchanged node the same digest", () => {
    expect(snapshotDigest(snapshot(minute(0)))).toBe(snapshotDigest(snapshot(minute(1))));
  });

  it("changes the digest when a measured fact changes", () => {
    expect(snapshotDigest(snapshot(minute(0)))).not.toBe(snapshotDigest(snapshot(minute(1), { freeMb: 8000 })));
  });

  it("keeps the timestamp and the node identity out of the substance text", () => {
    const text = snapshotSubstance(snapshot(minute(7)));
    expect(text).toContain("node=node-a");
    expect(text).toContain("memory.freeMb=16384");
    expect(text).not.toContain(minute(7));
    // The absence of a metric is part of the substance: UNKNOWN is a state, not a blank.
    expect(text).toContain("gpu.devices=UNKNOWN(no probe)");
    expect(describeSnapshotSubstance(snapshot(minute(0)))).toContain("node=node-a");
  });

  it("treats a restriction change as a substance change", () => {
    const restricted = { ...snapshot(minute(1)), trust: { trustClass: "TRUSTED_HOST" as const, executionRestrictions: ["no-owner-credentials", "no-network"] } };
    expect(snapshotDigest(restricted)).not.toBe(snapshotDigest(snapshot(minute(0))));
  });
});

describe("consecutive duplicates collapse with their count kept", () => {
  it("collapses an unchanged run into one entry that counts its samples", () => {
    const report: SnapshotCompactionReport = compactSnapshotSeries(Array.from({ length: 10 }, (_, index) => snapshot(minute(index))));
    expect(report.input).toBe(10);
    expect(report.kept).toBe(1);
    expect(report.collapsedDuplicates).toBe(9);
    const entry: SnapshotSeriesEntry = report.entries[0];
    expect(entry.sampleCount).toBe(10);
    expect(entry.firstCapturedAt).toBe(minute(0));
    expect(entry.lastCapturedAt).toBe(minute(9));
    expect(report.notes.join(" ")).toContain("counts them");
  });

  it("keeps both sides of a change, and does not collapse the return to a previous value", () => {
    const series = [snapshot(minute(0)), snapshot(minute(1), { freeMb: 8000 }), snapshot(minute(2), { freeMb: 16384 })];
    const report = compactSnapshotSeries(series);
    expect(report.kept).toBe(3);
    expect(report.collapsedDuplicates).toBe(0);
    expect(report.entries.map((entry) => entry.sampleCount)).toEqual([1, 1, 1]);
  });

  it("orders by capturedAt so an out-of-order input still collapses correctly", () => {
    const report = compactSnapshotSeries([snapshot(minute(2)), snapshot(minute(0)), snapshot(minute(1))]);
    expect(report.kept).toBe(1);
    expect(report.entries[0].firstCapturedAt).toBe(minute(0));
    expect(report.entries[0].lastCapturedAt).toBe(minute(2));
  });

  it("reports an unparseable timestamp instead of throwing", () => {
    const report = compactSnapshotSeries([snapshot("not-a-timestamp"), snapshot(minute(0))]);
    expect(report.input).toBe(2);
    expect(report.notes.join(" ")).toContain("unparseable capturedAt");
  });
});

describe("retention archives the overflow and deletes nothing", () => {
  it("keeps the newest entries and archives the rest", () => {
    const series = Array.from({ length: 6 }, (_, index) => snapshot(minute(index), { freeMb: 1000 + index }));
    const report = compactSnapshotSeries(series, { maxPerNode: 2 });
    expect(report.input).toBe(6);
    expect(report.kept).toBe(2);
    expect(report.archived).toBe(4);
    expect(report.entries.map((entry) => entry.snapshot.memory.freeMb.status)).toEqual(["MEASURED", "MEASURED"]);
    // The archived entries still exist in the report.
    expect(report.archivedEntries).toHaveLength(4);
    expect(report.notes.join(" ")).toContain("archived, not deleted");
  });

  it("plans per node, so one noisy node cannot evict another's history", () => {
    const series = [...Array.from({ length: 5 }, (_, index) => snapshot(minute(index), { freeMb: 1000 + index })), ...Array.from({ length: 5 }, (_, index) => snapshot(minute(index), { nodeId: "node-b", freeMb: 2000 + index }))];
    const plan: SnapshotRetentionPlan = planSnapshotRetention(series, { maxPerNode: 3 });
    expect(plan.reports.map((report) => report.nodeId)).toEqual(["node-a", "node-b"]);
    expect(plan.reports.every((report) => report.kept === 3 && report.archived === 2)).toBe(true);
    expect(plan.totalInput).toBe(10);
    expect(plan.totalKept).toBe(6);
    expect(plan.totalArchived).toBe(4);
  });

  it("declares that the plan removes nothing", () => {
    const plan = planSnapshotRetention([snapshot(minute(0))]);
    expect(plan.deletesNothing).toBe(true);
    expect(DEFAULT_MAX_SNAPSHOTS_PER_NODE).toBeGreaterThan(0);
  });

  it("reports an empty plan for an empty series rather than failing", () => {
    const plan = planSnapshotRetention([]);
    expect(plan.reports).toEqual([]);
    expect(plan.totalInput).toBe(0);
    expect(plan.totalKept).toBe(0);
  });

  it("bounds a long unchanged run to one entry regardless of how many samples arrived", () => {
    const plan = planSnapshotRetention(Array.from({ length: 5000 }, (_, index) => snapshot(minute(index))), { maxPerNode: 200 });
    expect(plan.totalInput).toBe(5000);
    expect(plan.totalKept).toBe(1);
    expect(plan.totalArchived).toBe(0);
    expect(plan.totalCollapsed).toBe(4999);
  });
});
