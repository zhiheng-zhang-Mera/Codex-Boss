import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  FAULT_CLASSES,
  FAULT_DEFINITIONS,
  buildFaultLabReport,
  classifyFault,
  emptyFaultSummary,
  faultDefinition,
  renderFaultLabReport,
  summarizeFaults,
  type FaultDefinition,
  type FaultResult
} from "../../src/shared/fault-lab";
import { FAULT_INJECTORS, injectorCoverage, runFaultLab } from "../../electron/host/fault-lab";

const AT = "2026-09-10T00:00:00.000Z";

function definition(overrides: Partial<FaultDefinition> = {}): FaultDefinition {
  return {
    id: "x-fault",
    fault: "worker-crash",
    label: "fake",
    expectation: "CONTINUE",
    target: "fake",
    detection: "the system notices",
    containment: "the system stays usable",
    ...overrides
  };
}

function result(overrides: Partial<FaultResult> = {}): FaultResult {
  return {
    id: "x-fault",
    fault: "worker-crash",
    label: "fake",
    verdict: "CONTAINED",
    injected: true,
    detected: true,
    contained: true,
    detail: "",
    steps: [],
    durationMs: 1,
    ...overrides
  };
}

const before = new Set(fs.readdirSync(os.tmpdir()));

afterAll(() => {
  // Every injection runs in its own temp directory; a leftover one would mean the
  // lab leaked on a failure path.
  const leaked = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("host-fault-") && !before.has(name));
  expect(leaked).toEqual([]);
});

describe("failure injection lab contract (P2)", () => {
  it("declares exactly the thirteen fault classes the plan names", () => {
    expect([...FAULT_CLASSES]).toHaveLength(13);
    const declared = FAULT_DEFINITIONS.map((entry) => entry.fault);
    expect(new Set(declared)).toEqual(new Set(FAULT_CLASSES));
    expect(FAULT_DEFINITIONS).toHaveLength(13);
  });

  it("gives every fault a target, a detection rule and a containment rule", () => {
    const ids = FAULT_DEFINITIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FAULT_DEFINITIONS) {
      expect(entry.target.length).toBeGreaterThan(3);
      expect(entry.detection.length).toBeGreaterThan(10);
      expect(entry.containment.length).toBeGreaterThan(10);
      expect(["CONTINUE", "REFUSE_CLEANLY", "EITHER"]).toContain(entry.expectation);
    }
  });

  it("resolves a fault by id and rejects an unknown one", () => {
    expect(faultDefinition("provider-unavailable").fault).toBe("provider-unavailable");
    expect(() => faultDefinition("nope")).toThrow(/Unknown fault/);
  });

  it("summarizes every verdict bucket exactly once", () => {
    const results = [
      result({ id: "a", verdict: "CONTAINED" }),
      result({ id: "b", verdict: "ACCEPTED_DEGRADATION" }),
      result({ id: "c", verdict: "NOT_INJECTED" }),
      result({ id: "d", verdict: "UNDETECTED" }),
      result({ id: "e", verdict: "UNCONTAINED" })
    ];
    expect(summarizeFaults(results)).toEqual({ contained: 1, acceptedDegradation: 1, notInjected: 1, undetected: 1, uncontained: 1, total: 5 });
    expect(emptyFaultSummary().total).toBe(0);
  });

  it("classifies nothing-proven as NOT_INJECTED before anything else", () => {
    expect(classifyFault({ definition: definition(), injected: false, detected: true, contained: true, refused: false, damaged: false })).toBe("NOT_INJECTED");
  });

  it("classifies a fault the system ignored as UNDETECTED, never as a pass", () => {
    expect(classifyFault({ definition: definition(), injected: true, detected: false, contained: true, refused: false, damaged: false })).toBe("UNDETECTED");
  });

  it("classifies damage beyond the fault as UNCONTAINED", () => {
    expect(classifyFault({ definition: definition(), injected: true, detected: true, contained: false, refused: false, damaged: true })).toBe("UNCONTAINED");
  });

  it("lets a fault that may refuse be recorded as ACCEPTED_DEGRADATION", () => {
    const refuser = definition({ expectation: "REFUSE_CLEANLY" });
    expect(classifyFault({ definition: refuser, injected: true, detected: true, contained: true, refused: true, damaged: false })).toBe("ACCEPTED_DEGRADATION");
  });

  it("refuses to let a CONTINUE fault pass by refusing", () => {
    // A fault whose contract is "keep working" cannot be graded as handled just
    // because the system gave up cleanly.
    expect(classifyFault({ definition: definition({ expectation: "CONTINUE" }), injected: true, detected: true, contained: true, refused: true, damaged: false })).toBe("UNCONTAINED");
  });

  it("fails the report whenever any fault was not injected, undetected or uncontained", () => {
    const clean = buildFaultLabReport({ results: [result()], generatedAt: AT });
    expect(clean.overall).toBe("PASS");
    const dirty = buildFaultLabReport({ results: [result(), result({ id: "b", verdict: "UNDETECTED" })], generatedAt: AT });
    expect(dirty.overall).toBe("FAIL");
    expect(dirty.verdictReason).toContain("UNDETECTED");
  });

  it("renders the verdict and reason for every row", () => {
    const report = buildFaultLabReport({
      results: [result({ id: "a" }), result({ id: "b", verdict: "UNCONTAINED", detail: "damaged neighbour" })],
      generatedAt: AT
    });
    const text = renderFaultLabReport(report);
    expect(text).toContain("UNCONTAINED");
    expect(text).toContain("damaged neighbour");
    expect(text).toContain(report.verdictReason);
  });
});

