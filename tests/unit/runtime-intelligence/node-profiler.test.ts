import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_PROVIDER_ENV,
  DEFAULT_TOOL_CANDIDATES,
  collectNodeSnapshot,
  detectApiProviders,
  probeNetwork,
  scanPathForExecutables,
  type NodeProfilerOptions,
  type NodeProbeSet
} from "../../../electron/runtime-intelligence/node-profiler";
import { isMeasured, measurementStatus, measurementValue } from "../../../src/shared/runtime-intelligence/measurement";
import { nodeReadiness } from "../../../src/shared/runtime-intelligence/node-profile";

/**
 * Phase C, host half. Two properties are asserted against the real machine and against
 * deliberately broken probes:
 *
 *   1. a probe that fails produces an ABSENT measurement and leaves the rest of the
 *      snapshot intact — it never becomes a zero, an empty list or a healthy default;
 *   2. the real collection path actually reads this host, so the module is not a stub.
 */

const AT = "2026-01-01T00:00:00.000Z";

const servers: net.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function listen(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("the PATH scan and credential detection are real and injectable", () => {
  it("finds an executable through the injected filesystem", () => {
    const found = scanPathForExecutables(["git", "node"], {
      pathValue: ["C:\\tools", "C:\\other"].join(";"),
      platform: "win32",
      exists: (file) => file === "C:\\tools\\git.exe"
    });
    expect(found).toEqual(["git"]);
  });

  it("tries the platform suffixes and reports nothing when nothing is present", () => {
    expect(scanPathForExecutables(["git"], { pathValue: "C:\\tools", platform: "win32", exists: () => false })).toEqual([]);
    expect(scanPathForExecutables(["git"], { pathValue: "/usr/bin", platform: "linux", exists: (file) => file === "/usr/bin/git" })).toEqual(["git"]);
    expect(DEFAULT_TOOL_CANDIDATES).toContain("git");
  });

  it("ignores empty PATH entries instead of scanning the working directory", () => {
    expect(scanPathForExecutables(["git"], { pathValue: ";;", platform: "win32", exists: () => true })).toEqual([]);
  });

  it("detects only the provider credentials that are actually present", () => {
    const env = { [API_PROVIDER_ENV.openai!]: "set", [API_PROVIDER_ENV.deepseek!]: "   " } as NodeJS.ProcessEnv;
    expect(detectApiProviders(env)).toEqual(["openai"]);
    expect(detectApiProviders({})).toEqual([]);
  });

  it("never puts a credential value into the result", () => {
    const env = { [API_PROVIDER_ENV.openai!]: "sk-do-not-leak-me" } as NodeJS.ProcessEnv;
    const text = JSON.stringify(detectApiProviders(env));
    expect(text).not.toContain("sk-do-not-leak-me");
  });
});

describe("the network probe measures a real socket", () => {
  it("reports availability and a latency against a listening port", async () => {
    const port = await listen();
    const result = await probeNetwork({ host: "127.0.0.1", port, timeoutMs: 2000 });
    expect(result.availability).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.quality).toBe("DIRECT");
  });

  it("treats a refused connection as the host being reachable, with the port closed", async () => {
    const port = await listen();
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await probeNetwork({ host: "127.0.0.1", port, timeoutMs: 2000 });
    expect(result.availability).toBe(true);
    expect(result.quality).toBe("DIRECT");
  });

  it("settles with a boolean rather than throwing when nothing answers", async () => {
    const result = await probeNetwork({ host: "127.0.0.1", port: 1, timeoutMs: 200 });
    expect(typeof result.availability).toBe("boolean");
    expect(["DIRECT", "DEGRADED", "OFFLINE"]).toContain(result.quality);
  });
});

