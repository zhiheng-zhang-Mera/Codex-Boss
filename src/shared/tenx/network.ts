/**
 * 10L/10M network routing + provider matrix (pure skeleton).
 *
 * Per-node network state and the provider reachability matrix that the dynamic
 * scheduler (10F) consumes. Platform-neutral: routes are labels, never OS APIs.
 */

export type RouteId = "direct" | "system-proxy" | "user-proxy" | "regional-proxy" | "provider-proxy";
export const ALL_ROUTE_IDS: readonly RouteId[] = [
  "direct",
  "system-proxy",
  "user-proxy",
  "regional-proxy",
  "provider-proxy"
] as const;

export type NodeNetworkState = "DIRECT" | "SYSTEM_PROXY" | "USER_PROXY" | "REGIONAL_PROXY" | "PROVIDER_PROXY" | "OFFLINE";

export interface NodeNetworkReport {
  nodeId: string;
  routes: Partial<Record<RouteId, boolean>>;
  effective: NodeNetworkState;
  latencyMs?: number;
  sampledAt: string;
}

/** One row of the per-node provider reachability matrix (10M). */
export interface ProviderMatrixRow {
  provider: string;
  reachable: boolean;
  authenticated: boolean;
  latencyMs?: number;
  regionBlocked: boolean;
  rateLimited: boolean;
  proxyRequired: boolean;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
}

export interface ProviderMatrix {
  nodeId: string;
  rows: ProviderMatrixRow[];
  sampledAt: string;
}

/** Deterministic helpers. */

/** Effective route = DIRECT when direct works, else first working fallback, else OFFLINE. */
export function effectiveNetworkState(routes: Partial<Record<RouteId, boolean>>): NodeNetworkState {
  if (routes.direct) return "DIRECT";
  if (routes["system-proxy"]) return "SYSTEM_PROXY";
  if (routes["user-proxy"]) return "USER_PROXY";
  if (routes["regional-proxy"]) return "REGIONAL_PROXY";
  if (routes["provider-proxy"]) return "PROVIDER_PROXY";
  return "OFFLINE";
}

/** Direct-first route ordering consumed by route policy. */
export function routePriority(): RouteId[] {
  return [...ALL_ROUTE_IDS];
}
