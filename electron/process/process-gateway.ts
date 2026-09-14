import { execFile, spawnSync } from "node:child_process";

/**
 * The one place that runs a child process for its output (convergence book,
 * Phase M).
 *
 * Phase M's git half gave every `git` spawn a single entry point. This is the
 * other half: compilers, checkers, CLIs and engines that a module starts to get
 * an answer back. They were spawned from thirteen modules with independently
 * chosen timeouts, buffers and error conventions, and the conventions disagreed
 * in a way that loses evidence:
 *
 *  - a **missing executable** and a **failing check** were both reported as
 *    `passed: false, exitCode: null, output: ""`. The empty transcript is the
 *    defect: an operator reading the record cannot tell "the linter found three
 *    problems" from "the linter is not installed";
 *  - a **timeout kill** looked like a normal non-zero exit, so a check that
 *    never finished was recorded as a check that failed;
 *  - one module turned any error into a rejected promise while its neighbours
 *    resolved a `{code}` object, so the same missing tool crashed one caller and
 *    silently degraded another.
 *
 * Two rules make the answer trustworthy:
 *
 *  - **the bound is stated by the caller** — `timeoutMs` and `maxBufferBytes` are
 *    required, with named bands exported for the shapes that exist, because "how
 *    long may this take" and "how much may it print" are decisions about the
 *    operation, not library defaults;
 *  - **the result never throws** — `ok` is the answer, `spawnError` says the
 *    process never produced an exit status at all, and `timedOut` separates the
 *    bound from a launch failure. A caller that wants the transcript uses
 *    `processTranscript`, which appends the launch failure instead of returning
 *    an empty string.
 */

/** Named timeout bands, so a call site states which kind of operation it is. */
export const PROCESS_TIMEOUT_MS = {
  /** Does this executable exist and answer? A version probe, a CLI status read. */
  probe: 5_000,
  /** A tool that is already warm and returns one answer. */
  short: 15_000,
  /** One check over one artifact: a syntax check, a diff check. */
  check: 30_000,
  /** A tool that has to initialise a large runtime before it prints anything. */
  build: 120_000,
  /** A whole-repository gate: a full test suite or a typecheck over the tree. */
  suite: 900_000
} as const;

/** Named buffer bands, so a truncated transcript is never mistaken for a complete one. */
export const PROCESS_MAX_BUFFER_BYTES = {
  small: 1_000_000,
  standard: 2_000_000,
  large: 4 * 1024 * 1024,
  xlarge: 8 * 1024 * 1024,
  huge: 32 * 1024 * 1024
} as const;

export interface ProcessRunOptions {
  /** How long the command may take. Required: the gateway states no default bound. */
  timeoutMs: number;
  /** Max captured output. Required for the same reason: a silent truncation is a wrong answer. */
  maxBufferBytes: number;
  /** Working directory. Omitted means this process's own. */
  cwd?: string;
  /**
   * The child's entire environment. Omitted means inherit this process's, which
   * is what passing no `env` has always meant.
   */
  env?: NodeJS.ProcessEnv;
  /** Cancellation, for the asynchronous form. Aborting kills the child. */
  signal?: AbortSignal;
}

export interface ProcessRunResult {
  file: string;
  args: string[];
  stdout: string;
  stderr: string;
  /** The exit status, or `null` when the process never produced one. */
  code: number | null;
  /** True when the process ran and exited 0. */
  ok: boolean;
  /** The bound killed the process before it exited. */
  timedOut: boolean;
  /**
   * Set when no exit status was produced: the binary was missing, the working
   * directory was gone, the process was cancelled, or the timeout killed it.
   * `timedOut` distinguishes the last case. This is a full sentence suitable for
   * a record — `processTranscript` is the usual way to attach it.
   */
  spawnError?: string;
}

/** What each runtime calls "the bound was hit": execFile on `maxBuffer`, spawnSync on `maxBuffer`. */
const OVERFLOW_CODES = ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "ENOBUFS"];

/**
 * Why a run produced no exit status, as a sentence, or an empty description when
 * the process did run. A non-zero exit is deliberately NOT a failure here: the
 * caller asked for a process and got an exit status back, which is the answer it
 * wanted.
 *
 * The three cases are named separately because they need different responses: a
 * timeout says the bound is wrong or the tool hangs, an overflow says the
 * transcript was cut, and a launch failure says the tool is not there.
 */
function failureOf(file: string, timeoutMs: number, maxBufferBytes: number, error: unknown, rawCode: unknown, cancelled: boolean): { timedOut: boolean; spawnError?: string } {
  if (!error) return { timedOut: false };
  if (typeof rawCode === "number") return { timedOut: false };
  if (cancelled) return { timedOut: false, spawnError: `${file} was cancelled before it exited` };
  const code = String(rawCode ?? "");
  const timedOut = code === "ETIMEDOUT" || (error as { killed?: boolean }).killed === true;
  if (timedOut) return { timedOut: true, spawnError: `${file} was killed after ${timeoutMs}ms without exiting` };
  if (OVERFLOW_CODES.includes(code)) return { timedOut: false, spawnError: `${file} printed more than the ${maxBufferBytes}-byte bound and was stopped; its transcript is truncated` };
  return { timedOut: false, spawnError: `${file} could not be started: ${String((error as Error).message ?? error)}` };
}

/** Runs a process to completion, capturing both streams. Never throws, never rejects. */
export function runProcess(file: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
  const { timeoutMs, maxBufferBytes, cwd, env, signal } = options;
  const argv = [...args];
  return new Promise((resolve) => {
    execFile(file, argv, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: maxBufferBytes, encoding: "utf8", env, signal },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        resolve({
          file,
          args: argv,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          // Success carries no error object to read a status from: exit 0 is the status.
          code: !error ? 0 : typeof rawCode === "number" ? rawCode : null,
          ok: !error,
          ...failureOf(file, timeoutMs, maxBufferBytes, error, rawCode, signal?.aborted === true)
        });
      });
  });
}

/** The synchronous form, for a caller that cannot await (an engine probe at construction). */
export function runProcessSync(file: string, args: readonly string[], options: ProcessRunOptions): ProcessRunResult {
  const { timeoutMs, maxBufferBytes, cwd, env } = options;
  const argv = [...args];
  const result = spawnSync(file, argv, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: maxBufferBytes, encoding: "utf8", env });
  const rawCode = (result.error as { code?: unknown } | undefined)?.code;
  return {
    file,
    args: argv,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    code: typeof result.status === "number" ? result.status : null,
    ok: result.status === 0,
    ...failureOf(file, timeoutMs, maxBufferBytes, result.error, rawCode, false)
  };
}

/**
 * The transcript to record as evidence: the two streams, with the launch failure
 * appended when there was one.
 *
 * This is the fix for the empty-evidence defect. A caller that records
 * `${stdout}${stderr}` verbatim writes an empty string both when a command was
 * silent and when it never started; a truncated transcript (the buffer bound was
 * hit) is likewise indistinguishable from a complete one without the reason.
 */
export function processTranscript(result: ProcessRunResult): string {
  const text = `${result.stdout}${result.stderr}`;
  if (!result.spawnError) return text;
  return text ? `${text}\n${result.spawnError}` : result.spawnError;
}
