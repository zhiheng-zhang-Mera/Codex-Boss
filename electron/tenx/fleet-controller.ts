import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import {
  controllerNodeStateFor,
  detectDropouts,
  planTakeover,
  type ControllerNodeState,
  type FleetMemberRecord,
  type ReplaySafety,
  type TaskLeaseState
} from "../../src/shared/tenx/fleet";

/**
 * 10D/10E: forward minimal Fleet Controller (durable).
 *
 * Responsibilities: node registration, deregistration, heartbeat, health state,
 * capability inventory, task lease, task ownership, task transfer, checkpoint
 * awareness and node dropout detection.
 *
 * Rules honored:
 * - a single node never needs this controller to work (it is only a
 *   coordinator; standalone work lives in the node registry/inspector);
 * - controller restart restores durable state (records + leases persisted);
 * - already-leased tasks keep running when the controller is gone (leases are
 *   time-based, no liveness round trip required);
 * - node offline never fails unrelated tasks: dropout only touches leases owned
 *   by the dropped node;
 * - takeover after lease expiry resumes from the most recent durable checkpoint
 *   and never blindly re-runs replay-unsafe tasks without one;
 * - one node's FAILED/OFFLINE never changes another node's record (isolation).
 *
 * Forward development: does not modify the R43 FederationCoordinator.
 */

export interface TenxFleetFile {
  schemaVersion: 1;
  members: FleetMemberRecord[];
  leases: TaskLeaseState[];
}

