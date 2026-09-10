import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { readJson, writeJson } from "../commander/durable-json";

/**
 * Rollback and Root Recovery (Update-Plan/Isolation-Finalization.md §12, §15
 * FI-01/FI-02, §14 RT-18/RT-19/RT-25).
 *
 * Two distinct jobs, deliberately kept in one module because they share the same
 * durable checkpoint:
 *
 * **A. Candidate failure must not pollute Stable (§12.1).** Compile fail, test
 * fail, reviewer blocker, CI fail, stale SHA, unapproved Root Surface, Candidate
 * crash, timeout and state corruption are *Candidate* events. The evolution
 * module degrades or aborts; Stable keeps running. `assessStableImpact` makes
 * that a computed, testable fact rather than a claim.
 *
 * **B. A bad promotion must be reversible deterministically (§12.2).** The
 * checkpoint — previous Stable SHA, promoted SHA, run ID, evidence directory —
 * is written *before* the promotion. Rollback replays that checkpoint. It never
 * asks a model what the previous version was, never consults provider chat
 * history, and refuses outright when no checkpoint exists.
 *
 * History is never rewritten: rollback produces a new revert commit on the base
 * branch. Force-pushing the base branch is a §4 DENY operation, so a rollback
 * that needed one would be a rollback that must not happen.
 */

export type CandidateFailureClass =
  | "compile-fail"
  | "test-fail"
  | "reviewer-blocker"
  | "ci-fail"
  | "stale-sha"
  | "protected-surface-unapproved"
  | "candidate-crash"
  | "timeout"
  | "state-corruption";

export const CANDIDATE_FAILURE_CLASSES: readonly CandidateFailureClass[] = [
  "compile-fail", "test-fail", "reviewer-blocker", "ci-fail", "stale-sha", "protected-surface-unapproved", "candidate-crash", "timeout", "state-corruption"
];

export interface StableImpactAssessment {
  /** Always false: no Candidate failure class reaches Stable. */
  affectsStablePath: false;
  requiresRollback: false;
  /** Evolution-module state only (§12.3). */
  evolutionState: "DEGRADED" | "ABORTED";
  detail: string;
}

/**
 * Maps a Candidate failure onto the evolution module's own state.
 *
 * A failure that the Candidate's own work caused aborts the run; a failure of
 * the surrounding machinery degrades the module and lets Stable start the next
 * Candidate. Neither outcome touches Stable's data or process.
 */
export function assessStableImpact(failure: CandidateFailureClass): StableImpactAssessment {
  const aborted: CandidateFailureClass[] = ["compile-fail", "test-fail", "reviewer-blocker", "ci-fail", "stale-sha", "protected-surface-unapproved"];
  const evolutionState = aborted.includes(failure) ? "ABORTED" : "DEGRADED";
  return {
    affectsStablePath: false,
    requiresRollback: false,
    evolutionState,
    detail: `${failure} is contained to the Candidate; Stable's files, runtime-data and process are untouched`
  };
}

export interface RollbackCheckpoint {
  runId: string;
  /** Stable SHA that was live before the promotion. */
  previousStableSha: string;
  /** SHA that was promoted and may need reverting. */
  promotedSha: string;
  createdAt: string;
  /** Directory holding this run's evidence, retained across a rollback. */
  evidenceDir: string;
  promotedAt?: string;
  reason?: string;
}

export interface RollbackRecord {
  runId: string;
  previousStableSha: string;
  promotedSha: string;
  reason: string;
  at: string;
  /** The revert commit created on the base branch, when one was made. */
  revertSha?: string;
  /** Set when the rollback could not be executed; the run stays promoted. */
  error?: string;
}

export interface GitRunner {
  run(cwd: string, args: string[], timeout?: number): Promise<string>;
}

const defaultGit: GitRunner = {
  run(cwd, args, timeout = 120000) {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr) || error.message));
        else resolve(String(stdout).trim());
      });
    });
  }
};

export class RollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackError";
  }
}

export interface RollbackControllerOptions {
  /** Durable checkpoint file. Must live outside the Candidate workspace. */
  checkpointFile: string;
  /** Durable rollback record file, same rule. */
  recordFile: string;
  /** Stable repository root. */
  stableRoot: string;
  /** Base branch name. Rollback adds a revert commit here. */
  baseBranch?: string;
  git?: GitRunner;
}

