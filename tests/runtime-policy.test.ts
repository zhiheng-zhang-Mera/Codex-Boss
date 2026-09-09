import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRuntimePolicy } from "../electron/commander/runtime-policy";

describe("runtime policy config", () => {
  it("loads a provider-neutral policy without credentials", () => {
    const policy = loadRuntimePolicy(path.join(process.cwd(), ".codex-boss", "config", "runtime-policy.json"));
    expect(policy.maxParallel).toBe(5);
    expect(policy.roles.coder.preferred).toEqual(["codex:cli", "web:chatgpt"]);
    expect(JSON.stringify(policy)).not.toMatch(/cookie|token|api.?key/i);
  });
});
