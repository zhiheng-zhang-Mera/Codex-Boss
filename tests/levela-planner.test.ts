import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExperimentSpec, levelAGate, noveltyReview, validateLevelAPlan, type ProjectSignals } from "../src/shared/research-levela";
import type { CandidateQuestion } from "../src/shared/research-levelb";
import { LevelAPlanner } from "../electron/research/levela-planner";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-levela-")); dirs.push(dir); return dir; }

const signals: ProjectSignals = { files: 100, testFiles: 30, languages: ["typescript", "javascript"], topModules: ["router", "store", "scheduler"] };

function candidate(id: string, overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return { id, question: `Does ${id} improve reproducibility?`, hypothesis: `H ${id}`, measurable: true, falsifiable: true, proposedBy: "reviewer-a", noveltyScore: 2, feasibilityScore: 2, ...overrides };
}

describe("Level-A novelty/feasibility + gate (Phase 12)", () => {
  it("reviews novelty against repo signal overlap and gates low scores", () => {
    const review = noveltyReview(candidate("decision-rule"), signals);
    expect(review.noveltyScore).toBeGreaterThanOrEqual(0);
    expect(review.feasibilityScore).toBeGreaterThanOrEqual(2);
    expect(levelAGate(review).ok).toBe(true);
    const blocked = levelAGate({ claimId: "x", noveltyScore: 1, feasibilityScore: 3, reasons: [] });
    expect(blocked.ok).toBe(false);
  });

  it("drafts a replicable primary experiment spec and validates plans", () => {
    const spec = buildExperimentSpec({ id: "exp-q1", primaryMetric: "effect-size" });
    expect(spec.replicationRuns).toBeGreaterThanOrEqual(2);
    expect(() => validateLevelAPlan({ selectedQuestion: candidate("q"), hypothesis: "h", novelty: { claimId: "q", noveltyScore: 3, feasibilityScore: 3, reasons: [] }, experiment: spec })).not.toThrow();
    expect(() => validateLevelAPlan({ selectedQuestion: candidate("q"), hypothesis: "", novelty: { claimId: "q", noveltyScore: 3, feasibilityScore: 3, reasons: [] }, experiment: spec })).toThrow();
    const bad = { ...spec, replicationRuns: 1 };
    expect(() => validateLevelAPlan({ selectedQuestion: candidate("q"), hypothesis: "h", novelty: { claimId: "q", noveltyScore: 3, feasibilityScore: 3, reasons: [] }, experiment: bad })).toThrow();
  });
});

describe("Level-A planner (Phase 12 electron)", () => {
  it("plans from a real repo + web-AI proposals end to end", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(dir, "src", "a.test.ts"), "import {it} from 'vitest'; it('a', () => {});");
    const planner = new LevelAPlanner({
      primaryMetric: "rate",
      async propose(goal) {
        return [candidate("q-evidence", { question: `Does ${goal} improve evidence use?`, noveltyScore: 4, feasibilityScore: 4 }), candidate("q-none", { measurable: false })];
      }
    });
    const plan = await planner.plan("multi-agent decision quality", dir);
    expect(plan.selectedQuestion.id).toBe("q-evidence");
    expect(plan.experiment.replicationRuns).toBeGreaterThanOrEqual(2);
    expect(plan.hypothesis.startsWith("H:")).toBe(true);
  });

  it("rejects when nothing passes the falsifiable or novelty gate", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const planner = new LevelAPlanner({ async propose() { return [candidate("q-low", { noveltyScore: 0, feasibilityScore: 0 })]; } });
    await expect(planner.plan("goal", dir)).rejects.toThrow(/novelty|falsifiable/);
  });
});
