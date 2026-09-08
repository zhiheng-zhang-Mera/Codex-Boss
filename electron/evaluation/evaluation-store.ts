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

export interface EvaluationFile {
  schemaVersion: 1;
  goldens: GoldenTask[];
  records: EvaluationRecord[];
}

export class EvaluationStore {
  constructor(private readonly file: string) {}

  load(): EvaluationFile {
    const value = readJson<Partial<EvaluationFile>>(this.file);
    if (!value) return { schemaVersion: 1, goldens: [], records: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.goldens) || !Array.isArray(value.records)) throw new Error("Invalid evaluation store");
    return { schemaVersion: 1, goldens: value.goldens, records: value.records };
  }

  record(entry: EvaluationRecord): void {
    const file = this.load();
    // Latest run per golden id: keeps the baseline deterministic and bounded.
    file.records = [...file.records.filter((item) => item.goldenId !== entry.goldenId), entry];
    writeJson(this.file, file);
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
  } catch {
    return recordFor(golden, "FAIL", started);
  }
}

function recordFor(golden: GoldenTask, status: EvaluationRecord["status"], started: number): EvaluationRecord {
  return {
    goldenId: golden.id, complexity: golden.complexity, status, modelCalls: 0, estimatedTokens: 0, workerCalls: 0, retries: 0,
    latencyMs: Date.now() - started, humanIntervention: false, sideEffects: false, completedAt: new Date().toISOString()
  };
}
