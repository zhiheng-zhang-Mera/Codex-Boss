import fs from "node:fs";
import path from "node:path";
import { workspacePath } from "./native-tools";
import { removeTree } from "../fs-util";
import { canonicalRealPathSync, isSameDirectory } from "../workspace/path-utils";
import { runGit, GIT_MAX_BUFFER_BYTES, GIT_TIMEOUT_MS } from "../git/git-gateway";

/**
 * Git checkpoint / rollback for change sets (plan §38). Pure process helpers.
 *
 * checkpointRecord() snapshots the working tree so a later rollback can return
 * the repository to exactly that state: it records the current HEAD, the
 * tracked files that differ from HEAD (with their checkpoint worktree content),
 * and the untracked files present before the change.
 *
 * rollbackToCheckpoint() undoes everything the change did while preserving
 * state that predated it:
 *   - tracked files modified by the change (clean at checkpoint) are reverted
 *     to HEAD content via `git checkout --`;
 *   - tracked files already dirty at checkpoint are restored from the recorded
 *     snapshot (their pre-change worktree content, or removed if the snapshot
 *     recorded them as absent);
 *   - untracked files created after the checkpoint are removed, while
 *     untracked files that predate it are never touched.
 * Operations are fail-closed: rollback refuses to run if the repository HEAD
 * advanced past the checkpoint, and a non-git workspace errors explicitly.
 */
export interface CheckpointSnapshot {
  /** The checkpoint base HEAD (rollback refuses to run if HEAD moved on). */
  head: string;
  /** Tracked files that differed from HEAD at checkpoint time. */
  dirty: string[];
  /** Untracked files present before the change (never auto-removed). */
  preExistingUntracked: string[];
  /** Worktree content of each dirty file at checkpoint; null = file absent. */
  snapshots: Record<string, string | null>;
}

interface GitOutput { stdout: string; stderr: string; code: number | null }

function git(root: string, args: string[]): Promise<GitOutput> {
  // Through the one git entry point: this is a read against a warm repository, so
  // it takes the `quick` band — a hung `git status` must not hold the recovery
  // path open, and the buffer is stated rather than inherited.
  return runGit(canonicalRealPathSync(root), args, { timeoutMs: GIT_TIMEOUT_MS.quick, maxBufferBytes: GIT_MAX_BUFFER_BYTES.small })
    .then((result) => ({ stdout: result.stdout, stderr: result.stderr, code: result.code }));
}

/** Files that differ from HEAD in the worktree or index (NUL-safe names). */
async function modifiedSinceHead(root: string): Promise<string[]> {
  const diff = await git(root, ["diff", "--name-only", "-z", "HEAD"]);
  if (diff.code !== 0) throw new Error(`Cannot diff repository: ${diff.stderr || diff.stdout}`);
  return diff.stdout.split("\0").map((name) => name.trim()).filter(Boolean);
}

/** Untracked file paths (porcelain `??` entries, unquoted where possible). */
async function untrackedFiles(root: string): Promise<string[]> {
  const status = await git(root, ["status", "--porcelain"]);
  const files: string[] = [];
  for (const line of status.stdout.split("\n")) {
    if (line.startsWith("??")) files.push(line.slice(3).trim().replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return files;
}

export function isGitRepository(root: string): boolean {
  return fs.existsSync(path.join(canonicalRealPathSync(root), ".git"));
}

/** Records the current tree state as the rollback target. */
export async function checkpointRecord(root: string): Promise<CheckpointSnapshot> {
  // Both sides of the "is this the repository root?" comparison must be the
  // OS-canonical spelling. `fs.realpathSync` does not expand Windows 8.3 short
  // names while `git rev-parse --show-toplevel` reports the long one, so mixing
  // them would refuse a workspace that IS the repository root whenever the path
  // contains a short-name component (e.g. `C:\Users\RUNNER~1\...`).
  const base = canonicalRealPathSync(root);
  const head = await git(base, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new Error(`Checkpoint requires a git workspace: ${head.stderr || head.stdout}`);
  // The workspace must BE the repository root, not merely live inside one.
  // `git status`/`git diff` report paths relative to the repository root, and
  // every path below is resolved against `base`; for a nested directory those
  // two disagree, so a "recovery point" taken there would restore the WRONG
  // files — and would roll back the enclosing repository, which is not the
  // workspace at all. Fail closed instead (Update-Plan/cleaning.md §7: no
  // recovery point means no autonomous mutation).
  const topLevel = await git(base, ["rev-parse", "--show-toplevel"]);
  if (topLevel.code !== 0) throw new Error(`Checkpoint requires a git work tree: ${topLevel.stderr || topLevel.stdout}`);
  const repositoryRoot = canonicalRealPathSync(topLevel.stdout.trim());
  if (!isSameDirectory(base, repositoryRoot)) {
    throw new Error(`Workspace ${base} is not a git repository root; the enclosing repository is ${repositoryRoot}. Refusing to checkpoint a nested directory.`);
  }
  const dirty = await modifiedSinceHead(base);
  const snapshots: Record<string, string | null> = {};
  for (const file of dirty) {
    const target = workspacePath(base, file);
    snapshots[file] = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  }
  return { head: head.stdout.trim(), dirty, preExistingUntracked: await untrackedFiles(base), snapshots };
}

/**
 * Reverts the tree to the checkpoint state (see module docstring). Files that
 * predate the change keep their exact checkpoint content; files the change
 * modified are reverted to HEAD; post-checkpoint untracked files are removed.
 */
export async function rollbackToCheckpoint(root: string, checkpoint: CheckpointSnapshot): Promise<{ restored: string[]; removed: string[] }> {
  const base = canonicalRealPathSync(root);
  const head = await git(base, ["rev-parse", "HEAD"]);
  if (head.code !== 0 || head.stdout.trim() !== checkpoint.head) throw new Error("Repository advanced past checkpoint; refusing rollback");
  const current = await modifiedSinceHead(base);
  const restored: string[] = [];
  // Every file that differs from HEAD now and was dirty at checkpoint returns
  // to its snapshot; files the change dirtied (clean at checkpoint) return to HEAD.
  for (const file of [...new Set([...checkpoint.dirty, ...current])]) {
    if (Object.prototype.hasOwnProperty.call(checkpoint.snapshots, file)) {
      const target = workspacePath(base, file);
      if (checkpoint.snapshots[file] === null) {
        if (fs.existsSync(target)) { removeTree(target); restored.push(file); }
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, checkpoint.snapshots[file] as string);
        restored.push(file);
      }
    } else if (current.includes(file)) {
      const result = await git(base, ["checkout", "--", file]);
      if (result.code === 0) restored.push(file);
    }
  }
  // Remove untracked files created since the checkpoint (never the pre-existing ones).
  const preExisting = new Set(checkpoint.preExistingUntracked);
  const removed: string[] = [];
  for (const file of await untrackedFiles(base)) {
    if (preExisting.has(file)) continue;
    const target = workspacePath(base, file);
    if (fs.existsSync(target)) { removeTree(target); removed.push(file); }
  }
  return { restored, removed };
}
