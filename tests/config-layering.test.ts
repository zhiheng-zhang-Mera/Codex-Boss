import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { explainConfigKey, resolveConfig } from "../src/shared/config-layering";
import { explainTaskBudget, TaskLedger, type TaskLedgerRecord } from "../electron/commander/task-ledger";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-config-layering-")); dirs.push(dir); return dir; }

describe("explainable config layering", () => {
  it("applies the fixed layer precedence and explains each value's source", () => {
    const resolved = resolveConfig(
      { max_workers: 1, model_calls: 12, mode: "safe" },
      { global: { max_workers: 3 }, task: { model_calls: 6 }, emergency: { max_workers: 1 } }
    );
    expect(resolved.values).toEqual({ max_workers: 1, model_calls: 6, mode: "safe" });
    expect(resolved.sources).toEqual({ max_workers: "emergency", model_calls: "task", mode: "system" });
    expect(explainConfigKey(resolved, "model_calls")).toContain("source: task");
    expect(explainConfigKey(resolved, "mode")).toContain("source: system");
  });

  it("does not overwrite a system default with an undefined override", () => {
    const resolved = resolveConfig({ max_workers: 1, model_calls: 12 }, { task: { max_workers: undefined } });
    expect(resolved.values.max_workers).toBe(1);
    expect(resolved.sources.max_workers).toBe("system");
  });
});

describe("task ledger operational budget layering", () => {
  it("keeps system defaults and records system provenance by default", () => {
    const ledger = new TaskLedger(root());
    const record = ledger.create("task", "objective");
    expect(record.limits).toEqual({ modelCalls: 12, retries: 3, toolCalls: 100 });
    expect(record.limitsSource).toEqual({ modelCalls: "system", retries: "system", toolCalls: "system" });
    expect(explainTaskBudget(record)).toEqual([
      "modelCalls = 12 (source: system)",
      "retries = 3 (source: system)",
      "toolCalls = 100 (source: system)"
    ]);
  });

  it("overrides individual limits from the task layer with explainable sources", () => {
    const ledger = new TaskLedger(root());
    const record = ledger.create("task", "objective", [], { modelCalls: 4, retries: 1 });
    expect(record.limits).toEqual({ modelCalls: 4, retries: 1, toolCalls: 100 });
    expect(record.limitsSource).toEqual({ modelCalls: "task", retries: "task", toolCalls: "system" });
    expect(explainTaskBudget(record)).toContain("modelCalls = 4 (source: task)");
  });

  it("persists resolved limits and provenance across ledger reload", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("task", "objective", [], { toolCalls: 20 });
    const restored = new TaskLedger(dir).load("task") as TaskLedgerRecord;
    expect(restored.limits.toolCalls).toBe(20);
    expect(restored.limitsSource?.toolCalls).toBe("task");
    expect(restored.limitsSource?.modelCalls).toBe("system");
  });
});
