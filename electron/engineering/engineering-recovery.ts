import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import { checkpointRecord, rollbackToCheckpoint, type CheckpointSnapshot } from "./change-points";
import type { EngineeringLoopStore } from "./engineering-loop-store";
import type { EngineeringLoopState, EngineeringLoopSummary } from "./engineering-loop-driver";
import type { RecoveryCode, WorkspaceRecoveryOutcome } from "../../src/shared/engineering-loop";

export type { RecoveryCode, WorkspaceRecoveryOutcome };

/**
 * Autonomous-engineering recovery (Update-Plan/cleaning.md §7/§8/§9).
 *
 * §7 — No recovery point ⇒ no autonomous mutation. A workspace Boss cannot
 * checkpoint is refused *before* the driver starts, and the refusal is recorded
 * as durable evidence with an explicit terminal reason. The old
 * `checkpointRecord(...).catch(() => undefined)` silently turned "no rollback is
 * possible" into "run anyway"; failing to checkpoint is now a terminal state.
 *
 * §8 — An exception anywhere in the driver is a *terminal* run, and it is
 * recovered like any other terminal run. The original error is preserved and the
 * rollback outcome travels with it, so a rollback failure is never mistaken for
 * the driver's error and vice versa.
 *
 * §9 — One convergence rule decides whether a terminal run keeps its changes:
 * `preserveWorkspace = CONVERGED`. Everything else is rolled back. There is no
 * growing `ABORTED || STAGNANT || …` list to keep in sync.
 */

type RecoveryPointAttempt =
  | { ok: true; checkpoint: CheckpointSnapshot }
  | { ok: false; code: "CHECKPOINT_UNAVAILABLE"; reason: string };

/**
 * §7: captures the pre-mutation recovery point, or reports why it could not be
 * taken. Never throws and never returns a half-captured point — the caller must
 * treat `ok: false` as "this run may not mutate anything".
 */
