import { describe, expect, it } from "vitest";
import {
  autoDecisionFor,
  classifyQuestion,
  contractForMode,
  defaultRunModeForTask,
  directionStallAction,
  inferQuestionKind,
  interceptForMode,
  ownerResultGateFor,
  pickBestOption,
  scoreOption,
  type AutoDecision,
  type QuestionInterception
} from "../../src/shared/owner-result";

describe("owner-result: modes & contract", () => {
  it("defaults advanced tasks to OWNER_RESULT and chat to ASSISTED", () => {
    expect(defaultRunModeForTask("chat")).toBe("ASSISTED");
    expect(defaultRunModeForTask("work")).toBe("OWNER_RESULT");
    expect(defaultRunModeForTask("research")).toBe("OWNER_RESULT");
    expect(defaultRunModeForTask("engineering")).toBe("OWNER_RESULT");
    expect(defaultRunModeForTask("other")).toBe("OWNER_RESULT");
  });

  it("OWNER_RESULT contract has zero checkpoint budget and hard-blocker-only surfacing", () => {
    const contract = contractForMode("OWNER_RESULT");
    expect(contract.checkpointBudget).toBe(0);
    expect(contract.hardBlockerOnly).toBe(true);
    expect(contract.autoEscalateDirection).toBe(true);
  });

  it("ASSISTED keeps unlimited checkpoints; AUTONOMOUS is bounded", () => {
    expect(contractForMode("ASSISTED").checkpointBudget).toBe("UNLIMITED");
    expect(contractForMode("ASSISTED").autoEscalateDirection).toBe(false);
    expect(contractForMode("AUTONOMOUS").checkpointBudget).toBe(1);
  });
});

describe("owner-result: HB1-HB4 classification", () => {
  it("classifies permission/credential signals as HB1 HARD_BLOCKER", () => {
    for (const text of ["please log in to continue", "需要登录或验证码", "API key missing", "需要权限才能继续"]) {
      const result = classifyQuestion({ text });
      expect(result.classification).toBe("HARD_BLOCKER");
      expect(result.blocker?.kind).toBe("HB1_PERMISSIONS_OR_CREDENTIALS");
    }
  });

  it("classifies payment / publish / production delete as HB2", () => {
    for (const text of ["是否确认付款 $99", "确认对外发布该版本？", "drop table production_users?"]) {
      const result = classifyQuestion({ text });
      expect(result.classification).toBe("HARD_BLOCKER");
      expect(result.blocker?.kind).toBe("HB2_IRREVERSIBLE_EXTERNAL_ACTION");
    }
  });

  it("classifies goal contradiction and missing external resources as HB3/HB4", () => {
    expect(classifyQuestion({ text: "两个验收目标相互矛盾，无法同时满足" }).blocker?.kind).toBe("HB3_GOAL_CONTRADICTION");
    expect(classifyQuestion({ text: "the required external benchmark does not exist anywhere" }).blocker?.kind).toBe("HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING");
  });

  it("keeps routine A/B and continuation questions DECIDABLE", () => {
    for (const text of ["是否继续执行？", "请选择 A/B 方案", "要不要重试？", "请选择实现方式：方案一或方案二"]) {
      expect(classifyQuestion({ text }).classification).toBe("DECIDABLE");
    }
  });
});

describe("owner-result: question kind inference", () => {
  it("infers continuation, direction and hard-blocker kinds deterministically", () => {
    expect(inferQuestionKind("是否继续？")).toBe("CONTINUATION");
    expect(inferQuestionKind("should I retry")).toBe("CONTINUATION");
    expect(inferQuestionKind("请选择方案 A 还是 B")).toBe("DIRECTION");
    expect(inferQuestionKind("需要验证码")).toBe("AUTHORIZATION");
    expect(inferQuestionKind("是否确认发布？")).toBe("EXTERNAL_ACTION");
  });
});

