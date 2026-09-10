import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../../commander/durable-json";
import { EPOCH_SCHEMA_VERSION, epochIdFor, epochScopeKey, type BehaviourEpoch, type EpochScope, type EpochTrigger } from "../../../src/shared/behaviour-epoch";
import { detectChangePoint, type BehaviourSample, type ChangePointOptions, type ChangePointResult } from "./change-point-detector";

/**
 * Engine Phase 8 — behaviour epoch ledger (durable, derived from episodes).
 *
 * Responsibilities:
 *  - keep the CURRENT epoch per (provider, surface, selected model, observed model);
 *  - open a new epoch on an observed model-id change or on a sustained behaviour
 *    change that passed the detector's gate (A19) — never on a single anomaly (A20);
 *  - close the previous epoch (endedAt) and link the new one as its child so the
 *    cold start inherits a decayed prior (A33);
 *  - preserve every previous epoch for separate querying (A34);
 *  - degrade, never throw: a corrupt ledger means "no epoch info", and callers
 *    simply route without epoch separation (A30).
 */

export interface EpochLedgerFile {
  schemaVersion: 1;
  epochs: BehaviourEpoch[];
}

export interface EpochObservationResult {
  epoch: BehaviourEpoch;
  opened: boolean;
  detection?: ChangePointResult;
  reason: string;
}

/** Series identity: provider + surface + selected model (observed model excluded). */
function seriesKeyOf(scope: Pick<EpochScope, "provider" | "surface" | "selectedModel">): string {
  return [scope.provider, scope.surface, scope.selectedModel ?? "auto"].join("::");
}

export class BehaviourEpochLedger {  private readonly epochs: BehaviourEpoch[] = [];
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Current open epoch for a scope (undefined ⇒ treat as epoch-less). */
  current(scope: EpochScope): BehaviourEpoch | undefined {
    const key = epochScopeKey(scope);
    const open = this.epochs.filter((epoch) => epochScopeKey(epoch) === key && epoch.endedAt === undefined);
    open.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return open[0] ? structuredClone(open[0]) : undefined;
  }

  /**
   * Latest open epoch of the same SERIES (provider + surface + selected model),
   * ignoring the observed model id. Used to detect a model-id change and to
   * parent the new epoch so it inherits a decayed prior.
   */
  currentForSeries(scope: EpochScope): BehaviourEpoch | undefined {
    const seriesKey = seriesKeyOf(scope);
    const open = this.epochs.filter((epoch) => seriesKeyOf(epoch) === seriesKey && epoch.endedAt === undefined);
    open.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return open[0] ? structuredClone(open[0]) : undefined;
  }

  /** Open a new epoch (closing the open epochs of the same series) for an explicit trigger. */
  open(scope: EpochScope, trigger: EpochTrigger, confidence: number, evidenceEpisodeIds: string[], kindredObservedModelId?: string): BehaviourEpoch {
    const startedAt = this.now();
    const seriesKey = seriesKeyOf(scope);
    const previous = this.currentForSeries(scope); // read the parent BEFORE closing it
    for (let index = 0; index < this.epochs.length; index++) {
      const epoch = this.epochs[index];
      if (epoch.endedAt === undefined && seriesKeyOf(epoch) === seriesKey) this.epochs[index] = { ...epoch, endedAt: startedAt };
    }
    const epoch: BehaviourEpoch = {
      schemaVersion: EPOCH_SCHEMA_VERSION,
      epochId: epochIdFor(scope, startedAt, this.epochs.filter((item) => seriesKeyOf(item) === seriesKey).length + 1),
      provider: scope.provider,
      surface: scope.surface,
      selectedModel: scope.selectedModel,
      observedModelId: kindredObservedModelId ?? scope.observedModelId,
      startedAt,
      parentEpochId: previous?.epochId,
      trigger,
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
      evidenceEpisodeIds: [...new Set(evidenceEpisodeIds)]
    };
    this.epochs.push(epoch);
    this.persist();
    return structuredClone(epoch);
  }

  /**
   * Feed observations into the ledger: opens an epoch only when the detector
   * (or an observed model-id change) justifies it. Always returns a usable epoch.
   */
  observe(scope: EpochScope, samples: BehaviourSample[], options: ChangePointOptions = {}): EpochObservationResult {
    const detection = detectChangePoint(samples, options);
    const exact = this.current(scope);
    const series = this.currentForSeries(scope);

    // Model-id change always separates epochs (book §9 first trigger).
    if (series && scope.observedModelId !== undefined && series.observedModelId !== scope.observedModelId) {
      const epoch = this.open(scope, "OBSERVED_MODEL_CHANGE", 0.9, detection.afterIds, scope.observedModelId);
      return { epoch, opened: true, detection, reason: `observed model changed ${series.observedModelId ?? "unknown"} → ${scope.observedModelId}` };
    }
    if (!series) {
      const epoch = this.open(scope, "MANUAL_RESET", 0.5, samples.map((sample) => sample.episodeId));
      return { epoch, opened: true, detection, reason: "first epoch for scope" };
    }
    if (detection.changed) {
      const epoch = this.open(scope, "SUSTAINED_BEHAVIOUR_CHANGE", detection.confidence, detection.afterIds);
      return { epoch, opened: true, detection, reason: detection.reasons.join("; ") };
    }
    return { epoch: exact ?? series, opened: false, detection, reason: detection.reasons.join("; ") };
  }

  get(epochId: string): BehaviourEpoch | undefined {
    const epoch = this.epochs.find((item) => item.epochId === epochId);
    return epoch ? structuredClone(epoch) : undefined;
  }

  /** All epochs for a scope, oldest first (old history stays queryable — A34). */
  history(scope: EpochScope): BehaviourEpoch[] {
    const key = epochScopeKey(scope);
    return this.epochs
      .filter((epoch) => epochScopeKey(epoch) === key)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((epoch) => structuredClone(epoch));
  }

  /** Epochs by provider (optionally filtered by observed model id). */
  byProvider(provider: string, observedModelId?: string): BehaviourEpoch[] {
    return this.epochs
      .filter((epoch) => epoch.provider === provider && (observedModelId === undefined || epoch.observedModelId === observedModelId))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((epoch) => structuredClone(epoch));
  }

  list(): BehaviourEpoch[] {
    return this.epochs.map((epoch) => structuredClone(epoch)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  count(): number {
    return this.epochs.length;
  }

  status(): { count: number; degradedReason?: string } {
    return { count: this.epochs.length, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<EpochLedgerFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.epochs)) throw new Error("Invalid behaviour epoch file");
      for (const epoch of parsed.epochs) {
        if (!epoch || typeof epoch.epochId !== "string" || typeof epoch.provider !== "string") throw new Error("Invalid behaviour epoch row");
        this.epochs.push(epoch);
      }
    } catch (error) {
      this.epochs.length = 0;
      this.degraded = `behaviour epochs unreadable: ${String(error)}`; // A30: routing continues without epochs
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: EpochLedgerFile = { schemaVersion: 1, epochs: this.epochs };
      writeJson(this.filePath, file);
    } catch (error) {
      this.degraded = `behaviour epoch persist failed: ${String(error)}`;
    }
  }
}
