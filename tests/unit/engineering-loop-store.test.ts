import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineeringLoopStore } from "../../electron/engineering/engineering-loop-store";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function file() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eng-")); dirs.push(dir); return path.join(dir, "engineering-loop.json"); }

const goal: EngineeringGoalContract = {
  schemaVersion: 1, id: "eng-1", objective: "harden to production-grade engineering readiness", workspace: "/repo",
  protectedProductBehavior: ["history is never auto-deleted"], allowedChangeScope: ["fix", "refactor", "tests"],
  forbiddenChangeScope: ["product direction"], verificationPolicy: "strict", agentCount: 3,
  convergencePolicy: { cleanRoundsRequired: 3 }, createdAt: new Date(0).toISOString()
};

describe("engineering loop store (plan §26–§41)", () => {
  it("freezes a goal contract once and restores after reload", () => {
    const path = file();
    const store = new EngineeringLoopStore(path);
    store.freezeGoal(goal);
    expect(() => store.freezeGoal({ ...goal, id: "eng-2" })).toThrow(/already frozen/);
    expect(new EngineeringLoopStore(path).goal?.objective).toBe(goal.objective);
  });

  it("appends monotonic iterations and persists them", () => {
    const path = file();
    const store = new EngineeringLoopStore(path);
    store.freezeGoal(goal);
    const first = store.beginIteration();
    expect(first.iteration).toBe(1);
    expect(first.stage).toBe("AUDIT");
    const second = store.beginIteration();
    expect(second.iteration).toBe(2);
    store.updateIteration(1, (record) => { record.stage = "TEST"; record.testsPassed = false; record.reviewFindings.push("flaky test"); });
    expect(new EngineeringLoopStore(path).iterations().find((item) => item.iteration === 1)).toMatchObject({ stage: "TEST", testsPassed: false });
    expect(new EngineeringLoopStore(path).iterations()).toHaveLength(2);
  });

  it("tracks accepted risks and clean-round counts for the convergence gate", () => {
    const store = new EngineeringLoopStore(file());
    store.freezeGoal(goal);
    store.acceptRisk("m1");
    store.acceptRisk("m1");
    store.setCleanRounds(2);
    expect(store.acceptedRisks()).toEqual(["m1"]);
    expect(store.cleanRounds).toBe(2);
    store.setCleanRounds(0);
    expect(store.cleanRounds).toBe(0);
  });

  it("fails closed on corrupt files without rewriting them", () => {
    const path = file();
    fs.writeFileSync(path, "{broken");
    expect(() => new EngineeringLoopStore(path)).toThrow();
    expect(fs.readFileSync(path, "utf8")).toBe("{broken");
  });
});
