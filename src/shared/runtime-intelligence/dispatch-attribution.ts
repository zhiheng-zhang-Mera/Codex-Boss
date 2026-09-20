/**
 * Runtime Intelligence Plane — per-step dispatch attribution.
 *
 * The scheduler replay needed to know which provider a STEP used, and the first version could
 * only answer "the task's first run provider" for every step of that task. That is an
 * approximation, and reporting 31 task-level attributions as 31 dispatch decisions would have
 * made the scheduler benchmark look like it had evidence it did not have.
 *
 * The real data does carry a per-step mapping: each task-ledger checkpoint records its worker
 * `sessions[]`, and each session names the `provider` runtime it belongs to (`web:chatgpt`,
 * `web:gemini`, …). A step whose checkpoint lists sessions is therefore a step whose providers
 * are known directly, and a step with several sessions dispatched to several providers — which
 * is one attribution PER PROVIDER, not an ambiguity to average away.
 *
 * Every attribution carries the source it came from and a confidence, and the sources are
 * ordered from direct evidence to a stated fallback. `TASK_FALLBACK` exists because a corpus
 * may simply not have the session data, and its confidence is low on purpose: a caller that
 * mixes it into a headline metric is choosing to, and can see that it is.
 */

export const ATTRIBUTION_SOURCES = ["DIRECT_CHECKPOINT", "RUN_MATCH", "SESSION_MATCH", "TASK_FALLBACK", "UNKNOWN"] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** How much an attribution source is worth, so a report never has to rank strings. */
export const ATTRIBUTION_CONFIDENCE: Readonly<Record<AttributionSource, number>> = {
  // The checkpoint named the provider for this step.
  DIRECT_CHECKPOINT: 1,
  // A run's own interval covers this step.
  RUN_MATCH: 0.8,
  // A worker session matched by identity rather than by step.
  SESSION_MATCH: 0.6,
  // The task's provider, applied to every step of the task. Honest, and weak.
  TASK_FALLBACK: 0.2,
  UNKNOWN: 0
};

/** The sources a headline metric may use without further justification. */
export const DIRECT_ATTRIBUTION_SOURCES: readonly AttributionSource[] = ["DIRECT_CHECKPOINT", "RUN_MATCH"];

export interface StepDispatchAttribution {
  recordId: string;
  stepIndex: number;
  /** The provider runtime identity, e.g. `web:chatgpt`. Absent only for UNKNOWN. */
  provider?: string;
  /** The model identity, which a web transport does not expose. */
  model: string;
  runId?: string;
  workerSessionId?: string;
  attributionSource: AttributionSource;
  confidence: number;
}

export interface StepAttributionInput {
  recordId: string;
  stepIndex: number;
  /** Providers named by this step's own checkpoint sessions. The direct evidence. */
  sessionProviders: readonly string[];
  /** Providers of runs whose interval covers this step. */
  runProviders?: readonly string[];
  /** Providers of the task, used only when nothing more direct exists. */
  taskProviders?: readonly string[];
}

/**
 * Attributes one step, returning one entry per provider.
 *
 * The order is the argument: a checkpoint's own sessions outrank a run interval, which outranks
 * a task-level provider list, and an empty input returns a single UNKNOWN entry rather than an
 * empty array — a step whose provider nobody recorded is a fact worth reporting, not a step to
 * drop silently.
 */
export function attributeStep(input: StepAttributionInput): StepDispatchAttribution[] {
  const sessions = [...new Set(input.sessionProviders.filter((provider) => provider.trim() !== ""))].sort();
  const runs = [...new Set((input.runProviders ?? []).filter((provider) => provider.trim() !== ""))].sort();
  const tasks = [...new Set((input.taskProviders ?? []).filter((provider) => provider.trim() !== ""))].sort();

  const asEntries = (providers: readonly string[], source: AttributionSource): StepDispatchAttribution[] =>
    providers.map((provider) => ({
      recordId: input.recordId,
      stepIndex: input.stepIndex,
      provider,
      model: `${provider}:unknown`,
      attributionSource: source,
      confidence: ATTRIBUTION_CONFIDENCE[source]
    }));

  if (sessions.length > 0) return asEntries(sessions, "DIRECT_CHECKPOINT");
  if (runs.length > 0) return asEntries(runs, "RUN_MATCH");
  if (tasks.length > 0) return asEntries(tasks, "TASK_FALLBACK");
  return [{ recordId: input.recordId, stepIndex: input.stepIndex, model: "unknown:unknown", attributionSource: "UNKNOWN", confidence: 0 }];
}

export interface AttributionCensus {
  total: number;
  bySource: Record<AttributionSource, number>;
  /** Attributions a headline metric may rest on. */
  directCount: number;
  fallbackCount: number;
  unknownCount: number;
  providers: string[];
  notes: string[];
}

/** Counts attributions by source, so a benchmark can say what its sample actually is. */
export function censusAttributions(attributions: readonly StepDispatchAttribution[]): AttributionCensus {
  const bySource: Record<AttributionSource, number> = { DIRECT_CHECKPOINT: 0, RUN_MATCH: 0, SESSION_MATCH: 0, TASK_FALLBACK: 0, UNKNOWN: 0 };
  for (const attribution of attributions) bySource[attribution.attributionSource] += 1;

  const directCount = attributions.filter((attribution) => DIRECT_ATTRIBUTION_SOURCES.includes(attribution.attributionSource)).length;
  const fallbackCount = attributions.filter((attribution) => attribution.attributionSource === "TASK_FALLBACK").length;
  const unknownCount = bySource.UNKNOWN;
  const providers = [...new Set(attributions.map((attribution) => attribution.provider).filter((provider): provider is string => provider !== undefined))].sort();
  const notes: string[] = [];
  if (directCount === 0 && attributions.length > 0) notes.push("no attribution came from direct evidence, so a per-dispatch benchmark cannot be computed from this corpus");
  if (fallbackCount > 0) notes.push(`${fallbackCount} attribution(s) are TASK_FALLBACK: the task's provider applied to every step, which is an approximation and must not be reported as per-dispatch evidence`);
  if (unknownCount > 0) notes.push(`${unknownCount} step(s) recorded no provider at all`);

  return { total: attributions.length, bySource, directCount, fallbackCount, unknownCount, providers, notes };
}
