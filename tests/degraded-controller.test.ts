import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DegradedController } from "../electron/commander/degraded-controller";
import { BudgetManager } from "../electron/commander/budget-manager";
import { TaskLedger } from "../electron/commander/task-ledger";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";
const runtime = (id: string) => ({ id, capabilities: { roles: ["research"] } }) as RuntimeAdapter;
it("persists degradation and recovers when matching runtime capacity returns", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-degraded-"));
  try {
    const ledger = new TaskLedger(root); ledger.create("task", "work"); const budgets = new BudgetManager(); const controller = new DegradedController(ledger, budgets);
    expect(controller.evaluate("task", [runtime("a"), runtime("b")]).mode).toBe("FULL");
    expect(controller.evaluate("task", [runtime("a")]).mode).toBe("REDUCED");
    budgets.update("a", "LOW", "OBSERVED"); expect(controller.evaluate("task", [runtime("a")]).mode).toBe("LIGHTWEIGHT");
    budgets.update("a", "EXHAUSTED", "OBSERVED"); expect(controller.evaluate("task", [runtime("a")], true).mode).toBe("DETERMINISTIC");
    expect(controller.evaluate("task", [runtime("a")]).mode).toBe("PAUSED");
    budgets.observeSuccess("a"); expect(controller.evaluate("task", [runtime("a")]).mode).toBe("REDUCED");
    expect(new DegradedController(new TaskLedger(root), budgets).get("task")?.mode).toBe("REDUCED");
    ledger.update("task", "bounded budget consumed", (state) => { state.usage.modelCalls = state.limits.modelCalls; });
    expect(controller.evaluate("task", [runtime("a")]).mode).toBe("PAUSED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
