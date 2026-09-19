/**
 * Runtime Intelligence Plane — the model capability ledger.
 *
 * The ledger exists so a model is never treated as "no history, therefore no ability".
 * A model first seen today is seeded from a family prior, a provider prior and whatever
 * capability it declares, with the prior carried as PSEUDO-SAMPLES: a dimension starts at
 * the prior's score and the prior is spent down as real outcomes arrive.
 *
 * The two failure modes the plan names are both structural here, not policy:
 *
 *   - a new model cannot be suppressed to zero, because `warmStartScores` never produces
 *     a zero estimate and a prior-only estimate carries `confidence: 0` rather than a
 *     confident low score;
 *   - an established model cannot gain an irreversible advantage, because the prior share
 *     decays as `priorWeight0 / (priorWeight0 + samples)` and every update is a weighted
 *     mean over a growing denominator, so no single outcome can move a well-sampled
 *     estimate far — and none of them is destructive, because a later outcome pulls the
 *     mean back.
 *
 * An anomalous outcome (a failure class never seen before on a model that already has
 * samples, or a latency several times the running mean) is folded in with
 * `ANOMALY_DOWNWEIGHT` instead of weight 1. It is recorded, not discarded: "we saw this
 * and it counted for little" is a different fact from "we did not see this", and only the
 * first one is true.
 *
 * Every function here is pure. The caller owns the clock (`at`) and the durable store.
 */

import {
  MODEL_CAPABILITY_DIMENSIONS,
  MODEL_HISTORY_LIMIT,
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  modelKeyOf,
  type CapabilityEstimate,
  type ModelCapabilityDimension,
  type ModelCapabilityRecord,
  type ModelCapabilityScores,
  type ModelOutcomeRecord,
  type TaskKind,
  type WarmStartSource
} from "./contracts";

/** Pseudo-samples one injected prior is worth. Six outcomes halve the prior's influence. */
export const DEFAULT_PRIOR_STRENGTH = 6;

/** Confidence is `samples / (samples + CONFIDENCE_K)`, so zero samples means zero confidence. */
export const CONFIDENCE_K = 5;
export const CONFIDENCE_CAP = 0.95;

/** Weight given to an outcome that looks anomalous, instead of 1. */
export const ANOMALY_DOWNWEIGHT = 0.25;

/** A latency this many times the running mean is treated as anomalous. */
export const ANOMALY_LATENCY_MULTIPLE = 5;

/** A failure class seen fewer than this many times on an already-sampled model is anomalous. */
export const ANOMALY_FAILURE_CLASS_FLOOR = 2;

/** How much a declared capability nudges its dimension. Deliberately small: it is a claim, not evidence. */
export const DECLARED_CAPABILITY_NUDGE = 0.05;

export type CapabilityPriorTable = Readonly<Record<string, Partial<Record<ModelCapabilityDimension, number>>>>;

/**
 * Conservative, clearly-unmeasured family priors.
 *
 * These are STARTING POINTS, not measurements: every value stays inside 0.45–0.60 so a
 * warm start can never look like a strong claim, and the ledger records
 * `FAMILY_PRIOR`/`PROVIDER_PRIOR` in `warmStartSources` so the estimate's provenance is
 * auditable. An unknown family gets `DEFAULT_CAPABILITY_PRIOR`. Replacing this table with
 * measured values is a data change, not a code change.
 */
export const DEFAULT_FAMILY_PRIORS: CapabilityPriorTable = {
  gpt: { coding: 0.55, reasoning: 0.55, tool_use: 0.55, long_context: 0.55 },
  claude: { coding: 0.55, reasoning: 0.55, review: 0.55, long_context: 0.55 },
  gemini: { reasoning: 0.55, research: 0.55, long_context: 0.55 },
  deepseek: { coding: 0.55, reasoning: 0.55 },
  qwen: { coding: 0.5, reasoning: 0.5, long_context: 0.5 },
  kimi: { long_context: 0.55, research: 0.5 },
  grok: { reasoning: 0.5, research: 0.5 }
};

/** The prior every dimension starts at when no family or provider prior names it. */
export const DEFAULT_CAPABILITY_PRIOR = 0.5;

