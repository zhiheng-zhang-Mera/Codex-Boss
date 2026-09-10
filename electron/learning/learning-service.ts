import path from "node:path";
import {
  buildEpisodeDrilldown,
  buildProviderIntelligencePanel,
  type EpisodeDrilldown,
  type ProviderIntelligencePanel
} from "../../src/shared/provider-intelligence";
import { adaptiveCapabilityEnabled, type AdaptiveFlagId } from "../../src/shared/adaptive-flags";
import { AdaptiveFlagStore } from "./adaptive-flag-store";
import { EpisodeStore, type EpisodeAppendInput } from "./episode-store";
import { OutcomeEvaluator } from "./outcome-evaluator";
import { ModelObserver } from "./providers/model-observer";
import { ModelSnapshotRegistry } from "./providers/model-snapshot";
import { BehaviourEpochLedger } from "./providers/behaviour-epoch";
import { ProviderProfileStore } from "./providers/behaviour-model";
import { RoutingFeedbackLedger } from "./routing/routing-feedback";
import { AdaptiveScorer } from "./routing/adaptive-scorer";
import { ConceptRegistry } from "./concepts/concept-registry";
import { PolicyPromotionGate } from "./evolution/promotion-gate";
import type { LearningEpisode } from "../../src/shared/learning-episode";

/**
 * Engine Phase 11 — learning service facade.
 *
 * Single wiring point for the whole Adaptive Provider Intelligence stack, so the
 * main process (and IPC/UI) never has to know how the pieces fit together:
 *
 *   flags ─ episode store ─ model snapshots ─ epochs ─ profiles ─ concepts ─
 *   scorer ─ feedback ledger ─ promotion gate
 *
 * Owner controls implemented here:
 *  - rebuild derived data from episodes (A11/A12);
 *  - reset derived data without touching episodes (Engine §12);
 *  - disable adaptive routing while KEEPING learning (A37);
 *  - disable learning entirely while keeping the cached profile data.
 *
 * Every method is failure-isolated: a learning-layer exception never propagates
 * into task execution.
 */

export interface LearningServiceOptions {
  rootDir?: string;
  now?: () => string;
}

export interface LearningControlState {
  flags: Record<AdaptiveFlagId, boolean>;
  profileStale: boolean;
  episodes: number;
  profiles: number;
  concepts: number;
  epochs: number;
  snapshots: number;
  decisions: number;
  stablePolicyVersion: string;
  degraded: string[];
}

export class LearningService {
  readonly flags: AdaptiveFlagStore;
  readonly episodes: EpisodeStore;
  readonly snapshots: ModelSnapshotRegistry;
  readonly epochs: BehaviourEpochLedger;
  readonly profiles: ProviderProfileStore;
  readonly concepts: ConceptRegistry;
  readonly feedback: RoutingFeedbackLedger;
  readonly gate: PolicyPromotionGate;
  readonly observer: ModelObserver;
  readonly evaluator: OutcomeEvaluator;
  readonly scorer: AdaptiveScorer;

  private readonly now: () => string;

  constructor(options: LearningServiceOptions = {}) {
    const root = options.rootDir;
    this.now = options.now ?? (() => new Date().toISOString());
    const join = (file: string) => (root ? path.join(root, file) : undefined);
    this.flags = new AdaptiveFlagStore(join("adaptive-flags.json"), this.now);
    this.episodes = new EpisodeStore(root, { now: this.now });
    this.snapshots = new ModelSnapshotRegistry(join("model-snapshots.json"), this.now);
    this.epochs = new BehaviourEpochLedger(join("behaviour-epochs.json"), this.now);
    this.profiles = new ProviderProfileStore(join("provider-profiles.json"));
    this.concepts = new ConceptRegistry(join("concepts.json"));
    this.feedback = new RoutingFeedbackLedger(join("routing-feedback.json"), this.now);
    this.gate = new PolicyPromotionGate(join("policy-gate.json"), this.now);
    this.observer = new ModelObserver();
    this.evaluator = new OutcomeEvaluator({ flags: () => this.flags.get() });
    this.scorer = new AdaptiveScorer({ profiles: this.profiles, flags: () => this.flags.get(), now: this.now });
  }

