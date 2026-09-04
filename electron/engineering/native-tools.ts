import fs from "node:fs";
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
  if (operation.kind === "git_status") output = await new Promise<string>((resolve, reject) => execFile("git", ["--no-optional-locks", "status", "--short", "--branch"], { cwd, windowsHide: true, timeout: 15000, maxBuffer: 1000000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  else if (operation.kind === "read_file") { const file = workspacePath(cwd, operation.path); if (fs.statSync(file).size > 1000000) throw new Error("File exceeds read budget"); output = fs.readFileSync(file, "utf8"); }
  else output = fs.readdirSync(workspacePath(cwd, operation.path)).sort().join("\n");
  return { operation, cwd, output, verified: true, modelCalls: 0 };
}
