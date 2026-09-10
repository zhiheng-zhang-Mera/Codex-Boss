/**
 * Host-M P7 — Boss Doctor (pure contract).
 *
 * The doctor answers one question before Boss starts, or when it misbehaves:
 * *is this machine able to run Boss right now?* It answers with a per-check
 * verdict, and it is built so that asking cannot make things worse:
 *
 * - **Every check is fault-isolated.** A probe that throws, hangs or returns
 *   nonsense becomes a `FAIL` or `DEGRADED` for that check alone. One broken
 *   probe can never stop the others from reporting, and the doctor never throws.
 * - **A missing answer is not a pass.** A check that cannot be evaluated is
 *   `SKIPPED` with the reason, or `DEGRADED` when partial evidence exists. Only a
 *   check that actually observed the healthy condition is `READY`.
 * - **The doctor is advisory.** `overall` is `READY`, `DEGRADED` or `BLOCKED`.
 *   Nothing in Boss consults it to decide whether to start: a broken probe or a
 *   missing report must never be able to prevent startup. That is why the doctor
 *   is a CLI plus a pure verdict function, and why the verdict has no `"STOP"`
 *   value.
 */

export const DOCTOR_AREAS = [
  "runtime",
  "dependency",
  "filesystem",
  "browser",
  "network",
  "account",
  "ipc",
  "fleet",
  "knowledge",
  "learning",
  "compatibility"
] as const;
export type DoctorArea = (typeof DOCTOR_AREAS)[number];