export async function captureRecoveryPoint(workspace: string): Promise<RecoveryPointAttempt> {
  try {
    return { ok: true, checkpoint: await checkpointRecord(workspace) };
  } catch (error) {
    return { ok: false, code: "CHECKPOINT_UNAVAILABLE", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * §8: rolls the workspace back to its recovery point. Failures are returned, not
 * thrown: the caller already holds the error that ended the run, and losing it to
 * a rollback failure would hide the real cause.
 */
export async function restoreRecoveryPoint(workspace: string, checkpoint: CheckpointSnapshot): Promise<WorkspaceRecoveryOutcome> {
  try {
    const result = await rollbackToCheckpoint(workspace, checkpoint);
    return { attempted: true, ok: true, code: "ROLLBACK_OK", restored: result.restored, removed: result.removed };
  } catch (error) {
    return { attempted: true, ok: false, code: "ROLLBACK_FAILED", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * §9: the single rule for keeping a terminal run's changes.
 *
 * `CONVERGED` is the only state whose build/test-verified changes are kept.
 * ABORTED, STAGNANT and the cosmetic-only OPTIONAL_IMPROVEMENTS are all "the run
 * did not converge" and are rolled back — a rule that cannot drift out of sync
 * with the state list the way `ABORTED || STAGNANT || …` does.
 */
export function preserveWorkspaceAfter(state: EngineeringLoopState): boolean {
  return state === "ENGINEERING_CONVERGED";
}

/**
 * §8: the error a run ends with when the driver itself threw. It carries the
 * original error unchanged (`cause`) plus the rollback outcome, so neither is
 * lost and neither masquerades as the other.
 */
export class EngineeringRecoveryError extends Error {
  readonly code = "ENGINEERING_DRIVER_FAILED" as const;
  readonly driverError: unknown;
  readonly recovery: WorkspaceRecoveryOutcome;
  constructor(driverError: unknown, recovery: WorkspaceRecoveryOutcome) {
    const driverMessage = driverError instanceof Error ? driverError.message : String(driverError);
    super(`${driverMessage} [recovery: ${recoveryLabel(recovery)}]`, { cause: driverError });
    this.name = "EngineeringRecoveryError";
    this.driverError = driverError;
    this.recovery = recovery;
  }
}

/** Human-readable one-liner for a recovery outcome (display only). */
export function recoveryLabel(outcome: WorkspaceRecoveryOutcome): string {
  if (!outcome.attempted) return `no recovery point: ${outcome.reason}`;
  return outcome.ok
    ? `rolled back ${outcome.restored.length} restored / ${outcome.removed.length} removed`
    : `rollback failed: ${outcome.reason}`;
}

/* -------------------------------------------------------------------------- */
/* Durable recovery ledger                                                     */
/* -------------------------------------------------------------------------- */

interface EngineeringRecoveryEvent {
  at: string;
  goalId: string;
  /** Terminal reason code, e.g. `CHECKPOINT_UNAVAILABLE`. */
  code: string;
  reason: string;
  /** The driver's own message when the run ended because it threw. */
  driverError?: string;
  recovery: WorkspaceRecoveryOutcome;
}

interface EngineeringRecoveryFile {
  schemaVersion: 1;
  events: EngineeringRecoveryEvent[];
}

/** How many recovery events are retained (bounded; oldest are dropped). */
const RECOVERY_EVENT_RETENTION = 200;

/**
 * Sidecar ledger for recovery decisions, beside `engineering-loop.json`.
 *
 * It is deliberately separate from the iteration rows: a recovery event must not
 * overwrite the iteration's findings (that would hide the very findings the run
 * ended on), and it must survive a goal replacement.
 */
export class EngineeringRecoveryLedger {
  /**
   * `retention` defaults to the production cap and exists only so a test can exercise the BOUNDEDNESS rule
   * without paying for it. `append` is a read-modify-write of the whole file, so proving "the ledger keeps
   * the newest N" by appending N+10 events costs O(N²) file I/O: at the production cap of 200 that is 210
   * full rewrites, which took 85 s on a CI runner and tripped vitest's 60 s per-test timeout while passing
   * in ~18 s locally. The rule under test is the cap, not the constant, so the test injects a small one.
   */
  constructor(private readonly file: string, private readonly retention: number = RECOVERY_EVENT_RETENTION) {}

  append(event: EngineeringRecoveryEvent): void {
    // A new event is appended to whatever is readable. An unreadable ledger is
    // reported by `read()` but must not block recording the event that is
    // happening now, which would lose the newest evidence to protect the oldest.
    const events = [...this.read().events, event].slice(-this.retention);
    writeJson(this.file, { schemaVersion: 1, events } satisfies EngineeringRecoveryFile);
  }

  list(): EngineeringRecoveryEvent[] {
    const value = this.read();
    return value.events;
  }

  /**
   * Reads the ledger, distinguishing "no ledger yet" from "ledger unreadable".
   *
   * `readable: false` matters: the whole point of this file is that a terminal
   * reason survives a goal replacement. Reporting an unreadable ledger as an
   * empty one would erase exactly that evidence, so callers are told which of
   * the two they are looking at.
   */
  read(): { events: EngineeringRecoveryEvent[]; readable: boolean; problem?: string } {
    if (!fs.existsSync(this.file)) return { events: [], readable: true };
    try {
      const value = readJson<Partial<EngineeringRecoveryFile>>(this.file);
      if (!value || value.schemaVersion !== 1 || !Array.isArray(value.events)) {
        return { events: [], readable: false, problem: `unsupported recovery ledger shape in ${this.file}` };
      }
      return { events: value.events.filter((event): event is EngineeringRecoveryEvent => Boolean(event) && typeof event.code === "string"), readable: true };
    } catch (error) {
      return { events: [], readable: false, problem: `recovery ledger could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Terminal summaries                                                          */
/* -------------------------------------------------------------------------- */

/**
 * §7: the summary of a run that was refused before it could touch anything.
 *
 * The refusal is durable evidence twice over: an ABORTED iteration row (so the
 * goal's read-model shows the terminal state and its explicit reason) and a
 * recovery event (so the reason survives a later goal replacement).
 */
export function closeGoalWithoutRecoveryPoint(store: EngineeringLoopStore, attempt: { code: "CHECKPOINT_UNAVAILABLE"; reason: string }): EngineeringLoopSummary {
  const terminalReason = `${attempt.code}: ${attempt.reason}`;
  const record = store.beginIteration();
  store.updateIteration(record.iteration, (item) => {
    item.stage = "AUDIT";
    item.status = "ABORTED";
    item.remainingRisk = terminalReason;
  });
  return {
    state: "ABORTED",
    iterations: store.iterations().length,
    telemetry: { repeatedIssueCount: 0, sameTestFailCount: 0, noImprovementRounds: 0 },
    changedFiles: [],
    findings: [],
    recovery: { attempted: false, code: "CHECKPOINT_UNAVAILABLE", reason: attempt.reason },
    terminalReason
  };
}

/**
 * Records a recovery decision, and closes the newest iteration row if the driver
 * died while it was still RUNNING (a durable ledger may never be left claiming a
 * run is in progress after the run is gone).
 */
export function recordRecoveryOutcome(
  ledger: EngineeringRecoveryLedger,
  store: EngineeringLoopStore,
  code: string,
  driverError: unknown,
  recovery: WorkspaceRecoveryOutcome
): void {
  const reason = recoveryLabel(recovery);
  ledger.append({
    at: new Date().toISOString(),
    goalId: store.goal?.id ?? "(unknown-goal)",
    code,
    reason,
    ...(driverError === undefined ? {} : { driverError: driverError instanceof Error ? driverError.message : String(driverError) }),
    recovery
  });
  const iterations = store.iterations();
  const last = iterations.length ? iterations[iterations.length - 1] : undefined;
  if (!last || last.status !== "RUNNING") return;
  store.updateIteration(last.iteration, (item) => {
    if (item.status !== "RUNNING") return;
    item.status = "ABORTED";
    item.remainingRisk = `${code}: ${reason}`;
  });
}
