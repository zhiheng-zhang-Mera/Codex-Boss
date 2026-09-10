import type {
  AcceptanceCheck,
  AcceptanceCheckResult,
  AcceptanceReport
} from "../../src/shared/acceptance-hub";
import { buildAcceptanceReport, skippedResult } from "../../src/shared/acceptance-hub";
import { acceptanceCatalog, defaultChecks, preflightBlock, type HostProbes } from "./acceptance-catalog";

/**
 * Host-M P1 — acceptance orchestration.
 *
 * The runner is deliberately a thin shell over a `ProcessRunner` seam so the
 * whole orchestration (ordering, preflight blocking, failure isolation,
 * rollup, evidence) is unit-testable without spawning real processes.
 *
 * Failure isolation rule: a check that throws, times out, or cannot even be
 * spawned becomes a FAIL for that check only. The hub always finishes and
 * always writes a report; it never aborts the run because one check broke.
 */

export interface ProcessOutcome {
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  spawnError?: string;
}

export interface ProcessRunner {
  /** Runs `name` with `args` in `cwd`. Must never throw for runtime failures. */
  run(name: string, args: readonly string[], options: { cwd: string; timeoutMs: number }): Promise<ProcessOutcome>;
}

export interface AcceptanceRunOptions {
  repoRoot: string;
  probes: HostProbes;
  /** Extended scope additionally enables the expensive/opt-in checks. */
  extended?: boolean;
  /** Only run these check ids (validated against the catalog). */
  only?: readonly string[];
  /** Skip these check ids. */
  exclude?: readonly string[];
  /** An explicit --soak request enables the opt-in long-running rows. */
  includeOptIn?: readonly string[];
  /** Select every catalog row, including expensive and not-yet-built ones. */
  includeAll?: boolean;
  /** A check whose dependency failed can be reported SKIPPED instead of run. */
  onResult?: (result: AcceptanceCheckResult) => void;
  now?: () => string;
}

export interface AcceptanceRunResult {
  report: AcceptanceReport;
  /** Populated when the run itself could not be assembled (still reported). */
  fatal?: string;
}

/** Keeps a bounded, honest tail of a check's own output as raw evidence. */
const OUTPUT_TAIL_CHARS = 4_000;

