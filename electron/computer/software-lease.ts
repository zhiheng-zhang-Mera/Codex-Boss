import type { SoftwareSession, SoftwareSessionMode } from "../../src/shared/software-session";
import { sessionAllows } from "../../src/shared/software-session";

/**
 * Software Session Registry (plan §16 / AP19 foundation slice). Prevents two
 * tasks from mutating the same software target concurrently: exclusive leases
 * block everyone, shared-read leases coexist with other reads but block
 * exclusive mutation. Owner = (workspace?, task) with a bounded lease.
 */
export class SoftwareLeaseRegistry {
  private readonly sessions = new Map<string, SoftwareSession>();

  /** True when the caller may proceed with `mode` on `target`. */
  canAccess(target: string, mode: SoftwareSessionMode, now = Date.now()): boolean {
    return sessionAllows(this.sessions.get(target), mode, now);
  }

  /** Acquire a lease; throws if a conflicting unexpired lease is held. */
  acquire(input: { owner_workspace?: string; owner_task: string; target: string; mode: SoftwareSessionMode; leaseMs?: number }, now = Date.now()): SoftwareSession {
    const sessionId = `${input.target}/${input.owner_task}/${now}`;
    const existing = this.sessions.get(input.target);
    const leaseMs = input.leaseMs ?? 120000;
    if (existing && existing.lease_until > now && !sessionAllows(existing, input.mode, now)) {
      const holder = existing.owner_workspace ? `${existing.owner_workspace}/${existing.owner_task}` : existing.owner_task;
      throw new Error(`Software target ${input.target} is ${existing.mode} by ${holder}`);
    }
    const session: SoftwareSession = {
      session_id: sessionId,
      ...(input.owner_workspace ? { owner_workspace: input.owner_workspace } : {}),
      owner_task: input.owner_task,
      target: input.target,
      mode: input.mode,
      lease_until: now + leaseMs,
      ...(existing?.state_hash ? { state_hash: existing.state_hash } : {})
    };
    this.sessions.set(input.target, session);
    return structuredClone(session);
  }

  release(target: string, ownerTask: string): void {
    const current = this.sessions.get(target);
    if (current?.owner_task === ownerTask) this.sessions.delete(target);
  }

  held(target: string, now = Date.now()): SoftwareSession | undefined {
    const session = this.sessions.get(target);
    if (session && session.lease_until <= now) this.sessions.delete(target);
    return this.sessions.get(target) && structuredClone(this.sessions.get(target)!);
  }
}
