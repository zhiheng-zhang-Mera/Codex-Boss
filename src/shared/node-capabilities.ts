/**
 * R43 Phase C (R-302): device self-inspection + node capability model (pure).
 *
 * A node reports concrete observed facts (OS/arch/CPU/GPU/RAM/runtime/browser/
 * logged-in web AI / network / load). The registry derives per-capability
 * status and a node state — NEVER from assumptions: a capability is READY only
 * when the probe actually observed it (a fake/absent observation can only yield
 * DEGRADED / UNKNOWN / FAILED). Single node must stay usable without any Fleet.
 */

export type CapabilityStatus = "READY" | "DEGRADED" | "FAILED" | "DISABLED" | "UNKNOWN";
export type NodeState = "UNINITIALIZED" | "CHECKING" | "READY" | "DEGRADED" | "FAILED" | "DISABLED" | "RECOVERING";

export interface NodeProbeData {
  nodeId: string;
  os: { platform: string; arch: string; version: string };
  cpu: { cores: number; model?: string; loadPercent?: number };
  gpu: Array<{ name: string; vramMb?: number }>;
  memory: { totalMb: number; freeMb?: number };
  runtimes: { node?: string; python?: string; browser?: string; shell?: string };
  webLoggedInProviders: string[];
  nativeToolsAvailable: boolean;
  network: { region?: string; directReachableProviders: string[]; proxyCapable: boolean };
  currentTaskCount: number;
  sampledAt: string;
}

export type CapabilityId = "compute" | "memory" | "runtime" | "browser" | "web-ai" | "native-tools" | "network" | "gpu";

export interface CapabilityVerdict {
  id: CapabilityId;
  status: CapabilityStatus;
  detail: string;
}

/** Deterministic derivation: observed facts only → no fake READY. */
export function capabilityVerdicts(data: NodeProbeData): CapabilityVerdict[] {
  const verdicts: CapabilityVerdict[] = [];
  const compute = data.cpu.cores >= 1 && data.memory.totalMb > 0
    ? { status: "READY" as const, detail: `${data.cpu.cores} cores` }
    : { status: "FAILED" as const, detail: "no compute/memory observed" };
  verdicts.push({ id: "compute", ...compute });

  verdicts.push(data.memory.totalMb > 0
    ? { id: "memory", status: data.memory.freeMb === undefined ? "DEGRADED" : "READY", detail: `${data.memory.totalMb} MB` }
    : { id: "memory", status: "FAILED", detail: "no memory observed" });

  verdicts.push({ id: "runtime", status: data.runtimes.node ? "READY" : "UNKNOWN", detail: `node=${data.runtimes.node ?? "absent"}` });
  verdicts.push({ id: "gpu", status: data.gpu.length ? "READY" : "UNKNOWN", detail: data.gpu.length ? data.gpu[0].name : "no gpu observed" });

  // Web-AI is READY only when a provider was OBSERVED logged in — never assumed.
  verdicts.push(data.webLoggedInProviders.length
    ? { id: "web-ai", status: "READY", detail: data.webLoggedInProviders.join(",") }
    : { id: "web-ai", status: "DEGRADED", detail: "no logged-in web AI observed" });

  verdicts.push({ id: "browser", status: data.runtimes.browser ? "READY" : "UNKNOWN", detail: `browser=${data.runtimes.browser ?? "absent"}` });
  verdicts.push({ id: "native-tools", status: data.nativeToolsAvailable ? "READY" : "DEGRADED", detail: data.nativeToolsAvailable ? "native tools available" : "native tools absent" });
  verdicts.push({ id: "network", status: data.network.proxyCapable || data.network.directReachableProviders.length ? "READY" : "DEGRADED", detail: `direct=${data.network.directReachableProviders.length} proxy=${data.network.proxyCapable}` });
  return verdicts;
}

/** Node state: compute FAILED ⇒ FAILED; any DEGRADED core ⇒ DEGRADED; else READY
 *  (optional extras like GPU/browser staying UNKNOWN do not block the node). */
export function nodeStateFor(data: NodeProbeData, verdicts: CapabilityVerdict[]): { state: NodeState; reason: string } {
  const compute = verdicts.find((item) => item.id === "compute")!;
  if (compute.status === "FAILED") return { state: "FAILED", reason: compute.detail };
  const degraded = verdicts.filter((item) => item.status === "DEGRADED");
  if (degraded.length) return { state: "DEGRADED", reason: `degraded: ${degraded.map((item) => item.id).join(", ")}` };
  return { state: "READY", reason: "node self-inspection complete" };
}
