/**
 * Runtime Intelligence Plane — the scheduling advisor.
 *
 * This module answers "which model, on which machine, with which skills" and nothing
 * else. It has no production routing authority and cannot acquire any: the two fields
 * that would matter, `productionRoutingAuthority` and `qualificationHostSelection`, are
 * literal `false` in the type, so a consumer that needs to route real work has to change
 * the type deliberately rather than discover a truthy field at runtime.
 *
 * The rest of the honesty is in the absences. A node whose readiness could not be
 * established is not ranked last-with-a-low-score, it is reported in `blocked` with the
 * reason "cannot be decided", because a low score would look like a measurement. A cost
 * or latency estimate appears only when the ledger actually measured one — never as 0.
 *
 * Requirement tokens are a deliberately small grammar, and an unrecognised token is
 * reported rather than ignored: silently dropping `requires: ["gpu"]` is how a task ends
 * up scheduled onto a machine with no GPU.
 */

import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  stableId,
  type AdvisoryAuthority,
  type ModelCapabilityDimension,
  type ModelCapabilityRecord,
  type NodeCapabilitySnapshot,
  type ReasoningFactor,
  type SchedulingRecommendation,
  type SkillCard,
  type SkillHealthSummary,
  type TaskKind,
  type TaskProfile,
  type ContextTier
} from "./contracts";
import { usableCapability } from "./model-ledger";
import { nodeCapacityFor, nodeReadiness, type NodeRequirement } from "./node-profile";
import { recommendLoadout } from "./skill-loadout";

/** The one authority this advisor carries. */
export const SCHEDULING_ADVISOR_AUTHORITY: AdvisoryAuthority = "ADVISORY_ONLY";

/** Which capability dimension a task kind is judged on. */
export const TASK_KIND_PRIMARY_DIMENSION: Readonly<Record<TaskKind, ModelCapabilityDimension>> = {
  coding: "coding",
  reasoning: "reasoning",
  planning: "planning",
  review: "review",
  research: "research",
  synthesis: "reasoning",
  computer_use: "computer_use",
  other: "reliability"
};

/**
 * Weights that turn a capability estimate into a comparable utility.
 *
 * `confidenceFloor` is the important one: a warm-started estimate is halved rather than
 * excluded, so a brand-new model can still be chosen and can still earn evidence. Without
 * it, a model with no history would never run and so would never accumulate history.
 */
