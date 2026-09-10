import {
  ADAPTIVE_POLICY_VERSION,
  NEUTRAL_PRIOR,
  UTILITY_WEIGHTS,
  clamp01,
  expectedUtility,
  type AdaptiveCandidateScore,
  type AdaptiveRerankCandidate,
  type AdaptiveRerankRequest,
  type AdaptiveRerankResult,
  type AdaptiveReranker,
  type AdaptiveRoutingDecision
} from "../../../src/shared/adaptive-routing";
import { adaptiveCapabilityEnabled, type AdaptiveFlags } from "../../../src/shared/adaptive-flags";
import { metricDeviation, type MetricEstimate, type ProviderBehaviourProfile } from "../../../src/shared/provider-profile";
import { structuralHashOf } from "../../../src/shared/task-fingerprint";

/**
 * Engine Phase 6 — adaptive scorer (soft ranking only, fail-open).
 *
 * Guarantees:
 *  - only candidates the hard layer already approved are reordered;
 *  - a pinned runtime always keeps the top position when it was eligible;
 *  - a missing/corrupt profile set, a disabled flag, or ANY exception yields the
 *    original deterministic order with `usedFallbackRouter: true`;
 *  - every candidate gets a human-readable explanation (acceptance A35);
 *  - low historically-observed completion with high confidence is down-weighted
 *    (A31) while unseen candidates keep a neutral prior and are not punished.
 */

export interface ProfileResolver {
  resolve(input: { runtimeId: string; modelSnapshotKey?: string; behaviourEpochId?: string }): ProviderBehaviourProfile | undefined;
}

export interface AdaptiveScorerOptions {
  profiles: ProfileResolver;
  flags: () => AdaptiveFlags;
  policyVersion?: string;
  now?: () => string;
  decisionIdProvider?: () => string;
}

export class AdaptiveScorer implements AdaptiveReranker {
  private readonly profiles: ProfileResolver;
  private readonly flags: () => AdaptiveFlags;
  private readonly policyVersion: string;
  private readonly now: () => string;
  private readonly decisionIdProvider: () => string;

  constructor(options: AdaptiveScorerOptions) {
    this.profiles = options.profiles;
    this.flags = options.flags;
    this.policyVersion = options.policyVersion ?? ADAPTIVE_POLICY_VERSION;
    this.now = options.now ?? (() => new Date().toISOString());
    this.decisionIdProvider = options.decisionIdProvider ?? (() => `rd-${structuralHashOf([this.now(), Math.random().toString(36).slice(2, 8)])}`);
  }

  enabled(): boolean {
    return adaptiveCapabilityEnabled("adaptiveRouting", this.flags());
  }

  /** Never throws: any internal failure degrades to the deterministic order. */
  rerank(request: AdaptiveRerankRequest, candidates: AdaptiveRerankCandidate[]): AdaptiveRerankResult | undefined {
    if (!this.enabled()) return undefined;
    try {
      return this.rerankInternal(request, candidates);
    } catch {
      return undefined; // A27: adaptive failure ⇒ caller keeps its own order
    }
  }

  private rerankInternal(request: AdaptiveRerankRequest, candidates: AdaptiveRerankCandidate[]): AdaptiveRerankResult {
    const decisionId = this.decisionIdProvider();
    const scored: AdaptiveCandidateScore[] = candidates.map((candidate) => this.scoreCandidate(request, candidate));
    const byId = new Map(scored.map((score) => [score.runtimeId, score]));

    const pinned = request.pinnedRuntime;
    const ordered = [...candidates].sort((a, b) => {
      // Pin keeps explicit user priority among eligible candidates (A26).
      if (pinned) {
        if (a.runtimeId === pinned && b.runtimeId !== pinned) return -1;
        if (b.runtimeId === pinned && a.runtimeId !== pinned) return 1;
      }
      const left = byId.get(a.runtimeId)!;
      const right = byId.get(b.runtimeId)!;
      const delta = (right.expectedUtility ?? Number.NEGATIVE_INFINITY) - (left.expectedUtility ?? Number.NEGATIVE_INFINITY);
      if (delta !== 0) return delta;
      return a.rank - b.rank; // deterministic tie-break on the stable rank
    }).map((candidate, rank) => ({ ...candidate, rank }));

    const decision: AdaptiveRoutingDecision = {
      decisionId,
      taskId: request.taskId ?? "unscoped",
      policyVersion: this.policyVersion,
      candidates: scored,
      selectedRuntimeId: ordered[0]?.runtimeId,
      usedFallbackRouter: false,
      exploration: { enabled: false, reason: "phase 6 exploitation only" }
    };
    return { ordered, decision };
  }

