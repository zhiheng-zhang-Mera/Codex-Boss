/**
 * Self Diagnosis — the host sources that read what Boss already recorded.
 *
 * These are adapters, not owners. Each one reads ONE durable file the application already writes
 * and turns it into `HealthObservation`s; none of them writes, repairs, retries or changes what it
 * observed, and a file that cannot be read becomes an `unreadable` entry with the reason rather
 * than a silent zero.
 *
 * The three sources:
 *
 *   - **telemetry.json** — the runtime outcomes the telemetry recorder already keeps. A run that
 *     keeps failing, or a runtime whose failure share is high, is a reading about the component
 *     that owns it.
 *   - **recovery.json** — how often a task had to be parked for a retry. A recovery storm is a
 *     reading about the runtime that keeps failing, taken from the loop's own behaviour.
 *   - **state.json** — task and run outcomes, which is the application's own record of what it was
 *     asked to do and what happened.
 *
 * Every threshold here is stated in the observation itself (`expectedRange`), so a reading can be
 * argued with rather than obeyed.
 */

import fs from "node:fs";
import path from "node:path";
import {
  measuredObservation,
  statedObservation,
  unknownObservation,
  type HealthObservation,
  type SelfObservationSource,
  type SourceResult
} from "../../src/shared/self-diagnosis/observations";
import type { BossSelfModel } from "../../src/shared/self-cognition/contracts";

export interface SourceOptions {
  dataRoot: string;
  /** The component a reading about a runtime belongs to, when the anatomy names one. */
  componentForRuntime?: (runtimeId: string) => string | undefined;
}

/** The failure share at which a runtime's record stops being noise. */
export const RUNTIME_FAILURE_SHARE_LIMIT = 0.3;
/** Recoveries above this count in the file are a storm. */
export const RECOVERY_COUNT_LIMIT = 5;

