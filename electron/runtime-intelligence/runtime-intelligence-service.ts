/**
 * Runtime Intelligence Plane — the service that makes the plane one running system.
 *
 * Everything below this module is a pure decision plus a store; this is where they are
 * wired into a loop that observes a real machine, records real outcomes, updates the
 * capability ledger, advises the next task and explains a past one. It is deliberately
 * NOT wired into `electron/main.ts` as a boot module: the plane is an observer in this
 * round, and adding a boot module would raise the architecture ratchet's boot-module count
 * and change the composition root of the running application. A caller can construct it
 * with a root of its own (the CLI and the tests both do).
 *
 * The loop it implements is the one the plan asks for:
 *
 *     observe -> measure -> model -> recommend -> shadow evaluate
 *
 * and the record it leaves behind is the one the plan asks a report to explain from:
 * task -> model -> node -> skills -> context -> execution -> review -> capability update.
 */

import path from "node:path";
import { collectNodeSnapshot, type NodeProfilerOptions } from "./node-profiler";
import { RuntimeIntelligenceStore, type RuntimeIntelligenceStoreStatus } from "./intelligence-store";
import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  modelKeyOf,
  type ContinuationAssessment,
  type ContinuationSignals,
  type ContextLifecyclePlan,
  type ContextRecord,
  type ModelCapabilityRecord,
  type NodeCapabilitySnapshot,
  type RuntimeObservation,
  type SchedulingRecommendation,
  type SelectionBasis,
  type SkillCard,
  type SkillUsageTelemetry,
  type TaskKind,
  type TaskProfile
} from "../../src/shared/runtime-intelligence/contracts";
import { applyModelOutcome, createModelRecord, type ModelOutcomeApplication, type OutcomeAttribution } from "../../src/shared/runtime-intelligence/model-ledger";
import { outcomeKindOf, planOutcomeCharge, toModelOutcomeInput, type IngestOutcomeInput } from "../../src/shared/runtime-intelligence/outcome-ingestion";
import { modelIdentityFor, readRealOutcomes, toIngestionSignals, type OutcomeSourceReport, type RealOutcomeReadResult, type RealOutcomeRecord } from "./outcome-source";
import { adviseScheduling, type SchedulingInput } from "../../src/shared/runtime-intelligence/scheduling-advisor";
import { evaluateContinuation } from "../../src/shared/runtime-intelligence/continuation-evaluator";
import { planContextLifecycle } from "../../src/shared/runtime-intelligence/context-lifecycle";
import { createObservation, explainObservation, observationIdFor, traceIdFor, type ObservationExplanation } from "../../src/shared/runtime-intelligence/telemetry";
import { benchmarkContinuation, type ContinuationBenchmarkMetrics, type ContinuationReplayStep } from "../../src/shared/runtime-intelligence/continuation-benchmark";
import { benchmarkScheduler, type ReplayCase, type SchedulerBenchmarkMetrics } from "../../src/shared/runtime-intelligence/scheduler-benchmark";
import { replaySkillLoadout, replaySkillLoadouts, type SkillReplayAggregate } from "../../src/shared/runtime-intelligence/skill-replay";
import { buildEvaluationReport, type BoundaryFacts, type EvaluationReport, type NodeTelemetryStats } from "../../src/shared/runtime-intelligence/evaluation-report";

export interface RuntimeIntelligenceServiceOptions {
  /** The plane's own data root. Supplied by the caller; never rebuilt from an install path here. */
  rootDir: string;
  now?: () => string;
  /** Profiler defaults; `capturedAt` is always taken from the service clock. */
  nodeProfiler?: Omit<NodeProfilerOptions, "capturedAt">;
}

export interface RecordFileInput {
  /** The model identity to file this outcome against. */
  provider: string;
  family: string;
  version?: string;
  declaredCapabilities?: readonly string[];
}