  private scoreCandidate(request: AdaptiveRerankRequest, candidate: AdaptiveRerankCandidate): AdaptiveCandidateScore {
    const explanation: string[] = [];
    const profile = this.profiles.resolve({
      runtimeId: candidate.runtimeId,
      modelSnapshotKey: request.modelSnapshotKey,
      behaviourEpochId: request.behaviourEpochId
    });

    if (!profile || profile.builtFromEpisodeCount === 0) {
      explanation.push("no learned profile — neutral prior (not penalised)");
      const utility = expectedUtility({ ...NEUTRAL_PRIOR });
      return {
        runtimeId: candidate.runtimeId,
        eligible: true,
        expectedUtility: utility,
        confidence: 0,
        predictedCompletion: NEUTRAL_PRIOR.completion,
        predictedQuality: NEUTRAL_PRIOR.quality,
        predictedGoalFidelity: NEUTRAL_PRIOR.goalFidelity,
        predictedRestrictionImpact: NEUTRAL_PRIOR.restrictionImpact,
        predictedBlockingRisk: clamp01(1 - NEUTRAL_PRIOR.runtimeReliability),
        explanation
      };
    }

    const roleMetrics = profile.byRole?.[request.role];
    const completion = pick(roleMetrics?.completion, profile.global.completion);
    const goalFidelity = pick(roleMetrics?.goalFidelity, profile.global.goalFidelity);
    const restriction = pick(roleMetrics?.restrictionImpact, profile.global.restrictionImpact);
    const reliability = profile.global.runtimeReliability;
    const verification = profile.global.verificationPass;

    // Concept-conditioned deviations (book §11): apply the learned deviation for
    // concepts present on this task's fingerprint.
    const concepts = (request.fingerprint?.concepts ?? []).map((concept) => concept.conceptId);
    let adjustedCompletion = completion.mean;
    let adjustedRestriction = restriction.mean;
    for (const conceptId of concepts) {
      const override = profile.conceptOverrides.find((item) => item.conceptId === conceptId);
      if (!override) continue;
      const completionDeviation = metricDeviation(override.completion, profile.global.completion) ?? 0;
      const restrictionDeviation = metricDeviation(override.restrictionImpact, profile.global.restrictionImpact) ?? 0;
      adjustedCompletion = clamp01(adjustedCompletion + completionDeviation);
      adjustedRestriction = clamp01(adjustedRestriction + restrictionDeviation);
      explanation.push(`concept ${conceptId}: completion ${completionDeviation >= 0 ? "+" : ""}${completionDeviation.toFixed(3)}, restriction ${restrictionDeviation >= 0 ? "+" : ""}${restrictionDeviation.toFixed(3)}`);
    }

    const quality = verification.samples > 0 ? verification.mean : completion.mean;
    if (verification.samples === 0) explanation.push("no verification samples — quality proxied from completion");

    const utility = expectedUtility({
      completion: adjustedCompletion,
      quality,
      goalFidelity: goalFidelity.mean,
      restrictionImpact: adjustedRestriction,
      runtimeReliability: reliability.samples > 0 ? reliability.mean : NEUTRAL_PRIOR.runtimeReliability,
      latencyMs: profile.global.latency.samples > 0 ? profile.global.latency.mean : undefined
    });

    const confidences = [completion, goalFidelity, restriction, reliability, verification]
      .filter((metric) => metric.samples > 0)
      .map((metric) => metric.confidence);
    const confidence = confidences.length ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(3)) : 0;

    if (completion.samples > 0) explanation.push(`completion ${completion.mean.toFixed(3)} (n=${completion.samples}, conf ${completion.confidence.toFixed(2)})`);
    if (restriction.samples > 0 && restriction.mean > 0) explanation.push(`restriction impact ${restriction.mean.toFixed(3)} (n=${restriction.samples})`);
    if (reliability.samples > 0) explanation.push(`runtime reliability ${reliability.mean.toFixed(3)} (n=${reliability.samples})`);
    explanation.push(`expected utility ${utility} (policy ${this.policyVersion})`);

    return {
      runtimeId: candidate.runtimeId,
      eligible: true,
      expectedUtility: utility,
      confidence,
      predictedCompletion: Number(adjustedCompletion.toFixed(4)),
      predictedQuality: Number(quality.toFixed(4)),
      predictedGoalFidelity: Number(goalFidelity.mean.toFixed(4)),
      predictedRestrictionImpact: Number(adjustedRestriction.toFixed(4)),
      predictedBlockingRisk: Number(clamp01(1 - (reliability.samples > 0 ? reliability.mean : NEUTRAL_PRIOR.runtimeReliability)).toFixed(4)),
      explanation
    };
  }
}

function pick(scoped: MetricEstimate | undefined, fallback: MetricEstimate): MetricEstimate {
  if (scoped && scoped.samples > 0) return scoped;
  return fallback;
}

export { UTILITY_WEIGHTS };
