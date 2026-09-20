/**
 * Runtime Intelligence Plane — pure derivations over a node capability snapshot.
 *
 * A snapshot is a set of measurements, and the rule that makes the plane worth having is
 * that an absent measurement is not a healthy one. Two consequences are implemented here
 * and asserted in the tests:
 *
 *   - `nodeReadiness` returns UNKNOWN, never READY, when the facts readiness depends on
 *     were not observed. An optional metric that is unknown (a GPU, a plugin list) does
 *     not degrade a node, and a core metric that is unknown does not silently pass either;
 *   - `compareNodeSnapshots` keeps absence visible. Two nodes are only compared on a
 *     metric both actually measured, and a metric measured on one side only is reported
 *     as incomparable rather than being treated as the other side's zero.
 *
 * Everything is pure: no fs, no os, no clock. The profiler collects; this module reasons.
 */

import { describeMeasurement, isMeasured, measurementValue, type Measurement } from "./measurement";
import type { NodeCapabilitySnapshot } from "./contracts";

/** The metric paths a snapshot is compared and reported on. */
export const NODE_METRIC_KEYS = [
  "cpu.logicalCores",
  "cpu.physicalCores",
  "cpu.model",
  "cpu.loadPercent",
  "memory.totalMb",
  "memory.freeMb",
  "gpu.devices",
  "gpu.totalVramMb",
  "disk.freeMb",
  "disk.totalMb",
  "network.availability",
  "network.latencyMs",
  "network.quality",
  "load.currentTasks",
  "load.processPressure",
  "localModels",
  "apis",
  "tools",
  "plugins",
  "repo.locality",
  "repo.warmCacheHints",
  "hostId"
] as const;
export type NodeMetricKey = (typeof NODE_METRIC_KEYS)[number];

/** One metric of one snapshot, flattened so a report or a comparison can iterate it. */
export function nodeMetricFact(snapshot: NodeCapabilitySnapshot, key: NodeMetricKey): Measurement<unknown> {
  switch (key) {
    case "cpu.logicalCores": return snapshot.cpu.logicalCores;
    case "cpu.physicalCores": return snapshot.cpu.physicalCores;
    case "cpu.model": return snapshot.cpu.model;
    case "cpu.loadPercent": return snapshot.cpu.loadPercent;
    case "memory.totalMb": return snapshot.memory.totalMb;
    case "memory.freeMb": return snapshot.memory.freeMb;
    case "gpu.devices": return snapshot.gpu.devices;
    case "gpu.totalVramMb": return snapshot.gpu.totalVramMb;
    case "disk.freeMb": return snapshot.disk.freeMb;
    case "disk.totalMb": return snapshot.disk.totalMb;
    case "network.availability": return snapshot.network.availability;
    case "network.latencyMs": return snapshot.network.latencyMs;
    case "network.quality": return snapshot.network.quality;
    case "load.currentTasks": return snapshot.load.currentTasks;
    case "load.processPressure": return snapshot.load.processPressure;
    case "localModels": return snapshot.localModels;
    case "apis": return snapshot.apis;
    case "tools": return snapshot.tools;
    case "plugins": return snapshot.plugins;
    case "repo.locality": return snapshot.repo.locality;
    case "repo.warmCacheHints": return snapshot.repo.warmCacheHints;
    case "hostId": return snapshot.hostId;
  }
}

/** Every metric of a snapshot as `{ key, fact }`, in the declared order. */
export function nodeMetricFacts(snapshot: NodeCapabilitySnapshot): Array<{ key: NodeMetricKey; fact: Measurement<unknown> }> {
  return NODE_METRIC_KEYS.map((key) => ({ key, fact: nodeMetricFact(snapshot, key) }));
}

/** How much of a node was actually observed. A node with absences lowers this; nothing raises it. */
export function nodeCoverage(snapshot: NodeCapabilitySnapshot): { measured: number; total: number; coverage: number; absentKeys: NodeMetricKey[] } {
  const facts = nodeMetricFacts(snapshot);
  const absentKeys = facts.filter((entry) => !isMeasured(entry.fact)).map((entry) => entry.key);
  const measuredCount = facts.length - absentKeys.length;
  return { measured: measuredCount, total: facts.length, coverage: facts.length === 0 ? 0 : measuredCount / facts.length, absentKeys };
}