  /** Convenience: append an observation and refresh derived state lazily. */
  recordEpisode(input: EpisodeAppendInput): LearningEpisode {
    const episode = this.episodes.append(input);
    this.profiles.markStale();
    return episode;
  }

  /** Owner control: rebuild every derived artifact from episodes. */
  rebuildDerived(builtAt = this.now()): { profiles: number; concepts: number } {
    const episodes = this.episodes.all();
    const profiles = this.profiles.rebuild(episodes, { builtAt }).length;
    const concepts = this.concepts.list().length; // mining is explicit (Phase 7) — rebuilt by the caller when desired
    return { profiles, concepts };
  }

  /** Owner control: discard derived data. Episodes are the source of truth and stay. */
  resetDerived(): { episodesKept: number } {
    this.profiles.clear();
    this.snapshots.clear();
    this.feedback.clear();
    const kept = this.episodes.count();
    return { episodesKept: kept };
  }

  /** Owner control: disable adaptive routing while continuing to learn (A37). */
  setAdaptiveRouting(enabled: boolean): LearningControlState {
    this.flags.set("adaptiveRouting", enabled);
    return this.controlState();
  }

  /** Owner control: disable learning entirely (kill switch). */
  setLearning(enabled: boolean): LearningControlState {
    this.flags.set("adaptiveProviderLearning", enabled);
    return this.controlState();
  }

  learningEnabled(): boolean {
    return this.flags.isEnabled("adaptiveProviderLearning");
  }

  adaptiveRoutingEnabled(): boolean {
    return adaptiveCapabilityEnabled("adaptiveRouting", this.flags.get());
  }

  /** Panel projection for the UI (never throws; fails to an empty panel). */
  panel(generatedAt = this.now()): ProviderIntelligencePanel {
    try {
      const profiles = this.profiles.list();
      const latestEpisodeAtByRuntime: Record<string, string> = {};
      for (const episode of this.episodes.all()) {
        const current = latestEpisodeAtByRuntime[episode.runtimeId];
        if (!current || episode.timestamp > current) latestEpisodeAtByRuntime[episode.runtimeId] = episode.timestamp;
      }
      return buildProviderIntelligencePanel({
        generatedAt,
        controls: {
          learningEnabled: this.learningEnabled(),
          adaptiveRoutingEnabled: this.adaptiveRoutingEnabled(),
          profileStale: this.profiles.isStale(),
          degraded: [this.episodes.status().degradedReason, this.profiles.status().degradedReason, this.epochs.status().degradedReason, this.snapshots.status().degradedReason, this.feedback.status().degradedReason, this.gate.status().degradedReason].filter((reason): reason is string => Boolean(reason))
        },
        profiles,
        snapshots: this.snapshots.list(),
        epochs: this.epochs.list(),
        decisions: this.feedback.list().map((record) => ({
          decisionId: record.decisionId,
          taskId: record.taskId,
          policyVersion: record.policyVersion,
          selectedRuntimeId: record.selectedRuntimeId,
          usedFallbackRouter: record.usedFallbackRouter,
          exploration: record.exploration,
          candidates: record.candidates,
          episodeIds: record.episodeIds
        })),
        latestEpisodeAtByRuntime
      });
    } catch {
      return {
        generatedAt,
        controls: { learningEnabled: this.learningEnabled(), adaptiveRoutingEnabled: this.adaptiveRoutingEnabled(), profileStale: true, degraded: ["panel projection failed"] },
        providers: [],
        modelSnapshots: [],
        epochs: [],
        routing: []
      };
    }
  }

  /** Episode drill-down for the UI. */
  drilldown(episodeId: string): EpisodeDrilldown | undefined {
    const episode = this.episodes.get(episodeId);
    return episode ? buildEpisodeDrilldown(episode) : undefined;
  }

  controlState(): LearningControlState {
    return {
      flags: this.flags.get(),
      profileStale: this.profiles.isStale(),
      episodes: this.episodes.count(),
      profiles: this.profiles.count(),
      concepts: this.concepts.count(),
      epochs: this.epochs.count(),
      snapshots: this.snapshots.count(),
      decisions: this.feedback.count(),
      stablePolicyVersion: this.gate.stablePolicy().policyVersion,
      degraded: [this.episodes.status().degradedReason, this.profiles.status().degradedReason, this.epochs.status().degradedReason].filter((reason): reason is string => Boolean(reason))
    };
  }
}