export interface RecordOutcomeInput {
  task: Pick<TaskProfile, "taskId" | "role" | "taskKind"> & Partial<Pick<TaskProfile, "contextScale" | "externalEffect" | "risk" | "requiredCapabilities">>;
  model: RecordFileInput;
  nodeId?: string;
  success: boolean;
  quality?: number;
  failureClass?: string;
  attribution?: OutcomeAttribution;
  latencyMs?: number;
  expectedLatencyMs?: number;
  costUsd?: number;
  expectedCostUsd?: number;
  reviewerAgreed?: boolean;
  reviewerId?: string;
  skills?: { recommended?: readonly string[]; actual?: readonly string[]; used?: readonly string[] };
  context?: { injected?: readonly string[]; candidate?: readonly string[]; archived?: readonly string[] };
  modelBasis?: SelectionBasis;
  nodeBasis?: SelectionBasis;
  modelReasonRefs?: readonly string[];
  nodeReasonRefs?: readonly string[];
  recommendationId?: string;
  continuation?: ContinuationAssessment;
  /** Set to false to record an outcome without changing the ledger (a shadow-only probe). */
  updateLedger?: boolean;
}

export interface RecordedOutcome {
  observation: RuntimeObservation;
  record: ModelCapabilityRecord;
  application: ModelOutcomeApplication;
}

/** What one real-data ingestion pass actually found and did. */
export interface IngestionSummary {
  dataRoot: string;
  sources: OutcomeSourceReport[];
  /** Sources that existed but could not be read, with their reasons. */
  degraded: string[];
  /** Every real record the sources held. */
  considered: number;
  /** Records this pass folded into the plane. */
  ingested: number;
  /** Records whose failure was attributable to the model and moved the ledger. */
  charged: number;
  /** Records recorded but deliberately NOT charged to the model. */
  refused: number;
  /** How many records landed in each domain, so a report can show where failures came from. */
  domains: Record<string, number>;
}

/** What one evaluation pass produced, so a caller can report or drill into any part of it. */
export interface EvaluationBundle {
  report: EvaluationReport;
  scheduler: SchedulerBenchmarkMetrics;
  skillReplay: SkillReplayAggregate;
  ingestion?: IngestionSummary;
  continuation?: ContinuationBenchmarkMetrics;
}

export interface EvaluationBundleInput {
  /** Where real Boss data lives, when the caller wants it ingested first. */
  dataRoot?: string;
  /** Skill cards, so a replay can cost what it would drop. Without them nothing can be costed. */
  skillCards?: readonly SkillCard[];
  /** A recorded continuation replay corpus. Absent means the benchmark cannot be computed. */
  continuationCorpus?: readonly ContinuationReplayStep[];
  nodeTelemetry?: NodeTelemetryStats;
  boundary: BoundaryFacts;
}

/**
 * The facade. One instance owns one data root, and every write goes through the store.
 *
 * Reads degrade: `models()`, `nodes()` and `contextRecords()` return what the store could
 * read and the store records why anything could not be read, so a corrupt file slows the
 * plane down instead of stopping the work it observes.
 */
export class RuntimeIntelligenceService {
  readonly store: RuntimeIntelligenceStore;
  private readonly options: RuntimeIntelligenceServiceOptions;
  private readonly now: () => string;
  private sequence = 0;

  constructor(options: RuntimeIntelligenceServiceOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
    this.store = new RuntimeIntelligenceStore({ rootDir: options.rootDir });
  }

  /* --------------------------------------------------------------- observation */

  /** Profiles this machine and persists the snapshot, returning what it observed. */
  profileNode(extra: Partial<Omit<NodeProfilerOptions, "capturedAt">> = {}): NodeCapabilitySnapshot {
    const snapshot = collectNodeSnapshot({ ...this.options.nodeProfiler, ...extra, capturedAt: this.now() });
    this.store.saveNodes([snapshot]);
    return snapshot;
  }

  nodes(): NodeCapabilitySnapshot[] {
    return this.store.loadNodes();
  }

  latestNode(nodeId: string): NodeCapabilitySnapshot | undefined {
    return this.store.latestNodeSnapshot(nodeId);
  }

  models(): ModelCapabilityRecord[] {
    return this.store.loadModels();
  }

  model(provider: string, family: string, version?: string): ModelCapabilityRecord | undefined {
    return this.store.model(modelKeyOf({ provider, family, version }));
  }

  /* -------------------------------------------------------------- capability */

