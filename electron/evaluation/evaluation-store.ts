import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import { compileIntent } from "../../src/shared/task-ir";
import { executeNative } from "../engineering/native-tools";
import { removeTree } from "../fs-util";
import type { EvaluationRecord, GoldenTask } from "../../src/shared/evaluation";
import { summarizeBaseline, EXIT_TARGETS } from "../../src/shared/evaluation";

/**
 * Evaluation suite core (plan §8 / §12). A persistent baseline metric store
 * plus a deterministic runner for simple/native golden tasks so the v1 exit
 * targets (simple ≥95%) are measurable, not asserted.
 */

interface EvaluationFile {
  schemaVersion: 1;
  goldens: GoldenTask[];
  records: EvaluationRecord[];
}

export class EvaluationStore {
  /** Set when the durable file exists but could not be used. */
  private loadFailure?: string;
  constructor(private readonly file: string) {}

  /**
   * The durable baseline.
   *
   * A store that exists but cannot be used REFUSES rather than reading as an empty
   * baseline — that direction was already right, because `readJson` throws on an
   * unparseable file. What was wrong is how it refused: a raw `SyntaxError` from
   * inside a JSON parse reached the caller with no file name and no statement that
   * the durable measurement history is damaged, and nothing recorded the fact for a
   * later reader. The refusal is still a throw; it now says what happened, and
   * `loadDiagnostic()` reports it to anything that asks instead.
   */
  load(): EvaluationFile {
    let value: Partial<EvaluationFile> | undefined;
    try {
      value = readJson<Partial<EvaluationFile>>(this.file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.loadFailure = `${this.file} exists but could not be parsed: ${message}`;
      throw new Error(`Evaluation baseline is unreadable: ${this.file} (${message})`);
    }
    if (!value) return { schemaVersion: 1, goldens: [], records: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.goldens) || !Array.isArray(value.records)) {
      this.loadFailure = `${this.file} is not an evaluation store`;
      throw new Error("Invalid evaluation store");
    }
    this.loadFailure = undefined;
    return { schemaVersion: 1, goldens: value.goldens, records: value.records };
  }

  /** Why the last load could not use the durable file, or `undefined` when it did. */
  loadDiagnostic(): string | undefined {
    return this.loadFailure;
  }

  record(entry: EvaluationRecord): void {
    // `load()` throws on a damaged or foreign store, so this write can never replace
    // one: the refusal is what protects the measurement history, and it is asserted.
    const file = this.load();
    // Latest run per golden id: keeps the baseline deterministic and bounded.
    file.records = [...file.records.filter((item) => item.goldenId !== entry.goldenId), entry];
    writeJson(this.file, file);
    this.loadFailure = undefined;
  }

  records(): EvaluationRecord[] { return this.load().records; }

  baseline(): ReturnType<typeof summarizeBaseline> { return summarizeBaseline(this.load().records); }

  targets(): typeof EXIT_TARGETS { return EXIT_TARGETS; }
}

/** Runs a simple L0 native golden task and records it. Fixture defaults to a fresh temp dir. */
export async function runDeterministicGolden(store: EvaluationStore, golden: GoldenTask, fixture?: string): Promise<EvaluationRecord> {
  const started = Date.now();
  try {
    const intent = compileIntent(golden.prompt);
    if (intent.estimatedComplexity !== "L0" || !intent.steps[0].operation) {
      return recordFor(golden, "NOT_RUN", started);
    }
    const ownsFixture = fixture === undefined;
    const root = fixture ?? fs.mkdtempSync(path.join(os.tmpdir(), `boss-golden-${golden.id}-`));
    try {
      const evidence = await executeNative(root, intent.steps[0].operation);
      const passed = evidence.output.includes(golden.expectedContains);
      return recordFor(golden, passed ? "PASS" : "FAIL", started);
    } finally {
      if (ownsFixture) removeTree(root);
    }
  } catch (error) {
    // A harness that could not run is not a golden that failed. Both are FAIL, but
    // the reason travels with the record so the baseline is not measured against a
    // broken measurement.
    return recordFor(golden, "FAIL", started, `harness error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordFor(golden: GoldenTask, status: EvaluationRecord["status"], started: number, failureReason?: string): EvaluationRecord {
  return {
    goldenId: golden.id, complexity: golden.complexity, status, modelCalls: 0, estimatedTokens: 0, workerCalls: 0, retries: 0,
    latencyMs: Date.now() - started, humanIntervention: false, sideEffects: false, completedAt: new Date().toISOString(),
    ...(failureReason ? { failureReason } : {})
  };
}
