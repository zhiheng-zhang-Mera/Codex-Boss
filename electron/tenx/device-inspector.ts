import os from "node:os";
import { type NodeCapabilityReport, type ProbeVerdict } from "../../src/shared/tenx/inspection";
import { type NodeHardware, type NodeIdentity } from "../../src/shared/tenx/node";

/**
 * 10C: device self-inspection (forward layer).
 *
 * Produces one unified NodeCapabilityReport before a node joins a fleet and on
 * every refresh. Every probe is wrapped: a GPU probe throwing, a network probe
 * timing out or a proxy probe failing is captured as an explicit verdict and
 * NEVER crashes the node or prevents the rest of the report. Probe functions
 * are injectable so deterministic tests never depend on the real host.
 *
 * Report facts are observed-facts-only: unobserved capabilities yield
 * DEGRADED/UNKNOWN/FAILED, never fabricated READY.
 */

export interface DeviceRuntimeFacts {
  node?: string;
  python?: string;
  browser?: string;
  shell?: string;
  nativeToolsAvailable: boolean;
}

export interface DeviceNetworkFacts {
  directReachableProviders: string[];
  latencyMs?: number;
  dnsOk?: boolean;
}

export interface DeviceProviderFacts {
  configured: string[];
  authenticated: string[];
  reachable: string[];
}

export interface DeviceProxyFacts {
  systemProxyConfigured: boolean;
  userProxyConfigured: boolean;
  regionalProxyConfigured: boolean;
  providerProxyConfigured: boolean;
}

export interface InspectDeviceOptions {
  nodeId: string;
  identity: NodeIdentity;
  /** Override every fact source (tests, no host dependency). */
  facts?: {
    cpu: { cores: number; model?: string };
    memory: { totalMb: number; freeMb?: number };
    gpu: NodeHardware["gpu"];
    storage: NodeHardware["storage"];
    runtime?: DeviceRuntimeFacts;
    network?: DeviceNetworkFacts;
    providers?: DeviceProviderFacts;
    proxy?: DeviceProxyFacts;
  };
  /** Individual probe overrides (throws are isolated into FAILED verdicts). */
  probes?: Partial<{
    cpu: () => { cores: number; model?: string };
    memory: () => { totalMb: number; freeMb?: number };
    gpu: () => NodeHardware["gpu"];
    storage: () => NodeHardware["storage"];
    runtime: () => DeviceRuntimeFacts;
    network: () => DeviceNetworkFacts;
    providers: () => DeviceProviderFacts;
    proxy: () => DeviceProxyFacts;
  }>;
  sampledAt?: string;
}

function hostFacts(): NonNullable<InspectDeviceOptions["facts"]> {
  const cpus = os.cpus();
  return {
    cpu: { cores: cpus.length, model: cpus[0]?.model },
    memory: { totalMb: Math.round(os.totalmem() / 1024 / 1024), freeMb: Math.round(os.freemem() / 1024 / 1024) },
    gpu: [],
    storage: {},
    runtime: { node: process.version, nativeToolsAvailable: true },
    network: { directReachableProviders: [], dnsOk: false },
    providers: { configured: [], authenticated: [], reachable: [] },
    proxy: { systemProxyConfigured: false, userProxyConfigured: false, regionalProxyConfigured: false, providerProxyConfigured: false }
  };
}

function probeIsolated<T>(capability: string, probe: () => T): { value?: T; verdict: ProbeVerdict } {
  try {
    return { value: probe(), verdict: { capability, status: "READY", detail: `${capability} probed` } };
  } catch (error) {
    return { verdict: { capability, status: "FAILED", detail: `${capability} probe failed: ${String(error)}` } };
  }
}

