import fs from "node:fs";
import { runAllowedCommand } from "./command-runner";
import path from "node:path";
import { runGit, GIT_MAX_BUFFER_BYTES, GIT_TIMEOUT_MS } from "../git/git-gateway";
import { canonicalRealPathSync, deepestExistingAncestor, isInsideWorkspace } from "../workspace/path-utils";
import type { NativeOperation } from "../../src/shared/task-ir";
export interface NativeEvidence { operation: NativeOperation; cwd: string; output: string; verified: true; modelCalls: 0; }
export function workspacePath(root: string, requested: string): string {
  // One containment rule for the whole application
  // (electron/workspace/path-utils.ts#isInsideWorkspace); this module is the
  // tool-facing wrapper that turns a refusal into the tool's own error text.
  const realRoot = canonicalRealPathSync(root);
  const target = path.resolve(realRoot, requested);
  if (!isInsideWorkspace(realRoot, target)) throw new Error("Path escapes workspace");
  if (!deepestExistingAncestor(target)) throw new Error("Cannot resolve path");
  if (!isInsideWorkspace(realRoot, target, { followSymlinks: true })) throw new Error("Symlink escapes workspace");
  return target;
}
export async function executeNative(root: string, operation: NativeOperation): Promise<NativeEvidence> {
  const cwd = canonicalRealPathSync(root); let output: string;
  if (["git_status", "git_diff", "git_diff_check"].includes(operation.kind)) {
    const args = operation.kind === "git_status" ? ["--no-optional-locks", "status", "--short", "--branch"] : operation.kind === "git_diff_check" ? ["diff", "--check"] : ["diff", "--no-ext-diff", "--no-textconv"];
    const result = await runGit(cwd, args, { timeoutMs: GIT_TIMEOUT_MS.quick, maxBufferBytes: GIT_MAX_BUFFER_BYTES.small });
    // A tool that silently returned empty output on a failed git read would let a
    // model believe it had inspected a repository it never saw.
    if (!result.ok) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed (code ${result.code ?? "unknown"})`);
    output = result.stdout;
  }
  else if (operation.kind === "read_file" || operation.kind === "inspect_log" || operation.kind === "read_ranges" || operation.kind === "search_text") { const file = workspacePath(cwd, operation.path); if (fs.statSync(file).size > 1000000) throw new Error("File exceeds read budget"); output = fs.readFileSync(file, "utf8");
    if (operation.kind === "read_ranges") output = output.split(/\r?\n/).slice(operation.start - 1, operation.end).join("\n");
    if (operation.kind === "inspect_log") output = output.slice(-20000);
    if (operation.kind === "search_text") output = output.split(/\r?\n/).flatMap((line, index) => line.includes(operation.text) ? [(index + 1) + ":" + line] : []).slice(0, 200).join("\n");
  }
  else if (operation.kind === "list_files") output = fs.readdirSync(workspacePath(cwd, operation.path)).sort().join("\n");
  else { const result = await runAllowedCommand(cwd, operation.kind.replace("run_", "") as "test" | "build" | "lint" | "typecheck", "files" in operation ? operation.files : []); if (!result.passed) throw new Error(result.output || "Command failed"); output = JSON.stringify(result); }
  return { operation, cwd, output, verified: true, modelCalls: 0 };
}
