import {
  allocateTask,
  orderCandidates,
  type AllocationResult,
  type SchedulerNodeView,
  type TaskRequirements
} from "../../src/shared/tenx/scheduler";
import { type NodeCapabilityAdvertisement, type NodeOperationalState } from "../../src/shared/tenx/node";
import { type ProviderMatrix } from "../../src/shared/tenx/network";

/**
 * 10F: dynamic scheduler facade (forward layer).
 *
 * Turns durable node advertisements (+ the live provider reachability matrix)
 * into scheduler views and runs the deterministic allocation pipeline. Failure
 * is always explainable (see AllocationResult.blocked). Pure + deterministic
 * apart from matrix supply, so unit tests are fully injectable.
 */

export interface DynamicSchedulerInput {
  task: TaskRequirements;
  nodes: NodeCapabilityAdvertisement[];
  /** Live per-node provider matrices consumed for provider readiness (10M). */
  matrices?: Map<string, ProviderMatrix>;
}

function providerReady(advertisement: NodeCapabilityAdvertisement, matrix?: ProviderMatrix): string[] {
  if (!matrix) return advertisement.capabilities.providers; // no live matrix → configured only
  return matrix.rows
    .filter((row) => row.reachable && row.authenticated && !row.regionBlocked && !row.rateLimited)
    .map((row) => row.provider);
}

function operationalToViewState(state: NodeOperationalState): SchedulerNodeView["state"] {
  switch (state) {
    case "AVAILABLE":
      return "AVAILABLE";
    case "DEGRADED":
      return "DEGRADED";
    case "OFFLINE":
      return "OFFLINE";
    case "BUSY":
      return "BUSY";
    case "FAILED":
      return "FAILED";
    case "DISABLED":
      return "DISABLED";
    default:
      return "UNKNOWN";
  }
}

export function advertisementToView(advertisement: NodeCapabilityAdvertisement, matrix?: ProviderMatrix): SchedulerNodeView {
  return {
    nodeId: advertisement.identity.nodeId,
    state: operationalToViewState(advertisement.state),
    busy: advertisement.busy,
    providers: advertisement.capabilities.providers,
    providersReady: providerReady(advertisement, matrix),
    gpu: advertisement.hardware.gpu,
    memory: advertisement.hardware.memory,
    browser: advertisement.capabilities.browser,
    networkEffective: advertisement.capabilities.networkRoutes.includes("direct") ? "DIRECT" : "OFFLINE",
    offlineCapable: advertisement.capabilities.offlineCapable,
    loadPercent: advertisement.hardware.cpu.loadPercent,
    capabilities: advertisement.capabilities.github
  };
}

export function allocate(input: DynamicSchedulerInput): AllocationResult {
  const views = input.nodes.map((node) => advertisementToView(node, input.matrices?.get(node.identity.nodeId)));
  const ordered = orderCandidates(views, input.task);
  return allocateTask(input.task, ordered);
}
