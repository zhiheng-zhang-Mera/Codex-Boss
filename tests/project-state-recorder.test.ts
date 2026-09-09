import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStateStore } from "../electron/project/project-state";
import { recordTaskCompletion } from "../electron/project/task-completion-recorder";
import { buildGoalTree } from "../src/shared/project-tree";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-project-")); dirs.push(dir); return dir; }

describe("goal tree view model (AP15)", () => {
  it("builds a tree from flat goals with status counts and rejects cycles/duplicates", () => {
    const tree = buildGoalTree([
      { id: "root", title: "Research", status: "active" },
      { id: "child", title: "Experiment", parent: "root", status: "done" },
      { id: "other", title: "Abandoned", parent: "root", status: "abandoned" }
    ]);
    expect(tree.valid).toBe(true);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].children).toHaveLength(2);
    expect(tree.counts).toEqual({ total: 3, open: 0, active: 1, done: 1, abandoned: 1 });
    expect(tree.roots[0].depth).toBe(0);
    expect(tree.roots[0].children[0].depth).toBe(1);

    const dup = buildGoalTree([{ id: "a", title: "a", status: "open" }, { id: "a", title: "a2", status: "open" }]);
    expect(dup.valid).toBe(false);

    const cycle = buildGoalTree([{ id: "a", title: "a", parent: "b", status: "open" }, { id: "b", title: "b", parent: "a", status: "open" }]);
    expect(cycle.valid).toBe(false);

    const orphan = buildGoalTree([{ id: "a", title: "a", parent: "nope", status: "open" }]);
    expect(orphan.valid).toBe(false);
  });
});

describe("project state store goal + completion recording", () => {
  it("upserts goals and records task completion into decisions/research/next actions", () => {
    const file = path.join(root(), "project.json");
    const store = new ProjectStateStore(file);
    store.upsertGoal("ws1", { id: "g1", title: "Make Codex Boss faster", status: "open" });
    store.setGoalStatus("ws1", "g1", "active");

    const result = recordTaskCompletion(store, {
      workspaceId: "ws1",
      task: { id: "t1", title: "Make Codex Boss faster", prompt: "optimize routing" },
      findings: "Removed redundant refresh; benchmark improved.",
      goalId: "g1",
      nextActions: ["run full suite", "package portable build"]
    });
    expect(result.goalDone).toBe(true);
    const state = store.load("ws1");
    expect(state.goals.find((goal) => goal.id === "g1")?.status).toBe("done");
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0].evidenceRefs).toContain("t1");
    expect(state.research).toHaveLength(1);
    expect(state.research[0].changedDecisionIds).toEqual([result.decisionId]);
    expect(state.nextActions).toEqual(expect.arrayContaining(["run full suite", "package portable build"]));
    // summary projection for the renderer goal-tree UI
    const summary = store.summary("ws1");
    expect(summary.decisionCount).toBe(1);
    expect(summary.researchCount).toBe(1);
    expect(summary.goals).toHaveLength(1);
    expect(summary.nextActions).toHaveLength(2);
  });

  it("fails closed on unknown workspace and unknown goal status", () => {
    const file = path.join(root(), "project.json");
    const store = new ProjectStateStore(file);
    expect(store.load("missing").goals).toEqual([]);
    store.upsertGoal("ws1", { id: "g1", title: "Goal" });
    expect(() => store.setGoalStatus("ws1", "ghost", "done")).toThrow(/Unknown goal/);
    expect(() => store.upsertGoal("ws1", { id: "g2", title: "Bad", status: "wonky" as never })).not.toThrow();
  });
});
