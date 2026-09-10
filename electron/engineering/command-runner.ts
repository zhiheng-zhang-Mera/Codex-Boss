import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { workspacePath } from "./native-tools";
export type AllowedCommand = "test" | "typecheck" | "build" | "lint";
export interface CommandEvidence { command: AllowedCommand; args: string[]; passed: boolean; exitCode: number | null; output: string; }
export interface RunAllowedCommandOptions {
  /**
   * Explicit child environment. Defaults to the developer's own `process.env`,
   * which is correct for the interactive path. Autonomous self-evolution
   * subprocesses must pass a sanitized environment instead
   * (`electron/credential-boundary/sanitized-environment.ts`, plan §9.2): a
   * Candidate worker may not inherit the Owner's ambient credentials.
   */
  env?: NodeJS.ProcessEnv;
}
// Direct executable arguments only. No model-supplied shell, flags, or package scripts.
export async function runAllowedCommand(root: string, command: AllowedCommand, files: string[] = [], options: RunAllowedCommandOptions = {}): Promise<CommandEvidence> {
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
  // Run in the developer's real environment: child scratch goes to a system
  // temp dir OUTSIDE the audited workspace. The running app redirects its own
  // TEMP to <workspace>/.cache/tmp (electron/main.ts), which would make nested
  // suites create their fixtures inside the audited repo — git tests would then
  // resolve the outer repo's .git and fail. If os.tmpdir() resolves inside the
  // workspace (the in-app case), fall back to the per-user %LOCALAPPDATA%\Temp.
  // ELECTRON_RUN_AS_NODE marks nested invocations for re-entry guards. Generous
  // timeout/buffer: a real repo's full test suite can run for minutes and emit
  // a large transcript — killing it mid-run would fake a failure.
  const scratchRootFor = (cwd: string): string => {
    const tmp = os.tmpdir();
    try {
      const cwdReal = fs.realpathSync(cwd).toLowerCase();
      const tmpReal = fs.realpathSync(tmp).toLowerCase();
      if (tmpReal === cwdReal || tmpReal.startsWith(cwdReal + path.sep)) {
        const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp") : undefined;
        const alt = (local && fs.existsSync(local)) ? local : path.join(os.homedir(), "AppData", "Local", "Temp");
        fs.mkdirSync(alt, { recursive: true });
        return alt;
      }
    } catch { /* fall through to os.tmpdir() */ }
    return tmp;
  };
  const temp = fs.mkdtempSync(path.join(scratchRootFor(cwd), "codex-boss-cmd-"));
  // Default env is the developer's own environment (interactive path, unchanged).
  // An autonomous Candidate passes a sanitized env instead (plan §9.2).
  const baseEnvironment = options.env ?? process.env;
  return new Promise((resolve) => execFile(process.execPath, args, { cwd, windowsHide: true, timeout: 900000, maxBuffer: 32 * 1024 * 1024, env: { ...baseEnvironment, ELECTRON_RUN_AS_NODE: "1", TEMP: temp, TMP: temp, TMPDIR: temp } }, (error, stdout, stderr) => resolve({ command, args, passed: !error, exitCode: !error ? 0 : typeof error.code === "number" ? error.code : null, output: String(stdout) + String(stderr) })));
}
