import { describe, expect, it } from "vitest";
import {
  buildRepairPlan,
  classifyRepairNeed,
  geometryTargetValid,
  grantedComputerActions,
  planSummary,
  tierForTarget,
  verdictForOutcome
} from "../../src/shared/computer-recovery";

describe("computer-recovery: §26 failure classification", () => {
  it("classifies send/input/selector failures as CU_REPAIR", () => {
    expect(classifyRepairNeed({ reason: "send-button-not-found" }).need).toBe("SEND_AFFORDANCE_MISSING");
    expect(classifyRepairNeed({ reason: "enter-did-not-submit" }).need).toBe("SEND_AFFORDANCE_MISSING");
    expect(classifyRepairNeed({ reason: "找不到发送按钮" }).need).toBe("SEND_AFFORDANCE_MISSING");
    expect(classifyRepairNeed({ reason: "input-not-found", probe: { inputFound: false } }).need).toBe("INPUT_AFFORDANCE_MISSING");
    expect(classifyRepairNeed({ reason: "response selector drift" }).need).toBe("RESPONSE_SELECTOR_DRIFT");
  });

  it("never CU-repairs login/CAPTCHA pages (human gate stays)", () => {
    expect(classifyRepairNeed({ reason: "please log in", probe: { loginLikely: true } }).verdict).toBe("HUMAN_REQUIRED");
    expect(classifyRepairNeed({ reason: "需要验证码" }).verdict).toBe("HUMAN_REQUIRED");
  });

  it("unknown structural failures are NOT_REPAIRABLE, never guessed into mutations", () => {
    expect(classifyRepairNeed({ reason: "runtime crashed unexpectedly" }).verdict).toBe("NOT_REPAIRABLE");
  });
});

describe("computer-recovery: repair plan building (§26/§28)", () => {
  it("produces a verifiable READY chain when read/act/verify grants exist", () => {
    const grants = new Set(["read_page", "click_control", "verify_state"] as const);
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, grants);
    expect(plan.verdict).toBe("READY");
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.steps.map((s) => s.action)).toEqual(["read_page", "click_control", "verify_state"]);
    expect(planSummary(plan).actions).toContain("verify_state");
  });

  it("an ICON/POINT target without frame revision + bounded region makes the plan UNCERTAIN", () => {
    expect(geometryTargetValid({ kind: "ICON", hint: "send" })).toBe(false);
    expect(geometryTargetValid({ kind: "POINT" })).toBe(false);
    expect(geometryTargetValid({ kind: "TEXT" })).toBe(true);
    expect(geometryTargetValid({ kind: "ICON", hint: "send", frameRevisionAt: 10, boundedRegion: { x: 1, y: 2, width: 3, height: 4 } })).toBe(true);
  });

  it("DENIED when the required mutation grant is missing (fail closed)", () => {
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set());
    expect(plan.verdict).toBe("DENIED");
    expect(plan.reason).toMatch(/click_control/);
    const inputPlan = buildRepairPlan("INPUT_AFFORDANCE_MISSING", 1000, new Set(["read_page", "verify_state"]));
    expect(inputPlan.verdict).toBe("DENIED");
    expect(inputPlan.reason).toMatch(/enter_text/);
  });

  it("an ICON affordance without a usable frame revision makes the plan UNCERTAIN (§28)", () => {
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 0, new Set(["read_page", "click_control", "verify_state"]));
    expect(plan.verdict).toBe("UNCERTAIN");
    expect(plan.reason).toMatch(/bounded region/);
  });
});

describe("computer-recovery: §29 permission token mapping", () => {
  it("maps computer:<action> allow-list entries onto action grants", () => {
    const grants = grantedComputerActions(["computer:read_page", "computer:click_control", "computer:submit", "filesystem:repo"]);
    expect(grants.has("read_page")).toBe(true);
    expect(grants.has("click_control")).toBe(true);
    expect(grants.has("submit")).toBe(true);
    expect(grants.has("enter_text")).toBe(false);
    expect(grants.has("verify_state")).toBe(false);
  });
});

describe("computer-recovery: §25 post-condition discipline", () => {
  it("VERIFIED only when the post-condition is observed; otherwise UNCERTAIN (no blind repeat)", () => {
    const step = { action: "click_control", target: { kind: "ICON" }, postCondition: { description: "x" }, rationale: "r" };
    expect(verdictForOutcome(step, { postConditionSeen: true })).toBe("VERIFIED");
    expect(verdictForOutcome(step, { acted: true, postConditionSeen: false })).toBe("UNCERTAIN");
    expect(verdictForOutcome(step, { acted: false })).toBe("UNCERTAIN");
  });
});

describe("computer-recovery: §24 tier ordering", () => {
  it("semantic targets are cheaper than geometry targets", () => {
    expect(tierForTarget("TEXT")).toBeLessThan(tierForTarget("ROLE"));
    expect(tierForTarget("ROLE")).toBeLessThan(tierForTarget("ACCESSIBILITY"));
    expect(tierForTarget("REGION")).toBeLessThan(tierForTarget("ICON"));
    expect(tierForTarget("ICON")).toBeLessThan(tierForTarget("POINT"));
  });
});
