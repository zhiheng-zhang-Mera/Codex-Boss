/**
 * 10F dynamic scheduler (pure skeleton).
 *
 * The scheduler decides where a task runs from task requirement → node
 * capability → network state → provider availability → load → data locality →
 * proxy requirement → risk → allocation. Every failure must be explainable.
 */

export type AllocationPolicy =
  | "local-preferred"
  | "provider-preferred"
  | "low-latency"
  | "gpu-required"
  | "memory-heavy"
  | "browser-required"
  | "direct-network-required"
  | "proxy-required"
  | "offline-capable";

export const ALLOCATION_POLICIES: readonly AllocationPolicy[] = [
  "local-preferred",
  "provider-preferred",
  "low-latency",
  "gpu-required",
  "memory-heavy",
  "browser-required",
  "direct-network-required",
  "proxy-required",
  "offline-capable"
];

/** Requirements a task places on candidate nodes (platform-neutral). */
export interface TaskRequirements {
  taskId: string;
  policies: AllocationPolicy[];
  providerIds?: string[]; // preferred providers
  minFreeMemoryMb?: number;
  minGpuVramMb?: number;
  directNetworkRequired?: boolean;
  proxyRequired?: boolean;
  offlineCapable?: boolean;
  preferredNode?: string; // local-preferred target
  dataLocality?: { artifactRef?: string; knowledgeIds?: string[] };
  risk: "low" | "medium" | "high";
}

/** The subset of a node's advertisement the scheduler may read. */
export interface SchedulerNodeView {
  nodeId: string;
  state: "AVAILABLE" | "DEGRADED" | "OFFLINE" | "BUSY" | "FAILED" | "DISABLED" | "UNKNOWN";
  busy: boolean;
  providers: string[];
  gpu?: Array<{ name: string; vramMb?: number }>;
  memory?: { totalMb: number };
  browser: boolean;
  networkEffective: "DIRECT" | "SYSTEM_PROXY" | "USER_PROXY" | "REGIONAL_PROXY" | "PROVIDER_PROXY" | "OFFLINE";
  offlineCapable: boolean;
}

export interface AllocationResult {
  allocated: boolean;
  nodeId?: string;
  /** Explainable reason when not allocated, or the deciding note when allocated. */
  reason: string;
  policiesApplied: AllocationPolicy[];
}

/** Deterministic single-policy gate. */
export function policySatisfied(policy: AllocationPolicy, task: TaskRequirements, node: SchedulerNodeView): { ok: boolean; reason?: string } {
  switch (policy) {
    case "local-preferred":
      return task.preferredNode ? { ok: node.nodeId === task.preferredNode, reason: node.nodeId === task.preferredNode ? undefined : `not preferred node (wanted ${task.preferredNode})` } : { ok: true };
    case "provider-preferred":
      return task.providerIds?.length ? { ok: task.providerIds.some((id) => node.providers.includes(id)), reason: "no preferred provider on node" } : { ok: true };
    case "low-latency":
      return { ok: node.state !== "OFFLINE", reason: node.state === "OFFLINE" ? "node offline" : undefined };
    case "gpu-required":
      return { ok: Boolean(node.gpu?.length), reason: "no gpu on node" };
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
  }
}

/** Deterministic full allocation over candidates in join order. */
export function allocateTask(task: TaskRequirements, nodes: SchedulerNodeView[]): AllocationResult {
  for (const node of nodes) {
    if (node.state === "FAILED" || node.state === "DISABLED" || node.busy) continue;
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
      return { allocated: true, nodeId: node.nodeId, reason: `allocated:${node.nodeId}`, policiesApplied: applied };
    }
    // remember last failure for the report
    if (failed) {
      // fallthrough continues scanning; first failing node is not the report
    }
  }
  const firstBlocked = nodes
    .filter((node) => node.state !== "FAILED" && node.state !== "DISABLED" && !node.busy)
    .map((node) => {
      for (const policy of task.policies) {
        const gate = policySatisfied(policy, task, node);
        if (!gate.ok) return `node ${node.nodeId} fails ${policy} (${gate.reason ?? "unknown"})`;
      }
      return undefined;
    })
    .find((reason) => reason !== undefined);
  return { allocated: false, reason: firstBlocked ?? "no eligible node available", policiesApplied: task.policies };
}
