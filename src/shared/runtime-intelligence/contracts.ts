/**
 * Runtime Intelligence Plane — the shared observation schema.
 *
 * The plane observes, measures, models and recommends. It does not decide. That is why
 * this file defines contracts and small pure derivations only, why every recommendation
 * type carries an explicit `authority: "ADVISORY_ONLY"` marker, and why `ADVISORY_ONLY`
 * is a literal type rather than a boolean: a consumer that wants to act on a
 * recommendation has to widen the type, which makes the decision visible in review.
 *
 * The schema exists to answer the questions an execution record could not answer before
 * this plane: which model was used and why, on which machine and why, with which skills
 * and context loaded, whether continuation was advised, and how the outcome fed back
 * into the capability estimate. `RuntimeObservation` is the single record those
 * questions are answered from, so the six subsystems below do not each grow a private
 * log.
 *
 * The plane never deletes. Skills stop being mounted, context moves to a colder tier and
 * knowledge is archived, but every one of those is a reversible placement recorded with
 * the reason it was chosen — see `skill-loadout.ts` and `context-lifecycle.ts`.
 */

import type { Measurement } from "./measurement";

export const RUNTIME_INTELLIGENCE_SCHEMA_VERSION = 1;

/** The one authority every recommendation in this plane carries. */
export type AdvisoryAuthority = "ADVISORY_ONLY";

/** Task shape the recommender reasons about. */
export type TaskKind = "coding" | "reasoning" | "planning" | "review" | "research" | "synthesis" | "computer_use" | "other";

/** A reason attached to a recommendation. `weight` is the contribution, not a probability. */
export interface ReasoningFactor {
  factor: string;
  weight: number;
  detail: string;
  evidence: string[];
}

