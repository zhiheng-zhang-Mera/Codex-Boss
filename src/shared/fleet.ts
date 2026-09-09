/**
 * R43 Phase D (R-401/R-403): Fleet core model + routing (pure, platform-neutral).
 *
 * No Windows-only assumptions: every field is a plain serializable string /
 * number / array. Node lifecycle: READY → (heartbeat missed) DEGRADED → OFFLINE;
 * FAILED/DISABLED never accept work. Assignment routing only ever places work on
 * nodes whose observed state can accept it AND that expose the required
 * capability (a fake/absent capability is never READY). Dropout handling keeps
 * unrelated work untouched and checkpointed work transferable.
 */

export type FleetNodeState = "READY" | "DEGRADED" | "OFFLINE" | "FAILED" | "DISABLED";

export interface FleetNode {
  nodeId: string;
  state: FleetNodeState;
  capabilities: string[];
  lastHeartbeatAt: number;
  seq: number;
}

export type AssignmentState = "QUEUED" | "ASSIGNED" | "RUNNING" | "CHECKPOINTED" | "COMPLETED" | "FAILED";

export interface FleetTask {
  taskId: string;
  requiredCapabilities: string[];
  /** JSON-serializable checkpoint captured by the owning node (resume point). */
  checkpoint?: unknown;
  /** Re-execution safety: when false, a lost node without a checkpoint cannot resume. */
  replaySafe?: boolean;
}

export interface FleetAssignment extends FleetTask {
  state: AssignmentState;
  nodeId?: string;
  attempts: number;
  history: string[];
}

export const FLEET_HEARTBEAT_INTERVAL_MS = 5000;
export const DEGRADED_AFTER_MS = 2 * FLEET_HEARTBEAT_INTERVAL_MS;
export const OFFLINE_AFTER_MS = 6 * FLEET_HEARTBEAT_INTERVAL_MS;

/** Deterministic state from the last observed heartbeat. */
export function nodeStateFor(now: number, node: Pick<FleetNode, "lastHeartbeatAt">): FleetNodeState {
  const age = now - node.lastHeartbeatAt;
  if (age >= OFFLINE_AFTER_MS) return "OFFLINE";
  if (age >= DEGRADED_AFTER_MS) return "DEGRADED";
  return "READY";
}

function acceptsWork(node: FleetNode, task: FleetTask): boolean {
  if (node.state === "FAILED" || node.state === "DISABLED" || node.state === "OFFLINE") return false;
  return task.requiredCapabilities.every((capability) => node.capabilities.includes(capability));
}

/** Deterministic first-fit routing over nodes in join order. */
export function routeTask(task: FleetTask, nodes: FleetNode[]): { assignment: FleetAssignment; note?: string } {
  const candidate = nodes.find((node) => acceptsWork(node, task));
  if (!candidate) {
    return {
      assignment: { ...task, state: "QUEUED", attempts: 0, history: ["queued: no eligible node"] },
      note: "no eligible node"
    };
  }
  return {
    assignment: { ...task, state: "ASSIGNED", nodeId: candidate.nodeId, attempts: 0, history: [`assigned:${candidate.nodeId}`] }
  };
}

/** Node-B dropout: checkpointed work transfers with its checkpoint; unrelated
 *  work stays untouched; uncheckpointed non-replay-safe work fails honestly. */
export function handleNodeDropout(assignments: FleetAssignment[], nodeId: string): FleetAssignment[] {
  return assignments.map((assignment) => {
    if (assignment.nodeId !== nodeId || assignment.state === "COMPLETED") return assignment;
    if (assignment.state === "CHECKPOINTED") {
      return { ...assignment, state: "QUEUED", nodeId: undefined, attempts: assignment.attempts + 1, history: [...assignment.history, `checkpointed:${nodeId} transferred`] };
    }
    if (assignment.replaySafe !== false) {
      return { ...assignment, state: "QUEUED", nodeId: undefined, attempts: assignment.attempts + 1, history: [...assignment.history, `reassign-after-dropout:${nodeId}`] };
    }
    return { ...assignment, state: "FAILED", nodeId: undefined, history: [...assignment.history, `failed:${nodeId} dropped without checkpoint`] };
  });
}
