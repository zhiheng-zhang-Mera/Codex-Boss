/**
 * Phase 10C evidence test: device self-inspection → NodeCapabilityReport.
 * A single failing probe is isolated (report still produced, node not crashed);
 * facts are observed-only; report is JSON-serializable.
 */
import { describe, expect, it } from "vitest";
import type { NodeIdentity } from "../../src/shared/tenx/node";
import { inspectDeviceV10, type InspectDeviceOptions } from "../../electron/tenx/device-inspector";

const identity: NodeIdentity = {
  nodeId: "node-a",
  hostId: "host-1",
  deviceType: "desktop",
  os: "windows",
  arch: "x64",
  runtimeVersion: "24.0",
  bossVersion: "10.0.0"
};

const fullFacts: NonNullable<InspectDeviceOptions["facts"]> = {
  cpu: { cores: 8, model: "M1" },
  memory: { totalMb: 16384, freeMb: 8192 },
  gpu: [{ name: "gpu-1", vramMb: 8192 }],
  storage: { freeMb: 500000 },
  runtime: { node: "24.0", browser: "chrome", nativeToolsAvailable: true },
  network: { directReachableProviders: ["p1", "p2"], dnsOk: true, latencyMs: 25 },
  providers: { configured: ["p1", "p2"], authenticated: ["p1"], reachable: ["p1"] },
  proxy: { systemProxyConfigured: false, userProxyConfigured: true, regionalProxyConfigured: false, providerProxyConfigured: false }
};

describe("10C self-inspection", () => {
  it("produces an AVAILABLE report when every probe observes real facts", () => {
    const report = inspectDeviceV10({ nodeId: "node-a", identity, facts: fullFacts, sampledAt: "2026-09-10T00:00:00.000Z" });
    expect(report.state).toBe("AVAILABLE");
    expect(report.identity.nodeId).toBe("node-a");
    expect(report.network.effective).toBe("DIRECT");
    expect(report.providers.reachable).toEqual(["p1"]);
    expect(report.hardware.gpu?.[0].name).toBe("gpu-1");
    expect(report.hardware.cpu.cores).toBe(8);
    expect(report.verdicts.every((v) => v.status === "READY" || v.status === "UNKNOWN")).toBe(true);
  });

  it("degrades honestly when network/provider facts are unobserved", () => {
    const report = inspectDeviceV10({
      nodeId: "node-a",
      identity,
      facts: {
        ...fullFacts,
        network: { directReachableProviders: [], dnsOk: false },
        providers: { configured: ["p1"], authenticated: [], reachable: [] },
        proxy: { systemProxyConfigured: false, userProxyConfigured: false, regionalProxyConfigured: false, providerProxyConfigured: false }
      },
      sampledAt: "2026-09-10T00:00:00.000Z"
    });
    expect(report.state).toBe("DEGRADED");
    expect(report.verdicts.find((v) => v.capability === "network")?.status).toBe("DEGRADED");
    expect(report.verdicts.find((v) => v.capability === "provider")?.status).toBe("DEGRADED");
    expect(report.network.effective).toBe("OFFLINE");
  });

  it("isolates a throwing probe: report still produced, node never crashes", () => {
    const report = inspectDeviceV10({
      nodeId: "node-a",
      identity,
      facts: fullFacts,
      probes: {
        gpu: () => {
          throw new Error("gpu driver crashed");
        },
        network: () => {
          throw new Error("network probe timeout");
        }
      },
      sampledAt: "2026-09-10T00:00:00.000Z"
    });
    expect(report.state).toBe("DEGRADED"); // failed probes degrade; no throw escapes
    expect(report.verdicts.find((v) => v.capability === "gpu")?.status).toBe("FAILED");
    expect(report.verdicts.find((v) => v.capability === "network")?.status).toBe("FAILED");
    expect(report.verdicts.find((v) => v.capability === "cpu")?.status).toBe("READY"); // unrelated probe unaffected
    expect(report.verdicts.find((v) => v.capability === "memory")?.status).toBe("READY");
    expect(report.reason).toContain("probe(s) failed");
  });

  it("keeps the report JSON-serializable (platform-neutral)", () => {
    const report = inspectDeviceV10({ nodeId: "node-a", identity, facts: fullFacts, sampledAt: "2026-09-10T00:00:00.000Z" });
    const round = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(round).toEqual(report);
  });

  it("never fabricates READY for an empty GPU/storage observation", () => {
    const report = inspectDeviceV10({
      nodeId: "node-a",
      identity,
      facts: { ...fullFacts, gpu: [], storage: {} },
      sampledAt: "2026-09-10T00:00:00.000Z"
    });
    expect(report.verdicts.find((v) => v.capability === "gpu")?.status).toBe("UNKNOWN");
    expect(report.verdicts.find((v) => v.capability === "storage")?.status).toBe("UNKNOWN");
  });
});
