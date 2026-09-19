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
  closeProspectiveRecord,
  openProspectiveRecord,
  prospectiveMetrics,
  type ProspectiveAdvisory,
  type ProspectiveMetrics,
  type ProspectiveStepOutcome,
  type ProspectiveWindowRecord,
  type WindowOperation
} from "../../src/shared/runtime-intelligence/prospective-window";

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
  policyId: string;
  policyHash: string;
  bytes: number;
  degradedReason?: string;
}

export class ProspectiveWindowStore {
  private readonly options: ProspectiveStoreOptions;
  private readonly now: () => string;
  private degradedReason?: string;

  constructor(options: ProspectiveStoreOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private file(): string {
    return path.join(this.options.rootDir, PROSPECTIVE_WINDOW_FILENAME);
  }

  /** Every record, one per task, newest state last per id. */
  records(): ProspectiveWindowRecord[] {
    const file = this.file();
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      this.degradedReason = `${PROSPECTIVE_WINDOW_FILENAME} could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
    // The log is append-only, so the LAST row for a window id is its current state.
    const byId = new Map<string, ProspectiveWindowRecord>();
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as ProspectiveWindowRecord;
        if (typeof parsed.windowId !== "string") continue;
        byId.set(parsed.windowId, parsed);
      } catch {
        // One unparseable row costs one row, not the window.
      }
    }
    return [...byId.values()].sort((left, right) => (left.openedAt < right.openedAt ? -1 : left.openedAt > right.openedAt ? 1 : 0));
  }

  record(taskId: string): ProspectiveWindowRecord | undefined {
    return this.records().find((entry) => entry.taskId === taskId);
  }

  private append(record: ProspectiveWindowRecord): void {
    fs.mkdirSync(this.options.rootDir, { recursive: true });
    fs.appendFileSync(this.file(), `${JSON.stringify(record)}\n`, "utf8");
  }

  /** Opens a window for a task, fixing the frozen policy's hash before anything else happens. */
  openTask(input: { taskId: string; openedAt?: string }): WindowOperation {
    if (this.record(input.taskId) !== undefined) {
      return { ok: false, problems: [`a window already exists for ${input.taskId}`] };
    }
    const opened = openProspectiveRecord({ taskId: input.taskId, openedAt: input.openedAt ?? this.now() });
    if (!opened.ok || opened.record === undefined) return opened;
    this.append(opened.record);
    return opened;
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

  /** Closes a window with its outcome, refusing a policy that changed mid-window. */
  closeTask(input: { taskId: string; finalOutcome: string; steps: readonly ProspectiveStepOutcome[]; closedAt?: string }): WindowOperation {
    const existing = this.record(input.taskId);
    if (existing === undefined) return { ok: false, problems: [`no window is open for ${input.taskId}`] };
    const result = closeProspectiveRecord(existing, { finalOutcome: input.finalOutcome, steps: [...input.steps], closedAt: input.closedAt ?? this.now() });
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
      policyId: policy.policyId,
      policyHash: policy.policyHash,
      bytes,
      ...(this.degradedReason === undefined ? {} : { degradedReason: this.degradedReason })
    };
  }
}
