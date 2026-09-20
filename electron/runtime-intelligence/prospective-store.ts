/**
 * Runtime Intelligence Plane — the durable prospective window store.
 *
 * A JSONL log of window records, appended by the live path. The store's only real job is to make
 * the ordering rules of `prospective-window.ts` hold across process restarts: an advisory cannot
 * be added to a closed task, and a task cannot be closed under a different policy hash than the
 * one it opened under.
 *
 * Nothing here can change a policy or a decision. It reads the frozen policy's identity from the
 * registry at open time and writes records about what the shadow advice said.
 */

import fs from "node:fs";
import path from "node:path";
import { frozenContinuationPolicy } from "../../src/shared/runtime-intelligence/policy-registry";
import {
  PROSPECTIVE_WINDOW_SCHEMA_VERSION,
  appendProspectiveAdvisory,
  appendProspectiveObservation,
  appendProviderEvent as appendProviderEventToRecord,
  closeProspectiveRecord,
  markCaptureEvent,
  openProspectiveRecord,
  prospectiveMetrics,
  type CaptureSourceClass,
  type ProspectiveAdvisory,
  type ProspectiveMetrics,
  type ProspectiveStepOutcome,
  type ProspectiveWindowRecord,
  type WindowOperation
} from "../../src/shared/runtime-intelligence/prospective-window";
import type { LiveStepObservation, ProspectiveProviderEvent } from "../../src/shared/runtime-intelligence/live-capture";

export const PROSPECTIVE_WINDOW_FILENAME = "prospective-window.jsonl";

export interface ProspectiveStoreOptions {
  rootDir: string;
  now?: () => string;
}

export interface ProspectiveStoreStatus {
  schemaVersion: number;
  rootDir: string;
  file: string;
  records: number;
  open: number;
  closed: number;
  steps: number;
  observationsRecorded: number;
  observationsDeduplicated: number;
  /** Rows currently in the log, which compaction keeps bounded per window. */
  logRows: number;
  policyId: string;
  policyHash: string;
  bytes: number;
  degradedReason?: string;
}

/**
 * How many log rows one window may accumulate before the log is rewritten compactly.
 *
 * Rows are full snapshots of a window, so a task with many checkpoints would otherwise leave the
 * log growing quadratically. Compaction keeps one row per window. It is safe for the ordering
 * evidence because that evidence is not carried by row order: every append stamps its own
 * `capturedAt` or `observedAt`, every step says `recordKind: DECISION_TIME_RECORD`, and a closed
 * window carries `outcome.closedAt`, which is later than every advice it scores.
 */
export const PROSPECTIVE_WINDOW_ROWS_PER_WINDOW = 16;

interface ParsedLog {
  /** A key that changes whenever the file does: size and modification time. */
  key: string;
  byId: Map<string, ProspectiveWindowRecord>;
  rows: number;
}

export class ProspectiveWindowStore {
  private readonly options: ProspectiveStoreOptions;
  private readonly now: () => string;
  private degradedReason?: string;
  private recorded = 0;
  private deduplicated = 0;
  private cache?: ParsedLog;

