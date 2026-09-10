/**
 * Engine Phase 6 — adaptive routing contracts (pure).
 *
 * The stable RoleRouter keeps ALL hard eligibility (required capability,
 * availability, explicit pin/exclude, budget) and the deterministic fallback.
 * The adaptive scorer may only SOFT-RANK candidates the hard layer already
 * approved (book §12/§13, acceptance A23-A27).
 *
 * ExpectedUtility =
 *   P(fullCompletion | task, model) * ExpectedVerifiedQuality * GoalFidelity
 *   − RestrictionImpact − PipelineBlockingRisk − LatencyCost − ResourceCost
 *
 * Nothing here mentions a provider brand: the scorer learns conditional
 * completion probability, never "provider X is bad/good".
 */

export const ADAPTIVE_POLICY_VERSION = "adaptive-policy-1.0.0";

export interface AdaptiveCandidateScore {
  runtimeId: string;

  eligible: boolean;

  expectedUtility?: number;
  confidence?: number;

  predictedCompletion?: number;
  predictedQuality?: number;
  predictedGoalFidelity?: number;
  predictedRestrictionImpact?: number;
  predictedBlockingRisk?: number;

  /** Deterministic explanation lines (why this candidate scored the way it did). */
  explanation: string[];
}

export interface AdaptiveRoutingDecision {
  decisionId: string;
  taskId: string;
  policyVersion: string;

  candidates: AdaptiveCandidateScore[];
  selectedRuntimeId?: string;

  usedFallbackRouter: boolean;
  exploration?: {
    enabled: boolean;
    reason?: string;
  };
}

/** Structural view of a routing request (keeps this module dependency-free). */
export interface AdaptiveRerankRequest {
  taskId?: string;
  role: string;
  pinnedRuntime?: string;
  excludedRuntimes?: string[];
  requiredCapabilities?: string[];
  capabilityTokens?: string[];
  preferredRuntimes?: string[];
  /** Optional task descriptor used to select the right profile scope/concepts. */
  fingerprint?: {
    structuralHash?: string;
    concepts?: Array<{ conceptId: string }>;
    specificity?: number;
  };
  modelSnapshotKey?: string;
  behaviourEpochId?: string;
}

export interface AdaptiveRerankCandidate {
  runtimeId: string;
  rank: number;
  reason: string;
}

export interface AdaptiveRerankResult {
  ordered: AdaptiveRerankCandidate[];
  decision: AdaptiveRoutingDecision;
}

/**
 * Seam consumed by RoleRouter. Implementations MUST be fail-open: returning
 * undefined or throwing leaves the deterministic order untouched.
 */
export interface AdaptiveReranker {
  rerank(request: AdaptiveRerankRequest, candidates: AdaptiveRerankCandidate[]): AdaptiveRerankResult | undefined;
}

/** Priors used for a candidate with no learned profile (honest, not a penalty). */
export const NEUTRAL_PRIOR = {
  completion: 0.5,
  quality: 0.5,
  goalFidelity: 0.5,
  restrictionImpact: 0.15,
  runtimeReliability: 0.8
} as const;

export const UTILITY_WEIGHTS = {
  pipelineBlockingRisk: 0.5,
  latencyCost: 0.2,
  resourceCost: 0.1,
  /** Latency (ms) that maps to a full latency cost. */
  latencyScaleMs: 10_000
} as const;

export interface UtilityInputs {
  completion: number;
  quality: number;
  goalFidelity: number;
  restrictionImpact: number;
  runtimeReliability: number;
  latencyMs?: number;
  resourceCost?: number;
}

/** Pure expected-utility computation (book §12). */
export function expectedUtility(input: UtilityInputs): number {
  const completion = clamp01(input.completion);
  const quality = clamp01(input.quality);
  const goalFidelity = clamp01(input.goalFidelity);
  const restriction = clamp01(input.restrictionImpact);
  const blockingRisk = clamp01(1 - clamp01(input.runtimeReliability));
  const latencyCost = input.latencyMs === undefined ? 0 : clamp01(input.latencyMs / UTILITY_WEIGHTS.latencyScaleMs);
  const resourceCost = input.resourceCost === undefined ? 0 : clamp01(input.resourceCost);
  const utility =
    completion * quality * goalFidelity -
    restriction -
    blockingRisk * UTILITY_WEIGHTS.pipelineBlockingRisk -
    latencyCost * UTILITY_WEIGHTS.latencyCost -
    resourceCost * UTILITY_WEIGHTS.resourceCost;
  return Number(utility.toFixed(4));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