export const ADVISOR_WEIGHTS = {
  confidenceFloor: 0.5,
  latencyPreference: 0.1,
  costPreference: 0.1,
  localityBonus: 0.1,
  loadPenalty: 0.2,
  taskLoadPenalty: 0.1
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Parses the small requirement-token grammar out of a task's declared capabilities.
 *
 * Recognised: `gpu`, `cores:<n>`, `memory:<mb>`, `provider:<id>`, `local-model:<id>`,
 * `tool:<name>`. Everything else is returned in `unrecognised`, so a token nobody
 * understands is visible in the recommendation instead of being quietly dropped.
 */
export function parseNodeRequirements(tokens: readonly string[]): { requirement: NodeRequirement; recognised: string[]; unrecognised: string[] } {
  const requirement: NodeRequirement = {};
  const recognised: string[] = [];
  const unrecognised: string[] = [];
  for (const token of tokens) {
    const value = token.trim();
    if (value === "gpu") {
      requirement.requiresGpu = true;
      recognised.push(value);
      continue;
    }
    const [prefix, argument] = value.split(":");
    const numeric = Number(argument);
    if (prefix === "cores" && Number.isFinite(numeric) && numeric > 0) {
      requirement.minLogicalCores = numeric;
      recognised.push(value);
    } else if (prefix === "memory" && Number.isFinite(numeric) && numeric > 0) {
      requirement.minFreeMemoryMb = numeric;
      recognised.push(value);
    } else if (prefix === "provider" && argument) {
      requirement.requiresProvider = argument;
      recognised.push(value);
    } else if (prefix === "local-model" && argument) {
      requirement.requiresLocalModel = argument;
      recognised.push(value);
    } else if (prefix === "tool" && argument) {
      requirement.requiresTool = argument;
      recognised.push(value);
    } else {
      unrecognised.push(value);
    }
  }
  return { requirement, recognised, unrecognised };
}

export interface SchedulingInput {
  task: TaskProfile;
  models: readonly ModelCapabilityRecord[];
  nodes: readonly NodeCapabilitySnapshot[];
  skillCards?: readonly SkillCard[];
  skillSummaries?: readonly SkillHealthSummary[];
  /** Models the operator excluded, with the reason they gave. */
  excludedModels?: ReadonlyArray<{ modelKey: string; reason: string }>;
  excludedNodes?: ReadonlyArray<{ nodeId: string; reason: string }>;
  pinnedModel?: string;
  pinnedNode?: string;
  /** A budget the caller wants honoured; only used to weigh latency/cost, never to promise them. */
  expectedLatencyMs?: number;
  expectedCostUsd?: number;
  createdAt: string;
  /** Discriminates two recommendations for the same task. */
  sequence?: number;
}

function scoreNode(snapshot: NodeCapabilitySnapshot): { score: number; reasons: string[] } {
  const readiness = nodeReadiness(snapshot);
  const reasons: string[] = [];
  const base = readiness.readiness === "READY" ? 1 : readiness.readiness === "DEGRADED" ? 0.4 : 0;
  reasons.push(`readiness ${readiness.readiness}: ${readiness.reasons.join("; ")}`);
  let score = base;
  const total = snapshot.memory.totalMb;
  const free = snapshot.memory.freeMb;
  if (total.status === "MEASURED" && free.status === "MEASURED" && total.value > 0) {
    score += 0.2 * clamp01(free.value / total.value);
    reasons.push(`${free.value} of ${total.value} MB free`);
  } else {
    reasons.push("memory headroom is unknown, so no headroom bonus was applied");
  }
  if (snapshot.repo.locality.status === "MEASURED" && snapshot.repo.locality.value === "LOCAL") {
    score += ADVISOR_WEIGHTS.localityBonus;
    reasons.push("the repository is local to this node");
  }
  const pressure = snapshot.load.processPressure;
  if (pressure.status === "MEASURED") {
    score -= ADVISOR_WEIGHTS.loadPenalty * clamp01(pressure.value);
    reasons.push(`memory pressure ${pressure.value.toFixed(2)}`);
  }
  const tasks = snapshot.load.currentTasks;
  if (tasks.status === "MEASURED" && tasks.value > 0) {
    score -= ADVISOR_WEIGHTS.taskLoadPenalty;
    reasons.push(`${tasks.value} task(s) already running`);
  }
  return { score: clamp01(score), reasons };
}

/**
 * Produces a recommendation. Pure: the caller supplies the clock and the candidate facts.
 *
 * Everything the caller needs to disagree with the advice is in `reasoningFactors` and
 * `blocked`. A recommendation with no eligible node still returns, with
 * `estimatedRisk: "unknown"` and the reasons every candidate was refused.
 */
export function adviseScheduling(input: SchedulingInput): SchedulingRecommendation {
  const factors: ReasoningFactor[] = [];
  const blocked: Array<{ candidateId: string; reason: string }> = [];
  const primaryDimension = TASK_KIND_PRIMARY_DIMENSION[input.task.taskKind] ?? "reliability";

  /* ---------------------------------------------------------------- models */
  const excludedModels = new Map((input.excludedModels ?? []).map((entry) => [entry.modelKey, entry.reason]));
  const modelCandidates = input.models
    .map((record) => {
      const estimate = record.scores[primaryDimension];
      const usability = usableCapability({ record, dimension: primaryDimension });
      const utility = estimate.score * (ADVISOR_WEIGHTS.confidenceFloor + (1 - ADVISOR_WEIGHTS.confidenceFloor) * estimate.confidence);
      const latencyScore = record.latency.samples > 0 ? record.scores.latency.score : undefined;
      const costScore = record.cost.samples > 0 ? record.scores.cost.score : undefined;
      const weighted =
        utility +
        (latencyScore === undefined ? 0 : ADVISOR_WEIGHTS.latencyPreference * (latencyScore - 0.5)) +
        (costScore === undefined ? 0 : ADVISOR_WEIGHTS.costPreference * (costScore - 0.5));
      const reasons: string[] = [
        `${primaryDimension} estimate ${estimate.score.toFixed(3)} with ${estimate.samples} sample(s)`,
        usability.reason
      ];
      if (latencyScore !== undefined) reasons.push(`latency score ${latencyScore.toFixed(3)} from ${record.latency.samples} measurement(s)`);
      else reasons.push("no latency measurement, so no latency adjustment was applied");
      if (costScore !== undefined) reasons.push(`cost score ${costScore.toFixed(3)} from ${record.cost.samples} measurement(s)`);
      else reasons.push("no cost measurement, so no cost adjustment was applied");
      if (record.warmStarted) reasons.push("still warm-started on at least one dimension; its estimate is prior-dominated where it is unmeasured");
      return { record, estimate, usability, score: clamp01(weighted), reasons };
    })
    .sort((left, right) => (right.score === left.score ? left.record.modelKey.localeCompare(right.record.modelKey) : right.score - left.score));

  const eligibleModels = modelCandidates.filter((candidate) => {
    const exclusion = excludedModels.get(candidate.record.modelKey);
    if (exclusion !== undefined) {
      blocked.push({ candidateId: candidate.record.modelKey, reason: `excluded by the operator: ${exclusion}` });
      return false;
    }
    return true;
  });

  const pinnedModel = input.pinnedModel === undefined ? undefined : eligibleModels.find((candidate) => candidate.record.modelKey === input.pinnedModel);
  if (input.pinnedModel !== undefined && pinnedModel === undefined) {
    blocked.push({ candidateId: input.pinnedModel, reason: "pinned model is not a known candidate" });
  }
  const rankedModels = pinnedModel ? [pinnedModel, ...eligibleModels.filter((candidate) => candidate !== pinnedModel)] : eligibleModels;
  const preferredModel = rankedModels[0];
  const fallbackModel = rankedModels[1];

  if (preferredModel) {
    factors.push({
      factor: `capability.${primaryDimension}`,
      weight: round(preferredModel.estimate.score),
      detail: `task kind ${input.task.taskKind} is judged on ${primaryDimension}`,
      evidence: [preferredModel.record.modelKey, `${preferredModel.estimate.samples} sample(s)`]
    });
    if (pinnedModel) factors.push({ factor: "model.pinned", weight: 1, detail: `${preferredModel.record.modelKey} is pinned by the operator`, evidence: [preferredModel.record.modelKey] });
  } else {
    factors.push({ factor: "model.none", weight: 0, detail: "no model candidate was supplied, so no model could be recommended", evidence: [] });
  }

  /* ----------------------------------------------------------------- nodes */
  const parsed = parseNodeRequirements(input.task.requiredCapabilities);
  if (parsed.recognised.length > 0) {
    factors.push({ factor: "node.requirements", weight: parsed.recognised.length, detail: `recognised requirement tokens: ${parsed.recognised.join(", ")}`, evidence: parsed.recognised });
  }
  if (parsed.unrecognised.length > 0) {
    factors.push({
      factor: "node.requirements.unrecognised",
      weight: parsed.unrecognised.length,
      detail: `these tokens name no requirement this advisor understands and were NOT treated as satisfied: ${parsed.unrecognised.join(", ")}`,
      evidence: parsed.unrecognised
    });
  }

  const excludedNodes = new Map((input.excludedNodes ?? []).map((entry) => [entry.nodeId, entry.reason]));
  const nodeCandidates = input.nodes
    .map((snapshot) => {
      const capacity = nodeCapacityFor(snapshot, parsed.requirement);
      const scored = scoreNode(snapshot);
      return { snapshot, capacity, score: scored.score, reasons: [...capacity.reasons, ...scored.reasons] };
    })
    .sort((left, right) => (right.score === left.score ? left.snapshot.nodeId.localeCompare(right.snapshot.nodeId) : right.score - left.score));

  const eligibleNodes = nodeCandidates.filter((candidate) => {
    const exclusion = excludedNodes.get(candidate.snapshot.nodeId);
    if (exclusion !== undefined) {
      blocked.push({ candidateId: candidate.snapshot.nodeId, reason: `excluded by the operator: ${exclusion}` });
      return false;
    }
    // A node whose readiness could not be established is NOT ranked last with a low
    // score: a score would look like a measurement. It is blocked with the reason its
    // core facts are missing, which is a different claim from "this node is unsuitable".
    const readiness = nodeReadiness(candidate.snapshot);
    if (readiness.readiness === "UNKNOWN") {
      blocked.push({ candidateId: candidate.snapshot.nodeId, reason: `readiness could not be decided: ${readiness.reasons.join("; ")}` });
      return false;
    }
    if (!candidate.capacity.satisfied) {
      blocked.push({ candidateId: candidate.snapshot.nodeId, reason: candidate.capacity.reasons.filter((reason) => !reason.includes(": satisfied")).join("; ") });
      return false;
    }
    return true;
  });

  const pinnedNode = input.pinnedNode === undefined ? undefined : eligibleNodes.find((candidate) => candidate.snapshot.nodeId === input.pinnedNode);
  if (input.pinnedNode !== undefined && pinnedNode === undefined) {
    blocked.push({ candidateId: input.pinnedNode, reason: "pinned node is not an eligible candidate" });
  }
  const rankedNodes = pinnedNode ? [pinnedNode, ...eligibleNodes.filter((candidate) => candidate !== pinnedNode)] : eligibleNodes;
  const preferredNode = rankedNodes[0];
  const fallbackNode = rankedNodes[1];

  if (preferredNode) {
    factors.push({
      factor: "node.capacity",
      weight: round(preferredNode.score),
      detail: `node ${preferredNode.snapshot.nodeId} satisfies every recognised requirement`,
      evidence: preferredNode.snapshot.nodeId ? [preferredNode.snapshot.nodeId] : []
    });
    if (pinnedNode) factors.push({ factor: "node.pinned", weight: 1, detail: `${preferredNode.snapshot.nodeId} is pinned by the operator`, evidence: [preferredNode.snapshot.nodeId] });
  } else {
    factors.push({ factor: "node.none", weight: 0, detail: "no node satisfied the recognised requirements; every candidate is in `blocked` with its reason", evidence: [] });
  }

  /* ---------------------------------------------------------------- skills */
  const loadout = recommendLoadout({
    task: input.task,
    cards: input.skillCards ?? [],
    summaries: input.skillSummaries ?? []
  });
  factors.push(...loadout.factors);

  /* --------------------------------------------------------------- summary */
  const modelConfidence = preferredModel?.usability.confidence ?? 0;
  const confidence = clamp01(modelConfidence * (preferredNode ? 1 : 0.4));

  const latencyEstimates = [preferredModel?.record.latency.meanMs, input.expectedLatencyMs].filter((value): value is number => typeof value === "number" && value > 0);
  const costEstimates = [preferredModel?.record.cost.meanUsd, input.expectedCostUsd].filter((value): value is number => typeof value === "number" && value > 0);

  const estimatedRisk: SchedulingRecommendation["estimatedRisk"] = !preferredModel || !preferredNode
    ? "unknown"
    : taskNeedsReview(input.task, confidence)
      ? "high"
      : input.task.risk === "high"
        ? "high"
        : input.task.risk === "medium" || confidence < 0.5
          ? "medium"
          : "low";

  const contextTierHint: ContextTier = input.task.contextScale === "small" ? "WARM" : "HOT";

  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "SCHEDULING_RECOMMENDATION",
    recommendationId: stableId("rec", [input.task.taskId, input.sequence ?? 0, preferredModel?.record.modelKey ?? "none", preferredNode?.snapshot.nodeId ?? "none"]),
    taskId: input.task.taskId,
    createdAt: input.createdAt,
    authority: SCHEDULING_ADVISOR_AUTHORITY,
    ...(preferredNode ? { preferredNode: { nodeId: preferredNode.snapshot.nodeId, score: round(preferredNode.score), reasons: preferredNode.reasons } } : {}),
    ...(fallbackNode ? { fallbackNode: { nodeId: fallbackNode.snapshot.nodeId, score: round(fallbackNode.score), reasons: fallbackNode.reasons } } : {}),
    ...(preferredModel
      ? {
          preferredModel: {
            modelKey: preferredModel.record.modelKey,
            score: round(preferredModel.score),
            confidence: round(preferredModel.usability.confidence),
            reasons: preferredModel.reasons
          }
        }
      : {}),
    ...(fallbackModel
      ? {
          fallbackModel: {
            modelKey: fallbackModel.record.modelKey,
            score: round(fallbackModel.score),
            confidence: round(fallbackModel.usability.confidence),
            reasons: fallbackModel.reasons
          }
        }
      : {}),
    preferredSkillLoadout: loadout.mountedSkillIds,
    contextTierHint,
    reasoningFactors: factors,
    confidence: round(confidence),
    ...(costEstimates.length > 0 ? { estimatedCostUsd: Math.max(...costEstimates) } : {}),
    ...(latencyEstimates.length > 0 ? { estimatedLatencyMs: Math.max(...latencyEstimates) } : {}),
    estimatedRisk,
    blocked,
    productionRoutingAuthority: false,
    qualificationHostSelection: false
  };
}

