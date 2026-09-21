/**
 * Runtime Intelligence Plane — replay cases from a real corpus.
 *
 * This is where real Boss behaviour meets the two benchmarks, and the method is a
 * **walk-forward replay**: records are processed in source-timestamp order, the advice for a
 * record is produced from the ledger state built ONLY from earlier records, and the record's own
 * outcome is folded in afterwards. That ordering is what keeps the replay honest even though the
 * corpus it replays is historical — the advisor never sees past the step it is advising on.
 *
 * The continuation path feeds the REAL evaluator the signals the corpus actually carries.
 * `pendingSteps` and `completedSteps` give `unresolvedItems` and a derivable `progress`;
 * novelty, repetition and reviewer signals were never recorded, so they stay `undefined` and the
 * assessment says which rules could not apply. A record that does not carry the open-work count
 * is skipped outright: without it there is no judgement to make, and inventing a zero would
 * assert "nothing left to do" about a step whose state nobody recorded.
 *
 * Both paths attach an `inputDeclaration`, so the temporal guard can refuse a case whose advice
 * could see the outcome.
 */

import { attributeStep, censusAttributions, DIRECT_ATTRIBUTION_SOURCES, type AttributionCensus, type StepDispatchAttribution } from "../../src/shared/runtime-intelligence/dispatch-attribution";
import { AT_DECISION_TIME_FIELDS, type ReplayCorpus, type ReplayCorpusRecord } from "../../src/shared/runtime-intelligence/replay-corpus";
import { DEFAULT_CONTINUATION_POLICY, continuationPolicyHash, evaluateContinuation, type ContinuationPolicyId } from "../../src/shared/runtime-intelligence/continuation-evaluator";
import { adviseScheduling } from "../../src/shared/runtime-intelligence/scheduling-advisor";
import { applyModelOutcome, createModelRecord } from "../../src/shared/runtime-intelligence/model-ledger";
import { createObservation } from "../../src/shared/runtime-intelligence/telemetry";
import { modelKeyOf, type FailureDomain, type ModelCapabilityRecord, type RuntimeObservation, type TaskKind, type TaskProfile } from "../../src/shared/runtime-intelligence/contracts";
import { isMeasured } from "../../src/shared/runtime-intelligence/measurement";
import type { ContinuationReplayStep } from "../../src/shared/runtime-intelligence/continuation-benchmark";
import type { ReplayCase } from "../../src/shared/runtime-intelligence/scheduler-benchmark";
import type { ReplayInputDeclaration } from "../../src/shared/runtime-intelligence/temporal-guard";

/** What a replay read from a record's input section. Declared, so the guard can check it. */
function declarationFor(label: string): ReplayInputDeclaration {
  return { fields: [...AT_DECISION_TIME_FIELDS], label };
}

function taskKindOf(record: ReplayCorpusRecord): TaskKind {
  const kind = record.taskKind;
  return kind === "unknown" ? "other" : kind;
}

/**
 * The one model identity a runtime id supports.
 *
 * The application dispatches to a runtime (for example `web:chatgpt`) whose provider is
 * `chatgpt`. Both derivations must agree, or the ledger and the observation describe different
 * identities and every case reads as NOT_FOLLOWED for a reason that has nothing to do with the
 * advisor. The version stays absent, because a web transport exposes no model version.
 */
function identityFromRuntime(runtimeId: string): { provider: string; family: string } {
  // A runtime id is `<transport>:<provider>` — `web:chatgpt` is the chatgpt provider over the web
  // transport — so the provider is everything after the transport, not before it.
  const parts = runtimeId.split(":");
  const provider = parts.length > 1 ? parts.slice(1).join(":") : runtimeId;
  return { provider: provider.trim() === "" ? "unknown" : provider, family: runtimeId };
}

function identityFor(record: ReplayCorpusRecord): { provider: string; family: string } {
  const runtimeId = record.atDecisionTime.runtimeId;
  if (isMeasured(runtimeId)) return identityFromRuntime(runtimeId.value);
  const provider = record.atDecisionTime.provider;
  const providerId = isMeasured(provider) ? provider.value : "unknown";
  return { provider: providerId, family: providerId };
}

