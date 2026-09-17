import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetManager } from "../../electron/commander/budget-manager";

/**
 * PF-DEBT-006 — a hot-path predicate must not write to disk, and the expiry must still happen.
 *
 * `eligible()` called `update()` when a reset window had passed, and `update()` writes the whole
 * budget file. So asking "may I dispatch to this runtime?" — a question the scheduler and the
 * execution supervisor ask per candidate — could write to disk, and a write failure would escape from
 * a method its callers treat as pure.
 *
 * The fix separates the two things that were fused: the expiry DECISION is unchanged, but it is
 * applied by `reconcile()` and the predicate is pure. These tests pin down both halves, because a fix
 * that only silenced the write — by never expiring — would pass a "no writes" test while breaking the
 * behaviour the write existed for.
 */

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-budget-predicate-"));
  file = path.join(dir, "runtime-budget.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The manager's persisted state, or undefined when the file has never been written. */
function persisted(): Array<{ runtimeId: string; state: string }> | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ runtimeId: string; state: string }>;
}

/** A manager holding an EXHAUSTED runtime whose reset window closed one minute ago. */
function expiredBudget(): BudgetManager {
  const budgets = new BudgetManager(file);
  budgets.update("api:deepseek", "EXHAUSTED", "RATE_LIMIT_SIGNAL", new Date(Date.now() - 60_000).toISOString());
  return budgets;
}

describe("Phase 06 — the budget predicate is pure and the expiry still happens", () => {
  it("asks the same question repeatedly without writing to disk", () => {
    const budgets = expiredBudget();
    const afterSetup = fs.readFileSync(file, "utf8");
    const before = fs.statSync(file).mtimeMs;

    // The predicate is called on the dispatch hot path. It must be safe to call it as often as the
    // scheduler likes.
    for (let index = 0; index < 50; index++) budgets.eligible("api:deepseek");

    expect(fs.readFileSync(file, "utf8")).toBe(afterSetup);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("still releases the runtime once its reset window has passed, via reconcile", () => {
    // The behaviour the side effect existed for. Losing it would be the worse bug.
    const budgets = expiredBudget();
    expect(budgets.get("api:deepseek").state).toBe("EXHAUSTED");

    expect(budgets.reconcile()).toEqual(["api:deepseek"]);
    expect(budgets.get("api:deepseek").state).toBe("UNKNOWN");
    expect(budgets.eligible("api:deepseek")).toBe(true);
  });

  it("reports the transition rather than performing it invisibly inside a question", () => {
    // A caller can now record WHY a runtime became eligible again. Before, the transition happened
    // inside `eligible()` and nothing could observe it.
    const budgets = expiredBudget();
    expect(budgets.reconcile()).toEqual(["api:deepseek"]);
    // Idempotent: a second reconciliation has nothing left to release.
    expect(budgets.reconcile()).toEqual([]);
  });

  it("does not release a runtime whose reset window is still open", () => {
    const budgets = new BudgetManager(file);
    budgets.update("api:deepseek", "EXHAUSTED", "RATE_LIMIT_SIGNAL", new Date(Date.now() + 600_000).toISOString());
    expect(budgets.reconcile()).toEqual([]);
    expect(budgets.get("api:deepseek").state).toBe("EXHAUSTED");
    expect(budgets.eligible("api:deepseek")).toBe(false);
  });

  it("leaves a state with no reset window alone", () => {
    // EXHAUSTED with no reset forecast is a verdict, not a forecast: it must not expire by itself.
    const budgets = new BudgetManager(file);
    budgets.update("api:qwen", "EXHAUSTED", "OBSERVED");
    expect(budgets.reconcile()).toEqual([]);
    expect(budgets.eligible("api:qwen")).toBe(false);
  });

  it("keeps the predicate correct for a state that was never observed", () => {
    // An unknown runtime is eligible: not knowing a budget is not the same as knowing it is spent.
    const budgets = new BudgetManager(file);
    expect(budgets.eligible("api:never-seen")).toBe(true);
  });

  it("does not reconcile in the constructor, so constructing is not a transition", () => {
    // A manager rebuilt from disk must report what was stored until a caller asks it to reconcile;
    // otherwise a restart would silently forgive every exhausted budget.
    expiredBudget();
    const reopened = new BudgetManager(file);
    expect(reopened.get("api:deepseek").state).toBe("EXHAUSTED");
    expect(reopened.eligible("api:deepseek")).toBe(false);
  });

  it("persists an OBSERVED transition, because a clock tick is not an observation", () => {
    // The durability contract is unchanged: observed transitions persist. Reconciliation is derived
    // from the clock and is recomputed, so it does not add a write — but it must not have removed the
    // writes that ARE the record.
    const budgets = expiredBudget();
    budgets.reconcile();
    expect(persisted()?.find((entry) => entry.runtimeId === "api:deepseek")?.state).toBe("EXHAUSTED");

    budgets.observeSuccess("api:deepseek");
    expect(persisted()?.find((entry) => entry.runtimeId === "api:deepseek")?.state).toBe("OK");
  });
});
