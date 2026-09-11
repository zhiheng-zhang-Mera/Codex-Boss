/**
 * REPAIR_BATCH_5: one stable execution-error classification boundary, shared by
 * initial dispatch and by Resume, so `FAILED` is a reachable, truthful outcome
 * rather than dead code in the union.
 *
 * Rules, in order:
 *   1. an error that declares `retryable` wins (typed adapter/runtime contract);
 *   2. a known permanent code is terminal even without the flag;
 *   3. otherwise a message that reads as permanent (invalid, forbidden, denied,
 *      not found, unsupported, misconfigured) is terminal;
 *   4. anything else — provider/runtime/page races, timeouts, unknown failures —
 *      stays transient and retryable.
 */

/** Error codes that can never succeed on retry. */
export const TERMINAL_ERROR_CODES: readonly string[] = [
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "INVALID_ARGUMENT",
  "UNSUPPORTED",
  "NOT_FOUND",
  "ENOENT",
  "MISSING_PROVIDER",
  "MISSING_WORKSPACE",
  "CONFIG_INVALID",
  "GUARDIAN_DENIED"
];

/** Message shapes that indicate a permanent condition rather than a race. */
const TERMINAL_MESSAGE = /(?:invalid|malformed|unsupported|not supported|permission denied|forbidden|unauthorized|auth required|not found|no such file|missing (?:provider|workspace|credential)|misconfigur|configured incorrectly|does not exist)/i;

export interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
}

export type ExecutionErrorKind = "TERMINAL" | "TRANSIENT";

export interface ExecutionErrorVerdict {
  kind: ExecutionErrorKind;
  /** Stable machine-readable reason, preserved on the durable record. */
  code: string;
  /** Human-readable message, preserved verbatim. */
  message: string;
}

/** Normalizes anything thrown into the fields this boundary reasons about. */
export function errorLike(error: unknown): ErrorLike {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown; retryable?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
      ...(typeof candidate.retryable === "boolean" ? { retryable: candidate.retryable } : {})
    };
  }
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.message === "string" ? { message: record.message } : { message: String(error) }),
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {})
    };
  }
  return { message: String(error) };
}

/** Classifies one thrown value. Pure and deterministic. */
export function classifyExecutionError(error: unknown): ExecutionErrorVerdict {
  const like = errorLike(error);
  const message = (like.message ?? "").trim() || "unknown execution failure";
  const code = like.code ?? like.name ?? "EXECUTION_ERROR";

  if (like.retryable === false) return { kind: "TERMINAL", code, message };
  if (like.code && TERMINAL_ERROR_CODES.includes(like.code.toUpperCase())) {
    return { kind: "TERMINAL", code, message };
  }
  if (TERMINAL_MESSAGE.test(message)) return { kind: "TERMINAL", code, message };
  return { kind: "TRANSIENT", code, message };
}

/** Convenience predicate for callers that only need the boolean. */
export function isTerminalExecutionError(error: unknown): boolean {
  return classifyExecutionError(error).kind === "TERMINAL";
}

/**
 * A typed terminal failure a caller can throw deliberately, e.g. a workspace
 * that cannot exist or a provider configuration that is permanently wrong.
 */
export class TerminalExecutionError extends Error {
  readonly code: string;
  readonly retryable = false;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TerminalExecutionError";
    this.code = code;
  }
}
