import { describe, expect, it } from "vitest";
import {
  CONTEXT_ACTIONS,
  CONTEXT_TIERS,
  CONTINUATION_DECISIONS,
  MODEL_CAPABILITY_DIMENSIONS,
  MODEL_HISTORY_LIMIT,
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  SKILL_STATES,
  modelKeyOf,
  stableId,
  taskNeedsHighConfidence,
  type AdvisoryAuthority,
  type CapabilityEstimate,
  type ContextAction,
  type ContextLifecyclePlan,
  type ContextPlacement,
  type ContextRecord,
  type ContextTier,
  type ContinuationAssessment,
  type ContinuationDecision,
  type ContinuationSignals,
  type GpuDevice,
  type LoadoutRecommendation,
  type ModelCapabilityRecord,
  type ModelCapabilityScores,
  type ModelCapabilityDimension,
  type ModelCostStatistics,
  type ModelLatencyStatistics,
  type ModelOutcomeRecord,
  type ModelRecommendation,
  type ModelReviewAgreement,
  type ModelTaskTypePerformance,
  type NetworkQuality,
  type NodeCapabilitySnapshot,
  type NodeRecommendation,
  type ReasoningFactor,
  type RuntimeObservation,
  type SchedulingRecommendation,
  type SelectionBasis,
  type SkillCard,
  type SkillHealthSummary,
  type SkillState,
  type SkillStateAssessment,
  type SkillUsageTelemetry,
  type TaskKind,
  type TaskProfile,
  type ToolProgress,
  type TrustClass,
  type WarmStartSource
} from "../../../src/shared/runtime-intelligence/contracts";
import { measured, unknown } from "../../../src/shared/runtime-intelligence/measurement";

/**
 * The schema is the plane's interface, so it is asserted rather than assumed: every
 * declared vocabulary is pinned, and one fully-populated fixture proves each record can
 * actually be built from the fields the modules promise. A fixture that stops compiling
 * is how a silently-dropped field becomes visible.
 */

const AT = "2026-01-01T00:00:00.000Z";

describe("the vocabularies are closed and ordered", () => {
  it("declares the twelve capability dimensions the ledger scores", () => {
    expect(MODEL_CAPABILITY_DIMENSIONS).toEqual([
      "coding", "reasoning", "planning", "review", "research", "long_context", "tool_use", "computer_use", "latency", "cost", "stability", "reliability"
    ]);
  });

  it("declares the six skill states, with PRUNE_CANDIDATE as a state and not an action", () => {
    expect(SKILL_STATES).toEqual(["HOT", "WARM", "COLD", "RARE", "REDUNDANT", "PRUNE_CANDIDATE"]);
    const prune: SkillState = "PRUNE_CANDIDATE";
    expect(SKILL_STATES).toContain(prune);
  });

  it("declares the four context tiers and the four reversible actions", () => {
    expect(CONTEXT_TIERS).toEqual(["HOT", "WARM", "COLD", "ARCHIVE"]);
    expect(CONTEXT_ACTIONS).toEqual(["INJECT_NOW", "CANDIDATE_RETRIEVAL", "COLD_STORE", "ARCHIVE"]);
    const archive: ContextAction = "ARCHIVE";
    const tier: ContextTier = "ARCHIVE";
    expect(CONTEXT_ACTIONS).toContain(archive);
    expect(CONTEXT_TIERS).toContain(tier);
  });

  it("declares the six continuation decisions", () => {
    expect(CONTINUATION_DECISIONS).toEqual(["CONTINUE", "STOP", "SWITCH_MODEL", "ASK_REVIEWER", "DECOMPOSE_TASK", "RETRY_WITH_CONTEXT"]);
    const decision: ContinuationDecision = "SWITCH_MODEL";
    expect(CONTINUATION_DECISIONS).toContain(decision);
  });

  it("bounds model history so a ledger cannot grow without limit", () => {
    expect(MODEL_HISTORY_LIMIT).toBeGreaterThan(0);
  });
});

describe("identity helpers", () => {
  it("derives a stable model key and never invents a version", () => {
    expect(modelKeyOf({ provider: "OpenAI", family: "GPT", version: "5" })).toBe("openai:gpt:5");
    expect(modelKeyOf({ provider: "OpenAI", family: "GPT" })).toBe("openai:gpt:unknown");
    expect(modelKeyOf({ provider: "  ", family: "" })).toBe("unknown:unknown:unknown");
  });

  it("derives deterministic ids with a stable prefix", () => {
    expect(stableId("obs", ["a", 1])).toBe(stableId("obs", ["a", 1]));
    expect(stableId("obs", ["a", 1])).not.toBe(stableId("obs", ["a", 2]));
    expect(stableId("obs", ["a", 1]).startsWith("obs-")).toBe(true);
  });

  it("flags the tasks where a wrong recommendation costs the most", () => {
    const base: TaskProfile = { taskId: "t", role: "coder", taskKind: "coding", requiredCapabilities: [], contextScale: "small", externalEffect: false, risk: "low", createdAt: AT };
    expect(taskNeedsHighConfidence(base)).toBe(false);
    expect(taskNeedsHighConfidence({ ...base, externalEffect: true })).toBe(true);
    expect(taskNeedsHighConfidence({ ...base, risk: "high" })).toBe(true);
  });
});

