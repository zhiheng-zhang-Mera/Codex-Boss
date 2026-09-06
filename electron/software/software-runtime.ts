import { SoftwareLeaseRegistry } from "../computer/software-lease";
import type { SoftwareAction, SoftwareAdapterDeclaration, SoftwareHealth, SoftwareObservation, SoftwareVerification, ArtifactExchange } from "../../src/shared/software-adapter";
import { planSoftwareActions, softwareActionReadsOnly } from "../../src/shared/software-adapter";
import { manifestAllows, type PermissionKind, type PermissionManifest } from "../../src/shared/permission";

/**
 * Generic Software Runtime (plan §21). One registry per adapter kind:
 *  - declared adapter (id/kind/version/capabilities/contract);
 *  - session ownership through the existing SoftwareLeaseRegistry;
 *  - permission gate: every mutating action must be allowed by the workspace
 *    permission manifest before the executor runs (side-effect allow-list);
 *  - health + recovery surfaces with graceful-absence semantics (adapter may
 *    report unavailable; dispatch then fails closed instead of hanging);
 *  - artifact exchange log (export/import with checksum).
 * The executor itself is injected (real adapter = bpy/CLI bridge; tests use a
 * deterministic fake), so this module stays an orchestration/control surface.
 */

export interface SoftwareExecutor {
  /** Runs one structured action; throws to signal a hard failure. */
  run(action: SoftwareAction): Promise<SoftwareObservation>;
}

export interface SoftwareExecutionOptions {
  ownerWorkspace?: string;
  ownerTask: string;
  target: string;
  leaseMs?: number;
}

export class SoftwareSessionRegistry {
  readonly adapter: SoftwareAdapterDeclaration;
  private readonly leases: SoftwareLeaseRegistry;
  private readonly executor: SoftwareExecutor;
  private readonly healthStore = new Map<string, SoftwareHealth>();
  private readonly exchanges: ArtifactExchange[] = [];

  constructor(adapter: SoftwareAdapterDeclaration, executor: SoftwareExecutor, leases: SoftwareLeaseRegistry = new SoftwareLeaseRegistry()) {
    this.adapter = adapter;
    this.executor = executor;
    this.leases = leases;
  }

  /** Executes a bounded plan under an exclusive/shared lease with permission gating. */
  async run(input: { actions: SoftwareAction[]; permission: PermissionManifest; lease?: SoftwareExecutionOptions }): Promise<{ observations: SoftwareObservation[]; verification: SoftwareVerification }> {
    const observations: SoftwareObservation[] = [];
    const mutations = input.actions.filter((action) => !softwareActionReadsOnly(action));
    const exclusive = mutations.length > 0;
    if (input.lease) {
      const leaseMode = exclusive ? "exclusive" : "shared-read";
      if (!this.leases.canAccess(input.lease.target, leaseMode)) throw new Error(`Software target ${input.lease.target} is busy (${leaseMode} denied)`);
      const session = this.leases.acquire({ owner_workspace: input.lease.ownerWorkspace, owner_task: input.lease.ownerTask, target: input.lease.target, mode: leaseMode, leaseMs: input.lease.leaseMs });
      try {
        for (const action of input.actions) {
          if (!softwareActionReadsOnly(action)) this.authorize(action, input.permission);
          observations.push(await this.executor.run(action));
        }
      } finally { this.leases.release(session.target, session.owner_task); }
    } else {
      for (const action of input.actions) {
        if (!softwareActionReadsOnly(action)) this.authorize(action, input.permission);
        observations.push(await this.executor.run(action));
      }
    }
    const verification: SoftwareVerification = observations.every((observation) => observation.status === "SUCCESS") ? { passed: true, message: `${observations.length} observation(s) succeeded` } : { passed: false, message: "One or more software actions did not reach SUCCESS" };
    return { observations, verification };
  }

  /** Plans a bounded action list for requested capabilities (deterministic). */
  plan(requestedCapabilities: string[]) {
    return planSoftwareActions(this.adapter, requestedCapabilities);
  }

  /** Sets/updates the adapter health (e.g. after a CLI detection probe). */
  setHealth(health: SoftwareHealth): void { this.healthStore.set(this.adapter.id, health); }

  health(): SoftwareHealth {
    return this.healthStore.get(this.adapter.id) ?? { id: this.adapter.id, available: false, message: "adapter health not probed", checkedAt: new Date().toISOString() };
  }

  /** Records an artifact exchange edge (export/import). */
  recordExchange(exchange: ArtifactExchange): void { this.exchanges.push(exchange); }
  listExchanges(): ArtifactExchange[] { return [...this.exchanges]; }

  /** Fails closed: every mutation must be allow-listed as a side-effect by the workspace. */
  private authorize(action: SoftwareAction, permission: PermissionManifest): void {
    const kind: PermissionKind = "side-effect";
    if (!manifestAllows(permission, kind, `${this.adapter.id}:${action.capability}`)) {
      throw new Error(`Permission gate denied ${action.capability} on ${this.adapter.id}`);
    }
  }
}
