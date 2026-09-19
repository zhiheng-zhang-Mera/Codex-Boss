import { describe, expect, it } from "vitest";
import {
  ADVISOR_WEIGHTS,
  SCHEDULING_ADVISOR_AUTHORITY,
  TASK_KIND_PRIMARY_DIMENSION,
  adviseScheduling,
  explainRecommendation,
  isAdvisoryOnly,
  parseNodeRequirements,
  type SchedulingInput
} from "../../../src/shared/runtime-intelligence/scheduling-advisor";
import { applyModelOutcome, createModelRecord } from "../../../src/shared/runtime-intelligence/model-ledger";
import { collectNodeSnapshot } from "../../../electron/runtime-intelligence/node-profiler";
import { measured } from "../../../src/shared/runtime-intelligence/measurement";
import type { ModelCapabilityRecord, SchedulingRecommendation, SkillCard, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase D. The advisor's two hard requirements are asserted structurally: every
 * recommendation is explainable and carries a fallback, and no recommendation can ever
 * carry routing or qualification authority.
 */

const AT = "2026-01-01T00:00:00.000Z";

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    taskId: "task-1",
    role: "coder",
    taskKind: "coding",
    requiredCapabilities: [],
    contextScale: "small",
    externalEffect: false,
    risk: "low",
    createdAt: AT,
    ...overrides
  };
}

function trainedModel(modelKey: string, family: string, successes: number, failures = 0): ModelCapabilityRecord {
  let record = createModelRecord({ provider: "vendor", family, version: "1", at: AT });
  for (let index = 0; index < successes; index += 1) {
    record = applyModelOutcome(record, {
      observationId: `${modelKey}-s${index}`,
      taskId: "task-1",
      nodeId: "node-a",
      role: "coder",
      taskKind: "coding",
      success: true,
      latencyMs: 900,
      expectedLatencyMs: 1000,
      costUsd: 0.01,
      expectedCostUsd: 0.02,
      at: AT
    }).record;
  }
  for (let index = 0; index < failures; index += 1) {
    record = applyModelOutcome(record, {
      observationId: `${modelKey}-f${index}`,
      taskId: "task-1",
      nodeId: "node-a",
      role: "coder",
      taskKind: "coding",
      success: false,
      failureClass: "TIMEOUT",
      latencyMs: 900,
      expectedLatencyMs: 1000,
      at: AT
    }).record;
  }
  return { ...record, modelKey };
}

function availableNode(nodeId: string, overrides: Parameters<typeof collectNodeSnapshot>[0]["probes"] = {}): ReturnType<typeof collectNodeSnapshot> {
  return collectNodeSnapshot({
    capturedAt: AT,
    nodeId,
    repoRoot: process.cwd(),
    trustClass: "TRUSTED_HOST",
    probes: { cpu: () => ({ logicalCores: 16, model: "cpu" }), memory: () => ({ totalMb: 32768, freeMb: 24000 }), currentTasks: () => 0, network: () => ({ availability: true, latencyMs: 20, quality: "DIRECT" }), ...overrides }
  });
}

describe("requirement tokens are a small grammar and unknown tokens stay visible", () => {
  it("parses every recognised token", () => {
    const parsed = parseNodeRequirements(["gpu", "cores:8", "memory:4096", "provider:openai", "local-model:llama", "tool:git"]);
    expect(parsed.requirement).toEqual({ requiresGpu: true, minLogicalCores: 8, minFreeMemoryMb: 4096, requiresProvider: "openai", requiresLocalModel: "llama", requiresTool: "git" });
    expect(parsed.unrecognised).toEqual([]);
  });

  it("reports a token it does not understand rather than treating it as satisfied", () => {
    const parsed = parseNodeRequirements(["gpu", "quantum", "cores:lots"]);
    expect(parsed.recognised).toEqual(["gpu"]);
    expect(parsed.unrecognised).toEqual(["quantum", "cores:lots"]);
  });
});

