import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import { ALL_ROUTE_IDS, effectiveNetworkState, routePriority, type NodeNetworkReport, type NodeNetworkState, type RouteId } from "../../src/shared/tenx/network";

/**
 * 10L: network routing vNext (forward, durable).
 *
 * Per-node network state (DIRECT / SYSTEM_PROXY / USER_PROXY / REGIONAL_PROXY /
 * PROVIDER_PROXY / OFFLINE). Routing principle: DIRECT first, fall back only
 * when necessary. Each node independently selects its path — no global proxy
 * enforcement. A node's failing route never affects another node.
 */

export interface TenxNetworkFile {
  schemaVersion: 1;
  reports: NodeNetworkReport[];
}

export interface RouteSelection {
  nodeId: string;
  selected: NodeNetworkState;
  availableRoutes: RouteId[];
  reason: string;
}

/** Direct-first route selection from a node's observed route set. */
export function selectRoute(routes: Partial<Record<RouteId, boolean>>, nodeId: string): RouteSelection {
  const available = ALL_ROUTE_IDS.filter((route) => routes[route]);
  const effective = effectiveNetworkState(routes);
  return {
    nodeId,
    selected: effective,
    availableRoutes: available,
    reason: effective === "OFFLINE" ? "no working route observed" : `direct-first selection: ${effective}`
  };
}

export class TenxNetworkRegistry {
  private readonly reports = new Map<string, NodeNetworkReport>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Update one node's observed routes; nodes are isolated records. */
  update(nodeId: string, routes: Partial<Record<RouteId, boolean>>, latencyMs?: number): NodeNetworkReport {
    const report: NodeNetworkReport = {
      nodeId,
      routes,
      effective: effectiveNetworkState(routes),
      latencyMs,
      sampledAt: this.now()
    };
    this.reports.set(nodeId, report);
    this.persist();
    return structuredClone(report);
  }

  /** Route a task's requirement onto the best per-node path (direct-first). */
  route(nodeId: string): RouteSelection {
    const report = this.reports.get(nodeId);
    if (!report) return { nodeId, selected: "OFFLINE", availableRoutes: [], reason: "no network report for node" };
    return selectRoute(report.routes, nodeId);
  }

  status(nodeId: string): NodeNetworkReport | undefined {
    const report = this.reports.get(nodeId);
    return report ? structuredClone(report) : undefined;
  }

  list(): NodeNetworkReport[] {
    return [...this.reports.values()].map((report) => structuredClone(report)).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxNetworkFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.reports)) throw new Error("Invalid tenx network registry");
    for (const report of parsed.reports) {
      if (!report || typeof report.nodeId !== "string") throw new Error("Invalid tenx network report");
      this.reports.set(report.nodeId, report);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxNetworkFile = { schemaVersion: 1, reports: [...this.reports.values()] };
    writeJson(this.filePath, file);
  }
}

export { ALL_ROUTE_IDS, effectiveNetworkState, routePriority };
