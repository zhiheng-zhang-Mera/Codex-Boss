import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_STATUSES,
  acceptanceDigest,
  blockedResult,
  buildAcceptanceReport,
  renderAcceptanceReport,
  rollupAcceptance,
  selectChecks,
  summarizeAcceptance,
  verdictReasonFor,
  type AcceptanceCheck,
  type AcceptanceCheckResult
} from "../../src/shared/acceptance-hub";
import { acceptanceCatalog, defaultChecks, preflightBlock, type HostProbes } from "../../electron/host/acceptance-catalog";
import { orderChecks, resultFromOutcome, runAcceptanceHub, selectAcceptanceChecks } from "../../electron/host/acceptance-hub-runner";
import { createNodeProcessRunner, resolveCommand } from "../../electron/host/process-runner";

const AT = "2026-09-10T00:00:00.000Z";

function fakeCheck(overrides: Partial<AcceptanceCheck> = {}): AcceptanceCheck {
  return {
    id: "x:one",
    label: "fake",
    device: "command",
    argv: ["node", "-e", "0"],
    entryPoint: "package.json",
    requires: "offline",
    expectation: "does nothing",
    timeoutMs: 1000,
    program: "host",
    ...overrides
  };
}

function fakeResult(overrides: Partial<AcceptanceCheckResult> = {}): AcceptanceCheckResult {
  return {
    id: "x:one",
    label: "fake",
    program: "host",
    device: "command",
    requires: "offline",
    status: "PASS",
    durationMs: 1,
    startedAt: AT,
    finishedAt: AT,
    ...overrides
  };
}

const healthyProbes: HostProbes = {
  electronBinary: true,
  codexCli: true,
  network: true,
  buildOutput: true,
  pathExists: () => true
};

/** Probes where only the declared entry point of `check` exists. */
function probesFor(check: AcceptanceCheck, overrides: Partial<HostProbes> = {}): HostProbes {
  return {
    electronBinary: true,
    codexCli: true,
    network: true,
    buildOutput: true,
    pathExists: (relative) => relative === check.entryPoint,
    ...overrides
  };
}