export type NodeReadiness = "READY" | "DEGRADED" | "UNKNOWN";

export interface NodeReadinessVerdict {
  readiness: NodeReadiness;
  reasons: string[];
  /** Metrics readiness could not be established from. */
  unknownMetrics: NodeMetricKey[];
}

/**
 * The node's own readiness, derived only from what was measured.
 *
 * The ordering is the decision: an unobserved core fact makes readiness UNKNOWN before any
 * health claim is possible, and a measured-but-pressured node is DEGRADED. A node whose GPU
 * is unknown is still READY if its compute was observed, because a GPU is optional —
 * whereas a node whose CPU count is unknown is UNKNOWN, because that is not.
 */
export function nodeReadiness(snapshot: NodeCapabilitySnapshot): NodeReadinessVerdict {
  const reasons: string[] = [];
  const unknownMetrics: NodeMetricKey[] = [];

  const cores = snapshot.cpu.logicalCores;
  const totalMb = snapshot.memory.totalMb;
  if (!isMeasured(cores)) {
    unknownMetrics.push("cpu.logicalCores");
    reasons.push(`logical cores are ${describeMeasurement(cores)}`);
  } else if ((measurementValue(cores) ?? 0) <= 0) {
    reasons.push("logical cores measured as zero");
    return { readiness: "UNKNOWN", reasons, unknownMetrics };
  }
  if (!isMeasured(totalMb)) {
    unknownMetrics.push("memory.totalMb");
    reasons.push(`total memory is ${describeMeasurement(totalMb)}`);
  } else if ((measurementValue(totalMb) ?? 0) <= 0) {
    reasons.push("total memory measured as zero");
    return { readiness: "UNKNOWN", reasons, unknownMetrics };
  }
  if (unknownMetrics.length > 0) {
    return { readiness: "UNKNOWN", reasons, unknownMetrics };
  }

  const pressure = measurementValue(snapshot.load.processPressure);
  const loadPercent = measurementValue(snapshot.cpu.loadPercent);
  if (pressure !== undefined && pressure >= 0.9) reasons.push(`memory pressure measured at ${pressure.toFixed(2)}`);
  if (loadPercent !== undefined && loadPercent >= 95) reasons.push(`cpu load measured at ${loadPercent.toFixed(0)}%`);
  if (reasons.length > 0) return { readiness: "DEGRADED", reasons, unknownMetrics };

  reasons.push("compute and memory were both observed and neither is under pressure");
  return { readiness: "READY", reasons, unknownMetrics };
}

export interface NodeRequirement {
  minLogicalCores?: number;
  minFreeMemoryMb?: number;
  requiresGpu?: boolean;
  requiresLocalModel?: string;
  requiresProvider?: string;
  requiresTool?: string;
}

export interface NodeCapacityVerdict {
  satisfied: boolean;
  reasons: string[];
  /** Requirements that could not be decided because the fact was not measured. */
  unknownRequirements: string[];
}

/**
 * Whether a node can serve a requirement set.
 *
 * An unmeasured fact can never satisfy a requirement: `requiresGpu` on a node whose GPU was
 * never read yields `unknownRequirements: ["requiresGpu"]` and `satisfied: false`. That is
 * the difference between "this node cannot" and "we do not know whether this node can", and
 * the caller is told which one it is.
 */
