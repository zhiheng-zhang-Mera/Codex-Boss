import { describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import type { RuntimeAdapter, RuntimeAvailability, RuntimeRequest } from "../electron/runtimes/runtime";

function runtime(id: string, availability: RuntimeAvailability = "AVAILABLE", roles: RuntimeAdapter["capabilities"]["roles"] = ["coding"]): RuntimeAdapter {
  return { id, kind: id.startsWith("codex:") ? "codex" : "web", capabilities: { roles, supportsCancellation: false, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability, message: availability, checkedAt: new Date().toISOString() }; }, async execute(request: RuntimeRequest) { return { runtimeId: id, jobId: request.jobId, status: "SUCCESS" }; } };
}

describe("RuntimeRegistry", () => {
  it("protects ids, caches health, and filters by capability", async () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime("codex:cli"));
    registry.register(runtime("web:chatgpt", "DOWN", ["planning"]));
    expect(() => registry.register(runtime("codex:cli"))).toThrow(/Duplicate/);
    await registry.refreshHealth();
    expect(registry.listAvailable().map((item) => item.id)).toEqual(["codex:cli"]);
    expect(registry.findByCapability("planning").map((item) => item.id)).toEqual(["web:chatgpt"]);
  });
});
