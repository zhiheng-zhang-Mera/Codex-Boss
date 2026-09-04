import fs from "node:fs";
import { workspacePath } from "./native-tools";
import path from "node:path";
import { execFile } from "node:child_process";
import { validId } from "../commander/durable-json";
import { workspaceStrategy } from "./verification";
function git(root: string, args: string[]): Promise<string> { return new Promise((resolve, reject) => execFile("git", args, { cwd: root, windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr) || error.message)) : resolve(stdout.trim()))); }
export async function prepareWorkspace(root: string, taskId: string, risk: "low" | "medium" | "high", parallel: boolean): Promise<{ path: string; strategy: "current" | "branch" | "worktree"; branch?: string; base?: string }> {
  const directory = fs.realpathSync(root); const strategy = workspaceStrategy(risk, parallel);
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
  const target = path.join(fs.realpathSync(root), ".boss", "worktrees", validId(stepId));
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
