/**
 * Host-M — host maturity feature flags (pure contract).
 *
 * Every Host-M capability is an outer shell around the stable Boss core, so each
 * one is independently switchable and defaults to OFF. Resolution is
 * fail-closed toward "off": only an explicit boolean `true` enables a flag, so a
 * corrupt, partial or hand-edited file can never silently activate extra
 * machinery inside a running Boss.
 *
 * This registry is deliberately separate from `adaptive-flags.ts`: Host-M must
 * be removable without touching the Engine's flag contract.
 */

export type HostFlagId =
  | "hostAcceptanceHub"
  | "hostFaultLab"
  | "hostSoakHarness"
  | "hostObservability"
  | "hostEvidenceInspector"
  | "hostRegressionSentinel"
  | "hostDoctor";

export const HOST_FLAG_IDS: readonly HostFlagId[] = [
  "hostAcceptanceHub",
  "hostFaultLab",
  "hostSoakHarness",
  "hostObservability",
  "hostEvidenceInspector",
  "hostRegressionSentinel",
  "hostDoctor"
] as const;

export type HostFlags = Record<HostFlagId, boolean>;

export const DEFAULT_HOST_FLAGS: HostFlags = {
  hostAcceptanceHub: false,
  hostFaultLab: false,
  hostSoakHarness: false,
  hostObservability: false,
  hostEvidenceInspector: false,
  hostRegressionSentinel: false,
  hostDoctor: false
};

/** Human labels used by the doctor/observability surfaces. */
export const HOST_FLAG_LABELS: Record<HostFlagId, string> = {
  hostAcceptanceHub: "System Acceptance Hub (P1)",
  hostFaultLab: "Failure Injection Lab (P2)",
  hostSoakHarness: "Long-run / Soak Harness (P3)",
  hostObservability: "Unified Observability (P4)",
  hostEvidenceInspector: "Evidence / Artifact Inspector (P5)",
  hostRegressionSentinel: "Regression Sentinel (P6)",
  hostDoctor: "Boss Doctor (P7)"
};

/** Deterministic resolution: only an explicit boolean true enables a flag. */
export function resolveHostFlags(input: Partial<Record<HostFlagId, unknown>> = {}): HostFlags {
  const resolved: HostFlags = { ...DEFAULT_HOST_FLAGS };
  for (const id of HOST_FLAG_IDS) {
    if (input[id] === true) resolved[id] = true;
  }
  return resolved;
}

export function hostFlagsAllOff(flags: HostFlags): boolean {
  return HOST_FLAG_IDS.every((id) => flags[id] !== true);
}

export function enabledHostFlags(flags: HostFlags): HostFlagId[] {
  return HOST_FLAG_IDS.filter((id) => flags[id] === true);
}

export function isHostFlagId(value: unknown): value is HostFlagId {
  return typeof value === "string" && (HOST_FLAG_IDS as readonly string[]).includes(value);
}

/**
 * Enforcement helper for callers that wrap a capability: a disabled capability
 * must return a well-formed "not enabled" answer instead of throwing, so a
 * switched-off Host-M shell can never break the Boss core.
 */
export function hostCapabilityEnabled(id: HostFlagId, flags: HostFlags): boolean {
  return flags[id] === true;
}

export function disabledHostCapability(id: HostFlagId): { enabled: false; capability: HostFlagId; reason: string } {
  return { enabled: false, capability: id, reason: `${HOST_FLAG_LABELS[id]} is disabled (fail-closed default)` };
}
