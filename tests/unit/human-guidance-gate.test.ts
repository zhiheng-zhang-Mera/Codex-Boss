import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { HumanGuidanceGate } from "../../electron/commander/human-guidance-gate";

/**
 * Durable human-guidance gate (plan 9-6 Phase 4). The single raise/resolve seam
 * for decisions that genuinely must reach the operator (login/CAPTCHA/budget/
 * direction). Assertions cover durability across reopen, single-active-per-task
 * enforcement, append-only resolution, and fail-closed restore on corruption.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function file(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidance-gate-"));
  dirs.push(dir);
  return path.join(dir, "interventions.json");
}

it("raise persists durably and the request survives a reopen (checkpoint-before-pause contract)", () => {
  const target = file();
  const raised = new HumanGuidanceGate(target).raise({ taskId: "t1", kind: "DIRECTION", question: "研究是否继续当前方向？", options: ["A", "B"], blockingStepId: "step-1", contextSummary: "checkpoint saved at stage X" });
  expect(raised.id).toBeTruthy();
  expect(raised.resolvedAt).toBeUndefined();

  const reloaded = new HumanGuidanceGate(target);
  expect(reloaded.activeFor("t1")?.question).toBe("研究是否继续当前方向？");
  expect(reloaded.list("t1")).toHaveLength(1);
});

it("one active intervention per task+kind: a second raise on the same task is rejected", () => {
  const gate = new HumanGuidanceGate(file());
  gate.raise({ taskId: "t1", kind: "DIRECTION", question: "q1", blockingStepId: "s1", contextSummary: "c1" });
  expect(() => gate.raise({ taskId: "t1", kind: "DIRECTION", question: "q2", blockingStepId: "s2", contextSummary: "c2" })).toThrow(/already waits/);
  // A different kind on the same task is allowed (task waits on at most one per kind).
  const auth = gate.raise({ taskId: "t1", kind: "LOGIN", question: "需要登录", blockingStepId: "s3", contextSummary: "c3" });
  expect(auth.id).toBeTruthy();
});

it("resolve appends the answer and clears the active request (never restart from scratch)", () => {
  const gate = new HumanGuidanceGate(file());
  gate.raise({ taskId: "t1", kind: "AUTHORIZATION", question: "授权 GitHub 凭据？", blockingStepId: "s1", contextSummary: "c1" });
  const resolved = gate.resolve("t1", "AUTHORIZATION", "已授权");
  expect(resolved.answer).toBe("已授权");
  expect(resolved.resolvedAt).toBeTruthy();
  expect(gate.activeFor("t1")).toBeUndefined();
  expect(() => gate.resolve("t1", "AUTHORIZATION", "again")).toThrow(/already resolved/);
});

it("restore is fail-closed: a corrupt intervention store throws instead of silently dropping an unresolved pause", () => {
  const target = file();
  new HumanGuidanceGate(target).raise({ taskId: "t1", kind: "CAPTCHA", question: "验证码", blockingStepId: "s1", contextSummary: "c1" });
  fs.writeFileSync(target, "{ not-json", "utf8");
  expect(() => new HumanGuidanceGate(target)).toThrow();
});
