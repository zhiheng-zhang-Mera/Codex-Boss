/**
 * Runtime Intelligence Plane — the live shadow capture adapter.
 *
 * This is the module that finally stands beside the running loop instead of beside a corpus. It
 * attaches to two seams the application already had, and changes neither of them:
 *
 *   1. **The task ledger's single write path.** `TaskLedger.save()` is where every checkpoint is
 *      written — `create`, `update`, `recordStage`, `markVerification` and `markReviewFindings`
 *      all funnel through it. `createCaptureObservingLedger` returns a ledger that calls
 *      `super.save()` and then *tells* the capture what was written. The ledger's own behaviour is
 *      untouched: the returned record is the one the superclass produced.
 *   2. **The domain event bus.** `DomainEventBus` already isolates handlers — a throwing handler
 *      is recorded and never blocks the publisher — so a capture subscriber is the shape the bus
 *      was built for.
 *
 * Three properties are enforced here rather than promised:
 *
 *   - **Fail-open.** Every public method catches everything. A disk error, a schema mismatch, a
 *     refused observation or an unavailable registry marks the capture unhealthy and returns; it
 *     never propagates into the loop that called it. `capture failure != task failure`.
 *   - **Observe only.** There is no `stopTask`, `switchModel`, `routeTask`, `restartTask`,
 *     `modifyTask` or `deleteSkill`, and no path from here to one. The class cannot influence
 *     execution because it is never given anything that could: it receives a record that has
 *     already been written and returns nothing the caller reads.
 *   - **Identity fixed at open.** The window is opened through `ensureTask`, which returns the
 *     existing record unchanged when one exists. That is the restart path: the same `taskId` after
 *     a crash is the same prospective task, with the policy identity it opened under, and the
 *     four policy hashes are recorded there and never rewritten.
 *
 * What is captured is whatever the loop actually recorded: checkpoints, worker sessions, job
 * timings, provider-reported usage, tool counters and the provider run outcomes on the bus. What
 * is absent is recorded as absent — `COST` and `SKILL` have no producer in this application, and
 * that is written down as `NOT_MEASURED` and `NO_SKILL_RUNTIME_SIGNAL` rather than estimated.
 */

import fs from "node:fs";
import path from "node:path";
import { TaskLedger, type TaskLedgerRecord } from "../commander/task-ledger";
import { DomainEventBus, type DomainEvent } from "../commander/event-bus";
import { runtimeIntelligenceRoot } from "./runtime-intelligence-service";
import { ProspectiveWindowStore } from "./prospective-store";
import {
  CAPTURE_SOURCE_CLASSES,
  headlineCaptureMetrics,
  isTerminalCaptureStatus,
  providerEventOf,
  stepObservationOf,
  type CaptureSourceClass,
  type HeadlineCaptureMetrics,
  type LiveLedgerFacts,
  type ProspectiveProviderEvent
} from "../../src/shared/runtime-intelligence/live-capture";
import { prospectiveHeadline, type ProspectiveMetrics, type ProspectiveWindowRecord } from "../../src/shared/runtime-intelligence/prospective-window";
import type { ModelCapabilityRecord, TaskKind } from "../../src/shared/runtime-intelligence/contracts";

/** How many capture failures are retained for a reader (bounded; oldest dropped). */
export const CAPTURE_FAILURE_RETENTION = 50;

/** The bus event types the capture subscribes to. Nothing else is observed. */
export const CAPTURED_EVENT_TYPES = ["WORKER_COMPLETED", "WORKER_FAILED"] as const;

/**
 * Where the capture is attached, as data.
 *
 * A report should not have to assert "the producer is attached" in prose: these are the two seams
 * and the call each one makes, and `tests/unit/runtime-intelligence/live-capture.test.ts` reads
 * both files and checks the call is really there. An attachment that was removed would fail the
 * test rather than quietly leave a report claiming capture.
 */
