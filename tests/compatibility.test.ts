import { describe, expect, it } from "vitest";
import { compatibilityIssue, compareVersions, CURRENT_VERSIONS, versionInWindow } from "../src/shared/compatibility";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { ApiRuntime } from "../electron/runtimes/native-api-runtime";
import { CodexCliRuntime } from "../electron/runtimes/codex/codex-cli-runtime";
import { ProviderRuntimeAdapter } from "../electron/runtimes/web/provider-runtime-adapter";
import type { RuntimeAdapter, RuntimeRequest } from "../electron/runtimes/runtime";
import type { ProviderApiClient } from "../electron/provider-api";

const fakeClient = { validate: () => { throw new Error("not configured"); }, complete: async () => ({ content: "ok", sourceUrl: "https://example.test", adapterVersion: "api-openai-compatible/v1" }) } as unknown as ProviderApiClient;

function stub(id: string): RuntimeAdapter {
  return { id, kind: "local", capabilities: { roles: ["coding"], supportsCancellation: false, supportsStreaming: false }, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; }, async execute(request: RuntimeRequest) { return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" }; } };
}

describe("compatibility version contracts", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("1", "1.0")).toBe(0);
    expect(compareVersions("1", "2")).toBeLessThan(0);
    expect(compareVersions("2.1", "2.0.9")).toBeGreaterThan(0);
    expect(versionInWindow("1", { min: "1", max: "1" })).toBe(true);
    expect(versionInWindow("2", { min: "1", max: "1" })).toBe(false);
  });

  it("reports no issue when declared windows contain the current core version", () => {
    const declaration = { id: "adapter", kind: "api", windows: { adapter_api: { min: "1", max: "1" }, capability_contract: { min: "1", max: "1" } } };
    expect(compatibilityIssue(declaration)).toBeNull();
    expect(compatibilityIssue({ id: "legacy", kind: "old", windows: {} })).toBeNull();
  });

  it("fails closed on an adapter whose window excludes the current core version", () => {
    const issue = compatibilityIssue({ id: "old-adapter", kind: "api", windows: { adapter_api: { min: "0", max: "0" } } });
    expect(issue).toContain("old-adapter");
    expect(issue).toContain("BOSS core is adapter_api " + CURRENT_VERSIONS.adapter_api);
  });

  it("registers compatible built-in runtimes and rejects an out-of-contract adapter", () => {
    const registry = new RuntimeRegistry();
    registry.register(new CodexCliRuntime("data"));
    registry.register(new ApiRuntime("chatgpt", fakeClient));
    registry.register(new ProviderRuntimeAdapter("web:chatgpt", { healthCheck: async () => ({ runtimeId: "web:chatgpt", availability: "AVAILABLE", message: "ok", checkedAt: "now" }), execute: async (request) => ({ runtimeId: "web:chatgpt", jobId: request.jobId, status: "SUCCESS", content: "ok" }) }));
    registry.register(stub("legacy:no-contract")); // absence = legacy, accepted
    expect(() => registry.register({ ...stub("old:out-of-window"), compatibility: { id: "old:out-of-window", kind: "old", windows: { adapter_api: { min: "0", max: "0" } } } })).toThrow(/out-of-window/);
    expect(registry.get("codex:cli")).toBeDefined();
    expect(registry.get("api:chatgpt")).toBeDefined();
    expect(registry.get("web:chatgpt")).toBeDefined();
  });
});