describe("a failing probe yields an absent measurement, never a fabricated one", () => {
  const exploding = (): never => {
    throw new Error("probe exploded");
  };

  it("accepts a declared probe set and profiler options", () => {
    const probes: NodeProbeSet = { cpu: () => ({ logicalCores: 4, model: "declared" }), currentTasks: () => 2 };
    const options: NodeProfilerOptions = { capturedAt: AT, nodeId: "declared-node", probes };
    const snapshot = collectNodeSnapshot(options);
    expect(snapshot.nodeId).toBe("declared-node");
    expect(measurementValue(snapshot.cpu.logicalCores)).toBe(4);
    expect(measurementValue(snapshot.cpu.model)).toBe("declared");
    expect(measurementValue(snapshot.load.currentTasks)).toBe(2);
  });

  it("still returns a snapshot when every probe throws", () => {
    const snapshot = collectNodeSnapshot({
      capturedAt: AT,
      repoRoot: process.cwd(),
      probes: { hostId: exploding, cpu: exploding, memory: exploding, disk: exploding, tools: exploding, apiProviders: exploding, physicalCores: exploding, gpu: exploding }
    });
    expect(snapshot.kind).toBe("NODE_CAPABILITY_SNAPSHOT");
    expect(measurementStatus(snapshot.cpu.logicalCores)).toBe("UNREADABLE");
    expect(measurementValue(snapshot.cpu.logicalCores)).toBeUndefined();
    expect(measurementValue(snapshot.memory.totalMb)).toBeUndefined();
    expect(measurementValue(snapshot.disk.freeMb)).toBeUndefined();
    expect(measurementValue(snapshot.tools)).toBeUndefined();
    expect(measurementValue(snapshot.apis)).toBeUndefined();
    expect(snapshot.nodeId).toBe("unidentified-node");
  });

  it("reads a failed probe's reason, so an absence is explainable", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { cpu: exploding } });
    expect(snapshot.cpu.logicalCores.status).toBe("UNREADABLE");
    expect(snapshot.cpu.logicalCores).not.toEqual({ status: "MEASURED", value: 0 });
  });

  it("leaves the GPU unknown rather than reporting an empty inventory", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT });
    expect(measurementStatus(snapshot.gpu.devices)).toBe("NOT_MEASURED");
    expect(measurementValue(snapshot.gpu.devices)).toBeUndefined();
    expect(measurementValue(snapshot.gpu.totalVramMb)).toBeUndefined();
  });

  it("never reports total VRAM when a device did not report its VRAM", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { gpu: () => [{ name: "a", vramMb: 4096 }, { name: "b" }] } });
    expect(isMeasured(snapshot.gpu.devices)).toBe(true);
    expect(measurementValue(snapshot.gpu.totalVramMb)).toBeUndefined();
    expect(snapshot.gpu.totalVramMb.status).toBe("UNKNOWN");
  });

  it("sums VRAM when every device reported it", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { gpu: () => [{ name: "a", vramMb: 4096 }, { name: "b", vramMb: 8192 }] } });
    expect(measurementValue(snapshot.gpu.totalVramMb)).toBe(12288);
  });

  it("does not claim a CPU load of zero on Windows", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, platform: "win32", probes: { cpu: () => ({ logicalCores: 8 }) } });
    expect(measurementStatus(snapshot.cpu.loadPercent)).toBe("NOT_MEASURED");
    expect(measurementValue(snapshot.cpu.loadPercent)).toBeUndefined();
  });

  it("normalises the load average where it is meaningful", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, platform: "linux", probes: { cpu: () => ({ logicalCores: 4 }) } });
    // The real os.loadavg() is used here; whatever it reports must be a number, not a default.
    if (isMeasured(snapshot.cpu.loadPercent)) expect(typeof snapshot.cpu.loadPercent.value).toBe("number");
    else expect(snapshot.cpu.loadPercent.status).toBe("UNKNOWN");
  });

  it("does not invent a physical core count", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { cpu: () => ({ logicalCores: 16 }) } });
    expect(measurementStatus(snapshot.cpu.physicalCores)).toBe("NOT_MEASURED");
    const reported = collectNodeSnapshot({ capturedAt: AT, probes: { cpu: () => ({ logicalCores: 16 }), physicalCores: () => 8 } });
    expect(measurementValue(reported.cpu.physicalCores)).toBe(8);
  });

  it("reports a cpu model as absent when the probe did not supply one", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { cpu: () => ({ logicalCores: 4 }) } });
    expect(measurementValue(snapshot.cpu.model)).toBeUndefined();
    expect(snapshot.cpu.model.status).toBe("UNKNOWN");
  });

  it("does not claim a network quality from availability alone", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { network: () => ({ availability: true }) } });
    expect(measurementValue(snapshot.network.availability)).toBe(true);
    expect(measurementValue(snapshot.network.quality)).toBeUndefined();
    expect(snapshot.network.quality.status).toBe("UNKNOWN");
  });

  it("reports OFFLINE when the probe measured unavailability without a quality", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { network: () => ({ availability: false }) } });
    expect(measurementValue(snapshot.network.quality)).toBe("OFFLINE");
  });

  it("takes an injected network measurement, so the async probe can be reported", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT, probes: { network: () => ({ availability: true, latencyMs: 25, quality: "DIRECT" }) } });
    expect(measurementValue(snapshot.network.latencyMs)).toBe(25);
    expect(measurementValue(snapshot.network.quality)).toBe("DIRECT");
  });

  it("does not assume a host is trusted", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT });
    expect(snapshot.trust.trustClass).toBe("UNKNOWN_HOST");
    expect(snapshot.trust.executionRestrictions).toEqual([]);
    const declared = collectNodeSnapshot({ capturedAt: AT, trustClass: "TRUSTED_HOST", executionRestrictions: ["no-owner-credentials"] });
    expect(declared.trust.trustClass).toBe("TRUSTED_HOST");
    expect(declared.trust.executionRestrictions).toEqual(["no-owner-credentials"]);
  });

  it("reports repository locality as absent when the root does not exist, and unknown when none was given", () => {
    const missing = collectNodeSnapshot({ capturedAt: AT, repoRoot: "Z:\\definitely-missing-root" });
    if (isMeasured(missing.repo.locality)) expect(missing.repo.locality.value).toBe("ABSENT");
    else expect(["UNREADABLE", "NOT_MEASURED"]).toContain(missing.repo.locality.status);
    const none = collectNodeSnapshot({ capturedAt: AT });
    expect(measurementStatus(none.repo.locality)).toBe("NOT_MEASURED");
    expect(measurementValue(none.repo.warmCacheHints)).toBeUndefined();
  });

  it("reports memory pressure from measured memory only", () => {
    const measuredPressure = collectNodeSnapshot({ capturedAt: AT, probes: { memory: () => ({ totalMb: 1000, freeMb: 250 }) } });
    expect(measurementValue(measuredPressure.load.processPressure)).toBeCloseTo(0.75, 6);
    const unmeasured = collectNodeSnapshot({ capturedAt: AT, probes: { memory: exploding } });
    expect(measurementValue(unmeasured.load.processPressure)).toBeUndefined();
  });

  it("does not consult the scheduler when it was not asked", () => {
    const snapshot = collectNodeSnapshot({ capturedAt: AT });
    expect(measurementStatus(snapshot.load.currentTasks)).toBe("NOT_MEASURED");
    const asked = collectNodeSnapshot({ capturedAt: AT, probes: { currentTasks: () => 3 } });
    expect(measurementValue(asked.load.currentTasks)).toBe(3);
  });
});

