import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanSecrets, redactSecrets } from "../../src/shared/secret-scan";

/**
 * Attempt-scoped evidence reporting for the live acceptance.
 *
 * ## Why this is its own module
 *
 * The acceptance runs as an Electron main-process entrypoint, which cannot be imported by a unit test
 * without launching Electron. Pulling the reporting out makes the two properties that actually matter
 * testable without GitHub access or an Electron process: **every attempt is attributable**, and **no
 * report can carry a secret**.
 *
 * ## The defect this corrects — STALE_SINGLETON_REPORT_HAZARD
 *
 * The acceptance used to write ONE fixed file, `promotion-identity-live-acceptance.json`, and only on the
 * success/preflight-success path. When an exception was thrown before that point — as the nested-root
 * `RuntimeIsolationError` was — nothing was written and the PREVIOUS run's report stayed on disk. A stale
 * `BLOCKED_EXTERNAL` was then read as the result of a newer `RuntimeIsolationError` attempt.
 *
 * Now every attempt writes `<runId>.json`, and `latest.json` is rewritten for every attempt including one
 * that throws immediately. A report is never the only record of an attempt.
 */

interface AttemptIdentity {
  runId: string;
  attemptStartedAt: string;
  /** Compiled instrument file name and digest: which code produced this attempt. */
  instrumentFile: string;
  instrumentSha256: string;
  preflightOnly: boolean;
  /** Instrument commit when the caller can supply one; never invented. */
  commitSha: string;
  repository: string;
  baseBranch: string;
}

interface ReportPaths {
  directory: string;
  attemptFile: string;
  latestFile: string;
}

/** Resolves the attempt's evidence paths under a data root. Pure. */
export function reportPaths(dataRoot: string, runId: string): ReportPaths {
  const directory = path.join(dataRoot, ".boss", "promotion-identity-live-acceptance");
  return {
    directory,
    attemptFile: path.join(directory, `${runId}.json`),
    latestFile: path.join(directory, "latest.json")
  };
}

/** SHA-256 of a file, or `unavailable` when it cannot be read. Never throws. */
export function fileSha256(file: string): string {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "unavailable";
  }
}

/**
 * Builds the identity block stamped into every report. `generatedAt` is passed in so the value is
 * deterministic under test.
 */
export function attemptIdentity(input: {
  runId: string;
  attemptStartedAt: string;
  instrumentFile: string;
  preflightOnly: boolean;
  repository: string;
  baseBranch: string;
  commitSha?: string;
}): AttemptIdentity {
  return {
    runId: input.runId,
    attemptStartedAt: input.attemptStartedAt,
    instrumentFile: path.basename(input.instrumentFile),
    instrumentSha256: fileSha256(input.instrumentFile),
    preflightOnly: input.preflightOnly,
    commitSha: input.commitSha ?? "unavailable",
    repository: input.repository,
    baseBranch: input.baseBranch
  };
}

interface WriteResult {
  written: boolean;
  /** `REPORT_REFUSED` when the report failed its own leakage gate; `WRITE_FAILED` when the filesystem refused. */
  outcome: "WRITTEN" | "REPORT_REFUSED" | "WRITE_FAILED";
  detail?: string;
}

/**
 * Writes one attempt's evidence atomically and refreshes `latest.json`.
 *
 * Secret-safe by construction: the serialized report is scanned before anything touches disk, and a report
 * that fails the scan is **refused** rather than written with the secret redacted. There is deliberately no
 * fallback that dumps the raw report — a report that fails its own leakage gate must not reach disk at all.
 *
 * Atomic per attempt: a sibling temp file is written and renamed over the target, so a partially written
 * report can never be read as a complete one.
 */
export function writeAttemptReport(
  paths: ReportPaths,
  report: Record<string, unknown>,
  options: { pid?: number } = {}
): WriteResult {
  const serialized = JSON.stringify(report, null, 2);
  if (scanSecrets(serialized).length) {
    return { written: false, outcome: "REPORT_REFUSED", detail: "the report failed its own credential-leakage gate" };
  }
  const pid = options.pid ?? process.pid;
  try {
    fs.mkdirSync(paths.directory, { recursive: true });
    for (const target of [paths.attemptFile, paths.latestFile]) {
      const temporary = `${target}.tmp-${pid}`;
      fs.writeFileSync(temporary, `${serialized}\n`, "utf8");
      fs.renameSync(temporary, target);
    }
    return { written: true, outcome: "WRITTEN" };
  } catch (error) {
    return { written: false, outcome: "WRITE_FAILED", detail: redactSecrets(String((error as Error).message)) };
  }
}

/**
 * The redacted, secret-scanned reason string for a top-level exception. Used for the terminal message so a
 * thrown error can never print a path, a token, or key material.
 */
export function terminalFailureReason(error: unknown): string {
  const kind = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `${kind}: ${redactSecrets(message)}`;
}
