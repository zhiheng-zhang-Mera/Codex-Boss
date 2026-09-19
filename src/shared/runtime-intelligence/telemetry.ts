/**
 * Runtime Intelligence Plane — the unified observation record and its explanation.
 *
 * `RuntimeObservation` is the join the repository did not have: one record that carries
 * the task, the model that ran it, the node it ran on, the skills and context that were
 * loaded, the outcome, the review verdict, and whether the capability ledger was updated
 * as a result. Before this, those facts lived in six stores keyed by six id families and
 * nothing could answer "why was it this model on this machine".
 *
 * `explainObservation` is the read side, and it is deliberately textual: the plan's
 * acceptance asks a human question ("why this model?") and the answer is what a report
 * shows. It never invents a reason — a missing recommendation produces "no recommendation
 * was recorded" rather than a plausible-sounding one, which is the same fail-closed rule
 * the measurement primitive applies to numbers.
 */

import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  stableId,
  type ContinuationAssessment,
  type RuntimeObservation,
  type SchedulingRecommendation,
  type TaskKind,
  type TaskProfile
} from "./contracts";

/** One trace per task: every step of a task shares it, so a trace is a task's history. */
export function traceIdFor(taskId: string): string {
  return stableId("trace", [taskId]);
}

/** Deterministic observation id from the facts that identify a single run. */
export function observationIdFor(input: { taskId: string; modelKey: string; nodeId: string; sequence: number }): string {
  return stableId("obs", [input.taskId, input.modelKey, input.nodeId, input.sequence]);
}

export interface ObservationInput {
  observationId: string;
  traceId: string;
  task: Pick<TaskProfile, "taskId" | "role" | "taskKind"> | TaskProfile;
  model: { modelKey: string; provider: string; family: string; version?: string; basis?: RuntimeObservation["model"]["basis"]; reasonRefs?: string[] };
  node: { nodeId: string; basis?: RuntimeObservation["node"]["basis"]; reasonRefs?: string[] };
  skills?: Partial<RuntimeObservation["skills"]>;
  context?: Partial<RuntimeObservation["context"]>;
  execution?: Partial<RuntimeObservation["execution"]>;
  review?: Partial<RuntimeObservation["review"]>;
  continuation?: RuntimeObservation["continuation"];
  capabilityUpdate?: Partial<RuntimeObservation["capabilityUpdate"]>;
  createdAt: string;
}

/**
 * Builds the record. Defaults are honest rather than flattering: an unknown outcome stays
 * `UNKNOWN`, an unreviewed run stays `NOT_REVIEWED`, and an unapplied capability update
 * says so with a reason instead of leaving the field out.
 */
export function createObservation(input: ObservationInput): RuntimeObservation {
  const taskKind: TaskKind = (input.task as TaskProfile).taskKind ?? "other";
  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "RUNTIME_OBSERVATION",
    observationId: input.observationId,
    traceId: input.traceId,
    task: { taskId: input.task.taskId, role: input.task.role, taskKind },
    model: {
      modelKey: input.model.modelKey,
      provider: input.model.provider,
      family: input.model.family,
      version: input.model.version ?? "unknown",
      basis: input.model.basis ?? "UNKNOWN",
      reasonRefs: [...(input.model.reasonRefs ?? [])]
    },
    node: { nodeId: input.node.nodeId, basis: input.node.basis ?? "UNKNOWN", reasonRefs: [...(input.node.reasonRefs ?? [])] },
    skills: {
      recommended: [...(input.skills?.recommended ?? [])],
      actual: [...(input.skills?.actual ?? [])],
      used: [...(input.skills?.used ?? [])]
    },
    context: {
      injected: [...(input.context?.injected ?? [])],
      candidate: [...(input.context?.candidate ?? [])],
      archived: [...(input.context?.archived ?? [])]
    },
    execution: {
      outcome: input.execution?.outcome ?? "UNKNOWN",
      ...(input.execution?.failureClass === undefined ? {} : { failureClass: input.execution.failureClass }),
      ...(input.execution?.latencyMs === undefined ? {} : { latencyMs: input.execution.latencyMs }),
      ...(input.execution?.tokens === undefined ? {} : { tokens: input.execution.tokens }),
      ...(input.execution?.costUsd === undefined ? {} : { costUsd: input.execution.costUsd })
    },
    review: {
      agreement: input.review?.agreement ?? "NOT_REVIEWED",
      ...(input.review?.reviewerId === undefined ? {} : { reviewerId: input.review.reviewerId }),
      ...(input.review?.notes === undefined ? {} : { notes: input.review.notes })
    },
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    capabilityUpdate: {
      applied: input.capabilityUpdate?.applied ?? false,
      dimensions: [...(input.capabilityUpdate?.dimensions ?? [])],
      reason: input.capabilityUpdate?.reason ?? "no capability update was recorded"
    },
    createdAt: input.createdAt
  };
}

/** True when the skills a task was recommended actually ran. */
export function loadoutWasFollowed(observation: RuntimeObservation): boolean {
  const recommended = [...observation.skills.recommended].sort();
  const actual = [...observation.skills.actual].sort();
  return recommended.length === actual.length && recommended.every((skillId, index) => skillId === actual[index]);
}

/** Skills that were mounted but never invoked — the measurable waste this plane exists to find. */
export function unusedMountedSkills(observation: RuntimeObservation): string[] {
  const used = new Set(observation.skills.used);
  return observation.skills.actual.filter((skillId) => !used.has(skillId));
}