export function inspectDeviceV10(options: InspectDeviceOptions): NodeCapabilityReport {
  const defaults = hostFacts();
  const facts = options.facts ?? defaults;
  const sampledAt = options.sampledAt ?? new Date().toISOString();
  const verdicts: ProbeVerdict[] = [];

  const cpu = probeIsolated("cpu", options.probes?.cpu ?? (() => facts.cpu));
  const cpuFacts = cpu.value ?? { cores: 0 };
  verdicts.push(cpu.value ? { capability: "cpu", status: cpu.value.cores > 0 ? "READY" : "DEGRADED", detail: `${cpu.value.cores} cores` } : cpu.verdict);

  const memory = probeIsolated("memory", options.probes?.memory ?? (() => facts.memory));
  const memoryFacts = memory.value ?? { totalMb: 0 };
  verdicts.push(memory.value ? { capability: "memory", status: memory.value.totalMb > 0 ? (memory.value.freeMb === undefined ? "DEGRADED" : "READY") : "FAILED", detail: `${memory.value.totalMb} MB` } : memory.verdict);

  const gpu = probeIsolated("gpu", options.probes?.gpu ?? (() => facts.gpu));
  const gpuFacts = gpu.value ?? [];
  verdicts.push(gpu.value ? (gpu.value.length ? { capability: "gpu", status: "READY", detail: gpu.value[0].name } : { capability: "gpu", status: "UNKNOWN", detail: "no gpu observed" }) : gpu.verdict);

  const storage = probeIsolated("storage", options.probes?.storage ?? (() => facts.storage));
  const storageFacts = storage.value ?? {};
  verdicts.push(storage.value ? (storage.value.freeMb === undefined ? { capability: "storage", status: "UNKNOWN", detail: "free storage not observed" } : { capability: "storage", status: "READY", detail: `${storage.value.freeMb} MB free` }) : storage.verdict);

  const runtime = probeIsolated("runtime", options.probes?.runtime ?? (() => facts.runtime ?? { nativeToolsAvailable: false }));
  const runtimeFacts = runtime.value ?? { nativeToolsAvailable: false };
  verdicts.push(runtime.value ? { capability: "runtime", status: runtime.value.node ? "READY" : "UNKNOWN", detail: `node=${runtime.value.node ?? "absent"} native=${runtime.value.nativeToolsAvailable}` } : runtime.verdict);

  const network = probeIsolated("network", options.probes?.network ?? (() => facts.network ?? { directReachableProviders: [], dnsOk: false }));
  const networkFacts = network.value ?? { directReachableProviders: [], dnsOk: false };
  verdicts.push(network.value ? (network.value.directReachableProviders.length || network.value.dnsOk ? { capability: "network", status: "READY", detail: `direct=${network.value.directReachableProviders.length} dns=${Boolean(network.value.dnsOk)}` } : { capability: "network", status: "DEGRADED", detail: "no direct/dns observed" }) : network.verdict);

  const providers = probeIsolated("providers", options.probes?.providers ?? (() => facts.providers ?? { configured: [], authenticated: [], reachable: [] }));
  const providerFacts = providers.value ?? { configured: [], authenticated: [], reachable: [] };
  verdicts.push(providers.value ? { capability: "provider", status: providers.value.reachable.length ? "READY" : providers.value.configured.length ? "DEGRADED" : "UNKNOWN", detail: `configured=${providers.value.configured.length} reachable=${providers.value.reachable.length}` } : providers.verdict);

  const proxy = probeIsolated("proxy", options.probes?.proxy ?? (() => facts.proxy ?? { systemProxyConfigured: false, userProxyConfigured: false, regionalProxyConfigured: false, providerProxyConfigured: false }));
  const proxyFacts = proxy.value ?? { systemProxyConfigured: false, userProxyConfigured: false, regionalProxyConfigured: false, providerProxyConfigured: false };
  verdicts.push(proxy.value ? { capability: "proxy", status: proxy.value.systemProxyConfigured || proxy.value.userProxyConfigured || proxy.value.regionalProxyConfigured || proxy.value.providerProxyConfigured ? "READY" : "UNKNOWN", detail: "no proxy observed" } : proxy.verdict);

  const hardware: NodeHardware = { cpu: cpuFacts, memory: memoryFacts, gpu: gpuFacts, storage: storageFacts };

  const degraded = verdicts.filter((item) => item.status === "DEGRADED").length;
  const failed = verdicts.filter((item) => item.status === "FAILED").length;
  const state: NodeCapabilityReport["state"] = failed || degraded ? "DEGRADED" : "AVAILABLE";
  const reason = failed ? `${failed} probe(s) failed` : degraded ? `${degraded} degraded probe(s)` : "self-inspection complete";

  return {
    nodeId: options.nodeId,
    sampledAt,
    identity: options.identity,
    hardware,
    network: {
      effective: networkFacts.directReachableProviders.length ? "DIRECT" : proxyFacts.systemProxyConfigured ? "SYSTEM_PROXY" : "OFFLINE",
      routes: networkFacts.directReachableProviders.length ? ["direct"] : proxyFacts.systemProxyConfigured ? ["system-proxy"] : []
    },
    providers: providerFacts,
    proxy: { systemProxy: proxyFacts.systemProxyConfigured, userProxy: proxyFacts.userProxyConfigured, regionalProxy: proxyFacts.regionalProxyConfigured, providerProxy: proxyFacts.providerProxyConfigured },
    verdicts,
    state,
    reason
  };
}