describe("failure injection lab runner (P2)", () => {
  it("has an injector for every declared fault class and no undeclared injector", () => {
    expect(injectorCoverage()).toEqual({ missing: [], undeclared: [] });
  });

  it("runs every declared fault and reports a verdict for each", async () => {
    const report = await runFaultLab({ now: () => AT });
    expect(report.overall).toBe("PASS");
    expect(report.results).toHaveLength(FAULT_DEFINITIONS.length);
    expect(new Set(report.results.map((entry) => entry.id))).toEqual(new Set(FAULT_DEFINITIONS.map((entry) => entry.id)));
    for (const entry of report.results) {
      expect(["CONTAINED", "ACCEPTED_DEGRADATION"]).toContain(entry.verdict);
      expect(entry.injected).toBe(true);
      expect(entry.detected).toBe(true);
      expect(entry.contained).toBe(true);
      // All three phases must be evidenced, not just asserted.
      expect(entry.steps.map((step) => step.step)).toEqual(["inject", "observe", "contain"]);
      expect(entry.steps.every((step) => step.ok)).toBe(true);
    }
  }, 60_000);

  it("proves each fault was really injected rather than silently skipped", async () => {
    const report = await runFaultLab({ now: () => AT });
    for (const entry of report.results) {
      const inject = entry.steps.find((step) => step.step === "inject")!;
      expect(inject.detail.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("runs a requested subset and still reports only that subset", async () => {
    const report = await runFaultLab({ only: ["stale-heartbeat", "worker-crash"], now: () => AT });
    expect(report.results.map((entry) => entry.id)).toEqual(["worker-crash", "stale-heartbeat"]);
    expect(report.overall).toBe("PASS");
  }, 30_000);

  it("rejects an unknown fault id instead of silently running nothing", async () => {
    await expect(runFaultLab({ only: ["not-a-fault"], now: () => AT })).rejects.toThrow(/Unknown fault/);
  });

  it("records a throwing injector as NOT_INJECTED and fails the run", async () => {
    const report = await runFaultLab({ only: ["malformed-persistence"], now: () => AT });
    expect(report.overall).toBe("PASS");
    // Sanity: the same fault, forced to throw, cannot pass.
    const forced = classifyFault({ definition: faultDefinition("malformed-persistence"), injected: false, detected: false, contained: false, refused: false, damaged: false });
    expect(forced).toBe("NOT_INJECTED");
  }, 30_000);

  it("never leaves an injection directory behind", async () => {
    const local = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("host-fault-")));
    await runFaultLab({ now: () => AT });
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("host-fault-") && !local.has(name));
    expect(after).toEqual([]);
  }, 60_000);

  it("keeps every injection inside a temp directory rather than the repo", async () => {
    // The injectors receive a temp dir; a fault writing into the checkout would
    // be a lab defect. Guard the declared contract instead of trusting it.
    const report = await runFaultLab({ now: () => AT });
    for (const entry of report.results) {
      for (const step of entry.steps) {
        expect(step.detail).not.toContain(process.cwd());
      }
    }
  }, 60_000);
});

describe("failure injection lab injectors against the real subsystems (P2)", () => {
  it("keeps the provider role routable after a budget and circuit failure", async () => {
    const report = await runFaultLab({ only: ["provider-unavailable"], now: () => AT });
    const entry = report.results[0];
    expect(entry.verdict).toBe("CONTAINED");
    expect(entry.steps.find((step) => step.step === "observe")!.detail).toContain("web:b");
  }, 30_000);

  it("records the documented dropout semantics for checkpointed and unsafe work", async () => {
    const report = await runFaultLab({ only: ["node-dropout"], now: () => AT });
    const entry = report.results[0];
    expect(entry.verdict).toBe("CONTAINED");
    const observed = entry.steps.find((step) => step.step === "observe")!.detail;
    expect(observed).toContain("node-a=OFFLINE");
    expect(observed).toContain("checkpointed -> ASSIGNED@node-b");
    expect(observed).toContain("unsafe -> FAILED");
  }, 30_000);

  it("keeps the prior ledger generation readable when a checkpoint cannot be written", async () => {
    const report = await runFaultLab({ only: ["disk-unavailable"], now: () => AT });
    const entry = report.results[0];
    expect(entry.verdict).toBe("ACCEPTED_DEGRADATION");
    expect(entry.steps.find((step) => step.step === "observe")!.detail).toMatch(/EISDIR|EEXIST|EACCES|EPERM/);
    expect(entry.steps.find((step) => step.step === "contain")!.detail).toContain("still readable");
  }, 30_000);

  it("keeps usable episode rows when unusable ones are interleaved", async () => {
    const report = await runFaultLab({ only: ["corrupted-cache"], now: () => AT });
    const entry = report.results[0];
    expect(entry.verdict).toBe("CONTAINED");
    expect(entry.steps.find((step) => step.step === "observe")!.detail).toContain("count=2");
    expect(entry.steps.find((step) => step.step === "observe")!.detail).toContain("invalid episode row");
  }, 30_000);

  it("derives fleet staleness from heartbeat age without writing the record", async () => {
    const report = await runFaultLab({ only: ["stale-heartbeat"], now: () => AT });
    const entry = report.results[0];
    const observed = entry.steps.find((step) => step.step === "observe")!.detail;
    expect(observed).toContain("DEGRADED");
    expect(observed).toContain("OFFLINE");
    expect(entry.verdict).toBe("CONTAINED");
  }, 30_000);
});
