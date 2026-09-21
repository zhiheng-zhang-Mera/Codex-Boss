/**
 * Runtime Intelligence Plane — the real node capability profiler.
 *
 * This is the plane's only module that reads the machine, and it reads it through
 * `node:os`, `node:fs` and `node:net` only: no `node:child_process`, because the
 * repository has exactly one declared process gateway and a profiler is not it.
 *
 * Every probe is individually isolated. A probe that throws becomes an absent
 * measurement for that metric and leaves the rest of the snapshot intact, so a machine
 * where a probe fails still produces a snapshot — one that says what it could not see.
 * Nothing here has a default that could be mistaken for a fact:
 *
 *   - `os.loadavg()` reports 0 on Windows, so `cpu.loadPercent` is NOT_MEASURED there
 *     rather than a confident zero;
 *   - physical core count needs a platform probe, so without one it is UNKNOWN;
 *   - GPU inventory and VRAM need a platform probe, so without one they are UNKNOWN —
 *     never an empty list, which would read as "this host has no GPU";
 *   - API availability is derived from which provider credentials are PRESENT in the
 *     environment; the values are never read into the snapshot. Only the names are.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  type GpuDevice,
  type NetworkQuality,
  type NodeCapabilitySnapshot,
  type TrustClass
} from "../../src/shared/runtime-intelligence/contracts";
import { attemptMeasurement, isMeasured, measured, notMeasured, unreadable, unknown, type Measurement } from "../../src/shared/runtime-intelligence/measurement";

/** Provider ids and the environment variable whose presence means the credential exists. */
export const API_PROVIDER_ENV: Readonly<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  google: "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  xai: "XAI_API_KEY"
};

/** Executables a native-tool probe looks for by default. */
export const DEFAULT_TOOL_CANDIDATES: readonly string[] = ["node", "npm", "pnpm", "git", "python", "rg", "code", "cargo", "dotnet"];

function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** The probes a caller may replace. Each is isolated, so one failure costs one metric. */
export interface NodeProbeSet {
  hostId?: () => string;
  cpu?: () => { logicalCores: number; model?: string };
  physicalCores?: () => number;
  memory?: () => { totalMb: number; freeMb: number };
  gpu?: () => GpuDevice[];
  disk?: (target: string) => { freeMb: number; totalMb: number };
  network?: () => { availability: boolean; latencyMs?: number; quality?: NetworkQuality };
  tools?: (candidates: readonly string[]) => string[];
  apiProviders?: () => string[];
  localModels?: () => string[];
  plugins?: () => string[];
  currentTasks?: () => number;
}

export interface NodeProfilerOptions {
  capturedAt: string;
  nodeId?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: string;
  runtimeVersion?: string;
  /** Where the repository lives on this node, for locality and warm-cache hints. */
  repoRoot?: string;
  /** The cache root from `runtimeRoots()`. Never rebuilt by hand here. */
  cacheRoot?: string;
  /** A host that has not been classified is NOT trusted; trust is never the default. */
  trustClass?: TrustClass;
  executionRestrictions?: readonly string[];
  probes?: NodeProbeSet;
  toolCandidates?: readonly string[];
}

/** PATH scan. The `exists` seam is what makes it testable without touching a real PATH. */
export function scanPathForExecutables(
  candidates: readonly string[],
  input: { pathValue?: string; platform?: NodeJS.Platform; exists?: (file: string) => boolean } = {}
): string[] {
  const pathValue = input.pathValue ?? process.env.PATH ?? "";
  const platform = input.platform ?? process.platform;
  const exists = input.exists ?? ((file: string) => fs.existsSync(file));
  // The separator follows the TARGET platform, not the host running this code: a probe
  // asked about a linux PATH must not build Windows paths just because the host is Windows.
  const separator = platform === "win32" ? "\\" : "/";
  const listSeparator = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(listSeparator).filter((entry) => entry.trim() !== "");
  const suffixes = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (directories.some((directory) => suffixes.some((suffix) => exists(`${directory.replace(/[\\/]+$/, "")}${separator}${candidate}${suffix}`)))) found.push(candidate);
  }
  return found.sort();
}

/** Which provider credentials exist in the environment. Names only; values are never read. */
export function detectApiProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(API_PROVIDER_ENV)
    .filter(([, variable]) => typeof env[variable] === "string" && (env[variable] ?? "").trim() !== "")
    .map(([provider]) => provider)
    .sort();
}

