/**
 * Phase 10F evidence test: dynamic scheduler.
 * Allocation pipeline consumes node capability/network/provider-readiness;
 * failures are explainable (per-node blocked reasons); policy gates:
 * local-preferred, provider-preferred (live matrix), gpu/memory/browser/
 * direct/proxy-required, offline-capable; ordering honors preference.
 */
import { describe, expect, it } from "vitest";
import {
  allocateTask,
  nodeCanHost,
  orderCandidates,
  policySatisfied,
  type SchedulerNodeView,
  type TaskRequirements
} from "../../src/shared/tenx/scheduler";
import { allocate, advertisementToView } from "../../electron/tenx/dynamic-scheduler";
import type { NodeCapabilityAdvertisement } from "../../src/shared/tenx/node";
import type { ProviderMatrix } from "../../src/shared/tenx/network";

function view(overrides: Partial<SchedulerNodeView> = {}): SchedulerNodeView {
  return {
    nodeId: "n1",
    state: "AVAILABLE",
    busy: false,
    providers: [],
    providersReady: [],
    browser: false,
    networkEffective: "DIRECT",
    offlineCapable: false,
    ...overrides
  };
}

function task(overrides: Partial<TaskRequirements> = {}): TaskRequirements {
  return { taskId: "t1", policies: ["local-preferred"], risk: "low", ...overrides };
}

describe("10F policy gates", () => {
  it("gpu-required honors min vram", () => {
    const node = view({ gpu: [{ name: "g", vramMb: 4096 }] });
    expect(policySatisfied("gpu-required", task({ policies: ["gpu-required"] }), node).ok).toBe(true);
    expect(policySatisfied("gpu-required", task({ policies: ["gpu-required"], minGpuVramMb: 8192 }), node).ok).toBe(false);
  });

  it("provider-preferred requires a provider READY per the live matrix", () => {
    const node = view({ providers: ["p1"], providersReady: [] });
    const t = task({ policies: ["provider-preferred"], providerIds: ["p1"] });
    expect(policySatisfied("provider-preferred", t, node).ok).toBe(false); // configured but not ready
    expect(policySatisfied("provider-preferred", t, view({ providers: ["p1"], providersReady: ["p1"] })).ok).toBe(true);
  });

  it("direct/proxy network gates split by route", () => {
    const direct = view({ networkEffective: "DIRECT" });
    const proxied = view({ networkEffective: "USER_PROXY" });
    const offline = view({ networkEffective: "OFFLINE" });
    expect(policySatisfied("direct-network-required", task({ policies: ["direct-network-required"] }), direct).ok).toBe(true);
    expect(policySatisfied("direct-network-required", task({ policies: ["direct-network-required"] }), proxied).ok).toBe(false);
    expect(policySatisfied("proxy-required", task({ policies: ["proxy-required"] }), proxied).ok).toBe(true);
    expect(policySatisfied("proxy-required", task({ policies: ["proxy-required"] }), offline).ok).toBe(false);
  });
});

describe("10F allocation + explainable failure", () => {
  it("allocates to the only eligible node", () => {
    const nodes = [
      view({ nodeId: "a", browser: true, networkEffective: "DIRECT" }),
      view({ nodeId: "b", browser: false })
    ];
    const result = allocateTask(task({ policies: ["browser-required"] }), nodes);
    expect(result.allocated).toBe(true);
    expect(result.nodeId).toBe("a");
  });

  it("explains why each candidate was blocked", () => {
    const nodes = [
      view({ nodeId: "a", gpu: [] }),
      view({ nodeId: "b", gpu: [], memory: { totalMb: 1024 } }),
      view({ nodeId: "c", state: "FAILED" })
    ];
    const result = allocateTask(task({ policies: ["gpu-required", "memory-heavy"], minFreeMemoryMb: 8192 }), nodes);
    expect(result.allocated).toBe(false);
    expect(result.blocked.length).toBeGreaterThanOrEqual(2);
    expect(result.blocked.some((item) => item.nodeId === "a" && item.policy === "gpu-required")).toBe(true);
    expect(result.reason).toContain("no eligible node");
  });

  it("never allocates to busy/failed/disabled/offline nodes", () => {
    const busy = view({ nodeId: "b", state: "AVAILABLE", busy: true });
    const failed = view({ nodeId: "f", state: "FAILED" });
    expect(nodeCanHost(busy)).toBe(false);
    expect(nodeCanHost(failed)).toBe(false);
    expect(allocateTask(task({ policies: [] }), [busy, failed]).allocated).toBe(false);
  });

  it("offline-capable tasks only land on offline-capable nodes", () => {
    const result = allocateTask(task({ policies: ["offline-capable"] }), [view({ nodeId: "x", offlineCapable: false }), view({ nodeId: "y", offlineCapable: true })]);
    expect(result.allocated).toBe(true);
    expect(result.nodeId).toBe("y");
  });

  it("orderCandidates prefers the local-preferred node deterministically", () => {
    const nodes = [view({ nodeId: "a" }), view({ nodeId: "b" })];
    const ordered = orderCandidates(nodes, task({ policies: ["local-preferred"], preferredNode: "b" }));
    expect(ordered[0].nodeId).toBe("b");
  });
});

