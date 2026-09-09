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
