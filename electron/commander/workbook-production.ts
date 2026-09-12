/**
 * WORK_UNIT_3 / REPAIR_BATCH_4: production WorkBook dispatch integration.
 *
 * This IS the production entry point: electron/main.ts delegates its
 * `boss:dispatch-task` WorkBook branch here, and the focused tests call the
 * same function. The real store, registry, ingestion, classification and
 * guardian checks are used; only the provider-driving layers are narrow
 * interfaces.
 *
 * Ordering is the production truth and is crash-consistent:
 *   1. intake (INPUT_RECEIVED..READY, discovery inside) — reads the registry
 *      for relations but never writes it;
 *   2. create the task, then durably persist the WorkBook record;
 *   3. only now commit the registry revisions WITH the real task id.
 *
 * A crash before step 2 leaves no registry write at all (nothing to recover);
 * a crash between 2 and 3 leaves the durable task record as the source of
 * truth, and startup reconciliation rebuilds the missing registry relation
 * from it — never by guessing a foreign task.
 */
import { assertDispatchGroupSize } from "./provider-dispatch-guard";
import { requiresZeroProviderRuns } from "./workbook-boundary";
import { classifyExecutionError } from "./execution-error";
import { runWorkBookDispatch, shouldRunWorkBookIntake, type WorkBookDispatchResult } from "./workbook-dispatch";
import type { WorkbookRegistry, WorkbookRevisionInput } from "../ingestion/workbook-registry";
import type { InputObjectRef } from "../../src/shared/input-object";
import { logicalKeyFor } from "../../src/shared/workbook";
import fs from "node:fs";
import type {
  AppMode,
  FinalizationPolicy,
  ProviderId,
  RunTransport,
  TaskMode
} from "../../src/shared/contracts";
import type { ReviewPolicy } from "../../src/shared/execution";
import type { ConversationPolicy } from "../../src/shared/conversation-policy";
import type { RunMode } from "../../src/shared/owner-result";
import type { WorkAgentCount } from "../../src/shared/work-mode";
import type { WorkBookStage } from "../../src/shared/workbook-dispatch";

/** Full task-creation surface: every field the legacy bridge passed through. */
export interface WorkDispatchTaskInput {
  title: string;
  objective: string;
  providerIds: ProviderId[];
  mode?: TaskMode;
  appMode: AppMode;
  transports?: Record<ProviderId, RunTransport>;
  conversationId?: string;
  inputObjectIds?: string[];
  reviewPolicy?: ReviewPolicy;
  finalizationPolicy?: FinalizationPolicy;
  workAgentCount?: WorkAgentCount;
  runMode?: RunMode;
  conversationPolicy?: ConversationPolicy;
}

/** The narrow slice of MainCommander this orchestration needs. */
export interface WorkDispatchCommander {
  createTask(input: WorkDispatchTaskInput): { id: string };
  startTask(taskId: string): void;
  executeDeterministic(taskId: string, workspace: string): Promise<boolean>;
  executePlan(taskId: string, workspace: string): Promise<boolean>;
}

/** The narrow slice of ProviderAutomation this orchestration needs. */
export interface WorkDispatchAutomation {
  dispatchTask(taskId: string): Promise<void>;
  continueIfReady(taskId: string): Promise<void> | void;
}

/** The narrow slice of StateStore this orchestration needs. */
export interface WorkDispatchStore {
  discardUnstartedRuns(taskId: string, persist?: boolean): void;
  setWorkbookDispatch(taskId: string, record: WorkBookDispatchResult["record"]): void;
  completeWorkbookAnalysis(taskId: string): void;
  setTaskStatus(taskId: string, status: "failed" | "running" | "waiting" | "completed", stageReason?: string): void;
  /** Transient, recoverable: task waiting + WorkBook WAITING + message. */
  enterRecoveryWaiting(taskId: string, message: string): void;
  snapshot(): {
    tasks: {
      id: string;
      title?: string;
      workbookDispatch?: {
        workbook_hash?: string;
        stage?: WorkBookStage;
        resolved_title?: string;
        created_at?: string;
        documents?: { document_id?: string; hash: string; status: string; file_name?: string }[];
      };
    }[];
  };
}