describe("10F facade (advertisements + provider matrix)", () => {
  function advertisement(overrides: Partial<NodeCapabilityAdvertisement> = {}, nodeId = "n1"): NodeCapabilityAdvertisement {
    return {
      schemaVersion: 1,
      identity: { nodeId, hostId: `h-${nodeId}`, deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10.0.0" },
      hardware: { cpu: { cores: 4 }, memory: { totalMb: 16384 }, gpu: [], storage: {} },
      capabilities: { networkRoutes: ["direct"], proxyCapable: false, providers: [], browser: false, localModel: false, offlineCapable: false },
      state: "AVAILABLE",
      busy: false,
      degradedReasons: [],
      lastHeartbeatAt: 0,
      seq: 1,
      ...overrides
    };
  }

  it("advertisementToView maps advertisement to a scheduler view", () => {
    const adv = advertisement({ capabilities: { networkRoutes: ["direct"], proxyCapable: true, providers: ["p1"], browser: true, localModel: false, offlineCapable: true } });
    const viewNode = advertisementToView(adv);
    expect(viewNode.browser).toBe(true);
    expect(viewNode.networkEffective).toBe("DIRECT");
    expect(viewNode.offlineCapable).toBe(true);
  });

  it("facade uses live provider matrix: configured-but-unreachable provider blocks provider-preferred", () => {
    const adv = advertisement({ capabilities: { networkRoutes: ["direct"], proxyCapable: true, providers: ["p1", "p2"], browser: true, localModel: false, offlineCapable: true } }, "node-a");
    const matrix: ProviderMatrix = {
      nodeId: "node-a",
      sampledAt: "2026-09-10T00:00:00.000Z",
      rows: [
        { provider: "p1", reachable: true, authenticated: true, regionBlocked: false, rateLimited: false, proxyRequired: false },
        { provider: "p2", reachable: false, authenticated: true, regionBlocked: false, rateLimited: false, proxyRequired: false }
      ]
    };
    const result = allocate({
      task: task({ policies: ["provider-preferred"], providerIds: ["p2"] }),
      nodes: [adv],
      matrices: new Map([["node-a", matrix]])
    });
    expect(result.allocated).toBe(false); // p2 configured but unreachable per matrix
    const ok = allocate({
      task: task({ policies: ["provider-preferred"], providerIds: ["p1"] }),
      nodes: [adv],
      matrices: new Map([["node-a", matrix]])
    });
    expect(ok.allocated).toBe(true);
    expect(ok.nodeId).toBe("node-a");
  });

  it("facade failure is explainable when nothing is eligible", () => {
    const adv = advertisement({ capabilities: { networkRoutes: [], proxyCapable: false, providers: [], browser: false, localModel: false, offlineCapable: false } });
    const result = allocate({ task: task({ policies: ["gpu-required"] }), nodes: [adv] });
    expect(result.allocated).toBe(false);
    expect(result.blocked.some((item) => item.nodeId === "n1" && item.policy === "gpu-required")).toBe(true);
  });
});
