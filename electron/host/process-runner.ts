import { killProcessTree, superviseProcess } from "../process/process-gateway";
import fs from "node:fs";
import path from "node:path";
import type { ProcessOutcome, ProcessRunner } from "./acceptance-hub-runner";

/**
 * Host-M P1 — the real process seam.
 *
 * Kept in its own file so the orchestration stays pure and testable: the process
 * itself is started by `electron/process/process-gateway.ts` (Phase M), which is the
 * only place this path spawns anything. What this module states is its own policy —
 * the bound, the capture size, how the tree is stopped — and how an outcome becomes
 * a host verdict.
 *
 * Behaviour that matters for honest evidence:
 * - argv is passed without a shell, so the exact declared command is executed;
 * - the timeout is enforced there and always reported as `timedOut` (never as a
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
    // The bundled Codex runtime intentionally ships pnpm without npm/npx.
    // Preserve shell-free execution by translating npx to `pnpm exec` rather
    // than falling back to a non-existent npx.cmd shim.
    if (name === "npx") {
      const pnpm = findBundledPnpmEntry();
      if (pnpm) return { command: process.execPath, args: [pnpm, "exec", ...args] };
    }
  }
  if (platform !== "win32") return { command: name, args: [...args] };
  if (WINDOWS_SHIM_NAMES.has(name)) return { command: `${name}.cmd`, args: [...args] };
  return { command: name, args: [...args] };
}

function findBundledPnpmEntry(): string | undefined {
  const nodeRoot = path.dirname(process.execPath);
  const candidates = [
    path.join(path.dirname(nodeRoot), "node_modules", "pnpm", "bin", "pnpm.mjs"),
    path.join(nodeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs")
  ];
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
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
    async run(name, args, runOptions): Promise<ProcessOutcome> {
      const startedAt = Date.now();
      // A working directory that is not there is reported before anything is
      // started: the reason is the host's own wording, and it is what a failed
      // acceptance step quotes.
      if (!fs.existsSync(runOptions.cwd)) {
        return {
          exitCode: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          spawnError: `working directory does not exist: ${runOptions.cwd}`
        };
      }
      const resolved = resolveCommand(name, args, platform);
      // Phase M: the process itself is started by the gateway. What this module
      // states is its own policy — the bound, the capture size and how the tree is
      // stopped — and how an outcome becomes a host verdict.
      const outcome = await superviseProcess(resolved.command, resolved.args, {
        timeoutMs: runOptions.timeoutMs,
        // Character bounds, exactly as this runner always counted them.
        maxStdoutChars: MAX_BUFFER_CHARS,
        maxStderrChars: MAX_BUFFER_CHARS,
        cwd: runOptions.cwd,
        env: { ...process.env, ...options.env },
        // `npm run` and `vitest` spawn grandchildren that would otherwise survive
        // the bound and keep locks on the repository, so the whole tree is stopped.
        stop: (child) => killProcessTree(child.pid)
      });
      if (outcome.spawnError) {
        return { exitCode: outcome.code, timedOut: outcome.timedOut, stdout: outcome.stdout, stderr: outcome.stderr, durationMs: outcome.durationMs, spawnError: outcome.spawnError };
      }
      return {
        exitCode: outcome.code,
        signal: outcome.signal ?? undefined,
        timedOut: outcome.timedOut,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        durationMs: outcome.durationMs
      };
    }
  };
}

/** Evidence location convention used by every Host-M phase. */
export function acceptanceEvidenceDir(repoRoot: string): string {
  return path.join(repoRoot, "artifacts", "host-acceptance");
}
