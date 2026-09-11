/**
 * 10B node identity & capability model (pure skeleton).
 *
 * This file defines the *data contract* for a Boss node (taskbook §5). All
 * fields are plain JSON strings/numbers/arrays; real probing happens behind
 * adapters (phase 10C), so nothing here may read host state.
 *
 * Later phases add durable registries and state machines that consume these
 * types; this module only fixes the vocabulary + minimal deterministic helpers.
 */

import type { RouteId } from "./network";
import type { GitHubCapability } from "../github-machine";


export type DeviceType = "desktop" | "laptop" | "server" | "embedded" | "mobile" | "unknown";
export type OsLabel = "windows" | "linux" | "macos" | "android" | "ios" | "harmonyos" | "unknown";
export type ArchLabel = "x64" | "arm64" | "ia32" | "unknown";

/** Stable per-installation identity. sessionId/runId are separate concepts. */
export interface NodeIdentity {
  nodeId: string;
  hostId: string;
  deviceType: DeviceType;
  os: OsLabel;
  arch: ArchLabel;
  runtimeVersion: string; // Boss runtime (node/electron) version label
  bossVersion: string; // 10.x Boss version string
}

export interface NodeHardware {
  cpu: { cores: number; model?: string; loadPercent?: number };
  memory: { totalMb: number };
  gpu: Array<{ name: string; vramMb?: number }>;
  storage: { freeMb?: number };
}

export interface NodeCapabilityFlags {
  networkRoutes: RouteId[];
  proxyCapable: boolean;
  providers: string[]; // configured provider ids
  browser: boolean;
  localModel: boolean;
  /** Node can keep running offline-capable tasks when network is unavailable. */
  offlineCapable: boolean;
  /** Observed host capabilities used for Git/GitHub task delegation. */
  github?: Partial<Record<GitHubCapability, boolean>>;
}

/**
 * Node operational state (taskbook §5): `busy` is orthogonal to health.
 * UNKNOWN only before the first self-inspection.
 */
export type NodeOperationalState = "UNKNOWN" | "AVAILABLE" | "DEGRADED" | "OFFLINE" | "BUSY" | "FAILED" | "DISABLED";

/** Full advertisement a node publishes to a fleet controller. */
export interface NodeCapabilityAdvertisement {
  schemaVersion: 1;
  identity: NodeIdentity;
  hardware: NodeHardware;
  capabilities: NodeCapabilityFlags;
  state: NodeOperationalState;
  busy: boolean;
  degradedReasons: string[];
  lastHeartbeatAt: number; // epoch ms
  seq: number;
}

/** Deterministic helper: which states may accept a newly leased task. */
export function canAcceptWork(node: Pick<NodeCapabilityAdvertisement, "state" | "busy">): boolean {
  if (node.busy) return false;
  return node.state === "AVAILABLE" || node.state === "DEGRADED";
}

/** Facts a node refresh observed; absent/unknown facts can only degrade, never fabricate READY. */
export interface NodeRefreshFacts {
  hardware?: Partial<NodeHardware>;
  capabilities?: Partial<NodeCapabilityFlags>;
  networkEffective?: "DIRECT" | "SYSTEM_PROXY" | "USER_PROXY" | "REGIONAL_PROXY" | "PROVIDER_PROXY" | "OFFLINE";
}

/** Merge observed refresh facts into the previous advertisement (deterministic, additive). */
export function refreshAdvertisement(previous: NodeCapabilityAdvertisement, facts: NodeRefreshFacts): NodeCapabilityAdvertisement {
  const hardware: NodeHardware = {
    cpu: facts.hardware?.cpu ?? previous.hardware.cpu,
    memory: { ...previous.hardware.memory, ...(facts.hardware?.memory ?? {}) },
    gpu: facts.hardware?.gpu ?? previous.hardware.gpu,
    storage: { ...previous.hardware.storage, ...(facts.hardware?.storage ?? {}) }
  };
  const capabilities: NodeCapabilityFlags = facts.capabilities
    ? {
        networkRoutes: facts.capabilities.networkRoutes ?? previous.capabilities.networkRoutes,
        proxyCapable: facts.capabilities.proxyCapable ?? previous.capabilities.proxyCapable,
        providers: facts.capabilities.providers ?? previous.capabilities.providers,
        browser: facts.capabilities.browser ?? previous.capabilities.browser,
        localModel: facts.capabilities.localModel ?? previous.capabilities.localModel,
        offlineCapable: facts.capabilities.offlineCapable ?? previous.capabilities.offlineCapable,
        github: facts.capabilities.github ?? previous.capabilities.github
      }
    : previous.capabilities;
  return { ...previous, hardware, capabilities, seq: previous.seq + 1 };
}

/** Record a heartbeat: bumps lastHeartbeatAt and returns an AVAILABLE-state advertisement. */
export function heartbeat(previous: NodeCapabilityAdvertisement, now: number): NodeCapabilityAdvertisement {
  return { ...previous, state: "AVAILABLE", busy: previous.busy, degradedReasons: [], lastHeartbeatAt: now, seq: previous.seq + 1 };
}

/** Re-derive node state from the last heartbeat + known degraded reasons (pure, epoch-ms clock). */
export function rederiveState(now: number, previous: NodeCapabilityAdvertisement, offlineAfterMs = 30_000, degradedAfterMs = 12_000): { state: NodeOperationalState; degradedReasons: string[] } {
  const age = now - previous.lastHeartbeatAt;
  if (previous.state === "FAILED" || previous.state === "DISABLED") return { state: previous.state, degradedReasons: previous.degradedReasons };
  if (age >= offlineAfterMs) return { state: "OFFLINE", degradedReasons: [...previous.degradedReasons, "heartbeat missed"] };
  if (age >= degradedAfterMs) return { state: "DEGRADED", degradedReasons: [...previous.degradedReasons, "heartbeat stale"] };
  return { state: previous.degradedReasons.length ? "DEGRADED" : "AVAILABLE", degradedReasons: previous.degradedReasons };
}

