import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { workspacePath } from "./native-tools";
export type AllowedCommand = "test" | "typecheck" | "build" | "lint";
export interface CommandEvidence { command: AllowedCommand; args: string[]; passed: boolean; exitCode: number | null; output: string; }
// Direct executable arguments only. No model-supplied shell, flags, or package scripts.
export async function runAllowedCommand(root: string, command: AllowedCommand, files: string[] = []): Promise<CommandEvidence> {
  if (!["test", "typecheck", "build", "lint"].includes(command)) throw new Error("Command is not allowlisted");
  if (files.length > 50) throw new Error("Too many targeted files");
  const cwd = fs.realpathSync(root);
  const targets = files.map((file) => workspacePath(cwd, file));
  const local = (file: string) => { const target = workspacePath(cwd, file); if (!fs.existsSync(target)) throw new Error("Required local tool unavailable: " + file); return target; };
  let args: string[];
  try {
    if (command === "test") {
      // --maxWorkers=2 bounds parallel contention: the same full suite also runs
      // inside the live app (autonomous-loop audits), where the git/process-heavy
      // files otherwise fight the app's own processes and flake.
      if (fs.existsSync(path.join(cwd, "node_modules/vitest/vitest.mjs"))) args = [local("node_modules/vitest/vitest.mjs"), "run", "--maxWorkers=2", ...targets];
      else args = ["--test", ...targets];
    } else if (command === "lint") args = [local("node_modules/eslint/bin/eslint.js"), ...targets.length ? targets : [cwd]];
    else args = [local("node_modules/typescript/bin/tsc"), ...(command === "typecheck" ? ["--noEmit"] : ["--build"])];
  } catch (error) {
    // Missing local tooling is a real, recorded failure — never an exception
    // that masquerades as a successful/absent gate.
    return { command, args: [], passed: false, exitCode: null, output: String(error) };
  }
  // Run in the developer's real environment: child scratch goes to the OS temp
  // dir (NOT the app's workspace cache — the running app points TEMP at
  // <workspace>/.cache/tmp, which makes nested suites create temp repos inside
  // the audited repo). ELECTRON_RUN_AS_NODE marks nested invocations for
  // re-entry guards. Generous timeout/buffer: a real repo's full test suite can
  // run for minutes and emit a large transcript — killing it mid-run would fake
  // a failure.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-cmd-"));
  return new Promise((resolve) => execFile(process.execPath, args, { cwd, windowsHide: true, timeout: 900000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", TEMP: temp, TMP: temp, TMPDIR: temp } }, (error, stdout, stderr) => resolve({ command, args, passed: !error, exitCode: !error ? 0 : typeof error.code === "number" ? error.code : null, output: String(stdout) + String(stderr) })));
}