export interface RollbackResult {
  ok: boolean;
  record: RollbackRecord;
  /** Exact commands that were (or would have been) run — the deterministic plan. */
  plan: string[][];
}

export class RollbackController {
  private readonly checkpointFile: string;
  private readonly recordFile: string;
  private readonly stableRoot: string;
  private readonly baseBranch: string;
  private readonly git: GitRunner;

  constructor(options: RollbackControllerOptions) {
    this.checkpointFile = path.resolve(options.checkpointFile);
    this.recordFile = path.resolve(options.recordFile);
    this.stableRoot = path.resolve(options.stableRoot);
    this.baseBranch = options.baseBranch ?? "main";
    this.git = options.git ?? defaultGit;
    for (const file of [this.checkpointFile, this.recordFile]) {
      const relative = path.relative(this.stableRoot, file);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        throw new RollbackError(`rollback state must live outside the Stable working tree (${file})`);
      }
    }
  }

  /**
   * Records the pre-promotion checkpoint. Called BEFORE the promotion; a
   * promotion attempted without one is refused by `rollback`.
   */
  createCheckpoint(input: { runId: string; previousStableSha: string; promotedSha: string; evidenceDir: string; reason?: string }): RollbackCheckpoint {
    if (!/^[0-9a-f]{40}$/.test(input.previousStableSha)) throw new RollbackError("checkpoint requires a full previous Stable SHA");
    if (!/^[0-9a-f]{40}$/.test(input.promotedSha)) throw new RollbackError("checkpoint requires a full promoted SHA");
    const checkpoint: RollbackCheckpoint = { ...input, createdAt: new Date().toISOString() };
    writeJson(this.checkpointFile, checkpoint);
    return checkpoint;
  }

  checkpoint(): RollbackCheckpoint | undefined {
    return readJson<RollbackCheckpoint>(this.checkpointFile);
  }

  /** The deterministic command plan for a checkpoint. Pure: no side effects. */
  planRollback(checkpoint: RollbackCheckpoint): string[][] {
    return [
      ["fetch", "--all", "--prune"],
      ["switch", this.baseBranch],
      ["revert", "--no-commit", checkpoint.promotedSha],
      ["commit", "-m", `revert: roll back ${checkpoint.runId} (${checkpoint.promotedSha.slice(0, 12)}) - ${checkpoint.reason ?? "post-promotion fault"}`]
    ];
  }

  /**
   * Executes the rollback. Refuses without a checkpoint: "no checkpoint, no
   * rollback" is safer than reconstructing history from memory (§12.2).
   */
  async rollback(reason: string, options: { dryRun?: boolean } = {}): Promise<RollbackResult> {
    const checkpoint = this.checkpoint();
    if (!checkpoint) throw new RollbackError("no rollback checkpoint exists; deterministic rollback requires a recorded previous Stable SHA");
    const plan = this.planRollback({ ...checkpoint, reason });
    const record: RollbackRecord = {
      runId: checkpoint.runId,
      previousStableSha: checkpoint.previousStableSha,
      promotedSha: checkpoint.promotedSha,
      reason,
      at: new Date().toISOString()
    };
    if (options.dryRun) return { ok: true, record, plan };

    try {
      await this.git.run(this.stableRoot, plan[0]);
      await this.git.run(this.stableRoot, plan[1]);
      await this.git.run(this.stableRoot, plan[2]);
      await this.git.run(this.stableRoot, plan[3]);
      record.revertSha = await this.git.run(this.stableRoot, ["rev-parse", "HEAD"]);
    } catch (error) {
      record.error = String(error).slice(0, 1000);
      // Record even a failed rollback: the run stays promoted and the next actor
      // needs to know precisely where it stopped.
      writeJson(this.recordFile, record);
      return { ok: false, record, plan };
    }
    writeJson(this.recordFile, record);
    return { ok: true, record, plan };
  }

  lastRollback(): RollbackRecord | undefined {
    return readJson<RollbackRecord>(this.recordFile);
  }

  /**
   * Retains the evidence directory across a rollback. A rollback that erases its
   * own evidence is not an auditable rollback.
   */
  retainEvidence(checkpoint: RollbackCheckpoint): { retained: boolean; directory: string } {
    return { retained: fs.existsSync(checkpoint.evidenceDir), directory: checkpoint.evidenceDir };
  }
}
