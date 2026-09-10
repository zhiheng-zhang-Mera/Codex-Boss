import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_METRIC,
  GLOBAL_METRIC_KEYS,
  type ConceptOverride,
  type GlobalMetricKey,
  type GlobalMetrics,
  type MetricEstimate,
  type ProviderBehaviourProfile
} from "../../../src/shared/provider-profile";
import type { LearningEpisode } from "../../../src/shared/learning-episode";
import { ProviderProfileBuilder, type ProfileBuildOptions, type ProfileScope } from "./provider-profile";

/**
 * Engine Phase 5/11 — provider behaviour model + durable derived profile store.
 *
 * Read model used by routing (Phase 6) and by the owner UI (Phase 11):
 *  - globalBaseline / roleBaselines with a documented fallback to global,
 *  - meaningfulConceptOverrides,
 *  - recentEvidence (last N scoped episodes),
 *  - sampleCount and uncertainty.
 *
 * The store is DERIVED data: `clear()` + `rebuild(episodes)` must reproduce the
 * same profiles (acceptance A11/A12). A corrupt store degrades to "no profile",
 * which routes deterministically (A28).
 */

export interface ProfileStoreFile {
  schemaVersion: 1;
  builderVersion: string;
  profiles: ProviderBehaviourProfile[];
}

export class ProviderProfileStore {
  private readonly profiles = new Map<string, ProviderBehaviourProfile>();
  private stale = false;
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    private readonly builder: ProviderProfileBuilder = new ProviderProfileBuilder()
  ) {
    this.restore();
  }

  /** Replace all profiles with a fresh rebuild from episodes (derived ⇒ safe). */
  rebuild(episodes: LearningEpisode[], options: ProfileBuildOptions = {}): ProviderBehaviourProfile[] {
    const built = this.builder.buildAll(episodes, options);
    this.profiles.clear();
    for (const profile of built) this.profiles.set(profile.profileId, profile);
    this.stale = false;
    this.persist();
    return this.list();
  }

  /** Rebuild a single scope. */
  rebuildScope(scope: ProfileScope, episodes: LearningEpisode[], options: ProfileBuildOptions = {}): ProviderBehaviourProfile {
    const profile = this.builder.build(scope, episodes, options);
    this.profiles.set(profile.profileId, profile);
    this.persist();
    return profile;
  }

  /** Derived data may always be deleted; episodes are untouched. */
  clear(): void {
    this.profiles.clear();
    this.persist();
  }

  markStale(): void {
    this.stale = true;
  }

  isStale(): boolean {
    return this.stale;
  }

  get(profileId: string): ProviderBehaviourProfile | undefined {
    const profile = this.profiles.get(profileId);
    return profile ? structuredClone(profile) : undefined;
  }

  /** Resolve the most specific profile available, falling back model → runtime. */
  resolve(input: { runtimeId: string; modelSnapshotKey?: string; behaviourEpochId?: string }): ProviderBehaviourProfile | undefined {
    const candidates = this.list().filter((profile) => profile.runtimeId === input.runtimeId);
    const exact = candidates.find(
      (profile) => profile.modelSnapshotKey === input.modelSnapshotKey && profile.behaviourEpochId === input.behaviourEpochId
    );
    if (exact) return exact;
    const byModel = candidates.find((profile) => profile.modelSnapshotKey === input.modelSnapshotKey);
    if (byModel) return byModel;
    const runtimeLevel = candidates.find((profile) => profile.modelSnapshotKey === undefined);
    if (runtimeLevel) return runtimeLevel;
    return candidates[0];
  }

  list(): ProviderBehaviourProfile[] {
    return [...this.profiles.values()].map((profile) => structuredClone(profile)).sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  count(): number {
    return this.profiles.size;
  }

  status(): { count: number; builderVersion: string; stale: boolean; degradedReason?: string } {
    return { count: this.profiles.size, builderVersion: this.builder.builderVersion, stale: this.stale, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<ProfileStoreFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles)) throw new Error("Invalid profile store file");
      for (const profile of parsed.profiles) {
        if (!profile || typeof profile.profileId !== "string" || !profile.global) throw new Error("Invalid profile row");
        this.profiles.set(profile.profileId, profile);
      }
      if (parsed.builderVersion !== this.builder.builderVersion) this.stale = true; // rebuild recommended
    } catch (error) {
      this.profiles.clear();
      this.degraded = `profiles unreadable: ${String(error)}`; // ⇒ deterministic routing
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: ProfileStoreFile = { schemaVersion: 1, builderVersion: this.builder.builderVersion, profiles: [...this.profiles.values()] };
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      this.degraded = `profile persist failed: ${String(error)}`;
    }
  }
}

/** Read model over a profile (Phase 5 contract for the UI + Phase 6 scorer). */
export class BehaviourModel {
  constructor(private readonly profile?: ProviderBehaviourProfile) {}

  get profileId(): string | undefined {
    return this.profile?.profileId;
  }

  sampleCount(): number {
    return this.profile?.builtFromEpisodeCount ?? 0;
  }

  /** Global baseline metric, EMPTY when unknown (never a fabricated default). */
  global(metric: GlobalMetricKey): MetricEstimate {
    return this.profile?.global[metric] ?? EMPTY_METRIC;
  }

  /** Role baseline with documented fallback: role → global. */
  forRole(role: string): GlobalMetrics {
    const roleBaseline = this.profile?.byRole?.[role];
    const global = this.profile?.global;
    const merged = {} as GlobalMetrics;
    for (const key of GLOBAL_METRIC_KEYS) {
      merged[key] = roleBaseline?.[key] ?? global?.[key] ?? EMPTY_METRIC;
    }
    return merged;
  }

  conceptOverride(conceptId: string): ConceptOverride | undefined {
    return this.profile?.conceptOverrides?.find((override) => override.conceptId === conceptId);
  }

  conceptOverrides(): ConceptOverride[] {
    return [...(this.profile?.conceptOverrides ?? [])];
  }

  /** Deterministic latent vector over the global metrics (book §11). */
  latentBehaviourVector(): number[] {
    return GLOBAL_METRIC_KEYS.map((key) => this.global(key).mean);
  }

  /** Aggregate uncertainty: 1 − mean confidence over observed metrics. */
  uncertainty(): number {
    const observed = GLOBAL_METRIC_KEYS.map((key) => this.global(key)).filter((metric) => metric.samples > 0);
    if (!observed.length) return 1;
    const meanConfidence = observed.reduce((sum, metric) => sum + metric.confidence, 0) / observed.length;
    return Number((1 - meanConfidence).toFixed(3));
  }

  /** Recent evidence summary (deterministic, no episode bodies retained). */
  recentEvidence(episodes: LearningEpisode[], limit = 10): Array<{ episodeId: string; timestamp: string; outcome?: string; runtimeStatus: string }> {
    return [...episodes]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, Math.max(0, limit))
      .map((episode) => ({ episodeId: episode.episodeId, timestamp: episode.timestamp, outcome: episode.semanticEvaluation?.outcome, runtimeStatus: episode.runtimeStatus }));
  }
}
