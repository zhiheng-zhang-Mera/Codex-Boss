/**
 * Engine Phase 5 — provider behaviour profile contracts (pure).
 *
 * A profile is DERIVED, rebuildable data (Engine §17/§5): it summarises episodes
 * into statistical estimates but is never a source of truth. Deleting it must be
 * harmless, and rebuilding from the same episodes must be deterministic.
 *
 * Only statistically meaningful deviations are persisted (book §11) — no dense
 * provider × every-possible-tag matrix, and no brand stereotype baked in as a
 * default: with no episodes, every estimate is empty and confidence is zero.
 */

import type { SemanticOutcome } from "./provider-outcome";

export const PROFILE_SCHEMA_VERSION = 1 as const;
export const PROFILE_BUILDER_VERSION = "profile-builder-1.0.0";

export interface MetricEstimate {
  mean: number;
  confidence: number;
  samples: number;
  updatedAt: string;
}

export interface ConceptOverride {
  conceptId: string;
  /** Concept-local estimates (deviation versus the global baseline is derived). */
  completion?: MetricEstimate;
  goalFidelity?: MetricEstimate;
  restrictionImpact?: MetricEstimate;
  quality?: MetricEstimate;
  /** Explicit derived deviation (concept mean − global mean) when built by the builder. */
  deviation?: {
    completion?: number;
    goalFidelity?: number;
    restrictionImpact?: number;
    quality?: number;
  };
}

export type GlobalMetricKey = "completion" | "goalFidelity" | "restrictionImpact" | "runtimeReliability" | "verificationPass" | "latency";

export type GlobalMetrics = Record<GlobalMetricKey, MetricEstimate>;

export interface ProviderBehaviourProfile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  profileId: string;
  runtimeId: string;
  provider?: string;
  surface?: string;
  /** Absent ⇒ runtime-level profile (legacy adapters without model identity). */
  modelSnapshotKey?: string;
  behaviourEpochId?: string;
  /** Parent profile whose prior was inherited with decay (version cold start). */
  parentProfileId?: string;

  global: GlobalMetrics;
  byRole: Record<string, Partial<GlobalMetrics>>;
  conceptOverrides: ConceptOverride[];

  builtFromEpisodeCount: number;
  builderVersion: string;
  rebuiltAt: string;
}

export const GLOBAL_METRIC_KEYS: readonly GlobalMetricKey[] = [
  "completion",
  "goalFidelity",
  "restrictionImpact",
  "runtimeReliability",
  "verificationPass",
  "latency"
] as const;

export const EMPTY_METRIC: MetricEstimate = { mean: 0, confidence: 0, samples: 0, updatedAt: "" };

/** Only these outcomes contribute to semantic metrics. */
export function outcomeIsSemanticPenalty(outcome: SemanticOutcome): boolean {
  return outcome !== "UNCLASSIFIED";
}

/** Deterministic confidence estimator: samples/(samples+k), capped. */
export function confidenceFor(samples: number, k = 5, cap = 0.95): number {
  if (samples <= 0) return 0;
  return Number(Math.min(cap, samples / (samples + k)).toFixed(3));
}

/**
 * Version cold start (Engine §11/§4.11): a new model version inherits the
 * previous version's prior with a decay, plus the provider-family prior — never a
 * full reset and never a full inherit. Evidence count decides how fast the prior
 * fades.
 */
export function blendMetric(prior: MetricEstimate, current: MetricEstimate, decay = 0.5): MetricEstimate {
  if (prior.samples <= 0) return { ...current };
  if (current.samples <= 0) return { ...prior, mean: prior.mean, confidence: Number((prior.confidence * decay).toFixed(3)) };
  const priorWeight = prior.samples * decay;
  const total = priorWeight + current.samples;
  const mean = (prior.mean * priorWeight + current.mean * current.samples) / total;
  return {
    mean: Number(mean.toFixed(4)),
    confidence: confidenceFor(total),
    samples: current.samples, // observed evidence count stays honest
    updatedAt: current.updatedAt
  };
}

export function blendProfileWithPrior(current: ProviderBehaviourProfile, prior: ProviderBehaviourProfile, decay = 0.5): ProviderBehaviourProfile {
  const global = { ...current.global };
  for (const key of GLOBAL_METRIC_KEYS) {
    global[key] = blendMetric(prior.global[key] ?? EMPTY_METRIC, current.global[key] ?? EMPTY_METRIC, decay);
  }
  return { ...current, global, parentProfileId: prior.profileId };
}

export function metricDeviation(local: MetricEstimate | undefined, global: MetricEstimate | undefined): number | undefined {
  if (!local || !global || local.samples === 0 || global.samples === 0) return undefined;
  return Number((local.mean - global.mean).toFixed(4));
}
