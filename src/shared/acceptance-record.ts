import type { AcceptanceReport } from "./acceptance-hub";
import { acceptanceDigest, rollupAcceptance, summarizeAcceptance, verdictReasonFor } from "./acceptance-hub";

/**
 * Host-M P1/P6 — the acceptance *record*.
 *
 * A report is a large, timestamped transcript. A record is the small, stable
 * summary a later run compares against: the phase per check, the digest and the
 * revision. P6 (Regression Sentinel) diffs records; it never re-derives meaning
 * from transcripts, so a comparison stays honest even when logs change shape.
 *
 * This file is pure: the fs writers live in the host modules that need them.
 */

export const ACCEPTANCE_RECORD_SCHEMA_VERSION = 1;

export interface AcceptanceRecordEntry {
  id: string;
  program: string;
  status: AcceptanceReport["overall"];
  /** Non-empty for every non-PASS entry, so a record is self-explaining. */
  reason?: string;
}

export interface AcceptanceRecord {
  schemaVersion: typeof ACCEPTANCE_RECORD_SCHEMA_VERSION;
  kind: "HOST_ACCEPTANCE_RECORD";
  generatedAt: string;
  repoRoot: string;
  branch?: string;
  revision?: string;
  overall: AcceptanceReport["overall"];
  digest: string;
  verdictReason: string;
  summary: AcceptanceReport["summary"];
  checks: AcceptanceRecordEntry[];
}

export function recordFromReport(
  report: AcceptanceReport,
  context: { branch?: string; revision?: string } = {}
): AcceptanceRecord {
  return {
    schemaVersion: ACCEPTANCE_RECORD_SCHEMA_VERSION,
    kind: "HOST_ACCEPTANCE_RECORD",
    generatedAt: report.generatedAt,
    repoRoot: report.repoRoot,
    branch: context.branch,
    revision: context.revision,
    overall: report.overall,
    digest: report.digest,
    verdictReason: report.verdictReason,
    summary: report.summary,
    checks: report.results.map((result) => ({
      id: result.id,
      program: result.program,
      status: result.status,
      reason: result.status === "PASS" ? undefined : result.reason
    }))
  };
}

export interface AcceptanceFilter {
  /** Ignore these check ids entirely when comparing. */
  ignore?: readonly string[];
  /** Treat a degraded/skipped candidate as drift (default: only report it). */
  strict?: boolean;
}

export interface AcceptanceDrift {
  id: string;
  kind: "STATUS_CHANGED" | "MISSING_IN_CANDIDATE" | "NEW_IN_CANDIDATE";
  baseline?: AcceptanceReport["overall"];
  candidate?: AcceptanceReport["overall"];
  detail: string;
}

/**
 * Baseline → candidate acceptance comparison. Deliberately boring: a status
 * change in either direction is drift, and a check that disappeared or appeared
 * is drift too. Nothing here modifies the candidate.
 */
export function compareAcceptanceRecords(
  baseline: AcceptanceRecord,
  candidate: AcceptanceRecord,
  filter: AcceptanceFilter = {}
): AcceptanceDrift[] {
  const ignore = new Set(filter.ignore ?? []);
  const before = new Map(baseline.checks.map((entry) => [entry.id, entry]));
  const after = new Map(candidate.checks.map((entry) => [entry.id, entry]));
  const drifts: AcceptanceDrift[] = [];

  for (const [id, entry] of before) {
    if (ignore.has(id)) continue;
    const now = after.get(id);
    if (!now) {
      drifts.push({ id, kind: "MISSING_IN_CANDIDATE", baseline: entry.status, detail: `baseline was ${entry.status}; candidate did not run it` });
      continue;
    }
    if (now.status !== entry.status) {
      drifts.push({
        id,
        kind: "STATUS_CHANGED",
        baseline: entry.status,
        candidate: now.status,
        detail: `${entry.status} → ${now.status}${now.reason ? ` (${now.reason})` : ""}`
      });
    }
  }
  for (const [id, entry] of after) {
    if (ignore.has(id)) continue;
    if (!before.has(id)) {
      drifts.push({ id, kind: "NEW_IN_CANDIDATE", candidate: entry.status, detail: `candidate added ${entry.status}` });
    }
  }
  return drifts.sort((left, right) => left.id.localeCompare(right.id));
}

/** Recomputes a record's digest from its own entries (used to detect tampering). */
export function recordDigest(record: AcceptanceRecord): string {
  return acceptanceDigest(
    record.checks.map((entry) => ({
      id: entry.id,
      label: entry.id,
      program: entry.program as never,
      device: "command" as never,
      requires: "offline" as never,
      status: entry.status,
      durationMs: 0,
      startedAt: record.generatedAt,
      finishedAt: record.generatedAt
    }))
  );
}

/** Verifies the record's declared digest matches its own contents. */
export function recordIsSelfConsistent(record: AcceptanceRecord): boolean {
  const summary = summarizeAcceptance(
    record.checks.map((entry) => ({
      id: entry.id,
      label: entry.id,
      program: entry.program as never,
      device: "command" as never,
      requires: "offline" as never,
      status: entry.status,
      durationMs: 0,
      startedAt: record.generatedAt,
      finishedAt: record.generatedAt
    }))
  );
  const overall = rollupAcceptance(
    record.checks.map((entry) => ({
      id: entry.id,
      label: entry.id,
      program: entry.program as never,
      device: "command" as never,
      requires: "offline" as never,
      status: entry.status,
      durationMs: 0,
      startedAt: record.generatedAt,
      finishedAt: record.generatedAt
    }))
  );
  return (
    record.digest === recordDigest(record) &&
    overall === record.overall &&
    JSON.stringify(summary) === JSON.stringify(record.summary) &&
    record.verdictReason === verdictReasonFor(summary, overall)
  );
}