export const LIVE_CAPTURE_ATTACHMENTS: ReadonlyArray<{ seam: string; mechanism: string; call: string; captures: readonly string[] }> = [
  {
    seam: "electron/bootstrap/persistence.ts",
    mechanism: "the task ledger's single write path, wrapped rather than modified",
    call: "createCaptureObservingLedger(",
    captures: ["TASK_OPENED", "STEP_OBSERVED", "PROVIDER_DISPATCH", "PROVIDER_IDENTITY", "USAGE", "LATENCY", "CONTINUATION_ADVICE", "SCHEDULER_ADVICE", "FINAL_OUTCOME"]
  },
  {
    seam: "electron/bootstrap/automation.ts",
    mechanism: "the existing domain event bus, as a fourth observer",
    call: "attachRuntimeIntelligenceCapture(",
    captures: ["PROVIDER_OUTCOME"]
  }
];

export interface LiveCaptureFailure {
  at: string;
  operation: string;
  message: string;
}

export interface LiveCaptureOptions {
  /** The application data root this process runs against (`app.getPath("userData")` in production). */
  dataRoot: string;
  now?: () => string;
  /** The store's own task creation time, which is what decides the evidence class. */
  openedAt?: (taskId: string) => string | undefined;
  /** The store's task status, which is the only thing that may close a window. */
  taskStatus?: (taskId: string) => string | undefined;
  /** Adviser inputs the plane already holds. Empty means the scheduler advice is UNAVAILABLE. */
  models?: () => readonly ModelCapabilityRecord[];
  taskKind?: (taskId: string) => TaskKind | undefined;
  /**
   * What these observations are. A smoke run says so, so it can never enter the headline; the
   * default is the real thing because that is what the live loop produces.
   */
  sourceClass?: CaptureSourceClass;
}

/**
 * The producer's read-only status.
 *
 * `captureHealthy: false` is a report, not a brake: nothing in this plane gates Boss on it.
 */
export interface LiveCaptureStatus {
  captureAttached: boolean;
  captureHealthy: boolean;
  mode: "LIVE_SHADOW_CAPTURE";
  /** Literal: this plane observes and can never act. */
  executionAuthority: false;
  sourceClass: CaptureSourceClass;
  lastCaptureAt?: string;
  tasksObserved: number;
  stepsObserved: number;
  recordsWritten: number;
  recordsRejected: number;
  recordsDeduplicated: number;
  windowsClosed: number;
  restartsRecognised: number;
  providerEventsObserved: number;
  lastError?: string;
  lastRejection?: string;
  failures: LiveCaptureFailure[];
  windows: number;
  openWindows: number;
}

interface CaptureOutcome {
  ok: boolean;
  problems: string[];
  deduplicated?: boolean;
}

/**
 * The live capture producer.
 *
 * Deliberately not an event emitter, not a scheduler and not a controller: its whole surface is
 * "here is something that happened" and "here is what happened so far".
 */
export class RuntimeIntelligenceCapture {
  private readonly options: LiveCaptureOptions;
  private readonly now: () => string;
  private readonly store: ProspectiveWindowStore;
  private readonly known = new Set<string>();
  private readonly failures: LiveCaptureFailure[] = [];
  private lastError?: string;
  private lastRejection?: string;
  private lastCaptureAt?: string;
  private attached = false;
  private tasks = 0;
  private steps = 0;
  private written = 0;
  private rejected = 0;
  private deduplicated = 0;
  private closed = 0;
  private restarts = 0;
  private providerEvents = 0;

  constructor(options: LiveCaptureOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
    this.store = new ProspectiveWindowStore({ rootDir: path.join(runtimeIntelligenceRoot(options.dataRoot), "prospective") });
  }

