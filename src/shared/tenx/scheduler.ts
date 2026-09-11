/**
 * 10F dynamic scheduler (pure).
 *
 * The scheduler decides where a task runs from task requirement → node
 * capability → network state → provider availability → load → data locality →
 * proxy requirement → risk → allocation. Every failure must be explainable:
 * a failed allocation reports which node(s) were blocked and by which policy.
 */

import type { GitHubCapability } from "../github-machine";

export type AllocationPolicy =
  | "local-preferred"
  | "provider-preferred"
  | "low-latency"
  | "gpu-required"
  | "memory-heavy"
  | "browser-required"
  | "direct-network-required"
  | "proxy-required"
  | "offline-capable"
  | "capability-required";

export const ALLOCATION_POLICIES: readonly AllocationPolicy[] = [
  "local-preferred",
  "provider-preferred",
  "low-latency",
  "gpu-required",
  "memory-heavy",
  "browser-required",
  "direct-network-required",
  "proxy-required",
  "offline-capable",
  "capability-required"
];

/** Requirements a task places on candidate nodes (platform-neutral). */
export interface TaskRequirements {
  taskId: string;
  policies: AllocationPolicy[];
  providerIds?: string[]; // preferred providers
  minFreeMemoryMb?: number;
  minGpuVramMb?: number;
  preferredNode?: string; // local-preferred target
  dataLocality?: { artifactRef?: string; knowledgeIds?: string[] };
  risk: "low" | "medium" | "high";
  /** Capability routing remains independent of physical host and performance mode. */
  requiredCapabilities?: GitHubCapability[];
}

/** The subset of a node's advertisement the scheduler may read. */
export interface SchedulerNodeView {
  nodeId: string;
  state: "AVAILABLE" | "DEGRADED" | "OFFLINE" | "BUSY" | "FAILED" | "DISABLED" | "UNKNOWN";
  busy: boolean;
  /** Configured providers on the node. */
  providers: string[];
  /** Providers the node currently has READY per the live matrix (reachable + authenticated + not blocked/limited). */
  providersReady: string[];
  gpu?: Array<{ name: string; vramMb?: number }>;
  memory?: { totalMb: number };
  browser: boolean;
  networkEffective: "DIRECT" | "SYSTEM_PROXY" | "USER_PROXY" | "REGIONAL_PROXY" | "PROVIDER_PROXY" | "OFFLINE";
  offlineCapable: boolean;
  /** Optional live load observation (0..100), used by low-latency ordering. */
  loadPercent?: number;
  capabilities?: Partial<Record<GitHubCapability, boolean>>;
}

export interface AllocationResult {
  allocated: boolean;
  nodeId?: string;
  /** Explainable reason when not allocated, or the deciding note when allocated. */
  reason: string;
  policiesApplied: AllocationPolicy[];
  /** Every candidate node that was blocked and why (empty on success). */
  blocked: Array<{ nodeId: string; policy: AllocationPolicy; reason: string }>;
}