/** A task whose effects leave Boss, or whose advice is weakly supported, needs a review. */
function taskNeedsReview(task: TaskProfile, confidence: number): boolean {
  return (task.externalEffect || task.risk === "high") && confidence < 0.5;
}

/**
 * True only for a recommendation that claims no executive authority.
 *
 * A consumer may branch on this; a consumer that wants to route production work cannot
 * satisfy it, which is the point.
 */
export function isAdvisoryOnly(recommendation: SchedulingRecommendation): boolean {
  return (
    recommendation.authority === "ADVISORY_ONLY" &&
    recommendation.productionRoutingAuthority === false &&
    recommendation.qualificationHostSelection === false
  );
}

/**
 * The reasons a recommendation exists, as text. Used by reports and by the explainability
 * test; it never adds a reason the recommendation did not carry.
 */
export function explainRecommendation(recommendation: SchedulingRecommendation): string[] {
  const lines = recommendation.reasoningFactors.map((factor) => `${factor.factor} (weight ${factor.weight}): ${factor.detail}`);
  for (const entry of recommendation.blocked) lines.push(`blocked ${entry.candidateId}: ${entry.reason}`);
  if (recommendation.preferredModel === undefined) lines.push("no model was recommended");
  if (recommendation.preferredNode === undefined) lines.push("no node was recommended");
  return lines;
}