export function nodeCapacityFor(snapshot: NodeCapabilitySnapshot, requirement: NodeRequirement): NodeCapacityVerdict {
  const reasons: string[] = [];
  const unknownRequirements: string[] = [];
  let satisfied = true;

  const decide = (name: string, fact: Measurement<unknown>, check: (value: never) => boolean): void => {
    if (!isMeasured(fact)) {
      satisfied = false;
      unknownRequirements.push(name);
      reasons.push(`${name}: cannot be decided because the metric is ${describeMeasurement(fact)}`);
      return;
    }
    if (!check(fact.value as never)) {
      satisfied = false;
      reasons.push(`${name}: measured ${describeMeasurement(fact)} and the requirement is not met`);
    } else {
      reasons.push(`${name}: satisfied (${describeMeasurement(fact)})`);
    }
  };

  if (requirement.minLogicalCores !== undefined) {
    decide(`minLogicalCores>=${requirement.minLogicalCores}`, snapshot.cpu.logicalCores, (value: number) => value >= requirement.minLogicalCores!);
  }
  if (requirement.minFreeMemoryMb !== undefined) {
    decide(`minFreeMemoryMb>=${requirement.minFreeMemoryMb}`, snapshot.memory.freeMb, (value: number) => value >= requirement.minFreeMemoryMb!);
  }
  if (requirement.requiresGpu) {
    if (!isMeasured(snapshot.gpu.devices)) {
      satisfied = false;
      unknownRequirements.push("requiresGpu");
      reasons.push(`requiresGpu: cannot be decided because the gpu inventory is ${describeMeasurement(snapshot.gpu.devices)}`);
    } else if (snapshot.gpu.devices.value.length === 0) {
      satisfied = false;
      reasons.push("requiresGpu: the gpu inventory was read and is empty");
    } else {
      reasons.push(`requiresGpu: satisfied (${snapshot.gpu.devices.value.map((device) => device.name).join(", ")})`);
    }
  }
  if (requirement.requiresLocalModel !== undefined) {
    decide(`requiresLocalModel=${requirement.requiresLocalModel}`, snapshot.localModels, (value: string[]) => value.includes(requirement.requiresLocalModel!));
  }
  if (requirement.requiresProvider !== undefined) {
    decide(`requiresProvider=${requirement.requiresProvider}`, snapshot.apis, (value: string[]) => value.includes(requirement.requiresProvider!));
  }
  if (requirement.requiresTool !== undefined) {
    decide(`requiresTool=${requirement.requiresTool}`, snapshot.tools, (value: string[]) => value.includes(requirement.requiresTool!));
  }

  return { satisfied, reasons, unknownRequirements };
}

export interface NodeMetricComparison {
  key: NodeMetricKey;
  left: string;
  right: string;
  /** False when at least one side did not measure this metric. */
  comparable: boolean;
  differs: boolean;
}

export interface NodeComparison {
  leftNodeId: string;
  rightNodeId: string;
  metrics: NodeMetricComparison[];
  comparableMetrics: number;
  incomparableMetrics: NodeMetricKey[];
}

/** Compares two nodes metric by metric, keeping unmeasured metrics out of the verdict. */
export function compareNodeSnapshots(left: NodeCapabilitySnapshot, right: NodeCapabilitySnapshot): NodeComparison {
  const metrics: NodeMetricComparison[] = [];
  const incomparableMetrics: NodeMetricKey[] = [];
  for (const key of NODE_METRIC_KEYS) {
    const leftFact = nodeMetricFact(left, key);
    const rightFact = nodeMetricFact(right, key);
    const comparable = isMeasured(leftFact) && isMeasured(rightFact);
    if (!comparable) incomparableMetrics.push(key);
    const leftText = describeMeasurement(leftFact);
    const rightText = describeMeasurement(rightFact);
    metrics.push({ key, left: leftText, right: rightText, comparable, differs: comparable && leftText !== rightText });
  }
  return {
    leftNodeId: left.nodeId,
    rightNodeId: right.nodeId,
    metrics,
    comparableMetrics: metrics.length - incomparableMetrics.length,
    incomparableMetrics
  };
}

/** One line naming the node, its readiness and what could not be observed. */
export function describeNodeSnapshot(snapshot: NodeCapabilitySnapshot): string {
  const readiness = nodeReadiness(snapshot);
  const coverage = nodeCoverage(snapshot);
  const absent = coverage.absentKeys.length > 0 ? `; not measured: ${coverage.absentKeys.join(", ")}` : "";
  return `node ${snapshot.nodeId} (${snapshot.identity.os}/${snapshot.identity.arch}) is ${readiness.readiness}: ${coverage.measured}/${coverage.total} metrics observed${absent}`;
}

/**
 * The distinct metrics two snapshots of the SAME node changed on. Used for time-series
 * reporting: a snapshot series can say what moved without inventing values for gaps.
 */
export function nodeSnapshotDelta(previous: NodeCapabilitySnapshot, current: NodeCapabilitySnapshot): NodeMetricComparison[] {
  return compareNodeSnapshots(previous, current).metrics.filter((metric) => metric.differs);
}