function readJson(file: string): { value?: unknown; reason?: string } {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")) as unknown };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Telemetry outcomes, grouped by runtime.
 *
 * The grouping is the application's own: the telemetry store records one entry per runtime
 * observation, and a runtime whose failures dominate its own record is a candidate.
 */
export function telemetrySource(options: SourceOptions): SelfObservationSource {
  return {
    id: "telemetry.json",
    observe: ({ at }: { model: BossSelfModel; at: string }): SourceResult => {
      const file = path.join(options.dataRoot, ".boss", "telemetry.json");
      const read = readJson(file);
      if (read.reason !== undefined) return { observations: [], unreadable: [{ source: "telemetry.json", reason: read.reason }] };
      const entries = isObject(read.value) && Array.isArray(read.value.entries) ? read.value.entries : [];
      const byRuntime = new Map<string, { total: number; failed: number; lastFailure: string }>();
      for (const entry of entries) {
        if (!isObject(entry) || typeof entry.runtimeId !== "string") continue;
        const record = byRuntime.get(entry.runtimeId) ?? { total: 0, failed: 0, lastFailure: "" };
        record.total += 1;
        if (entry.outcome === "FAILED") {
          record.failed += 1;
          const reason = typeof entry.reason === "string" ? entry.reason : "no reason recorded";
          if (record.lastFailure === "") record.lastFailure = reason;
        }
        byRuntime.set(entry.runtimeId, record);
      }
      const observations: HealthObservation[] = [];
      for (const [runtimeId, record] of byRuntime) {
        const componentId = options.componentForRuntime?.(runtimeId) ?? `runtime:${runtimeId}`;
        const share = record.total === 0 ? 0 : record.failed / record.total;
        observations.push(measuredObservation({
          componentId,
          signalId: `${runtimeId}.providerFailureShare`,
          measurement: Math.round(share * 1000) / 1000,
          expectedRange: { max: RUNTIME_FAILURE_SHARE_LIMIT },
          at,
          source: "telemetry.json entries[].outcome",
          confidence: record.total >= 5 ? 0.8 : 0.4,
          detail: `${record.failed} of ${record.total} recorded run(s) for ${runtimeId} failed${record.lastFailure === "" ? "" : `; the last reason was ${record.lastFailure}`}`
        }));
      }
      if (observations.length === 0) {
        observations.push(unknownObservation({ componentId: "telemetry", signalId: "telemetry.providerFailureShare", at, source: "telemetry.json", reason: "the telemetry store holds no runtime entry, so no failure share could be computed" }));
      }
      return { observations, unreadable: [] };
    }
  };
}

/** Recovery records, which are the loop's own account of having to park a task. */
export function recoverySource(options: SourceOptions): SelfObservationSource {
  return {
    id: "recovery.json",
    observe: ({ at }: { model: BossSelfModel; at: string }): SourceResult => {
      const file = path.join(options.dataRoot, ".boss", "recovery.json");
      const read = readJson(file);
      if (read.reason !== undefined) return { observations: [], unreadable: [{ source: "recovery.json", reason: read.reason }] };
      const records = Array.isArray(read.value) ? read.value : isObject(read.value) && Array.isArray(read.value.records) ? read.value.records : [];
      const byRuntime = new Map<string, number>();
      for (const entry of records) {
        if (!isObject(entry)) continue;
        const key = typeof entry.runtimeId === "string" && entry.runtimeId !== "" ? entry.runtimeId : "unattributed";
        byRuntime.set(key, (byRuntime.get(key) ?? 0) + 1);
      }
      const observations = [...byRuntime].map(([runtimeId, count]) => measuredObservation({
        componentId: options.componentForRuntime?.(runtimeId) ?? `runtime:${runtimeId}`,
        signalId: `${runtimeId}.recoveryCount`,
        measurement: count,
        expectedRange: { max: RECOVERY_COUNT_LIMIT },
        at,
        source: "recovery.json records[]",
        confidence: 0.7,
        detail: `${count} recovery record(s) name ${runtimeId}`
      }));
      if (observations.length === 0) {
        observations.push(statedObservation({ componentId: "runtime", signalId: "recovery.count", status: "HEALTHY", at, source: "recovery.json", confidence: 0.5, detail: "the recovery file holds no record, so no task has been parked for a retry" }));
      }
      return { observations, unreadable: [] };
    }
  };
}

/** Task and run outcomes from the application's own state document. */
export function taskOutcomeSource(options: SourceOptions): SelfObservationSource {
  return {
    id: "state.json",
    observe: ({ at }: { model: BossSelfModel; at: string }): SourceResult => {
      const file = path.join(options.dataRoot, "state.json");
      const read = readJson(file);
      if (read.reason !== undefined) return { observations: [], unreadable: [{ source: "state.json", reason: read.reason }] };
      if (!isObject(read.value)) return { observations: [], unreadable: [{ source: "state.json", reason: "the state document did not parse to an object" }] };
      const tasks = Array.isArray(read.value.tasks) ? read.value.tasks : [];
      const runs = Array.isArray(read.value.runs) ? read.value.runs : [];
      const failedRuns = runs.filter((run) => isObject(run) && (run.outcome === "FAILED" || run.outcome === "FAILURE")).length;
      const terminalTasks = tasks.filter((task) => isObject(task) && ["completed", "failed", "failed_permanent", "cancelled"].includes(String(task.status)));
      const failedTasks = terminalTasks.filter((task) => isObject(task) && String(task.status).startsWith("failed")).length;
      const taskFailureShare = terminalTasks.length === 0 ? 0 : Math.round((failedTasks / terminalTasks.length) * 1000) / 1000;
      return {
        observations: [
          measuredObservation({
            componentId: "tasks",
            signalId: "tasks.taskFailureShare",
            measurement: taskFailureShare,
            expectedRange: { max: 0.5 },
            at,
            source: "state.json tasks[].status",
            confidence: terminalTasks.length >= 3 ? 0.7 : 0.3,
            detail: `${failedTasks} of ${terminalTasks.length} terminal task(s) failed`
          }),
          measuredObservation({
            componentId: "providers",
            signalId: "runs.failedRunCount",
            measurement: failedRuns,
            expectedRange: { max: Math.max(3, Math.round(runs.length * 0.3)) },
            at,
            source: "state.json runs[].outcome",
            confidence: 0.6,
            detail: `${failedRuns} of ${runs.length} recorded run(s) failed`
          })
        ],
        unreadable: []
      };
    }
  };
}

/** Every source this host can offer, in the order a diagnosis reads them. */
export function hostObservationSources(options: SourceOptions): SelfObservationSource[] {
  return [taskOutcomeSource(options), telemetrySource(options), recoverySource(options)];
}
