import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  evolutionLayout,
  materializeEvolutionLayout,
  verifyRuntimeSeparation,
  RuntimeIsolationError,
  type EvolutionLayout
} from "./runtime-isolation";

/**
 * Candidate workspace manager (Update-Plan/Isolation-Finalization.md §8.1, §8.2).
 *
 * Stable is the supervisor; a Candidate is a separate workspace with an
 * immutable base SHA. This module is the Stable *host adapter*: it is the only
 * code that performs git ref writes for the evolution path. A Candidate worker
 * never runs git (its execution profile grants read-only inspection subcommands
 * at most), so the write side of git never sits behind model output.
 *
 * worktree vs clone — the decision recorded in evidence
 * -----------------------------------------------------
 * `git worktree` is used. The two conditions §8.2 attaches to that choice hold:
 *
 *   1. "Candidate worker 无任意 git shell 权限" — the EVOLUTION execution
 *      profile has no shell channel and its command classifier denies
 *      `git push|commit|checkout|switch|reset|clean|merge|rebase|config|apply`
 *      outright (`electron/root-authority/execution-profile.ts`).
 *   2. "git ref 写操作只由 Stable host adapter 完成" — every mutating git call
 *      in the evolution path lives in this file, invoked directly by the host.
 *   3. "Candidate 修改 API 只能访问 candidate root" — the Candidate's file
 *      access goes through the workspace containment rooted at
 *      `layout.workspace`.
 *
 * A worktree shares the object store (read-only for our purposes) but has its
 * own index, working tree and HEAD, so a Candidate cannot move Stable's refs.
 */

export interface CandidateWorkspaceOptions {
  /** Stable repository root (the trunk working tree). Never modified. */
  stableRoot: string;
  /** Root under which run directories are created; outside the stable tree. */
  evolutionRoot: string;
  /** Immutable base commit id (40-hex). */
  baseSha: string;
  /** Unique run id; also the branch suffix and directory name. */
  runId: string;
  /**
   * Permit a base that is not Stable's current HEAD. Off by default: the base is
   * supposed to be frozen, and silently allowing drift is how a Candidate ends
   * up validating one tree and promoting another.
   */
  allowNonHeadBase?: boolean;
}

export interface CandidateWorkspace {
  layout: EvolutionLayout;
  workspace: string;
  baseSha: string;
  stableHeadSha: string;
  strategy: "worktree";
  createdAt: string;
}

export class CandidateWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateWorkspaceError";
  }
}

function git(cwd: string, args: string[], timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new CandidateWorkspaceError(String(stderr) || error.message));
      else resolve(String(stdout).trim());
    });
  });
}

/** Current HEAD of a repository. */
export async function headSha(repoRoot: string): Promise<string> {
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

async function commitExists(repoRoot: string, sha: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an isolated Candidate workspace at the frozen base SHA.
 *
 * Refuses when: the base is not a real commit, the base is not Stable's current
 * HEAD (unless explicitly allowed), the run directory already exists, or the
 * resulting layout would overlap a Stable writable surface (§8.3).
 */
export async function createCandidateWorkspace(options: CandidateWorkspaceOptions): Promise<CandidateWorkspace> {
  const stableRoot = fs.realpathSync(options.stableRoot);
  const layout = evolutionLayout(options.evolutionRoot, options.runId, options.baseSha);

  if (!fs.existsSync(path.join(stableRoot, ".git")) && !fs.existsSync(path.join(stableRoot, ".git", "HEAD"))) {
    // A worktree's administration directory lives elsewhere; the primary repo is
    // the only supported Stable root, and it must look like a git repository.
    if (!fs.existsSync(path.join(stableRoot, ".git"))) throw new CandidateWorkspaceError(`${stableRoot} is not a git repository`);
  }

  const stableHeadSha = await headSha(stableRoot);
  if (!(await commitExists(stableRoot, options.baseSha))) throw new CandidateWorkspaceError(`base SHA ${options.baseSha} is not a commit in ${stableRoot}`);
  if (!options.allowNonHeadBase && options.baseSha !== stableHeadSha) {
    throw new CandidateWorkspaceError(`base SHA ${options.baseSha} is not the current Stable HEAD ${stableHeadSha}; refusing to build a Candidate on an unfrozen base`);
  }

  const separation = verifyRuntimeSeparation(layout, stableRoot);
  if (!separation.separated) throw new RuntimeIsolationError(`candidate runtime tree overlaps Stable surfaces: ${separation.overlaps.join(", ")}`);

  if (fs.existsSync(layout.root)) throw new CandidateWorkspaceError(`evolution run directory already exists: ${layout.root}`);
  materializeEvolutionLayout(layout);
  if (fs.existsSync(layout.workspace) && fs.readdirSync(layout.workspace).length > 0) {
    throw new CandidateWorkspaceError(`candidate workspace is not empty: ${layout.workspace}`);
  }
  fs.rmSync(layout.workspace, { recursive: true, force: true });

  // The single git ref write for the run: a new branch at the frozen SHA, in a
  // new working tree. Stable's own checkout and refs are untouched.
  await git(stableRoot, ["worktree", "add", "-b", layout.candidateBranch, layout.workspace, options.baseSha]);

  return { layout, workspace: layout.workspace, baseSha: options.baseSha, stableHeadSha, strategy: "worktree", createdAt: new Date().toISOString() };
}

/** The candidate's current HEAD, used by the exact-SHA gate. */
export async function candidateHeadSha(workspace: string): Promise<string> {
  return git(workspace, ["rev-parse", "HEAD"]);
}

/** Files changed in the candidate relative to its immutable base. */
export async function candidateChangedFiles(workspace: string, baseSha: string): Promise<string[]> {
  const output = await git(workspace, ["diff", "--name-only", baseSha]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** True when the candidate has uncommitted changes. */
export async function candidateIsDirty(workspace: string): Promise<boolean> {
  return (await git(workspace, ["status", "--porcelain"])).length > 0;
}

/** Commits the candidate's working tree (Stable host adapter side only). */
export async function commitCandidate(workspace: string, message: string): Promise<string> {
  await git(workspace, ["add", "-A"]);
  await git(workspace, ["-c", "user.name=Codex Boss Evolution", "-c", "user.email=evolution@codex-boss.local", "commit", "-m", message]);
  return candidateHeadSha(workspace);
}

/**
 * Removes a Candidate workspace. Stable's repository survives by construction:
 * only the linked working tree and its branch reference are removed.
 */
export async function removeCandidateWorkspace(workspace: string, stableRoot: string, options: { keepBranch?: boolean } = {}): Promise<void> {
  const branch = `evolution/${path.basename(path.dirname(workspace))}`;
  await git(stableRoot, ["worktree", "remove", "--force", workspace]);
  if (!options.keepBranch) {
    try {
      await git(stableRoot, ["branch", "-D", branch]);
    } catch {
      // The branch may already be gone (rejected run, manual cleanup). Remove is
      // best-effort; the worktree removal above is the load-bearing step.
    }
  }
}