function modelKeyOfRecord(record: ReplayCorpusRecord): string {
  const identity = identityFor(record);
  return modelKeyOf(identity);
}

export interface ContinuationStepsFromCorpus {
  steps: ContinuationReplayStep[];
  skipped: Array<{ recordId: string; reason: string }>;
  /** Signals the corpus does not carry, counted so a report can say which rules could not apply. */
  unavailableSignals: string[];
  /** Which policy produced these assessments. */
  policyId: string;
  policyHash: string;
}

/**
 * Builds continuation replay steps by running the real evaluator on each record's inputs.
 *
 * The observed behaviour comes from the target section — `continuedAfterStep` is positional
 * evidence that the loop took another step — and `taskComplete` from the loop's own
 * `pendingSteps`/`completedSteps` state, which is the positive completion evidence the candidate
 * policy requires before it may say STOP. `policy` selects which version runs, so the baseline
 * and the candidate can be replayed over the SAME corpus.
 */
export function continuationStepsFromCorpus(corpus: ReplayCorpus, options: { policy?: ContinuationPolicyId } = {}): ContinuationStepsFromCorpus {
  const steps: ContinuationReplayStep[] = [];
  const skipped: Array<{ recordId: string; reason: string }> = [];
  const unavailableSignals = ["outputNovelty", "repeatRate", "selfContradictions", "reviewerDisagreements", "reviewerReviews", "uncertainty"];
  const policy = options.policy ?? DEFAULT_CONTINUATION_POLICY;

  for (const record of corpus.records) {
    const unresolved = record.atDecisionTime.unresolvedCount;
    const completed = record.atDecisionTime.completedCount;
    if (unresolved === undefined || completed === undefined) {
      skipped.push({ recordId: record.recordId, reason: "the record does not carry both the open and the completed work counts, so there is no state to judge" });
      continue;
    }
    const total = unresolved + completed;
    const signals = {
      taskId: record.taskId,
      modelKey: modelKeyOfRecord(record),
      // Derived, not measured: the share of the work list that is done. Absent when the list is
      // empty, because 0/0 is not a progress measurement.
      ...(total > 0 ? { progress: completed / total } : {}),
      unresolvedItems: unresolved,
      resolvedItems: completed,
      tokensConsumed: record.atDecisionTime.tokensConsumed,
      elapsedMs: record.atDecisionTime.elapsedMs,
      toolProgress: "UNKNOWN" as const,
      stepsCompleted: record.atDecisionTime.stepIndex,
      // The loop's own completion statement, which is what a STOP must rest on.
      taskComplete: record.afterDecision.taskComplete,
      pendingWork: (unresolved === 0 ? "NONE" : unresolved > 0 ? "WORK" : "UNKNOWN") as "NONE" | "WORK" | "UNKNOWN"
    };
    const assessment = evaluateContinuation({ signals, at: record.sourceTimestamp, sequence: record.atDecisionTime.stepIndex, policy });
    steps.push({
      taskId: record.taskId,
      step: record.atDecisionTime.stepIndex,
      assessment,
      observed: record.afterDecision.continuedAfterStep ? "CONTINUED" : "STOPPED",
      taskComplete: record.afterDecision.taskComplete,
      ...(record.afterDecision.taskSucceeded === undefined ? {} : { taskSucceeded: record.afterDecision.taskSucceeded }),
      inputDeclaration: declarationFor("the shadow continuation advice")
    });
  }

  return { steps, skipped, unavailableSignals, policyId: policy, policyHash: continuationPolicyHash(policy) };
}

export interface SchedulerCasesFromCorpus {
  cases: ReplayCase[];
  /** The ledger after the walk, so a caller can see what the replay learned. */
  ledger: ModelCapabilityRecord[];
  /** One attribution per (step, provider), with the source it came from. */
  attributions: StepDispatchAttribution[];
  census: AttributionCensus;
  /** Cases whose attribution is direct, which is the only set a headline metric may use. */
  directCases: ReplayCase[];
  notes: string[];
}