export interface WorkDispatchRequest {
  prompt?: string;
  title?: string;
  conversationId: string;
  providerIds: ProviderId[];
  attachments: InputObjectRef[];
  inputObjectIds?: string[];
  workspacePath: string;
  mode?: TaskMode;
  appMode: AppMode;
  transports?: Record<ProviderId, RunTransport>;
  registry: WorkbookRegistry;
  reviewPolicy?: ReviewPolicy;
  finalizationPolicy?: FinalizationPolicy;
  workAgentCount?: WorkAgentCount;
  runMode?: RunMode;
  conversationPolicy?: ConversationPolicy;
  limits?: import("../ingestion/ingest").IngestionLimits;
}

export interface WorkDispatchDeps {
  store: WorkDispatchStore;
  commander: WorkDispatchCommander;
  automation: WorkDispatchAutomation;
  /** Called after each durable mutation so the caller can publish a snapshot. */
  publish?: () => void;
  /** Injected for tests; defaults to the real intake. */
  intake?: typeof runWorkBookDispatch;
  /**
   * checkpoint-1 §5 Knowledge Foundation. Optional and failure-isolated: when it
   * is present the finished dispatch records its reusable facts through the
   * knowledge write gate, and a knowledge failure is reported in the outcome
   * rather than failing the task (§2.5 partial failure isolation).
   */
  knowledge?: WorkDispatchKnowledge;
  /** Receives a knowledge-write diagnostic instead of the default console log. */
  onKnowledgeDiagnostic?: (detail: { taskId: string; error?: string; failures?: string[]; rejected?: number }) => void;
}

/** The narrow slice of the knowledge foundation this orchestration needs. */
export interface WorkDispatchKnowledge {
  /** Scope for the project this dispatch belongs to. */
  projectScopeFor(input: { workspacePath?: string; projectId?: string }): import("../../src/shared/tenx/knowledge").KnowledgeScope;
  recordWorkBookDispatch(input: import("../../src/shared/knowledge-extraction").KnowledgeExtractionInput): {
    ok: boolean;
    accepted: string[];
    quarantined: string[];
    rejected: number;
    failures: string[];
    error?: string;
  };
}

/**
 * checkpoint-1 §5 knowledge write hook. It runs AFTER the dispatch decision is
 * durable, so the recorded DECISION fact states what actually happened, and it
 * never throws: knowledge is a by-product of the task, not a prerequisite.
 */
function recordDispatchKnowledge(
  deps: WorkDispatchDeps,
  input: { request: WorkDispatchRequest; taskId: string; record: WorkBookDispatchResult["record"]; result: WorkDispatchOutcome }
): void {
  const knowledge = deps.knowledge;
  if (!knowledge) return;
  try {
    const scope = knowledge.projectScopeFor({ workspacePath: input.request.workspacePath });
    const summary = knowledge.recordWorkBookDispatch({
      taskId: input.taskId,
      scope,
      workspacePath: input.request.workspacePath,
      record: input.record,
      outcome: input.result.kind,
      observedAt: new Date().toISOString(),
      ...("message" in input.result ? { dispatchMessage: input.result.message } : {}),
      ...("reason" in input.result ? { dispatchMessage: input.result.reason } : {})
    });
    if (!summary.ok || summary.failures.length) {
      const detail = { taskId: input.taskId, error: summary.error, failures: summary.failures, rejected: summary.rejected };
      if (deps.onKnowledgeDiagnostic) deps.onKnowledgeDiagnostic(detail);
      else console.warn("[knowledge] WorkBook knowledge write degraded", detail);
    }
  } catch (error) {
    const detail = { taskId: input.taskId, error: String((error as Error).message ?? error) };
    if (deps.onKnowledgeDiagnostic) deps.onKnowledgeDiagnostic(detail);
    else console.warn("[knowledge] WorkBook knowledge write failed", detail);
  }
}