/** Which dimensions a task of this kind actually exercises. An unexercised dimension is not updated. */
export const TASK_KIND_DIMENSIONS: Readonly<Record<TaskKind, readonly ModelCapabilityDimension[]>> = {
  coding: ["coding", "reasoning", "planning", "tool_use", "reliability", "stability"],
  reasoning: ["reasoning", "reliability", "stability"],
  planning: ["planning", "reasoning", "reliability", "stability"],
  review: ["review", "reasoning", "reliability", "stability"],
  research: ["research", "long_context", "tool_use", "reliability", "stability"],
  synthesis: ["reasoning", "long_context", "reliability", "stability"],
  computer_use: ["computer_use", "tool_use", "reliability", "stability"],
  other: ["reliability", "stability"]
};

export interface WarmStartInput {
  provider: string;
  family: string;
  version?: string;
  declaredCapabilities?: readonly string[];
  priorTable?: CapabilityPriorTable;
  /** Pseudo-samples the prior is worth. Defaults to `DEFAULT_PRIOR_STRENGTH`. */
  priorStrength?: number;
  at: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Sample-count confidence, matching the repository's existing convention. Zero samples ⇒ zero. */
export function confidenceFor(samples: number, k: number = CONFIDENCE_K, cap: number = CONFIDENCE_CAP): number {
  if (!Number.isFinite(samples) || samples <= 0) return 0;
  return Math.min(cap, samples / (samples + k));
}

/** The share of an estimate still carried by its prior. 1 means "prior only, no evidence". */
export function priorShare(estimate: CapabilityEstimate): number {
  const total = estimate.priorWeight + estimate.observedWeight;
  if (total <= 0) return 0;
  return estimate.priorWeight / total;
}

/** The observed mean alone, or `undefined` when nothing was observed. */
export function observedMean(estimate: CapabilityEstimate): number | undefined {
  if (estimate.observedWeight <= 0) return undefined;
  return estimate.observedWeightedValue / estimate.observedWeight;
}

/**
 * Seeds the twelve dimensions for a model that has no history.
 *
 * `source` records which heuristic produced each seed. A dimension seeded from the global
 * default rather than a family prior says so, because "we have no information about this
 * family" and "this family is known to be weak here" must not look the same.
 */
export function warmStartScores(input: WarmStartInput): { scores: ModelCapabilityScores; sources: WarmStartSource[] } {
  const priorStrength = input.priorStrength ?? DEFAULT_PRIOR_STRENGTH;
  const table = input.priorTable ?? DEFAULT_FAMILY_PRIORS;
  const familyKey = (input.family ?? "").trim().toLowerCase();
  const providerKey = (input.provider ?? "").trim().toLowerCase();
  const familyPrior = table[familyKey] ?? {};
  const providerPrior = table[providerKey] ?? {};
  const declared = new Set((input.declaredCapabilities ?? []).map((token) => token.trim().toLowerCase()));
  const sources = new Set<WarmStartSource>();
  const scores = {} as ModelCapabilityScores;

  for (const dimension of MODEL_CAPABILITY_DIMENSIONS) {
    let score = DEFAULT_CAPABILITY_PRIOR;
    let source: WarmStartSource = "GLOBAL_PRIOR";
    const fromProvider = providerPrior[dimension];
    const fromFamily = familyPrior[dimension];
    if (typeof fromFamily === "number") {
      score = clamp01(fromFamily);
      source = "FAMILY_PRIOR";
    } else if (typeof fromProvider === "number") {
      score = clamp01(fromProvider);
      source = "PROVIDER_PRIOR";
    }
    if (declared.has(dimension)) {
      score = clamp01(score + DECLARED_CAPABILITY_NUDGE);
      if (source === "GLOBAL_PRIOR") source = "DECLARED_CAPABILITY";
      sources.add("DECLARED_CAPABILITY");
    }
    sources.add(source);
    scores[dimension] = {
      score,
      priorScore: score,
      confidence: 0,
      samples: 0,
      priorWeight: priorStrength,
      observedWeight: 0,
      observedWeightedValue: 0,
      updatedAt: input.at
    };
  }
  return { scores, sources: [...sources] };
}

export interface CreateModelRecordInput extends WarmStartInput {
  declaredCapabilities?: readonly string[];
}

/** A new ledger record: warm-started, marked `warmStarted`, with no outcomes yet. */
export function createModelRecord(input: CreateModelRecordInput): ModelCapabilityRecord {
  const { scores, sources } = warmStartScores(input);
  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    modelKey: modelKeyOf(input),
    provider: input.provider,
    family: input.family,
    version: (input.version ?? "").trim() || "unknown",
    firstSeen: input.at,
    lastSeen: input.at,
    declaredCapabilities: [...(input.declaredCapabilities ?? [])],
    warmStartSources: sources,
    warmStarted: true,
    scores,
    taskTypePerformance: {},
    failureClasses: {},
    latency: { samples: 0, meanMs: 0, maxMs: 0 },
    cost: { samples: 0, meanUsd: 0, totalUsd: 0 },
    reviewAgreement: { samples: 0, agreements: 0 },
    history: []
  };
}