describe("the profile is real: this host is actually read", () => {
  const snapshot = collectNodeSnapshot({ capturedAt: new Date().toISOString(), repoRoot: process.cwd(), cacheRoot: undefined, probes: { currentTasks: () => 0 } });

  it("reads real cpu and memory from node:os", () => {
    expect(isMeasured(snapshot.cpu.logicalCores)).toBe(true);
    expect(measurementValue(snapshot.cpu.logicalCores) ?? 0).toBeGreaterThan(0);
    expect(isMeasured(snapshot.memory.totalMb)).toBe(true);
    expect(measurementValue(snapshot.memory.totalMb) ?? 0).toBeGreaterThan(0);
    expect(snapshot.identity.arch).toBeTruthy();
    expect(snapshot.identity.runtimeVersion.startsWith("v")).toBe(true);
  });

  it("reads real free disk space for the repository root", () => {
    if (isMeasured(snapshot.disk.freeMb)) {
      expect(snapshot.disk.freeMb.value).toBeGreaterThanOrEqual(0);
      expect(measurementValue(snapshot.disk.totalMb) ?? 0).toBeGreaterThan(0);
    } else {
      // An unsupported filesystem is reported as an absence, which is acceptable; a zero is not.
      expect(["UNREADABLE", "UNAVAILABLE", "NOT_MEASURED"]).toContain(snapshot.disk.freeMb.status);
    }
  });

  it("scans the real PATH for native tools", () => {
    expect(isMeasured(snapshot.tools)).toBe(true);
    // `node` is running this test, so it must be on PATH somewhere.
    expect(snapshot.tools).toBeDefined();
    if (isMeasured(snapshot.tools)) expect(snapshot.tools.value).toContain("node");
  });

  it("reports repository locality for the real checkout", () => {
    expect(isMeasured(snapshot.repo.locality)).toBe(true);
    if (isMeasured(snapshot.repo.locality)) expect(["LOCAL", "NETWORK"]).toContain(snapshot.repo.locality.value);
    if (isMeasured(snapshot.repo.warmCacheHints)) expect(snapshot.repo.warmCacheHints.value).toContain("git-objects");
  });

  it("produces a snapshot the readiness rule can actually judge", () => {
    const readiness = nodeReadiness(snapshot);
    expect(["READY", "DEGRADED"]).toContain(readiness.readiness);
    expect(readiness.unknownMetrics).toEqual([]);
  });

  it("is comparable with itself and stable in shape across two captures", () => {
    const second = collectNodeSnapshot({ capturedAt: new Date().toISOString(), repoRoot: process.cwd() });
    expect(second.schemaVersion).toBe(snapshot.schemaVersion);
    expect(second.kind).toBe(snapshot.kind);
    expect(second.cpu.logicalCores.status).toBe(snapshot.cpu.logicalCores.status);
  });
});
