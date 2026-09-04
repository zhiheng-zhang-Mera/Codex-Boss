import fs from "node:fs";
import { runAllowedCommand } from "./command-runner";
import path from "node:path";
import { execFile } from "node:child_process";
import type { NativeOperation } from "../../src/shared/task-ir";
export interface NativeEvidence { operation: NativeOperation; cwd: string; output: string; verified: true; modelCalls: 0; }
export function workspacePath(root: string, requested: string): string {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, requested);
  const relative = path.relative(realRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Path escapes workspace");
  let existing = target;
  while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) throw new Error("Cannot resolve path"); existing = parent; }
  const real = fs.realpathSync(existing); const realRelative = path.relative(realRoot, real);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error("Symlink escapes workspace");
  return target;
}
export async function executeNative(root: string, operation: NativeOperation): Promise<NativeEvidence> {
  const cwd = fs.realpathSync(root); let output: string;
  if (["git_status", "git_diff", "git_diff_check"].includes(operation.kind)) output = await new Promise<string>((resolve, reject) => execFile("git", operation.kind === "git_status" ? ["--no-optional-locks", "status", "--short", "--branch"] : operation.kind === "git_diff_check" ? ["diff", "--check"] : ["diff", "--no-ext-diff", "--no-textconv"], { cwd, windowsHide: true, timeout: 15000, maxBuffer: 1000000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  else if (operation.kind === "read_file" || operation.kind === "inspect_log" || operation.kind === "read_ranges" || operation.kind === "search_text") { const file = workspacePath(cwd, operation.path); if (fs.statSync(file).size > 1000000) throw new Error("File exceeds read budget"); output = fs.readFileSync(file, "utf8");
    if (operation.kind === "read_ranges") output = output.split(/\r?\n/).slice(operation.start - 1, operation.end).join("\n");
    if (operation.kind === "inspect_log") output = output.slice(-20000);
    if (operation.kind === "search_text") output = output.split(/\r?\n/).flatMap((line, index) => line.includes(operation.text) ? [(index + 1) + ":" + line] : []).slice(0, 200).join("\n");
  }
  else if (operation.kind === "list_files") output = fs.readdirSync(workspacePath(cwd, operation.path)).sort().join("\n");
  else { const result = await runAllowedCommand(cwd, operation.kind.replace("run_", "") as "test" | "build" | "lint" | "typecheck", "files" in operation ? operation.files : []); if (!result.passed) throw new Error(result.output || "Command failed"); output = JSON.stringify(result); }
  return { operation, cwd, output, verified: true, modelCalls: 0 };
}
