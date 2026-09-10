import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProcessOutcome, ProcessRunner } from "./acceptance-hub-runner";

/**
 * Host-M P1 — the real process seam.
 *
 * Kept in its own file so the orchestration stays pure and testable: nothing in
 * `acceptance-hub-runner.ts` imports `node:child_process`.
 *
 * Behaviour that matters for honest evidence:
 * - argv is passed without a shell, so the exact declared command is executed;
 * - the timeout is enforced here and always reported as `timedOut` (never as a
 *   silent success), and the child tree is killed so a hung check cannot keep
 *   the hub alive;
 * - output is streamed into bounded buffers with a hard cap, so a runaway check
 *   cannot exhaust memory;
 * - a missing executable becomes `spawnError`, i.e. a FAIL for that check only.
 */

const MAX_BUFFER_CHARS = 512 * 1024;

/**
 * Windows cannot `spawn` a `.cmd`/`.bat` shim without a shell (Node raises
 * `EINVAL`), and enabling a shell would put the check's arguments through
 * `cmd.exe` parsing. Instead the package-manager shims are mapped onto the
 * Node entry point they actually are, and every check keeps running with
 * `shell: false` — which the acceptance hub's own first run caught as a real
 * defect (`could not start the check: spawn EINVAL`) rather than hiding.
 */
const NODE_ENTRY_POINTS: Record<string, string[]> = {
  npx: ["npm", "bin", "npx-cli.js"],
  npm: ["npm", "bin", "npm-cli.js"]
};

/**
 * On Windows only these names are *shell shims* rather than real executables.
 * Anything else (`node`, `git`, `powershell`, …) is a genuine `.exe` and must
 * NOT get a `.cmd` suffix — appending it to every name produced `spawn EINVAL`
 * for `node` as well, which the process-seam test below now guards against.
 */
const WINDOWS_SHIM_NAMES = new Set(["npm", "npx", "pnpm", "yarn", "corepack"]);

/**
 * Resolves an executable name to a concrete command. Package-manager shims are
 * mapped onto the Node entry point they actually are; other Windows shims get
 * their `.cmd` suffix; everything else is passed through untouched. Every check
 * therefore keeps running with `shell: false`.
 */
export function resolveCommand(
  name: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  const entry = NODE_ENTRY_POINTS[name];
  if (entry) {
    const cli = findPackageManagerEntry(entry);
    if (cli) return { command: process.execPath, args: [cli, ...args] };
  }
  if (platform !== "win32") return { command: name, args: [...args] };
  if (WINDOWS_SHIM_NAMES.has(name)) return { command: `${name}.cmd`, args: [...args] };
  return { command: name, args: [...args] };
}

/**
 * Locates `npm`/`npx` by walking up from the current Node binary and then from
 * the working directory, covering both the standard Node install layout
 * (`<node>/node_modules/npm/bin/…`) and a repo-local install.
 */
function findPackageManagerEntry(entry: string[]): string | undefined {
  const candidates: string[] = [];
  const nodeRoot = path.dirname(process.execPath);
  candidates.push(path.join(nodeRoot, "node_modules", ...entry));
  // pnpm/nvm layouts keep the shims one level down.
  candidates.push(path.join(nodeRoot, "..", "node_modules", ...entry));
  candidates.push(path.join(path.dirname(nodeRoot), "lib", "node_modules", ...entry));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // unreadable candidate — keep looking
    }
  }
  return undefined;
}

export interface NodeProcessRunnerOptions {
  platform?: NodeJS.Platform;
  /** Extra environment for child processes. */
  env?: NodeJS.ProcessEnv;
}

export function createNodeProcessRunner(options: NodeProcessRunnerOptions = {}): ProcessRunner {
  const platform = options.platform ?? process.platform;
  return {
    run(name, args, runOptions): Promise<ProcessOutcome> {
      return new Promise<ProcessOutcome>((resolve) => {
        const startedAt = Date.now();
        const stdout: string[] = [];
        const stderr: string[] = [];
        let stdoutChars = 0;
        let stderrChars = 0;
        const capture = (sink: string[], text: string, current: number): number => {
          if (current >= MAX_BUFFER_CHARS) return current;
          sink.push(text);
          return current + text.length;
        };

        if (!fs.existsSync(runOptions.cwd)) {
          resolve({
            exitCode: null,
            timedOut: false,
            stdout: "",
            stderr: "",
            durationMs: Date.now() - startedAt,
            spawnError: `working directory does not exist: ${runOptions.cwd}`
          });
          return;
        }

        const resolved = resolveCommand(name, args, platform);
        let child;
        try {
          child = spawn(resolved.command, resolved.args, {
            cwd: runOptions.cwd,
            env: { ...process.env, ...options.env },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false
          });
        } catch (error) {
          resolve({
            exitCode: null,
            timedOut: false,
            stdout: "",
            stderr: "",
            durationMs: Date.now() - startedAt,
            spawnError: String(error)
          });
          return;
        }

        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, runOptions.timeoutMs);

        const settle = (outcome: ProcessOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          stdoutChars = capture(stdout, chunk.toString("utf8"), stdoutChars);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderrChars = capture(stderr, chunk.toString("utf8"), stderrChars);
        });
        child.on("error", (error) => {
          settle({
            exitCode: null,
            timedOut: false,
            stdout: stdout.join(""),
            stderr: stderr.join(""),
            durationMs: Date.now() - startedAt,
            spawnError: String(error)
          });
        });
        child.on("close", (code, signal) => {
          settle({
            exitCode: code,
            signal,
            timedOut,
            stdout: stdout.join(""),
            stderr: stderr.join(""),
            durationMs: Date.now() - startedAt
          });
        });
      });
    }
  };
}

/**
 * Kills the whole child tree. `taskkill /T` is used on Windows because `npm run`
 * and `vitest` spawn grandchildren that would otherwise survive the timeout and
 * keep locks on the repo.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return;
    } catch {
      // fall through to the direct kill
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Evidence location convention used by every Host-M phase. */
export function acceptanceEvidenceDir(repoRoot: string): string {
  return path.join(repoRoot, "artifacts", "host-acceptance");
}
