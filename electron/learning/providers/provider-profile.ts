import {
  EMPTY_METRIC,
  GLOBAL_METRIC_KEYS,
  PROFILE_BUILDER_VERSION,
  PROFILE_SCHEMA_VERSION,
  blendProfileWithPrior,
  confidenceFor,
  metricDeviation,
  type ConceptOverride,
  type GlobalMetrics,
  type MetricEstimate,
  type ProviderBehaviourProfile
} from "../../../src/shared/provider-profile";
import { episodeContributesToProfile, type LearningEpisode } from "../../../src/shared/learning-episode";
import { structuralHashOf } from "../../../src/shared/task-fingerprint";

/**
 * Engine Phase 5 — provider behaviour profile builder (derived, rebuildable).
 *
 * Input: episodes (the source of truth). Output: statistical profiles scoped by
 * runtime + model snapshot + behaviour epoch.
 *
 * Hard rules:
 *  - semantic metrics use ONLY episodes whose evaluation penalizes the semantic
 *    profile, so runtime faults (timeout/auth/page-change) can never depress
 *    completion/goalFidelity/restriction (acceptance "statistical pollution");
 *  - runtimeReliability is a runtime-layer metric and legitimately counts
 *    runtime failures, but is kept in its own field;
 *  - latency comes from durationMs and is stored in ms (mean), confidence by
 *    sample count;
 *  - no episodes ⇒ empty estimates with zero confidence (no baked-in stereotype);
 *  - rebuilding from identical episodes is deterministic.
 */

export interface ProfileBuildOptions {
  /** Minimum samples before a role baseline / concept override is persisted. */
  minSamplesForRole?: number;
  minSamplesForConcept?: number;
  /** Minimum |deviation| before a concept override is persisted. */
  minDeviation?: number;
  /** Parent profiles (previous model version / epoch) for decayed priors. */
  priors?: Map<string, ProviderBehaviourProfile>;
  priorDecay?: number;
  builtAt?: string;
}

export interface ProfileScope {
  runtimeId: string;
  provider?: string;
  surface?: string;
  modelSnapshotKey?: string;
  behaviourEpochId?: string;
}

export function profileKey(scope: ProfileScope): string {
  return `${scope.runtimeId}::${scope.modelSnapshotKey ?? "runtime"}::${scope.behaviourEpochId ?? "epochless"}`;
}

export function profileIdOf(scope: ProfileScope): string {
  return `pf-${structuralHashOf([scope.runtimeId, scope.modelSnapshotKey ?? "runtime", scope.behaviourEpochId ?? "epochless"])}`;
}

export class ProviderProfileBuilder {
  readonly builderVersion = PROFILE_BUILDER_VERSION;

  /** Build one profile for an explicit scope from the given episodes. */
  build(scope: ProfileScope, episodes: LearningEpisode[], options: ProfileBuildOptions = {}): ProviderBehaviourProfile {
    const scoped = episodes.filter((episode) => matchesScope(episode, scope));
    const builtAt = options.builtAt ?? new Date().toISOString();
    const global = this.globalMetrics(scoped, builtAt);
    const byRole: Record<string, Partial<GlobalMetrics>> = {};
    const minRole = options.minSamplesForRole ?? 3;
    for (const role of [...new Set(scoped.map((episode) => episode.role))].sort()) {
      const roleEpisodes = scoped.filter((episode) => episode.role === role);
      if (roleEpisodes.length < minRole) continue; // only statistically meaningful baselines
      byRole[role] = this.globalMetrics(roleEpisodes, builtAt);
    }
    const conceptOverrides = this.conceptOverrides(scoped, global, builtAt, options);

    const profile: ProviderBehaviourProfile = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileId: profileIdOf(scope),
      runtimeId: scope.runtimeId,
      provider: scope.provider,
      surface: scope.surface,
      modelSnapshotKey: scope.modelSnapshotKey,
      behaviourEpochId: scope.behaviourEpochId,
      global,
      byRole,
      conceptOverrides,
      builtFromEpisodeCount: scoped.length,
      builderVersion: this.builderVersion,
      rebuiltAt: builtAt
    };

