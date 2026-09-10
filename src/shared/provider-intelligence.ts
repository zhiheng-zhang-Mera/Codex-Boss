/**
 * Engine Phase 11 — provider intelligence panel view model (pure).
 *
 * The owner must be able to answer, without reading logs:
 *   - which model is actually answering (observed vs declared vs inferred vs unknown),
 *   - how a provider has behaved recently (completion / fidelity / verification /
 *     restriction / runtime reliability / latency),
 *   - why the router picked B instead of A,
 *   - what changed (behaviour epochs), and
 *   - which learning controls are active.
 *
 * This module owns ONLY the projection: it takes already-loaded records and
 * produces a deterministic, JSON-safe panel. It never reads storage, so the UI
 * can never be the reason a background task fails.
 */

import type { MetricEstimate, ProviderBehaviourProfile } from "./provider-profile";
import type { ModelSnapshot } from "./model-identity";
import type { BehaviourEpoch } from "./behaviour-epoch";
import { provenanceOf, type ModelExecutionIdentity } from "./model-identity";
import { GLOBAL_METRIC_KEYS } from "./provider-profile";

export interface ProviderIntelligenceControls {
  learningEnabled: boolean;
  adaptiveRoutingEnabled: boolean;
  profileStale: boolean;
  degraded: string[];
}

/** Structural view of a routing decision (avoids importing the electron ledger type). */
export interface RoutingDecisionView {
  decisionId: string;
  taskId: string;
  policyVersion: string;
  selectedRuntimeId?: string;
  usedFallbackRouter: boolean;
  exploration?: { enabled: boolean; reason?: string };
  candidates: Array<{ runtimeId: string; expectedUtility?: number; confidence?: number; explanation: string[] }>;
  /** Episodes produced by this decision (for drill-down links). */
  episodeIds?: string[];
}

export interface ProviderPanelRow {
  runtimeId: string;
  provider?: string;
  surface?: string;
  observedModelId?: string;
  observedModelSource?: ModelExecutionIdentity["versionSource"];
  observedModelConfidence?: number;
  observedModelProvenance: ReturnType<typeof provenanceOf>;
  behaviourEpochId?: string;
  sampleCount: number;
  metrics: Record<string, MetricEstimate>;
  strongSignals: string[];
  recentChanges: string[];
}

