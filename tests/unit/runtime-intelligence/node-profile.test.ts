import { describe, expect, it } from "vitest";
import {
  NODE_METRIC_KEYS,
  compareNodeSnapshots,
  describeNodeSnapshot,
  nodeCapacityFor,
  nodeCoverage,
  nodeMetricFact,
  nodeMetricFacts,
  nodeReadiness,
  nodeSnapshotDelta,
  type NodeCapacityVerdict,
  type NodeComparison,
  type NodeMetricComparison,
  type NodeMetricKey,
  type NodeReadiness,
  type NodeReadinessVerdict,
  type NodeRequirement
} from "../../../src/shared/runtime-intelligence/node-profile";
import { measured, notMeasured, unavailable, unknown, type Measurement } from "../../../src/shared/runtime-intelligence/measurement";
import type { NodeCapabilitySnapshot } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase C, pure half. `unknown != healthy` is the whole point: readiness is UNKNOWN when
 * the facts it needs were never read, and a comparison reports an unmeasured metric as
 * incomparable instead of quietly reading it as the other node's zero.
 */

const AT = "2026-01-01T00:00:00.000Z";

type MetricOverrides = Partial<Record<NodeMetricKey, Measurement<unknown>>>;

function snapshot(nodeId: string, overrides: MetricOverrides = {}, trustClass: NodeCapabilitySnapshot["trust"]["trustClass"] = "TRUSTED_HOST"): NodeCapabilitySnapshot {
  const notMeasuredMetric = (reason: string): Measurement<never> => notMeasured(reason, "test");
  const fact = <T>(key: NodeMetricKey, fallback: Measurement<T>): Measurement<T> => (overrides[key] as Measurement<T> | undefined) ?? fallback;
  return {
    schemaVersion: 1,
    kind: "NODE_CAPABILITY_SNAPSHOT",
    nodeId,
    hostId: fact("hostId", measured(nodeId, "test", AT)),
    capturedAt: AT,
    identity: { deviceType: "desktop", os: "win32", arch: "x64", runtimeVersion: "v24" },
    cpu: {
      logicalCores: fact("cpu.logicalCores", measured(16, "test", AT)),
      physicalCores: fact("cpu.physicalCores", notMeasuredMetric("no platform probe")),
      model: fact("cpu.model", measured("test-cpu", "test", AT)),
      loadPercent: fact("cpu.loadPercent", notMeasuredMetric("windows load average is meaningless"))
    },
    memory: { totalMb: fact("memory.totalMb", measured(32768, "test", AT)), freeMb: fact("memory.freeMb", measured(16384, "test", AT)) },
    gpu: {
      devices: fact("gpu.devices", notMeasuredMetric("no gpu probe")),
      totalVramMb: fact("gpu.totalVramMb", notMeasuredMetric("no gpu probe"))
    },
    disk: { freeMb: fact("disk.freeMb", measured(500_000, "test", AT)), totalMb: fact("disk.totalMb", measured(1_000_000, "test", AT)) },
    network: {
      availability: fact("network.availability", measured(true, "test", AT)),
      latencyMs: fact("network.latencyMs", measured(12, "test", AT)),
      quality: fact("network.quality", measured("DIRECT", "test", AT))
    },
    load: {
      currentTasks: fact("load.currentTasks", measured(0, "test", AT)),
      processPressure: fact("load.processPressure", measured(0.5, "test", AT))
    },
    localModels: fact("localModels", notMeasuredMetric("no local model probe")),
    apis: fact("apis", measured(["openai"], "test", AT)),
    tools: fact("tools", measured(["git", "node"], "test", AT)),
    plugins: fact("plugins", notMeasuredMetric("no plugin directory")),
    repo: {
      locality: fact("repo.locality", measured("LOCAL", "test", AT)),
      warmCacheHints: fact("repo.warmCacheHints", measured(["git-objects"], "test", AT))
    },
    trust: { trustClass, executionRestrictions: [] }
  };
}

