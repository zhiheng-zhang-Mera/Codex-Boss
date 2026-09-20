/**
 * Runtime Intelligence Plane — real outcome sources.
 *
 * Phase G's ingestion has to read what Boss ALREADY records rather than establish a second
 * task-result system, so this module reads the two durable sources that exist and reuses
 * their real readers:
 *
 *   - `electron/telemetry/telemetry-store.ts#TelemetryStore` over `<dataRoot>/.boss/telemetry.json`,
 *     which is what the running application writes for every worker outcome;
 *   - `electron/learning/episode-store.ts#EpisodeStore` over `<dataRoot>/.boss/learning/episodes.jsonl`,
 *     which carries the richer record (provider, semantic outcome, runtime failure code).
 *
 * Both real readers THROW on a structurally invalid file, so every read is wrapped: a
 * damaged source degrades to zero records with the reason recorded, and the other source
 * still contributes. A plane that cannot read its input must not stop the work it observes,
 * and it must not silently report "no data" either.
 *
 * Model identity is derived honestly: the provider comes from the episode when it recorded
 * one, the family from the runtime id, and the VERSION is left absent so `modelKeyOf` spells
 * it `unknown`. A runtime id is not a model version and this module will not pretend it is.
 */

import fs from "node:fs";
import path from "node:path";
import { EpisodeStore } from "../learning/episode-store";
import { TelemetryStore, type TelemetryRecord } from "../telemetry/telemetry-store";
import type { LearningEpisode } from "../../src/shared/learning-episode";
import type { OutcomeSignals } from "../../src/shared/runtime-intelligence/outcome-ingestion";

/** One outcome as a real Boss record reported it, normalized without losing the original words. */
export interface RealOutcomeRecord {
  source: "telemetry" | "episode";
  taskId: string;
  jobId?: string;
  runtimeId: string;
  role?: string;
  /** The raw outcome word, exactly as recorded ("SUCCESS", "FAILED", "RETRYABLE_FAILURE", ...). */
  rawOutcome: string;
  reason?: string;
  provider?: string;
  surface?: string;
  modelSnapshotId?: string;
  semanticOutcome?: string;
  runtimeFailureCode?: string;
  latencyMs?: number;
  tokens?: number;
  retries?: number;
  at: string;
}

export interface OutcomeSourceReport {
  name: "telemetry" | "episode";
  file: string;
  present: boolean;
  records: number;
  degradedReason?: string;
}

export interface RealOutcomeReadResult {
  dataRoot: string;
  records: RealOutcomeRecord[];
  sources: OutcomeSourceReport[];
  /** Every source that could not be read, with its reason. Empty means a clean read. */
  degraded: string[];
}

export interface OutcomeSourceOptions {
  dataRoot: string;
}

/** The telemetry file the running application writes. */
export function telemetryFileOf(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "telemetry.json");
}

/** The learning episode directory the running application writes. */
export function learningRootOf(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "learning");
}

function fromTelemetry(record: TelemetryRecord): RealOutcomeRecord {
  return {
    source: "telemetry",
    taskId: record.taskId,
    jobId: record.jobId,
    runtimeId: record.runtimeId,
    role: record.role,
    rawOutcome: record.outcome,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.latencyMs === undefined ? {} : { latencyMs: record.latencyMs }),
    ...(record.estimatedTokens === undefined ? {} : { tokens: record.estimatedTokens }),
    ...(record.retries === undefined ? {} : { retries: record.retries }),
    at: record.at
  };
}

