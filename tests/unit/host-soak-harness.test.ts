import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SOAK_BOUNDS,
  SOAK_TIERS,
  SOAK_TIER_SPECS,
  evaluateSoakInvariants,
  renderSoakReport,
  soakPasses,
  soakTierSpec,
  soakVerdict,
  summarizeSoak,
  type InvariantOutcome,
  type SoakSample
} from "../../src/shared/soak-harness";
import { runSoak } from "../../electron/host/soak-harness";

const AT = "2026-09-10T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-soak-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function sample(overrides: Partial<SoakSample> = {}): SoakSample {
  return {
    elapsedMs: 0,
    at: AT,
    rssMiB: 60,
    heapUsedMiB: 5,
    externalMiB: 1,
    handles: 10,
    requests: 0,
    cpuMs: 100,
    completed: 0,
    failed: 0,
    retries: 0,
    queueDepth: 0,
    openCircuits: [],
    providerFailures: [],
    staleSessions: 0,
    orphanProcesses: 2,
    pid: 1234,
    ...overrides
  };
}

/** A run that satisfies every invariant, used as the control. */
function healthySamples(count = 6, overrides: Partial<SoakSample> = {}): SoakSample[] {
  return Array.from({ length: count }, (_, index) =>
    sample({ elapsedMs: index * 1_000, completed: index * 10, rssMiB: 60 + index * 0.1, heapUsedMiB: 5 + index * 0.05, ...overrides })
  ).map((entry, index, all) => (index === all.length - 1 ? { ...entry, orphansAfterCleanup: 0 } : entry));
}

function invariantInput(overrides: Partial<Parameters<typeof evaluateSoakInvariants>[0]> = {}) {
  const samples = overrides.samples ?? healthySamples();
  return {
    tier: "smoke" as const,
    elapsedSeconds: 30,
    samples,
    completed: 50,
    failed: 0,
    retries: 0,
    circuitOpenCounts: {},
    pids: samples.map((entry) => entry.pid),
    ...overrides
  };
}

function outcome(outcomes: readonly InvariantOutcome[], id: string): InvariantOutcome {
  const found = outcomes.find((entry) => entry.id === id);
  if (!found) throw new Error(`no invariant ${id}`);
  return found;
}