export type OutcomeAttribution = "RUNTIME" | "SEMANTIC" | "UNKNOWN";

export interface ModelOutcomeInput {
  observationId: string;
  taskId: string;
  nodeId: string;
  role: string;
  taskKind: TaskKind;
  success: boolean;
  /** Measured quality 0..1, when a reviewer produced one. Absent means "not reviewed". */
  quality?: number;
  failureClass?: string;
  /** Whether the failure was the runtime's fault. Semantic refusals do not update stability. */
  attribution?: OutcomeAttribution;
  latencyMs?: number;
  /** The latency this task would have been happy with. Absent falls back to the running mean. */
  expectedLatencyMs?: number;
  costUsd?: number;
  expectedCostUsd?: number;
  reviewerAgreed?: boolean;
  contextScale?: "small" | "medium" | "large";
  at: string;
}

export interface ModelOutcomeApplication {
  record: ModelCapabilityRecord;
  /** Dimensions this outcome actually moved. An unexercised dimension is absent, not zero. */
  updated: ModelCapabilityDimension[];
  /** Dimensions this outcome could not move, each with the reason. */
  skipped: Array<{ dimension: ModelCapabilityDimension; reason: string }>;
  /** The weight actually applied. */
  weight: number;
  anomaly: boolean;
  reasons: string[];
}

/**
 * Folds one outcome into a record and returns a NEW record.
 *
 * The step for a dimension is a weighted mean:
 *
 *     score' = priorWeight / (priorWeight + observedWeight + w) * score
 *            + (observedWeightedValue + w * observed) / (priorWeight + observedWeight + w)
 *
 * and `priorWeight` itself decays as `priorWeight0^2 / (priorWeight0 + samples)`, so the
 * prior's share strictly decreases with evidence while never being able to jump.
 */
