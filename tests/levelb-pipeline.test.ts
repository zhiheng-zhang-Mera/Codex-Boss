import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import { ResearchService } from "../electron/research/research-service";
import { LevelBPipelineExecutor, researchServiceWithPipeline } from "../electron/research/levelb-pipeline-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-levelbpipe-")); dirs.push(dir); return dir; }

function ir(workspace: string): ResearchIR {
  return {
    schemaVersion: 1, id: "pipe1", goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 3, maxSteps: 60 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

async function driveThrough(service: ResearchService, id: string, target: string, guard = 0): Promise<string> {
  let state = service.status(id)!.ir.state;
  for (let attempt = 0; attempt < 30 && guard < 30; attempt++) {
    if (state === target) return state;
    state = (await service.step(id)).state;
  }
  return state;
}

describe("Level-B deterministic pipeline executor (Phase 8→10 offline)", () => {
  it("reaches a deterministic experiment/statistics/adjudication end state with evidence", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const service = researchServiceWithPipeline(path.join(dir, ".boss"), { metricValues: [1, 2, 3, 4, 5], votes: [{ reviewerId: "r1", claimId: "claim:pipeline", stance: "supports" }], requiredVotes: 1 });
    service.start(ir(dir));
    const state = await driveThrough(service, "pipe1", "ANALYSIS");
    expect(["ANALYSIS", "REPLICATION", "CLAIM_REVIEW"]).toContain(state);
    const record = service.status("pipe1")!;
    const decisions = record.decisions.map((decision) => decision.stepId);
    expect(decisions).toContain("EXPERIMENT_EXECUTION");
    const experiment = record.decisions.find((decision) => decision.stepId === "EXPERIMENT_EXECUTION")!;
    expect(experiment.reason).toContain("mean=");
    expect(experiment.evidenceRefs?.some((ref) => ref.startsWith("stat:"))).toBe(true);
  });

  it("honestly flags reviewer-gated stages (no fabricated evidence for RQ/manuscript)", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const service = researchServiceWithPipeline(path.join(dir, ".boss"), { metricValues: [1, 2], votes: [{ reviewerId: "r1", claimId: "claim:pipeline", stance: "supports" }] });
    service.start(ir(dir));
    // LITERATURE_REVIEW is reviewer-gated: its decision reason flags the need.
    await service.step("pipe1"); // SCOPING → PROJECT_INSPECTION
    await service.step("pipe1"); // PROJECT_INSPECTION → LITERATURE_REVIEW
    await service.step("pipe1"); // executes LITERATURE_REVIEW (reviewer-gated) → QUESTION_FORMULATION
    const decision = service.status("pipe1")!.decisions.find((item) => item.stepId === "LITERATURE_REVIEW");
    expect(decision?.reason).toContain("requires web-AI reviewer");
  });
});
