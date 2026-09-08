import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineeringLoopStore } from "../electron/engineering/engineering-loop-store";
import { summarizeEngineeringLoop, type EngineeringGoalContract, type EngineeringIterationRecord } from "../src/shared/engineering-loop";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function file() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eng-status-")); dirs.push(dir); return path.join(dir, "engineering-loop.json"); }

const goal: EngineeringGoalContract = {
  schemaVersion: 1, id: "g-1", objective: "make it green", workspace: "/repo",
  protectedProductBehavior: [], allowedChangeScope: ["fix"], forbiddenChangeScope: [],
  verificationPolicy: "standard", agentCount: 3, convergencePolicy: { cleanRoundsRequired: 2 },
  createdAt: new Date(0).toISOString()
};

function iteration(iteration: number, overrides: Partial<EngineeringIterationRecord> = {}): EngineeringIterationRecord {
  return {
    schemaVersion: 1, goalId: "g-1", iteration, stage: "AUDIT", findings: [], changedFiles: [],
    reviewFindings: [], remainingRisk: "", status: "RUNNING", startedAt: "t", updatedAt: "t", ...overrides
  };
}

describe("engineering goal status read-model (plan §26–§41 start surface)", () => {
  it("summarizes an empty ledger deterministically", () => {
    const snapshot = summarizeEngineeringLoop({ iterations: [] });
    expect(snapshot).toMatchObject({ iterations: 0, cleanRounds: 0, cleanRoundsRequired: 1, acceptedRiskCount: 0, changedFiles: [], openFindings: [], settled: false });
    expect(snapshot.goalId).toBeUndefined();
  });

  it("aggregates iterations, changed files and open findings from the newest round", () => {
    const high: EngineeringIterationRecord["findings"][number] = { id: "cmd:test", area: "tests", severity: "HIGH", description: "test failure" };
    const low: EngineeringIterationRecord["findings"][number] = { id: "cmd:lint", area: "style", severity: "LOW", description: "cosmetic" };
    const snapshot = summarizeEngineeringLoop({
      goal,
      iterations: [
        iteration(1, { changedFiles: ["a.ts"], findings: [high], remainingRisk: "build=FAIL" }),
        iteration(2, { changedFiles: ["a.ts", "b.ts"], status: "ABORTED", remainingRisk: "no editor", findings: [high, low] })
      ],
      acceptedRisks: ["cmd:test"],
      cleanRounds: 1
    });
    expect(snapshot.goalId).toBe("g-1");
    expect(snapshot.agentCount).toBe(3);
    expect(snapshot.iterations).toBe(2);
    expect(snapshot.cleanRounds).toBe(1);
    expect(snapshot.cleanRoundsRequired).toBe(2);
    expect(snapshot.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(snapshot.lastStatus).toBe("ABORTED");
    expect(snapshot.lastRisk).toBe("no editor");
    expect(snapshot.openFindings.map((item) => item.id)).toEqual(["cmd:lint"]); // accepted risk excluded
    expect(snapshot.settled).toBe(false);
  });

  it("marks converged/optional goals settled", () => {
    expect(summarizeEngineeringLoop({ goal, iterations: [iteration(1, { status: "CONVERGED", remainingRisk: "converged" })] }).settled).toBe(true);
    expect(summarizeEngineeringLoop({ goal, iterations: [iteration(1, { status: "OPTIONAL_IMPROVEMENTS" })] }).settled).toBe(true);
    expect(summarizeEngineeringLoop({ goal, iterations: [iteration(1, { status: "STAGNANT" })] }).settled).toBe(false);
  });

  it("store.status() reads the durable file without touching the driver", () => {
    const storeFile = file();
    const store = new EngineeringLoopStore(storeFile);
    expect(store.status().iterations).toBe(0);
    store.freezeGoal(goal);
    const first = store.beginIteration();
    store.updateIteration(first.iteration, (item) => { item.findings = [{ id: "x", area: "tests", severity: "HIGH", description: "boom" }]; item.remainingRisk = "build=FAIL"; item.stage = "VERIFY"; });
    const snapshot = store.status();
    expect(snapshot.goalId).toBe("g-1");
    expect(snapshot.iterations).toBe(1);
    expect(snapshot.lastStage).toBe("VERIFY");
    expect(snapshot.openFindings.map((item) => item.id)).toEqual(["x"]);
    // Reload from disk reproduces the same snapshot (durable read-model).
    expect(new EngineeringLoopStore(storeFile).status()).toEqual(snapshot);
  });
});