describe("owner-result: auto decision policies (deterministic)", () => {
  it("auto-continues on continuation questions", () => {
    const decision: AutoDecision = autoDecisionFor({ text: "是否继续？" });
    expect(decision.action).toBe("CONTINUE");
    expect(decision.policy).toContain("continue");
  });

  it("picks the safest explicit option (rollback bias)", () => {
    const options = ["方案A：立即切换新架构", "方案B：回滚到上一稳定版再验证"];
    const decision: AutoDecision = autoDecisionFor({ text: "请选择处理方式", options });
    expect(decision.action).toBe("PICK_OPTION");
    expect(decision.chosen).toBe(options[1]);
  });

  it("risk-aware option scoring is deterministic and stable", () => {
    expect(scoreOption("回滚到稳定版")).toBeGreaterThan(scoreOption("删除生产数据"));
    const picked = pickBestOption(["删除线上库", "保守回滚", "推荐最小改动"]);
    expect(picked.index).toBe(1);
    // tie -> earlier index
    expect(pickBestOption(["推荐A", "推荐B"]).index).toBe(0);
  });

  it("strong-steers when every option carries risk, never asks the owner", () => {
    const decision: AutoDecision = autoDecisionFor({ text: "如何处理？", options: ["直接发布", "永久删除备份"] });
    expect(decision.action).toBe("STRONG_STEER");
    expect(decision.steer).toContain("风险");
  });

  it("routes unknown non-HB questions to an internal planner with a steer", () => {
    const decision: AutoDecision = autoDecisionFor({ text: "接下来怎么做比较好？" });
    expect(decision.action).toBe("ROUTE_TO_PLANNER");
    expect(decision.steer).toContain("planner");
  });
});

describe("owner-result: question interception under modes (§18)", () => {
  it("OWNER_RESULT auto-decides DECIDABLE questions instead of surfacing them", () => {
    const interception: QuestionInterception = interceptForMode({ text: "是否继续？" }, "OWNER_RESULT");
    expect(interception.classification).toBe("DECIDABLE");
    expect(interception.intercepted).toBe(true);
    expect(interception.decision?.action).toBe("CONTINUE");
  });

  it("OWNER_RESULT still surfaces true HARD_BLOCKERs", () => {
    const interception: QuestionInterception = interceptForMode({ text: "需要登录账号", options: ["登录", "跳过"] }, "OWNER_RESULT");
    expect(interception.classification).toBe("HARD_BLOCKER");
    expect(interception.intercepted).toBe(false);
    expect(interception.decision).toBeUndefined();
  });

  it("ASSISTED leaves DECIDABLE questions to the existing human gate", () => {
    const interception: QuestionInterception = interceptForMode({ text: "请选择 A/B" }, "ASSISTED");
    expect(interception.classification).toBe("DECIDABLE");
    expect(interception.intercepted).toBe(false);
  });
});

describe("owner-result: direction-stall ladder (§19)", () => {
  it("escalates 1st->AUTO_DECIDE, 2nd->STRONG_STEER, 3rd->INDEPENDENT_DECISION, later->FRESH_EPISODE", () => {
    expect(directionStallAction(0).action).toBe("AUTO_DECIDE");
    expect(directionStallAction(1).action).toBe("STRONG_STEER");
    expect(directionStallAction(2).action).toBe("INDEPENDENT_DECISION");
    expect(directionStallAction(3).action).toBe("FRESH_EPISODE");
    expect(directionStallAction(9).action).toBe("FRESH_EPISODE");
  });
});

describe("owner-result: human-gate mapping under OWNER_RESULT", () => {
  it("maps legacy intervention categories onto HB1-HB4 or decidable", () => {
    expect(ownerResultGateFor("AUTHORIZATION").verdict).toBe("HARD_BLOCKER");
    expect(ownerResultGateFor("AUTHORIZATION").blocker?.kind).toBe("HB1_PERMISSIONS_OR_CREDENTIALS");
    expect(ownerResultGateFor("EXTERNAL_ACTION").blocker?.kind).toBe("HB2_IRREVERSIBLE_EXTERNAL_ACTION");
    expect(ownerResultGateFor("GOAL_CONFLICT").blocker?.kind).toBe("HB3_GOAL_CONTRADICTION");
    expect(ownerResultGateFor("RESOURCE_MISSING").blocker?.kind).toBe("HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING");
  });

  it("keeps direction/scope/technical/continuation decidable under OWNER_RESULT", () => {
    for (const kind of ["DIRECTION", "RESEARCH_SCOPE", "TECHNICAL_CHOICE", "CONTINUATION", "UNKNOWN"] as const) {
      expect(ownerResultGateFor(kind).verdict).toBe("DECIDABLE");
    }
  });
});