export interface TaskProfile {
  taskId: string;
  /** Free-form role name (planner, reviewer, coder ...). Kept a string so a new role needs no migration. */
  role: string;
  taskKind: TaskKind;
  /** Capability tokens the task declares it needs. Unknown tokens stay visible. */
  requiredCapabilities: string[];
  contextScale: "small" | "medium" | "large";
  /** True when the task can change something outside Boss, which raises the required confidence. */
  externalEffect: boolean;
  risk: "low" | "medium" | "high";
  expectedSteps?: number;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Model capability ledger                                                      */
/* -------------------------------------------------------------------------- */

export const MODEL_CAPABILITY_DIMENSIONS = [
  "coding",
  "reasoning",
  "planning",
  "review",
  "research",
  "long_context",
  "tool_use",
  "computer_use",
  "latency",
  "cost",
  "stability",
  "reliability"
] as const;
export type ModelCapabilityDimension = (typeof MODEL_CAPABILITY_DIMENSIONS)[number];

/**
 * One dimension's estimate.
 *
 * `priorWeight` is a pseudo-sample count: it is how many observations the inherited
 * prior is worth, and it is spent down as real outcomes arrive. That is what lets a
 * brand-new model start non-zero with wide uncertainty while an established model's
 * estimate is no longer movable by its family's prior.
 */
export interface CapabilityEstimate {
  /** 0..1 for quality dimensions, 0..1 normalised for latency/cost (1 = cheapest/fastest). */
  score: number;
  /** The score the injected prior contributed. Constant over time; `score` moves away from it. */
  priorScore: number;
  /** 0..1. `confidenceFor` derives this from `samples`. */
  confidence: number;
  /** Real outcomes folded into this dimension. */
  samples: number;
  /** Remaining prior pseudo-samples. Falls to 0 as `samples` grows. */
  priorWeight: number;
  /**
   * Sum of the weights actually folded in. Below `samples` whenever an outcome was
   * down-weighted as anomalous, which is what keeps one outlier from dominating.
   */
  observedWeight: number;
  /** Numerator of the observed mean: the sum of `weight * observedValue`. */
  observedWeightedValue: number;
  updatedAt: string;
}

export type ModelCapabilityScores = Record<ModelCapabilityDimension, CapabilityEstimate>;

/** How a new model's estimate was seeded. Recorded so a warm start is never mistaken for evidence. */
export type WarmStartSource = "FAMILY_PRIOR" | "PROVIDER_PRIOR" | "DECLARED_CAPABILITY" | "GLOBAL_PRIOR";

export interface ModelTaskTypePerformance {
  attempts: number;
  successes: number;
  failures: number;
}

export interface ModelLatencyStatistics {
  samples: number;
  meanMs: number;
  /** Highest observed latency; a distribution without percentiles still needs a ceiling. */
  maxMs: number;
}

export interface ModelCostStatistics {
  samples: number;
  meanUsd: number;
  totalUsd: number;
}

export interface ModelReviewAgreement {
  samples: number;
  agreements: number;
}

/** One recorded outcome. Bounded on write by the ledger, so history cannot grow without limit. */
export interface ModelOutcomeRecord {
  observationId: string;
  taskId: string;
  modelKey: string;
  nodeId: string;
  role: string;
  taskKind: TaskKind;
  success: boolean;
  failureClass?: string;
  latencyMs?: number;
  costUsd?: number;
  reviewerAgreed?: boolean;
  /** Bounded influence: an anomaly is recorded with a low weight instead of being dropped. */
  weight: number;
  at: string;
}

export interface ModelCapabilityRecord {
  schemaVersion: number;
  /** Stable identity of one model: provider + family + version-or-unknown. */
  modelKey: string;
  provider: string;
  family: string;
  /** `"unknown"` when identity was never established. Never a guessed version. */
  version: string;
  firstSeen: string;
  lastSeen: string;
  declaredCapabilities: string[];
  warmStartSources: WarmStartSource[];
  /**
   * True while at least one dimension's estimate is still dominated by its prior.
   *
   * A model that has been measured hard on `coding` is still warm-started on `latency`
   * if latency was never observed, which is exactly the distinction this flag keeps.
   */
  warmStarted: boolean;
  scores: ModelCapabilityScores;
  taskTypePerformance: Record<string, ModelTaskTypePerformance>;
  failureClasses: Record<string, number>;
  latency: ModelLatencyStatistics;
  cost: ModelCostStatistics;
  reviewAgreement: ModelReviewAgreement;
  /** Most recent outcomes, newest last. Bounded by `MODEL_HISTORY_LIMIT`. */
  history: ModelOutcomeRecord[];
}

/** How many outcome records one model keeps. History is evidence, not an archive. */
export const MODEL_HISTORY_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/* Skill cards and loadout                                                      */
/* -------------------------------------------------------------------------- */

export const SKILL_STATES = ["HOT", "WARM", "COLD", "RARE", "REDUNDANT", "PRUNE_CANDIDATE"] as const;
export type SkillState = (typeof SKILL_STATES)[number];

/**
 * A skill card: what a skill is, what it costs to mount, and which capabilities it
 * serves. `PRUNE_CANDIDATE` is a state a card can be in, never an action: nothing in
 * this plane removes a card, and there is no delete function to call.
 */
export interface SkillCard {
  schemaVersion: number;
  skillId: string;
  name: string;
  description?: string;
  providesCapabilities: string[];
  /** Tokens the skill's instructions add to every prompt while mounted. */
  contextTokens: number;
  /** Measured startup cost of mounting it. */
  baseLatencyMs: number;
  tags: string[];
}

/** One task's experience with one skill. `selected` and `used` are different facts. */
export interface SkillUsageTelemetry {
  skillId: string;
  taskId: string;
  observationId: string;
  selected: boolean;
  used: boolean;
  invocationCount: number;
  contextTokens: number;
  latencyMs: number;
  success: boolean;
  failureClass?: string;
  /** ids of skills whose advice contradicted this one on the same task. */
  conflictsWith: string[];
  /** ids of skills that would have served the same capability. */
  overlappingWith: string[];
  at: string;
}

/** The aggregate a state is derived from. Every field is observed, so no field is optional-by-assumption. */
export interface SkillHealthSummary {
  skillId: string;
  selections: number;
  uses: number;
  invocations: number;
  /** Selections that produced no invocation — the direct measure of wasted mounting. */
  unusedSelections: number;
  usageRate: number;
  contextTokensMounted: number;
  latencyMsMounted: number;
  successes: number;
  failures: number;
  /** How often a success is attributable to this skill (0 when never used). */
  successContribution: number;
  failureAssociation: number;
  conflicts: string[];
  redundancy: number;
}

export interface SkillStateAssessment {
  skillId: string;
  state: SkillState;
  reasons: string[];
  summary: SkillHealthSummary;
}

/** What a loadout recommendation is allowed to say: mount or do not mount. Never delete. */
export interface LoadoutRecommendation {
  taskId: string;
  authority: AdvisoryAuthority;
  mountedSkillIds: string[];
  omittedSkillIds: string[];
  omittedBecause: Array<{ skillId: string; reason: string }>;
  projectedContextTokens: number;
  projectedLatencyMs: number;
  factors: ReasoningFactor[];
}

/* -------------------------------------------------------------------------- */
/* Node capability                                                             */
/* -------------------------------------------------------------------------- */

export interface GpuDevice {
  name: string;
  /** Absent VRAM is absent, not zero. */
  vramMb?: number;
}

export type TrustClass = "TRUSTED_HOST" | "UNTRUSTED_HOST" | "UNKNOWN_HOST";

export type NetworkQuality = "DIRECT" | "PROXIED" | "DEGRADED" | "OFFLINE" | "UNKNOWN";

export interface NodeCapabilitySnapshot {
  schemaVersion: number;
  kind: "NODE_CAPABILITY_SNAPSHOT";
  nodeId: string;
  /** Stable machine identity, when one was observed. */
  hostId: Measurement<string>;
  capturedAt: string;
  identity: {
    deviceType: "desktop" | "laptop" | "server" | "embedded" | "unknown";
    os: string;
    arch: string;
    runtimeVersion: string;
  };
  cpu: {
    logicalCores: Measurement<number>;
    physicalCores: Measurement<number>;
    model: Measurement<string>;
    /** Normalised 0..100 load observed at capture time. */
    loadPercent: Measurement<number>;
  };
  memory: {
    totalMb: Measurement<number>;
    freeMb: Measurement<number>;
  };
  gpu: {
    devices: Measurement<GpuDevice[]>;
    /** Total VRAM across devices. Absent whenever device VRAM is absent. */
    totalVramMb: Measurement<number>;
  };
  disk: {
    freeMb: Measurement<number>;
    totalMb: Measurement<number>;
  };
  network: {
    availability: Measurement<boolean>;
    latencyMs: Measurement<number>;
    quality: Measurement<NetworkQuality>;
  };
  load: {
    /** Tasks this node believes it is running. */
    currentTasks: Measurement<number>;
    processPressure: Measurement<number>;
  };
  /** Local model ids the node can serve without a network call. */
  localModels: Measurement<string[]>;
  /** API providers this node can currently reach. */
  apis: Measurement<string[]>;
  /** Native tools observed on PATH or on disk. */
  tools: Measurement<string[]>;
  plugins: Measurement<string[]>;
  repo: {
    /** Whether the working tree is on this node, on a share, or absent. */
    locality: Measurement<"LOCAL" | "NETWORK" | "ABSENT">;
    warmCacheHints: Measurement<string[]>;
  };
  trust: {
    trustClass: TrustClass;
    /** Restrictions this node must honour (from policy, not from measurement). */
    executionRestrictions: string[];
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduling advice                                                           */
/* -------------------------------------------------------------------------- */

export interface NodeRecommendation {
  nodeId: string;
  score: number;
  reasons: string[];
}

export interface ModelRecommendation {
  modelKey: string;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface SchedulingRecommendation {
  schemaVersion: number;
  kind: "SCHEDULING_RECOMMENDATION";
  recommendationId: string;
  taskId: string;
  createdAt: string;
  authority: AdvisoryAuthority;
  preferredNode?: NodeRecommendation;
  fallbackNode?: NodeRecommendation;
  preferredModel?: ModelRecommendation;
  fallbackModel?: ModelRecommendation;
  preferredSkillLoadout: string[];
  contextTierHint?: ContextTier;
  reasoningFactors: ReasoningFactor[];
  confidence: number;
  /** Absent when no cost evidence exists — never 0 as a placeholder. */
  estimatedCostUsd?: number;
  estimatedLatencyMs?: number;
  estimatedRisk: "low" | "medium" | "high" | "unknown";
  blocked: Array<{ candidateId: string; reason: string }>;
  /**
   * This plane can never route work or pick a qualification host. Both are literal
   * `false` so a consumer that needs them has to change the type deliberately.
   */
  productionRoutingAuthority: false;
  qualificationHostSelection: false;
}

/* -------------------------------------------------------------------------- */
/* Continuation                                                                */
/* -------------------------------------------------------------------------- */

export const CONTINUATION_DECISIONS = ["CONTINUE", "STOP", "SWITCH_MODEL", "ASK_REVIEWER", "DECOMPOSE_TASK", "RETRY_WITH_CONTEXT"] as const;
export type ContinuationDecision = (typeof CONTINUATION_DECISIONS)[number];

export type ToolProgress = "PROGRESSING" | "STALLED" | "UNKNOWN";

export interface ContinuationSignals {
  taskId: string;
  modelKey: string;
  /** 0..1 self-reported or measured completion of the objective. */
  progress: number;
  /** 0..1 — how much of the latest output was not present in earlier outputs. */
  outputNovelty: number;
  /** 0..1 — the model's own or the observer's uncertainty. Absent = not measured. */
  uncertainty?: number;
  unresolvedItems: number;
  resolvedItems: number;
  tokensConsumed: number;
  tokenBudget?: number;
  elapsedMs: number;
  /** 0..1 — share of the latest output that repeats earlier output. */
  repeatRate: number;
  selfContradictions: number;
  reviewerDisagreements: number;
  reviewerReviews: number;
  toolProgress: ToolProgress;
  stepsCompleted: number;
  expectedSteps?: number;
}

/**
 * A continuation opinion. `mode` is always `SHADOW_ONLY`: the real loop keeps its own
 * stopping rule, and this record exists so the advice can be compared with what
 * actually happened rather than executed.
 */
export interface ContinuationAssessment {
  schemaVersion: number;
  kind: "CONTINUATION_ASSESSMENT";
  assessmentId: string;
  taskId: string;
  modelKey: string;
  mode: "SHADOW_ONLY";
  decision: ContinuationDecision;
  confidence: number;
  factors: ReasoningFactor[];
  /** The step at which following this advice would have stopped or switched. */
  wouldActAtStep: number;
  /** What the shadow run believes the effect of following the advice would have been. */
  counterfactual: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Context lifecycle                                                           */
/* -------------------------------------------------------------------------- */

export const CONTEXT_TIERS = ["HOT", "WARM", "COLD", "ARCHIVE"] as const;
export type ContextTier = (typeof CONTEXT_TIERS)[number];

export const CONTEXT_ACTIONS = ["INJECT_NOW", "CANDIDATE_RETRIEVAL", "COLD_STORE", "ARCHIVE"] as const;
export type ContextAction = (typeof CONTEXT_ACTIONS)[number];

export interface ContextRecord {
  id: string;
  kind: string;
  tokens: number;
  lastUsedAt: string;
  retrievalCount: number;
  /** 0..1 — how much this record contributed to tasks that succeeded after using it. */
  successContribution: number;
  /** Records this one depends on; a dependency keeps the pair together. */
  dependencyIds: string[];
  /** 0..1 — how much the record can be trusted as current. */
  confidence: number;
  /** Pinned records are never demoted, whatever their age. */
  pinned?: boolean;
}

export interface ContextPlacement {
  id: string;
  tier: ContextTier;
  action: ContextAction;
  score: number;
  reasons: string[];
  /**
   * Every tier is restorable, including ARCHIVE. The literal `true` is the type-level
   * statement that archiving is not deletion.
   */
  restorable: true;
}

export interface ContextLifecyclePlan {
  schemaVersion: number;
  kind: "CONTEXT_LIFECYCLE_PLAN";
  taskId: string;
  createdAt: string;
  authority: AdvisoryAuthority;
  placements: ContextPlacement[];
  injectedIds: string[];
  candidateIds: string[];
  archivedIds: string[];
  projectedInjectedTokens: number;
  /** Always true: this plan moves records between tiers and never removes one. */
  deletesNothing: true;
}

/* -------------------------------------------------------------------------- */
/* Unified telemetry                                                           */
/* -------------------------------------------------------------------------- */

export type SelectionBasis = "RECOMMENDED" | "ACTUAL" | "FALLBACK" | "UNKNOWN";

export interface RuntimeObservation {
  schemaVersion: number;
  kind: "RUNTIME_OBSERVATION";
  observationId: string;
  /** Groups every observation of one task, so a multi-step task has one trace. */
  traceId: string;
  task: {
    taskId: string;
    role: string;
    taskKind: TaskKind;
  };
  model: {
    modelKey: string;
    provider: string;
    family: string;
    version: string;
    basis: SelectionBasis;
    /** ids of the reasoning factors that put this model here. */
    reasonRefs: string[];
  };
  node: {
    nodeId: string;
    basis: SelectionBasis;
    reasonRefs: string[];
  };
  skills: {
    recommended: string[];
    actual: string[];
    used: string[];
  };
  context: {
    injected: string[];
    candidate: string[];
    archived: string[];
  };
  execution: {
    outcome: "SUCCESS" | "FAILED" | "CANCELLED" | "UNKNOWN";
    failureClass?: string;
    latencyMs?: number;
    tokens?: number;
    costUsd?: number;
  };
  review: {
    agreement: "AGREED" | "DISAGREED" | "NOT_REVIEWED";
    reviewerId?: string;
    notes?: string;
  };
  /**
   * The shadow continuation opinion recorded with this run, when one was taken.
   *
   * `executed` is the literal `false`: the opinion is recorded so it can be compared with
   * what the loop did, never so it can be mistaken for the loop's own decision.
   */
  continuation?: {
    assessmentId: string;
    decision: ContinuationDecision;
    confidence: number;
    executed: false;
  };
  capabilityUpdate: {
    applied: boolean;
    dimensions: ModelCapabilityDimension[];
    reason: string;
  };
  createdAt: string;
}

/** Deterministic id from a prefix and its parts. Keeps ids free of clock collisions. */
export function stableId(prefix: string, parts: readonly (string | number)[]): string {
  const text = parts.map((part) => String(part)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** The identity key of one model. A missing version is spelled `unknown`, never guessed. */
export function modelKeyOf(input: { provider: string; family: string; version?: string }): string {
  const part = (value: string | undefined, fallback: string): string => (value ?? "").trim().toLowerCase() || fallback;
  return `${part(input.provider, "unknown")}:${part(input.family, "unknown")}:${part(input.version, "unknown")}`;
}

/** True for a task whose effects leave Boss, where a wrong recommendation costs more. */
export function taskNeedsHighConfidence(profile: TaskProfile): boolean {
  return profile.externalEffect || profile.risk === "high";
}