describe("metrics are addressable and their absence survives", () => {
  it("exposes every declared metric", () => {
    const facts = nodeMetricFacts(snapshot("node-a"));
    expect(facts.map((entry) => entry.key)).toEqual([...NODE_METRIC_KEYS]);
    expect(NODE_METRIC_KEYS).toHaveLength(22);
  });

  it("returns the absent fact itself, not a zero, for an unmeasured metric", () => {
    const key: NodeMetricKey = "gpu.devices";
    const fact = nodeMetricFact(snapshot("node-a"), key);
    expect(fact.status).toBe("NOT_MEASURED");
    expect(fact).not.toEqual(measured([], "test", AT));
  });

  it("counts coverage and names every absent metric", () => {
    const coverage = nodeCoverage(snapshot("node-a"));
    expect(coverage.total).toBe(NODE_METRIC_KEYS.length);
    expect(coverage.measured).toBeLessThan(coverage.total);
    expect(coverage.absentKeys).toContain("gpu.devices");
    expect(coverage.absentKeys).toContain("plugins");
    expect(coverage.coverage).toBeCloseTo(coverage.measured / coverage.total, 6);
  });
});

describe("readiness is never claimed from an unmeasured fact", () => {
  it("is READY when compute and memory were observed and nothing is under pressure", () => {
    const verdict: NodeReadinessVerdict = nodeReadiness(snapshot("node-a", { "load.processPressure": measured(0.4, "test", AT) }));
    expect(verdict.readiness).toBe("READY");
    expect(verdict.unknownMetrics).toEqual([]);
  });

  it("is UNKNOWN, not READY, when the core count was not measured", () => {
    const verdict = nodeReadiness(snapshot("node-a", { "cpu.logicalCores": unknown("cpu probe failed") }));
    expect(verdict.readiness).toBe("UNKNOWN");
    expect(verdict.unknownMetrics).toEqual(["cpu.logicalCores"]);
    expect(verdict.reasons.join(" ")).toContain("UNKNOWN(cpu probe failed)");
  });

  it("is UNKNOWN when total memory was not measured, even though the cpu was", () => {
    const verdict = nodeReadiness(snapshot("node-a", { "memory.totalMb": unavailable("not supported") }));
    expect(verdict.readiness).toBe("UNKNOWN");
    expect(verdict.unknownMetrics).toEqual(["memory.totalMb"]);
  });

  it("is UNKNOWN when a core measurement is zero, which is not a healthy value", () => {
    const verdict = nodeReadiness(snapshot("node-a", { "memory.totalMb": measured(0, "test", AT) }));
    expect(verdict.readiness).toBe("UNKNOWN");
    expect(verdict.reasons.join(" ")).toContain("zero");
  });

  it("is DEGRADED under measured memory pressure", () => {
    const verdict = nodeReadiness(snapshot("node-a", { "load.processPressure": measured(0.95, "test", AT) }));
    expect(verdict.readiness).toBe("DEGRADED");
    expect(verdict.reasons.join(" ")).toContain("0.95");
  });

  it("stays READY when only an optional metric is unknown, and names the distinction", () => {
    const verdict = nodeReadiness(snapshot("node-a", { "gpu.devices": unknown("no gpu probe"), plugins: notMeasured("none") }));
    expect(verdict.readiness).toBe("READY");
    // The unknown optional metrics are not reported as blocking readiness.
    expect(verdict.unknownMetrics).toEqual([]);
    const readiness: NodeReadiness = verdict.readiness;
    expect(readiness).toBe("READY");
  });
});