  /** Records a failure. Never throws, including when the failure is itself unprintable. */
  private failed(operation: string, error: unknown): void {
    try {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.lastError = message;
      this.failures.push({ at: this.now(), operation, message });
      if (this.failures.length > CAPTURE_FAILURE_RETENTION) this.failures.splice(0, this.failures.length - CAPTURE_FAILURE_RETENTION);
      // The desktop app's own log is where a background capture failure has to surface, because
      // nothing downstream reads the status in order to decide anything.
      console.error(`[runtime-intelligence-capture] ${operation} failed: ${message}`);
    } catch {
      /* a failure that cannot be described must not become a failure that stops the loop */
    }
  }

  private source(): CaptureSourceClass {
    const source = this.options.sourceClass ?? "REAL_USER_TASK";
    return CAPTURE_SOURCE_CLASSES.includes(source) ? source : "REAL_USER_TASK";
  }

  private openedAtFor(taskId: string, at: string): string | undefined {
    try {
      const resolved = this.options.openedAt?.(taskId);
      return resolved !== undefined && Number.isFinite(Date.parse(resolved)) ? resolved : undefined;
    } catch (error) {
      this.failed("openedAt", error);
      return undefined;
    }
  }

  /**
   * Opens the window for a task if it does not have one, and returns the task's record either way.
   *
   * A bus event may arrive before the task's first checkpoint, and a task whose open time the
   * store cannot supply is REFUSED rather than opened: without its creation time the evidence
   * class cannot be decided, and a record that cannot be placed relative to the freeze is not
   * evidence about it.
   */
  private ensureWindow(input: { taskId: string; at: string }): { ok: boolean; record?: ProspectiveWindowRecord; problems: string[] } {
    const openedAt = this.openedAtFor(input.taskId, input.at);
    if (openedAt === undefined) {
      return { ok: false, problems: [`the store holds no creation time for task ${input.taskId}, so its evidence class cannot be decided and the window is not opened`] };
    }
    const ensured = this.store.ensureTask({ taskId: input.taskId, openedAt, sourceClass: this.source() });
    if (!ensured.ok || ensured.record === undefined) return { ok: false, problems: ensured.problems };
    if (ensured.opened) {
      this.tasks += 1;
    } else if (!this.known.has(input.taskId)) {
      // The window existed before this process observed the task: that is a restart, not a task.
      this.restarts += 1;
    }
    this.known.add(input.taskId);
    return { ok: true, record: ensured.record, problems: [] };
  }

  /**
   * Counts an observation that could not be recorded.
   *
   * A refusal and a store failure are both a lost observation, and both are counted here; which
   * one it was is in `lastRejection` or `failures`. Counting only the refusals would let a broken
   * store look like a capture that had nothing to do.
   */
  private reject(operation: string, problems: readonly string[]): CaptureOutcome {
    this.rejected += 1;
    this.lastRejection = `${operation}: ${problems.join("; ")}`;
    return { ok: false, problems: [...problems] };
  }

  /**
   * Captures one checkpoint.
   *
   * Called from the ledger's write path, after the checkpoint is already on disk. Nothing returned
   * here is read by the ledger, and no branch throws.
   */
  observeCheckpoint(input: { taskId: string; facts: LiveLedgerFacts; at?: string }): CaptureOutcome {
    try {
      const at = input.at ?? this.now();
      const window = this.ensureWindow({ taskId: input.taskId, at });
      if (!window.ok || window.record === undefined) return this.reject("observeCheckpoint", window.problems);
      const previous = window.record.steps[window.record.steps.length - 1];
      const taskKind = this.options.taskKind?.(input.taskId);
      const built = stepObservationOf({
        facts: input.facts,
        capturedAt: at,
        ...(previous === undefined ? {} : { previousCapturedAt: previous.capturedAt }),
        sourceClass: this.source(),
        ...(taskKind === undefined ? {} : { taskKind }),
        ...(this.options.models === undefined ? {} : { models: this.options.models() })
      });
      if (!built.ok || built.observation === undefined) return this.reject("observeCheckpoint", built.problems);
      const appended = this.store.appendObservation({ taskId: input.taskId, observation: built.observation });
      if (!appended.ok) return this.reject("observeCheckpoint", appended.problems);
      if (appended.deduplicated === true) {
        this.deduplicated += 1;
        return { ok: true, problems: [], deduplicated: true };
      }
      this.steps += 1;
      this.written += 1;
      this.lastCaptureAt = at;
      this.closeIfTerminal({ taskId: input.taskId, at });
      return { ok: true, problems: [] };
    } catch (error) {
      this.failed("observeCheckpoint", error);
      return this.reject("observeCheckpoint", [error instanceof Error ? error.message : String(error)]);
    }
  }

