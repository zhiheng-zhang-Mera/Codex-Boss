/**
 * Engine Phase 8 — behaviour epoch contract (pure).
 *
 * A web provider may change its backend without disclosing it, so identity is
 * tracked per EPOCH: a sustained, statistically meaningful behaviour change (or an
 * observed model-id change) opens a new epoch while the previous one is closed
 * and preserved. Old epochs stay queryable forever (acceptance A34) and a new
 * epoch inherits the old one as a decayed prior rather than a reset (A33).
 */

export const EPOCH_SCHEMA_VERSION = 1 as const;

export type EpochTrigger = "OBSERVED_MODEL_CHANGE" | "SUSTAINED_BEHAVIOUR_CHANGE" | "MANUAL_RESET";

export interface BehaviourEpoch {
  schemaVersion: typeof EPOCH_SCHEMA_VERSION;
  epochId: string;

  provider: string;
  surface: string;
  selectedModel?: string;
  observedModelId?: string;

  startedAt: string;
  endedAt?: string;

  parentEpochId?: string;

  trigger: EpochTrigger;

  confidence: number;
  evidenceEpisodeIds: string[];
}

export interface EpochScope {
  provider: string;
  surface: string;
  selectedModel?: string;
  observedModelId?: string;
}

/** Deterministic identity key for an epoch scope (model id participates). */
export function epochScopeKey(scope: EpochScope): string {
  return [scope.provider, scope.surface, scope.selectedModel ?? "auto", scope.observedModelId ?? "unknown"].join("::");
}

/** Epoch id: stable for the scope + start instant, never depends on display text. */
export function epochIdFor(scope: EpochScope, startedAt: string, sequence: number): string {
  const seed = `${epochScopeKey(scope)}@${startedAt}#${sequence}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `EP-${hash.toString(16).padStart(8, "0")}`;
}

/** Metrics fed into change-point detection (book §9). */
export type BehaviourMetricKey = "completion" | "goalFidelity" | "restrictionImpact" | "quality" | "latency" | "formatCompliance";

export const BEHAVIOUR_METRIC_KEYS: readonly BehaviourMetricKey[] = [
  "completion",
  "goalFidelity",
  "restrictionImpact",
  "quality",
  "latency",
  "formatCompliance"
] as const;
