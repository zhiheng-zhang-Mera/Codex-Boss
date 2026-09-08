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

/* ---------------------------------- human-ready blind evaluation (Overcomplete §10.4) */

export type EvaluationProducer = "boss" | "single-ai";

/** One produced answer that participates in the blind pack. */
export interface BlindEvaluationItemInput {
  recordId: string;
  producer: EvaluationProducer;
  goldenId: string;
  complexity: GoldenComplexity;
  prompt: string;
  output: string;
}

export interface BlindItem {
  /** Anonymized item id shown to judges (never the record id). */
  itemId: string;
  complexity: GoldenComplexity;
  prompt: string;
  output: string;
}

export interface BlindEvaluationPack {
  packId: string;
  createdAt: string;
  /** Judge-facing payload (anonymized, randomized order). */
  items: BlindItem[];
  rubric: string[];
  reviewerForm: Array<{ itemId: string; metrics: Array<"task_completion" | "evidence_quality" | "consistency" | "hallucination" | "writing_quality" | "coding_quality">; notes: string }>;
  /** Secret decode map — never shipped to judges. */
  decodingKey: Record<string, { recordId: string; producer: EvaluationProducer; goldenId: string }>;
  /** Deterministic seed used for the order permutation. */
  seed: number;
}

/** Deterministic seeded shuffle (mulberry32-style) so packs are reproducible. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const PACK_METRICS = ["task_completion", "evidence_quality", "consistency", "hallucination", "writing_quality", "coding_quality"] as const;

/**
 * Builds a human-ready blind evaluation pack (§10.4): anonymized outputs,
 * seeded random ordering, scoring rubric, reviewer form and a secret decoding
 * key, so a later human-blind session can score Boss vs single-AI without
 * seeing the producer. Deterministic for a given seed.
 */
export function buildBlindEvaluationPack(input: { items: BlindEvaluationItemInput[]; seed?: number; createdAt?: string }): BlindEvaluationPack {
  const seed = input.seed ?? 20260908;
  const shuffled = seededShuffle([...input.items], seed);
  const packId = `pack-${seed.toString(36)}-${shuffled.length}`;
  const items: BlindItem[] = [];
  const decodingKey: BlindEvaluationPack["decodingKey"] = {};
  const reviewerForm: BlindEvaluationPack["reviewerForm"] = [];
  shuffled.forEach((record, index) => {
    const itemId = `${packId}-i${index + 1}`;
    items.push({ itemId, complexity: record.complexity, prompt: record.prompt, output: record.output });
    decodingKey[itemId] = { recordId: record.recordId, producer: record.producer, goldenId: record.goldenId };
    reviewerForm.push({ itemId, metrics: [...PACK_METRICS], notes: "" });
  });
  return {
    packId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    items,
    rubric: [
      "task_completion: did the answer satisfy the prompt's concrete request? (0–5)",
      "evidence_quality: did the answer ground claims in real, checkable evidence? (0–5)",
      "consistency: is the answer internally consistent and reproducible-sounding? (0–5)",
      "hallucination: rate apparent fabrication (0 = fabricated a lot … 5 = none visible)",
      "writing_quality: clarity and structure (0–5)",
      "coding_quality: correctness of any code produced (0–5)"
    ],
    reviewerForm,
    decodingKey,
    seed
  };
}

/** Aggregates judge scores by producer after decoding (deterministic average). */
export function summarizeBlindScores(
  scores: Array<{ itemId: string; metric: string; score: number }>,
  decodingKey: BlindEvaluationPack["decodingKey"]
): Record<EvaluationProducer, { average: number; count: number }> {
  const totals: Record<EvaluationProducer, { sum: number; count: number }> = { boss: { sum: 0, count: 0 }, "single-ai": { sum: 0, count: 0 } };
  for (const entry of scores) {
    const decoded = decodingKey[entry.itemId];
    if (!decoded) continue;
    totals[decoded.producer].sum += entry.score;
    totals[decoded.producer].count += 1;
  }
  const summary: Record<EvaluationProducer, { average: number; count: number }> = { boss: { average: 0, count: 0 }, "single-ai": { average: 0, count: 0 } };
  for (const producer of ["boss", "single-ai"] as const) {
    summary[producer] = { average: totals[producer].count > 0 ? totals[producer].sum / totals[producer].count : 0, count: totals[producer].count };
  }
  return summary;
}
