import { expect, it } from "vitest";
import { workEscalationVerdict } from "../../src/shared/owner-result";

/**
 * §18 task-level interception (Owner-Result.md Rev.2): a Chat→WORK capability
 * proposal is a DECIDABLE capability-routing question. OWNER_RESULT
 * (checkpointBudget = 0) auto-approves; ASSISTED / AUTONOMOUS keep the human
 * gate, and any HARD_BLOCKER text in the reason pauses in every mode.
 */

it("OWNER_RESULT auto-approves a plain capability escalation", () => {
  const verdict = workEscalationVerdict("OWNER_RESULT", "任务需要进入 Work 模式才能扫描并修改代码", "code,repository");
  expect(verdict.action).toBe("AUTO_APPROVE");
  expect(verdict.decision?.action).toBe("CONTINUE");
  expect(verdict.decision?.policy).toBe("owner-result:escalate-work:v1");
  expect(verdict.decision?.chosen).toContain("WORK");
});

it("ASSISTED keeps the human gate (legacy Chat→WORK proposal)", () => {
  const verdict = workEscalationVerdict("ASSISTED", "任务需要进入 Work 模式才能扫描并修改代码");
  expect(verdict.action).toBe("PAUSE");
  expect(verdict.decision).toBeUndefined();
});

it("AUTONOMOUS keeps the human gate (checkpoint budget > 0)", () => {
  const verdict = workEscalationVerdict("AUTONOMOUS", "任务需要进入 Work 模式才能扫描并修改代码");
  expect(verdict.action).toBe("PAUSE");
});

it("HARD_BLOCKER text in the reason pauses even under OWNER_RESULT (never auto-pays/auto-approves credentials)", () => {
  const paid = workEscalationVerdict("OWNER_RESULT", "需要支付费用购买企业数据接口后才能进入 Work 执行");
  expect(paid.action).toBe("PAUSE");
  const credentials = workEscalationVerdict("OWNER_RESULT", "需要登录并授权 GitHub 凭据才能进入 Work 执行");
  expect(credentials.action).toBe("PAUSE");
});
