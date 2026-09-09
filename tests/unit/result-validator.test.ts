import { describe, expect, it } from "vitest";
import {
  ENGINEERING_GATES,
  RESEARCH_GATES,
  nextPhaseAfterModelDone,
  verifyResult,
  verificationPlanFor
} from "../../src/shared/result-validator";

describe("result-validator: verification plans by domain/risk (§21/§22)", () => {
  it("engineering critical runs the full gate chain", () => {
    const plan = verificationPlanFor("engineering", "critical");
    expect([...plan.gates]).toEqual([...ENGINEERING_GATES]);
  });

  it("low-risk plans stay cheap; risk raises the bar", () => {
    expect(verificationPlanFor("engineering", "low").gates).toEqual(["typecheck", "unit"]);
    expect(verificationPlanFor("engineering", "high").gates).toContain("integration");
    expect(verificationPlanFor("research", "critical").gates).toEqual([...RESEARCH_GATES]);
    expect(verificationPlanFor("research", "medium").gates).toContain("replication");
  });
});

describe("result-validator: MODEL_DONE != COMPLETED (§20)", () => {
  it("a bare model-done claim enters VERIFYING, never PASS", () => {
    const verdict = verifyResult({ domain: "engineering", risk: "high", results: [], modelDoneOnly: true });
    expect(verdict.phase).toBe("VERIFYING");
    expect(verdict.verdict).toBe("REWORK");
    expect(verdict.missing.length).toBeGreaterThan(0);
  });

  it("nextPhaseAfterModelDone with no evidence stays VERIFYING and lists the whole plan as missing", () => {
    const verdict = nextPhaseAfterModelDone({ domain: "research", risk: "high", results: [] });
    expect(verdict.phase).toBe("VERIFYING");
    expect(verdict.verdict).toBe("REWORK");
    expect(verdict.missing).toContain("protocol");
  });

  it("PASS requires every planned gate to carry evidence (fail-closed)", () => {
    const verdict = verifyResult({
      domain: "engineering",
      risk: "medium",
      results: [
        { gate: "typecheck", evidence: "tsc PASS" },
        { gate: "build", evidence: "vite PASS" },
        { gate: "unit", evidence: "vitest 30/30 PASS" }
      ]
    });
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.phase).toBe("PASS");
    expect(verdict.missing).toEqual([]);
  });

  it("missing or evidence-less gates force REWORK with the gap listed", () => {
    const verdict = verifyResult({
      domain: "engineering",
      risk: "high",
      results: [
        { gate: "typecheck", evidence: "tsc PASS" },
        { gate: "unit", evidence: "vitest 30/30 PASS" },
        { gate: "build", error: "vite failed" },
        { gate: "integration", error: "not run" }
      ]
    });
    expect(verdict.verdict).toBe("REWORK");
    expect(verdict.missing).toEqual(["build", "integration"]);
    expect(verdict.passed).toContain("typecheck");
  });

  it("an empty plan cannot pass (no plan => no verified result)", () => {
    const verdict = verifyResult({ domain: "engineering", risk: "medium", results: [] });
    expect(verdict.verdict).toBe("REWORK");
  });
});

describe("result-validator: capability-unavailable gates (R43 Phase A / seam v2)", () => {
  it("unavailable gates are reported but never satisfy the plan by themselves", () => {
    const verdict = verifyResult({ domain: "engineering", risk: "high", results: [], unavailable: ["typecheck", "build", "integration", "unit"] });
    expect(verdict.verdict).toBe("REWORK"); // all gates unavailable ⇒ no passed evidence ⇒ REWORK
    expect(verdict.missing).toEqual([]);
    expect(verdict.unavailable).toEqual(["typecheck", "build", "unit", "integration"]); // plan order
  });

  it("applicable passed gates + honest unavailable gates ⇒ PASS (capability-resolved)", () => {
    const verdict = verifyResult({
      domain: "engineering",
      risk: "high",
      results: [{ gate: "unit", evidence: "test PASS" }, { gate: "integration", evidence: "full sweep PASS" }],
      unavailable: ["typecheck", "build"]
    });
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.missing).toEqual([]);
    expect(verdict.unavailable).toEqual(["typecheck", "build"]);
    expect(verdict.passed).toEqual(["unit", "integration"]);
  });

  it("an unavailable + a genuinely missing gate still forces REWORK with the gap listed", () => {
    const verdict = verifyResult({
      domain: "engineering",
      risk: "high",
      results: [{ gate: "unit", evidence: "test PASS" }],
      unavailable: ["typecheck"]
    });
    expect(verdict.verdict).toBe("REWORK");
    expect(verdict.missing).toContain("build");
    expect(verdict.missing).toContain("integration");
  });
});
