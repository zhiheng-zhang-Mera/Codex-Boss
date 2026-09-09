/**
 * Phase 10B evidence test: node identity + capability model.
 * Stable nodeId, sessionId/runId separation, dynamic capability refresh,
 * heartbeat-driven state re-derivation, per-node isolation, durable restore.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canAcceptWork, heartbeat, rederiveState, refreshAdvertisement, type NodeCapabilityAdvertisement, type NodeIdentity } from "../../src/shared/tenx/node";
import { TenxNodeRegistry, emptyAdvertisement } from "../../electron/tenx/node-identity-registry";

function sampleIdentity(overrides: Partial<NodeIdentity> = {}): NodeIdentity {
  return {
    nodeId: "node-a",
    hostId: "host-1",
    deviceType: "desktop",
    os: "windows",
    arch: "x64",
    runtimeVersion: "24.0",
    bossVersion: "10.0.0",
    ...overrides
  };
}

function sampleAdvertisement(identity = sampleIdentity(), lastHeartbeatAt = 0): NodeCapabilityAdvertisement {
  return {
    schemaVersion: 1,
    identity,
    hardware: { cpu: { cores: 8 }, memory: { totalMb: 16384 }, gpu: [], storage: { freeMb: 100000 } },
    capabilities: { networkRoutes: ["direct"], proxyCapable: true, providers: ["p1"], browser: true, localModel: false },
    state: "AVAILABLE",
    busy: false,
    degradedReasons: [],
    lastHeartbeatAt,
    seq: 1
  };
}

describe("10B pure node model", () => {
  it("accepts work only when not busy and state allows", () => {
    expect(canAcceptWork({ state: "AVAILABLE", busy: false })).toBe(true);
    expect(canAcceptWork({ state: "DEGRADED", busy: false })).toBe(true);
    expect(canAcceptWork({ state: "OFFLINE", busy: false })).toBe(false);
    expect(canAcceptWork({ state: "AVAILABLE", busy: true })).toBe(false);
  });

  it("refreshes capabilities additively without changing identity or nodeId", () => {
    const base = sampleAdvertisement(sampleIdentity(), 1000);
    const refreshed = refreshAdvertisement(base, {
      capabilities: { providers: ["p1", "p2"], browser: true },
      hardware: { memory: { totalMb: 32768 } }
    });
    expect(refreshed.seq).toBe(base.seq + 1);
    expect(refreshed.identity.nodeId).toBe("node-a");
    expect(refreshed.capabilities.providers).toEqual(["p1", "p2"]);
    expect(refreshed.hardware.memory.totalMb).toBe(32768);
    expect(refreshed.hardware.cpu.cores).toBe(8); // untouched
    expect(refreshed.busy).toBe(false);
  });

  it("heartbeat is a distinct event from capability refresh", () => {
    const base = sampleAdvertisement(sampleIdentity(), 1000);
    const refreshed = refreshAdvertisement(base, { capabilities: { proxyCapable: false } });
    expect(refreshed.lastHeartbeatAt).toBe(1000); // capability refresh must NOT fake a heartbeat
    const beat = heartbeat(base, 9000);
    expect(beat.lastHeartbeatAt).toBe(9000);
    expect(beat.state).toBe("AVAILABLE");
  });

  it("re-derives state from heartbeat age; FAILED/DISABLED stick", () => {
    const base = sampleAdvertisement(sampleIdentity(), 0);
    expect(rederiveState(10_000, base, 30_000, 12_000).state).toBe("AVAILABLE");
    expect(rederiveState(15_000, base, 30_000, 12_000).state).toBe("DEGRADED");
    expect(rederiveState(40_000, base, 30_000, 12_000).state).toBe("OFFLINE");
    const failed = { ...base, state: "FAILED" as const };
    expect(rederiveState(99_000, failed, 30_000, 12_000).state).toBe("FAILED");
  });
});

describe("10B durable node registry", () => {
  it("keeps a stable nodeId across restart, keeps session/run concepts out of the record", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10b-"));
    const file = path.join(dir, "registry.json");
    try {
      const registry = new TenxNodeRegistry(file, () => 1000);
      const first = registry.register(sampleIdentity());
      expect(first.nodeId).toBe("node-a");
      registry.refresh("node-a", { capabilities: { providers: ["p1", "p2"] } });

      // "restart" — new instance, same file
      const again = new TenxNodeRegistry(file, () => 2000);
      const restored = again.status("node-a")!;
      expect(restored.nodeId).toBe("node-a");
      expect(restored.identity.hostId).toBe("host-1");
      expect(restored.advertisement.capabilities.providers).toEqual(["p1", "p2"]);
      // no sessionId/runId fields exist on identity
      expect(Object.keys(restored.identity).includes("sessionId")).toBe(false);
      expect(Object.keys(restored.identity).includes("runId")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-derives OFFLINE when heartbeat is stale but keeps the record", () => {
    const registry = new TenxNodeRegistry(undefined, () => 0);
    registry.register(sampleIdentity());
    registry.heartbeat("node-a");
    const later = new TenxNodeRegistry(undefined, () => 31_000);
    // registry instance reuse: status uses its own clock, so check pure derivation on a fresh view
    expect(registry.status("node-a")!.advertisement.lastHeartbeatAt).toBe(0);
    // simulate time passing by pure re-derivation
    const derived = rederiveState(31_000, registry.status("node-a")!.advertisement, 30_000, 12_000);
    expect(derived.state).toBe("OFFLINE");
    void later;
  });

  it("isolates nodes: one node's failure never changes another's record", () => {
    const registry = new TenxNodeRegistry(undefined, () => 1000);
    registry.register(sampleIdentity({ nodeId: "node-a" }));
    registry.register(sampleIdentity({ nodeId: "node-b" }));
    registry.heartbeat("node-a");
    registry.heartbeat("node-b");
    registry.setState("node-a", "FAILED", "crash");
    const a = registry.status("node-a")!;
    const b = registry.status("node-b")!;
    expect(a.advertisement.state).toBe("FAILED");
    expect(b.advertisement.state).toBe("AVAILABLE");
  });

  it("deregister removes only the target node", () => {
    const registry = new TenxNodeRegistry(undefined, () => 1000);
    registry.register(sampleIdentity({ nodeId: "node-a" }));
    registry.register(sampleIdentity({ nodeId: "node-b" }));
    expect(registry.deregister("node-a")).toBe(true);
    expect(registry.status("node-a")).toBeUndefined();
    expect(registry.status("node-b")).toBeDefined();
    expect(registry.deregister("node-a")).toBe(false);
  });

  it("emptyAdvertisement is UNKNOWN with an honest degraded reason until first inspection", () => {
    const adv = emptyAdvertisement(sampleIdentity(), 5);
    expect(adv.state).toBe("UNKNOWN");
    expect(adv.degradedReasons).toContain("no self-inspection yet");
    expect(canAcceptWork(adv)).toBe(false);
  });
});
