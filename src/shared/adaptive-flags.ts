/**
 * Adaptive Provider Intelligence — feature flags (pure, contract).
 *
 * Engine plan Phase 0: every adaptive capability is independently switchable,
 * and every flag defaults to FALSE so the stable deterministic
 * MainCommander → RoleRouter → Runtime → RuntimeResult chain behaves exactly as
 * before when the learning program is off.
 *
 * Resolution is deliberately fail-closed toward "off": a non-boolean or
 * unknown value yields false, never true. Turning a flag on is always an
 * explicit local decision.
 */

export type AdaptiveFlagId =
  | "adaptiveProviderLearning"
  | "semanticOutcomeEvaluation"
  | "modelIdentityObservation"
  | "adaptiveRouting"
  | "behaviourEpochDetection";

export const ADAPTIVE_FLAG_IDS: readonly AdaptiveFlagId[] = [
  "adaptiveProviderLearning",
  "semanticOutcomeEvaluation",
  "modelIdentityObservation",
  "adaptiveRouting",
  "behaviourEpochDetection"
] as const;

export type AdaptiveFlags = Record<AdaptiveFlagId, boolean>;

/** Phase 0 acceptance: all flags default OFF. */
export const DEFAULT_ADAPTIVE_FLAGS: AdaptiveFlags = {
  adaptiveProviderLearning: false,
  semanticOutcomeEvaluation: false,
  modelIdentityObservation: false,
  adaptiveRouting: false,
  behaviourEpochDetection: false
};

/** Deterministic resolution: only an explicit boolean true enables a flag. */
export function resolveAdaptiveFlags(input: Partial<Record<AdaptiveFlagId, unknown>> = {}): AdaptiveFlags {
  const resolved: AdaptiveFlags = { ...DEFAULT_ADAPTIVE_FLAGS };
  for (const id of ADAPTIVE_FLAG_IDS) {
    const value = input[id];
    if (value === true) resolved[id] = true;
  }
  return resolved;
}

export function adaptiveFlagsAllOff(flags: AdaptiveFlags): boolean {
  return ADAPTIVE_FLAG_IDS.every((id) => flags[id] !== true);
}

/** Which capabilities are actually enabled (used for observability + audit). */
export function enabledAdaptiveFlags(flags: AdaptiveFlags): AdaptiveFlagId[] {
  return ADAPTIVE_FLAG_IDS.filter((id) => flags[id] === true);
}

/**
 * A capability is only active when its own flag is on AND the umbrella learning
 * flag is on — this keeps "learning entirely disabled" a single switch while
 * still allowing per-capability control.
 */
export function adaptiveCapabilityEnabled(id: AdaptiveFlagId, flags: AdaptiveFlags): boolean {
  if (id === "adaptiveProviderLearning") return flags.adaptiveProviderLearning === true;
  return flags.adaptiveProviderLearning === true && flags[id] === true;
}