export type WorkDispatchOutcome =
  | { kind: "NOT_WORKBOOK" }
  | { kind: "REUSED"; taskId: string }
  | { kind: "BLOCKED"; taskId: string; reason: string }
  | { kind: "ANALYSIS_ONLY"; taskId: string }
  | { kind: "NO_AUTO_RUN"; taskId: string; classification?: string }
  | { kind: "DISPATCHED"; taskId: string }
  /** Transient: task waiting, WorkBook WAITING, retryable through Resume. */
  | { kind: "RECOVERY_WAITING"; taskId: string; message: string }
  /** Terminal: task failed, WorkBook FAILED. */
  | { kind: "FAILED"; taskId: string; message: string };

/** Hashes of existing WorkBook tasks, so an exact duplicate can resume. */
export function workflowTasksByHash(store: WorkDispatchStore): Record<string, string> {
  const map: Record<string, string> = {};
  for (const task of store.snapshot().tasks) {
    const record = task.workbookDispatch;
    if (!record) continue;
    for (const document of record.documents ?? []) {
      if (document.status === "FAILED") continue;
      map[document.hash] ??= task.id;
    }
    if (record.workbook_hash) map[record.workbook_hash] ??= task.id;
  }
  return map;
}

/**
 * Startup reconciliation (REPAIR_BATCH_4): rebuild missing registry relations
 * from the durable task/WorkBook records. The task record is the source of
 * truth: a revision is never linked to a task that did not record its hash, and
 * a revision that the crash prevented entirely is re-created from the record.
 */
export function reconcileWorkbookLinks(
  store: WorkDispatchStore,
  registry: WorkbookRegistry
): { recovered: number; relinked: number; stillUnlinked: number } {
  // 1. A committed relation that lost its task id (or was committed by an older
  //    build) is re-linked from the durable hash -> task map.
  const relinked = registry.recoverTaskLinks(workflowTasksByHash(store)).recovered;
  // 2. A revision the crash prevented entirely is re-created from the durable
  //    WorkBook record, so no crashed dispatch can leave a permanent gap.
  let recovered = 0;
  for (const task of store.snapshot().tasks) {
    const record = task.workbookDispatch;
    if (!record) continue;
    for (const document of record.documents ?? []) {
      if (document.status === "FAILED") continue;
      if (registry.documentIdForHash(document.hash)) continue;
      registry.record(revisionFromSummary(document, record, task.id, record.created_at ?? new Date().toISOString()), task.id);
      recovered += 1;
    }
  }
  return { recovered, relinked, stillUnlinked: registry.unlinkedRevisions().length };
}

/** Rebuilds the minimal revision facts from a durable WorkBook document summary. */
function revisionFromSummary(
  summary: { document_id?: string; hash: string; file_name?: string },
  record: { resolved_title?: string },
  taskId: string,
  createdAt: string
): WorkbookRevisionInput {
  const fileName = summary.file_name ?? record.resolved_title ?? taskId;
  return {
    id: summary.document_id ?? `recovered-${summary.hash.slice(0, 16)}`,
    hash: summary.hash,
    file_name: fileName,
    title: record.resolved_title ?? fileName,
    created_at: createdAt,
    status: "OK",
    logical_key: logicalKeyFor(fileName, summary.hash)
  };
}

/** True when the Work request must take the WorkBook path at all. */
export function shouldDelegateToWorkBookIntake(appMode: string, attachments: InputObjectRef[]): boolean {
  return shouldRunWorkBookIntake(appMode as AppMode, attachments);
}

function buildTaskInput(request: WorkDispatchRequest, outcome: WorkBookDispatchResult): WorkDispatchTaskInput {
  const input: WorkDispatchTaskInput = {
    title: outcome.title || request.title?.trim() || "Untitled task",
    objective: outcome.objective || (request.prompt ?? "").trim(),
    providerIds: request.providerIds,
    appMode: request.appMode,
    conversationId: request.conversationId
  };
  // Every optional bridge field is passed through unchanged when supplied.
  if (request.mode) input.mode = request.mode;
  if (request.transports) input.transports = request.transports;
  if (request.inputObjectIds?.length) input.inputObjectIds = request.inputObjectIds;
  if (request.reviewPolicy) input.reviewPolicy = request.reviewPolicy;
  if (request.finalizationPolicy) input.finalizationPolicy = request.finalizationPolicy;
  if (request.workAgentCount) input.workAgentCount = request.workAgentCount;
  if (request.runMode) input.runMode = request.runMode;
  if (request.conversationPolicy) input.conversationPolicy = request.conversationPolicy;
  return input;
}

