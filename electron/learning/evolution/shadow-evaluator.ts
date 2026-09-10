import type { AdaptivePolicy, EvaluationSummary } from "./policy-candidate";

/**
 * Engine Phase 10 — shadow evaluation (book §14, acceptance A44).
 *
 * A replay-passed candidate runs in SHADOW mode: it produces a hypothetical
 * choice for each live decision while the stable policy keeps control. Nothing
 * the candidate decides is ever executed. Promotion requires the shadow run to
 * show no divergence-induced harm and no performance regression.
 */

export interface ShadowObservation {
  decisionId: string;
  stableRuntimeId?: string;
  candidateRuntimeId?: string;
  /** Observed semantic completion of the runtime that actually ran (stable's pick). */
  observedCompletion?: number;
  /** Completion the candidate's pick was known to have (when it also ran, e.g. exploration). */
  candidateObservedCompletion?: number;
}

export interface ShadowOptions {
  minObservations?: number;
  maxDivergenceRate?: number;
  regressionTolerance?: number;
}

export interface ShadowOutcome extends EvaluationSummary {
  passed: boolean;
  divergences: number;
  divergenceRate: number;
}

export function evaluateShadow(policy: AdaptivePolicy, observations: ShadowObservation[], options: ShadowOptions = {}): ShadowOutcome {
  const minObservations = options.minObservations ?? 3;
  const maxDivergenceRate = options.maxDivergenceRate ?? 0.8;
  const regressionTolerance = options.regressionTolerance ?? 0.05;

  const usable = observations.filter((observation) => observation.stableRuntimeId !== undefined);
  const divergences = usable.filter((observation) => observation.candidateRuntimeId !== observation.stableRuntimeId).length;
  const divergenceRate = usable.length ? Number((divergences / usable.length).toFixed(4)) : 0;

  const compared = usable.filter((observation) => typeof observation.observedCompletion === "number" && typeof observation.candidateObservedCompletion === "number");
  const stableMean = compared.length ? Number((compared.reduce((sum, item) => sum + (item.observedCompletion ?? 0), 0) / compared.length).toFixed(4)) : 0;
  const candidateMean = compared.length ? Number((compared.reduce((sum, item) => sum + (item.candidateObservedCompletion ?? 0), 0) / compared.length).toFixed(4)) : 0;
  const delta = Number((candidateMean - stableMean).toFixed(4));
  const regressions = compared.filter((item) => (item.candidateObservedCompletion ?? 0) < (item.observedCompletion ?? 0) - regressionTolerance).length;

  const notes: string[] = [`policy ${policy.policyVersion} shadowed over ${usable.length} decision(s)`, `divergence rate ${divergenceRate}`];
  if (usable.length < minObservations) notes.push(`insufficient shadow observations (min ${minObservations})`);
  if (regressions) notes.push(`${regressions} shadow regression(s)`);

  const passed = usable.length >= minObservations && regressions === 0 && delta >= -regressionTolerance && divergenceRate <= maxDivergenceRate;
  return { passed, tasksEvaluated: usable.length, stableMean, candidateMean, delta, regressions, notes, divergences, divergenceRate };
}