/** Deterministic single-policy gate. */
export function policySatisfied(policy: AllocationPolicy, task: TaskRequirements, node: SchedulerNodeView): { ok: boolean; reason?: string } {
  switch (policy) {
    case "local-preferred":
      return task.preferredNode ? { ok: node.nodeId === task.preferredNode, reason: node.nodeId === task.preferredNode ? undefined : `not preferred node (wanted ${task.preferredNode})` } : { ok: true };
    case "provider-preferred": {
      if (!task.providerIds?.length) return { ok: true };
      const ready = task.providerIds.filter((id) => node.providersReady.includes(id));
      const configured = task.providerIds.filter((id) => node.providers.includes(id));
      if (ready.length) return { ok: true };
      return { ok: false, reason: configured.length ? `preferred provider(s) ${configured.join(",")} not ready on node (matrix)` : "no preferred provider on node" };
    }
    case "low-latency":
      return { ok: node.state !== "OFFLINE", reason: node.state === "OFFLINE" ? "node offline" : undefined };
    case "gpu-required":
      return task.minGpuVramMb ? { ok: (node.gpu ?? []).some((gpu) => (gpu.vramMb ?? 0) >= task.minGpuVramMb!), reason: "insufficient gpu vram" } : { ok: Boolean(node.gpu?.length), reason: "no gpu on node" };
    case "memory-heavy":
      return task.minFreeMemoryMb ? { ok: (node.memory?.totalMb ?? 0) >= task.minFreeMemoryMb, reason: "insufficient memory" } : { ok: true };
    case "browser-required":
      return { ok: node.browser, reason: "no browser capability" };
    case "direct-network-required":
      return { ok: node.networkEffective === "DIRECT", reason: `network is ${node.networkEffective}` };
    case "proxy-required":
      return { ok: node.networkEffective !== "DIRECT" && node.networkEffective !== "OFFLINE", reason: `network is ${node.networkEffective}` };
    case "offline-capable":
      return { ok: node.offlineCapable, reason: "node not offline-capable" };
    case "capability-required": {
      const missing = (task.requiredCapabilities ?? []).filter((capability) => node.capabilities?.[capability] !== true);
      return { ok: missing.length === 0, reason: missing.length ? `missing capabilities: ${missing.join(", ")}` : undefined };
    }
  }
}

/** Can this node host a task at all (not failed/disabled/busy)? */
export function nodeCanHost(node: SchedulerNodeView): boolean {
  return node.state !== "FAILED" && node.state !== "DISABLED" && !node.busy && node.state !== "OFFLINE";
}

/** Deterministic full allocation over candidates in the given order. */
export function allocateTask(task: TaskRequirements, nodes: SchedulerNodeView[]): AllocationResult {
  const blocked: Array<{ nodeId: string; policy: AllocationPolicy; reason: string }> = [];
  for (const node of nodes) {
    if (!nodeCanHost(node)) {
      blocked.push({ nodeId: node.nodeId, policy: task.policies[0], reason: node.busy ? "node busy" : `node state ${node.state}` });
      continue;
    }
    const missingCapabilities = (task.requiredCapabilities ?? []).filter((capability) => node.capabilities?.[capability] !== true);
    if (missingCapabilities.length) {
      blocked.push({ nodeId: node.nodeId, policy: "capability-required", reason: `missing capabilities: ${missingCapabilities.join(", ")}` });
      continue;
    }
    const applied: AllocationPolicy[] = [];
    let failed: { policy: AllocationPolicy; reason?: string } | undefined;
    for (const policy of task.policies) {
      applied.push(policy);
      const gate = policySatisfied(policy, task, node);
      if (!gate.ok) {
        failed = { policy, reason: gate.reason };
        break;
      }
    }
    if (!failed) {
      return { allocated: true, nodeId: node.nodeId, reason: `allocated:${node.nodeId}`, policiesApplied: applied, blocked: [] };
    }
    blocked.push({ nodeId: node.nodeId, policy: failed.policy, reason: failed.reason ?? "unknown" });
  }
  const summary = blocked.length
    ? `no eligible node (${blocked.map((item) => `${item.nodeId}:${item.policy}`).join("; ")})`
    : "no candidate nodes";
  return { allocated: false, reason: summary, policiesApplied: task.policies, blocked };
}

/** Deterministic policy-based candidate ordering (stable; sorts only, never drops). */
export function orderCandidates(nodes: SchedulerNodeView[], task: TaskRequirements): SchedulerNodeView[] {
  const score = (node: SchedulerNodeView): number => {
    let value = 0;
    if (task.preferredNode && node.nodeId === task.preferredNode) value -= 10_000;
    if (task.policies.includes("low-latency")) value += node.loadPercent ?? 50;
    if (task.policies.includes("provider-preferred")) value += node.providersReady.length ? -100 : 100;
    if (node.networkEffective === "DIRECT") value -= 50;
    return value;
  };
  return [...nodes].sort((a, b) => score(a) - score(b) || a.nodeId.localeCompare(b.nodeId));
}