describe("every record can be built from its declared fields", () => {
  const estimate: CapabilityEstimate = { score: 0.7, confidence: 0.4, samples: 3, priorWeight: 2, observedWeight: 3, observedWeightedValue: 2.1, updatedAt: AT };
  const scores = Object.fromEntries(MODEL_CAPABILITY_DIMENSIONS.map((dimension) => [dimension, estimate])) as ModelCapabilityScores;
  const dimension: ModelCapabilityDimension = "coding";
  const warmStart: WarmStartSource = "FAMILY_PRIOR";
  const taskKind: TaskKind = "coding";
  const authority: AdvisoryAuthority = "ADVISORY_ONLY";
  const trust: TrustClass = "TRUSTED_HOST";
  const quality: NetworkQuality = "DIRECT";
  const toolProgress: ToolProgress = "PROGRESSING";
  const basis: SelectionBasis = "RECOMMENDED";

  it("builds a model capability record", () => {
    const performance: ModelTaskTypePerformance = { attempts: 3, successes: 2, failures: 1 };
    const latency: ModelLatencyStatistics = { samples: 3, meanMs: 900, maxMs: 1500 };
    const cost: ModelCostStatistics = { samples: 3, meanUsd: 0.02, totalUsd: 0.06 };
    const agreement: ModelReviewAgreement = { samples: 2, agreements: 1 };
    const outcome: ModelOutcomeRecord = {
      observationId: "obs-1",
      taskId: "task-1",
      modelKey: "p:f:1",
      nodeId: "node-a",
      role: "coder",
      taskKind,
      success: true,
      weight: 1,
      at: AT
    };
    const record: ModelCapabilityRecord = {
      schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
      modelKey: "p:f:1",
      provider: "p",
      family: "f",
      version: "1",
      firstSeen: AT,
      lastSeen: AT,
      declaredCapabilities: ["coding"],
      warmStartSources: [warmStart],
      warmStarted: true,
      scores,
      taskTypePerformance: { coding: performance },
      failureClasses: { TIMEOUT: 1 },
      latency,
      cost,
      reviewAgreement: agreement,
      history: [outcome]
    };
    expect(record.scores[dimension].priorWeight).toBe(2);
    expect(record.history).toHaveLength(1);
  });

  it("builds a skill card, its telemetry and its health summary", () => {
    const card: SkillCard = { schemaVersion: 1, skillId: "skill-a", name: "A", providesCapabilities: ["coding"], contextTokens: 800, baseLatencyMs: 120, tags: ["code"] };
    const telemetry: SkillUsageTelemetry = {
      skillId: card.skillId,
      taskId: "task-1",
      observationId: "obs-1",
      selected: true,
      used: false,
      invocationCount: 0,
      contextTokens: 800,
      latencyMs: 120,
      success: true,
      conflictsWith: [],
      overlappingWith: ["skill-b"],
      at: AT
    };
    const summary: SkillHealthSummary = {
      skillId: card.skillId,
      selections: 1,
      uses: 0,
      invocations: 0,
      unusedSelections: 1,
      usageRate: 0,
      contextTokensMounted: 800,
      latencyMsMounted: 120,
      successes: 1,
      failures: 0,
      successContribution: 0,
      failureAssociation: 0,
      conflicts: [],
      redundancy: 1
    };
    const assessment: SkillStateAssessment = { skillId: card.skillId, state: "REDUNDANT", reasons: ["overlaps skill-b"], summary };
    const loadout: LoadoutRecommendation = {
      taskId: "task-1",
      authority,
      mountedSkillIds: ["skill-a"],
      omittedSkillIds: ["skill-b"],
      omittedBecause: [{ skillId: "skill-b", reason: "redundant with skill-a" }],
      projectedContextTokens: 800,
      projectedLatencyMs: 120,
      factors: []
    };
    expect(telemetry.selected).toBe(true);
    expect(assessment.state).toBe("REDUNDANT");
    expect(loadout.authority).toBe("ADVISORY_ONLY");
  });

  it("builds a node capability snapshot whose absences stay absent", () => {
    const gpu: GpuDevice = { name: "unknown-vendor" };
    const snapshot: NodeCapabilitySnapshot = {
      schemaVersion: 1,
      kind: "NODE_CAPABILITY_SNAPSHOT",
      nodeId: "node-a",
      hostId: unknown("host identity probe not configured"),
      capturedAt: AT,
      identity: { deviceType: "desktop", os: "win32", arch: "x64", runtimeVersion: "v24" },
      cpu: { logicalCores: measured(16, "node:os.cpus", AT), physicalCores: unknown("no physical-core probe"), model: measured("cpu", "node:os.cpus", AT), loadPercent: unknown("no load probe") },
      memory: { totalMb: measured(32768, "node:os.totalmem", AT), freeMb: measured(16384, "node:os.freemem", AT) },
      gpu: { devices: unknown("no gpu probe configured"), totalVramMb: unknown("no gpu probe configured") },
      disk: { freeMb: unknown("statfs unavailable"), totalMb: unknown("statfs unavailable") },
      network: { availability: unknown("no probe"), latencyMs: unknown("no probe"), quality: unknown("no probe") },
      load: { currentTasks: measured(0, "scheduler", AT), processPressure: unknown("not measured") },
      localModels: unknown("no local model inventory"),
      apis: unknown("no api inventory"),
      tools: unknown("no tool inventory"),
      plugins: unknown("no plugin inventory"),
      repo: { locality: unknown("no repository selected"), warmCacheHints: unknown("no cache probe") },
      trust: { trustClass: trust, executionRestrictions: ["no-owner-credentials"] }
    };
    expect(snapshot.gpu.devices.status).toBe("UNKNOWN");
    expect(snapshot.gpu.devices).not.toEqual(measured([gpu], "x", AT));
    expect(snapshot.trust.trustClass).toBe("TRUSTED_HOST");
    expect(quality).toBe("DIRECT");
  });

  it("builds a scheduling recommendation that can never claim routing authority", () => {
    const node: NodeRecommendation = { nodeId: "node-a", score: 0.8, reasons: ["memory"] };
    const model: ModelRecommendation = { modelKey: "p:f:1", score: 0.9, confidence: 0.6, reasons: ["coding"] };
    const factors: ReasoningFactor[] = [{ factor: "capability.coding", weight: 0.5, detail: "task needs coding", evidence: ["p:f:1"] }];
    const recommendation: SchedulingRecommendation = {
      schemaVersion: 1,
      kind: "SCHEDULING_RECOMMENDATION",
      recommendationId: "rec-1",
      taskId: "task-1",
      createdAt: AT,
      authority,
      preferredNode: node,
      preferredModel: model,
      preferredSkillLoadout: [],
      reasoningFactors: factors,
      confidence: 0.6,
      estimatedRisk: "low",
      blocked: [],
      productionRoutingAuthority: false,
      qualificationHostSelection: false
    };
    expect(recommendation.productionRoutingAuthority).toBe(false);
    expect(recommendation.qualificationHostSelection).toBe(false);
    expect(recommendation.estimatedCostUsd).toBeUndefined();
  });

  it("builds a shadow continuation assessment", () => {
    const signals: ContinuationSignals = {
      taskId: "task-1",
      modelKey: "p:f:1",
      progress: 0.4,
      outputNovelty: 0.2,
      unresolvedItems: 3,
      resolvedItems: 1,
      tokensConsumed: 12000,
      elapsedMs: 60000,
      repeatRate: 0.5,
      selfContradictions: 0,
      reviewerDisagreements: 0,
      reviewerReviews: 0,
      toolProgress,
      stepsCompleted: 4
    };
    const assessment: ContinuationAssessment = {
      schemaVersion: 1,
      kind: "CONTINUATION_ASSESSMENT",
      assessmentId: "cont-1",
      taskId: signals.taskId,
      modelKey: signals.modelKey,
      mode: "SHADOW_ONLY",
      decision: "CONTINUE",
      confidence: 0.5,
      factors: [],
      wouldActAtStep: 4,
      counterfactual: "following this advice would have continued",
      createdAt: AT
    };
    expect(assessment.mode).toBe("SHADOW_ONLY");
  });

  it("builds a context lifecycle plan that deletes nothing", () => {
    const record: ContextRecord = { id: "c1", kind: "transcript", tokens: 1200, lastUsedAt: AT, retrievalCount: 2, successContribution: 0.5, dependencyIds: [], confidence: 0.8 };
    const placement: ContextPlacement = { id: record.id, tier: "COLD", action: "COLD_STORE", score: 0.3, reasons: ["not recently used"], restorable: true };
    const plan: ContextLifecyclePlan = {
      schemaVersion: 1,
      kind: "CONTEXT_LIFECYCLE_PLAN",
      taskId: "task-1",
      createdAt: AT,
      authority,
      placements: [placement],
      injectedIds: [],
      candidateIds: [],
      archivedIds: [],
      projectedInjectedTokens: 0,
      deletesNothing: true
    };
    expect(plan.deletesNothing).toBe(true);
    expect(placement.restorable).toBe(true);
  });

  it("builds a runtime observation whose sections are all present", () => {
    const record: RuntimeObservation = {
      schemaVersion: 1,
      kind: "RUNTIME_OBSERVATION",
      observationId: "obs-1",
      traceId: "trace-1",
      task: { taskId: "task-1", role: "coder", taskKind },
      model: { modelKey: "p:f:1", provider: "p", family: "f", version: "1", basis, reasonRefs: [] },
      node: { nodeId: "node-a", basis, reasonRefs: [] },
      skills: { recommended: [], actual: [], used: [] },
      context: { injected: [], candidate: [], archived: [] },
      execution: { outcome: "UNKNOWN" },
      review: { agreement: "NOT_REVIEWED" },
      capabilityUpdate: { applied: false, dimensions: [], reason: "not applied" },
      createdAt: AT
    };
    expect(record.kind).toBe("RUNTIME_OBSERVATION");
  });
});
