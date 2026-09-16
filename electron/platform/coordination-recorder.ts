/**
 * Production collection of coordination records (Phase 05, Task D).
 *
 * This is the wiring that makes Gate 8's evidence automatic rather than a manual hunt: the durable
 * `TaskLedger` that the running pipeline already writes is swept, each record is derived into a
 * `CoordinationRecord` by the pure adapter, and the result is persisted to the durable
 * `agent-coordination-economics.json` artifact. Nobody has to go and find a ledger by hand, and no
 * figure is estimated — anything the ledger did not observe stays null and is declared unmeasured.
 *
 * ## Two entry points, both deterministic
 *
 *  - `recordTask` — one task, called when it settles (the production hook).
 *  - `sweepLedger` — every task the ledger holds. This is what makes the evidence recoverable after
 *    the fact: a run that happened before the recorder existed still produces records, because the
 *    ledger it left behind is the source of record.
 *
 * Neither invents data. A ledger record with no observed tokens produces a record that says so.
 */

import fs from "node:fs";
import path from "node:path";
import type { TaskLedger, TaskLedgerRecord } from "../commander/task-ledger";
import { coordinationRecordFromLedger, type CoordinationDerivationOptions, type LedgerRecordView } from "../../src/shared/coordination-ledger";
import { openCoordinationStore, type CoordinationStore } from "./coordination-store";
import type { CoordinationRecord } from "../../src/shared/coordination-economics";

interface CoordinationRecorderOptions {
  /** The durable ledger root the pipeline writes. */
  ledgerRoot: string;
  /** Where the economics artifact lives. */
  artifactFile: string;
  /** Supplied rather than read from a clock, so a sweep is reproducible. */
  at: string;
  /** Optional cohort identity applied to every record this recorder derives. */
  cohort?: CoordinationRecord["cohort"];
  /** Optional diff measurement, keyed by task id, for callers that can measure it. */
  diffLines?: (taskId: string, record: LedgerRecordView) => number | null;
}

interface SweepResult {
  /** Task ids the ledger holds. */
  tasks: string[];
  added: number;
  replaced: number;
  /** Records that could not be derived, with the reason, rather than silently skipped. */
  skipped: Array<{ taskId: string; reason: string }>;
  /** Measures no record observed, so the gap is visible before the guard refuses. */
  unmeasuredEverywhere: string[];
}

/** Every task id the ledger directory holds, sorted so a sweep is deterministic. */
function listLedgerTasks(ledgerRoot: string): string[] {
  if (!fs.existsSync(ledgerRoot)) return [];
  return fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The view of a ledger record the pure adapter reads. */
function viewOf(record: TaskLedgerRecord): LedgerRecordView {
  return {
    taskId: record.taskId,
    verificationState: record.verificationState,
    modifiedFiles: record.modifiedFiles,
    failureHistory: record.failureHistory,
    activeProvider: record.activeProvider,
    usage: record.usage,
    sessions: record.sessions.map((session) => ({ provider: session.provider, health: session.health })),
    jobs: record.jobs
  };
}

interface CoordinationRecorder {
  store: CoordinationStore;
  /** Record one task from the durable ledger, if it is there. */
  recordTask(ledger: TaskLedger, taskId: string): { recorded: boolean; reason?: string; record?: CoordinationRecord };
  /** Record everything the ledger holds. */
  sweep(ledger: TaskLedger): SweepResult;
}

export function createCoordinationRecorder(options: CoordinationRecorderOptions): CoordinationRecorder {
  const store = openCoordinationStore(options.artifactFile);

  function derive(ledger: TaskLedger, taskId: string): { record?: CoordinationRecord; reason?: string; unmeasured?: string[] } {
    const persisted = ledger.load(taskId);
    if (!persisted) return { reason: `the ledger holds no record for ${taskId}` };
    const derivation: CoordinationDerivationOptions = {
      at: options.at,
      diffLines: options.diffLines ? options.diffLines(taskId, viewOf(persisted)) : null,
      ...(options.cohort ? { cohort: options.cohort } : {})
    };
    const derived = coordinationRecordFromLedger(viewOf(persisted), derivation);
    return { record: derived.record, unmeasured: derived.unmeasured };
  }

  return {
    store,
    recordTask(ledger, taskId) {
      const result = derive(ledger, taskId);
      if (!result.record) return { recorded: false, reason: result.reason };
      store.putRecords([result.record]);
      return { recorded: true, record: result.record };
    },
    sweep(ledger) {
      const tasks = listLedgerTasks(options.ledgerRoot);
      const skipped: SweepResult["skipped"] = [];
      const records: CoordinationRecord[] = [];
      const unmeasuredCounts = new Map<string, number>();
      for (const taskId of tasks) {
        const result = derive(ledger, taskId);
        if (!result.record) {
          skipped.push({ taskId, reason: result.reason ?? "unknown" });
          continue;
        }
        records.push(result.record);
        for (const measure of result.unmeasured ?? []) {
          unmeasuredCounts.set(measure, (unmeasuredCounts.get(measure) ?? 0) + 1);
        }
      }
      const written = store.putRecords(records);
      // A measure is "unmeasured everywhere" only when NO record observed it; that is the gap a
      // reader needs to see, as opposed to a measure a single unusual task omitted.
      const present = new Set(records.flatMap((record) => record.measured));
      const unmeasuredEverywhere = ["modelCalls", "inputTokens", "outputTokens", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided", "diffLines", "defectsEscaped"]
        .filter((measure) => !present.has(measure as never));
      return { tasks, added: written.added, replaced: written.replaced, skipped, unmeasuredEverywhere };
    }
  };
}

/** Where the production ledger lives, relative to a data root. */
function ledgerRootUnder(dataRoot: string): string {
  return path.join(dataRoot, "tasks");
}