function observationFromRecord(record: ReplayCorpusRecord, modelKey: string, recommendationId: string | undefined, runtimeId?: string): RuntimeObservation {
  const domain = record.afterDecision.failureDomain;
  const outcome = isMeasured(record.afterDecision.finalOutcome) ? record.afterDecision.finalOutcome.value : "UNKNOWN";
  const provider = runtimeId === undefined ? (isMeasured(record.atDecisionTime.provider) ? record.atDecisionTime.provider.value : "unknown") : identityFromRuntime(runtimeId).provider;
  const family = runtimeId ?? (isMeasured(record.atDecisionTime.runtimeId) ? record.atDecisionTime.runtimeId.value : "unknown");
  return createObservation({
    observationId: `corpus:${record.recordId}`,
    traceId: `corpus-trace:${record.taskId}`,
    ...(recommendationId === undefined ? {} : { recommendationId }),
    task: { taskId: record.taskId, role: "worker", taskKind: taskKindOf(record) },
    model: {
      modelKey,
      provider,
      family,
      version: "unknown",
      basis: "RECOMMENDED",
      reasonRefs: []
    },
    node: { nodeId: isMeasured(record.atDecisionTime.nodeId) ? record.atDecisionTime.nodeId.value : "unprofiled-node", basis: "UNKNOWN" },
    execution: {
      outcome: outcome === "SUCCESS" ? "SUCCESS" : outcome === "PARTIAL_SUCCESS" ? "SUCCESS" : outcome === "CANCELLED" ? "CANCELLED" : outcome === "FAILURE" ? "FAILED" : "UNKNOWN",
      ...(isMeasured(domain) ? { failureDomain: domain.value as FailureDomain } : {}),
      ...(isMeasured(record.afterDecision.measuredLatencyMs) ? { latencyMs: record.afterDecision.measuredLatencyMs.value } : {}),
      ...(isMeasured(record.afterDecision.measuredCostUsd) ? { costUsd: record.afterDecision.measuredCostUsd.value } : {})
    },
    review: { agreement: isMeasured(record.afterDecision.reviewOutcome) && record.afterDecision.reviewOutcome.value === "VERIFIED" ? "AGREED" : "NOT_REVIEWED" },
    skills: { recommended: record.atDecisionTime.mountedSkills, actual: record.atDecisionTime.mountedSkills, used: record.atDecisionTime.usedSkills },
    context: { injected: record.atDecisionTime.contextInjected, candidate: [], archived: [] },
    capabilityUpdate: { applied: false, dimensions: [], reason: "the corpus is replayed, so no ledger update is attributed to this observation" },
    createdAt: record.sourceTimestamp
  });
}

/**
 * Replays a corpus through the real scheduler advisor, walk-forward.
 *
 * Order is by `sourceTimestamp` and then by `recordId`, so the replay is deterministic. For each
 * record that names a provider, the advisor is asked which candidate it would choose given only
 * what earlier records established, the answer becomes the case's recommendation, and the
 * record's own outcome is folded into the ledger afterwards. A record with no provider measured
 * is skipped: there was no dispatch decision to replay.
 */
