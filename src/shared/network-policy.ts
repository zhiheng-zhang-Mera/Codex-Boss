/**
 * R43 Phase E (R-501/R-502): network capability probe + proxy route policy
 * (pure + shareable).
 *
 * A node detects which egress routes it actually has: DIRECT, SYSTEM_PROXY,
 * USER_PROXY, REGIONAL_PROXY, PROVIDER_PROXY. Routing is per
 * task × provider × node, direct-first by default; when a proxy fails the
 * ladder is DIRECT → SYSTEM → USER → REGIONAL → PROVIDER → DEGRADE_PROVIDER.
 * A failing proxy module never stops Boss — direct nodes/alternate routes keep
 * working, and the final outcome degrades only the provider, not the process.
 */

export type NetworkCapabilityId = "direct" | "system-proxy" | "user-proxy" | "regional-proxy" | "provider-proxy";

export interface NetworkCapability {
  id: NetworkCapabilityId;
  available: boolean;
  detail?: string;
  providers?: string[];
}

export interface NetworkProbeInput {
  nodeId: string;
  directReachableProviders: string[];
  systemProxyConfigured?: boolean;
  userProxyConfigured?: boolean;
  regionalProxyConfigured?: boolean;
  providerProxyConfigured?: boolean;
}

export interface NetworkProbe {
  nodeId: string;
  capabilities: NetworkCapability[];
  /** Direct-first ordering hint consumed by the route policy. */
  priority: NetworkCapabilityId[];
}

export function probeNetwork(input: NetworkProbeInput): NetworkProbe {
  const capabilities: NetworkCapability[] = [
    { id: "direct", available: input.directReachableProviders.length > 0, detail: `direct:${input.directReachableProviders.length}`, providers: input.directReachableProviders },
    { id: "system-proxy", available: input.systemProxyConfigured === true },
    { id: "user-proxy", available: input.userProxyConfigured === true },
    { id: "regional-proxy", available: input.regionalProxyConfigured === true },
    { id: "provider-proxy", available: input.providerProxyConfigured === true }
  ];
  return { nodeId: input.nodeId, capabilities, priority: ["direct", "system-proxy", "user-proxy", "regional-proxy", "provider-proxy"] };
}

export type RouteOutcome = "DIRECT" | "SYSTEM_PROXY" | "USER_PROXY" | "REGIONAL_PROXY" | "PROVIDER_PROXY" | "DEGRADE_PROVIDER";

export interface RouteDecision {
  route: RouteOutcome;
  reason: string;
}

/** Direct-first unless the task/provider requires a proxy. */
export function resolveRoute(probe: NetworkProbe, targetProvider: string, proxyRequired: boolean): RouteDecision {
  const direct = probe.capabilities.find((capability) => capability.id === "direct")!;
  if (!proxyRequired && direct.available && (direct.providers ?? []).includes(targetProvider)) {
    return { route: "DIRECT", reason: "provider directly reachable; no proxy needed" };
  }
  for (const capability of probe.capabilities.filter((item) => item.id !== "direct")) {
    if (capability.available) return { route: capability.id.toUpperCase().replace("-", "_") as RouteOutcome, reason: `${capability.id} available for provider ${targetProvider}` };
  }
  return { route: "DEGRADE_PROVIDER", reason: `no egress route for ${targetProvider}; degrade provider only` };
}

const FALLBACK_LADDER: RouteOutcome[] = ["DIRECT", "SYSTEM_PROXY", "USER_PROXY", "REGIONAL_PROXY", "PROVIDER_PROXY", "DEGRADE_PROVIDER"];

/** After the current route failed, return the next candidate (never repeats). */
export function fallbackAfterFailure(current: RouteOutcome, probe: NetworkProbe): RouteDecision {
  const index = FALLBACK_LADDER.indexOf(current);
  for (let next = index + 1; next < FALLBACK_LADDER.length; next += 1) {
    const candidate = FALLBACK_LADDER[next];
    if (candidate === "DEGRADE_PROVIDER") return { route: candidate, reason: "all egress routes exhausted; degrade provider (Boss stays running)" };
    const capability = probe.capabilities.find((item) => item.id === candidate.toLowerCase().replace("_", "-"));
    if (capability?.available) return { route: candidate, reason: `fallback after ${current} to ${candidate}` };
  }
  return { route: "DEGRADE_PROVIDER", reason: "no alternate route; degrade provider only" };
}
