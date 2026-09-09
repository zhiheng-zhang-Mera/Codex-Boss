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
  cpu: { cores: number; model?: string };
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