  /**
   * Closes the window when the store says the task is over.
   *
   * Only the application's own task status may close a window: a run outcome, a completed step or
   * the loop's own completion statement are all things that can be followed by more work, and the
   * measured corpus contains tasks that continued after stating completion.
   */
  private closeIfTerminal(input: { taskId: string; at: string }): void {
    try {
      const status = this.options.taskStatus?.(input.taskId);
      if (!isTerminalCaptureStatus(status)) return;
      const closed = this.store.closeTask({ taskId: input.taskId, finalOutcome: "UNKNOWN", taskStatus: status, closedAt: input.at });
      if (closed.ok) this.closed += 1;
      else this.reject("closeTask", closed.problems);
    } catch (error) {
      this.failed("closeTask", error);
    }
  }

  /**
   * Captures a provider run outcome from the domain event bus.
   *
   * A run result is recorded as an OUTCOME record about the run and never closes the window.
   */
  observeProviderEvent(input: { type: string; taskId?: string; runtimeId?: string; jobId?: string; at?: string }): CaptureOutcome {
    try {
      if (input.taskId === undefined || input.taskId === "") {
        return this.reject("observeProviderEvent", ["the event named no task, so it cannot be attributed to a window"]);
      }
      const at = input.at ?? this.now();
      const window = this.ensureWindow({ taskId: input.taskId, at });
      if (!window.ok) return this.reject("observeProviderEvent", window.problems);
      const event: ProspectiveProviderEvent = providerEventOf({
        eventType: input.type,
        taskId: input.taskId,
        ...(input.runtimeId === undefined ? {} : { runtimeId: input.runtimeId }),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
        at
      });
      const appended = this.store.appendProviderEvent({ taskId: input.taskId, event });
      if (!appended.ok) return this.reject("observeProviderEvent", appended.problems);
      if (appended.deduplicated) {
        this.deduplicated += 1;
        return { ok: true, problems: [], deduplicated: true };
      }
      this.providerEvents += 1;
      this.written += 1;
      this.lastCaptureAt = at;
      return { ok: true, problems: [] };
    } catch (error) {
      this.failed("observeProviderEvent", error);
      return this.reject("observeProviderEvent", [error instanceof Error ? error.message : String(error)]);
    }
  }

  /** Marks the capture as attached to a live bus. Called by the attachment helper. */
  markAttached(): void {
    this.attached = true;
  }

  /** Every window the store holds. Read-only, and empty when the log is unreadable. */
  records(): ProspectiveWindowRecord[] {
    try {
      return this.store.records();
    } catch (error) {
      this.failed("records", error);
      return [];
    }
  }