export const DOCTOR_STATUSES = ["READY", "DEGRADED", "FAIL", "SKIPPED"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export interface DoctorCheck {
  id: string;
  area: DoctorArea;
  label: string;
  /** What was actually observed, in numbers or names. */
  observed: string;
  /** What a healthy machine would have shown. */
  expected: string;
  status: DoctorStatus;
  /** Always present for anything other than READY. */
  reason?: string;
  /** Anything the operator can usefully do about it. */
  remedy?: string;
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  kind: "HOST_DOCTOR";
  generatedAt: string;
  repoRoot: string;
  dataRoot: string;
  checks: DoctorCheck[];
  summary: { ready: number; degraded: number; fail: number; skipped: number; total: number };
  /** Advisory only — no caller may treat this as a start/stop gate. */
  overall: "READY" | "DEGRADED" | "BLOCKED";
  verdictReason: string;
  /**
   * Set when the doctor itself could not complete. The Boss core must be able to
   * start anyway, so this is reported rather than raised.
   */
  doctorFailure?: string;
}

export function emptyDoctorSummary(): DoctorReport["summary"] {
  return { ready: 0, degraded: 0, fail: 0, skipped: 0, total: 0 };
}

export function summarizeDoctor(checks: readonly DoctorCheck[]): DoctorReport["summary"] {
  const summary = emptyDoctorSummary();
  for (const check of checks) {
    summary.total += 1;
    if (check.status === "READY") summary.ready += 1;
    else if (check.status === "DEGRADED") summary.degraded += 1;
    else if (check.status === "FAIL") summary.fail += 1;
    else summary.skipped += 1;
  }
  return summary;
}

/**
 * The verdict. BLOCKED requires a failure in a dimension Boss genuinely cannot
 * run without — never a skipped or unavailable probe, because "we could not check"
 * is not the same as "this machine cannot run Boss".
 */
export function doctorVerdict(checks: readonly DoctorCheck[]): { overall: DoctorReport["overall"]; reason: string } {
  const summary = summarizeDoctor(checks);
  const blocking = checks.filter((check) => check.status === "FAIL" && isBlockingArea(check.area));
  if (blocking.length) {
    return {
      overall: "BLOCKED",
      reason: `${blocking.length} blocking failure(s): ${blocking.map((check) => `${check.id} (${check.reason ?? "no reason given"})`).join("; ")}`
    };
  }
  const failing = checks.filter((check) => check.status === "FAIL");
  if (failing.length || summary.degraded) {
    const parts: string[] = [];
    if (failing.length) parts.push(`${failing.length} non-blocking failure(s): ${failing.map((check) => check.id).join(", ")}`);
    if (summary.degraded) parts.push(`${summary.degraded} degraded check(s): ${checks.filter((check) => check.status === "DEGRADED").map((check) => check.id).join(", ")}`);
    return { overall: "DEGRADED", reason: parts.join("; ") };
  }
  const skipped = summary.skipped;
  return {
    overall: "READY",
    reason: skipped ? `every check that could run is READY (${skipped} check(s) skipped for want of evidence)` : "every check is READY"
  };
}

export function isBlockingArea(area: DoctorArea): boolean {
  return area === "runtime" || area === "filesystem" || area === "dependency";
}

export function buildDoctorReport(input: {
  repoRoot: string;
  dataRoot: string;
  checks: DoctorCheck[];
  generatedAt: string;
  doctorFailure?: string;
}): DoctorReport {
  const verdict = doctorVerdict(input.checks);
  return {
    schemaVersion: 1,
    kind: "HOST_DOCTOR",
    generatedAt: input.generatedAt,
    repoRoot: input.repoRoot,
    dataRoot: input.dataRoot,
    checks: input.checks,
    summary: summarizeDoctor(input.checks),
    overall: verdict.overall,
    verdictReason: verdict.reason,
    doctorFailure: input.doctorFailure
  };
}

/**
 * A probe helper that cannot throw. The doctor's isolation guarantee is that a
 * probe failure becomes one check's verdict, so every probe runs through here.
 */
export function runProbe<T>(
  probe: () => T,
  options: { id: string; area: DoctorArea; label: string; expected: string; remedy?: string; observed?: (value: T) => string; classify: (value: T) => { status: DoctorStatus; observed?: string; reason?: string } }
): DoctorCheck {
  const started = Date.now();
  try {
    const value = probe();
    const outcome = options.classify(value);
    return {
      id: options.id,
      area: options.area,
      label: options.label,
      observed: outcome.observed ?? options.observed?.(value) ?? String(value),
      expected: options.expected,
      status: outcome.status,
      reason: outcome.status === "READY" ? undefined : outcome.reason,
      remedy: outcome.status === "READY" ? undefined : options.remedy,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      id: options.id,
      area: options.area,
      label: options.label,
      observed: `probe threw: ${String(error)}`,
      expected: options.expected,
      status: "FAIL",
      reason: `the probe itself failed: ${String(error)}`,
      remedy: options.remedy,
      durationMs: Date.now() - started
    };
  }
}

/** A verdict of "cannot tell here" rather than a failure. */
export function skippedCheck(input: { id: string; area: DoctorArea; label: string; expected: string; reason: string; durationMs?: number }): DoctorCheck {
  return {
    id: input.id,
    area: input.area,
    label: input.label,
    observed: "not evaluated",
    expected: input.expected,
    status: "SKIPPED",
    reason: input.reason,
    durationMs: input.durationMs ?? 0
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.id.length), 6);
  const lines = [
    `Boss Doctor — ${report.overall}`,
    `repo: ${report.repoRoot}`,
    `data: ${report.dataRoot}`,
    `verdict: ${report.verdictReason}`,
    ""
  ];
  for (const check of report.checks) {
    const detail = check.status === "READY" ? "" : `  ${check.reason ?? ""}`;
    lines.push(`${check.status.padEnd(9)} ${check.id.padEnd(width)} ${check.observed}${detail}`);
  }
  const remedies = report.checks.filter((check) => check.remedy && check.status !== "READY");
  if (remedies.length) {
    lines.push("", "remedies:");
    for (const check of remedies) lines.push(`  ${check.id}: ${check.remedy}`);
  }
  if (report.doctorFailure) lines.push("", `the doctor itself reported a failure: ${report.doctorFailure}`);
  return lines.join("\n");
}

export type { DoctorArea as DoctorCheckArea };
