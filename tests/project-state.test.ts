import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStateStore } from "../electron/project/project-state";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-project-")); dirs.push(dir); return dir; }

describe("project state + research ledger", () => {
  it("loads an empty state for a new workspace and persists updates", () => {
    const file = path.join(root(), "state.json");
    const store = new ProjectStateStore(file);
    expect(store.load("ws1").goals).toEqual([]);
    store.setOpenQuestions("ws1", ["q1", "q2"]);
    const loaded = store.load("ws1");
    expect(loaded.openQuestions).toEqual(["q1", "q2"]);
    expect(loaded.workspaceId).toBe("ws1");
    expect(new ProjectStateStore(file).load("ws1").openQuestions).toEqual(["q1", "q2"]); // persisted
  });

  it("isolates project state per workspace", () => {
    const store = new ProjectStateStore(path.join(root(), "state.json"));
    store.setOpenQuestions("ws1", ["q1"]);
    expect(store.load("ws2").openQuestions).toEqual([]);
    expect(store.load("ws1").openQuestions).toEqual(["q1"]);
  });

  it("appends accepted/rejected decisions and research ledger entries", () => {
    const store = new ProjectStateStore(path.join(root(), "state.json"));
    store.appendDecision("ws1", { decision: "adopt worktree isolation", outcome: "accepted", reason: "parallel scopes", evidenceRefs: ["evidence:1"] });
    store.appendDecision("ws1", { decision: "auto-merge model branches", outcome: "rejected", reason: "not accepted", evidenceRefs: [] });
    const research = store.appendResearch("ws1", { question: "does UIA work headless", findings: "no", changedDecisionIds: [] });
    const state = store.load("ws1");
    expect(state.decisions.map((item) => item.outcome)).toEqual(["accepted", "rejected"]);
    expect(state.research).toHaveLength(1);
    expect(state.research[0].question).toBe("does UIA work headless");
    expect(research.id).toBe(state.research[0].id);
  });

  it("fails closed on a corrupt file and keeps the workspace id consistent", () => {
    const file = path.join(root(), "state.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new ProjectStateStore(file).load("ws1")).toThrow(/Invalid/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, state: { workspaceId: "other", goals: [], decisions: [], constraints: [], openQuestions: [], nextActions: [], research: [], updatedAt: "x" } }));
    expect(new ProjectStateStore(file).load("ws1").goals).toEqual([]); // workspace mismatch = empty
  });
});