describe("acceptance hub contract (P1)", () => {
  it("keeps the closed status vocabulary the plan requires", () => {
    expect([...ACCEPTANCE_STATUSES]).toEqual(["PASS", "FAIL", "BLOCKED_EXTERNAL", "DEGRADED", "SKIPPED_WITH_REASON"]);
  });

  it("summarizes every bucket exactly once", () => {
    const results = [
      fakeResult({ id: "a", status: "PASS" }),
      fakeResult({ id: "b", status: "FAIL" }),
      fakeResult({ id: "c", status: "BLOCKED_EXTERNAL" }),
      fakeResult({ id: "d", status: "DEGRADED" }),
      fakeResult({ id: "e", status: "SKIPPED_WITH_REASON" })
    ];
    expect(summarizeAcceptance(results)).toEqual({ pass: 1, fail: 1, blockedExternal: 1, degraded: 1, skipped: 1, total: 5 });
  });

  it("rolls up worst-first and never upgrades a blocked run into a pass", () => {
    expect(rollupAcceptance([fakeResult({ status: "PASS" }), fakeResult({ id: "b", status: "BLOCKED_EXTERNAL" })])).toBe("BLOCKED_EXTERNAL");
    expect(rollupAcceptance([fakeResult({ status: "BLOCKED_EXTERNAL" }), fakeResult({ id: "b", status: "FAIL" })])).toBe("FAIL");
    expect(rollupAcceptance([fakeResult({ status: "PASS" }), fakeResult({ id: "b", status: "DEGRADED" })])).toBe("DEGRADED");
    expect(rollupAcceptance([fakeResult({ status: "PASS" })])).toBe("PASS");
  });

  it("reports an empty run as SKIPPED_WITH_REASON rather than a vacuous PASS", () => {
    expect(rollupAcceptance([])).toBe("SKIPPED_WITH_REASON");
    expect(buildAcceptanceReport({ repoRoot: "C:/repo", results: [], generatedAt: AT }).verdictReason).toContain("SKIPPED_WITH_REASON");
  });

  it("reports an all-skipped run as SKIPPED_WITH_REASON", () => {
    expect(rollupAcceptance([fakeResult({ status: "SKIPPED_WITH_REASON" })])).toBe("SKIPPED_WITH_REASON");
  });

  it("keeps the digest stable against timing/log noise but sensitive to status changes", () => {
    const base = [fakeResult({ id: "a", durationMs: 10, status: "PASS" }), fakeResult({ id: "b", durationMs: 20, status: "PASS" })];
    const noisy = [
      fakeResult({ id: "a", durationMs: 999, status: "PASS", stdoutTail: "different output" }),
      fakeResult({ id: "b", durationMs: 1, status: "PASS" })
    ];
    expect(acceptanceDigest(noisy)).toBe(acceptanceDigest(base));
    expect(acceptanceDigest([fakeResult({ id: "a", status: "FAIL" }), fakeResult({ id: "b", status: "PASS" })])).not.toBe(acceptanceDigest(base));
  });

  it("makes the digest independent of check order", () => {
    const forward = [fakeResult({ id: "a", status: "PASS" }), fakeResult({ id: "b", status: "FAIL" })];
    expect(acceptanceDigest([...forward].reverse())).toBe(acceptanceDigest(forward));
  });

  it("names the reason for every non-pass verdict", () => {
    expect(verdictReasonFor({ pass: 3, fail: 1, blockedExternal: 2, degraded: 0, skipped: 0, total: 6 }, "FAIL")).toBe(
      "FAIL: 1 FAIL, 2 BLOCKED_EXTERNAL, 3/6 PASS"
    );
  });

  it("rejects unknown check ids instead of silently running nothing", () => {
    expect(() => selectChecks([fakeCheck()], { only: ["nope"] })).toThrow(/Unknown acceptance check/);
    expect(selectChecks([fakeCheck({ id: "a" }), fakeCheck({ id: "b", program: "engine" })], { program: ["engine"] }).map((c) => c.id)).toEqual(["b"]);
  });

  it("renders a readable table that exposes every non-pass reason", () => {
    const report = buildAcceptanceReport({
      repoRoot: "C:/repo",
      results: [fakeResult({ id: "a" }), fakeResult({ id: "b", status: "BLOCKED_EXTERNAL", reason: "no codex CLI on PATH" })],
      generatedAt: AT
    });
    const text = renderAcceptanceReport(report);
    expect(text).toContain("BLOCKED_EXTERNAL");
    expect(text).toContain("no codex CLI on PATH");
    expect(text).toContain(report.digest);
  });
});

