/** Evaluation suite contracts (plan §8 / §12). Pure and renderer-shareable. */

export type GoldenComplexity = "simple" | "medium" | "complex";
export const GOLDEN_COMPLEXITIES: readonly GoldenComplexity[] = ["simple", "medium", "complex"];

export interface GoldenTask {
  id: string;
  name: string;
  complexity: GoldenComplexity;
  prompt: string;
  /** Pass when the final output contains this literal (exact string, deterministic). */
  expectedContains: string;
}

/** Per-task evaluation result (plan §12 unified metrics, deterministically observable subset). */
export interface EvaluationRecord {
  goldenId: string;
  complexity: GoldenComplexity;
  taskId?: string;
  status: "PASS" | "FAIL" | "NOT_RUN";
  modelCalls: number;
  estimatedTokens: number;
  workerCalls: number;
  retries: number;
  latencyMs: number;
  humanIntervention: boolean;
  sideEffects: boolean;
  completedAt: string;
}

export interface BaselineTotals {
  pass: number;
  run: number;
}

export interface BaselineSummary {
  complexity: GoldenComplexity;
  pass: number;
  run: number;
  rate: number | null;
  meetsExitTarget: boolean;
}

export const EXIT_TARGETS: Record<GoldenComplexity, number> = { simple: 0.95, medium: 0.85, complex: 0.7 };

export function summarizeBaseline(records: Pick<EvaluationRecord, "complexity" | "status">[]): BaselineSummary[] {
  return GOLDEN_COMPLEXITIES.map((complexity) => {
    const group = records.filter((record) => record.complexity === complexity && record.status === "PASS");
    const run = records.filter((record) => record.complexity === complexity && record.status !== "NOT_RUN").length;
    const pass = group.length;
    return { complexity, pass, run, rate: run > 0 ? pass / run : null, meetsExitTarget: run > 0 ? pass / run >= EXIT_TARGETS[complexity] : false };
  });
}
