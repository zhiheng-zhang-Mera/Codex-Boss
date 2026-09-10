/**
 * Phase 10R evidence test: aggregated fleet observability.
 * FleetAggregate folds node/fleet/provider/network/knowledge registries into
 * one Owner-friendly snapshot; a failing source degrades that dimension only
 * (never crashes the collector); history kept; durable restart; pure read path.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aggregateFleet, type NodeCapabilityReport } from "../../src/shared/tenx/inspection";
import { TenxObservability } from "../../electron/tenx/observability";
import { TenxNodeRegistry } from "../../electron/tenx/node-identity-registry";
import { TenxFleetController } from "../../electron/tenx/fleet-controller";
import { TenxProviderMatrixStore } from "../../electron/tenx/provider-matrix";
import { TenxNetworkRegistry } from "../../electron/tenx/network-registry";

const at = "2026-09-10T00:00:00.000Z";

function report(state: NodeCapabilityReport["state"], nodeId: string): NodeCapabilityReport {
  return {
    nodeId,
    sampledAt: at,
    identity: { nodeId, hostId: `h-${nodeId}`, deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10.0.0" },
    hardware: { cpu: { cores: 2 }, memory: { totalMb: 4096 }, gpu: [], storage: {} },
    network: { effective: state === "OFFLINE" ? "OFFLINE" : "DIRECT", routes: [] },
    providers: { configured: [], authenticated: [], reachable: [] },
    proxy: { systemProxy: false, userProxy: false, regionalProxy: false, providerProxy: false },
    verdicts: [],
    state,
    reason: state
  };
}

describe("10R pure aggregation", () => {
  it("counts online/degraded/offline nodes, tasks, providers, network", () => {
    const aggregate = aggregateFleet({
      reports: [report("AVAILABLE", "a"), report("DEGRADED", "b"), report("OFFLINE", "c")],
      tasks: { running: 2, waiting: 1, retrying: 0, transferred: 1, blocked: 1 },
      knowledge: "syncing",
      networkEffective: ["DIRECT", "USER_PROXY", "OFFLINE"],
      providerRows: [{ reachable: true }, { reachable: true, degraded: true }, { reachable: false }],
      sampledAt: at
    });
    expect(aggregate.nodes).toEqual({ online: 1, degraded: 1, offline: 1 });
    expect(aggregate.tasks).toEqual({ running: 2, waiting: 1, retrying: 0, transferred: 1, blocked: 1 });
    expect(aggregate.providers).toEqual({ available: 1, degraded: 1, unavailable: 1 });
    expect(aggregate.network).toEqual({ direct: 1, proxy: 1, offline: 1 });
    expect(aggregate.knowledge).toBe("syncing");
  });
});

describe("10R wired collector", () => {
  it("folds real registries into one snapshot", () => {
    let clock = 0;
    const nodes = new TenxNodeRegistry(undefined, () => clock);
    const fleet = new TenxFleetController(undefined, () => clock, () => 60_000);
    const providers = new TenxProviderMatrixStore(undefined, () => at);
    const networks = new TenxNetworkRegistry(undefined, () => at);

    // node a online, node b offline
    nodes.register({ nodeId: "a", hostId: "h1", deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10" });
    nodes.register({ nodeId: "b", hostId: "h2", deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10" });
    nodes.heartbeat("a");
    clock = 100;
    nodes.heartbeat("b");
    clock = 31_000;
    nodes.heartbeat("a");
    // fleet: a has running lease, b has queued
    fleet.join("a", ["compute"]);
    fleet.join("b", ["compute"]);
    clock = 32_000;
    fleet.heartbeat("a");
    fleet.lease("t1", "a", { takeoverAllowed: true, replaySafety: "replaySafe" });
    fleet.lease("t2", "b", { takeoverAllowed: true, replaySafety: "replaySafe" });
    // providers: one ready, one unreachable
    providers.observe("a", { provider: "p1", reachable: true, authenticated: true });
    providers.observe("a", { provider: "p2", reachable: false, authenticated: false });
    // networks
    networks.update("a", { direct: true });
    networks.update("b", { "user-proxy": true });

    const observability = new TenxObservability({ nodes, fleet, providers, networks }, undefined, () => at);
    const snapshot = observability.snapshot();
    expect(snapshot.nodes.online).toBeGreaterThanOrEqual(1);
    expect(snapshot.providers.available).toBe(1);
    expect(snapshot.providers.unavailable).toBe(1);
    expect(snapshot.network.proxy).toBeGreaterThanOrEqual(1);
  });

  it("a failing source degrades that dimension only — collector never crashes", () => {
    // nodes source that throws on list
    const brokenNodes = {
      list: () => {
        throw new Error("registry corrupt");
      }
    } as unknown as TenxNodeRegistry;
    const observability = new TenxObservability({ nodes: brokenNodes, reports: [report("AVAILABLE", "a")] }, undefined, () => at);
    const snapshot = observability.snapshot();
    expect(snapshot.nodes.online).toBe(1); // fell back to injected reports
  });

  it("keeps bounded history and survives restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10r-"));
    const file = path.join(dir, "obs.json");
    try {
      const first = new TenxObservability({ reports: [report("AVAILABLE", "a")] }, file, () => at);
      first.snapshot();
      const second = new TenxObservability({ reports: [report("AVAILABLE", "a")] }, file, () => at);
      expect(second.history().length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