export function applyModelOutcome(record: ModelCapabilityRecord, input: ModelOutcomeInput): ModelOutcomeApplication {
  const reasons: string[] = [];
  const updated: ModelCapabilityDimension[] = [];
  const skipped: Array<{ dimension: ModelCapabilityDimension; reason: string }> = [];

  const failureSeenBefore = input.failureClass === undefined ? 0 : record.failureClasses[input.failureClass] ?? 0;
  const established = record.history.length >= ANOMALY_FAILURE_CLASS_FLOOR;
  const rareFailure = !input.success && input.failureClass !== undefined && failureSeenBefore < ANOMALY_FAILURE_CLASS_FLOOR;
  const latencyAnomaly =
    input.latencyMs !== undefined && record.latency.samples >= ANOMALY_FAILURE_CLASS_FLOOR && record.latency.meanMs > 0 && input.latencyMs > record.latency.meanMs * ANOMALY_LATENCY_MULTIPLE;
  const anomaly = established && (rareFailure || latencyAnomaly);
  const weight = anomaly ? ANOMALY_DOWNWEIGHT : 1;
  if (rareFailure) reasons.push(`failure class ${input.failureClass} had been seen ${failureSeenBefore} time(s); folded in with weight ${ANOMALY_DOWNWEIGHT} instead of discarding it`);
  if (latencyAnomaly) reasons.push(`latency ${input.latencyMs}ms is over ${ANOMALY_LATENCY_MULTIPLE}x the running mean ${Math.round(record.latency.meanMs)}ms; folded in with weight ${ANOMALY_DOWNWEIGHT}`);
  if (!anomaly) reasons.push(`folded in with weight ${weight}`);

  const qualityValue = clamp01(input.quality ?? (input.success ? 1 : 0));
  const attribution: OutcomeAttribution = input.attribution ?? "UNKNOWN";
  const expectedLatency = input.expectedLatencyMs ?? (record.latency.samples > 0 ? record.latency.meanMs : undefined);
  const expectedCost = input.expectedCostUsd ?? (record.cost.samples > 0 ? record.cost.meanUsd : undefined);

  const observations = new Map<ModelCapabilityDimension, { value: number; reason: string }>();
  const exercised = new Set<ModelCapabilityDimension>(TASK_KIND_DIMENSIONS[input.taskKind] ?? TASK_KIND_DIMENSIONS.other);
  if (input.contextScale === "large") exercised.add("long_context");

  for (const dimension of exercised) {
    if (dimension === "stability") {
      if (attribution === "SEMANTIC") {
        skipped.push({ dimension, reason: "a semantic refusal is not evidence of instability" });
        continue;
      }
      observations.set(dimension, { value: input.success ? 1 : 0, reason: `stability observed from a ${attribution.toLowerCase()}-attributed ${input.success ? "success" : "failure"}` });
      continue;
    }
    if (dimension === "reliability") {
      observations.set(dimension, { value: input.success ? 1 : 0, reason: "reliability observed on every outcome" });
      continue;
    }
    observations.set(dimension, { value: qualityValue, reason: `quality signal ${qualityValue.toFixed(2)} from ${input.success ? "a success" : "a failure"}` });
  }

  if (input.latencyMs !== undefined) {
    if (expectedLatency === undefined || expectedLatency <= 0) {
      skipped.push({ dimension: "latency", reason: "no expected latency and no running mean to compare against" });
    } else {
      observations.set("latency", { value: clamp01(1 - input.latencyMs / (expectedLatency * 2)), reason: `${input.latencyMs}ms against an expected ${Math.round(expectedLatency)}ms` });
    }
  } else {
    skipped.push({ dimension: "latency", reason: "no latency was measured" });
  }

  if (input.costUsd !== undefined) {
    if (expectedCost === undefined || expectedCost <= 0) {
      skipped.push({ dimension: "cost", reason: "no expected cost and no running mean to compare against" });
    } else {
      observations.set("cost", { value: clamp01(1 - input.costUsd / (expectedCost * 2)), reason: `$${input.costUsd.toFixed(4)} against an expected $${expectedCost.toFixed(4)}` });
    }
  } else {
    skipped.push({ dimension: "cost", reason: "no cost was measured" });
  }

  const scores = { ...record.scores } as ModelCapabilityScores;
  for (const dimension of MODEL_CAPABILITY_DIMENSIONS) {
    const observation = observations.get(dimension);
    if (!observation) {
      if (!skipped.some((entry) => entry.dimension === dimension)) {
        skipped.push({ dimension, reason: `${input.taskKind} tasks do not exercise ${dimension}` });
      }
      continue;
    }
    const priorWeight0 = DEFAULT_PRIOR_STRENGTH;
    const current = record.scores[dimension];
    const samples = current.samples + 1;
    const decayedPrior = (priorWeight0 * priorWeight0) / (priorWeight0 + samples);
    const observedWeight = current.observedWeight + weight;
    const observedWeightedValue = current.observedWeightedValue + weight * observation.value;
    const denominator = decayedPrior + observedWeight;
    const score = clamp01((decayedPrior * current.score + observedWeightedValue) / denominator);
    scores[dimension] = {
      score,
      // The prior's own value never changes; only its weight does.
      priorScore: current.priorScore,
      confidence: confidenceFor(samples),
      samples,
      priorWeight: decayedPrior,
      observedWeight,
      observedWeightedValue,
      updatedAt: input.at
    };
    updated.push(dimension);
  }

  const previous = record.taskTypePerformance[input.taskKind] ?? { attempts: 0, successes: 0, failures: 0 };
  const failureClasses = { ...record.failureClasses };
  if (!input.success && input.failureClass !== undefined) failureClasses[input.failureClass] = (failureClasses[input.failureClass] ?? 0) + 1;

  const latencySamples = record.latency.samples + (input.latencyMs === undefined ? 0 : 1);
  const latencySum = record.latency.meanMs * record.latency.samples + (input.latencyMs ?? 0);
  const costSamples = record.cost.samples + (input.costUsd === undefined ? 0 : 1);
  const costSum = record.cost.totalUsd + (input.costUsd ?? 0);

  const historyEntry: ModelOutcomeRecord = {
    observationId: input.observationId,
    taskId: input.taskId,
    modelKey: record.modelKey,
    nodeId: input.nodeId,
    role: input.role,
    taskKind: input.taskKind,
    success: input.success,
    ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass }),
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd }),
    ...(input.reviewerAgreed === undefined ? {} : { reviewerAgreed: input.reviewerAgreed }),
    weight,
    at: input.at
  };

  const next: ModelCapabilityRecord = {
    ...record,
    lastSeen: input.at,
    warmStarted: MODEL_CAPABILITY_DIMENSIONS.some((dimension) => priorShare(scores[dimension]) >= 0.5),
    scores,
    taskTypePerformance: { ...record.taskTypePerformance, [input.taskKind]: { attempts: previous.attempts + 1, successes: previous.successes + (input.success ? 1 : 0), failures: previous.failures + (input.success ? 0 : 1) } },
    failureClasses,
    latency: { samples: latencySamples, meanMs: latencySamples > 0 ? latencySum / latencySamples : 0, maxMs: Math.max(record.latency.maxMs, input.latencyMs ?? 0) },
    cost: { samples: costSamples, meanUsd: costSamples > 0 ? costSum / costSamples : 0, totalUsd: costSum },
    reviewAgreement: {
      samples: record.reviewAgreement.samples + (input.reviewerAgreed === undefined ? 0 : 1),
      agreements: record.reviewAgreement.agreements + (input.reviewerAgreed === true ? 1 : 0)
    },
    history: [...record.history, historyEntry].slice(-MODEL_HISTORY_LIMIT)
  };

  return { record: next, updated, skipped, weight, anomaly, reasons };
}