describe("the recommendation is explainable and always has a fallback when one exists", () => {
  const models = [trainedModel("m-strong", "gpt", 12), trainedModel("m-weak", "qwen", 12, 4)];
  const nodes = [availableNode("node-a"), availableNode("node-b")];

  it("prefers the model with the better measured capability and explains it", () => {
    const recommendation = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    expect(recommendation.preferredModel?.modelKey).toBe("m-strong");
    expect(recommendation.fallbackModel?.modelKey).toBe("m-weak");
    expect(recommendation.reasoningFactors.some((factor) => factor.factor === "capability.coding")).toBe(true);
    expect(recommendation.preferredModel?.reasons.join(" ")).toContain("coding estimate");
    expect(explainRecommendation(recommendation).length).toBeGreaterThan(0);
  });

  it("prefers a node it can justify and offers the other as a fallback", () => {
    const recommendation = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    expect(recommendation.preferredNode?.nodeId).toBe("node-a");
    expect(recommendation.fallbackNode?.nodeId).toBe("node-b");
    expect(recommendation.preferredNode?.reasons.length).toBeGreaterThan(0);
    expect(recommendation.preferredNode?.reasons.join(" ")).toContain("readiness READY");
  });

  it("names an id and a kind, so a recommendation can be cited later", () => {
    const recommendation = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    expect(recommendation.kind).toBe("SCHEDULING_RECOMMENDATION");
    expect(recommendation.recommendationId.startsWith("rec-")).toBe(true);
    expect(recommendation.taskId).toBe("task-1");
    expect(recommendation.schemaVersion).toBe(1);
  });

  it("is deterministic for the same inputs", () => {
    const first = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    const second = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    expect(first.recommendationId).toBe(second.recommendationId);
    expect(first.preferredModel).toEqual(second.preferredModel);
  });

  it("reports a lower confidence for a model that has never been measured", () => {
    const fresh = createModelRecord({ provider: "vendor", family: "brand-new", version: "1", at: AT });
    const recommendation = adviseScheduling({ task: task(), models: [fresh, ...models], nodes, createdAt: AT });
    const freshCandidate = recommendation.blocked.find((entry) => entry.candidateId === fresh.modelKey);
    // A new model is NOT blocked; it is simply not preferred until it has evidence.
    expect(freshCandidate).toBeUndefined();
    expect(recommendation.preferredModel?.modelKey).toBe("m-strong");
    expect(recommendation.confidence).toBeGreaterThan(0);
  });
});

describe("no recommendation can carry executive authority", () => {
  const models = [trainedModel("m", "gpt", 8)];
  const nodes = [availableNode("node-a")];

  it("declares ADVISORY_ONLY and both authority flags false", () => {
    const recommendation: SchedulingRecommendation = adviseScheduling({ task: task(), models, nodes, createdAt: AT });
    expect(recommendation.authority).toBe(SCHEDULING_ADVISOR_AUTHORITY);
    expect(recommendation.productionRoutingAuthority).toBe(false);
    expect(recommendation.qualificationHostSelection).toBe(false);
    expect(isAdvisoryOnly(recommendation)).toBe(true);
  });

  it("still returns advise-only when there are no candidates at all", () => {
    const recommendation = adviseScheduling({ task: task(), models: [], nodes: [], createdAt: AT });
    expect(isAdvisoryOnly(recommendation)).toBe(true);
    expect(recommendation.preferredModel).toBeUndefined();
    expect(recommendation.preferredNode).toBeUndefined();
    expect(recommendation.estimatedRisk).toBe("unknown");
    expect(recommendation.confidence).toBe(0);
  });

  it("cannot be turned advisory by a pinned or excluded candidate", () => {
    const pinned = adviseScheduling({ task: task(), models, nodes, createdAt: AT, pinnedModel: "m", pinnedNode: "node-a" });
    expect(isAdvisoryOnly(pinned)).toBe(true);
    expect(pinned.reasoningFactors.some((factor) => factor.factor === "model.pinned")).toBe(true);
    expect(pinned.reasoningFactors.some((factor) => factor.factor === "node.pinned")).toBe(true);
    const excluded = adviseScheduling({ task: task(), models, nodes, createdAt: AT, excludedNodes: [{ nodeId: "node-a", reason: "reserved" }] });
    expect(isAdvisoryOnly(excluded)).toBe(true);
    expect(excluded.preferredNode).toBeUndefined();
    expect(excluded.blocked[0].reason).toContain("reserved");
  });

  it("names an unknown pin instead of silently ignoring it", () => {
    const recommendation = adviseScheduling({ task: task(), models, nodes, createdAt: AT, pinnedModel: "does-not-exist", pinnedNode: "does-not-exist" });
    expect(recommendation.blocked.map((entry) => entry.reason).join(" ")).toContain("pinned model is not a known candidate");
    expect(recommendation.blocked.map((entry) => entry.reason).join(" ")).toContain("pinned node is not an eligible candidate");
  });
});

