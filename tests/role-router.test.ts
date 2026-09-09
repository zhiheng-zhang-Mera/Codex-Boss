import { describe, expect, it } from "vitest";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

function runtime(id: string): RuntimeAdapter { return { id, kind: id.startsWith("codex") ? "codex" : "web", capabilities: { roles: ["coding", "review"], supportsCancellation: false, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }; }, async execute(request) { return { runtimeId: id, jobId: request.jobId, status: "SUCCESS" }; } }; }

describe("RoleRouter and BudgetManager", () => {
  it("routes roles independently from providers and excludes exhausted runtimes", async () => {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    registry.register(runtime("codex:cli")); registry.register(runtime("web:chatgpt")); await registry.refreshHealth();
    budgets.observeFailure("codex:cli", "quota exhausted");
    const candidates = new RoleRouter(registry, budgets).route({ role: "coder", preferredRuntimes: ["codex:cli", "web:chatgpt"], allowFallback: true });
    expect(candidates.map((item) => item.runtimeId)).toEqual(["web:chatgpt"]);
    expect(budgets.get("codex:cli").state).toBe("EXHAUSTED");
  });
});