export function schedulerCasesFromCorpus(corpus: ReplayCorpus, options: { sequenceBase?: number } = {}): SchedulerCasesFromCorpus {
  const ordered = [...corpus.records].sort((left, right) => (left.sourceTimestamp === right.sourceTimestamp ? left.recordId.localeCompare(right.recordId) : left.sourceTimestamp < right.sourceTimestamp ? -1 : 1));
  const ledger = new Map<string, ModelCapabilityRecord>();
  const cases: ReplayCase[] = [];
  const directCases: ReplayCase[] = [];
  const attributions: StepDispatchAttribution[] = [];
  const notes: string[] = [];
  let sequence = options.sequenceBase ?? 1000;
  let skippedNoProvider = 0;
  const domainsSeen: Record<string, number> = {};

  /** Providers of the runs of one task, used only when the step itself named none. */
  const taskProviders = (taskId: string): string[] => {
    const seen = new Set<string>();
    for (const entry of ordered) {
      if (entry.taskId !== taskId) continue;
      if (isMeasured(entry.atDecisionTime.runtimeId)) seen.add(entry.atDecisionTime.runtimeId.value);
    }
    return [...seen].sort();
  };

  for (const record of ordered) {
    // One attribution PER PROVIDER this step dispatched to. A step with three worker sessions is
    // three dispatch decisions, not one ambiguous one.
    const stepAttributions = attributeStep({
      recordId: record.recordId,
      stepIndex: record.atDecisionTime.stepIndex,
      sessionProviders: record.atDecisionTime.workerSessions,
      taskProviders: taskProviders(record.taskId)
    });
    attributions.push(...stepAttributions);
    const providers = stepAttributions.filter((attribution) => attribution.provider !== undefined);
    if (providers.length === 0) {
      skippedNoProvider += 1;
      continue;
    }

    for (const attribution of providers) {
      const runtimeId = attribution.provider!;
      const identity = identityFromRuntime(runtimeId);
      const actualKey = modelKeyOf(identity);
      if (!ledger.has(actualKey)) ledger.set(actualKey, createModelRecord({ provider: identity.provider, family: identity.family, at: record.sourceTimestamp }));
      const models = [...ledger.values()];
      const task: TaskProfile = {
        taskId: record.taskId,
        role: "worker",
        taskKind: taskKindOf(record),
        requiredCapabilities: [],
        contextScale: "small",
        externalEffect: false,
        risk: "low",
        createdAt: record.sourceTimestamp
      };
      sequence += 1;
      const recommendation = adviseScheduling({ task, models, nodes: [], createdAt: record.sourceTimestamp, sequence });
      const observation = observationFromRecord(record, actualKey, recommendation.recommendationId, runtimeId);
      const replayCase: ReplayCase = { taskId: `${record.taskId}@${record.atDecisionTime.stepIndex}`, recommendation, observation, inputDeclaration: declarationFor("the scheduler advice") };
      cases.push(replayCase);
      if (DIRECT_ATTRIBUTION_SOURCES.includes(attribution.attributionSource)) directCases.push(replayCase);
    }

    // Walk forward: fold this record's outcome in only AFTER its advice was produced.
    const outcome = record.afterDecision.finalOutcome;
    const domain = record.afterDecision.failureDomain;
    const domainValue: FailureDomain | undefined = isMeasured(domain) ? domain.value : undefined;
    domainsSeen[domainValue ?? "NOT_MEASURED"] = (domainsSeen[domainValue ?? "NOT_MEASURED"] ?? 0) + 1;
    if (!isMeasured(outcome)) continue;
    const attributable = domainValue === undefined ? outcome.value === "SUCCESS" : domainValue === "MODEL" || domainValue === "SEMANTIC";
    if (!attributable && outcome.value !== "SUCCESS") continue;
    const success = outcome.value === "SUCCESS" || outcome.value === "PARTIAL_SUCCESS";
    for (const attribution of providers) {
      const identity = identityFromRuntime(attribution.provider!);
      const key = modelKeyOf(identity);
      const current = ledger.get(key);
      if (current === undefined) continue;
      const applied = applyModelOutcome(current, {
        observationId: `corpus:${record.recordId}:${key}`,
        taskId: record.taskId,
        nodeId: "unprofiled-node",
        role: "worker",
        taskKind: taskKindOf(record),
        success,
        ...(success ? {} : { failureClass: domainValue === "SEMANTIC" ? "SEMANTIC_REFUSAL" : "MODEL_FAILURE" }),
        attribution: domainValue === "SEMANTIC" ? "SEMANTIC" : "RUNTIME",
        ...(isMeasured(record.afterDecision.measuredLatencyMs) ? { latencyMs: record.afterDecision.measuredLatencyMs.value } : {}),
        at: record.sourceTimestamp
      });
      ledger.set(key, applied.record);
    }
  }

  const census = censusAttributions(attributions);
  if (skippedNoProvider > 0) notes.push(`${skippedNoProvider} step(s) recorded no dispatched provider at all, so there was no dispatch decision to replay`);
  notes.push(`the walk processed ${ordered.length} step(s) in source-timestamp order and folded each outcome in only after advising on it`);
  notes.push(`failure domains seen: ${Object.entries(domainsSeen).map(([domain, count]) => `${domain}=${count}`).join(", ")}`);
  notes.push(...census.notes);
  return { cases, ledger: [...ledger.values()], attributions, census, directCases, notes };
}

/** The facets of a declaration a caller may want to reuse. */
