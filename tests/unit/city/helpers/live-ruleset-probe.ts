import { spawnSync } from "node:child_process";

/**
 * A BOUNDED, EVIDENCE-HONEST probe of the live GitHub ruleset.
 *
 * WHY THIS EXISTS
 *   `H7` in `tests/unit/city/architecture-hosted-shadow.test.ts` wants to assert that the repository's required
 *   status checks are still exactly the legacy four and that `architecture` is not among them. The repository-side
 *   half of that (`.github/CODEOWNERS` plus the workflow text) is deterministic and always available. The
 *   platform-side half needs a live read of the ruleset, which needs a credential a hosted runner does not have.
 *
 *   The previous revision spawned `gh api …` with `timeout: 120000` from inside a Vitest case whose own timeout is
 *   **60 seconds**. On a GitHub-hosted runner, where `gh` is unauthenticated, the child blocked long enough for the
 *   CASE to be killed: `Error: Test timed out in 60000ms.` (measured on PR #19, run 35851017393). A subprocess
 *   timeout that exceeds the enclosing test's timeout is not a timeout at all — it is a hang with extra steps.
 *
 * THE TWO STATES, AND WHY NEITHER IS A LIE
 *   `LIVE_MEASURED`     the probe really read the ruleset: no spawn error, exit 0, parseable JSON, and the id it
 *                       returned is the id we asked for. Only then may a test assert platform facts.
 *   `LIVE_NOT_MEASURED` anything else — timeout, missing `gh`, unauthenticated, offline, non-zero exit, malformed
 *                       or unreadable response. This is NOT a failure of the repository contract, and it is NOT
 *                       evidence about the platform either. It is an absence of measurement, reported as one.
 *
 *   A green test in the `LIVE_NOT_MEASURED` state must never be described as proof that the live ruleset was read.
 *   That is why `reason` is a required, human-readable field rather than a boolean: the caller is expected to say
 *   which state it is in, out loud, rather than let a skip read as a pass.
 */

/** Well below the enclosing Vitest case's 60-second budget, and not configurable upward by accident. */
export const LIVE_PROBE_TIMEOUT_MS = 10_000;

const RULESET_ID = 22746755;
const RULESET_API = `repos/zhiheng-zhang-Mera/Codex-Boss/rulesets/${RULESET_ID}`;

export interface LiveRulesetProbe {
  state: "LIVE_MEASURED" | "LIVE_NOT_MEASURED";
  /** Machine-ish reason; always populated when the state is LIVE_NOT_MEASURED. */
  reason: string | null;
  /** The `gh` child's exit status, or null when it never ran to completion. */
  status: number | null;
  /** Wall-clock duration of the attempt, so a reader can see the bound was respected. */
  elapsed_ms: number;
  /** The measured required contexts; empty unless the state is LIVE_MEASURED. */
  required_contexts: string[];
  /** True when `architecture` is among the required contexts; false is the expected value. */
  architecture_required: boolean;
  /** The ruleset id the API actually reported, or null when unreadable. */
  ruleset_id: number | null;
  /** True when no attempt should even be made (an explicit opt-out). */
  skipped: boolean;
}

const NOT_MEASURED = (reason: string, extra: Partial<LiveRulesetProbe> = {}): LiveRulesetProbe => ({
  state: "LIVE_NOT_MEASURED",
  reason,
  status: null,
  elapsed_ms: 0,
  required_contexts: [],
  architecture_required: false,
  ruleset_id: null,
  skipped: false,
  ...extra,
});

/**
 * Read the live ruleset, or report honestly that it could not be read.
 *
 * `runner` is injectable so the failure classes can be exercised without a network: a test passes a function that
 * returns a timeout-shaped result, an unauthenticated-shaped result, and so on, and asserts which class each
 * lands in. That keeps the classification itself under test rather than only its happy path.
 */