/**
 * Runs the full production WorkBook dispatch chain for one Work request.
 * Returns a discriminated outcome whose kind, task status and WorkBook stage
 * always agree; every durable mutation is already applied.
 */
export async function runWorkDispatch(
  request: WorkDispatchRequest,
  deps: WorkDispatchDeps
): Promise<WorkDispatchOutcome> {
  const store = deps.store;
  const intake = deps.intake ?? runWorkBookDispatch;
  const publish = deps.publish ?? (() => undefined);
  const knownTaskIds = new Set(store.snapshot().tasks.map((task) => task.id));

  // Step 1: intake. Reads the registry for relations, never writes it.
  const outcome = await intake({
    prompt: request.prompt ?? "",
    title: request.title ?? "",
    conversationId: request.conversationId,
    attachments: request.attachments,
    ...(request.inputObjectIds?.length ? { inputObjectIds: request.inputObjectIds } : {}),
    workspacePath: request.workspacePath,
    allowProviderDispatch: true,
    existingWorkbookTasks: workflowTasksByHash(store)
  }, { registry: request.registry, ...(request.limits ? { limits: request.limits } : {}) });

  // The compiled objective is the authoritative intent for a blank message.
  assertDispatchGroupSize(request.prompt ?? "", outcome.objective, request.providerIds.length);

  // Exact duplicate: resume the existing task, create nothing. The reuse target
  // must still exist in THIS store — a hash recorded elsewhere must never be
  // resolved into a foreign task id.
  if (outcome.reused && outcome.reuse_task_id && knownTaskIds.has(outcome.reuse_task_id)) {
    return { kind: "REUSED", taskId: outcome.reuse_task_id };
  }

  // Step 2: create the task, then durably persist the WorkBook record. No
  // registry write has happened yet, so a crash here leaves nothing orphaned.
  const task = deps.commander.createTask(buildTaskInput(request, outcome));
  store.setWorkbookDispatch(task.id, outcome.record);
  publish();

  /** Every terminal branch of this dispatch records its facts once (§5.3). */
  const finish = (result: WorkDispatchOutcome): WorkDispatchOutcome => {
    recordDispatchKnowledge(deps, { request, taskId: task.id, record: outcome.record, result });
    return result;
  };

  // Step 3: commit revisions with the real task id, in ONE call per document,
  // and only for hashes the registry does not already know. A crash between 2
  // and 3 is repaired at startup from the durable record written above.
  for (const revision of outcome.revisionPlan) {
    if (request.registry.documentIdForHash(revision.hash)) {
      request.registry.linkRevisionTask(revision.hash, task.id);
      continue;
    }
    request.registry.record(revision, task.id);
  }
  publish();

  if (outcome.blocked) {
    store.discardUnstartedRuns(task.id);
    const reason = outcome.record.blocked_reason ?? "WorkBook intake refused";
    store.setTaskStatus(task.id, "failed", reason);
    publish();
    return finish({ kind: "BLOCKED", taskId: task.id, reason });
  }

  if (outcome.analysisOnly) {
    // The compiled contract is the deliverable: no provider work at all.
    store.completeWorkbookAnalysis(task.id);
    publish();
    return finish({ kind: "ANALYSIS_ONLY", taskId: task.id });
  }

  if (!outcome.autoRun) {
    // Reference/ambiguous WorkBook: durable record kept, provider untouched.
    store.discardUnstartedRuns(task.id);
    publish();
    return finish({
      kind: "NO_AUTO_RUN",
      taskId: task.id,
      ...(outcome.record.classification ? { classification: outcome.record.classification } : {})
    });
  }

  // Defensive: reaching this point with a zero-run boundary would be a bug in
  // the dispatch decision, not a provider problem.
  if (requiresZeroProviderRuns(outcome.record.classification, outcome.analysisOnly)) {
    store.discardUnstartedRuns(task.id);
    publish();
    return finish({ kind: "NO_AUTO_RUN", taskId: task.id });
  }

  // Exactly one dispatch path, shared with Resume below.
  const execution = await triggerTaskExecution(task.id, { workspacePath: request.workspacePath }, deps);
  publish();
  if (execution.ok) return finish({ kind: "DISPATCHED", taskId: task.id });
  return finish(execution.terminal
    ? { kind: "FAILED", taskId: task.id, message: execution.message }
    : { kind: "RECOVERY_WAITING", taskId: task.id, message: execution.message });
}