export interface ModelTimelineEntry {
  id: string;
  provider: string;
  surface: string;
  selectedModel?: string;
  observedModelId?: string;
  versionSource: ModelExecutionIdentity["versionSource"];
  provenance: ReturnType<typeof provenanceOf>;
  confidence: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface EpochTimelineEntry {
  epochId: string;
  provider: string;
  surface: string;
  observedModelId?: string;
  startedAt: string;
  endedAt?: string;
  trigger: BehaviourEpoch["trigger"];
  confidence: number;
  parentEpochId?: string;
  open: boolean;
}

export interface ProviderIntelligencePanel {
  generatedAt: string;
  controls: ProviderIntelligenceControls;
  providers: ProviderPanelRow[];
  modelSnapshots: ModelTimelineEntry[];
  epochs: EpochTimelineEntry[];
  routing: Array<{
    decisionId: string;
    taskId: string;
    selectedRuntimeId?: string;
    usedFallbackRouter: boolean;
    exploration?: { enabled: boolean; reason?: string };
    candidates: Array<{ runtimeId: string; expectedUtility?: number; confidence?: number; explanation: string[] }>;
    episodeIds: string[];
  }>;
}

/** Owner-visible learning control state (bridge-facing, JSON-safe). */
export interface LearningControlStateView {
  flags: Record<string, boolean>;
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

export interface ProviderIntelligenceInput {
  generatedAt: string;
  controls: ProviderIntelligenceControls;
  profiles: ProviderBehaviourProfile[];
  snapshots: ModelSnapshot[];
  epochs: BehaviourEpoch[];
  decisions: RoutingDecisionView[];
  /** Episode timestamps per runtime, used for recent-change reporting. */
  latestEpisodeAtByRuntime?: Record<string, string>;
  /** Window (ms) considered "recent" for change reporting. */
  recentWindowMs?: number;
}

const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function buildProviderIntelligencePanel(input: ProviderIntelligenceInput): ProviderIntelligencePanel {
  const windowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const generatedAtMs = Date.parse(input.generatedAt);

  const providers: ProviderPanelRow[] = [...input.profiles]
    .sort((a, b) => a.runtimeId.localeCompare(b.runtimeId) || (a.modelSnapshotKey ?? "").localeCompare(b.modelSnapshotKey ?? ""))
    .map((profile) => {
      const snapshot = input.snapshots.find((item) => item.identity.provider === profile.provider && item.identity.surface === profile.surface);
      const epochs = input.epochs.filter((epoch) => epoch.provider === profile.provider && epoch.surface === profile.surface);
      const openEpoch = [...epochs].reverse().find((epoch) => epoch.endedAt === undefined);
      const metrics: Record<string, MetricEstimate> = {};
      for (const key of GLOBAL_METRIC_KEYS) metrics[key] = profile.global[key];
      return {
        runtimeId: profile.runtimeId,
        provider: profile.provider,
        surface: profile.surface,
        observedModelId: snapshot?.identity.observedModelId,
        observedModelSource: snapshot?.identity.versionSource,
        observedModelConfidence: snapshot?.identity.confidence,
        observedModelProvenance: snapshot ? provenanceOf(snapshot.identity) : "UNKNOWN",
        behaviourEpochId: profile.behaviourEpochId ?? openEpoch?.epochId,
        sampleCount: profile.builtFromEpisodeCount,
        metrics,
        strongSignals: strongSignalsOf(profile),
        recentChanges: recentChangesOf(profile, epochs, input.latestEpisodeAtByRuntime?.[profile.runtimeId], generatedAtMs, windowMs)
      };
    });

  const modelSnapshots: ModelTimelineEntry[] = [...input.snapshots]
    .sort((a, b) => a.firstObservedAt.localeCompare(b.firstObservedAt) || a.id.localeCompare(b.id))
    .map((snapshot) => ({
      id: snapshot.id,
      provider: snapshot.identity.provider,
      surface: snapshot.identity.surface,
      selectedModel: snapshot.identity.selectedModel,
      observedModelId: snapshot.identity.observedModelId,
      versionSource: snapshot.identity.versionSource,
      provenance: provenanceOf(snapshot.identity),
      confidence: snapshot.identity.confidence,
      firstObservedAt: snapshot.firstObservedAt,
      lastObservedAt: snapshot.lastObservedAt
    }));

  const epochs: EpochTimelineEntry[] = [...input.epochs]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.epochId.localeCompare(b.epochId))
    .map((epoch) => ({
      epochId: epoch.epochId,
      provider: epoch.provider,
      surface: epoch.surface,
      observedModelId: epoch.observedModelId,
      startedAt: epoch.startedAt,
      endedAt: epoch.endedAt,
      trigger: epoch.trigger,
      confidence: epoch.confidence,
      parentEpochId: epoch.parentEpochId,
      open: epoch.endedAt === undefined
    }));

  const routing = [...input.decisions]
    .sort((a, b) => a.decisionId.localeCompare(b.decisionId))
    .map((decision) => ({
      decisionId: decision.decisionId,
      taskId: decision.taskId,
      selectedRuntimeId: decision.selectedRuntimeId,
      usedFallbackRouter: decision.usedFallbackRouter,
      exploration: decision.exploration,
      candidates: decision.candidates.map((candidate) => ({
        runtimeId: candidate.runtimeId,
        expectedUtility: candidate.expectedUtility,
        confidence: candidate.confidence,
        explanation: [...candidate.explanation]
      })),
      episodeIds: [...(decision.episodeIds ?? [])]
    }));

