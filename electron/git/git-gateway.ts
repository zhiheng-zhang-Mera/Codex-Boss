import { execFile, spawnSync } from "node:child_process";

/**
 * The one place that runs `git` (convergence book, Phase M).
 *
 * Git is a side effect with process, filesystem and network reach, and it used to
 * be spawned from ~20 modules with independently chosen timeouts, buffers and
 * error conventions — some resolved `{code}`, some resolved trimmed stdout, some
 * rejected, one swallowed. That is how a "git failed" turns into a silent success
 * in one module and a crash in another.
 *
 * Every call here states two things explicitly:
 *
 *  - **the timeout**, from a named band, because "how long may git take" is a
 *    decision about the operation (a status read is not a clone);
 *  - **the buffer**, because a truncated transcript that looks complete is worse
 *    than a failed one.
 *
 * The result never throws: `ok` is the answer, and the caller decides whether a
 * non-zero exit is a failure. Callers that genuinely want an exception use
 * `runGitOrThrow`, which throws with git's own stderr attached.
 */

export interface GitRunOptions {
  /** How long the command may take. Defaults to `GIT_TIMEOUT_MS.standard`. */
  timeoutMs?: number;
  /** Max captured output. Defaults to `GIT_MAX_BUFFER.standard`. */
  maxBufferBytes?: number;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** True when git exited 0. */
  ok: boolean;
}

/** Named timeout bands, so a call site states which kind of operation it is. */
export const GIT_TIMEOUT_MS = {
  /** A read against a warm repository: status, rev-parse, diff of one path. */
  quick: 15_000,
  /** A normal repository operation, including a full diff. */
  standard: 30_000,
  /** Clone, fetch, worktree add — operations bounded by the network or by disk. */
  large: 120_000
} as const;

/** Named buffer bands, so a truncated transcript is never mistaken for a complete one. */
export const GIT_MAX_BUFFER_BYTES = {
  small: 1_000_000,
  standard: 4 * 1024 * 1024,
  large: 16 * 1024 * 1024
} as const;

function resolveOptions(options: GitRunOptions): { timeoutMs: number; maxBufferBytes: number } {
  return {
    timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS.standard,
    maxBufferBytes: options.maxBufferBytes ?? GIT_MAX_BUFFER_BYTES.standard
  };
}

export function runGit(cwd: string, args: readonly string[], options: GitRunOptions = {}): Promise<GitRunResult> {
  const { timeoutMs, maxBufferBytes } = resolveOptions(options);
  return new Promise((resolve) => {
    execFile("git", [...args], { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: maxBufferBytes, encoding: "utf8" },
      (error, stdout, stderr) => {
        const rawCode = error ? (error as { code?: unknown }).code : 0;
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code: typeof rawCode === "number" ? rawCode : null,
          ok: !error
        });
      });
  });
}

export function runGitSync(cwd: string, args: readonly string[], options: GitRunOptions = {}): GitRunResult {
  const { timeoutMs, maxBufferBytes } = resolveOptions(options);
  const result = spawnSync("git", [...args], { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: maxBufferBytes, encoding: "utf8" });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    code: typeof result.status === "number" ? result.status : null,
    ok: result.status === 0
  };
}

/** Trimmed stdout, or a throw carrying git's own stderr as the message. */
export async function runGitOrThrow(cwd: string, args: readonly string[], options: GitRunOptions = {}): Promise<string> {
  const result = await runGit(cwd, args, options);
  if (!result.ok) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed (code ${result.code ?? "unknown"})`);
  return result.stdout.trim();
}
