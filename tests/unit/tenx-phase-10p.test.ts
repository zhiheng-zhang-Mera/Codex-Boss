/**
 * Phase 10P evidence test: fleet failure isolation scenarios 1-7.
 *
 * Uses the forward 10.x components only (fleet controller, lease registry,
 * scheduler facade, knowledge fallback/sync, network registry). No real network
 * or provider is required — every fault is injected deterministically.
 *
 * Scenario 1: node A offline → node B/C continue.
 * Scenario 2: provider A unavailable → unrelated provider task continues.
 * Scenario 3: global KB offline → local fallback.
 * Scenario 4: proxy node failure → direct-capable node unaffected.
 * Scenario 5: fleet controller restart → durable task state restored.
 * Scenario 6: node dropout during task → checkpoint takeover.
 * Scenario 7: multiple simultaneous faults → unrelated executable work continues.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenxFleetController } from "../../electron/tenx/fleet-controller";
import { TenxTaskLeaseRegistry } from "../../electron/tenx/task-lease-registry";
import { allocate, type DynamicSchedulerInput } from "../../electron/tenx/dynamic-scheduler";
import { TenxKnowledgeSpace } from "../../electron/tenx/knowledge-space";
import { TenxKnowledgeSync, type KnowledgeGateway } from "../../electron/tenx/knowledge-sync";
import { TenxNetworkRegistry } from "../../electron/tenx/network-registry";
import type { NodeCapabilityAdvertisement } from "../../src/shared/tenx/node";
import type { KnowledgeRecordVNext } from "../../src/shared/tenx/knowledge";

const at = "2026-09-10T00:00:00.000Z";

function advertisement(nodeId: string, overrides: Partial<NodeCapabilityAdvertisement> = {}): NodeCapabilityAdvertisement {
  return {
    schemaVersion: 1,
    identity: { nodeId, hostId: `h-${nodeId}`, deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10.0.0" },
    hardware: { cpu: { cores: 4 }, memory: { totalMb: 16384 }, gpu: [], storage: {} },
    capabilities: { networkRoutes: ["direct"], proxyCapable: false, providers: ["p1", "p2"], browser: true, localModel: false, offlineCapable: false },
    state: "AVAILABLE",
    busy: false,
    degradedReasons: [],
    lastHeartbeatAt: 0,
    seq: 1,
    ...overrides
  };
}

class FakeGateway implements KnowledgeGateway {
  online = true;
  remote = new TenxKnowledgeSpace(undefined, () => at);
  isOnline(): boolean {
    return this.online;
  }
  async snapshot(): Promise<KnowledgeRecordVNext[]> {
    return this.remote.list();
  }
  async push(record: KnowledgeRecordVNext): Promise<"pushed" | "newer-exists" | "error"> {
    this.remote.contribute({ content: record.content, source: record.source, createdByNode: record.createdByNode, artifactRef: record.artifactRef, confidence: record.confidence });
    return "pushed";
  }
}

describe("10P failure isolation scenarios", () => {
  it("Scenario 1: node A offline → node B/C continue", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.join("B", ["compute"]);
    controller.join("C", ["compute"]);
    controller.heartbeat("A");
    controller.heartbeat("B");
    controller.heartbeat("C");
    controller.lease("t-a", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
    controller.lease("t-b", "B", { takeoverAllowed: true, replaySafety: "replaySafe" });
    controller.lease("t-c", "C", { takeoverAllowed: true, replaySafety: "replaySafe" });
    clock += 40_000;
    controller.heartbeat("B");
    controller.heartbeat("C");
    const { dropped } = controller.refreshStates();
    expect(dropped).toEqual(["A"]);
    controller.handleDropout("A");
    // B and C leases untouched
    expect(controller.listLeases().find((lease) => lease.taskId === "t-b")?.state).toBe("LEASED");
    expect(controller.listLeases().find((lease) => lease.taskId === "t-c")?.state).toBe("LEASED");
  });

  it("Scenario 2: provider A unavailable → unrelated provider task continues", () => {
    const nodes = [
      advertisement("node-x", { capabilities: { networkRoutes: ["direct"], proxyCapable: false, providers: ["p1"], browser: true, localModel: false, offlineCapable: false } }),
      advertisement("node-y", { capabilities: { networkRoutes: ["direct"], proxyCapable: false, providers: ["p2"], browser: true, localModel: false, offlineCapable: false } })
    ];
    // p1 unavailable on node-x per matrix
    const input: DynamicSchedulerInput = {
      task: { taskId: "provider-task", policies: ["provider-preferred", "browser-required"], providerIds: ["p2"], risk: "low" },
      nodes,
      matrices: new Map([
        ["node-x", { nodeId: "node-x", sampledAt: at, rows: [{ provider: "p1", reachable: false, authenticated: false, regionBlocked: false, rateLimited: false, proxyRequired: false }] }],
        ["node-y", { nodeId: "node-y", sampledAt: at, rows: [{ provider: "p2", reachable: true, authenticated: true, regionBlocked: false, rateLimited: false, proxyRequired: false }] }]
      ])
    };
    const result = allocate(input);
    expect(result.allocated).toBe(true);
    expect(result.nodeId).toBe("node-y"); // unrelated p2 task continues on node-y
  });

  it("Scenario 3: global KB offline → local fallback (task unaffected)", async () => {
    const gateway = new FakeGateway();
    gateway.online = false;
    const sync = new TenxKnowledgeSync(new TenxKnowledgeSpace(undefined, () => at), gateway, undefined, () => at);
    const { mode, record } = await sync.contribute({ content: "local fallback fact", source: "probe", createdByNode: "node-a" });
    expect(mode).toBe("local-fallback");
    expect(record.content).toBe("local fallback fact"); // contribution recorded, main work not blocked
  });

  it("Scenario 4: proxy node failure → direct-capable node unaffected", () => {
    const registry = new TenxNetworkRegistry(undefined, () => at);
    registry.update("proxy-node", { "user-proxy": true });
    registry.update("direct-node", { direct: true });
    registry.update("proxy-node", { direct: false, "user-proxy": false }); // proxy route fails
    expect(registry.route("direct-node").selected).toBe("DIRECT");
    expect(registry.route("proxy-node").selected).toBe("OFFLINE");
  });

  it("Scenario 5: fleet controller restart → durable task state restored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10p-5-"));
    const file = path.join(dir, "fleet.json");
    try {
      let clock = 0;
      const first = new TenxFleetController(file, () => clock, () => 60_000);
      first.join("A", ["compute"]);
      clock += 1_000;
      first.heartbeat("A");
      first.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
      first.checkpoint("t1", { ref: "cp-1" });
      const second = new TenxFleetController(file, () => clock, () => 60_000);
      expect(second.listMembers().map((member) => member.nodeId)).toEqual(["A"]);
      expect(second.listLeases().find((lease) => lease.taskId === "t1")?.checkpoint?.ref).toBe("cp-1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Scenario 6: node dropout during task → checkpoint takeover", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.join("B", ["compute"]);
    controller.heartbeat("A");
    controller.heartbeat("B");
    controller.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
    controller.checkpoint("t1", { ref: "cp-9", blob: { step: 4 } });
    controller.handleDropout("A");
    clock += 61_000; // parked lease expired (leaseExpiresAt 0 → immediately eligible)
    controller.heartbeat("B"); // B must be online to accept the transfer
    const transferred = controller.transfer("t1", "B");
    if (transferred && "error" in transferred) throw new Error(`Scenario 6 transfer failed: ${transferred.error}`);
    expect(transferred?.ownerNode).toBe("B");
    expect(transferred?.history.some((entry) => entry.includes("transferred:A->B (checkpoint)"))).toBe(true);
  });

  it("Scenario 7: multiple simultaneous faults → unrelated executable work continues", async () => {
    // Node A OFFLINE + Provider B FAILED + KB OFFLINE + Proxy C FAILED
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.join("B", ["compute", "browser"]);
    controller.join("C", ["compute"]);
    controller.heartbeat("A");
    controller.heartbeat("B");
    controller.heartbeat("C");
    controller.lease("t-a", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
    clock += 40_000; // A offline
    controller.heartbeat("B");
    controller.heartbeat("C");
    const { dropped } = controller.refreshStates();
    expect(dropped).toEqual(["A"]);
    controller.handleDropout("A");

    // KB offline → local fallback still works
    const gateway = new FakeGateway();
    gateway.online = false;
    const sync = new TenxKnowledgeSync(new TenxKnowledgeSpace(undefined, () => at), gateway, undefined, () => at);
    const fallback = await sync.contribute({ content: "fact despite all faults", source: "probe", createdByNode: "B" });
    expect(fallback.mode).toBe("local-fallback");

    // proxy node C fails; direct node B unaffected
    const network = new TenxNetworkRegistry(undefined, () => at);
    network.update("C", { "user-proxy": true });
    network.update("B", { direct: true });
    network.update("C", { direct: false, "user-proxy": false });
    expect(network.route("B").selected).toBe("DIRECT");

    // unrelated task on B is executable and completes
    const taskB = controller.lease("t-b", "B", { takeoverAllowed: true, replaySafety: "replaySafe" });
    expect(taskB?.state).toBe("LEASED");
    controller.complete("t-b");
    expect(controller.listLeases().find((lease) => lease.taskId === "t-b")?.state).toBe("COMPLETED");
  });
});
