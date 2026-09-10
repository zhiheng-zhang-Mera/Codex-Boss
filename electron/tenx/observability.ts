import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import { aggregateFleet, type FleetAggregate, type NodeCapabilityReport } from "../../src/shared/tenx/inspection";
import { TenxNodeRegistry } from "./node-identity-registry";
import { TenxFleetController } from "./fleet-controller";
import { TenxProviderMatrixStore } from "./provider-matrix";
import { TenxNetworkRegistry } from "./network-registry";
import { TenxKnowledgeSync } from "./knowledge-sync";

/**
 * 10R: aggregated fleet observability (forward, durable).
 *
 * The Owner should not need raw logs to judge the fleet. This collector folds
 * the forward registries into one FleetAggregate (nodes / tasks / providers /
 * knowledge / network). Any single registry failing must not take the whole
 * snapshot down: each source is read in isolation and a failure leaves that
 * dimension UNKNOWN/degraded, never crashes the collector. UI consumption of
 * this snapshot can never affect background tasks (pure read path).
 */

export interface TenxObservabilityFile {
  schemaVersion: 1;
  snapshots: FleetAggregate[];
}

export interface TenxObservabilitySources {
  nodes?: TenxNodeRegistry;
  fleet?: TenxFleetController;
  providers?: TenxProviderMatrixStore;
  networks?: TenxNetworkRegistry;
  knowledge?: { pendingCount: () => number; gatewayOnline?: () => boolean };
  /** Fallback report producer when node registry is absent (tests). */
  reports?: NodeCapabilityReport[];
}

export class TenxObservability {
  private readonly snapshots: FleetAggregate[] = [];
  private readonly maxHistory = 100;

  constructor(
    private readonly sources: TenxObservabilitySources,
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Build one aggregate snapshot from the wired registries (failure-isolated). */
  snapshot(): FleetAggregate {
    const sampledAt = this.now();
    // nodes
    let reports: NodeCapabilityReport[] = this.sources.reports ?? [];
    try {
      if (this.sources.nodes) {
        const fromRegistry = this.sources.nodes.list().map((record) => {
          const advertisement = record.advertisement;
          return {
            nodeId: record.nodeId,
            sampledAt,
            identity: advertisement.identity,
            hardware: advertisement.hardware,
            network: { effective: advertisement.capabilities.networkRoutes.includes("direct") ? "DIRECT" : "OFFLINE", routes: advertisement.capabilities.networkRoutes },
            providers: { configured: advertisement.capabilities.providers, authenticated: [], reachable: [] },
            proxy: { systemProxy: false, userProxy: false, regionalProxy: false, providerProxy: false },
            verdicts: [],
            state: advertisement.state,
            reason: advertisement.degradedReasons.join(", ")
          } as NodeCapabilityReport;
        });
        if (fromRegistry.length) reports = fromRegistry;
      }
    } catch {
      // nodes dimension unavailable → keep whatever reports we had (possibly empty)
    }

    // tasks
    let tasks: FleetAggregate["tasks"] = { running: 0, waiting: 0, retrying: 0, transferred: 0, blocked: 0 };
    try {
      if (this.sources.fleet) {
        for (const lease of this.sources.fleet.listLeases()) {
          if (lease.state === "RUNNING" || lease.state === "LEASED") tasks.running += 1;
          else if (lease.state === "QUEUED") tasks.waiting += 1;
          else if (lease.state === "TRANSFERRED") tasks.transferred += 1;
          else if (lease.state === "FAILED") tasks.blocked += 1;
        }
      }
    } catch {
      // tasks dimension unavailable
    }

    // providers
    let providerRows: Array<{ reachable: boolean; degraded?: boolean }> = [];
    try {
      if (this.sources.providers) {
        providerRows = this.sources.providers
          .list()
          .flatMap((matrix) => matrix.rows.map((row) => ({ reachable: row.reachable, degraded: row.reachable && (row.rateLimited || row.regionBlocked) })));
      }
    } catch {
      // providers dimension unavailable
    }

    // knowledge mode
    let knowledge: FleetAggregate["knowledge"] = "unknown";
    try {
      if (this.sources.knowledge) {
        const pending = this.sources.knowledge.pendingCount();
        const online = this.sources.knowledge.gatewayOnline?.() ?? true;
        knowledge = pending > 0 ? "syncing" : online ? "online" : "local-fallback";
      }
    } catch {
      // knowledge dimension unavailable
    }

    // network
    let networkEffective: string[] = [];
    try {
      if (this.sources.networks) {
        networkEffective = this.sources.networks.list().map((report) => report.effective);
      }
    } catch {
      // network dimension unavailable
    }

    const aggregate = aggregateFleet({ reports, tasks, providerRows, knowledge, networkEffective, sampledAt });
    this.snapshots.push(aggregate);
    while (this.snapshots.length > this.maxHistory) this.snapshots.shift();
    this.persist();
    return aggregate;
  }

  history(): FleetAggregate[] {
    return [...this.snapshots].map((snapshot) => structuredClone(snapshot));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxObservabilityFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("Invalid tenx observability store");
    this.snapshots.push(...parsed.snapshots.slice(-this.maxHistory));
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxObservabilityFile = { schemaVersion: 1, snapshots: this.snapshots };
    writeJson(this.filePath, file);
  }
}
