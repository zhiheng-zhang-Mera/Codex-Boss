import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DegradedController } from "../../electron/commander/degraded-controller";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { applyTaskPolicy } from "../../electron/commander/task-policy";
import type { RuntimeAdapter } from "../../electron/runtimes/runtime";

/**
 * §0.4 / §11 / §29 — capability degradation over the REAL DegradedController +
 * durable TaskLedger + BudgetManager. The module state machine (FULL / REDUCED /
 * LIGHTWEIGHT / DETERMINISTIC / PAUSED), per-tier worker/context caps, the
 * budget-exhaustion fail-closed paths and the policy-chosen parallelism are
 * asserted on the DURABLE ledger record — scheduler/UI read from this state.
 */

let dir: string;

function runtime(id: string): RuntimeAdapter {
  return { id, kind: "web" } as RuntimeAdapter;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "degraded-battery-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function controller(taskId: string): { ledger: TaskLedger; budgets: BudgetManager; degraded: DegradedController } {
  const ledger = new TaskLedger(path.join(dir, "ledger"));
  ledger.create(taskId, "degraded battery objective");
  const budgets = new BudgetManager();
  return { ledger, budgets, degraded: new DegradedController(ledger, budgets) };
}

it("two eligible runtimes ⇒ FULL mode with both in the pool and a durable record", () => {
  const { ledger, degraded } = controller("t-full");
  const state = degraded.evaluate("t-full", [runtime("web:a"), runtime("web:b")]);
  expect(state.mode).toBe("FULL");
  expect(state.runtimeIds).toEqual(["web:a", "web:b"]);
  expect(state.maxWorkers).toBeGreaterThanOrEqual(1);
  expect(ledger.load("t-full")!.degradation?.mode).toBe("FULL"); // persisted for scheduler/UI
});

it("a single eligible runtime ⇒ REDUCED with the tighter context cap", () => {
  const { degraded } = controller("t-reduced");
  const state = degraded.evaluate("t-reduced", [runtime("web:a")]);
  expect(state.mode).toBe("REDUCED");
  expect(state.maxWorkers).toBe(1);
  expect(state.maxContextChars).toBe(16000);
});

it("all-eligible runtimes LOW ⇒ LIGHTWEIGHT (limited-observation degradation)", () => {
  const { budgets, degraded } = controller("t-light");
  budgets.update("web:a", "LOW", "OBSERVED");
  budgets.update("web:b", "LOW", "OBSERVED");
  const state = degraded.evaluate("t-light", [runtime("web:a"), runtime("web:b")]);
  expect(state.mode).toBe("LIGHTWEIGHT");
  expect(state.maxContextChars).toBe(8000);
});

it("budget exhausted ⇒ DETERMINISTIC with native tools, PAUSED without (fail-closed, never FULL)", () => {
  const { ledger, degraded } = controller("t-exhausted");
  ledger.update("t-exhausted", "spend the whole model-call budget", (record) => { record.usage.modelCalls = record.limits.modelCalls; });
  const native = degraded.evaluate("t-exhausted", [runtime("web:a")], true);
  expect(native.mode).toBe("DETERMINISTIC");
  const paused = degraded.evaluate("t-exhausted", [runtime("web:a")], false);
  expect(paused.mode).toBe("PAUSED");
});

it("evaluate is idempotent on unchanged inputs (no state churn) and the recorded policy is honored under FULL", () => {
  const { ledger, budgets, degraded } = controller("t-policy");
  applyTaskPolicy(ledger, "t-policy", "L2");
  const first = degraded.evaluate("t-policy", [runtime("web:a"), runtime("web:b"), runtime("web:c")]);
  const second = degraded.evaluate("t-policy", [runtime("web:a"), runtime("web:b"), runtime("web:c")]);
  expect(first.mode).toBe("FULL");
  // Identical inputs → identical degradation state (only the timestamp stamp advances).
  expect({ ...second, updatedAt: first.updatedAt }).toEqual(first);
  const record = ledger.load("t-policy")!;
  expect(record.policy?.complexity).toBe("L2");
  expect(record.degradation?.mode).toBe("FULL");
  expect(budgets.eligible("web:a")).toBe(true); // LOW remains eligible (only EXHAUSTED is excluded)
});