/**
 * A real TCP reachability and latency probe.
 *
 * `ECONNREFUSED` is reported as AVAILABLE with the measured latency: the host answered, so
 * the network and the host stack are both up and only the port is closed. A timeout, a DNS
 * failure or a routing failure is UNAVAILABLE. This distinction is why the probe reports
 * quality itself rather than letting a boolean be read as one.
 */
export function probeNetwork(input: { host: string; port?: number; timeoutMs?: number }): Promise<{ availability: boolean; latencyMs?: number; quality: NetworkQuality }> {
  const port = input.port ?? 443;
  const timeoutMs = input.timeoutMs ?? 3000;
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: { availability: boolean; latencyMs?: number; quality: NetworkQuality }): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const qualityFor = (latencyMs: number): NetworkQuality => (latencyMs < 200 ? "DIRECT" : "DEGRADED");
    socket.once("connect", () => {
      const latencyMs = Date.now() - started;
      finish({ availability: true, latencyMs, quality: qualityFor(latencyMs) });
    });
    socket.once("timeout", () => finish({ availability: false, quality: "OFFLINE" }));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      const latencyMs = Date.now() - started;
      if (error.code === "ECONNREFUSED") finish({ availability: true, latencyMs, quality: qualityFor(latencyMs) });
      else finish({ availability: false, quality: "OFFLINE" });
    });
    socket.setTimeout(timeoutMs);
    socket.connect(port, input.host);
  });
}

function defaultCpuProbe(): { logicalCores: number; model?: string } {
  const cpus = os.cpus();
  return { logicalCores: cpus.length, ...(cpus[0]?.model ? { model: cpus[0].model } : {}) };
}

function defaultMemoryProbe(): { totalMb: number; freeMb: number } {
  return { totalMb: megabytes(os.totalmem()), freeMb: megabytes(os.freemem()) };
}

function defaultDiskProbe(target: string): { freeMb: number; totalMb: number } {
  const stats = fs.statfsSync(target);
  const blockSize = Number(stats.bsize);
  return { freeMb: megabytes(Number(stats.bavail) * blockSize), totalMb: megabytes(Number(stats.blocks) * blockSize) };
}

/**
 * Collects one snapshot of this node.
 *
 * A missing probe produces an absent measurement with the reason "no probe is configured",
 * not a zero. The returned snapshot always validates structurally: it is built from
 * measurements, so there is no code path that can put a bare `0` or `[]` where a fact
 * should be.
 */
