import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { classifyWorkerVerdict, workerClaimsGlobalCompletion } from "../../src/shared/worker-response";

/**
 * Phase H (R-801): workers may never declare GLOBAL_COMPLETE — words are
 * advisory; only real acceptance gates (verification plans, council/evidence,
 * real audit/build/test convergence) end tasks. A goal driver run whose
 * "implementer" merely CLAIMS completion must ABORT (and be rolled back), never
 * CONVERGE.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-response-")); dirs.push(dir); return dir; }

it("worker vocabulary has no GLOBAL_COMPLETE terminal status; self-claims downgrade to advisory MODEL_DONE", () => {
  expect(classifyWorkerVerdict("I ran the tests and everything is done — GLOBAL_COMPLETE")).toBe("MODEL_DONE");
  expect(workerClaimsGlobalCompletion("I declare the goal GLOBAL_COMPLETE; no more work")).toBe(true);
  expect(workerClaimsGlobalCompletion("progress report: partial fix landed")).toBe(false);
  expect(classifyWorkerVerdict("cannot proceed without the missing API key")).toBe("BLOCKED");
  expect(classifyWorkerVerdict("should I continue with option B?")).toBe("QUESTION");
});

it("a worker that only CLAIMS completion cannot make a goal CONVERGE — the driver ABORTs (and rolls back)", async () => {
  const dir = root();
  const { EngineeringLoopDriver } = await import("../../electron/engineering/engineering-loop-driver");
  const { EngineeringLoopStore } = await import("../../electron/engineering/engineering-loop-store");
  const { EngineeringGoalContract } = await import("../../src/shared/engineering-loop");
  const loopStore = new EngineeringLoopStore(path.join(dir, "loop.json"));
  const goal: EngineeringGoalContract = {
    schemaVersion: 1,
    id: "eng-claim-complete",
    objective: "fix the failing build",
    workspace: dir,
    protectedProductBehavior: [],
    allowedChangeScope: ["fix"],
    forbiddenChangeScope: ["new feature"],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 1 },
    createdAt: new Date().toISOString()
  };
  loopStore.freezeGoal(goal);
  const driver = new EngineeringLoopDriver({
    store: loopStore,
    maxIterations: 2,
    operations: {
      audit: async () => [{ id: "seed-1", area: "tests", severity: "HIGH", description: "test failure", evidence: "failing assertion" }],
      build: async () => ({ passed: false, evidence: "build still failing" }),
      test: async () => ({ passed: false, evidence: "tests still failing" }),
      // The "worker" merely asserts global completion — no real change, no fix.
      implement: async () => ({ changedFiles: [], error: "I declare the goal GLOBAL_COMPLETE; everything is done" }),
      review: async () => ({ findings: [] })
    }
  });
  const summary = await driver.run();
  expect(summary.state).toBe("ABORTED");
  expect(summary.changedFiles).toEqual([]);
  expect(summary.state).not.toBe("ENGINEERING_CONVERGED");
});