export class TenxFleetController {
  private readonly members = new Map<string, FleetMemberRecord>();
  private readonly leases = new Map<string, TaskLeaseState>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => number = Date.now,
    private readonly leaseMs: () => number = () => 60_000
  ) {
    this.restore();
  }

  /** Node registration (join). Existing offline node re-joins as READY. */
  join(nodeId: string, capabilityInventory: string[]): FleetMemberRecord {
    const existing = this.members.get(nodeId);
    const member: FleetMemberRecord = {
      nodeId,
      state: existing && existing.state === "OFFLINE" ? "READY" : "READY",
      capabilityInventory: [...new Set(capabilityInventory)].sort(),
      advertisementSeq: (existing?.advertisementSeq ?? 0) + 1,
      lastHeartbeatAt: this.now(),
      joinedAt: existing?.joinedAt ?? new Date(this.now()).toISOString()
    };
    this.members.set(nodeId, member);
    this.persist();
    return structuredClone(member);
  }

  heartbeat(nodeId: string): boolean {
    const member = this.members.get(nodeId);
    if (!member) return false;
    this.members.set(nodeId, { ...member, lastHeartbeatAt: this.now(), state: "READY", advertisementSeq: member.advertisementSeq + 1 });
    this.persist();
    return true;
  }

  deregister(nodeId: string): boolean {
    const existed = this.members.delete(nodeId);
    if (existed) this.persist();
    return existed;
  }

  /** Refresh derived health states; returns node ids that just dropped offline. */
  refreshStates(): { members: FleetMemberRecord[]; dropped: string[] } {
    const now = this.now();
    const dropped = detectDropouts(now, [...this.members.values()]);
    for (const nodeId of dropped) {
      const member = this.members.get(nodeId);
      if (member && member.state !== "OFFLINE") this.members.set(nodeId, { ...member, state: "OFFLINE" });
    }
    this.persist();
    return { members: this.listMembers(), dropped };
  }

  listMembers(): FleetMemberRecord[] {
    const now = this.now();
    return [...this.members.values()]
      .map((member) => ({ ...member, state: controllerNodeStateFor(now, member) }))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
      .map((member) => structuredClone(member));
  }

  /** Capability inventory query used by the scheduler (10F). */
  inventory(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const member of this.listMembers()) {
      if (member.state === "READY" || member.state === "DEGRADED") result[member.nodeId] = member.capabilityInventory;
    }
    return result;
  }

  /** Lease a task to a node (owner must be an online member). */
  lease(taskId: string, ownerNode: string, opts: { takeoverAllowed: boolean; replaySafety: ReplaySafety }): TaskLeaseState | undefined {
    const member = this.members.get(ownerNode);
    const state = member ? controllerNodeStateFor(this.now(), member) : "OFFLINE";
    if (state !== "READY" && state !== "DEGRADED") return undefined;
    const existing = this.leases.get(taskId);
    if (existing && existing.state !== "FAILED" && existing.state !== "COMPLETED") return structuredClone(existing);
    const lease: TaskLeaseState = {
      taskId,
      ownerNode,
      leaseId: randomUUID(),
      leaseExpiresAt: this.now() + this.leaseMs(),
      takeoverAllowed: opts.takeoverAllowed,
      replaySafety: opts.replaySafety,
      state: "LEASED",
      history: [`leased:${ownerNode}`],
      updatedAt: new Date(this.now()).toISOString()
    };
    this.leases.set(taskId, lease);
    this.persist();
    return structuredClone(lease);
  }

  checkpoint(taskId: string, checkpoint: { ref: string; blob?: unknown }): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const next: TaskLeaseState = { ...lease, checkpoint, state: "CHECKPOINTED", history: [...lease.history, `checkpoint:${checkpoint.ref}`], updatedAt: new Date(this.now()).toISOString() };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  /** Transfer an eligible expired lease to another node, resuming from its durable checkpoint. */
  transfer(taskId: string, toNode: string): TaskLeaseState | { error: string } | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const plan = planTakeover(this.now(), lease, toNode);
    if (!plan.allowed) return { error: plan.reason };
    const target = this.members.get(toNode);
    const targetState = target ? controllerNodeStateFor(this.now(), target) : "OFFLINE";
    if (targetState !== "READY" && targetState !== "DEGRADED") return { error: `target ${toNode} not online (${targetState})` };
    const next: TaskLeaseState = {
      ...lease,
      ownerNode: toNode,
      leaseId: randomUUID(),
      leaseExpiresAt: this.now() + this.leaseMs(),
      state: "TRANSFERRED",
      history: [...lease.history, `transferred:${lease.ownerNode}->${toNode}${plan.fromCheckpoint ? " (checkpoint)" : ""}`],
      updatedAt: new Date(this.now()).toISOString()
    };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  /** Re-lease a transferred task onto its new owner for execution. */
  activate(taskId: string): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const next: TaskLeaseState = { ...lease, state: "RUNNING", history: [...lease.history, "running"], updatedAt: new Date(this.now()).toISOString() };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  complete(taskId: string): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const next: TaskLeaseState = { ...lease, state: "COMPLETED", history: [...lease.history, "completed"], updatedAt: new Date(this.now()).toISOString() };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  fail(taskId: string, reason: string): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const next: TaskLeaseState = { ...lease, state: "FAILED", history: [...lease.history, `failed:${reason}`], updatedAt: new Date(this.now()).toISOString() };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  /** Dropout handling: only leases owned by the dropped node are touched.
   *  Recoverable + takeover-allowed leases (durable checkpoint, or replay-safe)
   *  park as QUEUED with an expired lease so any online node can take them over
   *  via transfer(); a lease that forbids takeover fails honestly when its only
   *  owner drops; replay-unsafe work without a checkpoint fails honestly (never
   *  blind re-run). Unrelated tasks are never touched. */
  handleDropout(nodeId: string): TaskLeaseState[] {
    const affected: TaskLeaseState[] = [];
    for (const lease of [...this.leases.values()]) {
      if (lease.ownerNode !== nodeId || lease.state === "COMPLETED" || lease.state === "FAILED") continue;
      const recoverable = lease.checkpoint !== undefined || lease.replaySafety === "replaySafe";
      if (recoverable && lease.takeoverAllowed) {
        const next: TaskLeaseState = {
          ...lease,
          state: "QUEUED",
          leaseExpiresAt: 0, // no phantom owner: any eligible node may take over
          history: [...lease.history, `owner-dropped:${nodeId} parked${lease.checkpoint ? " (checkpoint)" : " (replay-safe)"}`],
          updatedAt: new Date(this.now()).toISOString()
        };
        this.leases.set(lease.taskId, next);
        affected.push(structuredClone(next));
      } else {
        const reason = !recoverable
          ? "dropped without checkpoint (replay-unsafe)"
          : "dropped and takeover not allowed";
        const next: TaskLeaseState = {
          ...lease,
          state: "FAILED",
          history: [...lease.history, `failed:${nodeId} ${reason}`],
          updatedAt: new Date(this.now()).toISOString()
        };
        this.leases.set(lease.taskId, next);
        affected.push(structuredClone(next));
      }
    }
    this.persist();
    return affected;
  }

  listLeases(): TaskLeaseState[] {
    return [...this.leases.values()].map((lease) => structuredClone(lease)).sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxFleetFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.members) || !Array.isArray(parsed.leases)) throw new Error("Invalid tenx fleet state");
    for (const member of parsed.members) {
      if (!member || typeof member.nodeId !== "string") throw new Error("Invalid tenx fleet member");
      this.members.set(member.nodeId, member);
    }
    for (const lease of parsed.leases) {
      if (!lease || typeof lease.taskId !== "string") throw new Error("Invalid tenx fleet lease");
      this.leases.set(lease.taskId, lease);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxFleetFile = { schemaVersion: 1, members: [...this.members.values()], leases: [...this.leases.values()] };
    writeJson(this.filePath, file);
  }
}