describe("acceptance catalog (P1)", () => {
  it("covers the four programs the plan names plus the host program", () => {
    const programs = new Set(acceptanceCatalog().map((check) => check.program));
    expect(programs).toEqual(new Set(["build", "legacy", "closure", "tenx", "engine", "host"]));
  });

  it("declares a bounded timeout, an expectation, an entry point and a stable id for every check", () => {
    const ids = acceptanceCatalog().map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of acceptanceCatalog()) {
      expect(check.timeoutMs).toBeGreaterThan(0);
      expect(check.expectation.length).toBeGreaterThan(10);
      expect(check.argv.length).toBeGreaterThan(1);
      expect(check.entryPoint.length).toBeGreaterThan(0);
    }
  });

  it("keeps the default scope bounded and the expensive rows opt-in", () => {
    const catalog = acceptanceCatalog();
    const defaults = defaultChecks(catalog, false).map((check) => check.id);
    expect(defaults).not.toContain("closure:soak-2h");
    expect(defaults).not.toContain("legacy:vision");
    expect(defaults).not.toContain("legacy:seeded-engineering");
    expect(defaults).not.toContain("host:doctor");
    expect(defaults).toContain("gate:typecheck");
    expect(defaults).toContain("gate:test-suite");
    expect(defaultChecks(catalog, true).length).toBeGreaterThan(defaults.length);
  });

  it("blocks a check whose declared external prerequisite is missing, naming it", () => {
    const browserCheck = acceptanceCatalog().find((check) => check.id === "legacy:vision")!;
    const blocked = preflightBlock(browserCheck, probesFor(browserCheck, { network: false }), AT);
    expect(blocked?.status).toBe("BLOCKED_EXTERNAL");
    expect(blocked?.reason).toMatch(/outbound network/);
  });

  it("blocks a check whose declared entry point does not exist, naming the path", () => {
    const audit = acceptanceCatalog().find((check) => check.id === "legacy:v1-audit")!;
    const blocked = preflightBlock(audit, { ...healthyProbes, pathExists: () => false }, AT);
    expect(blocked?.status).toBe("BLOCKED_EXTERNAL");
    expect(blocked?.reason).toContain("artifacts/v1-acceptance-manifest.json");
    // Absent entry points must outrank a missing external prerequisite: the
    // caller needs the reason that actually stops the check.
    const host = acceptanceCatalog().find((check) => check.id === "host:doctor")!;
    const hostBlocked = preflightBlock(host, { ...healthyProbes, pathExists: () => false }, AT);
    expect(hostBlocked?.reason).toContain("scripts/host-doctor.cjs");
  });

  it("blocks script checks when the emitted build is missing", () => {
    const scriptCheck = acceptanceCatalog().find((check) => check.id === "tenx:benchmark")!;
    expect(preflightBlock(scriptCheck, probesFor(scriptCheck, { buildOutput: false }), AT)?.reason).toMatch(/dist-electron/);
    expect(preflightBlock(scriptCheck, probesFor(scriptCheck), AT)).toBeUndefined();
  });

  it("never blocks an offline compiler-driven check on an external prerequisite", () => {
    const gate = acceptanceCatalog().find((check) => check.id === "gate:typecheck")!;
    const noExternal = { electronBinary: false, codexCli: false, network: false, buildOutput: false, pathExists: (relative: string) => relative === gate.entryPoint };
    expect(preflightBlock(gate, noExternal, AT)).toBeUndefined();
  });

  it("blocks every script row — including offline ones — when the emitted build is absent", () => {
    for (const check of acceptanceCatalog().filter((entry) => entry.device === "script")) {
      expect(preflightBlock(check, probesFor(check, { buildOutput: false }), AT)?.status).toBe("BLOCKED_EXTERNAL");
    }
  });

  it("blocks the CLI-lane checks when no codex CLI exists", () => {
    const engineering = acceptanceCatalog().find((check) => check.id === "legacy:engineering")!;
    expect(preflightBlock(engineering, probesFor(engineering, { codexCli: false }), AT)?.reason).toMatch(/codex CLI/);
  });

  it("runs the electron-driven checks under the electron binary, not node", () => {
    for (const id of ["legacy:browser-crash", "legacy:vision"]) {
      const check = acceptanceCatalog().find((entry) => entry.id === id)!;
      expect(check.argv[0]).toContain("electron");
      expect(check.argv[1]).toMatch(/^--|\.cjs$/);
      expect(check.argv).toContain(check.entryPoint);
    }
  });

  it("blocks the electron-driven checks when the electron binary is missing", () => {
    const crash = acceptanceCatalog().find((check) => check.id === "legacy:browser-crash")!;
    const blocked = preflightBlock(crash, probesFor(crash, { electronBinary: false }), AT);
    expect(blocked?.status).toBe("BLOCKED_EXTERNAL");
    expect(blocked?.reason).toMatch(/electron is not installed/);
  });
});

