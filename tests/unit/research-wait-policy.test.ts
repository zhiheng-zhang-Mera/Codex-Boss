import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { researchWaitInterception } from "../../electron/research/research-wait-policy";
import { ResearchSupervisor, type ResearchStageExecutor } from "../../electron/research/research-supervisor";
import { ResearchLedger } from "../../electron/research/research-ledger";
import type { ResearchIR } from "../../src/shared/research-ir";

/**
 * §18 (Owner-Result.md Rev.2) raise-point interception. A research run that is
 * about to pause at WAITING_FOR_USER has its question classified FIRST:
 * AUTOPILOT (= OWNER_RESULT) decidable questions auto-decide durably and never
 * park; genuine HARD_BLOCKERs (HB1–HB4) — and every GUIDED (= ASSISTED) wait —
 * keep the human gate exactly as before. No fabricated human answers.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-research-wait-")); dirs.push(dir); return dir; }

function ir(id: string, autonomy: "AUTOPILOT" | "GUIDED"): ResearchIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    goal: "deterministic interception fixture goal",
    scope: { workspace: root(), allowedDomains: [], reviewers: ["reviewer-a"], autonomy, budget: { maxExperiments: 1, maxSteps: 10 } },
    state: "SCOPING",
    researchQuestions: [],
    hypotheses: [],
    createdAt: now,
    updatedAt: now
  };
}

function supervisorFor(rootDir: string): ResearchSupervisor {
  const executor: ResearchStageExecutor = { run: async () => { throw new Error("executor must not run in interception tests"); } };
  return new ResearchSupervisor({
    ledger: new ResearchLedger(path.join(rootDir, "ledger")),
    executor,
    interceptWait: (input) => researchWaitInterception({ autonomy: input.autonomy, kind: input.kind, question: input.question, options: input.options })
  });
}

// ---- pure policy ----

it("AUTOPILOT decidable continuation question is intercepted and auto-continues", () => {
  const verdict = researchWaitInterception({ autonomy: "AUTOPILOT", kind: "DIRECTION", question: "研究是否继续推进当前阶段？" });
  expect(verdict.intercepted).toBe(true);
  expect(verdict.classification).toBe("DECIDABLE");
  expect(verdict.decision?.action).toBe("CONTINUE");
  expect(verdict.decision?.steer.length).toBeGreaterThan(0);
});

it("AUTOPILOT decidable scope question picks the safest explicit option deterministically", () => {
  const verdict = researchWaitInterception({
    autonomy: "AUTOPILOT",
    kind: "RESEARCH_SCOPE",
    question: "研究范围如何调整？",
    options: ["扩展到公开生产数据(删除敏感列)", "保持当前保守范围继续"]
  });
  expect(verdict.intercepted).toBe(true);
  expect(verdict.classification).toBe("DECIDABLE");
  expect(verdict.decision?.action).toBe("PICK_OPTION");
  expect(verdict.decision?.chosen).toContain("保守范围");
});

it("AUTOPILOT hard blockers still raise (HB1 credentials / HB2 budget)", () => {
  const login = researchWaitInterception({ autonomy: "AUTOPILOT", kind: "LOGIN", question: "需要登录 Qwen 才能继续，凭据不足" });
  expect(login.intercepted).toBe(false);
  expect(login.classification).toBe("HARD_BLOCKER");
  expect(login.blocker?.kind).toBe("HB1_PERMISSIONS_OR_CREDENTIALS");
  const captcha = researchWaitInterception({ autonomy: "AUTOPILOT", kind: "CAPTCHA", question: "页面出现验证码，需要人工处理" });
  expect(captcha.intercepted).toBe(false);
  expect(captcha.blocker?.kind).toBe("HB1_PERMISSIONS_OR_CREDENTIALS");
  const budget = researchWaitInterception({ autonomy: "AUTOPILOT", kind: "BUDGET", question: "需要付费购买 API 额度才能继续实验" });
  expect(budget.intercepted).toBe(false);
  expect(budget.blocker?.kind).toBe("HB2_IRREVERSIBLE_EXTERNAL_ACTION");
});

it("GUIDED (ASSISTED) runs keep the human gate even for decidable questions", () => {
  const verdict = researchWaitInterception({ autonomy: "GUIDED", kind: "DIRECTION", question: "研究是否继续推进当前阶段？" });
  expect(verdict.intercepted).toBe(false);
  expect(verdict.classification).toBe("DECIDABLE"); // classified, but still raised
});

// ---- supervisor raise-point integration ----

it("requestGuidance auto-decides a decidable AUTOPILOT question: no park, durable decision recorded", () => {
  const dir = root();
  const run = ir("r-auto-decide", "AUTOPILOT");
  const supervisor = supervisorFor(dir);
  supervisor.start(run);
  const outcome = supervisor.requestGuidance({ id: run.id, kind: "DIRECTION", question: "研究是否继续推进当前阶段？" });
  expect(outcome.intercepted).toBe(true);
  expect(outcome.parked).toBe(false);
  expect(outcome.decision?.action).toBe("CONTINUE");
  const record = new ResearchLedger(path.join(dir, "ledger")).load(run.id)!;
  // The run never parked at WAITING_FOR_USER and the auto decision is durable.
  expect(record.ir.state).toBe("SCOPING");
  expect(record.decisions.at(-1)?.decision).toBe("auto-decide:CONTINUE");
});

it("requestGuidance parks on a genuine HARD_BLOCKER (no fabricated answer)", () => {
  const dir = root();
  const run = ir("r-auto-hb", "AUTOPILOT");
  const supervisor = supervisorFor(dir);
  supervisor.start(run);
  const outcome = supervisor.requestGuidance({ id: run.id, kind: "CAPTCHA", question: "登录需要验证码，请人工处理" });
  expect(outcome.intercepted).toBe(false);
  expect(outcome.parked).toBe(true);
  const ledger = new ResearchLedger(path.join(dir, "ledger"));
  expect(ledger.load(run.id)!.ir.state).toBe("WAITING_FOR_USER");
});

it("requestGuidance keeps the legacy human gate for GUIDED runs", () => {
  const dir = root();
  const run = ir("r-guided", "GUIDED");
  const supervisor = supervisorFor(dir);
  supervisor.start(run);
  const outcome = supervisor.requestGuidance({ id: run.id, kind: "DIRECTION", question: "研究是否继续推进当前阶段？" });
  expect(outcome.intercepted).toBe(false);
  expect(outcome.parked).toBe(true);
  const ledger = new ResearchLedger(path.join(dir, "ledger"));
  expect(ledger.load(run.id)!.ir.state).toBe("WAITING_FOR_USER");
});

it("requestGuidance on an unknown run fails closed", () => {
  const supervisor = supervisorFor(root());
  expect(() => supervisor.requestGuidance({ id: "missing", kind: "DIRECTION", question: "x" })).toThrow(/Unknown research run/);
});