/** One dimension's estimate, or `undefined` for a dimension the record does not carry. */
export function capabilityEstimate(record: ModelCapabilityRecord, dimension: ModelCapabilityDimension): CapabilityEstimate | undefined {
  return record.scores[dimension];
}

/**
 * A model's score for a dimension IF the estimate is worth acting on.
 *
 * An estimate whose prior still dominates reports `usable: false` and why, so a consumer
 * can distinguish "no evidence" from "evidence of a low score" instead of reading a
 * warm-started 0.5 as a measured 0.5.
 */
export function usableCapability(input: {
  record: ModelCapabilityRecord;
  dimension: ModelCapabilityDimension;
  minConfidence?: number;
}): { usable: boolean; score: number; confidence: number; priorShare: number; reason: string } {
  const estimate = input.record.scores[input.dimension];
  const minConfidence = input.minConfidence ?? 0.2;
  const share = priorShare(estimate);
  if (estimate.samples === 0) {
    return { usable: false, score: estimate.score, confidence: estimate.confidence, priorShare: share, reason: `${input.record.modelKey} has no ${input.dimension} evidence; the estimate is the injected prior` };
  }
  if (estimate.confidence < minConfidence) {
    return { usable: false, score: estimate.score, confidence: estimate.confidence, priorShare: share, reason: `${estimate.samples} sample(s) give confidence ${estimate.confidence.toFixed(2)}, below the required ${minConfidence}` };
  }
  return { usable: true, score: estimate.score, confidence: estimate.confidence, priorShare: share, reason: `${estimate.samples} sample(s), confidence ${estimate.confidence.toFixed(2)}, prior share ${share.toFixed(2)}` };
}

/** Sample-weighted agreement rate with the reviewer, or `undefined` when never reviewed. */
export function reviewAgreementRate(record: ModelCapabilityRecord): number | undefined {
  if (record.reviewAgreement.samples === 0) return undefined;
  return record.reviewAgreement.agreements / record.reviewAgreement.samples;
}

/** The failure class seen most often, or `undefined` when the model has never failed. */
export function dominantFailureClass(record: ModelCapabilityRecord): { failureClass: string; count: number } | undefined {
  const entries = Object.entries(record.failureClasses);
  if (entries.length === 0) return undefined;
  const [failureClass, count] = entries.sort((left, right) => (right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]))[0];
  return { failureClass, count };
}
