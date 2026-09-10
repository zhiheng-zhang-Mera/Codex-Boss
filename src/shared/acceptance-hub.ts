/**
 * Host-M P1 — System Acceptance Hub (pure contract + rollup logic).
 *
 * One command → full Boss acceptance. The hub is an *outer shell*: it only
 * orchestrates already-existing acceptance entry points (legacy, closure, 10.x,
 * Engine, unit suite) and records what each one actually proved. It never
 * modifies a tested module to make a check go green, and it never upgrades a
 * weaker outcome into a stronger one.
 *
 * Status vocabulary is deliberately closed and honest:
 *
 * - `PASS`               the check ran and its own pass signal was observed
 * - `FAIL`               the check ran and reported failure
 * - `BLOCKED_EXTERNAL`   the check could not run here (no browser/network/CLI/
 *                        GUI session); this is NEVER rendered as PASS
 * - `DEGRADED`           the check ran and produced a usable but incomplete
 *                        result (e.g. partial coverage, tolerated defects)
 * - `SKIPPED_WITH_REASON` deliberately not requested for this run
 *
 * This file is pure: no fs, no child_process, no clock. The process execution
 * lives in `electron/host/acceptance-hub-runner.ts`; the CLI entry is
 * `scripts/host-acceptance.cjs`.
 */

export const ACCEPTANCE_STATUSES = ["PASS", "FAIL", "BLOCKED_EXTERNAL", "DEGRADED", "SKIPPED_WITH_REASON"] as const;
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

/**
 * How a check is executed. `suite` checks are discovered (vitest project),
 * `script` checks spawn a repo script, `command` checks spawn an arbitrary
 * declared command (typecheck/build).
 */
export type AcceptanceDevice = "suite" | "script" | "command";

/**
 * Whether the check needs something this host may not have. `offline` checks
 * must be runnable with no browser, no network and no interactive session.
 */
export type AcceptanceRequirement = "offline" | "browser" | "network" | "electron-gui" | "windows-desktop" | "external-cli";

export interface AcceptanceCheck {
  /** Stable identity — part of the acceptance digest, so never rename in place. */
  id: string;
  label: string;
  device: AcceptanceDevice;
  /** Script path relative to the repo root, or the argv for `command`/`suite`. */
  argv: readonly string[];
  /**
   * The repository-relative file this check needs before it can start — the
   * script itself, or the evidence manifest an audit reads. Declared explicitly
   * so a missing input is reported BLOCKED_EXTERNAL rather than surfacing as a
   * confusing non-zero exit from the check's own runner.
   */
  entryPoint: string;
  /** Declared external prerequisite; used to explain BLOCKED_EXTERNAL. */
  requires: AcceptanceRequirement;
  /**
   * Why this check may be blocked, and what "PASS" means for it. Declared here
   * so evidence is self-describing rather than reconstructed later.
   */
  expectation: string;
  /** Bounded wall-clock budget. A timeout is a FAIL, never a silent skip. */
  timeoutMs: number;
  /** Groups used by `--only` selection and by the report tables. */
  program: "legacy" | "closure" | "tenx" | "engine" | "host" | "build";
  /**
   * Cost/side-effect policy. `false` means the check is expensive, live-only or
   * writes outside its own artifact directory, so it is only run when explicitly
   * requested; when it is not requested the hub reports SKIPPED_WITH_REASON (a
   * deliberate choice) instead of BLOCKED_EXTERNAL (a missing prerequisite).
   */
  enabledByDefault?: boolean;
  /** What the caller must pass to include this row, shown in the evidence. */
  optIn?: string;
}

export interface AcceptanceCheckResult {
  id: string;
  label: string;
  program: AcceptanceCheck["program"];
  device: AcceptanceDevice;
  requires: AcceptanceRequirement;
  status: AcceptanceStatus;
  /** Non-empty whenever status is not PASS — the audit trail for the verdict. */
  reason?: string;
  durationMs: number;
  exitCode?: number;
  /** Truncated tail of the check's own output, kept as raw evidence. */
  stdoutTail?: string;
  stderrTail?: string;
  /** Where the check wrote its own durable evidence, when it declares one. */
  evidencePath?: string;
  startedAt: string;
  finishedAt: string;
}

export interface AcceptanceSummary {
  pass: number;
  fail: number;
  blockedExternal: number;
  degraded: number;
  skipped: number;
  total: number;
}

export interface AcceptanceReport {
  schemaVersion: 1;
  kind: "HOST_ACCEPTANCE_HUB";
  generatedAt: string;
  repoRoot: string;
  /** Checks that were in scope for this invocation. */
  selected: string[];
  results: AcceptanceCheckResult[];
  summary: AcceptanceSummary;
  /** The hub's own verdict. Never stronger than the weakest required check. */
  overall: AcceptanceStatus;
  /**
   * Stable hash over (id → status) pairs only. This is the anchor P6 compares
   * baseline → candidate against: it must not change when timings or logs do.
   */
  digest: string;
  /** Human-readable one-line explanation of `overall`. */
  verdictReason: string;
}

/** Deterministic evidence for an absent/broken prerequisite. */
export function blockedReason(requirement: AcceptanceRequirement, detail: string): string {
  const label: Record<AcceptanceRequirement, string> = {
    offline: "offline",
    browser: "a live browser profile is required",
    network: "outbound network is required",
    "electron-gui": "an interactive Electron GUI session is required",
    "windows-desktop": "an interactive Windows desktop session is required",
    "external-cli": "an external CLI/agent binary is required"
  };
  return requirement === "offline" ? detail : `${label[requirement]}; ${detail}`;
}

