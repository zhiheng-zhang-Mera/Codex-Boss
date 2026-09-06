import fs from "node:fs";
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
  if (command === "test") {
    if (fs.existsSync(path.join(cwd, "node_modules/vitest/vitest.mjs"))) args = [local("node_modules/vitest/vitest.mjs"), "run", ...targets];
    else args = ["--test", ...targets];
  } else if (command === "lint") args = [local("node_modules/eslint/bin/eslint.js"), ...targets.length ? targets : [cwd]];
  else args = [local("node_modules/typescript/bin/tsc"), ...(command === "typecheck" ? ["--noEmit"] : ["--build"])];
  const temp = path.join(cwd, ".boss", "tmp"); fs.mkdirSync(temp, { recursive: true });
  return new Promise((resolve) => execFile(process.execPath, args, { cwd, windowsHide: true, timeout: 120000, maxBuffer: 1000000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", TEMP: temp, TMP: temp, TMPDIR: temp } }, (error, stdout, stderr) => resolve({ command, args, passed: !error, exitCode: !error ? 0 : typeof error.code === "number" ? error.code : null, output: String(stdout) + String(stderr) })));
}