describe("soak harness contract (P3)", () => {
  it("declares the four tiers the plan names plus a smoke self-check", () => {
    expect([...SOAK_TIERS]).toEqual(["smoke", "30m", "2h", "8h", "overnight"]);
    expect(SOAK_TIER_SPECS["30m"].durationSeconds).toBe(1_800);
    expect(SOAK_TIER_SPECS["2h"].durationSeconds).toBe(7_200);
    expect(SOAK_TIER_SPECS["8h"].durationSeconds).toBe(28_800);
    expect(SOAK_TIER_SPECS.overnight.durationSeconds).toBe(43_200);
  });

  it("rejects an unknown tier instead of silently defaulting", () => {
    expect(() => soakTierSpec("3h")).toThrow(/Unknown soak tier/);
    expect(soakTierSpec("30m").auditSeconds).toBe(1_800);
  });

  it("passes a healthy run", () => {
    const outcomes = evaluateSoakInvariants(invariantInput());
    expect(soakPasses(outcomes)).toBe(true);
    expect(outcomes.every((entry) => entry.status === "PASS")).toBe(true);
  });

  it("keeps the live child pool out of the orphan verdict", () => {
    // A bounded pool of live workers is normal; only what survives cleanup leaks.
    const outcomes = evaluateSoakInvariants(invariantInput({ samples: healthySamples(6, { orphanProcesses: 2 }) }));
    expect(outcome(outcomes, "no-orphan-processes").status).toBe("PASS");
  });

  it("fails when a child survived cleanup", () => {
    const samples = healthySamples();
    samples[samples.length - 1] = { ...samples[samples.length - 1], orphansAfterCleanup: 3 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "no-orphan-processes").status).toBe("FAIL");
  });

  it("reports the orphan invariant UNAVAILABLE when cleanup was never observed", () => {
    const samples = healthySamples().map(({ orphansAfterCleanup: _drop, ...rest }) => rest);
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "no-orphan-processes").status).toBe("UNAVAILABLE");
  });

  it("fails when the tier's duration was not reached", () => {
    expect(outcome(evaluateSoakInvariants(invariantInput({ elapsedSeconds: 5 })), "duration-reached").status).toBe("FAIL");
  });

  it("fails on an unexpected restart", () => {
    const samples = healthySamples();
    samples[2] = { ...samples[2], pid: 9999 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "no-unexpected-restart").status).toBe("FAIL");
  });

  it("fails on heap growth beyond the bound", () => {
    const samples = healthySamples();
    samples[samples.length - 1] = { ...samples[samples.length - 1], heapUsedMiB: samples[0].heapUsedMiB + SOAK_BOUNDS.heapGrowthMiB + 1 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "heap-bounded").status).toBe("FAIL");
  });

  it("fails on resident growth beyond the bound", () => {
    const samples = healthySamples();
    samples[samples.length - 1] = { ...samples[samples.length - 1], rssMiB: samples[0].rssMiB + SOAK_BOUNDS.rssGrowthMiB + 1 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "rss-bounded").status).toBe("FAIL");
  });

  it("fails on handle growth beyond the bound", () => {
    const samples = healthySamples();
    samples[samples.length - 1] = { ...samples[samples.length - 1], handles: samples[0].handles + SOAK_BOUNDS.handleGrowth + 1 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "handles-bounded").status).toBe("FAIL");
  });

  it("fails when the queue is still holding work at the end of the run", () => {
    // A backlog that is still there in the final stretch means work accumulated
    // faster than it was processed; the tail window is what makes this fail.
    const samples = healthySamples(10).map((entry) => ({ ...entry, queueDepth: SOAK_BOUNDS.queueDepthCeiling + 10 }));
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "queue-drained").status).toBe("FAIL");
  });

  it("passes when the tail window shows the queue reaching zero", () => {
    const samples = healthySamples(10).map((entry, index) => ({ ...entry, queueDepth: index >= 9 ? 0 : 3 }));
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "queue-drained").status).toBe("PASS");
  });

  it("fails when failures dominate settled work", () => {
    expect(outcome(evaluateSoakInvariants(invariantInput({ completed: 1, failed: 9 })), "failure-ratio-bounded").status).toBe("FAIL");
  });

  it("fails when the load generator generated almost nothing", () => {
    expect(outcome(evaluateSoakInvariants(invariantInput({ completed: 1, failed: 0, elapsedSeconds: 600 })), "throughput-above-floor").status).toBe("FAIL");
  });

  it("reports throughput UNAVAILABLE for a run too short to measure a rate", () => {
    expect(outcome(evaluateSoakInvariants(invariantInput({ elapsedSeconds: 3 })), "throughput-above-floor").status).toBe("UNAVAILABLE");
  });

  it("fails when a session went stale", () => {
    const samples = healthySamples();
    samples[3] = { ...samples[3], staleSessions: 2 };
    expect(outcome(evaluateSoakInvariants(invariantInput({ samples })), "no-stale-sessions").status).toBe("FAIL");
  });

  it("fails when a provider entered a crash loop", () => {
    expect(
      outcome(evaluateSoakInvariants(invariantInput({ circuitOpenCounts: { "web:a": SOAK_BOUNDS.providerCrashLoopLimit + 1 } })), "provider-crash-loop-bounded").status
    ).toBe("FAIL");
  });

  it("reports UNAVAILABLE, not FAIL, when fewer than two samples exist", () => {
    const outcomes = evaluateSoakInvariants(invariantInput({ samples: [sample()], completed: 50 }));
    for (const id of ["rss-bounded", "heap-bounded", "handles-bounded"]) {
      expect(outcome(outcomes, id).status).toBe("UNAVAILABLE");
    }
  });

  it("never reports an interrupted run as PASS", () => {
    const verdict = soakVerdict({ tier: "30m", elapsedSeconds: 120, invariants: evaluateSoakInvariants(invariantInput({ tier: "30m", elapsedSeconds: 120 })) });
    expect(verdict.overall).toBe("INCOMPLETE_WITH_PARTIAL_EVIDENCE");
    expect(verdict.reason).toMatch(/not a pass/);
  });

  it("reports a host that could not sustain the run as BLOCKED_EXTERNAL, never PASS", () => {
    const verdict = soakVerdict({
      tier: "2h",
      elapsedSeconds: 300,
      invariants: evaluateSoakInvariants(invariantInput({ tier: "2h", elapsedSeconds: 300 })),
      blockedExternal: { reason: "the host reclaimed the process" }
    });
    expect(verdict.overall).toBe("BLOCKED_EXTERNAL");
    expect(verdict.reason).toContain("partial evidence is preserved");
  });

  it("reports a breach as FAIL even when the duration was reached", () => {
    const samples = healthySamples();
    samples[samples.length - 1] = { ...samples[samples.length - 1], heapUsedMiB: 9_999 };
    const verdict = soakVerdict({ tier: "smoke", elapsedSeconds: 60, invariants: evaluateSoakInvariants(invariantInput({ samples })) });
    expect(verdict.overall).toBe("FAIL");
    expect(verdict.reason).toContain("heap-bounded");
  });

  it("passes only when the tier duration AND every invariant hold", () => {
    expect(soakVerdict({ tier: "smoke", elapsedSeconds: 60, invariants: evaluateSoakInvariants(invariantInput()) }).overall).toBe("PASS");
  });

  it("summarizes and renders every invariant with its observed value and bound", () => {
    const outcomes = evaluateSoakInvariants(invariantInput());
    expect(summarizeSoak(outcomes)).toContain(`${outcomes.length} `);
    const text = renderSoakReport({
      schemaVersion: 1,
      kind: "HOST_SOAK",
      tier: "smoke",
      label: "smoke",
      generatedAt: AT,
      startedAt: AT,
      elapsedSeconds: 30,
      targetSeconds: 20,
      completed: 50,
      failed: 0,
      retries: 1,
      tasksPerSecond: 1.5,
      samples: healthySamples(),
      invariants: outcomes,
      unavailable: [{ dimension: "renderer-health", reason: "headless" }],
      overall: "PASS",
      verdictReason: "ok"
    });
    expect(text).toContain("heap-bounded");
    expect(text).toContain("bound growth");
    expect(text).toContain("UNAVAILABLE renderer-health");
  });
});

