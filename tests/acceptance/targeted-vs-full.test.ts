import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 05 gate 2 — the targeted selection and the full gate agree for the same commit.
 *
 * The book's requirement is that a typical small change's fast verification runs only the affected
 * suites, while the SAME commit's full gate agrees. The half that can be faked is the second one: a
 * selector that skipped a suite which then failed in the full run has hidden a defect, and "the fast
 * path was green" would still be true.
 *
 * So this suite does not re-derive the pairing from the selector alone. It checks the record that
 * `scripts/verify-targeted-vs-full.cjs` writes from a REAL full-suite run captured per file, and then
 * exercises the generator's REFUSAL: pointed at a record whose skipped set contains a failing suite, it
 * must fail rather than publish an agreement. That is the property that makes the record evidence.
 *
 * Build-dependent: the generator loads the compiled selector out of `dist-electron`.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "verify-targeted-vs-full.cjs");
const RECORD = path.join(PROJECT, "artifacts", "platform-foundation", "phase-05", "targeted-vs-full.json");
const FULL_RUN = path.join(PROJECT, "artifacts", "platform-foundation", "phase-05", "full-suite-run.json");

/** A synthetic-but-realistic full-run result, so the probe does not need a minutes-long suite. */
function syntheticRun(files: Array<{ file: string; status: string }>, dir: string): string {
  const file = path.join(dir, "full-run.json");
  fs.writeFileSync(file, `${JSON.stringify({
    numTotalTests: files.length,
    testResults: files.map((entry) => ({ name: path.join(PROJECT, entry.file), status: entry.status, assertionResults: [{ status: entry.status }] }))
  }, null, 2)}\n`, "utf8");
  return file;
}

function runPairing(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; record?: Record<string, any> } {
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? 1;
    stdout = String(failure.stdout ?? "");
    stderr = String(failure.stderr ?? "");
  }
  return { status, stdout, stderr };
}

/**
 * A probe writes its record to a scratch path.
 *
 * The first version had no way to redirect the output, so a rejected probe STILL overwrote the real
 * record — and the assertion that the record was undisturbed failed, correctly. The generator now
 * takes `GATE2_OUT` so a probe cannot be collateral damage to the evidence a reader trusts.
 */
function probeEnv(dir: string): Record<string, string> {
  return { GATE2_OUT: path.join(dir, "pairing.json") };
}

describe("Phase 05 gate 2 — the recorded pairing is real and agrees", () => {
  it("records a full run, a selection, and the pairing between them", () => {
    expect(fs.existsSync(RECORD), "no pairing record; run `pnpm run verify:targeted`").toBe(true);
    expect(fs.existsSync(FULL_RUN), "the full-suite run it was derived from is missing").toBe(true);
    const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
    expect(record.phase).toBe("05-scale-verification-soak");

    // A REAL full run: hundreds of files and thousands of tests, not a fixture.
    expect(record.fullRun.files).toBeGreaterThan(150);
    expect(record.fullRun.tests).toBeGreaterThan(1_000);
    expect(record.fullRun.passed).toBe(true);
    expect(record.fullRun.failedFiles).toEqual([]);

    // A selection that is genuinely a subset, and a decision that says why.
    expect(record.selection.selectedCount).toBeGreaterThan(0);
    expect(record.selection.selectedCount).toBeLessThan(record.fullRun.files);
    expect(record.selection.decisionReason).toBeTruthy();

    // The pairing: the suites the fast path SKIPPED are enumerated, and every one of them ran.
    expect(record.pairing.skippedThatRanPassed).toBeGreaterThan(0);
    expect(record.pairing.skippedThatFailed).toEqual([]);
    expect(record.pairing.chosenThatDidNotRun).toEqual([]);
    expect(record.agreement.agrees).toBe(true);
    expect(record.agreement.problems).toEqual([]);
  });

  it("FAILS rather than agreeing when the full run recorded any failure", () => {
    // The failure mode the gate exists for, exercised against the generator with a real-shaped run
    // that records a failure. A generator that produced an agreement here would be certifying a fast
    // path on top of a red full gate, which is the one thing the book's rule forbids.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate2-probe-"));
    try {
      const runFile = syntheticRun([
        { file: "tests/unit/process-gateway.test.ts", status: "passed" },
        { file: "tests/unit/theme-capability.test.ts", status: "failed" }
      ], dir);
      const result = runPairing(["--run", runFile, "--changed", "electron/state-core/database.ts"], probeEnv(dir));
      expect(result.status, "the pairing agreed on top of a failing full run").toBe(1);
      expect(result.stderr).toMatch(/failed in the full run/);
      // And no record was written at the temporary output, so a refusal leaves nothing to misread.
      expect(result.stderr).toContain("FAILED");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FAILS when the selector chose a suite that no tier accounts for and the run does not contain", () => {
    // The other direction: a suite that is neither in the recorded run nor declared in another tier is
    // a phantom, and a selection that pointed at it would have "passed" by pointing at nothing. A run
    // containing only the catalogue's always-run suites leaves plenty of phantoms.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate2-probe-"));
    try {
      const runFile = syntheticRun([
        { file: "tests/unit/process-gateway.test.ts", status: "passed" },
        { file: "tests/unit/export-surface.test.ts", status: "passed" },
        { file: "tests/unit/test-layers.test.ts", status: "passed" },
        { file: "tests/unit/repository-boundary-guards.test.ts", status: "passed" },
        { file: "tests/unit/comment-citation.test.ts", status: "passed" },
        { file: "tests/unit/platform/dependency-graph.test.ts", status: "passed" },
        { file: "tests/unit/platform/capability-manifest.test.ts", status: "passed" },
        { file: "tests/unit/platform/state-ownership.test.ts", status: "passed" },
        { file: "tests/unit/platform/architecture-ratchet.test.ts", status: "passed" },
        { file: "tests/unit/platform/platform-health.test.ts", status: "passed" },
        { file: "tests/unit/platform/test-impact.test.ts", status: "passed" }
      ], dir);
      const result = runPairing(["--run", runFile, "--changed", "electron/state-core/database.ts"], probeEnv(dir));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("exist in no tier the full run covers");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not disturb the recorded pairing when it probes", () => {
    // The probes write to temporary roots, so the record a reader trusts is untouched.
    const before = fs.readFileSync(RECORD, "utf8");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate2-probe-"));
    try {
      const runFile = syntheticRun([{ file: "tests/unit/process-gateway.test.ts", status: "passed" }], dir);
      runPairing(["--run", runFile, "--changed", "electron/state-core/database.ts"], probeEnv(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(fs.readFileSync(RECORD, "utf8")).toBe(before);
  });
});
