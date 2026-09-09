/**
 * 10C inspection + 10R observability + platform-neutrality guard (pure).
 *
 * NodeCapabilityReport (10C) is the unified self-inspection output; the
 * fleet-level aggregate (10R) is computed from per-node reports/matrices so the
 * Owner never has to read raw logs to judge the fleet.
 */

import type { NodeCapabilityAdvertisement } from "./node";

/** One probe outcome — a probe failure is captured, never thrown upward. */
export interface ProbeVerdict {
  capability: string;
  status: "READY" | "DEGRADED" | "FAILED" | "DISABLED" | "UNKNOWN";
  detail: string;
}

export interface NodeCapabilityReport {
  nodeId: string;
  sampledAt: string;
  identity: NodeCapabilityAdvertisement["identity"];
  hardware: NodeCapabilityAdvertisement["hardware"];
  network: { effective: string; routes: string[] };
  providers: { configured: string[]; authenticated: string[]; reachable: string[] };
  proxy: { systemProxy: boolean; userProxy: boolean; regionalProxy: boolean; providerProxy: boolean };
  verdicts: ProbeVerdict[];
  state: "AVAILABLE" | "DEGRADED" | "OFFLINE" | "BUSY" | "FAILED" | "DISABLED" | "UNKNOWN";
  reason: string;
}

/** 10R aggregate counts across the fleet. */
export interface FleetAggregate {
  nodes: { online: number; degraded: number; offline: number };
  tasks: { running: number; waiting: number; retrying: number; transferred: number; blocked: number };
  providers: { available: number; degraded: number; unavailable: number };
  knowledge: "online" | "local-fallback" | "syncing" | "unknown";
  network: { direct: number; proxy: number; offline: number };
  sampledAt: string;
}

export function aggregateFleet(input: {
  reports: NodeCapabilityReport[];
  knowledge: FleetAggregate["knowledge"];
  networkEffective: string[];
  providerRows: Array<{ reachable: boolean; degraded?: boolean }>;
}): FleetAggregate {
  const stateOf = (report: NodeCapabilityReport): "online" | "degraded" | "offline" =>
    report.state === "OFFLINE" || report.state === "FAILED" || report.state === "DISABLED" ? "offline" : report.state === "DEGRADED" ? "degraded" : "online";
  const nodes = { online: 0, degraded: 0, offline: 0 };
  for (const report of input.reports) {
    const bucket = stateOf(report);
    nodes[bucket] += 1;
  }
  const network = { direct: 0, proxy: 0, offline: 0 };
  for (const route of input.networkEffective) {
    if (route === "OFFLINE") network.offline += 1;
    else if (route === "DIRECT") network.direct += 1;
    else network.proxy += 1;
  }
  const providers = { available: 0, degraded: 0, unavailable: 0 };
  for (const row of input.providerRows) {
    if (row.degraded) providers.degraded += 1;
    else if (row.reachable) providers.available += 1;
    else providers.unavailable += 1;
  }
  return {
    nodes,
    tasks: { running: 0, waiting: 0, retrying: 0, transferred: 0, blocked: 0 },
    providers,
    knowledge: input.knowledge,
    network,
    sampledAt: new Date().toISOString()
  };
}
