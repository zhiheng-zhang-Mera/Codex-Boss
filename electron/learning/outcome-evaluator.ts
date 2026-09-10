import {
  OUTCOME_EVALUATOR_VERSION,
  createEvaluationRevision,
  deriveSemanticEvaluation,
  detectGoalDrift,
  type GoalDriftInput,
  type OutcomeEvaluationInput,
  type SemanticEvaluation,
  type SemanticEvaluationRevision
} from "../../src/shared/provider-outcome";
import { adaptiveCapabilityEnabled, type AdaptiveFlags } from "../../src/shared/adaptive-flags";

/**
 * Engine Phase 1 — semantic outcome evaluator (service layer).
 *
 * Thin, deterministic wrapper around the pure classification contract:
 *  - gated by the `semanticOutcomeEvaluation` capability (off ⇒ no evaluation),
 *  - pinned evaluator version so historical comparisons stay auditable,
 *  - revisions append instead of overwriting (Engine §10).
 *
 * It never throws on bad input: an unusable input yields UNCLASSIFIED with zero
 * confidence, which downstream profile builders exclude.
 */

export interface OutcomeEvaluatorOptions {
  evaluatorVersion?: string;
  /** Flag snapshot provider; when the capability is off, evaluate() returns undefined. */
  flags?: () => AdaptiveFlags;
}

export class OutcomeEvaluator {
  readonly evaluatorVersion: string;
  private readonly flags?: () => AdaptiveFlags;

  constructor(options: OutcomeEvaluatorOptions = {}) {
    this.evaluatorVersion = options.evaluatorVersion ?? OUTCOME_EVALUATOR_VERSION;
    this.flags = options.flags;
  }

  enabled(): boolean {
    if (!this.flags) return true; // direct construction = explicitly enabled by the caller
    return adaptiveCapabilityEnabled("semanticOutcomeEvaluation", this.flags());
  }

  /** Evaluate one call outcome. Returns undefined when the capability is disabled. */
  evaluate(input: OutcomeEvaluationInput): SemanticEvaluation | undefined {
    if (!this.enabled()) return undefined;
    return deriveSemanticEvaluation(input, this.evaluatorVersion);
  }

  /** Goal drift helper used by callers that hold the Canonical Goal. */
  drift(goal: GoalDriftInput, output: string): { drifted: boolean; evidence: string[] } {
    return detectGoalDrift(goal, output);
  }

  /** Append an evaluator revision (original evaluation stays intact). */
  revise(input: { episodeId: string; original: SemanticEvaluation; input: OutcomeEvaluationInput; reason: string; revisedAt: string; evaluatorVersion?: string }): SemanticEvaluationRevision {
    const revised = deriveSemanticEvaluation(input.input, input.evaluatorVersion ?? this.evaluatorVersion);
    return createEvaluationRevision({ episodeId: input.episodeId, original: input.original, revised, reason: input.reason, revisedAt: input.revisedAt });
  }
}
