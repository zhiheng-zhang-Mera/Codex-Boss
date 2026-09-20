import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { InvariantOutcome } from "../../src/shared/soak-harness";

/**
 * Phase 05 Task F / gate 6 — the soak report generator.
 *
 * The long soak is run by `pnpm run soak:platform --minutes <n>`; this suite drives the SAME generator
 * with a short duration and asserts:
 *
 *   1. the report covers every dimension the book names — memory, disk growth, handles, processes,
 *      queue lag, database size, event backlog and recovery counts;
 *   2. it is honest about the dimensions this host cannot observe, listing them as unavailable with a
 *      reason rather than reporting them as zero;
 *   3. the REFUSAL BRANCH works, and the real measurement path reaches it honestly. These are two
 *      separate pieces of evidence and neither replaces the other (see the two cases below);
 *   4. it refuses a malformed duration, and a custom `--out` never touches the long-run report.
 *
 * PF-DEBT-017, and what changed here. The refusal branch used to be tested by running the real generator
 * for a quarter-minute and REQUIRING the measured trend to exceed the long-run allowance, on the premise
 * that a short run is all warmup. That premise is a statement about the HOST, not about the policy: on a
 * quiet or fast enough runner the same code measures a trend inside the allowance, the generator correctly
 * accepts it, and the test failed anyway — three times in CI, twice on one SHA that was green on another
 * runner. The generator was never wrong; the test's premise was. So the branch is now exercised
 * deterministically against an explicitly over-limit measurement fed to the SAME production decision the
 * generator calls, and the real run's evidence is that its own measurements reach that decision.
 *
 * Build-dependent: the generator loads the compiled soak out of `dist-electron`, so it fails rather
 * than skipping when the build is missing.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "platform-soak.cjs");
const REPORT = path.join(PROJECT, "artifacts", "platform-foundation", "phase-05", "soak-report.json");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  report?: Record<string, any>;
}

function runSoak(args: string[]): Run {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "soak-report-")), "report.json");
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, ...args, "--out", out], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? 1;
    stdout = String(failure.stdout ?? "");
    stderr = String(failure.stderr ?? "");
  }
  return {
    status,
    stdout,
    stderr,
    ...(fs.existsSync(out) ? { report: JSON.parse(fs.readFileSync(out, "utf8")) } : {})
  };
}

describe("Phase 05 Task F / gate 6 — the soak report covers every dimension the book names", () => {
  it("writes a report with memory, storage, queue, handle and recovery evidence", () => {
    const result = runSoak(["--minutes", "0.25", "--interval", "250"]);
    const report = result.report as Record<string, any>;
    expect(report, `the generator wrote no report:\n${result.stdout}\n${result.stderr}`).toBeTruthy();
    expect(report.phase).toBe("05-scale-verification-soak");

    // A report is written even when the run fails a bound, because a soak that only produced a file on
    // success would lose the evidence of the failure that matters.
    expect(report.samples).toBeGreaterThan(3);
    expect(report.totals.cycles).toBeGreaterThan(1);
    expect(report.totals.stateWrites).toBeGreaterThan(0);
    expect(report.totals.eventsAppended).toBeGreaterThan(0);

    // Memory and CPU.
    expect(typeof report.trends.rssMiBPerMinute).toBe("number");
    expect(typeof report.trends.heapMiBPerMinute).toBe("number");
    // Disk growth and event backlog.
    expect(report.storage.databaseBytes).toBeGreaterThan(0);
    expect(report.storage.journalEvents).toBe(report.totals.eventsAppended);
    expect(typeof report.storage.eventBacklog).toBe("number");
    // Recovery counts, including the deliberate mid-transaction failure recovered unattended.
    expect(report.totals.recoveredTransactions).toBe(report.totals.cycles);
    expect(report.totals.gcMisdeleted).toBe(0);
    // The published allowance, so a reader can check the verdict rather than trust it.
    expect(report.bounds.longRunAllowancePerMinute.rssMiB).toBeGreaterThan(0);
    expect(report.bounds.longRunAllowancePerMinute.heapMiB).toBeGreaterThan(0);
    expect(report.bounds.scaling).toContain("30m reference tier");
  }, 240_000);

  it("reports the dimensions this host cannot observe as unavailable, never as zero", () => {
    const result = runSoak(["--minutes", "0.25", "--interval", "250"]);
    const report = result.report as Record<string, any>;
    expect(report).toBeTruthy();
    const dimensions = (report.unavailable as Array<{ dimension: string; reason: string }>).map((entry) => entry.dimension).sort();
    // The child-process pool is not this soak's job (the host soak harness covers it), and a headless
    // run has no renderer. Both are declared rather than reported as measured zeros.
    expect(dimensions).toEqual(["orphanProcesses", "rendererHealthy"]);
    for (const entry of report.unavailable as Array<{ dimension: string; reason: string }>) {
      expect(entry.reason.length, `${entry.dimension} has no reason`).toBeGreaterThan(20);
    }
  }, 240_000);

  /**
   * A. DETERMINISTIC REFUSAL-PATH EVIDENCE.
   *
   * This is not a mock of the generator. It is the question the old case was trying to ask — "given a
   * measured trend X, does the real policy reject X?" — asked without requiring a real host to happen to
   * produce such an X. Both the generator and this case call `evaluatePlatformSoakAcceptance`, so the
   * threshold being tested is the threshold being enforced.
   *
   * The boundary cases pin the OPERATOR: the comparison is strict, so a trend exactly at the allowance is
   * EXCEEDED. Changing `<` to `<=` changes what the platform accepts, and that must not be possible to do
   * quietly.
   */
  it("refuses a trend above the published allowance, through the production decision the generator uses", async () => {
    const { evaluatePlatformSoakAcceptance, longRunAllowancePerMinute } = await import("../../src/shared/soak-harness");
    const allowance = longRunAllowancePerMinute();
    const decide = (rssMiBPerMinute: number, heapMiBPerMinute: number) =>
      evaluatePlatformSoakAcceptance({ invariants: [], rssMiBPerMinute, heapMiBPerMinute });

    // Comfortably inside the allowance: accepted, and the trend is reported as within it.
    expect(decide(allowance.rssMiB / 2, allowance.heapMiB / 2)).toEqual({
      failedInvariantIds: [],
      trendWithinLongRunAllowance: true,
      accepted: true
    });

    // Over on either axis, or on both: refused.
    const overLimit: Array<[number, number, string]> = [
      [allowance.rssMiB * 2, allowance.heapMiB / 2, "rss above the allowance"],
      [allowance.rssMiB / 2, allowance.heapMiB * 2, "heap above the allowance"],
      [allowance.rssMiB * 2, allowance.heapMiB * 2, "both above the allowance"]
    ];
    for (const [rss, heap, why] of overLimit) {
      const verdict = decide(rss, heap);
      expect(verdict.trendWithinLongRunAllowance, why).toBe(false);
      expect(verdict.accepted, why).toBe(false);
    }

    // EXACTLY at the allowance is EXCEEDED, not accepted: the policy is strict, and this is the assertion
    // that notices a `<` becoming a `<=`.
    expect(decide(allowance.rssMiB, allowance.heapMiB / 2).trendWithinLongRunAllowance, "rss exactly at the allowance").toBe(false);
    expect(decide(allowance.rssMiB / 2, allowance.heapMiB).trendWithinLongRunAllowance, "heap exactly at the allowance").toBe(false);
    expect(decide(allowance.rssMiB, allowance.heapMiB).accepted, "both exactly at the allowance").toBe(false);

    // The other half of `accepted`: a FAILED invariant refuses the run even when the trend is fine…
    const failing: InvariantOutcome[] = [{ id: "heap-bounded", label: "heap bounded", status: "FAIL", observed: "1 MiB/min", bound: "0.5 MiB/min" }];
    const withFailure = evaluatePlatformSoakAcceptance({ invariants: failing, rssMiBPerMinute: 0, heapMiBPerMinute: 0 });
    expect(withFailure.trendWithinLongRunAllowance).toBe(true);
    expect(withFailure.failedInvariantIds).toEqual(["heap-bounded"]);
    expect(withFailure.accepted).toBe(false);

    // …and UNAVAILABLE is not a failure: a dimension this host cannot measure does not refuse a run.
    const unavailable: InvariantOutcome[] = [{ id: "no-orphan-processes", label: "no orphan processes", status: "UNAVAILABLE", observed: "not measured here", bound: "0" }];
    const withUnavailable = evaluatePlatformSoakAcceptance({ invariants: unavailable, rssMiBPerMinute: 0, heapMiBPerMinute: 0 });
    expect(withUnavailable.failedInvariantIds).toEqual([]);
    expect(withUnavailable.accepted).toBe(true);
  });

  /**
   * B. REAL MEASUREMENT-PATH EVIDENCE.
   *
   * The real generator still runs here, and this case still proves the instrumentation reaches the policy —
   * that is the half a unit test of a pure function cannot prove. What it no longer does is DEMAND a
   * particular host measurement. A quarter-minute run is mostly warmup, so the trend usually does exceed the
   * allowance, but on a quiet host it may not, and that is a legitimate pass rather than a failure of the
   * platform (PF-DEBT-017).
   *
   * Whatever this host measures, two things are asserted: the report's verdict IS the production decision
   * applied to the report's own numbers — so the wiring is checked, not assumed — and the exit code follows
   * that decision in both directions. A genuinely failing invariant still fails, on this path, for real.
   */
  it("reaches the allowance verdict through the production decision, whichever way this host measured", async () => {
    const { evaluatePlatformSoakAcceptance, longRunAllowancePerMinute } = await import("../../src/shared/soak-harness");
    const result = runSoak(["--minutes", "0.25", "--interval", "250"]);
    const report = result.report as Record<string, any>;
    expect(report, `the generator wrote no report:\n${result.stdout}\n${result.stderr}`).toBeTruthy();

    // Real measurements, so the decision below is made on this host's data rather than on a constant.
    expect(report.samples).toBeGreaterThan(3);
    expect(Number.isFinite(report.trends.rssMiBPerMinute)).toBe(true);
    expect(Number.isFinite(report.trends.heapMiBPerMinute)).toBe(true);
    expect(report.bounds.longRunAllowancePerMinute.rssMiB).toBeGreaterThan(0);
    expect(report.bounds.longRunAllowancePerMinute.heapMiB).toBeGreaterThan(0);

    // The allowance the report PUBLISHES is the allowance the decision ENFORCED — one derivation, not two.
    // This is the assertion that would notice the generator growing its own copy of the policy back.
    expect(report.bounds.longRunAllowancePerMinute).toEqual(longRunAllowancePerMinute());

    const decision = evaluatePlatformSoakAcceptance({
      invariants: report.invariants as InvariantOutcome[],
      rssMiBPerMinute: report.trends.rssMiBPerMinute,
      heapMiBPerMinute: report.trends.heapMiBPerMinute
    });

    // The report must carry the PRODUCTION decision applied to its OWN measurements. If the generator ever
    // stops consulting the shared decision, this is where it goes red.
    expect(report.bounds.trendWithinLongRunAllowance).toBe(decision.trendWithinLongRunAllowance);
    expect(report.acceptance.trendWithinLongRunAllowance).toBe(decision.trendWithinLongRunAllowance);
    expect(report.acceptance.failedInvariants).toEqual(decision.failedInvariantIds);
    expect(report.acceptance.accepted).toBe(decision.accepted);

    // The exit code follows the decision, in BOTH directions. A trend inside the allowance is never a reason
    // to fail; a refused run always fails and says which way it was refused.
    expect(result.status, "the generator's exit code must follow its own acceptance decision").toBe(decision.accepted ? 0 : 1);
    if (!decision.accepted) {
      expect(result.stderr).toContain("FAILED");
      if (decision.failedInvariantIds.length === 0) expect(result.stderr).toContain("trend exceeded");
    }

    // Recorded so the run's real measurement is auditable rather than only its verdict: this is the data the
    // decision above was made from, which is what makes "either outcome is a pass" checkable.
    console.log(`[soak-report] rssMiBPerMinute=${report.trends.rssMiBPerMinute} heapMiBPerMinute=${report.trends.heapMiBPerMinute} trendWithinLongRunAllowance=${decision.trendWithinLongRunAllowance} generatorStatus=${result.status} accepted=${decision.accepted} failedInvariants=${JSON.stringify(decision.failedInvariantIds)}`);
  }, 240_000);

  it("refuses a malformed duration rather than defaulting to something long", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [SCRIPT, "--minutes", "not-a-number"], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status ?? 1;
      stderr = String(failure.stderr ?? "");
    }
    expect(status).toBe(2);
    expect(stderr).toContain("positive number");
  });

  it("leaves the long-run report path alone when asked to write elsewhere", () => {
    // The suite must never overwrite the report a real soak produced, or gate 6 would end up reading
    // this suite's own short run.
    const before = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : undefined;
    runSoak(["--minutes", "0.2", "--interval", "250"]);
    const after = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : undefined;
    expect(after).toBe(before);
  }, 240_000);
});
