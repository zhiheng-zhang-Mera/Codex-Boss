/**
 * Engine Phase 2 — LearningEpisode contract (pure).
 *
 * The episode is the smallest long-term learning fact (book §10). It keeps
 * everything needed to rebuild every derived artifact (profiles, concepts,
 * epochs) from scratch, and it is append-only: a later evaluator revision never
 * rewrites the original observation.
 */

import type { SemanticEvaluation } from "./provider-outcome";
import type { TaskFingerprint } from "./task-fingerprint";

export const EPISODE_SCHEMA_VERSION = 1 as const;

export interface LearningEpisode {
  schemaVersion: typeof EPISODE_SCHEMA_VERSION;
  episodeId: string;

  taskId: string;
  jobId: string;
  timestamp: string;

  canonicalGoalHash: string;
  taskFingerprint: TaskFingerprint;

  runtimeId: string;
  /** Provider family the runtime belongs to (web:chatgpt → chatgpt). */
  provider?: string;
  surface?: string;
  /**
   * Contributing node (multi-device, Engine §9/§17): episodes from every node of
   * one user land in the same user-level store, and this keeps the origin.
   */
  nodeId?: string;
  /**
   * Causal source of a runtime-layer failure. A device/network/host problem must
   * never be counted as "provider reliability is poor" (A48).
   */
  causalSource?: "PROVIDER" | "DEVICE" | "NETWORK" | "HOST" | "UNKNOWN";
  role: string;

  modelSnapshotId?: string;
  /** Behaviour epoch active when this episode happened (Phase 8). */
  behaviourEpochId?: string;

  runtimeStatus: "SUCCESS" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE" | "CANCELLED";
  runtimeFailureCode?: string;

  semanticEvaluation?: SemanticEvaluation;

  artifactRefs: string[];
  evidenceRefs: string[];

  durationMs?: number;
  resourceCost?: number;

  evaluatorVersion?: string;
  fingerprintVersion: string;
  profilePolicyVersion?: string;
  routingPolicyVersion?: string;
}

export interface EpisodeQuery {
  runtimeId?: string;
  provider?: string;
  surface?: string;
  nodeId?: string;
  /** Only episodes whose runtime-layer failure was attributed to the provider itself. */
  providerAttributedOnly?: boolean;
  role?: string;
  modelSnapshotId?: string;
  behaviourEpochId?: string;
  taskId?: string;
  jobId?: string;
  structuralHash?: string;
  conceptId?: string;
  from?: string;
  to?: string;
  /** Only episodes whose semantic evaluation is usable for profile learning. */
  semanticOnly?: boolean;
  limit?: number;
}

/** Deterministic structural validation used on load (corrupt rows are skipped,
 *  never fatal: a broken episode store must degrade learning, not Boss). */
export function isValidEpisode(value: unknown): value is LearningEpisode {
  if (!value || typeof value !== "object") return false;
  const episode = value as Partial<LearningEpisode>;
  return (
    episode.schemaVersion === EPISODE_SCHEMA_VERSION &&
    typeof episode.episodeId === "string" &&
    episode.episodeId.length > 0 &&
    typeof episode.taskId === "string" &&
    typeof episode.jobId === "string" &&
    typeof episode.runtimeId === "string" &&
    typeof episode.role === "string" &&
    typeof episode.timestamp === "string" &&
    Boolean(episode.taskFingerprint) &&
    Array.isArray(episode.artifactRefs) &&
    Array.isArray(episode.evidenceRefs)
  );
}

/** True when this episode may contribute to semantic profiles. */
export function episodeContributesToProfile(episode: LearningEpisode): boolean {
  return episode.semanticEvaluation !== undefined && episode.semanticEvaluation.penalizesSemanticProfile === true;
}

export function matchesQuery(episode: LearningEpisode, query: EpisodeQuery): boolean {
  if (query.runtimeId && episode.runtimeId !== query.runtimeId) return false;
  if (query.provider && episode.provider !== query.provider) return false;
  if (query.surface && episode.surface !== query.surface) return false;
  if (query.nodeId && episode.nodeId !== query.nodeId) return false;
  // A device/network/host-attributed failure is not provider evidence (A48).
  if (query.providerAttributedOnly && episode.causalSource !== undefined && episode.causalSource !== "PROVIDER") return false;
  if (query.role && episode.role !== query.role) return false;
  if (query.modelSnapshotId && episode.modelSnapshotId !== query.modelSnapshotId) return false;
  if (query.behaviourEpochId && episode.behaviourEpochId !== query.behaviourEpochId) return false;
  if (query.taskId && episode.taskId !== query.taskId) return false;
  if (query.jobId && episode.jobId !== query.jobId) return false;
  if (query.structuralHash && episode.taskFingerprint?.structuralHash !== query.structuralHash) return false;
  if (query.conceptId && !(episode.taskFingerprint?.concepts ?? []).some((concept) => concept.conceptId === query.conceptId)) return false;
  if (query.from && episode.timestamp < query.from) return false;
  if (query.to && episode.timestamp > query.to) return false;
  if (query.semanticOnly && !episodeContributesToProfile(episode)) return false;
  return true;
}