describe("an unusable candidate is blocked with a reason, not scored low", () => {
  const models = [trainedModel("m", "gpt", 6)];

  it("blocks a node whose readiness could not be established", () => {
    const unknownNode = collectNodeSnapshot({ capturedAt: AT, nodeId: "node-unknown", probes: { cpu: () => { throw new Error("cpu probe failed"); } } });
    const recommendation = adviseScheduling({ task: task(), models, nodes: [unknownNode], createdAt: AT });
    expect(recommendation.preferredNode).toBeUndefined();
    expect(recommendation.blocked.find((entry) => entry.candidateId === "node-unknown")?.reason).toContain("could not be decided");
    expect(recommendation.estimatedRisk).toBe("unknown");
  });

  it("blocks a GPU task when the GPU inventory is unknown, and says it is undecidable", () => {
    const recommendation = adviseScheduling({ task: task({ requiredCapabilities: ["gpu"] }), models, nodes: [availableNode("node-a")], createdAt: AT });
    expect(recommendation.preferredNode).toBeUndefined();
    expect(recommendation.blocked[0].reason).toContain("requiresGpu");
    expect(recommendation.blocked[0].reason).toContain("cannot be decided");
  });

  it("admits a GPU node once a probe reported one", () => {
    const withGpu = availableNode("node-a", { gpu: () => [{ name: "gpu", vramMb: 8192 }] });
    const recommendation = adviseScheduling({ task: task({ requiredCapabilities: ["gpu"] }), models, nodes: [withGpu], createdAt: AT });
    expect(recommendation.preferredNode?.nodeId).toBe("node-a");
  });

  it("blocks a node that misses a measured memory requirement", () => {
    const small = availableNode("node-small", { memory: () => ({ totalMb: 4096, freeMb: 1024 }) });
    const recommendation = adviseScheduling({ task: task({ requiredCapabilities: ["memory:8192"] }), models, nodes: [small], createdAt: AT });
    expect(recommendation.preferredNode).toBeUndefined();
    expect(recommendation.blocked[0].reason).toContain("the requirement is not met");
  });

  it("reports an unrecognised requirement token as not satisfied", () => {
    const recommendation = adviseScheduling({ task: task({ requiredCapabilities: ["quantum"] }), models, nodes: [availableNode("node-a")], createdAt: AT });
    const factor = recommendation.reasoningFactors.find((entry) => entry.factor === "node.requirements.unrecognised");
    expect(factor?.detail).toContain("were NOT treated as satisfied");
    expect(factor?.evidence).toEqual(["quantum"]);
  });
});

