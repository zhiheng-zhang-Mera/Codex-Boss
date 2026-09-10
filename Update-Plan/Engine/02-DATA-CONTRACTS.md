# 02 — Suggested Data Contracts

以下为接口方向，不要求逐字复制；最终必须保持 schema versioning 和向后兼容。

```ts
export type SemanticOutcome =
  | "FULL_COMPLETION"
  | "PARTIAL_COMPLETION"
  | "GOAL_DRIFT"
  | "SOFT_RESTRICTION"
  | "HEAVY_SANITIZATION"
  | "PARTIAL_REFUSAL"
  | "HARD_REFUSAL"
  | "BAD_QUALITY"
  | "FORMAT_FAILURE"
  | "VERIFICATION_FAILURE"
  | "UNCLASSIFIED";

export interface BehaviourAxes {
  completion: number;
  goalFidelity: number;
  restrictionImpact: number;
  sanitizationImpact: number;
  pipelineBlocking: number;
  quality?: number;
  verificationScore?: number;
}

export type ModelIdentitySource =
  | "NETWORK_METADATA"
  | "PAGE_METADATA"
  | "UI_SELECTOR"
  | "PROVIDER_DECLARED"
  | "INFERRED"
  | "UNKNOWN";

export interface ModelExecutionIdentity {
  provider: string;
  surface: string;

  selectedModel?: string;
  declaredModel?: string;
  observedModelId?: string;
  mode?: string;

  versionSource: ModelIdentitySource;
  confidence: number;
  observedAt: string;

  behaviourEpochId?: string;
}

export interface ModelSnapshot {
  schemaVersion: 1;
  id: string;
  identity: ModelExecutionIdentity;
  fingerprint: string;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface LearnedConceptRef {
  conceptId: string;
  similarity: number;
  confidence: number;
}

export interface TaskFingerprint {
  schemaVersion: 1;
  fingerprintVersion: string;

  semanticVectorRef?: string;
  structuralHash: string;

  role: string;
  capabilities: string[];

  modality?: string[];
  specificity?: number;
  autonomyLevel?: number;
  externalEffectLevel?: number;
  contextScale?: number;

  concepts?: LearnedConceptRef[];
}

export interface SemanticEvaluation {
  evaluatorVersion: string;
  outcome: SemanticOutcome;
  axes: BehaviourAxes;
  confidence: number;
  reasons: string[];
}

export interface LearningEpisode {
  schemaVersion: 1;
  episodeId: string;

  taskId: string;
  jobId: string;
  timestamp: string;

  canonicalGoalHash: string;
  taskFingerprint: TaskFingerprint;

  runtimeId: string;
  role: string;

  modelSnapshotId?: string;

  runtimeStatus:
    | "SUCCESS"
    | "RETRYABLE_FAILURE"
    | "PERMANENT_FAILURE"
    | "CANCELLED";

  runtimeFailureCode?: string;

  semanticEvaluation?: SemanticEvaluation;

  artifactRefs: string[];
  evidenceRefs: string[];

  durationMs?: number;
  resourceCost?: number;

  routingPolicyVersion?: string;
}
```

# Provider Profile

```ts
export interface MetricEstimate {
  mean: number;
  confidence: number;
  samples: number;
  updatedAt: string;
}

export interface ConceptOverride {
  conceptId: string;

  completion?: MetricEstimate;
  goalFidelity?: MetricEstimate;
  restrictionImpact?: MetricEstimate;
  quality?: MetricEstimate;
}

export interface ProviderBehaviourProfile {
  schemaVersion: 1;

  profileId: string;
  runtimeId: string;
  modelSnapshotKey?: string;
  behaviourEpochId?: string;

  global: {
    completion: MetricEstimate;
    goalFidelity: MetricEstimate;
    restrictionImpact: MetricEstimate;
    runtimeReliability: MetricEstimate;
    verificationPass: MetricEstimate;
    latency: MetricEstimate;
  };

  byRole: Record<string, Partial<ProviderBehaviourProfile["global"]>>;

  conceptOverrides: ConceptOverride[];

  builtFromEpisodeCount: number;
  builderVersion: string;
  rebuiltAt: string;
}
```

# Adaptive Route Result

```ts
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
```

# Behaviour Epoch

```ts
export interface BehaviourEpoch {
  schemaVersion: 1;
  epochId: string;

  provider: string;
  surface: string;
  selectedModel?: string;
  observedModelId?: string;

  startedAt: string;
  endedAt?: string;

  parentEpochId?: string;

  trigger:
    | "OBSERVED_MODEL_CHANGE"
    | "SUSTAINED_BEHAVIOUR_CHANGE"
    | "MANUAL_RESET";

  confidence: number;
  evidenceEpisodeIds: string[];
}
```

# 兼容建议

现有 `RuntimeResult` 不建议一次性破坏性扩展成巨大对象。

优先：

```text
RuntimeResult
     │
     └── Learning pipeline produces Episode
```

若要增加关联字段，仅加 optional：

```ts
modelSnapshotId?: string;
```

避免所有 RuntimeAdapter 同时被迫迁移。