export function probeLiveRuleset(
  options: { runner?: typeof spawnSync; disabled?: boolean; timeoutMs?: number } = {}
): LiveRulesetProbe {
  if (options.disabled) return { ...NOT_MEASURED("probe disabled by the caller", { skipped: true }) };

  const timeoutMs = options.timeoutMs ?? LIVE_PROBE_TIMEOUT_MS;
  const runner = options.runner ?? spawnSync;
  const started = Date.now();

  let result: ReturnType<typeof spawnSync>;
  try {
    result = runner("gh", ["api", RULESET_API], {
      encoding: "utf8",
      // BOUNDED, and bounded below the enclosing test's timeout. `SIGKILL` because the failure being fixed is a
      // child that outlives its usefulness; there is nothing to shut down gracefully in a read-only API call.
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    // The spawn itself threw: `gh` is missing, or the platform refused to start it.
    return NOT_MEASURED(`spawn failed: ${error instanceof Error ? error.message : String(error)}`, { elapsed_ms: Date.now() - started });
  }

  const elapsed = Date.now() - started;
  const stderr = String(result.stderr ?? "").trim();
  const stdout = String(result.stdout ?? "");

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code ?? "";
    const timeoutShaped = code === "ETIMEDOUT" || /timed?\s?out/i.test(String(result.error.message ?? ""));
    return NOT_MEASURED(timeoutShaped ? `probe timed out after ${timeoutMs}ms` : `spawn error ${code || "unknown"}: ${result.error.message}`, {
      status: typeof result.status === "number" ? result.status : null,
      elapsed_ms: elapsed,
    });
  }
  // A kill is reported as a null status with a signal rather than an error on some platforms.
  if (result.signal) {
    return NOT_MEASURED(`probe was killed by ${result.signal} after ${elapsed}ms`, { status: null, elapsed_ms: elapsed });
  }
  if (result.status !== 0) {
    // `gh` is present but refused: most often unauthenticated on a hosted runner, or the network is unavailable.
    const hint = /gh auth login|authentication|not logged/i.test(stderr) ? " (gh is not authenticated)" : "";
    return NOT_MEASURED(`gh exited ${String(result.status)}${hint}: ${stderr.slice(0, 140) || "no stderr"}`, { status: result.status, elapsed_ms: elapsed });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return NOT_MEASURED(`gh returned unparseable output: ${error instanceof Error ? error.message : String(error)}`, { status: 0, elapsed_ms: elapsed });
  }
  if (!parsed || typeof parsed !== "object") {
    return NOT_MEASURED("the ruleset response was not an object", { status: 0, elapsed_ms: elapsed });
  }

  const body = parsed as { id?: unknown; rules?: Array<{ type?: string; parameters?: { required_status_checks?: Array<{ context?: string }> } }> };
  // The response must be the ruleset we asked for. A proxy, a redirect or a wrong id would otherwise let this
  // probe "measure" something else entirely and still go green.
  if (body.id !== RULESET_ID) {
    return NOT_MEASURED(`the API returned ruleset id ${JSON.stringify(body.id)}, not ${RULESET_ID}`, { status: 0, elapsed_ms: elapsed, ruleset_id: typeof body.id === "number" ? body.id : null });
  }
  const contexts = (body.rules ?? [])
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((entry) => String(entry.context)));
  return {
    state: "LIVE_MEASURED",
    reason: null,
    status: 0,
    elapsed_ms: elapsed,
    required_contexts: contexts,
    architecture_required: contexts.includes("architecture"),
    ruleset_id: RULESET_ID,
    skipped: false,
  };
}

/** One line a CI log can be grepped for, so the state is never left implicit. */
export function describeLiveProbe(probe: LiveRulesetProbe): string {
  if (probe.state === "LIVE_MEASURED") {
    return `H7_LIVE_RULESET = LIVE_MEASURED ruleset_id=${probe.ruleset_id} required=${probe.required_contexts.join(",")} architecture_required=${probe.architecture_required} elapsed_ms=${probe.elapsed_ms}`;
  }
  return `H7_LIVE_RULESET = NOT_MEASURED reason = ${probe.reason ?? "unspecified"}`;
}
