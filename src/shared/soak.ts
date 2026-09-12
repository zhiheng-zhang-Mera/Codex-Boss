/**
 * Update-Plan/checkpoint-1.md §53 — the soak test.
 *
 * Before Bootstrap Completion the plan requires consecutive full rounds:
 * fresh clone → bootstrap → task → repair → PR → CI → completion (20–50 suggested),
 * with some rounds covering theme create/activate/delete/restart, and six metrics
 * that must all stay at zero: Owner decisions, blind waits, false COMPLETED, state
 * loss, unrecovered crashes and theme-induced startup failures.
 *
 * The rules that keep a soak meaningful: a round counts only when **every** stage
 * passed with evidence, the six metrics are counters that may never be incremented,
 * and a failure that repeats identically across rounds stops the soak early — running
 * the same broken path twenty times is not a soak, it is a slow way to learn nothing.
 *
 * Pure: no fs, no network, no clock.
 */
import { contentHashOf } from "./workbook";
import { BENCHMARK_SCENARIOS, type BenchmarkScenario } from "./final-acceptance";

export const SOAK_VERSION = "soak-1" as const;

/** §53's round, in the plan's order. */
export const SOAK_STAGES = ["FRESH_CLONE", "BOOTSTRAP", "TASK", "REPAIR", "PR", "CI", "COMPLETION"] as const;
export type SoakStage = (typeof SOAK_STAGES)[number];

/** §53's six metrics; every one of them must remain zero. */
export const SOAK_METRICS = [
  "OWNER_DECISIONS",
  "BLIND_WAITS",
  "FALSE_COMPLETED",
  "STATE_LOSS",
  "UNRECOVERED_CRASH",
  "THEME_STARTUP_FAILURE"
] as const;
export type SoakMetric = (typeof SOAK_METRICS)[number];

export interface SoakStageResult {
  stage: SoakStage;
  ok: boolean;
  detail: string;
  /** Evidence pointers, so a "pass" can be re-checked. */
  evidence: string[];
}

export interface SoakRound {
  round: number;
  stages: SoakStageResult[];
  /** §53: theme rounds exercise create/activate/delete/restart. */
  theme: boolean;
  metrics: Partial<Record<SoakMetric, number>>;
  verdict: "CLEAN" | "FAILED";
  /** Stable signature of this round's failure, when it failed. */
  failure_signature?: string;
  started_at?: string;
}

export interface SoakOptions {
  /** Rounds required before the soak may pass (§53 suggests 20–50; the gate uses fewer). */
  minRounds: number;
  /** How many rounds must exercise the theme lane. */
  minThemeRounds: number;
  /** A failure signature seen this many times stops the soak. */
  repeatFailureLimit: number;
}

export const DEFAULT_SOAK_OPTIONS: SoakOptions = { minRounds: 3, minThemeRounds: 1, repeatFailureLimit: 2 };

export interface SoakVerdict {
  complete: boolean;
  rounds_run: number;
  clean_rounds: number;
  theme_rounds: number;
  /** Rounds in which a metric was incremented — a soak that moves a metric has failed. */
  metric_breaches: { metric: SoakMetric; total: number }[];
  stopped_early?: { reason: string; signature: string };
  missing_stages: SoakStage[];
  reasons: string[];
}

/**
 * §53 evaluated.
 *
 * A round is clean only when every stage reports ok with at least one evidence
 * pointer; the soak is complete only when enough clean rounds (including the theme
 * ones) have run, no metric moved, and no failure repeated.
 */
export function evaluateSoak(rounds: readonly SoakRound[], options: SoakOptions = DEFAULT_SOAK_OPTIONS): SoakVerdict {
  const reasons: string[] = [];
  const clean = rounds.filter((round) => round.verdict === "CLEAN" && round.stages.every((stage) => stage.ok && stage.evidence.length > 0));
  const themeRounds = clean.filter((round) => round.theme).length;

  const metricTotals = new Map<SoakMetric, number>();
  for (const round of rounds) {
    for (const metric of SOAK_METRICS) {
      const value = round.metrics[metric] ?? 0;
      if (value > 0) metricTotals.set(metric, (metricTotals.get(metric) ?? 0) + value);
    }
  }
  const breaches = [...metricTotals.entries()].map(([metric, total]) => ({ metric, total })).sort((left, right) => right.total - left.total);
  for (const breach of breaches) reasons.push(`§53: ${breach.metric} was incremented ${breach.total} time(s); every metric must stay at zero`);

  const counting = new Map<string, number>();
  let stoppedEarly: SoakVerdict["stopped_early"];
  for (const round of rounds) {
    if (!round.failure_signature) continue;
    const count = (counting.get(round.failure_signature) ?? 0) + 1;
    counting.set(round.failure_signature, count);
    if (count >= options.repeatFailureLimit) {
      stoppedEarly = { reason: `the same failure appeared ${count} time(s); repeating a known-broken path is not a soak`, signature: round.failure_signature };
      break;
    }
  }
  if (stoppedEarly) reasons.push(`§53: ${stoppedEarly.reason}`);

  const missingStages = SOAK_STAGES.filter((stage) => rounds.length > 0 && !rounds.some((round) => round.stages.some((entry) => entry.stage === stage)));
  for (const stage of missingStages) reasons.push(`§53: no round exercised ${stage}`);

  if (clean.length < options.minRounds) reasons.push(`§53: ${clean.length} clean round(s) against the required ${options.minRounds}`);
  if (themeRounds < options.minThemeRounds) reasons.push(`§53: ${themeRounds} theme round(s) against the required ${options.minThemeRounds}`);

  const complete = reasons.length === 0;
  return {
    complete,
    rounds_run: rounds.length,
    clean_rounds: clean.length,
    theme_rounds: themeRounds,
    metric_breaches: breaches,
    ...(stoppedEarly ? { stopped_early: stoppedEarly } : {}),
    missing_stages: missingStages,
    reasons: complete
      ? [`§53: ${clean.length} clean rounds (${themeRounds} with themes) with every stage evidenced and every metric at zero`]
      : reasons
  };
}

/** §53: the round's failure signature, so a repeat is recognisable across rounds. */
export function failureSignatureOf(failed: readonly SoakStageResult[]): string | undefined {
  if (!failed.length) return undefined;
  return contentHashOf(failed.map((stage) => `${stage.stage}:${stage.detail}`).join("\u0000"));
}

export interface BenchmarkPlanEntry extends BenchmarkScenario {
  order: number;
  /** The theme rounds §51's B16–B18 correspond to. */
  theme: boolean;
}

/** §51: the one-shot order the benchmark runner walks, derived from the catalogue. */
export function benchmarkPlan(): BenchmarkPlanEntry[] {
  return BENCHMARK_SCENARIOS.map((scenario, index) => ({ ...scenario, order: index + 1, theme: /theme/i.test(scenario.title) }));
}