describe("soak harness run (P3)", () => {
  it("runs a bounded tier, samples resources and writes a heartbeat", async () => {
    const heartbeatPath = path.join(dir, "heartbeat.json");
    const { report } = await runSoak({
      tier: "smoke",
      workDir: path.join(dir, "work"),
      heartbeatPath,
      sampleIntervalMs: 300,
      budgetSeconds: 3
    });

    expect(report.kind).toBe("HOST_SOAK");
    expect(report.samples.length).toBeGreaterThanOrEqual(2);
    expect(report.completed).toBeGreaterThan(0);
    // Real measurements, not placeholders.
    for (const entry of report.samples) {
      expect(entry.rssMiB).toBeGreaterThan(1);
      expect(entry.pid).toBe(process.pid);
      expect(typeof entry.handles).toBe("number");
      expect(entry.cpuMs).toBeGreaterThan(0);
    }
    // A short run cannot reach the 30m audit bar, so it must not pass.
    expect(report.overall).not.toBe("PASS");
    expect(report.overall).toBe("INCOMPLETE_WITH_PARTIAL_EVIDENCE");

    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
    expect(heartbeat.schemaVersion).toBe(1);
    expect(heartbeat.tier).toBe("smoke");
    expect(heartbeat.completed).toBeGreaterThan(0);
    expect(heartbeat.samples).toBeGreaterThan(0);
  }, 60_000);

  it("declares renderer health UNAVAILABLE with a reason instead of inventing a value", async () => {
    const { report } = await runSoak({
      tier: "smoke",
      workDir: path.join(dir, "work"),
      sampleIntervalMs: 500,
      budgetSeconds: 2
    });
    const renderer = report.unavailable.find((entry) => entry.dimension === "renderer-health");
    expect(renderer).toBeDefined();
    expect(renderer!.reason).toMatch(/headless|renderer/);
    expect(report.samples.every((entry) => entry.rendererHealthy === undefined)).toBe(true);
  }, 60_000);

  it("records the pool of real child processes and leaves none behind", async () => {
    const { report } = await runSoak({
      tier: "smoke",
      workDir: path.join(dir, "work"),
      sampleIntervalMs: 500,
      budgetSeconds: 2
    });
    // The pool is real and observed during the run...
    expect(report.samples.some((entry) => entry.orphanProcesses > 0)).toBe(true);
    // ...and nothing survives cleanup.
    expect(report.samples[report.samples.length - 1].orphansAfterCleanup).toBe(0);
    expect(report.invariants.find((entry) => entry.id === "no-orphan-processes")!.status).toBe("PASS");
  }, 60_000);

  it("records an injected retry rather than hiding provider failures", async () => {
    const { report } = await runSoak({
      tier: "smoke",
      workDir: path.join(dir, "work"),
      sampleIntervalMs: 500,
      budgetSeconds: 2,
      failureEvery: 2
    });
    expect(report.retries).toBeGreaterThan(0);
    expect(report.samples.some((entry) => entry.providerFailures.length > 0)).toBe(true);
  }, 60_000);

  it("keeps every artefact inside the run's own directory", async () => {
    const workDir = path.join(dir, "work");
    await runSoak({ tier: "smoke", workDir, sampleIntervalMs: 500, budgetSeconds: 2 });
    expect(fs.existsSync(path.join(workDir, "ledger"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, "heartbeat.json"))).toBe(true);
  }, 60_000);

  it("detects that it was resumed from a prior heartbeat", async () => {
    const workDir = path.join(dir, "work");
    const heartbeatPath = path.join(workDir, "heartbeat.json");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      heartbeatPath,
      JSON.stringify({
        schemaVersion: 1,
        tier: "smoke",
        pid: 999_999,
        startedAt: AT,
        updatedAt: AT,
        elapsedSeconds: 12,
        targetSeconds: 20,
        completed: 4,
        failed: 0,
        retries: 0,
        queueDepth: 0,
        samples: 3,
        restarts: 0
      }),
      "utf8"
    );
    const { report } = await runSoak({ tier: "smoke", workDir, heartbeatPath, sampleIntervalMs: 500, budgetSeconds: 2 });
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
    expect(heartbeat.restarts).toBe(1);
    expect(report.samples[0].pid).toBe(process.pid);
  }, 60_000);
});