    const prior = options.priors?.get(profile.profileId);
    return prior ? blendProfileWithPrior(profile, prior, options.priorDecay ?? 0.5) : profile;
  }

  /** Rebuild every profile implied by the episode set (grouped by scope). */
  buildAll(episodes: LearningEpisode[], options: ProfileBuildOptions = {}): ProviderBehaviourProfile[] {
    const scopes = new Map<string, ProfileScope>();
    for (const episode of episodes) {
      const scope: ProfileScope = {
        runtimeId: episode.runtimeId,
        provider: episode.provider,
        surface: episode.surface,
        modelSnapshotKey: episode.modelSnapshotId,
        behaviourEpochId: episode.behaviourEpochId
      };
      scopes.set(profileKey(scope), scope);
    }
    return [...scopes.values()].map((scope) => this.build(scope, episodes, options)).sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  /** Full-project semantic metrics: only profile-contributing episodes count. */
  private globalMetrics(episodes: LearningEpisode[], builtAt: string): GlobalMetrics {
    const semantic = episodes.filter(episodeContributesToProfile);
    const runtimeAll = episodes;

    const completion = estimate(semantic.map((episode) => episode.semanticEvaluation!.axes.completion), builtAt);
    const goalFidelity = estimate(semantic.map((episode) => episode.semanticEvaluation!.axes.goalFidelity), builtAt);
    const restrictionImpact = estimate(semantic.map((episode) => episode.semanticEvaluation!.axes.restrictionImpact), builtAt);
    const verificationScores = semantic
      .map((episode) => episode.semanticEvaluation!.axes.verificationScore)
      .filter((value): value is number => typeof value === "number");
    const verificationPass = estimate(verificationScores, builtAt);
    // Runtime reliability counts only PROVIDER-attributed outcomes: a device or
    // network fault must never be recorded as "this provider is unreliable"
    // (Engine §9 / acceptance A48).
    const providerAttributed = runtimeAll.filter((episode) => episode.causalSource === undefined || episode.causalSource === "PROVIDER");
    const runtimeReliability = estimate(
      providerAttributed.map((episode) => (episode.runtimeStatus === "SUCCESS" ? 1 : 0)),
      builtAt
    );
    const latency = estimate(
      runtimeAll.map((episode) => episode.durationMs).filter((value): value is number => typeof value === "number" && value >= 0),
      builtAt
    );
    return { completion, goalFidelity, restrictionImpact, runtimeReliability, verificationPass, latency };
  }

  private conceptOverrides(episodes: LearningEpisode[], global: GlobalMetrics, builtAt: string, options: ProfileBuildOptions): ConceptOverride[] {
    const minSamples = options.minSamplesForConcept ?? 3;
    const minDeviation = options.minDeviation ?? 0.1;
    const byConcept = new Map<string, LearningEpisode[]>();
    for (const episode of episodes) {
      if (!episodeContributesToProfile(episode)) continue;
      for (const concept of episode.taskFingerprint.concepts ?? []) {
        const list = byConcept.get(concept.conceptId) ?? [];
        list.push(episode);
        byConcept.set(concept.conceptId, list);
      }
    }
    const overrides: ConceptOverride[] = [];
    for (const conceptId of [...byConcept.keys()].sort()) {
      const conceptEpisodes = byConcept.get(conceptId)!;
      if (conceptEpisodes.length < minSamples) continue;
      const completion = estimate(conceptEpisodes.map((episode) => episode.semanticEvaluation!.axes.completion), builtAt);
      const goalFidelity = estimate(conceptEpisodes.map((episode) => episode.semanticEvaluation!.axes.goalFidelity), builtAt);
      const restrictionImpact = estimate(conceptEpisodes.map((episode) => episode.semanticEvaluation!.axes.restrictionImpact), builtAt);
      const qualityValues = conceptEpisodes
        .map((episode) => episode.semanticEvaluation!.axes.quality)
        .filter((value): value is number => typeof value === "number");
      const quality = qualityValues.length ? estimate(qualityValues, builtAt) : undefined;
      const deviation = {
        completion: metricDeviation(completion, global.completion),
        goalFidelity: metricDeviation(goalFidelity, global.goalFidelity),
        restrictionImpact: metricDeviation(restrictionImpact, global.restrictionImpact),
        quality: quality ? metricDeviation(quality, global.completion) : undefined
      };
      const meaningful = Object.values(deviation).some((value) => typeof value === "number" && Math.abs(value) >= minDeviation);
      if (!meaningful) continue; // persist only statistically meaningful deviations
      overrides.push({ conceptId, completion, goalFidelity, restrictionImpact, ...(quality ? { quality } : {}), deviation });
    }
    return overrides;
  }
}

function matchesScope(episode: LearningEpisode, scope: ProfileScope): boolean {
  if (episode.runtimeId !== scope.runtimeId) return false;
  if ((episode.modelSnapshotId ?? undefined) !== (scope.modelSnapshotKey ?? undefined)) return false;
  if ((episode.behaviourEpochId ?? undefined) !== (scope.behaviourEpochId ?? undefined)) return false;
  return true;
}

export function estimate(values: number[], updatedAt: string): MetricEstimate {
  if (!values.length) return { ...EMPTY_METRIC, updatedAt };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean: Number(mean.toFixed(4)),
    confidence: confidenceFor(values.length),
    samples: values.length,
    updatedAt
  };
}

export { GLOBAL_METRIC_KEYS, metricDeviation };
