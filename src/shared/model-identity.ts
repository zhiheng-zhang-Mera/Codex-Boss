/**
 * Engine Phase 3 — model execution identity (pure).
 *
 * A web provider may not disclose which backend model actually answered, and a
 * single conversation may switch models between turns (Web "Auto"). Therefore:
 *  - identity belongs to the INVOCATION/episode, never to the conversation;
 *  - every identity records HOW it was learned (versionSource) plus a confidence;
 *  - an unobservable backend stays `observedModelId: undefined` — Boss must never
 *    fabricate a precise version number, and a model's self-reported text answer
 *    is not a high-confidence source (book §7.1).
 */

export type ModelIdentitySource =
  | "NETWORK_METADATA" // provider-exposed structured request/response model id
  | "PAGE_METADATA" // structured metadata exposed by the page
  | "UI_SELECTOR" // model selector / badge in the UI
  | "PROVIDER_DECLARED" // provider's own declaration
  | "INFERRED" // inferred from observed behaviour change
  | "UNKNOWN";

/** Evidence trust order (book §7.1), strongest first. */
export const MODEL_IDENTITY_SOURCE_ORDER: readonly ModelIdentitySource[] = [
  "NETWORK_METADATA",
  "PAGE_METADATA",
  "UI_SELECTOR",
  "PROVIDER_DECLARED",
  "INFERRED",
  "UNKNOWN"
] as const;

/** Confidence ceiling per source — resolution may lower it, never raise it. */
export const MODEL_IDENTITY_SOURCE_CONFIDENCE: Record<ModelIdentitySource, number> = {
  NETWORK_METADATA: 1,
  PAGE_METADATA: 0.9,
  UI_SELECTOR: 0.7,
  PROVIDER_DECLARED: 0.5,
  INFERRED: 0.3,
  UNKNOWN: 0
};

/** Label used when the provider is in Auto routing mode. */
export const AUTO_MODEL_LABEL = "Auto";

/** A model's own textual claim ("I am version X") is capped at this confidence. */
export const SELF_REPORTED_CONFIDENCE = 0.15;

export interface ModelExecutionIdentity {
  provider: string;
  surface: string;

  selectedModel?: string;
  declaredModel?: string;
  observedModelId?: string;
  mode?: string;

  versionSource: ModelIdentitySource;
  confidence: number;
  observedAt: string;

  behaviourEpochId?: string;
}

export interface ModelSnapshot {
  schemaVersion: 1;
  id: string;
  identity: ModelExecutionIdentity;
  fingerprint: string;
  firstObservedAt: string;
  lastObservedAt: string;
}

/** True when the UI selector reports Auto (or the selection is simply unknown). */
export function isAutoSelection(selectedModel: string | undefined): boolean {
  if (!selectedModel) return true;
  return /^auto$/i.test(selectedModel.trim());
}

export function isConcreteModelId(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !isAutoSelection(trimmed) && trimmed.toLowerCase() !== "unknown";
}

/**
 * Snapshot fingerprint: ONLY stable identity fields participate (book §8).
 * Timestamps and behaviour epochs deliberately excluded so identity reuse dedups.
 */
export function modelIdentityFingerprint(identity: Pick<ModelExecutionIdentity, "provider" | "surface" | "selectedModel" | "declaredModel" | "observedModelId" | "mode" | "versionSource">): string {
  const parts = [
    identity.provider,
    identity.surface,
    identity.selectedModel ?? "",
    identity.declaredModel ?? "",
    identity.observedModelId ?? "",
    identity.mode ?? "",
    identity.versionSource
  ];
  let hash = 0x811c9dc5;
  const input = parts.join("\u0001");
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Lower rank value = more trustworthy source. */
export function sourceRank(source: ModelIdentitySource): number {
  const index = MODEL_IDENTITY_SOURCE_ORDER.indexOf(source);
  return index < 0 ? MODEL_IDENTITY_SOURCE_ORDER.length : index;
}

/** Human-readable distinction required by the Engine UI (§18). */
export type ModelIdentityProvenance = "OBSERVED" | "PROVIDER_DECLARED" | "INFERRED" | "UNKNOWN";

export function provenanceOf(identity: Pick<ModelExecutionIdentity, "versionSource">): ModelIdentityProvenance {
  switch (identity.versionSource) {
    case "NETWORK_METADATA":
    case "PAGE_METADATA":
    case "UI_SELECTOR":
      return "OBSERVED";
    case "PROVIDER_DECLARED":
      return "PROVIDER_DECLARED";
    case "INFERRED":
      return "INFERRED";
    default:
      return "UNKNOWN";
  }
}
