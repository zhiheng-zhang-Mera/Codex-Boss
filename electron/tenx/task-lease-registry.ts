import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import {
  canReplay,
  isLeaseValid,
  planTakeover,
  wasLegallyTransferred,
  type ReplaySafety,
  type TaskLeaseState
} from "../../src/shared/tenx/fleet";

/**
 * 10E: durable task lease & ownership registry (forward layer).
 *
 * Task ownership model:
 *   Task { ownerNode, leaseId, leaseExpiresAt, checkpoint, takeoverAllowed,
 *          replaySafety }
 *
 * Invariants enforced here:
 * - one task has at most ONE valid owner at any time (a new lease is refused
 *   while a valid lease exists);
 * - lease expiry makes takeover eligible; takeover must resume from the most
 *   recent durable checkpoint;
 * - replay-unsafe tasks are never blindly re-run without a checkpoint;
 * - once a task is legally transferred away from a node, that node can never
 *   reclaim it (transfer lineage in history), even if it comes back online.
 *
 * Standalone (works with no fleet controller) and durable (restart restores).
 */

export interface TenxLeaseFile {
  schemaVersion: 1;
  leases: TaskLeaseState[];
}

export interface LeaseOptions {
  takeoverAllowed: boolean;
  replaySafety: ReplaySafety;
  leaseMs?: number;
}

export class TenxTaskLeaseRegistry {
  private readonly leases = new Map<string, TaskLeaseState>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => number = Date.now,
    private readonly defaultLeaseMs: number = 60_000
  ) {
    this.restore();
  }

  /** Lease a task to a node. Refuses when a valid owner already exists. */
  lease(taskId: string, ownerNode: string, opts: LeaseOptions): { ok: true; lease: TaskLeaseState } | { ok: false; reason: string } {
    const existing = this.leases.get(taskId);
    if (existing && isLeaseValid(existing, this.now()) && existing.state !== "COMPLETED" && existing.state !== "FAILED") {
      return { ok: false, reason: `task ${taskId} already leased to ${existing.ownerNode}` };
    }
    const lease: TaskLeaseState = {
      taskId,
      ownerNode,
      leaseId: randomUUID(),
      leaseExpiresAt: this.now() + (opts.leaseMs ?? this.defaultLeaseMs),
      takeoverAllowed: opts.takeoverAllowed,
      replaySafety: opts.replaySafety,
      state: "LEASED",
      history: [`leased:${ownerNode}`],
      updatedAt: new Date(this.now()).toISOString()
    };
    this.leases.set(taskId, lease);
    this.persist();
    return { ok: true, lease: structuredClone(lease) };
  }

  checkpoint(taskId: string, ref: string, blob?: unknown): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    if (!lease) return undefined;
    const next: TaskLeaseState = {
      ...lease,
      checkpoint: { ref, blob },
      state: "CHECKPOINTED",
      history: [...lease.history, `checkpoint:${ref}`],
      updatedAt: new Date(this.now()).toISOString()
    };
    this.leases.set(taskId, next);
    this.persist();
    return structuredClone(next);
  }

  /** Take over an expired, takeover-allowed task. Restores from the last durable checkpoint. */
  takeover(taskId: string, newOwner: string): { ok: true; lease: TaskLeaseState } | { ok: false; reason: string } {
    const lease = this.leases.get(taskId);
    if (!lease) return { ok: false, reason: `unknown task ${taskId}` };
    // A node that was legally transferred away may never reclaim.
    if (wasLegallyTransferred(lease, newOwner)) {
      return { ok: false, reason: `${newOwner} may not reclaim ${taskId} after legal transfer` };
    }
    const plan = planTakeover(this.now(), lease, newOwner);
    if (!plan.allowed) return { ok: false, reason: plan.reason };
    const next: TaskLeaseState = {
      ...lease,
      ownerNode: newOwner,
      leaseId: randomUUID(),
      leaseExpiresAt: this.now() + this.defaultLeaseMs,
      state: "TRANSFERRED",
      history: [...lease.history, `transferred:${lease.ownerNode}->${newOwner}${plan.fromCheckpoint ? " (checkpoint)" : ""}`],
      updatedAt: new Date(this.now()).toISOString()
    };
    this.leases.set(taskId, next);
    this.persist();
    return { ok: true, lease: structuredClone(next) };
  }

  markRunning(taskId: string): TaskLeaseState | undefined {
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

  get(taskId: string): TaskLeaseState | undefined {
    const lease = this.leases.get(taskId);
    return lease ? structuredClone(lease) : undefined;
  }

  list(): TaskLeaseState[] {
    return [...this.leases.values()].map((lease) => structuredClone(lease)).sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxLeaseFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.leases)) throw new Error("Invalid tenx lease registry");
    for (const lease of parsed.leases) {
      if (!lease || typeof lease.taskId !== "string" || typeof lease.ownerNode !== "string") throw new Error("Invalid tenx lease record");
      this.leases.set(lease.taskId, lease);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxLeaseFile = { schemaVersion: 1, leases: [...this.leases.values()] };
    writeJson(this.filePath, file);
  }
}

export { canReplay, isLeaseValid, wasLegallyTransferred };