export function emptyAcceptanceSummary(): AcceptanceSummary {
  return { pass: 0, fail: 0, blockedExternal: 0, degraded: 0, skipped: 0, total: 0 };
}

export function summarizeAcceptance(results: readonly AcceptanceCheckResult[]): AcceptanceSummary {
  const summary = emptyAcceptanceSummary();
  for (const result of results) {
    summary.total += 1;
    if (result.status === "PASS") summary.pass += 1;
    else if (result.status === "FAIL") summary.fail += 1;
    else if (result.status === "BLOCKED_EXTERNAL") summary.blockedExternal += 1;
    else if (result.status === "DEGRADED") summary.degraded += 1;
    else summary.skipped += 1;
  }
  return summary;
}

/**
 * Rollup, worst-first: anything that actually failed fails the run; an
 * unrunnable external dependency blocks it (and is reported as such rather than
 * as a pass); partial results degrade it; a run with nothing executed is
 * skipped-with-reason rather than a vacuous PASS.
 */
export function rollupAcceptance(results: readonly AcceptanceCheckResult[]): AcceptanceStatus {
  if (results.length === 0) return "SKIPPED_WITH_REASON";
  if (results.some((result) => result.status === "FAIL")) return "FAIL";
  if (results.some((result) => result.status === "BLOCKED_EXTERNAL")) return "BLOCKED_EXTERNAL";
  if (results.some((result) => result.status === "DEGRADED")) return "DEGRADED";
  if (results.every((result) => result.status === "SKIPPED_WITH_REASON")) return "SKIPPED_WITH_REASON";
  return "PASS";
}

export function verdictReasonFor(summary: AcceptanceSummary, overall: AcceptanceStatus): string {
  const parts: string[] = [];
  if (summary.fail) parts.push(`${summary.fail} FAIL`);
  if (summary.blockedExternal) parts.push(`${summary.blockedExternal} BLOCKED_EXTERNAL`);
  if (summary.degraded) parts.push(`${summary.degraded} DEGRADED`);
  if (summary.skipped) parts.push(`${summary.skipped} SKIPPED_WITH_REASON`);
  parts.push(`${summary.pass}/${summary.total} PASS`);
  return `${overall}: ${parts.join(", ")}`;
}

/** Stable 32-bit FNV-1a — small, dependency-free and reproducible across hosts. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Digest over ordered (id, status) pairs. Timings, logs and ordering inside a
 * status bucket are excluded so a baseline/candidate comparison (P6) only fires
 * on a real acceptance change.
 */
export function acceptanceDigest(results: readonly AcceptanceCheckResult[]): string {
  const canonical = [...results]
    .map((result) => `${result.id}=${result.status}`)
    .sort()
    .join("\n");
  return fnv1a(canonical);
}

export function buildAcceptanceReport(input: {
  repoRoot: string;
  results: AcceptanceCheckResult[];
  generatedAt: string;
}): AcceptanceReport {
  const summary = summarizeAcceptance(input.results);
  const overall = rollupAcceptance(input.results);
  return {
    schemaVersion: 1,
    kind: "HOST_ACCEPTANCE_HUB",
    generatedAt: input.generatedAt,
    repoRoot: input.repoRoot,
    selected: input.results.map((result) => result.id),
    results: input.results,
    summary,
    overall,
    digest: acceptanceDigest(input.results),
    verdictReason: verdictReasonFor(summary, overall)
  };
}

/** Selection used by `--only a,b` / `--program engine`: unknown ids are an error. */
export function selectChecks(
  checks: readonly AcceptanceCheck[],
  options: { only?: readonly string[]; program?: readonly AcceptanceCheck["program"][] } = {}
): AcceptanceCheck[] {
  let selected = [...checks];
  if (options.program?.length) {
    const programs = new Set(options.program);
    selected = selected.filter((check) => programs.has(check.program));
  }
  if (options.only?.length) {
    const wanted = new Set(options.only);
    for (const id of wanted) {
      if (!checks.some((check) => check.id === id)) throw new Error(`Unknown acceptance check: ${id}`);
    }
    selected = selected.filter((check) => wanted.has(check.id));
  }
  return selected;
}

/** A check declares it cannot run; the hub records why and moves on. */
export function blockedResult(check: AcceptanceCheck, reason: string, at = new Date().toISOString()): AcceptanceCheckResult {
  return {
    id: check.id,
    label: check.label,
    program: check.program,
    device: check.device,
    requires: check.requires,
    status: "BLOCKED_EXTERNAL",
    reason: blockedReason(check.requires, reason),
    durationMs: 0,
    startedAt: at,
    finishedAt: at
  };
}

export function skippedResult(check: AcceptanceCheck, reason: string, at = new Date().toISOString()): AcceptanceCheckResult {
  return {
    id: check.id,
    label: check.label,
    program: check.program,
    device: check.device,
    requires: check.requires,
    status: "SKIPPED_WITH_REASON",
    reason,
    durationMs: 0,
    startedAt: at,
    finishedAt: at
  };
}

/** Renders the human-readable hub table (used by the CLI and by tests). */
export function renderAcceptanceReport(report: AcceptanceReport): string {
  const width = Math.max(...report.results.map((result) => result.id.length), 6);
  const lines = report.results.map((result) => {
    const detail = result.status === "PASS" ? "" : `  ${result.reason ?? ""}`.trimEnd();
    return `${result.status.padEnd(19)} ${result.id.padEnd(width)} ${Math.round(result.durationMs)}ms${detail}`;
  });
  return [
    `Host-M acceptance hub — ${report.overall} (${report.digest})`,
    `root: ${report.repoRoot}`,
    `verdict: ${report.verdictReason}`,
    "",
    ...lines
  ].join("\n");
}