/** Result of driving provider work for one existing task. */
export type TaskExecutionResult =
  | { ok: true }
  | { ok: false; terminal: false; message: string; code: string }
  | { ok: false; terminal: true; message: string; code: string };

/**
 * REPAIR_BATCH_5: the single production provider-driving chain for an EXISTING
 * task. Used after creation and by Resume (`boss:update-task` on a waiting
 * WorkBook). It never creates a task, never re-ingests and never re-registers a
 * WorkBook — it only drives execution and reflects the truthful outcome.
 *
 * `startTask` emits status "running", which is what appends RUNNING to the
 * WorkBook stage ladder (append-once, so a resume shows RUNNING after WAITING
 * exactly once).
 */
export async function triggerTaskExecution(
  taskId: string,
  options: { workspacePath: string },
  deps: Pick<WorkDispatchDeps, "store" | "commander" | "automation">
): Promise<TaskExecutionResult> {
  const { store, commander, automation } = deps;
  commander.startTask(taskId);
  try {
    const deterministic = await commander.executeDeterministic(taskId, options.workspacePath);
    if (!deterministic) {
      const planned = await commander.executePlan(taskId, options.workspacePath);
      if (!planned) await automation.dispatchTask(taskId);
    }
    await automation.continueIfReady(taskId);
    return { ok: true };
  } catch (error) {
    const verdict = classifyExecutionError(error);
    if (verdict.kind === "TERMINAL") {
      // Unrecoverable: task failed, WorkBook FAILED, message preserved.
      store.setTaskStatus(taskId, "failed", verdict.message);
      return { ok: false, terminal: true, message: verdict.message, code: verdict.code };
    }
    // Transient: retryable through the existing Resume path, so task/outcome/
    // stage all say WAITING.
    store.enterRecoveryWaiting(taskId, verdict.message);
    return { ok: false, terminal: false, message: verdict.message, code: verdict.code };
  }
}

/** Where a resumed WorkBook task's workspace lives, from its durable record. */
export function resumeWorkspaceFor(task: { workspacePath?: string }, fallback: string): string {
  return task.workspacePath && fs.existsSync(task.workspacePath) ? fs.realpathSync(task.workspacePath) : fallback;
}

/**
 * REPAIR_BATCH_5: Resume entry for an existing waiting WorkBook task.
 *
 * Returns `undefined` when this task is not a resumable WorkBook (so the caller
 * keeps its legacy handling), otherwise the real execution outcome. The task id
 * is always the caller's: no second task is created and the WorkBook is neither
 * re-ingested nor re-registered.
 */
export async function resumeWorkBookTask(
  task: {
    id: string;
    status?: string;
    workbookDispatch?: { auto_run?: boolean; stage?: string };
  },
  options: { workspacePath: string },
  deps: Pick<WorkDispatchDeps, "store" | "commander" | "automation"> & { registry?: WorkbookRegistry }
): Promise<TaskExecutionResult | undefined> {
  if (task.status !== "waiting") return undefined;
  if (!task.workbookDispatch) return undefined;
  // Only an auto-run WorkBook ever drove providers; reference/ambiguous and
  // analysis-only tasks have no execution to resume.
  if (task.workbookDispatch.auto_run !== true) return undefined;
  return triggerTaskExecution(task.id, { workspacePath: options.workspacePath }, deps);
}
