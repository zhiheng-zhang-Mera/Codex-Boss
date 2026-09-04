import fs from "node:fs";
import { runAllowedCommand, type AllowedCommand } from "./command-runner";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { workspacePath } from "./native-tools";
export interface FileChange { path: string; expectedSha256: string | null; content: string; }
export interface ChangeEvidence { path: string; before: string | null; after: string; }
export function digest(content: string): string { return createHash("sha256").update(content).digest("hex"); }
export function applyScopedChanges(root: string, changes: FileChange[], authorizedPaths: string[]): ChangeEvidence[] {
  if (!changes.length || changes.length > 50 || new Set(changes.map((item) => item.path)).size !== changes.length) throw new Error("Invalid change set");
  const authorized = new Set(authorizedPaths.map((item) => workspacePath(root, item)));
  // Preflight the entire manifest before changing any file.
  const prepared = changes.map((change) => {
    const target = workspacePath(root, change.path);
    if (!authorized.has(target)) throw new Error("Change outside authorized scope");
    if (/(^|[\\/])(?:\.git|\.codex|\.agents|AGENTS\.md)([\\/]|$)/i.test(change.path)) throw new Error("Protected workspace metadata");
    if (Buffer.byteLength(change.content) > 1000000) throw new Error("Change exceeds budget");
    const before = fs.existsSync(target) ? digest(fs.readFileSync(target, "utf8")) : null;
    if (before !== change.expectedSha256) throw new Error("Source changed since proposal");
    return { change, target, before };
  });
  return prepared.map(({ change, target, before }) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, change.content, "utf8");
    try { fs.renameSync(temp, target); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return { path: change.path, before, after: digest(fs.readFileSync(target, "utf8")) };
  });
}
export type CheckSpec = { kind: "syntax"; file: string } | { kind: "diff" } | { kind: AllowedCommand; files?: string[] };
export interface CheckEvidence { check: CheckSpec; passed: boolean; output: string; exitCode: number | null; }
export async function runCheck(root: string, check: CheckSpec): Promise<CheckEvidence> {
  if (check.kind !== "syntax" && check.kind !== "diff") { const result = await runAllowedCommand(root, check.kind, check.files); return { check, passed: result.passed, output: result.output, exitCode: result.exitCode }; }
  const executable = check.kind === "syntax" ? process.execPath : "git";
  const args = check.kind === "syntax" ? ["--check", workspacePath(root, check.file)] : ["diff", "--check"];
  return new Promise((resolve) => execFile(executable, args, { cwd: fs.realpathSync(root), windowsHide: true, timeout: 30000, maxBuffer: 1000000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout, stderr) => resolve({ check, passed: !error, output: `${stdout}${stderr}`, exitCode: !error ? 0 : typeof error.code === "number" ? error.code : null })));
}
export async function verifyAndRepair(root: string, checks: CheckSpec[], repair: (failures: CheckEvidence[], attempt: number) => Promise<void>, maxRepairs = 2, observe?: (evidence: CheckEvidence[]) => void): Promise<CheckEvidence[]> {
  if (!checks.length || !Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 2) throw new Error("Invalid verification bounds");
  let evidence = await Promise.all(checks.map((check) => runCheck(root, check)));
  observe?.(evidence);
  for (let attempt = 0; ; attempt++) {
    const failures = evidence.filter((item) => !item.passed);
    if (!failures.length || attempt >= maxRepairs) return evidence;
    await repair(failures, attempt + 1);
    const retried = await Promise.all(failures.map((item) => runCheck(root, item.check)));
    observe?.(retried);
    evidence = evidence.map((item) => retried.find((retry) => retry.check === item.check) ?? item);
    // Once targeted repairs pass, verify the complete required set against repaired source.
    if (evidence.every((item) => item.passed)) {
      const broader = await Promise.all(checks.filter((check) => !failures.some((item) => item.check === check)).map((check) => runCheck(root, check)));
      observe?.(broader);
      evidence = evidence.map((item) => broader.find((result) => result.check === item.check) ?? item);
    }
  }
}
export function workspaceStrategy(risk: "low" | "medium" | "high", parallel: boolean): "current" | "branch" | "worktree" { return parallel || risk === "high" ? "worktree" : risk === "medium" ? "branch" : "current"; }