describe("capacity requirements fail closed on unmeasured facts", () => {
  it("cannot satisfy a GPU requirement from an unknown inventory", () => {
    const verdict: NodeCapacityVerdict = nodeCapacityFor(snapshot("node-a"), { requiresGpu: true });
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unknownRequirements).toEqual(["requiresGpu"]);
    expect(verdict.reasons.join(" ")).toContain("cannot be decided");
  });

  it("refuses a GPU requirement when the inventory was read and is genuinely empty", () => {
    const verdict = nodeCapacityFor(snapshot("node-a", { "gpu.devices": measured([], "test", AT) }), { requiresGpu: true });
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unknownRequirements).toEqual([]);
    expect(verdict.reasons.join(" ")).toContain("read and is empty");
  });

  it("satisfies a GPU requirement from a real device", () => {
    const verdict = nodeCapacityFor(snapshot("node-a", { "gpu.devices": measured([{ name: "gpu", vramMb: 8192 }], "test", AT) }), { requiresGpu: true });
    expect(verdict.satisfied).toBe(true);
    expect(verdict.unknownRequirements).toEqual([]);
  });

  it("cannot satisfy a free-memory requirement from an unknown free figure", () => {
    const requirement: NodeRequirement = { minFreeMemoryMb: 4096 };
    const verdict = nodeCapacityFor(snapshot("node-a", { "memory.freeMb": unknown("free memory probe failed") }), requirement);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unknownRequirements).toEqual(["minFreeMemoryMb>=4096"]);
  });

  it("reports a measured shortfall separately from an unknown", () => {
    const verdict = nodeCapacityFor(snapshot("node-a", { "memory.freeMb": measured(1024, "test", AT) }), { minFreeMemoryMb: 4096 });
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unknownRequirements).toEqual([]);
    expect(verdict.reasons.join(" ")).toContain("the requirement is not met");
  });

  it("satisfies a set of measured requirements and checks models, providers and tools", () => {
    const verdict = nodeCapacityFor(snapshot("node-a", { localModels: measured(["llama"], "test", AT) }), {
      minLogicalCores: 8,
      minFreeMemoryMb: 1024,
      requiresLocalModel: "llama",
      requiresProvider: "openai",
      requiresTool: "git"
    });
    expect(verdict.satisfied).toBe(true);
    expect(verdict.unknownRequirements).toEqual([]);
    expect(verdict.reasons).toHaveLength(5);
  });

  it("reports a missing provider and a missing tool as measured failures", () => {
    const verdict = nodeCapacityFor(snapshot("node-a"), { requiresProvider: "gemini", requiresTool: "cargo" });
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unknownRequirements).toEqual([]);
  });

  it("satisfies an empty requirement set, which asks for nothing", () => {
    expect(nodeCapacityFor(snapshot("node-a"), {}).satisfied).toBe(true);
  });
});

describe("two nodes are compared only where both were measured", () => {
  it("marks a metric measured on one side only as incomparable", () => {
    const comparison: NodeComparison = compareNodeSnapshots(snapshot("node-a"), snapshot("node-b", { "gpu.devices": measured([{ name: "gpu" }], "test", AT) }));
    expect(comparison.leftNodeId).toBe("node-a");
    expect(comparison.rightNodeId).toBe("node-b");
    const gpu = comparison.metrics.find((metric) => metric.key === "gpu.devices")!;
    expect(gpu.comparable).toBe(false);
    expect(gpu.differs).toBe(false);
    expect(comparison.incomparableMetrics).toContain("gpu.devices");
    expect(comparison.comparableMetrics).toBeLessThan(comparison.metrics.length);
  });

  it("detects a real difference between two measured metrics", () => {
    const comparison = compareNodeSnapshots(snapshot("node-a"), snapshot("node-b", { "memory.totalMb": measured(65536, "test", AT) }));
    const memory = comparison.metrics.find((metric) => metric.key === "memory.totalMb")!;
    expect(memory.comparable).toBe(true);
    expect(memory.differs).toBe(true);
    expect(memory.left).toContain("32768");
    expect(memory.right).toContain("65536");
  });

  it("reports no difference for two identical snapshots", () => {
    expect(nodeSnapshotDelta(snapshot("node-a"), snapshot("node-a"))).toEqual([]);
  });

  it("reports only the metrics that moved between two snapshots of one node", () => {
    const delta: NodeMetricComparison[] = nodeSnapshotDelta(snapshot("node-a"), snapshot("node-a", { "load.processPressure": measured(0.9, "test", AT) }));
    expect(delta.map((metric) => metric.key)).toEqual(["load.processPressure"]);
  });
});

describe("the one-line description names readiness and the gaps", () => {
  it("names the node, its readiness and the metrics it could not observe", () => {
    const text = describeNodeSnapshot(snapshot("node-a"));
    expect(text).toContain("node node-a");
    expect(text).toContain("is READY");
    expect(text).toContain("not measured:");
    expect(text).toContain("gpu.devices");
  });

  it("says UNKNOWN rather than READY when readiness could not be established", () => {
    const text = describeNodeSnapshot(snapshot("node-a", { "cpu.logicalCores": unknown("boom") }));
    expect(text).toContain("is UNKNOWN");
  });
});
