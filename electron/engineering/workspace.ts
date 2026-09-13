import fs from "node:fs";
import { workspacePath } from "./native-tools";
import path from "node:path";
import { validId } from "../commander/durable-json";
import { workspaceStrategy } from "./verification";
import { assertMutationAllowed } from "../self-evolution/mutation-guard";
import { canonicalRealPathSync } from "../workspace/path-utils";
import { runGitOrThrow, GIT_MAX_BUFFER_BYTES, GIT_TIMEOUT_MS } from "../git/git-gateway";
function git(root: string, args: string[]): Promise<string> {
  // Worktree/branch creation is the `large` band: it is bounded by disk, not by a
  // warm index, and it is a write — a truncated or timed-out call here must fail
  // loudly rather than look like a created worktree.
  return runGitOrThrow(canonicalRealPathSync(root), args, { timeoutMs: GIT_TIMEOUT_MS.large, maxBufferBytes: GIT_MAX_BUFFER_BYTES.standard });
}
export async function prepareWorkspace(root: string, taskId: string, risk: "low" | "medium" | "high", parallel: boolean): Promise<{ path: string; strategy: "current" | "branch" | "worktree"; branch?: string; base?: string }> {
  // §7.3: creating an isolation branch or worktree inside the Boss repository is
  // itself a mutation of Stable and must be covered by an evolution run.
  assertMutationAllowed(root);
  const directory = canonicalRealPathSync(root); const strategy = workspaceStrategy(risk, parallel);
  if (strategy === "current") return { path: directory, strategy };
  const branch = `codex/${validId(taskId)}`;
  const base = await git(directory, ["rev-parse", "HEAD"]);
  if (await git(directory, ["status", "--porcelain"])) throw new Error("Commit or preserve workspace changes before isolation");
  if (strategy === "branch") { await git(directory, ["switch", "-c", branch]); return { path: directory, strategy, branch, base }; }
  const target = path.join(directory, ".boss", "worktrees", validId(taskId));
  if (fs.existsSync(target)) throw new Error("Isolation directory already exists");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await git(directory, ["worktree", "add", "-b", branch, target, base]);
  return { path: target, strategy, branch, base };
}

export async function prepareStepWorkspace(root: string, stepId: string, files: string[]): Promise<string> {
  assertMutationAllowed(root);
  const target = path.join(canonicalRealPathSync(root), ".boss", "worktrees", validId(stepId));
  if (fs.existsSync(target)) throw new Error("Step isolation already exists; reconcile it before retry");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await git(root, ["worktree", "add", "--detach", target, "HEAD"]);
  // Seed explicitly scoped dependency files from the current verified working tree.
  for (const file of files) {
    const source = workspacePath(root, file); const destination = workspacePath(target, file);
    if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, fs.readFileSync(source)); }
  }
  return target;
}
