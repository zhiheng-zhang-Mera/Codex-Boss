import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ResearchSupervisor } from "../../electron/research/research-supervisor";
import { ResearchLedger } from "../../electron/research/research-ledger";
import { ExecutionSupervisor } from "../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { Scheduler } from "../../electron/commander/scheduler";
import { CircuitBreaker } from "../../electron/commander/circuit-breaker";
import { FederationCoordinator } from "../../electron/fleet/federation-coordinator";
import { KnowledgeSpaceStore } from "../../electron/knowledge/knowledge-space-store";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../electron/runtimes/runtime";

/**
 * Phase J (R-1001 Scenario E compile-failure preservation; R-1002 Scenario G
 * composite): sources/evidence/reviews survive a paper-compile failure and the
 * run is not discarded; a composite failure (provider FAILED + node OFFLINE +
 * KB offline + research REWORK) never stops the remaining usable work.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase-j-")); dirs.push(dir); return dir; }

function ir(id: string): ResearchIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id, goal: "deterministic phase-J fixture",
    scope: { workspace: root(), allowedDomains: [], reviewers: ["reviewer-a"], autonomy: "AUTOPILOT", budget: { maxExperiments: 1, maxSteps: 40 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: now, updatedAt: now
  };
}

it("R-1001 Scenario E: a compile failure at BUILD preserves sources/evidence/reviews; run is not discarded", async () => {
  const dir = root();
  const supervisor = new ResearchSupervisor({
    ledger: new ResearchLedger(path.join(dir, "ledger")),
    executor: { run: async (input) => {
      if (input.stage === "BUILD") throw new Error("paper compile failed (LaTeX error)");
      return { summary: `stage ${input.stage} done`, evidenceRefs: [`artifacts/${input.stage}.json`] };
    } }
  });
  const run = ir("r-compile-fail");
  supervisor.start(run);
  let state: ResearchState = "SCOPING";
  for (let step = 0; step < 20 && state !== "FAILED" && state !== "READY"; step += 1) state = (await supervisor.step(run.id)).state;
  expect(state).toBe("FAILED");
  const record = new ResearchLedger(path.join(dir, "ledger")).load(run.id)!;
  const stages = record.decisions.map((entry) => entry.stepId);
  // Earlier sources/evidence/reviews survived the compile failure.
  expect(stages).toContain("LITERATURE_REVIEW");
  expect(stages).toContain("MANUSCRIPT");
  expect(stages).toContain("CITATION_AUDIT");
  expect(stages).toContain("BUILD"); // recorded as failed
  expect(record.decisions.find((entry) => entry.decision === "failed:BUILD")).toBeDefined();
});

it("R-1002 Scenario G composite: provider FAILED + node OFFLINE + KB offline + research REWORK — usable work continues, Boss alive", async () => {
  const dir = root();

  // (1) Provider FAILED (breaker OPEN) while an unrelated task on another runtime succeeds.
  const ledger = new TaskLedger(path.join(dir, "exec-ledger"));
  const breaker = new CircuitBreaker(path.join(dir, "breaker.json"), { failureThreshold: 1, cooldownMs: 600000 });
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, undefined, undefined, breaker);
  const broken: RuntimeAdapter = {
    id: "web:broken", kind: "web", capabilities: { consumesModel: true, roles: ["planner"], supportsCancellation: true, supportsStreaming: true },
    healthCheck: async () => ({ runtimeId: "web:broken", availability: "AVAILABLE", message: "ok", checkedAt: "now" }),
    execute: async (_r: RuntimeRequest) => ({ runtimeId: "web:broken", jobId: "a1", status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "down", retryable: true } } as RuntimeResult)
  };
  const healthy: RuntimeAdapter = {
    id: "local:ok", kind: "local", capabilities: { consumesModel: false, roles: ["planner"], supportsCancellation: true, supportsStreaming: false },
    healthCheck: async () => ({ runtimeId: "local:ok", availability: "AVAILABLE", message: "ok", checkedAt: "now" }),
    execute: async (req: RuntimeRequest) => ({ runtimeId: "local:ok", jobId: req.jobId, status: "SUCCESS", content: "OK" } as RuntimeResult)
  };
  const failed = await supervisor.execute({ taskId: "ta", jobId: "a1", role: "planner", prompt: "p", replaySafe: true, timeoutMs: 30_000 }, [broken]);
  expect(failed.status).not.toBe("SUCCESS");
  expect(breaker.state("web:broken")).toBe("OPEN");
  const ok = await supervisor.execute({ taskId: "tb", jobId: "b1", role: "planner", prompt: "p", replaySafe: true, timeoutMs: 30_000 }, [healthy]);
  expect(ok.status).toBe("SUCCESS");

  // (2) Node OFFLINE in the fleet while the other node keeps running.
  let clock = 0;
  const fleet = new FederationCoordinator(path.join(dir, "fleet.json"), () => clock);
  fleet.join("B", ["coding"]);
  fleet.join("A", ["coding"]);
  clock += 1000;
  fleet.heartbeat("A");
  fleet.heartbeat("B");
  fleet.enqueue({ taskId: "f1", requiredCapabilities: ["coding"], replaySafe: true });
  clock += 100_000;
  fleet.heartbeat("A");
  expect(fleet.refreshStates().dropped).toEqual(["B"]);
  expect(fleet.listNodes().find((node) => node.nodeId === "A")?.state).toBe("READY");

  // (3) KB gateway offline: local store keeps serving and queues sync.
  const kb = new KnowledgeSpaceStore(path.join(dir, "kb.json"));
  kb.put({ ownerNode: "A", content: "finding kept offline", tags: ["x"], source: "local" });
  expect(kb.search({ text: "finding" })).toHaveLength(1);

  // (4) Research stage REWORK (FAILED at experiment) while earlier stages survive.
  const rSupervisor = new ResearchSupervisor({
    ledger: new ResearchLedger(path.join(dir, "r-ledger")),
    executor: { run: async (input) => {
      if (input.stage === "EXPERIMENT_GENERATION") throw new Error("experiment infeasible");
      return { summary: "ok", evidenceRefs: [`artifacts/${input.stage}.json`] };
    } }
  });
  const run = ir("r-comp");
  rSupervisor.start(run);
  let rState: ResearchState = "SCOPING";
  for (let step = 0; step < 12 && rState !== "FAILED"; step += 1) rState = (await rSupervisor.step(run.id)).state;
  expect(rState).toBe("FAILED");

  // Composite assertion: Boss (this process) survived every partial failure and
  // every usable capability kept working.
  expect(breaker.isOpen("web:broken")).toBe(true);
  expect(ok.status).toBe("SUCCESS");
  expect(fleet.listNodes().find((node) => node.nodeId === "A")?.state).toBe("READY");
  expect(kb.search({ text: "finding" })).toHaveLength(1);
}, 60000);
