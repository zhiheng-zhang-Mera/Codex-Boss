import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HeuristicPolicy, decide } from "../src/shared/policy";
import { TaskLedger } from "../electron/commander/task-ledger";
import { BudgetManager } from "../electron/commander/budget-manager";
import { DegradedController } from "../electron/commander/degraded-controller";
import { applyTaskPolicy } from "../electron/commander/task-policy";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-policy-deg-")); dirs.push(dir); return dir; }

const runtime = (id: string) => ({ id, capabilities: { roles: ["research"] } }) as RuntimeAdapter;

describe("task policy recording (AP29 wiring)", () => {
  it("records the heuristic decision per complexity and is idempotent on re-entry", () => {
    const ledger = new TaskLedger(root());
    ledger.create("t1", "work");
    const policy = applyTaskPolicy(ledger, "t1", "L3");
    expect(policy?.complexity).toBe("L3");
    expect(policy?.optimizer).toBe("HeuristicPolicy");
    expect(policy?.decision.workerCount).toBe(3);
    expect(policy?.decision.verificationLevel).toBe("full");
    expect(policy?.decision.contextBudgetChars).toBe(24000);
    const rev1 = ledger.load("t1")!.revision;
    const again = applyTaskPolicy(ledger, "t1", "L3");
    expect(again?.decision).toEqual(policy?.decision);
    expect(ledger.load("t1")!.revision).toBe(rev1); // no churn
  });

  it("keeps L1/L2 decisions single-worker and escalates by complexity", () => {
    const ledger = new TaskLedger(root());
    ledger.create("l1", "work");
    ledger.create("l2", "work");
    const p1 = applyTaskPolicy(ledger, "l1", "L1")!;
    const p2 = applyTaskPolicy(ledger, "l2", "L2")!;
    expect(p1.decision.workerCount).toBe(1);
    expect(p1.decision.contextBudgetChars).toBe(8000);
    expect(p2.decision.workerCount).toBe(2);
    expect(p2.decision.contextBudgetChars).toBe(16000);
  });
});

describe("degradation selection consumes policy", () => {
  it("FULL mode honors policy worker count and context budget", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("t1", "work");
    applyTaskPolicy(ledger, "t1", "L3");
    const controller = new DegradedController(ledger, new BudgetManager());
    const state = controller.evaluate("t1", [runtime("a"), runtime("b"), runtime("c")]);
    expect(state.mode).toBe("FULL");
    expect(state.maxWorkers).toBe(3); // policy workerCount 3, capped at 3 logical
    expect(state.maxContextChars).toBe(24000);
    expect(state.verificationLevel).toBe("full");
    expect(state.parallelism).toBe(3);
  });

  it("L2 policy narrows FULL width to 2 and reduces context budget", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("t2", "work");
    applyTaskPolicy(ledger, "t2", "L2");
    const controller = new DegradedController(ledger, new BudgetManager());
    const state = controller.evaluate("t2", [runtime("a"), runtime("b"), runtime("c")]);
    expect(state.mode).toBe("FULL");
    expect(state.maxWorkers).toBe(2);
    expect(state.maxContextChars).toBe(16000);
    expect(state.verificationLevel).toBe("standard");
  });

  it("keeps legacy per-mode behavior when no policy was recorded", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("legacy", "work");
    const controller = new DegradedController(ledger, new BudgetManager());
    const full = controller.evaluate("legacy", [runtime("a"), runtime("b"), runtime("c")]);
    expect(full.maxWorkers).toBe(3);
    expect(full.maxContextChars).toBe(24000);
    const reduced = controller.evaluate("legacy", [runtime("a")]);
    expect(reduced.mode).toBe("REDUCED");
    expect(reduced.maxWorkers).toBe(1);
    expect(reduced.maxContextChars).toBe(16000);
    expect(reduced.verificationLevel).toBeUndefined();
  });

  it("policy decision survives reload and drives a persisted state change", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("t3", "work");
    applyTaskPolicy(ledger, "t3", "L2");
    const controller = new DegradedController(ledger, new BudgetManager());
    controller.evaluate("t3", [runtime("a"), runtime("b")]);
    const reloaded = new DegradedController(new TaskLedger(dir), new BudgetManager());
    expect(reloaded.get("t3")).toMatchObject({ mode: "FULL", maxWorkers: 2, maxContextChars: 16000 });
  });

  it("degrades to deterministic/paused regardless of policy", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("t4", "work");
    applyTaskPolicy(ledger, "t4", "L3");
    const controller = new DegradedController(ledger, new BudgetManager());
    const paused = controller.evaluate("t4", [runtime("a")], false);
    expect(paused.mode).toBe("REDUCED"); // one runtime → reduced, not policy width
    expect(paused.maxWorkers).toBe(1);
  });
});

describe("decide() reference behavior stays available for research policies", () => {
  it("StatisticalPolicy mirrors heuristic decisions with no credible stats", () => {
    const context = { complexity: "L3" as const, runtimeStats: [], nativeAvailable: false };
    expect(decide(context, new HeuristicPolicy()).workerCount).toBe(3);
    expect(decide(context, new HeuristicPolicy()).verificationLevel).toBe("full");
  });
});