  /** The headline prospective metrics: real user tasks only, with the exclusions counted. */
  headline(): ProspectiveMetrics & { excludedBySourceClass: Record<string, number> } {
    try {
      return prospectiveHeadline(this.records());
    } catch (error) {
      this.failed("headline", error);
      return { ...emptyHeadline(), excludedBySourceClass: { UNREADABLE: 1 }, notes: [`the window could not be read: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  /** Per-observation capture coverage, over real user tasks only. */
  coverage(): HeadlineCaptureMetrics {
    try {
      return headlineCaptureMetrics(this.records().flatMap((record) => record.steps));
    } catch (error) {
      this.failed("coverage", error);
      return { headline: { tasks: 0, steps: 0, dispatchRecords: 0, latencyMeasured: 0, tokensMeasured: 0, costMeasured: 0, skillSignalPresent: 0 }, excluded: {}, notes: [`the observations could not be read: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  status(): LiveCaptureStatus {
    let records: ProspectiveWindowRecord[] = [];
    let open = 0;
    try {
      records = this.store.records();
      open = records.filter((record) => record.outcome === undefined).length;
    } catch (error) {
      this.failed("status", error);
    }
    return {
      captureAttached: this.attached,
      captureHealthy: this.failures.length === 0 && this.lastError === undefined,
      mode: "LIVE_SHADOW_CAPTURE",
      executionAuthority: false,
      sourceClass: this.source(),
      ...(this.lastCaptureAt === undefined ? {} : { lastCaptureAt: this.lastCaptureAt }),
      tasksObserved: this.tasks,
      stepsObserved: this.steps,
      recordsWritten: this.written,
      recordsRejected: this.rejected,
      recordsDeduplicated: this.deduplicated,
      windowsClosed: this.closed,
      restartsRecognised: this.restarts,
      providerEventsObserved: this.providerEvents,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      ...(this.lastRejection === undefined ? {} : { lastRejection: this.lastRejection }),
      failures: [...this.failures],
      windows: records.length,
      openWindows: open
    };
  }
}

function emptyHeadline(): ProspectiveMetrics {
  return {
    tasks: 0,
    tasksClosed: 0,
    continuationSteps: 0,
    stopAdvisories: 0,
    falseStops: 0,
    falseStopRate: undefined,
    stopPrecision: undefined,
    stopSupportCount: 0,
    continueAdvisories: 0,
    unnecessaryContinues: 0,
    unnecessaryContinueRate: undefined,
    callsSaved: 0,
    weightedPenalty: 0,
    decisionsSeen: [],
    classSupport: "INSUFFICIENT_CLASS_SUPPORT",
    verdict: "INSUFFICIENT_EVIDENCE",
    safetyStatement: "no STOP advisory has been observed, so nothing is known about stop safety",
    notes: []
  };
}

/**
 * A task ledger that reports every checkpoint it writes, and behaves identically otherwise.
 *
 * `save` is the only method overridden because it is the only write path: `create`, `update`,
 * `recordStage`, `markVerification` and `markReviewFindings` all call it. The observation happens
 * AFTER `super.save()` has returned, so a capture that throws cannot prevent the checkpoint from
 * being written, and the value returned to the caller is the superclass's own record.
 */
export class CaptureObservingTaskLedger extends TaskLedger {
  constructor(root: string, private readonly capture: RuntimeIntelligenceCapture, private readonly clock: () => string = () => new Date().toISOString()) {
    super(root);
  }

  override save(record: TaskLedgerRecord, reason: string): TaskLedgerRecord {
    const saved = super.save(record, reason);
    try {
      // `TaskLedgerRecord` satisfies `LiveLedgerFacts` structurally: the capture reads the ledger's
      // own field names and never asks for anything the ledger does not write.
      const facts: LiveLedgerFacts = saved;
      this.capture.observeCheckpoint({ taskId: saved.taskId, facts, at: this.clock() });
    } catch (error) {
      // Unreachable in practice — observeCheckpoint catches everything — but the checkpoint is
      // already durable and this method must never be the reason a write appears to fail.
      console.error(`[runtime-intelligence-capture] ledger observation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return saved;
  }
}

/** Builds the observing ledger for a task-ledger root. */
export function createCaptureObservingLedger(input: { root: string; capture: RuntimeIntelligenceCapture; now?: () => string }): TaskLedger {
  return new CaptureObservingTaskLedger(input.root, input.capture, input.now ?? (() => new Date().toISOString()));
}

/** What an attachment returns, so the boot module can report it without reaching inside. */
export interface LiveCaptureAttachment {
  capture: RuntimeIntelligenceCapture;
  /** The event types subscribed, named so a boot log can show them. */
  eventTypes: readonly string[];
  /** Idempotent; unsubscribes every handler the attachment registered. */
  detach(): void;
}

/**
 * Subscribes the capture to the domain event bus.
 *
 * The handler does nothing but hand the event to the adapter, which catches everything, so a
 * capture failure cannot become a handler failure and can never reach the publisher.
 */
export function attachRuntimeIntelligenceCapture(events: DomainEventBus, input: { capture: RuntimeIntelligenceCapture }): LiveCaptureAttachment {
  const unsubscribes = CAPTURED_EVENT_TYPES.map((type) =>
    events.subscribe(type, (event: DomainEvent) => {
      input.capture.observeProviderEvent({
        type: event.type,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
        ...(event.runtimeId === undefined ? {} : { runtimeId: event.runtimeId }),
        ...(event.jobId === undefined ? {} : { jobId: event.jobId }),
        at: new Date(event.at).toISOString()
      });
    })
  );
  input.capture.markAttached();
  let detached = false;
  return {
    capture: input.capture,
    eventTypes: [...CAPTURED_EVENT_TYPES],
    detach: () => {
      if (detached) return;
      detached = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  };
}

/**
 * Runs the smoke walk a first attachment needs: a real ledger, the real bus, a temporary root.
 *
 * It is here rather than in a script so the report and the test drive the same code, and it says
 * `DEVELOPMENT_SMOKE` on every record it produces, so nothing it writes can enter a headline.
 */
export function runLiveCaptureSmoke(input: { dataRoot: string; now?: () => string }): {
  status: LiveCaptureStatus;
  window?: ProspectiveWindowRecord;
  headlineTasks: number;
  checkpointFiles: number;
  problems: string[];
} {
  const now = input.now ?? (() => new Date().toISOString());
  let taskStatus: string | undefined = "running";
  const capture = new RuntimeIntelligenceCapture({ dataRoot: input.dataRoot, now, openedAt: () => now(), taskStatus: () => taskStatus, sourceClass: "DEVELOPMENT_SMOKE" });
  const events = new DomainEventBus();
  const attachment = attachRuntimeIntelligenceCapture(events, { capture });
  const ledgerRoot = path.join(input.dataRoot, ".boss", "tasks");
  const ledger = createCaptureObservingLedger({ root: ledgerRoot, capture, now });
  const problems: string[] = [];
  try {
    ledger.create("smoke-task", "a smoke objective that is never a user task");
    events.publish({ type: "WORKER_COMPLETED", taskId: "smoke-task", runtimeId: "web:smoke", jobId: "smoke-job-1" });
    ledger.update("smoke-task", "task/run transition", (record) => {
      record.completedSteps = ["smoke-step-a"];
      record.pendingSteps = ["smoke-step-b"];
      record.nextAction = "DISPATCHING";
      record.sessions = [{ id: "smoke-run-1", provider: "web:smoke", taskId: "smoke-task", checkpoint: 2, health: "SUCCESS", resumeStrategy: "RECONSTRUCT" }];
    });
    taskStatus = "completed";
    ledger.update("smoke-task", "task/run transition", (record) => {
      record.completedSteps = ["smoke-step-a", "smoke-step-b"];
      record.pendingSteps = [];
      record.nextAction = "REPORT_EVIDENCE";
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    attachment.detach();
  }
  let checkpointFiles = 0;
  try {
    checkpointFiles = fs.readdirSync(path.join(ledgerRoot, "smoke-task", "checkpoints")).length;
  } catch {
    checkpointFiles = 0;
  }
  return {
    status: capture.status(),
    ...(capture.records()[0] === undefined ? {} : { window: capture.records()[0] }),
    headlineTasks: capture.headline().tasks,
    checkpointFiles,
    problems
  };
}

/** Builds the store a capture reads, for a caller that only wants to inspect the window. */
export function openProspectiveWindow(dataRoot: string): ProspectiveWindowStore {
  return new ProspectiveWindowStore({ rootDir: path.join(runtimeIntelligenceRoot(dataRoot), "prospective") });
}

