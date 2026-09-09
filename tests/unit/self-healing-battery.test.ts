import { describe, expect, it } from "vitest";
import {
  HEALING_SCENARIOS,
  detectScenario,
  planHealing,
  stagnated
} from "../../src/shared/self-healing-battery";
import { grantedComputerActions } from "../../src/shared/computer-recovery";

describe("self-healing battery (§32 catalog)", () => {
  it("covers all ten §32 scenarios with detection, lane and verification gates", () => {
    const ids = HEALING_SCENARIOS.map((scenario) => scenario.id);
    expect(ids).toEqual([
      "SELECTOR_BROKEN",
      "SEND_MECHANISM_CHANGED",
      "RESPONSE_PARSER_BROKEN",
      "PROVIDER_TIMEOUT",
      "LOGIN_EXPIRED",
      "STALE_SESSION",
      "TEST_REGRESSION",
      "CROSS_MODULE_CONTRACT_BREAK",
      "REVIEWER_REJECTION",
      "ELECTRON_RESTART"
    ]);
    for (const scenario of HEALING_SCENARIOS) {
      expect(scenario.verificationGates.length).toBeGreaterThan(0);
      expect(scenario.detection.length).toBeGreaterThan(0);
    }
  });

  it("detects scenarios from raw signals (CN + EN)", () => {
    expect(detectScenario("send-button-not-found")?.id).toBe("SEND_MECHANISM_CHANGED");
    expect(detectScenario("找不到发送按钮")?.id).toBe("SEND_MECHANISM_CHANGED");
    expect(detectScenario("vitest fail: 2 failed")?.id).toBe("TEST_REGRESSION");
    expect(detectScenario("TS2307 cannot find module")?.id).toBe("CROSS_MODULE_CONTRACT_BREAK");
    expect(detectScenario("render-process-gone")?.id).toBe("ELECTRON_RESTART");
    expect(detectScenario("veto: reject")?.id).toBe("REVIEWER_REJECTION");
  });

  it("LOGIN_EXPIRED is never auto-healed (HB1 credential step)", () => {
    const plan = planHealing("LOGIN_EXPIRED");
    expect(plan.verdict).toBe("NOT_AUTO_HEALED");
    expect(plan.scenario.lane).toBe("PROVIDER_RECOVERY");
    expect(plan.reason).toMatch(/never faked/);
  });

  it("SEND_MECHANISM_CHANGED routes to a Computer-Use plan (granted) and stays honest otherwise", () => {
    const grants = grantedComputerActions(["computer:read_page", "computer:click_control", "computer:verify_state"]);
    const plan = planHealing("SEND_MECHANISM_CHANGED", grants);
    expect(plan.scenario.lane).toBe("COMPUTER_USE_PLAN");
    expect(plan.computerUsePlan).toBeDefined();
    expect(plan.verdict).toBe("AUTO_HEALED");
    // Denied plan → NEEDS_LIVE_VERIFY, never a fake heal.
    const denied = planHealing("SEND_MECHANISM_CHANGED", new Set());
    expect(denied.verdict).toBe("NEEDS_LIVE_VERIFY");
  });

  it("every auto-closable scenario names verification gates that must pass first", () => {
    for (const id of ["SELECTOR_BROKEN", "PROVIDER_TIMEOUT", "STALE_SESSION", "TEST_REGRESSION", "REVIEWER_REJECTION", "ELECTRON_RESTART"] as const) {
      const plan = planHealing(id);
      expect(plan.verdict === "AUTO_HEALED" || plan.verdict === "NEEDS_LIVE_VERIFY").toBe(true);
      expect(plan.repairAction).toContain("gates before healed");
    }
  });
});

describe("self-healing battery (§35 stagnation)", () => {
  it("triggers on repeated identity signals or no-improvement-no-evidence", () => {
    expect(stagnated({ sameDiff: true, sameError: false, sameProposal: false, sameReviewerFinding: false, noMetricImprovement: false, noNewEvidence: false })).toBe(true);
    expect(stagnated({ sameDiff: false, sameError: true, sameProposal: false, sameReviewerFinding: false, noMetricImprovement: false, noNewEvidence: false })).toBe(true);
    expect(stagnated({ sameDiff: false, sameError: false, sameProposal: false, sameReviewerFinding: true, noMetricImprovement: false, noNewEvidence: false })).toBe(true);
    expect(stagnated({ sameDiff: false, sameError: false, sameProposal: false, sameReviewerFinding: false, noMetricImprovement: true, noNewEvidence: true })).toBe(true);
    expect(stagnated({ sameDiff: false, sameError: false, sameProposal: false, sameReviewerFinding: false, noMetricImprovement: false, noNewEvidence: true })).toBe(false);
  });
});
