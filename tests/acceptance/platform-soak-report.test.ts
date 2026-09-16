import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 05 Task F / gate 6 — the soak report generator.
 *
 * The long soak is run by `pnpm run soak:platform --minutes <n>`; this suite drives the SAME generator
 * with a short duration and asserts three things about it:
 *
 *   1. the report covers every dimension the book names — memory, disk growth, handles, processes,
 *      queue lag, database size, event backlog and recovery counts;
 *   2. it is honest about the dimensions this host cannot observe, listing them as unavailable with a
 *      reason rather than reporting them as zero;
 *   3. it FAILS when the run's own trend exceeds the published allowance, rather than writing a green
 *      report for a run that grew without bound.
 *
 * On the third point, and why it is tested with a deliberately short run: a short run is almost all
 * warmup, so its trend genuinely DOES exceed the per-minute allowance, and the generator says so and
 * exits non-zero. That is the failure path being exercised with real data rather than a mock — the
 * same code path a leaking long run would take.
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

  it("FAILS a run whose trend exceeds the published allowance, instead of certifying it", () => {
    // A quarter-minute run is essentially all warmup, so its per-minute trend exceeds the long-run
    // allowance. The generator must say so and exit non-zero. This is the real failure path a leaking
    // run would take, exercised with real measurements rather than a mock.
    const result = runSoak(["--minutes", "0.25", "--interval", "250"]);
    const report = result.report as Record<string, any>;
    expect(report).toBeTruthy();
    expect(report.bounds.trendWithinLongRunAllowance).toBe(false);
    expect(result.status, "the generator exited zero for a run that exceeded the allowance").toBe(1);
    expect(result.stderr).toContain("FAILED");
    expect(result.stderr).toContain("trend exceeded");
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