  /**
   * The ledger record for a model, warm-started on first sight.
   *
   * A model that has never been seen gets a new warm-started record rather than a zero
   * estimate, and the record is persisted immediately so the next call finds the same one.
   */
  ensureModel(input: RecordFileInput): ModelCapabilityRecord {
    const key = modelKeyOf(input);
    const existing = this.store.model(key);
    if (existing) return existing;
    const record = createModelRecord({
      provider: input.provider,
      family: input.family,
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.declaredCapabilities === undefined ? {} : { declaredCapabilities: input.declaredCapabilities }),
      at: this.now()
    });
    this.store.saveModels([...this.store.loadModels().filter((entry) => entry.modelKey !== key), record]);
    return record;
  }

  /* ------------------------------------------------------------------ outcome */

  /**
   * Folds one real outcome into the ledger and records the unified observation for it.
   *
   * The observation is built from what actually happened, including the node snapshot the
   * run used; `capabilityUpdate.applied` reports whether the ledger moved, and when it did
   * not, the reason is carried rather than left blank.
   */
  recordOutcome(input: RecordOutcomeInput): RecordedOutcome {
    const recordedAt = this.now();
    this.sequence += 1;
    const modelKey = modelKeyOf(input.model);
    const before = this.ensureModel(input.model);
    const taskKind: TaskKind = input.task.taskKind;
    const application = applyModelOutcome(before, {
      observationId: observationIdFor({ taskId: input.task.taskId, modelKey, nodeId: input.nodeId ?? "unprofiled-node", sequence: this.sequence }),
      taskId: input.task.taskId,
      nodeId: input.nodeId ?? "unprofiled-node",
      role: input.task.role,
      taskKind,
      success: input.success,
      ...(input.quality === undefined ? {} : { quality: input.quality }),
      ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass }),
      ...(input.attribution === undefined ? {} : { attribution: input.attribution }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      ...(input.expectedLatencyMs === undefined ? {} : { expectedLatencyMs: input.expectedLatencyMs }),
      ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd }),
      ...(input.expectedCostUsd === undefined ? {} : { expectedCostUsd: input.expectedCostUsd }),
      ...(input.reviewerAgreed === undefined ? {} : { reviewerAgreed: input.reviewerAgreed }),
      ...(input.task.contextScale === undefined ? {} : { contextScale: input.task.contextScale }),
      at: recordedAt
    });

    const updateLedger = input.updateLedger ?? true;
    if (updateLedger) {
      this.store.saveModels([...this.store.loadModels().filter((entry) => entry.modelKey !== modelKey), application.record]);
    }

    const observation = createObservation({
      observationId: observationIdFor({ taskId: input.task.taskId, modelKey, nodeId: input.nodeId ?? "unprofiled-node", sequence: this.sequence }),
      traceId: traceIdFor(input.task.taskId),
      ...(input.recommendationId === undefined ? {} : { recommendationId: input.recommendationId }),
      task: { taskId: input.task.taskId, role: input.task.role, taskKind },
      model: {
        modelKey,
        provider: input.model.provider,
        family: input.model.family,
        ...(input.model.version === undefined ? {} : { version: input.model.version }),
        basis: input.modelBasis ?? (input.recommendationId === undefined ? "ACTUAL" : "RECOMMENDED"),
        reasonRefs: [...(input.modelReasonRefs ?? [])]
      },
      node: { nodeId: input.nodeId ?? "unprofiled-node", basis: input.nodeBasis ?? "UNKNOWN", reasonRefs: [...(input.nodeReasonRefs ?? [])] },
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
        outcome: input.success ? "SUCCESS" : "FAILED",
        ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass }),
        ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
        ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd })
      },
      review: {
        agreement: input.reviewerAgreed === undefined ? "NOT_REVIEWED" : input.reviewerAgreed ? "AGREED" : "DISAGREED",
        ...(input.reviewerId === undefined ? {} : { reviewerId: input.reviewerId })
      },
      ...(input.continuation === undefined
        ? {}
        : { continuation: { assessmentId: input.continuation.assessmentId, decision: input.continuation.decision, confidence: input.continuation.confidence, executed: false as const } }),
      capabilityUpdate: {
        applied: updateLedger && application.updated.length > 0,
        dimensions: application.updated,
        reason:
          updateLedger === false
            ? "the ledger was not updated for this run"
            : application.updated.length === 0
              ? `no dimension was exercised: ${application.skipped.map((entry) => `${entry.dimension} (${entry.reason})`).join("; ")}`
              : `updated ${application.updated.join(", ")} with weight ${application.weight}${application.anomaly ? " (anomalous outcome, down-weighted)" : ""}`
      },
      createdAt: recordedAt
    });

    this.store.appendObservation(observation);
    return { observation, record: application.record, application };
  }

  /* -------------------------------------------------------------- recommendation */

  /** Advises a task from the persisted ledger and the latest snapshot of each known node. */
  adviseFor(task: TaskProfile, overrides: Partial<Omit<SchedulingInput, "task" | "createdAt">> = {}): SchedulingRecommendation {
    this.sequence += 1;
    return adviseScheduling({
      task,
      models: this.models(),
      nodes: this.nodes(),
      createdAt: this.now(),
      sequence: this.sequence,
      ...overrides
    });
  }

  /**
   * Advises AND persists the recommendation, returning it.
   *
   * The log is what makes Phase J possible: a replay needs the advice that preceded a real
   * outcome, and `RuntimeObservation.recommendationId` joins the two.
   */
  adviseAndRecord(task: TaskProfile, overrides: Partial<Omit<SchedulingInput, "task" | "createdAt">> = {}): SchedulingRecommendation {
    const recommendation = this.adviseFor(task, overrides);
    this.store.appendRecommendation(recommendation);
    return recommendation;
  }

  /* ----------------------------------------------------------------- ingestion */

  /**
   * Ingests ONE outcome: classifies it, charges the ledger only when the failure is
   * attributable to the model, and always records the observation with its domain.
   *
   * The two halves matter equally. A model failure moves the dimensions the task kind
   * exercises; an environment failure moves nothing and says so in
   * `capabilityUpdate.reason`, so "we chose not to charge this" is visible in the record
   * rather than looking like a missing update.
   */
  ingestOutcome(input: IngestOutcomeInput & { model: RecordFileInput; nodeId?: string; recommendationId?: string; modelBasis?: SelectionBasis; nodeBasis?: SelectionBasis }): RecordedOutcome & { chargeable: boolean; domain: string } {
    const recordedAt = input.at || this.now();
    this.sequence += 1;
    const modelKey = modelKeyOf(input.model);
    const before = this.ensureModel(input.model);
    const nodeId = input.nodeId ?? "unprofiled-node";
    const observationId = input.observationId ?? observationIdFor({ taskId: input.taskId, modelKey, nodeId, sequence: this.sequence });
    const charge = planOutcomeCharge({ kind: input.kind, taskKind: input.taskKind, signals: input.signals });
    const ledgerInput = toModelOutcomeInput({ ...input, at: recordedAt, observationId, nodeId });

    let record = before;
    let application: ModelOutcomeApplication;
    if (ledgerInput === undefined) {
      // Not chargeable: no ledger movement at all, and the reason is recorded below.
      application = { record: before, updated: [], skipped: [], weight: 0, anomaly: false, reasons: [`not charged: ${charge.classification.reasons.join("; ")}`] };
    } else {
      application = applyModelOutcome(before, ledgerInput);
      this.store.saveModels([...this.store.loadModels().filter((entry) => entry.modelKey !== modelKey), application.record]);
      record = application.record;
    }

    const observation = createObservation({
      observationId,
      traceId: traceIdFor(input.taskId),
      ...(input.recommendationId === undefined ? {} : { recommendationId: input.recommendationId }),
      task: { taskId: input.taskId, role: input.role, taskKind: input.taskKind },
      model: {
        modelKey,
        provider: input.model.provider,
        family: input.model.family,
        ...(input.model.version === undefined ? {} : { version: input.model.version }),
        basis: input.modelBasis ?? (input.recommendationId === undefined ? "ACTUAL" : "RECOMMENDED"),
        reasonRefs: []
      },
      node: { nodeId, basis: input.nodeBasis ?? "UNKNOWN", reasonRefs: [] },
      execution: {
        outcome: input.kind === "SUCCESS" || input.kind === "PARTIAL_SUCCESS" ? "SUCCESS" : input.kind === "CANCELLED" ? "CANCELLED" : "FAILED",
        ...(charge.classification.failureClass === "" ? {} : { failureClass: charge.classification.failureClass }),
        failureDomain: charge.classification.domain,
        ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
        ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd })
      },
      review: { agreement: input.reviewerAgreed === undefined ? "NOT_REVIEWED" : input.reviewerAgreed ? "AGREED" : "DISAGREED" },
      capabilityUpdate: {
        applied: ledgerInput !== undefined && application.updated.length > 0,
        dimensions: application.updated,
        reason:
          ledgerInput === undefined
            ? `the ledger was not charged: outcome domain ${charge.classification.domain} — ${charge.classification.reasons.join("; ")}`
            : `updated ${application.updated.join(", ")} with weight ${application.weight}`
      },
      createdAt: recordedAt
    });

    this.store.appendObservation(observation);
    return { observation, record, application, chargeable: charge.chargeable, domain: charge.classification.domain };
  }

  /**
   * Ingests every outcome Boss already recorded under a data root.
   *
   * Read-only apart from the plane's own store, and honest about what it found: the summary
   * counts records considered, charged, refused and per domain, so a report can say whether
   * there was enough real data instead of implying there was.
   */
  ingestRealOutcomes(input: { dataRoot: string; taskKindFor?: (record: RealOutcomeRecord) => TaskKind; limit?: number }): IngestionSummary {
    const read: RealOutcomeReadResult = readRealOutcomes({ dataRoot: input.dataRoot });
    const records = input.limit === undefined ? read.records : read.records.slice(-input.limit);
    const domains: Record<string, number> = {};
    let ingested = 0;
    let charged = 0;
    let refused = 0;

    for (const source of records) {
      const kind = outcomeKindOf(source.rawOutcome, source.reason);
      const taskKind: TaskKind = input.taskKindFor ? input.taskKindFor(source) : "other";
      const role = source.role ?? "worker";
      const result = this.ingestOutcome({
        taskId: source.taskId,
        role,
        taskKind,
        kind,
        signals: toIngestionSignals(source),
        ...(source.latencyMs === undefined ? {} : { latencyMs: source.latencyMs }),
        at: source.at,
        model: modelIdentityFor(source)
      });
      ingested += 1;
      if (result.chargeable) charged += 1;
      else refused += 1;
      domains[result.domain] = (domains[result.domain] ?? 0) + 1;
    }

    return {
      dataRoot: input.dataRoot,
      sources: read.sources,
      degraded: read.degraded,
      considered: read.records.length,
      ingested,
      charged,
      refused,
      domains
    };
  }

  /* ---------------------------------------------------------------- continuation */

  /**
   * Evaluates continuation in shadow mode. The returned assessment is advisory only and
   * nothing in this service applies it — that is the point of the round.
   */
  evaluateContinuation(signals: ContinuationSignals): ContinuationAssessment {
    this.sequence += 1;
    return evaluateContinuation({ signals, at: this.now(), sequence: this.sequence });
  }

  /* -------------------------------------------------------------------- context */

  planContext(input: { taskId: string; records?: readonly ContextRecord[]; requestedIds?: readonly string[]; hotTokenBudget?: number; persist?: boolean }): ContextLifecyclePlan {
    const records = input.records ?? this.store.loadContextRecords();
    if (input.records !== undefined && input.persist !== false) this.store.saveContextRecords(input.records);
    return planContextLifecycle({
      taskId: input.taskId,
      records,
      now: this.now(),
      ...(input.requestedIds === undefined ? {} : { requestedIds: input.requestedIds }),
      ...(input.hotTokenBudget === undefined ? {} : { hotTokenBudget: input.hotTokenBudget })
    });
  }

  /* --------------------------------------------------------------- skill evidence */

  recordSkillTelemetry(entries: readonly SkillUsageTelemetry[]): void {
    this.store.appendSkillTelemetry(entries);
  }

  skillTelemetry(): SkillUsageTelemetry[] {
    return this.store.skillTelemetry();
  }

  /* ----------------------------------------------------------------- explanation */

  /** Answers the operator's questions from the stored record. */
  explain(observationId: string): ObservationExplanation | undefined {
    const observation = this.store.observation(observationId);
    return observation === undefined ? undefined : explainObservation({ observation });
  }

  /** The most recent observation for a task, so a report can explain a task by id. */
  latestObservationFor(taskId: string): RuntimeObservation | undefined {
    return this.store.observations(Number.MAX_SAFE_INTEGER).filter((entry) => entry.task.taskId === taskId).at(-1);
  }

  /* ---------------------------------------------------------------- evaluation */

  /**
   * Assembles the evaluation report from what this plane actually recorded.
   *
   * The joins are the whole point: an observation is paired with the recommendation its
   * `recommendationId` names (falling back to the latest recommendation for the same task),
   * and the skill replay is built from the loadout the observation says was mounted against the
   * one it says was invoked. Nothing is synthesised to fill a gap — a missing recommendation
   * makes its case INCONCLUSIVE, and a corpus that was never recorded makes its benchmark
   * `INSUFFICIENT_EVIDENCE`.
   */
  evaluate(input: EvaluationBundleInput): EvaluationBundle {
    const ingestion = input.dataRoot === undefined ? undefined : this.ingestRealOutcomes({ dataRoot: input.dataRoot });

    const recommendations = this.store.recommendations();
    const byId = new Map(recommendations.map((entry) => [entry.recommendationId, entry]));
    const observations = this.store.observations(Number.MAX_SAFE_INTEGER);
    const cases: ReplayCase[] = observations.map((observation) => {
      const explicit = observation.recommendationId === undefined ? undefined : byId.get(observation.recommendationId);
      const fallback = explicit ?? [...recommendations].reverse().find((entry) => entry.taskId === observation.task.taskId);
      return fallback === undefined ? { taskId: observation.task.taskId, observation } : { taskId: observation.task.taskId, recommendation: fallback, observation };
    });
    const scheduler = benchmarkScheduler(cases);

    const cards = input.skillCards ?? [];
    const skillReplay = replaySkillLoadouts(
      observations.map((observation) =>
        replaySkillLoadout({
          task: {
            taskId: observation.task.taskId,
            role: observation.task.role,
            taskKind: observation.task.taskKind,
            requiredCapabilities: [],
            contextScale: "small",
            externalEffect: false,
            risk: "low",
            createdAt: observation.createdAt
          },
          originalSkillIds: observation.skills.actual,
          usedSkillIds: observation.skills.used,
          cards
        })
      )
    );

    const continuationSteps = input.continuationCorpus ?? [];
    const continuation = continuationSteps.length === 0 ? undefined : benchmarkContinuation(continuationSteps);
    const status = this.store.status();

    const report = buildEvaluationReport({
      generatedAt: this.now(),
      ...(ingestion === undefined
        ? {}
        : {
            ingestion: {
              considered: ingestion.considered,
              ingested: ingestion.ingested,
              charged: ingestion.charged,
              refused: ingestion.refused,
              domains: ingestion.domains,
              degraded: ingestion.degraded,
              sources: ingestion.sources.map((source) => ({ name: source.name, present: source.present, records: source.records, ...(source.degradedReason === undefined ? {} : { degradedReason: source.degradedReason }) }))
            }
          }),
      scheduler,
      ...(continuation === undefined ? {} : { continuation }),
      skillReplay,
      ...(input.nodeTelemetry === undefined ? {} : { nodeTelemetry: input.nodeTelemetry }),
      storage: {
        observations: status.counts.observations,
        recommendations: status.counts.recommendations,
        models: status.counts.models,
        contextRecords: status.counts.contextRecords,
        skillTelemetry: status.counts.skillTelemetry,
        bytes: { ...status.files }
      },
      continuationReplayPossible: continuationSteps.length > 0,
      boundary: input.boundary
    });

    return { report, scheduler, skillReplay, ...(ingestion === undefined ? {} : { ingestion }), ...(continuation === undefined ? {} : { continuation }) };
  }

  status(): RuntimeIntelligenceStoreStatus & { authority: "ADVISORY_ONLY"; schemaVersion: number } {
    return { ...this.store.status(), authority: "ADVISORY_ONLY", schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION };
  }
}

/** The plane's data directory under a Boss data root. Kept in one place so callers agree. */
export function runtimeIntelligenceRoot(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "runtime-intelligence");
}