export function collectNodeSnapshot(options: NodeProfilerOptions): NodeCapabilitySnapshot {
  const at = options.capturedAt;
  const platform = options.platform ?? process.platform;
  const probes = options.probes ?? {};
  const target = options.repoRoot ?? process.cwd();

  const hostIdFact: Measurement<string> = probes.hostId
    ? attemptMeasurement({ source: "node:os.hostname", observedAt: at, probe: probes.hostId, validate: (value) => value.trim() !== "" })
    : attemptMeasurement({ source: "node:os.hostname", observedAt: at, probe: () => os.hostname(), validate: (value) => value.trim() !== "" });
  const nodeId = options.nodeId ?? (isMeasured(hostIdFact) ? hostIdFact.value : "unidentified-node");

  const cpuFact = attemptMeasurement({
    source: "node:os.cpus",
    observedAt: at,
    probe: probes.cpu ?? defaultCpuProbe,
    validate: (value) => Number.isFinite(value.logicalCores) && value.logicalCores >= 0
  });
  const logicalCores: Measurement<number> = isMeasured(cpuFact) ? measured(cpuFact.value.logicalCores, cpuFact.source, at) : cpuFact;
  const cpuModel: Measurement<string> = isMeasured(cpuFact) && cpuFact.value.model !== undefined
    ? measured(cpuFact.value.model, cpuFact.source, at)
    : unknown("the cpu probe reported no model string", "node:os.cpus");

  const physicalCores: Measurement<number> = probes.physicalCores
    ? attemptMeasurement({ source: "probes.physicalCores", observedAt: at, probe: probes.physicalCores, validate: (value) => value > 0 })
    : notMeasured("a physical core count is not available from node:os and no platform probe was provided", "probes.physicalCores");

  const loadPercent: Measurement<number> = platform === "win32"
    ? notMeasured("os.loadavg() reports 0 on Windows, so it is not a load measurement", "node:os.loadavg")
    : (() => {
        const load = attemptMeasurement({ source: "node:os.loadavg", observedAt: at, probe: () => os.loadavg()[0] });
        if (!isMeasured(load) || !isMeasured(logicalCores) || logicalCores.value <= 0) {
          return isMeasured(load) ? unknown("load average cannot be normalised without a logical core count", "node:os.loadavg") : load;
        }
        return measured(Math.round((load.value / logicalCores.value) * 1000) / 10, "node:os.loadavg", at);
      })();

  const memoryFact = attemptMeasurement({
    source: "node:os.totalmem",
    observedAt: at,
    probe: probes.memory ?? defaultMemoryProbe,
    validate: (value) => Number.isFinite(value.totalMb) && Number.isFinite(value.freeMb) && value.totalMb >= 0
  });
  const totalMb: Measurement<number> = isMeasured(memoryFact) ? measured(memoryFact.value.totalMb, memoryFact.source, at) : memoryFact;
  const freeMb: Measurement<number> = isMeasured(memoryFact) ? measured(memoryFact.value.freeMb, memoryFact.source, at) : memoryFact;
  const processPressure: Measurement<number> = isMeasured(totalMb) && isMeasured(freeMb) && totalMb.value > 0
    ? measured(Math.min(1, Math.max(0, 1 - freeMb.value / totalMb.value)), "derived:freemem/totalmem", at)
    : unknown("memory pressure needs both total and free memory to have been measured", "derived:freemem/totalmem");

  const gpuFact: Measurement<GpuDevice[]> = probes.gpu
    ? attemptMeasurement({ source: "probes.gpu", observedAt: at, probe: probes.gpu, validate: (value) => Array.isArray(value) })
    : notMeasured("no GPU probe is configured; inventing an empty inventory would read as 'this host has no GPU'", "probes.gpu");
  const totalVramMb: Measurement<number> = (() => {
    if (!isMeasured(gpuFact)) return unknown("total VRAM is unknown because the GPU inventory is unknown", "probes.gpu");
    const sizes = gpuFact.value.map((device) => device.vramMb);
    if (sizes.some((size) => size === undefined)) return unknown("at least one GPU did not report its VRAM", "probes.gpu");
    return measured(sizes.reduce<number>((total, size) => total + (size ?? 0), 0), "probes.gpu", at);
  })();

  const diskFact = attemptMeasurement({
    source: "node:fs.statfs",
    observedAt: at,
    probe: () => (probes.disk ?? defaultDiskProbe)(target),
    validate: (value) => Number.isFinite(value.freeMb) && Number.isFinite(value.totalMb) && value.totalMb >= 0
  });
  const diskFree: Measurement<number> = isMeasured(diskFact) ? measured(diskFact.value.freeMb, diskFact.source, at) : diskFact;
  const diskTotal: Measurement<number> = isMeasured(diskFact) ? measured(diskFact.value.totalMb, diskFact.source, at) : diskFact;

  const networkFact = probes.network
    ? attemptMeasurement({ source: "probes.network", observedAt: at, probe: probes.network })
    : undefined;
  const networkAvailability: Measurement<boolean> = networkFact === undefined
    ? notMeasured("no network probe was provided; probeNetwork() measures this asynchronously and its result can be passed in", "probes.network")
    : isMeasured(networkFact) ? measured(networkFact.value.availability, networkFact.source, at) : networkFact;
  const networkLatency: Measurement<number> = networkFact !== undefined && isMeasured(networkFact) && networkFact.value.latencyMs !== undefined
    ? measured(networkFact.value.latencyMs, networkFact.source, at)
    : unknown("the network probe did not report a latency", "probes.network");
  const networkQuality: Measurement<NetworkQuality> = (() => {
    if (networkFact === undefined) return notMeasured("no network probe was provided", "probes.network");
    if (!isMeasured(networkFact)) return networkFact;
    if (networkFact.value.quality !== undefined) return measured(networkFact.value.quality, networkFact.source, at);
    if (!networkFact.value.availability) return measured("OFFLINE", networkFact.source, at);
    return unknown("availability was reported without a latency, and quality cannot be derived from a boolean", "probes.network");
  })();

  const toolsFact: Measurement<string[]> = probes.tools
    ? attemptMeasurement({ source: "probes.tools", observedAt: at, probe: () => probes.tools!(options.toolCandidates ?? DEFAULT_TOOL_CANDIDATES), validate: (value) => Array.isArray(value) })
    : attemptMeasurement({ source: "path-scan", observedAt: at, probe: () => scanPathForExecutables(options.toolCandidates ?? DEFAULT_TOOL_CANDIDATES), validate: (value) => Array.isArray(value) });

  const apisFact: Measurement<string[]> = attemptMeasurement({
    source: "provider-credentials-present",
    observedAt: at,
    probe: probes.apiProviders ?? (() => detectApiProviders()),
    validate: (value) => Array.isArray(value)
  });

  const localModelsFact: Measurement<string[]> = probes.localModels
    ? attemptMeasurement({ source: "probes.localModels", observedAt: at, probe: probes.localModels, validate: (value) => Array.isArray(value) })
    : notMeasured("no local model inventory probe is configured", "probes.localModels");

  const pluginsFact: Measurement<string[]> = probes.plugins
    ? attemptMeasurement({ source: "probes.plugins", observedAt: at, probe: probes.plugins, validate: (value) => Array.isArray(value) })
    : notMeasured("no plugin directory was provided to enumerate", "probes.plugins");

  const currentTasksFact: Measurement<number> = probes.currentTasks
    ? attemptMeasurement({ source: "probes.currentTasks", observedAt: at, probe: probes.currentTasks, validate: (value) => Number.isFinite(value) && value >= 0 })
    : notMeasured("the scheduler was not consulted for this snapshot", "probes.currentTasks");

  const localityFact: Measurement<"LOCAL" | "NETWORK" | "ABSENT"> = (() => {
    if (options.repoRoot === undefined) return notMeasured("no repository root was provided", "repo.locality");
    try {
      if (!fs.existsSync(options.repoRoot)) return measured("ABSENT", "repo.locality", at);
      // A UNC path is a network share; a mapped drive letter is indistinguishable from a
      // local disk without a platform probe, which is recorded as a known limitation.
      if (/^\\\\/.test(options.repoRoot)) return measured("NETWORK", "repo.locality", at);
      return measured("LOCAL", "repo.locality", at);
    } catch (error) {
      return unreadable(error instanceof Error ? error.message : String(error), "repo.locality");
    }
  })();

  const warmCacheFact: Measurement<string[]> = (() => {
    if (options.repoRoot === undefined) return notMeasured("no repository root was provided", "repo.warmCacheHints");
    try {
      const hints: string[] = [];
      if (fs.existsSync(path.join(options.repoRoot, ".git"))) hints.push("git-objects");
      if (fs.existsSync(path.join(options.repoRoot, "node_modules"))) hints.push("node-modules");
      if (options.cacheRoot !== undefined && fs.existsSync(options.cacheRoot)) hints.push("app-cache");
      return measured(hints, "repo.warmCacheHints", at);
    } catch (error) {
      return unreadable(error instanceof Error ? error.message : String(error), "repo.warmCacheHints");
    }
  })();

  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "NODE_CAPABILITY_SNAPSHOT",
    nodeId,
    hostId: hostIdFact,
    capturedAt: at,
    identity: {
      deviceType: "unknown",
      os: platform,
      arch: options.arch ?? process.arch,
      runtimeVersion: options.runtimeVersion ?? process.version
    },
    cpu: { logicalCores, physicalCores, model: cpuModel, loadPercent },
    memory: { totalMb, freeMb },
    gpu: { devices: gpuFact, totalVramMb },
    disk: { freeMb: diskFree, totalMb: diskTotal },
    network: { availability: networkAvailability, latencyMs: networkLatency, quality: networkQuality },
    load: { currentTasks: currentTasksFact, processPressure },
    localModels: localModelsFact,
    apis: apisFact,
    tools: toolsFact,
    plugins: pluginsFact,
    repo: { locality: localityFact, warmCacheHints: warmCacheFact },
    trust: {
      trustClass: options.trustClass ?? "UNKNOWN_HOST",
      executionRestrictions: [...(options.executionRestrictions ?? [])]
    }
  };
}
