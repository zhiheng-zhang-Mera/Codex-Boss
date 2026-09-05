import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capacityFor, workerCapabilityMatrix } from "../src/shared/resource-model";
import { DegradedController } from "../electron/commander/degraded-controller";
import { TaskLedger } from "../electron/commander/task-ledger";
import { BudgetManager } from "../electron/commander/budget-manager";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function ledger() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-res-")); dirs.push(dir); return new TaskLedger(path.join(dir, "tasks")); }

function runtime(id: string): RuntimeAdapter {
  return { id, kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; }, async execute() { return { runtimeId: id, jobId: "j", status: "SUCCESS" }; } };
}

describe("resource model + backpressure", () => {
  it("caps logical demand by physical budget with a clear reason", () => {
    expect(capacityFor({ requestedWorkers: 3 }, { workers: 2 })).toEqual({ allowedWorkers: 2, reason: "physical_cap" });
    expect(capacityFor({ requestedWorkers: 3 }, { workers: 8 })).toEqual({ allowedWorkers: 3, reason: "unlimited" });
    expect(capacityFor({ requestedWorkers: 2 }, { workers: 8 })).toEqual({ allowedWorkers: 2, reason: "unlimited" });
    expect(capacityFor({ requestedWorkers: 5 })).toEqual({ allowedWorkers: 3, reason: "logical_cap" });
    expect(capacityFor({ requestedWorkers: 0 }, { workers: 8 })).toEqual({ allowedWorkers: 0, reason: "no_workers" });
  });

  it("builds the worker capability matrix", () => {
    const matrix = workerCapabilityMatrix([
      { runtimeId: "codex:cli", consumesModel: true, usesBrowser: false },
      { runtimeId: "web:chatgpt", consumesModel: true, usesBrowser: true },
      { runtimeId: "local:native", consumesModel: false, usesBrowser: false }
    ]);
    expect(matrix).toEqual({ modelWorkers: 2, browserWorkers: 1, nativeOnly: 1 });
  });
});

describe("degraded controller physical backpressure", () => {
  it("keeps full concurrency when no physical budget is supplied", () => {
    const store = ledger();
    store.create("task", "objective");
    const controller = new DegradedController(store, new BudgetManager());
    const state = controller.evaluate("task", [runtime("api:a"), runtime("api:b"), runtime("api:c")]);
    expect(state.mode).toBe("FULL");
    expect(state.maxWorkers).toBe(3);
  });

  it("caps FULL concurrency to the physical budget", () => {
    const store = ledger();
    store.create("task", "objective");
    const controller = new DegradedController(store, new BudgetManager(), { workers: 2 });
    const state = controller.evaluate("task", [runtime("api:a"), runtime("api:b"), runtime("api:c")]);
    expect(state.mode).toBe("FULL");
    expect(state.maxWorkers).toBe(2);
    expect(state.reason).toContain("physical budget");
  });

  it("keeps single-worker modes unaffected by the physical budget", () => {
    const store = ledger();
    store.create("task", "objective");
    const controller = new DegradedController(store, new BudgetManager(), { workers: 2 });
    const state = controller.evaluate("task", [runtime("api:a")]);
    expect(state.mode).toBe("REDUCED");
    expect(state.maxWorkers).toBe(1);
  });
});