describe("acceptance runner isolation (P1)", () => {
  it("orders build gates before everything that consumes their output", () => {
    const ordered = orderChecks([
      fakeCheck({ id: "h", program: "host" }),
      fakeCheck({ id: "l", program: "legacy" }),
      fakeCheck({ id: "b", program: "build" })
    ]);
    expect(ordered.map((check) => check.id)).toEqual(["b", "l", "h"]);
  });

  it("treats exit 0 as the check's own PASS signal", () => {
    const result = resultFromOutcome(fakeCheck(), { exitCode: 0, timedOut: false, stdout: "ok", stderr: "", durationMs: 5 }, AT, AT);
    expect(result.status).toBe("PASS");
    expect(result.reason).toBeUndefined();
  });

  it("never reports a timeout or a spawn failure as PASS", () => {
    const timedOut = resultFromOutcome(fakeCheck(), { exitCode: null, timedOut: true, stdout: "", stderr: "", durationMs: 1000 }, AT, AT);
    expect(timedOut.status).toBe("FAIL");
    expect(timedOut.reason).toMatch(/budget/);
    const missing = resultFromOutcome(fakeCheck(), { exitCode: null, timedOut: false, stdout: "", stderr: "", durationMs: 1, spawnError: "ENOENT" }, AT, AT);
    expect(missing.status).toBe("FAIL");
    expect(missing.reason).toMatch(/ENOENT/);
  });

  it("keeps a bounded tail of the check's own output as evidence", () => {
    const long = "x".repeat(9000);
    const result = resultFromOutcome(fakeCheck(), { exitCode: 1, timedOut: false, stdout: long, stderr: "boom", durationMs: 3 }, AT, AT);
    expect(result.stdoutTail!.length).toBeLessThan(4100);
    expect(result.stderrTail).toBe("boom");
  });

  it("fails only the broken check and still finishes the run", async () => {
    const seen: string[] = [];
    let calls = 0;
    const { report } = await runAcceptanceHub(
      {
        async run() {
          calls += 1;
          if (calls === 1) throw new Error("runner exploded");
          return { exitCode: 0, timedOut: false, stdout: "ok", stderr: "", durationMs: 1 };
        }
      },
      {
        repoRoot: "C:/repo",
        probes: healthyProbes,
        only: ["gate:typecheck", "gate:test-suite"],
        onResult: (result) => seen.push(`${result.id}:${result.status}`),
        now: () => AT
      }
    );
    expect(report.results).toHaveLength(2);
    expect(report.overall).toBe("FAIL");
    expect(report.results[0].reason).toContain("runner error");
    expect(report.results[1].status).toBe("PASS");
    expect(seen).toEqual(["gate:typecheck:FAIL", "gate:test-suite:PASS"]);
  });

  it("records blocked checks without spawning anything for them", async () => {
    const spawned: string[] = [];
    const { report } = await runAcceptanceHub(
      {
        async run(name) {
          spawned.push(name);
          return { exitCode: 0, timedOut: false, stdout: "", stderr: "", durationMs: 1 };
        }
      },
      {
        repoRoot: "C:/repo",
        probes: { ...healthyProbes, codexCli: false },
        only: ["legacy:engineering", "gate:typecheck"],
        now: () => AT
      }
    );
    const byId = new Map(report.results.map((result) => [result.id, result]));
    expect(byId.get("legacy:engineering")!.status).toBe("BLOCKED_EXTERNAL");
    expect(byId.get("gate:typecheck")!.status).toBe("PASS");
    expect(spawned).toEqual(["npx"]);
  });

  it("reports an unknown --only selection as a fatal hub error rather than a green run", async () => {
    const { report, fatal } = await runAcceptanceHub(
      { async run() { return { exitCode: 0, timedOut: false, stdout: "", stderr: "", durationMs: 1 }; } },
      { repoRoot: "C:/repo", probes: healthyProbes, only: ["does-not-exist"], now: () => AT }
    );
    expect(fatal).toMatch(/Unknown acceptance check/);
    expect(report.overall).toBe("SKIPPED_WITH_REASON");
  });

  it("excludes requested checks and keeps opt-in rows out of the default scope", () => {
    const catalog = acceptanceCatalog();
    const selected = selectAcceptanceChecks({ checks: catalog, exclude: ["gate:build"] }).map((check) => check.id);
    expect(selected).not.toContain("gate:build");
    expect(selected).not.toContain("closure:soak-2h");
    const withOptIn = selectAcceptanceChecks({ checks: catalog, includeOptIn: ["host:soak-30m"] }).map((check) => check.id);
    expect(withOptIn).toContain("host:soak-30m");
  });

  it("--all selects the whole catalog, including the not-yet-built host entry points", () => {
    const catalog = acceptanceCatalog();
    const all = selectAcceptanceChecks({ checks: catalog, includeAll: true }).map((check) => check.id);
    expect(all).toHaveLength(catalog.length);
    expect(all).toContain("host:doctor");
    expect(all).toContain("host:soak-30m");
    expect(all).toContain("legacy:seeded-engineering");
  });

  it("runs every row an explicit selection names, including opt-in rows", async () => {
    // Regression guard: the runner used to re-derive the default scope from the
    // catalog, which silently dropped opt-in rows the caller had already chosen.
    const spawned: string[] = [];
    const { report } = await runAcceptanceHub(
      {
        async run() {
          spawned.push("run");
          return { exitCode: 0, timedOut: false, stdout: "", stderr: "", durationMs: 1 };
        }
      },
      {
        repoRoot: "C:/repo",
        probes: healthyProbes,
        only: ["host:doctor", "gate:typecheck", "legacy:vision"],
        now: () => AT
      }
    );
    expect(report.results.map((result) => result.id).sort()).toEqual(["gate:typecheck", "host:doctor", "legacy:vision"]);
    expect(report.summary.total).toBe(3);
    // All three ran, because every probe reports its prerequisite as present.
    expect(spawned).toHaveLength(3);
  });

  it("records the blocking reason on blockedResult so evidence is self-describing", () => {
    const blocked = blockedResult(fakeCheck({ requires: "browser" }), "no network", AT);
    expect(blocked.reason).toMatch(/live browser profile/);
    expect(blocked.reason).toMatch(/no network/);
  });
});