  return { generatedAt: input.generatedAt, controls: input.controls, providers, modelSnapshots, epochs, routing };
}

/** Only statistically meaningful, owner-relevant signals are surfaced. */
export function strongSignalsOf(profile: ProviderBehaviourProfile): string[] {
  const signals: string[] = [];
  const completion = profile.global.completion;
  const restriction = profile.global.restrictionImpact;
  const reliability = profile.global.runtimeReliability;
  const verification = profile.global.verificationPass;
  if (completion.samples > 0 && completion.confidence >= 0.6 && completion.mean < 0.5) {
    signals.push(`low completion ${completion.mean} (confident, n=${completion.samples})`);
  }
  if (completion.samples > 0 && completion.mean >= 0.8) signals.push(`strong completion ${completion.mean} (n=${completion.samples})`);
  if (restriction.samples > 0 && restriction.mean > 0.3) signals.push(`elevated restriction impact ${restriction.mean} (n=${restriction.samples})`);
  if (reliability.samples > 0 && reliability.mean < 0.7) signals.push(`runtime reliability degraded ${reliability.mean} (n=${reliability.samples})`);
  if (verification.samples > 0 && verification.mean < 0.5) signals.push(`verification pass rate low ${verification.mean} (n=${verification.samples})`);
  for (const override of profile.conceptOverrides) {
    const deviation = override.deviation?.completion;
    if (typeof deviation === "number" && Math.abs(deviation) >= 0.25) {
      signals.push(`concept ${override.conceptId}: completion ${deviation > 0 ? "+" : ""}${deviation}`);
    }
  }
  return signals;
}

function recentChangesOf(profile: ProviderBehaviourProfile, epochs: BehaviourEpoch[], latestEpisodeAt: string | undefined, nowMs: number, windowMs: number): string[] {
  const changes: string[] = [];
  for (const epoch of epochs) {
    if (nowMs - Date.parse(epoch.startedAt) <= windowMs) {
      changes.push(`epoch ${epoch.epochId} opened (${epoch.trigger.toLowerCase().replace(/_/g, " ")}, confidence ${epoch.confidence})`);
    }
  }
  if (profile.parentProfileId) changes.push(`built from a decayed prior (${profile.parentProfileId})`);
  if (latestEpisodeAt && nowMs - Date.parse(latestEpisodeAt) <= windowMs) changes.push(`recent evidence at ${latestEpisodeAt}`);
  return changes;
}

/** Episode drill-down projection (bounded, no artifact bodies). */
export interface EpisodeDrilldown {
  episodeId: string;
  taskId: string;
  jobId: string;
  timestamp: string;
  runtimeId: string;
  provider?: string;
  surface?: string;
  role: string;
  modelSnapshotId?: string;
  behaviourEpochId?: string;
  runtimeStatus: string;
  runtimeFailureCode?: string;
  semanticOutcome?: string;
  axes?: Record<string, number | undefined>;
  evaluatorVersion?: string;
  artifactRefs: string[];
  evidenceRefs: string[];
  /** True when this episode may feed semantic profiles (runtime faults may not). */
  contributesToProfile: boolean;
}

/** Deterministic episode drill-down (Owner-facing detail view). */
export function buildEpisodeDrilldown(episode: {
  episodeId: string;
  taskId: string;
  jobId: string;
  timestamp: string;
  runtimeId: string;
  provider?: string;
  surface?: string;
  role: string;
  modelSnapshotId?: string;
  behaviourEpochId?: string;
  runtimeStatus: string;
  runtimeFailureCode?: string;
  artifactRefs: string[];
  evidenceRefs: string[];
  semanticEvaluation?: {
    outcome: string;
    evaluatorVersion: string;
    penalizesSemanticProfile: boolean;
    axes: { completion: number; goalFidelity: number; restrictionImpact: number; sanitizationImpact: number; pipelineBlocking: number; quality?: number; verificationScore?: number };
  };
}): EpisodeDrilldown {
  return {
    episodeId: episode.episodeId,
    taskId: episode.taskId,
    jobId: episode.jobId,
    timestamp: episode.timestamp,
    runtimeId: episode.runtimeId,
    provider: episode.provider,
    surface: episode.surface,
    role: episode.role,
    modelSnapshotId: episode.modelSnapshotId,
    behaviourEpochId: episode.behaviourEpochId,
    runtimeStatus: episode.runtimeStatus,
    runtimeFailureCode: episode.runtimeFailureCode,
    semanticOutcome: episode.semanticEvaluation?.outcome,
    axes: episode.semanticEvaluation ? { ...episode.semanticEvaluation.axes } : undefined,
    evaluatorVersion: episode.semanticEvaluation?.evaluatorVersion,
    artifactRefs: [...episode.artifactRefs],
    evidenceRefs: [...episode.evidenceRefs],
    contributesToProfile: episode.semanticEvaluation?.penalizesSemanticProfile === true
  };
}
