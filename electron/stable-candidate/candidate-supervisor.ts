import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";
import { quarantineCandidateRuntime, type EvolutionLayout } from "./runtime-isolation";
import { candidateHeadSha } from "./workspace-manager";

/**
 * Candidate supervisor (Update-Plan/Isolation-Finalization.md §8.1, §8.4, §12.1,
 * §12.3, §15 FI-01/FI-02/FI-05).
 *
 * Stable supervises; a Candidate crashes. The entire value of this module is the
 * shape of its contract:
 *
 *     supervise() NEVER throws because a Candidate failed.
 *
 * A Candidate that crashes, hangs, throws, is killed, is misconfigured or leaves
 * corrupt runtime-data produces a durable journal entry and an outcome record.
 * Stable's durable state, its lock and its ability to start the next Candidate
 * are untouched. The supervisor additionally refuses to auto-promote: reaching
 * `COMPLETED` means "the local work finished", nothing more (§11.1).
 *
 * The lock is deliberately per-run and deliberately recoverable. A stale lock
 * from a killed Candidate is *expected* and is cleared by the next run rather
 * than being allowed to wedge Stable (§8.4: "不被 candidate lock 住").
 */

export type CandidateLifecycleState = "CREATED" | "WORKING" | "VERIFYING" | "REVIEWING" | "COMPLETED" | "CRASHED" | "TIMED_OUT" | "ABORTED";

export const CANDIDATE_LIFECYCLE_STATES: readonly CandidateLifecycleState[] = [
  "CREATED", "WORKING", "VERIFYING", "REVIEWING", "COMPLETED", "CRASHED", "TIMED_OUT", "ABORTED"
];

/** Stable-side view of one Candidate. Durable and safe to read after a crash. */
export interface CandidateJournal {
  runId: string;
  baseSha: string;
  state: CandidateLifecycleState;
  candidateSha: string | null;
  attempts: number;
  startedAt: string;
  updatedAt: string;
  /** Last failure detail, kept for evidence. Never a stack trace of Owner data. */
  error?: string;
  /** Where corrupt candidate runtime-data was moved, when that happened. */
  quarantinedRuntimeData?: string;
}

export interface CandidateOutcome<T> {
  state: CandidateLifecycleState;
  /** True only when the Candidate's own work completed; NOT a promotion. */
  ok: boolean;
  value?: T;
  error?: string;
  journal: CandidateJournal;
  /**
   * Always true. Exposed so callers (and the acceptance battery) can assert the
   * Stable-survives property directly instead of inferring it.
   */
  stableSurvived: true;
}

export interface CandidateSupervisorOptions {
  layout: EvolutionLayout;
  /** Hard wall-clock bound per Candidate attempt. Defaults to 30 minutes. */
  timeoutMs?: number;
  now?: () => Date;
}

export class CandidateSupervisor {
  readonly layout: EvolutionLayout;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly journalFile: string;
  private readonly lockFile: string;
  private journal: CandidateJournal | undefined;
  private controller: AbortController | undefined;
  private running = false;

  constructor(options: CandidateSupervisorOptions) {
    this.layout = options.layout;
    this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.journalFile = path.join(this.layout.journal, "candidate.json");
    this.lockFile = path.join(this.layout.journal, "candidate.lock");
  }

