import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attemptIdentity,
  reportPaths,
  terminalFailureReason,
  writeAttemptReport
} from "../../electron/self-evolution/live-acceptance-reporting";
import { cleanupFixtures, tempDir, write } from "../helpers/root-fixtures";

/**
 * Live-acceptance instrument v2 — attempt-scoped, secret-safe evidence.
 *
 * The defect these tests pin is `STALE_SINGLETON_REPORT_HAZARD`. The acceptance used to write ONE fixed
 * file on the success path only, so an exception before Candidate creation left the PREVIOUS attempt's
 * report on disk. That is how a stale `BLOCKED_EXTERNAL` was read as the result of a newer
 * `RuntimeIsolationError` attempt. Every attempt must now be attributable and `latest.json` must never
 * describe an older attempt.
 */

afterEach(cleanupFixtures);

function instrumentFixture(): string {
  const root = tempDir("boss-instrument-");
  return write(root, "live-promotion-acceptance.js", "// compiled instrument fixture\n");
}

describe("live-acceptance instrument v2 reporting", () => {
  it("names each attempt by runId and rewrites latest.json on every attempt", () => {
    const dataRoot = tempDir("boss-data-");
    const paths = reportPaths(dataRoot, "acceptance-promotion-identity-20260922010101");
    expect(paths.attemptFile.endsWith(path.join("promotion-identity-live-acceptance", "acceptance-promotion-identity-20260922010101.json"))).toBe(true);

    // Attempt 1 — the credential was missing.
    writeAttemptReport(paths, { schemaVersion: 2, state: "BLOCKED_EXTERNAL", runId: "attempt-1" });
    const first = JSON.parse(fs.readFileSync(paths.latestFile, "utf8"));
    expect(first.state).toBe("BLOCKED_EXTERNAL");

    // Attempt 2 — a DIFFERENT runId, failing for a different reason before any Candidate was built.
    const second = reportPaths(dataRoot, "acceptance-promotion-identity-20260922020202");
    writeAttemptReport(second, { schemaVersion: 2, state: "FAILED", runId: "attempt-2", reasons: ["RuntimeIsolationError"] });

    const latest = JSON.parse(fs.readFileSync(paths.latestFile, "utf8"));
    // The current attempt is what `latest.json` describes; attempt 1 is not masquerading as attempt 2.
    expect(latest.state).toBe("FAILED");
    expect(latest.runId).toBe("attempt-2");
    // And attempt 1's own report is still on disk and unmodified.
    expect(JSON.parse(fs.readFileSync(paths.attemptFile, "utf8")).state).toBe("BLOCKED_EXTERNAL");
    expect(JSON.parse(fs.readFileSync(second.attemptFile, "utf8")).state).toBe("FAILED");
  });

  it("records attempt identity: runId, timestamp, instrument digest, base SHA and state", () => {
    const instrument = instrumentFixture();
    const identity = attemptIdentity({
      runId: "acceptance-promotion-identity-20260922030303",
      attemptStartedAt: "2026-09-22T03:03:03.000Z",
      instrumentFile: instrument,
      preflightOnly: true,
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      baseBranch: "main"
    });

    expect(identity.runId).toBe("acceptance-promotion-identity-20260922030303");
    expect(identity.attemptStartedAt).toBe("2026-09-22T03:03:03.000Z");
    expect(identity.instrumentFile).toBe("live-promotion-acceptance.js");
    expect(identity.instrumentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.preflightOnly).toBe(true);
    // Never invented: when the caller cannot supply a commit, it says so rather than guessing.
    expect(identity.commitSha).toBe("unavailable");
  });

  it("persists NO secret when the report carries secret-like material, and does not write at all", () => {
    const dataRoot = tempDir("boss-data-leak-");
    const paths = reportPaths(dataRoot, "acceptance-promotion-identity-leak");

    // A synthetic token shaped like a real one, plus key material.
    const result = writeAttemptReport(paths, {
      schemaVersion: 2,
      state: "FAILED",
      leakedCredential: `ghp_${"A".repeat(36)}`,
      leakedKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"
    });

    expect(result.written).toBe(false);
    expect(result.outcome).toBe("REPORT_REFUSED");
    // Nothing reached disk — not even a redacted form.
    expect(fs.existsSync(paths.attemptFile)).toBe(false);
    expect(fs.existsSync(paths.latestFile)).toBe(false);
  });

  it("redacts a top-level exception message for the terminal output", () => {
    const reason = terminalFailureReason(new Error(`RuntimeIsolationError: candidate root inside stable root; token ghp_${"B".repeat(36)}`));

    expect(reason.startsWith("Error: ")).toBe(true);
    expect(reason).toContain("candidate root inside stable root");
    // The token-shaped value does not survive into the terminal message.
    expect(reason).not.toContain(`ghp_${"B".repeat(36)}`);
  });

  it("reports a write failure without throwing when the evidence directory cannot be created", () => {
    // A path occupied by a FILE cannot become a directory.
    const root = tempDir("boss-data-blocked-");
    const blocked = write(root, "not-a-directory", "x");
    const result = writeAttemptReport(
      { directory: path.join(blocked, "promotion-identity-live-acceptance"), attemptFile: path.join(blocked, "a.json"), latestFile: path.join(blocked, "latest.json") },
      { schemaVersion: 2, state: "FAILED" }
    );

    expect(result.written).toBe(false);
    expect(result.outcome).toBe("WRITE_FAILED");
    // The failure is a value, never a thrown error: a reporting failure must not mask the attempt's outcome.
    expect(typeof result.detail).toBe("string");
  });
});