describe("estimates and risk are honest about what was measured", () => {
  it("leaves cost and latency absent rather than zero when nothing measured them", () => {
    const fresh = createModelRecord({ provider: "vendor", family: "brand-new", at: AT });
    const recommendation = adviseScheduling({ task: task(), models: [fresh], nodes: [availableNode("node-a")], createdAt: AT });
    expect(recommendation.estimatedCostUsd).toBeUndefined();
    expect(recommendation.estimatedLatencyMs).toBeUndefined();
  });

  it("reports measured cost and latency when the ledger has them", () => {
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 5)], nodes: [availableNode("node-a")], createdAt: AT });
    expect(recommendation.estimatedLatencyMs).toBe(900);
    expect(recommendation.estimatedCostUsd).toBeCloseTo(0.01, 6);
  });

  it("raises the risk for an externally-effectful task on weak evidence", () => {
    const fresh = createModelRecord({ provider: "vendor", family: "brand-new", at: AT });
    const recommendation = adviseScheduling({ task: task({ externalEffect: true, risk: "high" }), models: [fresh], nodes: [availableNode("node-a")], createdAt: AT });
    expect(recommendation.estimatedRisk).toBe("high");
  });

  it("reports low risk for a measured, locally-scoped task", () => {
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 12)], nodes: [availableNode("node-a")], createdAt: AT });
    expect(recommendation.estimatedRisk).toBe("low");
  });

  it("derives a context tier hint from the declared context scale", () => {
    const small = adviseScheduling({ task: task({ contextScale: "small" }), models: [], nodes: [], createdAt: AT });
    const large = adviseScheduling({ task: task({ contextScale: "large" }), models: [], nodes: [], createdAt: AT });
    expect(small.contextTierHint).toBe("WARM");
    expect(large.contextTierHint).toBe("HOT");
  });

  it("judges each task kind on its own primary dimension", () => {
    expect(TASK_KIND_PRIMARY_DIMENSION.coding).toBe("coding");
    expect(TASK_KIND_PRIMARY_DIMENSION.review).toBe("review");
    expect(TASK_KIND_PRIMARY_DIMENSION.synthesis).toBe("reasoning");
    expect(ADVISOR_WEIGHTS.confidenceFloor).toBeGreaterThan(0);
  });
});

describe("the loadout rides along with the recommendation", () => {
  const cards: SkillCard[] = [{ schemaVersion: 1, skillId: "skill-a", name: "a", providesCapabilities: ["coding"], contextTokens: 400, baseLatencyMs: 50, tags: [] }];

  it("includes the recommended loadout and the skills it omitted", () => {
    const input: SchedulingInput = { task: task({ requiredCapabilities: ["coding"] }), models: [trainedModel("m", "gpt", 6)], nodes: [availableNode("node-a")], skillCards: cards, createdAt: AT };
    const recommendation = adviseScheduling(input);
    expect(recommendation.preferredSkillLoadout).toEqual(["skill-a"]);
  });

  it("recommends no skill when the task declares no capability", () => {
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 6)], nodes: [availableNode("node-a")], skillCards: cards, createdAt: AT });
    expect(recommendation.preferredSkillLoadout).toEqual([]);
  });
});

describe("a node with an unknown optional metric is still recommendable, and says so", () => {
  it("recommends a node whose GPU is unknown for a task that does not need one", () => {
    const node = availableNode("node-a");
    expect(node.gpu.devices.status).toBe("NOT_MEASURED");
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 6)], nodes: [node], createdAt: AT });
    expect(recommendation.preferredNode?.nodeId).toBe("node-a");
    expect(recommendation.preferredNode?.reasons.join(" ")).toContain("readiness READY");
  });

  it("reports a measured node far ahead of an unknown one", () => {
    const unknown = collectNodeSnapshot({ capturedAt: AT, nodeId: "node-unknown", probes: { memory: () => { throw new Error("no memory probe"); } } });
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 6)], nodes: [unknown, availableNode("node-a")], createdAt: AT });
    expect(recommendation.preferredNode?.nodeId).toBe("node-a");
    expect(recommendation.blocked.some((entry) => entry.candidateId === "node-unknown")).toBe(true);
  });

  it("keeps a metric-origin fact rather than a boolean in the node reasons", () => {
    const node = availableNode("node-a", { memory: () => ({ totalMb: 32768, freeMb: 16384 }) });
    expect(measured(1, "x", AT).status).toBe("MEASURED");
    const recommendation = adviseScheduling({ task: task(), models: [trainedModel("m", "gpt", 6)], nodes: [node], createdAt: AT });
    expect(recommendation.preferredNode?.reasons.join(" ")).toContain("16384 of 32768 MB free");
  });
});