function tail(text: string, limit = OUTPUT_TAIL_CHARS): string | undefined {
  const trimmed = text.trimEnd();
  if (!trimmed) return undefined;
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(trimmed.length - limit)}`;
}

/**
 * The hub trusts the check's own process contract: exit 0 means the check said
 * it passed. A timeout is never a pass. A spawn failure is never a pass.
 */
export function resultFromOutcome(
  check: AcceptanceCheck,
  outcome: ProcessOutcome,
  startedAt: string,
  finishedAt: string
): AcceptanceCheckResult {
  const base = {
    id: check.id,
    label: check.label,
    program: check.program,
    device: check.device,
    requires: check.requires,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode ?? undefined,
    stdoutTail: tail(outcome.stdout),
    stderrTail: tail(outcome.stderr),
    startedAt,
    finishedAt
  };
  if (outcome.spawnError) {
    return { ...base, status: "FAIL", reason: `could not start the check: ${outcome.spawnError}` };
  }
  if (outcome.timedOut) {
    return { ...base, status: "FAIL", reason: `exceeded its ${Math.round(check.timeoutMs / 1000)}s budget` };
  }
  if (outcome.exitCode === 0) {
    return { ...base, status: "PASS" };
  }
  return {
    ...base,
    status: "FAIL",
    reason: `exit code ${outcome.exitCode ?? "null"}${outcome.stderr.trim() ? `; ${tail(outcome.stderr, 400)}` : ""}`
  };
}

/** Build gates run first because script-driven checks load their emitted output. */
const PROGRAM_ORDER: Record<AcceptanceCheck["program"], number> = {
  build: 0,
  legacy: 1,
  closure: 2,
  tenx: 3,
  engine: 4,
  host: 5
};

export function orderChecks(checks: readonly AcceptanceCheck[]): AcceptanceCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((left, right) => PROGRAM_ORDER[left.check.program] - PROGRAM_ORDER[right.check.program] || left.index - right.index)
    .map((entry) => entry.check);
}

export function selectAcceptanceChecks(options: {
  checks: readonly AcceptanceCheck[];
  extended?: boolean;
  only?: readonly string[];
  exclude?: readonly string[];
  includeOptIn?: readonly string[];
  /** Select every check, including the expensive and not-yet-built ones. */
  includeAll?: boolean;
}): AcceptanceCheck[] {
  const requested = new Set(options.includeOptIn ?? []);
  if (options.includeAll) for (const check of options.checks) requested.add(check.id);
  let selected = defaultChecks(options.checks, options.extended === true || options.includeAll === true || requested.size > 0).filter(
    (check) => check.enabledByDefault !== false || requested.has(check.id)
  );
  if (options.only?.length) {
    const wanted = new Set(options.only);
    for (const id of wanted) {
      if (!options.checks.some((check) => check.id === id)) throw new Error(`Unknown acceptance check: ${id}`);
    }
    selected = selected.filter((check) => wanted.has(check.id));
  }
  if (options.exclude?.length) {
    const unwanted = new Set(options.exclude);
    selected = selected.filter((check) => !unwanted.has(check.id));
  }
  return orderChecks(selected);
}

/**
 * Runs the acceptance hub. Every check is isolated: preflight blocks, timeouts,
 * spawn failures and thrown errors are recorded per check, and the run always
 * produces a report.
 */
export async function runAcceptanceHub(
  runner: ProcessRunner,
  options: AcceptanceRunOptions
): Promise<AcceptanceRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const checks = acceptanceCatalog();
  let selected: AcceptanceCheck[];
  try {
    if (options.only?.length) {
      // An explicit `only` is the authoritative scope: the caller has already
      // resolved which rows are in play, including opt-in rows, and re-deriving
      // the default scope here would silently drop them. Unknown ids are still a
      // hard error.
      const wanted = new Set(options.only);
      for (const id of wanted) {
        if (!checks.some((check) => check.id === id)) throw new Error(`Unknown acceptance check: ${id}`);
      }
      selected = orderChecks(checks.filter((check) => wanted.has(check.id)));
    } else {
      selected = selectAcceptanceChecks({
        checks,
        extended: options.extended,
        exclude: options.exclude,
        includeOptIn: options.includeOptIn,
        includeAll: options.includeAll
      });
    }
  } catch (error) {
    return {
      report: buildAcceptanceReport({ repoRoot: options.repoRoot, results: [], generatedAt: now() }),
      fatal: String(error)
    };
  }

  const results: AcceptanceCheckResult[] = [];
  for (const check of selected) {
    const blocked = preflightBlock(check, options.probes, now());
    if (blocked) {
      results.push(blocked);
      options.onResult?.(blocked);
      continue;
    }
    const startedAt = now();
    let result: AcceptanceCheckResult;
    try {
      const outcome = await runner.run(check.argv[0], check.argv.slice(1), {
        cwd: options.repoRoot,
        timeoutMs: check.timeoutMs
      });
      result = resultFromOutcome(check, outcome, startedAt, now());
    } catch (error) {
      // A thrown runner is a failed check, never a failed hub.
      result = {
        id: check.id,
        label: check.label,
        program: check.program,
        device: check.device,
        requires: check.requires,
        status: "FAIL",
        reason: `runner error: ${String(error)}`,
        durationMs: 0,
        startedAt,
        finishedAt: now()
      };
    }
    results.push(result);
    options.onResult?.(result);
  }

  const report = buildAcceptanceReport({ repoRoot: options.repoRoot, results, generatedAt: now() });
  return { report };
}

/** Explicitly marks opt-in checks that the caller chose not to request. */
export function unrequestedOptIn(checks: readonly AcceptanceCheck[], requested: readonly string[]): AcceptanceCheckResult[] {
  const wanted = new Set(requested);
  return checks
    .filter((check) => check.enabledByDefault === false && !wanted.has(check.id))
    .map((check) => skippedResult(check, `opt-in: ${check.optIn ?? "not requested"}`));
}