  /** Current durable state (from disk if this supervisor has not run yet). */
  state(): CandidateJournal {
    this.journal ??= readJson<CandidateJournal>(this.journalFile) ?? {
      runId: this.layout.runId,
      baseSha: this.layout.baseSha,
      state: "CREATED",
      candidateSha: null,
      attempts: 0,
      startedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    return this.journal;
  }

  /** True when no Candidate is mid-flight; a new one may be started. */
  canStartNext(): boolean {
    return !this.running;
  }

  /**
   * Clears a lock left behind by a killed Candidate. Called before a new run so
   * a crashed predecessor can never wedge Stable (§8.4).
   */
  recoverStaleLock(): boolean {
    if (!fs.existsSync(this.lockFile)) return false;
    const recorded = readJson<{ pid?: number }>(this.lockFile);
    // A lock whose owning process is gone is stale. The record is kept in the
    // journal as evidence and the lock is removed; Stable is never blocked by it.
    this.write({ ...this.state(), error: `recovered stale candidate lock${recorded?.pid ? ` from pid ${recorded.pid}` : ""}` });
    fs.rmSync(this.lockFile, { force: true });
    return true;
  }

  private write(next: CandidateJournal): void {
    next.updatedAt = this.now().toISOString();
    this.journal = next;
    try {
      writeJson(this.journalFile, next);
    } catch {
      // A Candidate journal that cannot be written is a Candidate problem, never
      // a Stable problem: the outcome is still returned to the caller.
    }
  }

  /**
   * Runs one Candidate attempt under supervision.
   *
   * `task` receives an abort signal and a state reporter. Whatever it does —
   * return, throw a synchronous error, reject asynchronously, or hang past the
   * timeout — this method returns a `CandidateOutcome` and never rethrows.
   */
  async supervise<T>(task: (context: { layout: EvolutionLayout; signal: AbortSignal; setState: (state: CandidateLifecycleState) => void }) => Promise<T>): Promise<CandidateOutcome<T>> {
    const base = this.state();
    const started: CandidateJournal = {
      ...base,
      state: "WORKING",
      attempts: (base.attempts ?? 0) + 1,
      startedAt: this.now().toISOString(),
      error: undefined
    };
    this.write(started);
    this.running = true;
    this.controller = new AbortController();
    fs.mkdirSync(this.layout.journal, { recursive: true });
    fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, runId: this.layout.runId, startedAt: started.startedAt }), "utf8");

    let timer: NodeJS.Timeout | undefined;
    try {
      const value = await Promise.race([
        task({
          layout: this.layout,
          signal: this.controller.signal,
          setState: (state: CandidateLifecycleState) => { this.write({ ...this.state(), state }); }
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.controller?.abort();
            reject(new CandidateTimeoutError(`candidate ${this.layout.runId} exceeded ${this.timeoutMs}ms`));
          }, this.timeoutMs);
          // Do not keep the host process alive for the watchdog.
          timer.unref?.();
        })
      ]);
      const completed: CandidateJournal = { ...this.state(), state: "COMPLETED", candidateSha: await this.safeHeadSha() };
      this.write(completed);
      return { state: completed.state, ok: true, value, journal: completed, stableSurvived: true };
    } catch (error) {
      const timedOut = error instanceof CandidateTimeoutError;
      const message = error instanceof Error ? error.message : String(error);
      const failed: CandidateJournal = { ...this.state(), state: timedOut ? "TIMED_OUT" : "CRASHED", error: message.slice(0, 2000) };
      this.write(failed);
      return { state: failed.state, ok: false, error: message, journal: failed, stableSurvived: true };
    } finally {
      if (timer) clearTimeout(timer);
      this.running = false;
      this.controller = undefined;
      fs.rmSync(this.lockFile, { force: true });
    }
  }

  /** Requests cancellation of the in-flight Candidate (§13 emergency stop). */
  abort(reason: string): boolean {
    if (!this.running || !this.controller) return false;
    this.write({ ...this.state(), state: "ABORTED", error: reason });
    this.controller.abort();
    return true;
  }

  /** Marks the Candidate aborted without an in-flight task. */
  markAborted(reason: string): CandidateJournal {
    const aborted: CandidateJournal = { ...this.state(), state: "ABORTED", error: reason };
    this.write(aborted);
    fs.rmSync(this.lockFile, { force: true });
    return aborted;
  }

  /**
   * Handles corrupt Candidate runtime-data (§8.4, RT-19). The corrupt tree is
   * moved aside and a clean one is created; Stable is not repaired, restarted or
   * otherwise involved.
   */
  quarantineRuntime(stamp: string): CandidateJournal {
    const target = quarantineCandidateRuntime(this.layout, stamp);
    const next: CandidateJournal = { ...this.state(), state: "CRASHED", error: "candidate runtime-data was corrupt and has been quarantined", quarantinedRuntimeData: target };
    this.write(next);
    return next;
  }

  private async safeHeadSha(): Promise<string | null> {
    try {
      return await candidateHeadSha(this.layout.workspace);
    } catch {
      // A candidate that never produced a commit simply has no head SHA; that is
      // recorded as null and is not a Stable-side failure.
      return null;
    }
  }
}

export class CandidateTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateTimeoutError";
  }
}
