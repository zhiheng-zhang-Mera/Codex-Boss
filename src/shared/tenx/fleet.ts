/**
 * 10D/10E fleet control plane + task lease & ownership (pure skeleton).
 *
 * Minimal vocabulary for the Fleet Controller and lease model. All messages
 * ride `TenxEnvelope`. Behavior (durable controller, takeover state machine,
 * dropout detection) is added in the owning phases; this file fixes the shapes.
 */

/** Controller-registered node health (heartbeat-driven). */
export type ControllerNodeState = "READY" | "DEGRADED" | "OFFLINE" | "FAILED" | "DISABLED";

export interface FleetMemberRecord {
  nodeId: string;
  state: ControllerNodeState;
  capabilityInventory: string[]; // human/task-readable capability ids
  advertisementSeq: number;
  lastHeartbeatAt: number; // epoch ms
  joinedAt: string;
}

export type FleetMessageKind = "node.join" | "node.heartbeat" | "node.leave" | "task.lease.request" | "task.lease.grant" | "task.checkpoint" | "task.transfer" | "task.complete" | "task.fail";

export interface FleetMessage {
  kind: FleetMessageKind;
  nodeId: string;
  taskId?: string;
  payload?: unknown;
  sentAt: string;
}

/** Task ownership + lease model (taskbook §8). */
export type ReplaySafety = "replaySafe" | "replayUnsafe" | "unknown";

export interface TaskLeaseState {
  taskId: string;
  ownerNode: string;
  leaseId: string;
  leaseExpiresAt: number; // epoch ms
  checkpoint?: { ref: string; blob?: unknown };
  takeoverAllowed: boolean;
  replaySafety: ReplaySafety;
  state: "QUEUED" | "LEASED" | "RUNNING" | "CHECKPOINTED" | "TRANSFERRED" | "COMPLETED" | "FAILED";
  history: string[];
  updatedAt: string;
}

/** Deterministic rules shared by lease logic. */

/** A lease is valid (owned) only while now is before expiry. */
export function isLeaseValid(state: Pick<TaskLeaseState, "leaseExpiresAt">, now: number): boolean {
  return now < state.leaseExpiresAt;
}

/** Expired leases may be taken over only when takeover is allowed. */
export function takeoverEligible(state: Pick<TaskLeaseState, "leaseExpiresAt" | "takeoverAllowed" | "state">, now: number): boolean {
  return state.takeoverAllowed && !isLeaseValid(state, now) && state.state !== "COMPLETED" && state.state !== "FAILED";
}

/** Replay-unsafe tasks without a durable checkpoint must not be blindly re-run. */
export function canReplay(state: Pick<TaskLeaseState, "replaySafety" | "checkpoint">): boolean {
  if (state.replaySafety === "replaySafe") return true;
  if (state.replaySafety === "unknown") return false;
  return state.checkpoint !== undefined;
}

/** 10D: heartbeat cadence defaults for controller-side health derivation. */
export const FLEET10_HEARTBEAT_INTERVAL_MS = 5000;
export const FLEET10_DEGRADED_AFTER_MS = 2 * FLEET10_HEARTBEAT_INTERVAL_MS;
export const FLEET10_OFFLINE_AFTER_MS = 6 * FLEET10_HEARTBEAT_INTERVAL_MS;

/** Deterministic controller node state from last heartbeat (READY → DEGRADED → OFFLINE). */
export function controllerNodeStateFor(now: number, member: Pick<FleetMemberRecord, "lastHeartbeatAt" | "state">): ControllerNodeState {
  if (member.state === "FAILED" || member.state === "DISABLED") return member.state;
  const age = now - member.lastHeartbeatAt;
  if (age >= FLEET10_OFFLINE_AFTER_MS) return "OFFLINE";
  if (age >= FLEET10_DEGRADED_AFTER_MS) return "DEGRADED";
  return "READY";
}

/** Deterministic dropout detection: which members transitioned to OFFLINE between refresh ticks. */
export function detectDropouts(now: number, members: FleetMemberRecord[]): string[] {
  return members.filter((member) => member.state !== "OFFLINE" && controllerNodeStateFor(now, member) === "OFFLINE").map((member) => member.nodeId);
}

/** 10E: takeover from the most recent durable checkpoint (must not blindly replay unsafe tasks). */
export interface TakeoverPlan {
  taskId: string;
  fromNode: string;
  toNode: string;
  fromCheckpoint: boolean; // true when a durable checkpoint exists
  allowed: boolean;
  reason: string;
}

export function planTakeover(now: number, lease: TaskLeaseState, targetNode: string): TakeoverPlan {
  if (lease.state === "COMPLETED" || lease.state === "FAILED") {
    return { taskId: lease.taskId, fromNode: lease.ownerNode, toNode: targetNode, fromCheckpoint: false, allowed: false, reason: `task ${lease.state.toLowerCase()} cannot be taken over` };
  }
  if (isLeaseValid(lease, now)) {
    return { taskId: lease.taskId, fromNode: lease.ownerNode, toNode: targetNode, fromCheckpoint: false, allowed: false, reason: "lease still valid" };
  }
  if (!lease.takeoverAllowed) {
    return { taskId: lease.taskId, fromNode: lease.ownerNode, toNode: targetNode, fromCheckpoint: false, allowed: false, reason: "takeover not allowed" };
  }
  if (!canReplay(lease)) {
    return { taskId: lease.taskId, fromNode: lease.ownerNode, toNode: targetNode, fromCheckpoint: false, allowed: false, reason: "replay-unsafe task without durable checkpoint" };
  }
  return { taskId: lease.taskId, fromNode: lease.ownerNode, toNode: targetNode, fromCheckpoint: lease.checkpoint !== undefined, allowed: true, reason: lease.checkpoint ? "resume from durable checkpoint" : "replay-safe task" };
}

/** 10E: did this lease legally leave the given node (transfer lineage)?
 *  A recovered node must never reclaim a task that was legally transferred
 *  while it was offline — history records every `transferred:<from>-><to>`. */
export function wasLegallyTransferred(lease: TaskLeaseState, nodeId: string): boolean {
  return lease.history.some((entry) => entry.startsWith(`transferred:${nodeId}->`));
}

/** 10E: at most one valid owner exists among a task's lease states. */
export function singleOwner(leases: TaskLeaseState[], now: number, taskId: string): { owners: string[]; violated: boolean } {
  const owners = leases
    .filter((lease) => lease.taskId === taskId && isLeaseValid(lease, now))
    .map((lease) => lease.ownerNode);
  return { owners: [...new Set(owners)], violated: owners.length > 1 };
}