describe("acceptance process seam (P1)", () => {
  it("resolves the npx shim to its Node entry point so no shell is needed on Windows", () => {
    const resolved = resolveCommand("npx", ["tsc", "--noEmit"], "win32");
    expect(resolved.command).toBe(process.execPath);
    if (/npx-cli\.js$/.test(resolved.args[0])) {
      expect(resolved.args.slice(1)).toEqual(["tsc", "--noEmit"]);
    } else {
      expect(resolved.args[0]).toMatch(/pnpm\.(?:mjs|cjs)$/);
      expect(resolved.args.slice(1)).toEqual(["exec", "tsc", "--noEmit"]);
    }
  });

  it("keeps plain commands shell-free on every platform", () => {
    expect(resolveCommand("node", ["-e", "0"], "win32")).toEqual({ command: "node", args: ["-e", "0"] });
    expect(resolveCommand("node", ["-e", "0"], "linux")).toEqual({ command: "node", args: ["-e", "0"] });
    // Only real Windows shell shims get the .cmd suffix; real executables must
    // not, or spawn fails with EINVAL.
    expect(resolveCommand("pnpm", ["install"], "win32").command).toBe("pnpm.cmd");
    expect(resolveCommand("mytool", ["--x"], "win32").command).toBe("mytool");
    expect(resolveCommand("mytool", ["--x"], "linux").command).toBe("mytool");
  });

  it("actually runs a real command through the seam and reports its exit code", async () => {
    // Regression guard: the first hub run produced `spawn EINVAL` because a
    // .cmd shim was spawned without a shell. That must stay fixed.
    const runner = createNodeProcessRunner();
    const ok = await runner.run("node", ["-e", "process.stdout.write('seam-ok')"], { cwd: process.cwd(), timeoutMs: 20_000 });
    expect(ok.spawnError).toBeUndefined();
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("seam-ok");

    const bad = await runner.run("node", ["-e", "process.exit(3)"], { cwd: process.cwd(), timeoutMs: 20_000 });
    expect(bad.exitCode).toBe(3);
  }, 40_000);

  it("reports a missing working directory instead of throwing", async () => {
    const runner = createNodeProcessRunner();
    const outcome = await runner.run("node", ["-e", "0"], { cwd: "Z:/definitely/not/here", timeoutMs: 5_000 });
    expect(outcome.spawnError).toMatch(/working directory does not exist/);
  });

  it("enforces the timeout and reports it as timedOut rather than success", async () => {
    const runner = createNodeProcessRunner();
    const outcome = await runner.run("node", ["-e", "setTimeout(() => {}, 60000)"], { cwd: process.cwd(), timeoutMs: 1_500 });
    expect(outcome.timedOut).toBe(true);
  }, 30_000);
});
