import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ResearchSupervisor, type ResearchStageExecutor, type StageOutcome } from "../../electron/research/research-supervisor";
import { ResearchLedger } from "../../electron/research/research-ledger";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";

/**
 * §38 Scenario D — Research partial failure. Stages are independent task units:
 * earlier work (RP/literature/method) must survive an experiment-stage failure
 * as durable decisions + evidenceRefs; the run ends FAILED with the failed
 * stage recorded — never wiped, never fake-READY, always readable afterwards.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-research-partial-")); dirs.push(dir); return dir; }

function ir(id: string): ResearchIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    goal: "deterministic partial-failure fixture goal",
    scope: { workspace: root(), allowedDomains: [], reviewers: ["reviewer-a"], autonomy: "AUTOPILOT", budget: { maxExperiments: 1, maxSteps: 30 } },
    state: "SCOPING",
    researchQuestions: [],
    hypotheses: [],
    createdAt: now,
    updatedAt: now
  };
}

/** Executor that succeeds through the literature/method stages and then fails closed at experiment generation. */
function executorFailingAt(failStage: ResearchState): ResearchStageExecutor {
  return {
    run: async (input): Promise<StageOutcome> => {
      if (input.stage === failStage) throw new Error("experiment could not be generated: design infeasible under frozen protocol");
      return { summary: `stage ${input.stage} completed deterministically`, evidenceRefs: [`artifacts/${input.stage}.json`] };
    }
  };
}

function supervisorFor(dir: string, executor: ResearchStageExecutor): ResearchSupervisor {
  return new ResearchSupervisor({ ledger: new ResearchLedger(path.join(dir, "ledger")), executor });
}

it("Scenario D: an experiment-stage failure preserves earlier RP/literature/method stages and ends FAILED — never READY, never wiped", async () => {
  const dir = root();
  const run = ir("r-partial-fail");
  const supervisor = supervisorFor(dir, executorFailingAt("EXPERIMENT_GENERATION"));
  supervisor.start(run);

  let state: ResearchState = "SCOPING";
  for (let stepCount = 0; stepCount < 12; stepCount += 1) {
    const result = await supervisor.step(run.id);
    state = result.state;
    if (state === "FAILED" || state === "READY") break;
  }
  expect(state).toBe("FAILED"); // honest terminal: never READY after a real stage failure

  const record = new ResearchLedger(path.join(dir, "ledger")).load(run.id)!;
  expect(record.ir.state).toBe("FAILED");
  expect(record.ir.goal).toBe("deterministic partial-failure fixture goal"); // goal/RP preserved

  const decisions = record.decisions.map((entry) => entry.stepId);
  // Earlier stages were recorded as PASS decisions (RP / literature / method…).
  for (const preserved of ["SCOPING", "PROJECT_INSPECTION", "LITERATURE_REVIEW", "QUESTION_FORMULATION", "PROTOCOL_DRAFT", "PROTOCOL_FROZEN"]) {
    expect(decisions).toContain(preserved);
  }
  // Evidence refs of the preserved stages survived.
  const literature = record.decisions.find((entry) => entry.stepId === "LITERATURE_REVIEW");
  expect(literature?.evidenceRefs).toContain("artifacts/LITERATURE_REVIEW.json");
  // The failed stage is recorded as failed:<stage>, never as a passing decision.
  const failed = record.decisions.find((entry) => entry.decision === "failed:EXPERIMENT_GENERATION");
  expect(failed).toBeDefined();
  expect(failed?.reason).toContain("experiment could not be generated");
  // The run stays readable and intact (no wipe, durable across reopen).
  const reopened = new ResearchLedger(path.join(dir, "ledger")).load(run.id)!;
  expect(reopened.decisions.length).toBe(record.decisions.length);
  expect(reopened.ir.state).toBe("FAILED");
});

it("Scenario D control: an all-green run reaches the next honest state and its decisions stay recorded", async () => {
  const dir = root();
  const run = ir("r-all-green");
  const supervisor = supervisorFor(dir, {
    run: async (input) => ({ summary: `stage ${input.stage} ok`, evidenceRefs: [`artifacts/${input.stage}.json`] })
  });
  supervisor.start(run);
  const first = await supervisor.step(run.id);
  expect(first.state).toBe("PROJECT_INSPECTION");
  const record = new ResearchLedger(path.join(dir, "ledger")).load(run.id)!;
  expect(record.decisions.at(-1)?.stepId).toBe("SCOPING");
  expect(record.decisions.at(-1)?.decision).toBe("scoping");
});