function fromEpisode(episode: LearningEpisode): RealOutcomeRecord {
  const evaluation = episode.semanticEvaluation;
  return {
    source: "episode",
    taskId: episode.taskId,
    ...(episode.jobId === undefined ? {} : { jobId: episode.jobId }),
    runtimeId: episode.runtimeId,
    role: episode.role,
    rawOutcome: episode.runtimeStatus,
    ...(episode.provider === undefined ? {} : { provider: episode.provider }),
    ...(episode.surface === undefined ? {} : { surface: episode.surface }),
    ...(episode.modelSnapshotId === undefined ? {} : { modelSnapshotId: episode.modelSnapshotId }),
    ...(episode.runtimeFailureCode === undefined ? {} : { runtimeFailureCode: episode.runtimeFailureCode }),
    ...(evaluation === undefined ? {} : { semanticOutcome: evaluation.outcome }),
    ...(episode.durationMs === undefined ? {} : { latencyMs: episode.durationMs }),
    at: episode.timestamp
  };
}

/**
 * Reads every real outcome source under a data root.
 *
 * A missing source is reported as `present: false` with zero records — a clean, empty read,
 * not a degradation. A source that exists but cannot be parsed is reported as degraded with
 * the reader's own error message.
 */
export function readRealOutcomes(options: OutcomeSourceOptions): RealOutcomeReadResult {
  const dataRoot = options.dataRoot;
  const sources: OutcomeSourceReport[] = [];
  const degraded: string[] = [];
  const records: RealOutcomeRecord[] = [];

  const telemetryFile = telemetryFileOf(dataRoot);
  const telemetryPresent = safeExists(telemetryFile);
  if (!telemetryPresent) {
    sources.push({ name: "telemetry", file: telemetryFile, present: false, records: 0 });
  } else {
    try {
      const read = new TelemetryStore(telemetryFile).list().map(fromTelemetry);
      records.push(...read);
      sources.push({ name: "telemetry", file: telemetryFile, present: true, records: read.length });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      degraded.push(`telemetry could not be read: ${reason}`);
      sources.push({ name: "telemetry", file: telemetryFile, present: true, records: 0, degradedReason: reason });
    }
  }

  const learningRoot = learningRootOf(dataRoot);
  const episodesFile = path.join(learningRoot, "episodes.jsonl");
  const episodesPresent = safeExists(episodesFile);
  if (!episodesPresent) {
    sources.push({ name: "episode", file: episodesFile, present: false, records: 0 });
  } else {
    try {
      const read = new EpisodeStore(learningRoot).all().map(fromEpisode);
      records.push(...read);
      sources.push({ name: "episode", file: episodesFile, present: true, records: read.length });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      degraded.push(`learning episodes could not be read: ${reason}`);
      sources.push({ name: "episode", file: episodesFile, present: true, records: 0, degradedReason: reason });
    }
  }

  records.sort((left, right) => (left.at === right.at ? 0 : left.at < right.at ? -1 : 1));
  return { dataRoot, records, sources, degraded };
}

function safeExists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/**
 * The signals a real record actually carries, and nothing more.
 *
 * `producedOutput` is deliberately NOT set from a telemetry record: telemetry does not say
 * whether an output was produced, and inferring it from `modelCalls > 0` would claim more
 * than the record does. Without it, an unattributed failure stays `UNKNOWN`, which is the
 * correct fail-closed answer.
 */
export function toIngestionSignals(record: RealOutcomeRecord): OutcomeSignals {
  return {
    runtimeStatus: record.rawOutcome,
    ...(record.runtimeFailureCode === undefined ? {} : { runtimeFailureCode: record.runtimeFailureCode }),
    ...(record.semanticOutcome === undefined ? {} : { semanticOutcome: record.semanticOutcome }),
    ...(record.reason === undefined ? {} : { reason: record.reason })
  };
}

/**
 * The model identity a real record supports.
 *
 * `version` is intentionally not part of the result: the sources record a runtime id and,
 * at best, a provider. Inventing a version from the runtime id is the fabrication the model
 * identity module forbids, so the version stays absent and reads as `unknown`.
 */
export function modelIdentityFor(record: RealOutcomeRecord): { provider: string; family: string } {
  const provider = (record.provider ?? "").trim() || (record.runtimeId.split(":")[0] ?? "").trim() || "unknown";
  const family = (record.runtimeId ?? "").trim() || "unknown";
  return { provider, family };
}
