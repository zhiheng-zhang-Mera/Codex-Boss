import { describe, expect, it } from "vitest";
import { resolveCapabilityGraph, capabilitySatisfiedBy } from "../src/shared/capability-graph";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

function runtime(id: string, roles: string[], health = "AVAILABLE"): RuntimeAdapter {
  return { id, kind: id.startsWith("codex") ? "codex" : id.startsWith("web") ? "web" : "local", capabilities: { roles: roles as RuntimeAdapter["capabilities"]["roles"], supportsCancellation: false, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability: health as never, message: "ok", checkedAt: new Date().toISOString() }; }, async execute(request) { return { runtimeId: id, jobId: request.jobId, status: "SUCCESS" }; } };
}

describe("capability graph resolution (AP06)", () => {
  it("maps native tokens to deterministic sufficiency and no AI role", () => {
    const graph = resolveCapabilityGraph(["native", "read files"]);
    expect(graph.nativeSufficient).toBe(true);
    expect(graph.aiRoles).toEqual([]);
    expect(graph.kinds).toContain("deterministic");
    expect(graph.unresolved).toEqual([]);
  });

  it("maps role and tool tokens onto AI capabilities and execution kinds", () => {
    const graph = resolveCapabilityGraph(["web_search", "code_edit"]);
    expect(graph.aiRoles).toEqual(expect.arrayContaining(["research", "coding"]));
    expect(graph.unresolved).toEqual([]);
    const generic = resolveCapabilityGraph(["general_reasoning"]);
    expect(generic.aiRoles).toEqual([]);
    expect(generic.unresolved).toEqual([]);
    // Generic reasoning demands no specific brand kind (any model runtime can serve it).
    expect(generic.kinds).toEqual([]);
  });

  it("reports unknown tokens instead of silently assuming them", () => {
    const graph = resolveCapabilityGraph(["3d_model", "render"]);
    expect(graph.unresolved.length).toBeGreaterThan(0);
  });

  it("satisfies gates: AI role required, generic satisfied by any model runtime, unresolved denied", () => {
    expect(capabilitySatisfiedBy(resolveCapabilityGraph(["coding"]), { roles: ["coding"], consumesModel: true })).toBe(true);
    expect(capabilitySatisfiedBy(resolveCapabilityGraph(["coding"]), { roles: ["research"], consumesModel: true })).toBe(false);
    expect(capabilitySatisfiedBy(resolveCapabilityGraph(["general_reasoning"]), { roles: ["research"], consumesModel: true })).toBe(true);
    expect(capabilitySatisfiedBy(resolveCapabilityGraph(["blender"]), { roles: ["coding"], consumesModel: true })).toBe(false);
  });
});

describe("RoleRouter required-capability wiring (AP06)", () => {
  it("routes on resolved capability tokens additively to the role", async () => {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    registry.register(runtime("codex:cli", ["coding"]));
    registry.register(runtime("web:chatgpt", ["research", "coding"]));
    registry.register(runtime("local:native", ["coding", "research"]));
    await registry.refreshHealth();
    // A coder task that also needs research must exclude the coding-only runtime.
    const candidates = new RoleRouter(registry, budgets).route({ role: "coder", capabilityTokens: ["research"], allowFallback: true });
    const ids = candidates.map((item) => item.runtimeId);
    expect(ids).not.toContain("codex:cli");
    expect(ids).toEqual(expect.arrayContaining(["web:chatgpt", "local:native"]));
  });

  it("prefers the cheapest sufficient executor when no brand-specific kind is demanded", async () => {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    registry.register(runtime("codex:cli", ["research"]));
    registry.register(runtime("api:openai", ["research"]));
    registry.register(runtime("web:chatgpt", ["research"]));
    await registry.refreshHealth();
    const candidates = new RoleRouter(registry, budgets).route({ role: "researcher", capabilityTokens: ["general_reasoning"], allowFallback: true });
    expect(candidates.map((item) => item.runtimeId)).toEqual(["api:openai", "web:chatgpt", "codex:cli"]);
  });

  it("restricts to the brand kind a capability demands (web_search → web)", async () => {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    registry.register(runtime("codex:cli", ["research"]));
    registry.register(runtime("api:openai", ["research"]));
    registry.register(runtime("web:chatgpt", ["research"]));
    await registry.refreshHealth();
    const byWeb = new RoleRouter(registry, budgets).route({ role: "researcher", capabilityTokens: ["web_search"], allowFallback: true });
    expect(byWeb[0].runtimeId).toBe("web:chatgpt");
    // api is cheaper overall but does not satisfy the demanded web kind.
    expect(byWeb[0].reason).toContain("cheapest sufficient");
  });

  it("keeps pinned and preferred runtimes ahead of cost ordering", async () => {
    const registry = new RuntimeRegistry(); const budgets = new BudgetManager();
    registry.register(runtime("codex:cli", ["research"]));
    registry.register(runtime("api:openai", ["research"]));
    await registry.refreshHealth();
    const pinned = new RoleRouter(registry, budgets).route({ role: "researcher", capabilityTokens: ["general_reasoning"], pinnedRuntime: "codex:cli", allowFallback: true });
    expect(pinned[0].runtimeId).toBe("codex:cli");
  });
});