  constructor(options: ProspectiveStoreOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private file(): string {
    return path.join(this.options.rootDir, PROSPECTIVE_WINDOW_FILENAME);
  }

  /** A key for the current file state, or `absent` when there is no file yet. */
  private keyOf(file: string): string {
    try {
      const stat = fs.statSync(file);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return "absent";
    }
  }

  private order(byId: Map<string, ProspectiveWindowRecord>): ProspectiveWindowRecord[] {
    return [...byId.values()].sort((left, right) => (left.openedAt < right.openedAt ? -1 : left.openedAt > right.openedAt ? 1 : 0));
  }

  /**
   * Every record, one per task.
   *
   * The log is append-only, so the LAST row for a window id is its current state. The parsed
   * result is cached against the file's size and modification time: a checkpoint observation asks
   * for the window four times over, and re-reading the whole log for each of those would make the
   * capture's cost grow with the log on the live path it was just attached to. An external writer
   * (another process, a hand-edit) changes the key and is picked up on the next read.
   */
  records(): ProspectiveWindowRecord[] {
    const file = this.file();
    const key = this.keyOf(file);
    if (this.cache !== undefined && this.cache.key === key) return this.order(this.cache.byId);
    if (key === "absent") {
      this.cache = { key, byId: new Map(), rows: 0 };
      return [];
    }
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      this.degradedReason = `${PROSPECTIVE_WINDOW_FILENAME} could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
    const byId = new Map<string, ProspectiveWindowRecord>();
    let rows = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      rows += 1;
      try {
        const parsed = JSON.parse(line) as ProspectiveWindowRecord;
        if (typeof parsed.windowId !== "string") continue;
        byId.set(parsed.windowId, parsed);
      } catch {
        // One unparseable row costs one row, not the window.
      }
    }
    this.cache = { key, byId, rows };
    return this.order(byId);
  }

  record(taskId: string): ProspectiveWindowRecord | undefined {
    return this.records().find((entry) => entry.taskId === taskId);
  }

  private append(record: ProspectiveWindowRecord): void {
    fs.mkdirSync(this.options.rootDir, { recursive: true });
    fs.appendFileSync(this.file(), `${JSON.stringify(record)}\n`, "utf8");
    if (this.cache === undefined) {
      this.records();
      return;
    }
    this.cache.byId.set(record.windowId, record);
    this.cache.rows += 1;
    this.cache.key = this.keyOf(this.file());
    this.compactIfOversized();
  }

  /**
   * Rewrites the log as one row per window when it has grown past the bound.
   *
   * The rewrite is atomic — a temporary file and a rename — so a crash cannot leave a half-written
   * log, and it keeps the newest state of every window, which is what a reader folds for anyway.
   */
  private compactIfOversized(): void {
    const cache = this.cache;
    if (cache === undefined) return;
    const limit = PROSPECTIVE_WINDOW_ROWS_PER_WINDOW * Math.max(1, cache.byId.size);
    if (cache.rows <= limit) return;
    const file = this.file();
    const temporary = `${file}.compact-${process.pid}`;
    const body = this.order(cache.byId).map((entry) => `${JSON.stringify(entry)}\n`).join("");
    fs.writeFileSync(temporary, body, "utf8");
    fs.renameSync(temporary, file);
    this.cache = { key: this.keyOf(file), byId: cache.byId, rows: cache.byId.size };
  }

  /** Opens a window for a task, fixing the frozen policy's hash before anything else happens. */
  openTask(input: { taskId: string; openedAt?: string; sourceClass?: CaptureSourceClass }): WindowOperation {
    if (this.record(input.taskId) !== undefined) {
      return { ok: false, problems: [`a window already exists for ${input.taskId}`] };
    }
    const opened = openProspectiveRecord({ taskId: input.taskId, openedAt: input.openedAt ?? this.now(), ...(input.sourceClass === undefined ? {} : { sourceClass: input.sourceClass }) });
    if (!opened.ok || opened.record === undefined) return opened;
    this.append(opened.record);
    return opened;
  }

  /**
   * Opens the window unless the task already has one.
   *
   * This is the restart path. Boss may be closed and reopened while a task is running, and the
   * same task must not become a second prospective task on the next start: the existing record —
   * with the policy identity it opened under — is returned unchanged, and `opened` says which of
   * the two happened so a caller can count restarts apart from new tasks.
   */
  ensureTask(input: { taskId: string; openedAt?: string; sourceClass?: CaptureSourceClass }): WindowOperation & { opened: boolean } {
    const existing = this.record(input.taskId);
    if (existing !== undefined) return { ok: true, record: existing, problems: [], opened: false };
    const result = this.openTask(input);
    return { ...result, opened: result.ok };
  }

  /** Appends a shadow advisory, refusing a closed window. */
  appendAdvisory(input: { taskId: string; advisory: ProspectiveAdvisory }): WindowOperation {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, problems: [`no window is open for ${input.taskId}`] };
    const result = appendProspectiveAdvisory(existing, input.advisory);
    if (!result.ok || result.record === undefined) return result;
    this.append(result.record);
    return result;
  }

  /**
   * Appends one decision-time observation, idempotently.
   *
   * A repeated checkpoint is recognised by its identity and leaves the log alone, which is what
   * makes a replayed event or a second observation pass harmless.
   */
  appendObservation(input: { taskId: string; observation: LiveStepObservation }): WindowOperation {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, problems: [`no window is open for ${input.taskId}`] };
    const result = appendProspectiveObservation(existing, input.observation);
    if (!result.ok || result.record === undefined) return result;
    if (result.deduplicated === true) {
      this.deduplicated += 1;
      return result;
    }
    this.append(result.record);
    this.recorded += 1;
    return result;
  }

  /** Records a bus-side event identity without a checkpoint payload, idempotently. */
  markEvent(input: { taskId: string; eventId: string }): { ok: boolean; deduplicated: boolean; problems: string[] } {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, deduplicated: false, problems: [`no window is open for ${input.taskId}`] };
    const marked = markCaptureEvent(existing, input.eventId);
    if (marked.deduplicated) {
      this.deduplicated += 1;
      return { ok: true, deduplicated: true, problems: [] };
    }
    this.append(marked.record);
    this.recorded += 1;
    return { ok: true, deduplicated: false, problems: [] };
  }

  /** Appends a provider run outcome, idempotently. A run outcome never closes a window. */
  appendProviderEvent(input: { taskId: string; event: ProspectiveProviderEvent }): { ok: boolean; deduplicated: boolean; problems: string[] } {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, deduplicated: false, problems: [`no window is open for ${input.taskId}`] };
    const appended = appendProviderEventToRecord(existing, input.event);
    if (!appended.ok) return { ok: false, deduplicated: false, problems: appended.problems };
    if (appended.deduplicated) {
      this.deduplicated += 1;
      return { ok: true, deduplicated: true, problems: [] };
    }
    this.append(appended.record);
    this.recorded += 1;
    return { ok: true, deduplicated: false, problems: [] };
  }

  /** Closes a window with its outcome, refusing a policy that changed mid-window. */
  closeTask(input: { taskId: string; finalOutcome: string; steps?: readonly ProspectiveStepOutcome[]; closedAt?: string; taskStatus?: string }): WindowOperation {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, problems: [`no window is open for ${input.taskId}`] };
    const result = closeProspectiveRecord(existing, {
      finalOutcome: input.finalOutcome,
      ...(input.steps === undefined ? {} : { steps: [...input.steps] }),
      ...(input.taskStatus === undefined ? {} : { taskStatus: input.taskStatus }),
      closedAt: input.closedAt ?? this.now()
    });
    if (!result.ok || result.record === undefined) return result;
    this.append(result.record);
    return result;
  }

  /** The prospective metrics for everything this store holds. */
  metrics(): ProspectiveMetrics {
    return prospectiveMetrics(this.records());
  }

  status(): ProspectiveStoreStatus {
    const records = this.records();
    const policy = frozenContinuationPolicy();
    let bytes = 0;
    try {
      bytes = fs.existsSync(this.file()) ? fs.statSync(this.file()).size : 0;
    } catch {
      bytes = 0;
    }
    return {
      schemaVersion: PROSPECTIVE_WINDOW_SCHEMA_VERSION,
      rootDir: this.options.rootDir,
      file: this.file(),
      records: records.length,
      open: records.filter((entry) => entry.outcome === undefined).length,
      closed: records.filter((entry) => entry.outcome !== undefined).length,
      steps: records.reduce((total, entry) => total + entry.steps.length, 0),
      observationsRecorded: this.recorded,
      observationsDeduplicated: this.deduplicated,
      logRows: this.cache?.rows ?? 0,
      policyId: policy.policyId,
      policyHash: policy.policyHash,
      bytes,
      ...(this.degradedReason === undefined ? {} : { degradedReason: this.degradedReason })
    };
  }
}
