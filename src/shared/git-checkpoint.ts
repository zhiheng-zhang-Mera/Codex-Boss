/**
 * Update-Plan/checkpoint-1.md §38 — the local Git checkpoint.
 *
 * Before any GitHub write, Boss creates a local checkpoint recording HEAD, branch,
 * diff, task, candidate id and evidence, and must be able to roll back. The record
 * is the pure half here; the host (`electron/engineering/git-checkpoint.ts`) runs
 * the real git commands.
 *
 * The doctrine lives in two rules: a GitHub write is *refused* when no checkpoint
 * covers the task, and a rollback is refused when the repository has moved away
 * from what the checkpoint recorded — a "rollback" that silently discards somebody
 * else's work is worse than no rollback at all.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";
import type { VersionAssessment } from "./version-impact";

export const GIT_CHECKPOINT_VERSION = "git-checkpoint-1" as const;

export interface CheckpointRecord {
  schemaVersion: 1;
  version: typeof GIT_CHECKPOINT_VERSION;
  id: string;
  /** §38: the commit the checkpoint points at. */
  head: string;
  branch: string;
  /** SHA-256 of the captured diff, plus its size, so drift is detectable. */
  diff_hash: string;
  diff_bytes: number;
  /** §38: which task, candidate and evidence this checkpoint belongs to. */
  task_id: string;
  candidate_id?: string;
  evidence: string[];
  /** The files the change touched, so a rollback can name them. */
  changed_files: string[];
  /** §37 assessment, carried with the checkpoint so a release can cite it. */
  version_impact?: VersionAssessment["impact"];
  created_at: string;
  /** True when the working tree was dirty at capture (an incomplete state). */
  dirty: boolean;
}

export function checkpointIdFor(input: { task_id: string; head: string; branch: string; created_at: string }): string {
  return `cp-${contentHashOf([input.task_id, input.head, input.branch, input.created_at].join("\u0000")).slice(0, 16)}`;
}

export interface RollbackRequest {
  checkpoint: CheckpointRecord;
  /** The repository as it is now. */
  current: { head: string; branch: string; diff_hash: string; dirty: boolean };
  /** True when the Owner explicitly approved discarding work after the checkpoint. */
  owner_approved_discard?: boolean;
}

export interface RollbackPlan {
  ok: boolean;
  /** Files to restore from the checkpoint's HEAD. */
  restore_paths: string[];
  /** True when only restoring paths is enough (nothing was committed since). */
  path_restore_sufficient: boolean;
  /** Set when a hard reset would be needed, and why it may not happen. */
  hard_reset?: { required: true; reason: string };
  reasons: string[];
}

/**
 * §38: what a rollback would do, and whether it may.
 *
 * Restoring paths from the recorded HEAD is the safe operation and is enough while
 * the branch has not moved. If the branch moved, a rollback would need a hard
 * reset, which discards commits — so it is only planned with an explicit Owner
 * approval.
 */
export function planRollback(request: RollbackRequest): RollbackPlan {
  const { checkpoint, current } = request;
  const reasons: string[] = [];
  const moved = current.head !== checkpoint.head;
  const branchChanged = current.branch !== checkpoint.branch;
  if (branchChanged) reasons.push(`the repository is on ${current.branch}, but the checkpoint was taken on ${checkpoint.branch}`);
  if (moved && !request.owner_approved_discard) {
    reasons.push(`HEAD moved from ${checkpoint.head.slice(0, 12)} to ${current.head.slice(0, 12)}; rolling back would discard commits and needs the Owner's approval`);
    return {
      ok: false,
      restore_paths: [...checkpoint.changed_files],
      path_restore_sufficient: false,
      hard_reset: { required: true, reason: "the branch advanced after the checkpoint" },
      reasons
    };
  }
  if (branchChanged) {
    return { ok: false, restore_paths: [...checkpoint.changed_files], path_restore_sufficient: false, reasons };
  }
  if (moved) {
    return {
      ok: true,
      restore_paths: [...checkpoint.changed_files],
      path_restore_sufficient: false,
      hard_reset: { required: true, reason: "the Owner approved discarding the commits made after the checkpoint" },
      reasons: ["the Owner approved a hard reset back to the checkpoint"]
    };
  }
  if (!checkpoint.changed_files.length) {
    reasons.push("the checkpoint recorded no changed file, so there is nothing to restore");
  }
  return {
    ok: reasons.length === 0,
    restore_paths: [...checkpoint.changed_files],
    path_restore_sufficient: true,
    reasons: reasons.length ? reasons : [`restoring ${checkpoint.changed_files.length} file(s) from ${checkpoint.head.slice(0, 12)} undoes the change without touching commits`]
  };
}

export interface PushGuardInput {
  /** The checkpoints known for this task, newest first. */
  checkpoints: readonly CheckpointRecord[];
  task_id: string;
  current: { head: string; branch: string; diff_hash: string };
  /** The write the caller is about to perform. */
  operation: "CREATE_BRANCH" | "COMMIT" | "PUSH" | "OPEN_PR" | "UPDATE_PR";
}

export interface PushGuardVerdict {
  allowed: boolean;
  checkpoint?: CheckpointRecord;
  reason: string;
}

/**
 * §38: no GitHub write without a checkpoint.
 *
 * The newest checkpoint for the task must exist, be on the current branch and
 * still describe the current diff; otherwise the write is refused and the caller
 * is told to take a checkpoint first.
 */
export function guardGitHubWrite(input: PushGuardInput): PushGuardVerdict {
  const forTask = input.checkpoints
    .filter((checkpoint) => checkpoint.task_id === input.task_id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  const checkpoint = forTask[0];
  if (!checkpoint) {
    return { allowed: false, reason: `§38: refusing to ${input.operation.replace(/_/g, " ").toLowerCase()} — no local checkpoint exists for task ${input.task_id}` };
  }
  if (checkpoint.branch !== input.current.branch) {
    return { allowed: false, checkpoint, reason: `§38: the checkpoint was taken on ${checkpoint.branch} but the repository is on ${input.current.branch}` };
  }
  if (input.current.diff_hash && checkpoint.diff_hash !== input.current.diff_hash) {
    return { allowed: false, checkpoint, reason: `§38: the working tree changed after the checkpoint (${checkpoint.diff_hash.slice(0, 12)} → ${input.current.diff_hash.slice(0, 12)}); take a fresh checkpoint before the ${input.operation.replace(/_/g, " ").toLowerCase()}` };
  }
  return { allowed: true, checkpoint, reason: `§38: checkpoint ${checkpoint.id} covers this ${input.operation.replace(/_/g, " ").toLowerCase()} at ${checkpoint.head.slice(0, 12)}` };
}

/** A checkpoint that cannot be loaded is treated as absent, never as valid. */
export function isUsableCheckpoint(value: unknown): value is CheckpointRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CheckpointRecord>;
  return candidate.version === GIT_CHECKPOINT_VERSION
    && typeof candidate.head === "string" && candidate.head.length > 0
    && typeof candidate.branch === "string"
    && typeof candidate.diff_hash === "string" && /^[0-9a-f]{64}$/.test(candidate.diff_hash)
    && typeof candidate.task_id === "string" && candidate.task_id.length > 0
    && Array.isArray(candidate.changed_files);
}