export interface ObservationExplanation {
  observationId: string;
  whyThisModel: string;
  whyThisNode: string;
  whyTheseSkills: string;
  whyNotOtherSkills: string;
  whyThisContext: string;
  continuationAdvice: string;
  decisionOutcome: DecisionOutcomeVerdict;
  evidence: string[];
}

export type DecisionOutcomeVerdict =
  | "SUPPORTED_BY_OUTCOME"
  | "CONTRADICTED_BY_OUTCOME"
  | "NOT_FOLLOWED"
  | "INCONCLUSIVE_NO_OUTCOME"
  | "NO_ADVICE_RECORDED";

/**
 * Judges a recorded decision against what happened.
 *
 * The distinction between "no advice was recorded" and "the advice was inconclusive" is
 * the point: a run with no recommendation is not evidence for or against the plane, and
 * counting it either way would let an empty log look like a good record.
 */
export function judgeDecisionOutcome(observation: RuntimeObservation): DecisionOutcomeVerdict {
  const basis = observation.model.basis;
  if (basis === "UNKNOWN") return "NO_ADVICE_RECORDED";
  if (observation.execution.outcome === "UNKNOWN") return "INCONCLUSIVE_NO_OUTCOME";
  if (basis === "FALLBACK") return "NOT_FOLLOWED";
  return observation.execution.outcome === "SUCCESS" ? "SUPPORTED_BY_OUTCOME" : "CONTRADICTED_BY_OUTCOME";
}

export interface ExplanationInput {
  observation: RuntimeObservation;
  /** The advice this run was supposed to follow, when one was recorded. */
  recommendation?: SchedulingRecommendation;
  /** The shadow continuation opinion, when one was recorded. */
  continuation?: ContinuationAssessment;
  /** Reasons the run deviated from advice (an override, a failure, a pin). */
  deviations?: string[];
}

/**
 * Answers the operator's questions from the record alone.
 *
 * Absent inputs are stated as absent. `whyThisModel` reads the recommendation's own
 * factors when one exists and says "no scheduling recommendation was recorded for this
 * run" otherwise, so the explanation can never claim more provenance than the record has.
 */
export function explainObservation(input: ExplanationInput): ObservationExplanation {
  const { observation, recommendation, continuation } = input;
  const evidence: string[] = [];
  const factors = recommendation?.reasoningFactors ?? [];
  const factorText = factors.map((factor) => `${factor.factor}=${factor.weight.toFixed(2)} (${factor.detail})`).join("; ");

  const whyThisModel = recommendation?.preferredModel
    ? `recommended ${recommendation.preferredModel.modelKey} with score ${recommendation.preferredModel.score.toFixed(3)}; ${recommendation.preferredModel.reasons.join("; ") || "no reasons recorded"}`
    : `no scheduling recommendation was recorded for this run; the model ${observation.model.modelKey} is recorded as ${observation.model.basis}`;

  const whyThisNode = recommendation?.preferredNode
    ? `recommended node ${recommendation.preferredNode.nodeId} with score ${recommendation.preferredNode.score.toFixed(3)}; ${recommendation.preferredNode.reasons.join("; ") || "no reasons recorded"}`
    : `no node recommendation was recorded for this run; node ${observation.node.nodeId} is recorded as ${observation.node.basis}`;

  const unused = unusedMountedSkills(observation);
  const whyTheseSkills = observation.skills.actual.length
    ? `mounted ${observation.skills.actual.join(", ")}; invoked ${observation.skills.used.join(", ") || "none"}`
    : "no skills were mounted for this run";
  const whyNotOtherSkills = unused.length
    ? `mounted but never invoked: ${unused.join(", ")} — this is wasted mounting, not evidence that the skill is useless`
    : "every mounted skill was invoked";

  const whyThisContext = `injected ${observation.context.injected.length} record(s)${observation.context.injected.length ? `: ${observation.context.injected.join(", ")}` : ""}; kept as candidates ${observation.context.candidate.length}; archived ${observation.context.archived.length} (still retrievable)`;

  const continuationAdvice = continuation
    ? `shadow advice was ${continuation.decision} at step ${continuation.wouldActAtStep} (confidence ${continuation.confidence.toFixed(2)}); it was not executed`
    : observation.continuation
      ? `shadow advice was ${observation.continuation.decision} (confidence ${observation.continuation.confidence.toFixed(2)}) as recorded on this observation; it was not executed`
      : "no shadow continuation opinion was recorded";

  if (factorText) evidence.push(`recommendation factors: ${factorText}`);
  if (recommendation) evidence.push(`recommendation ${recommendation.recommendationId}; confidence ${recommendation.confidence.toFixed(2)}`);
  for (const deviation of input.deviations ?? []) evidence.push(`deviation: ${deviation}`);
  evidence.push(`outcome ${observation.execution.outcome} on ${observation.model.modelKey} at node ${observation.node.nodeId}`);
  if (observation.capabilityUpdate.applied) evidence.push(`capability update applied to ${observation.capabilityUpdate.dimensions.join(", ")}`);
  else evidence.push(`capability update not applied: ${observation.capabilityUpdate.reason}`);

  return {
    observationId: observation.observationId,
    whyThisModel,
    whyThisNode,
    whyTheseSkills,
    whyNotOtherSkills,
    whyThisContext,
    continuationAdvice,
    decisionOutcome: judgeDecisionOutcome(observation),
    evidence
  };
}
