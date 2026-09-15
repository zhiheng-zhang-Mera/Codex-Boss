import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";

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

/* ------------------------------------------------------------------ *
 * Supervision: a process the caller watches while it runs
 * ------------------------------------------------------------------ */

/**
 * A process started with `spawn` rather than captured by `execFile`, for a caller
 * that needs the child itself — to record its pid, to stop a whole process tree, or
 * to cancel it from an `AbortSignal`.
 *
 * This is Phase M's supervision half. The capture-shaped runners share one entry
 * point (`runProcess`); the supervising ones each held their own copy of the same
 * ninety lines — spawn with piped stdio and no shell, bounded per-stream capture, a
 * timeout that stops the child, an abort listener, a spawn-error path and a
 * settle-once guard — with small differences that were not decisions: one used
 * `close` and one `exit`, one capped stderr at a megabyte and the other did not cap
 * it at all, and only one honoured `AbortSignal`. The bounds and the stop policy are
 * **stated by the caller** here, so what differs between callers is visible at the
 * call site instead of buried in a copy.
 */
export interface SupervisedProcessOptions {
  /** How long the child may run. Required: the gateway states no default bound. */
  timeoutMs: number;
  /** Max captured stdout, counted in characters. Required, and per stream, because the callers differ. */
  maxStdoutChars: number;
  /** Max captured stderr, counted in characters. Required for the same reason. */
  maxStderrChars: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Cancellation. Aborting stops the child and settles as `cancelled`. */
  signal?: AbortSignal;
  /** The child, once it exists: a caller records the pid or attaches its own probe. */
  onSpawn?(child: ChildProcess): void;
  /**
   * How to stop the child when the bound expires or the caller cancels. Defaults to
   * `child.kill()`; a caller that must reach grandchildren supplies its own policy,
   * because "stop this" means different things to a compiler and to an app under soak.
   */
  stop?(child: ChildProcess): void;
}

export interface SupervisionOutcome {
  /** The exit status, or null when the child never produced one. */
  code: number | null;
  /** The signal that ended the child, when one did. */
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** The bound stopped the child. */
  timedOut: boolean;
  /** The caller's AbortSignal stopped it (or was already aborted). */
  cancelled: boolean;
  /** The child never ran: the binary was missing or the spawn itself failed. */
  spawnError?: string;
  durationMs: number;
}

/**
 * Stops a process and everything it started.
 *
 * `taskkill /T` is used on Windows because `npm run` and `vitest` spawn
 * grandchildren that would otherwise survive the timeout and keep locks on the
 * repository. This lives here rather than in the caller because it is the same
 * question the timeout asks — "stop this process" — and a caller that reaches for
 * the tree itself is a caller that has taken the boundary back.
 */
export function killProcessTree(pid: number | undefined): void {
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

/**
 * Runs a process to completion while handing the caller the child. Never throws: the
 * outcome says what happened, including `spawnError` when nothing ever ran.
 */
export function superviseProcess(file: string, args: readonly string[], options: SupervisedProcessOptions): Promise<SupervisionOutcome> {
  const { timeoutMs, maxStdoutChars, maxStderrChars, cwd, env, signal } = options;
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess | undefined;
    let stdout = "";
    let stderr = "";
    const finish = (outcome: Omit<SupervisionOutcome, "durationMs">): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ...outcome, durationMs: Date.now() - started });
    };
    const stopChild = (): void => {
      if (!child) return;
      try {
        if (options.stop) options.stop(child);
        else child.kill();
      } catch {
        // Already gone: the outcome is what matters, not the signal that stopped it.
      }
    };
    const onAbort = (): void => {
      stopChild();
      finish({ code: null, stdout, stderr, timedOut: false, cancelled: true });
    };

    if (signal?.aborted) {
      // Nothing is started: a cancelled call must not spawn a child at all.
      settled = true;
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, cancelled: true, durationMs: 0 });
      return;
    }

    try {
      child = spawn(file, [...args], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (error) {
      finish({ code: null, stdout: "", stderr: "", timedOut: false, cancelled: false, spawnError: String(error) });
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      stopChild();
      finish({ code: null, stdout, stderr, timedOut: true, cancelled: false });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text.slice(0, Math.max(0, maxStdoutChars - stdout.length));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text.slice(0, Math.max(0, maxStderrChars - stderr.length));
    });
    child.on("error", (error) => {
      finish({ code: null, stdout, stderr, timedOut: false, cancelled: false, spawnError: String(error) });
    });
    child.on("close", (code, signal) => {
      finish({ code: typeof code === "number" ? code : null, signal, stdout, stderr, timedOut: false, cancelled: false });
    });
    options.onSpawn?.(child);
  });
}
