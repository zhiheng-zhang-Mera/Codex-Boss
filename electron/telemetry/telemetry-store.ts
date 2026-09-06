import { readJson, writeJson } from "../commander/durable-json";

/**
 * Telemetry / Performance DB (plan §12, §16). Aggregates the observable
 * per-worker outcome events (from the domain bus) into durable per-runtime and
 * per-task records: decision → reason → outcome seed, cost/token/latency
 * aggregates, bounded history.
 */

export type TelemetryOutcome = "SUCCESS" | "FAILED" | "CANCELLED" | "DEFERRED";

export interface TelemetryRecord {
  taskId: string;
  jobId: string;
  runtimeId: string;
  role: string;
  outcome: TelemetryOutcome;
  reason?: string;
  modelCalls: number;
  estimatedTokens: number;
  latencyMs: number;
  retries: number;
  at: string;
}

export interface RuntimeAggregate {
  runs: number;
  success: number;
  failures: number;
  modelCalls: number;
  estimatedTokens: number;
  totalLatencyMs: number;
}

export interface TelemetryFile {
  schemaVersion: 1;
  records: TelemetryRecord[];
}

const MAX_RECORDS = 2000;

export class TelemetryStore {
  constructor(private readonly file: string) {}

  record(entry: TelemetryRecord): void {
    const file = this.read();
    file.records = [...file.records, entry].slice(-MAX_RECORDS);
    writeJson(this.file, file);
  }

  byRuntime(): Record<string, RuntimeAggregate> {
    const aggregates: Record<string, RuntimeAggregate> = {};
    for (const record of this.read().records) {
      const aggregate = aggregates[record.runtimeId] ?? { runs: 0, success: 0, failures: 0, modelCalls: 0, estimatedTokens: 0, totalLatencyMs: 0 };
      aggregate.runs += 1;
      if (record.outcome === "SUCCESS") aggregate.success += 1; else if (record.outcome === "FAILED") aggregate.failures += 1;
      aggregate.modelCalls += record.modelCalls;
      aggregate.estimatedTokens += record.estimatedTokens;
      aggregate.totalLatencyMs += record.latencyMs;
      aggregates[record.runtimeId] = aggregate;
    }
    return aggregates;
  }

  byTask(taskId: string): TelemetryRecord[] { return this.read().records.filter((record) => record.taskId === taskId); }

  list(): TelemetryRecord[] { return this.read().records; }

  private read(): TelemetryFile {
    const value = readJson<Partial<TelemetryFile>>(this.file);
    if (!value) return { schemaVersion: 1, records: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error("Invalid telemetry store");
    return { schemaVersion: 1, records: value.records };
  }
}
