import { describe, expect, it } from "vitest";
import { chooseCheapestSufficient, resolveCapabilityToKind, type CandidateExecution } from "../src/shared/cheapest-execution";

const candidates = (kinds: CandidateExecution["kind"][]): CandidateExecution[] => kinds.map((kind, index) => ({ runtimeId: `rt-${kind}-${index}`, kind, supported: true, passRate: 1 }));

describe("cheapest sufficient execution", () => {
  it("prefers the deterministic executor for native capabilities", () => {
    const choice = chooseCheapestSufficient({ capability: "read file README.md", candidates: candidates(["api", "deterministic", "web"]) });
    expect(choice.runtimeId).toContain("deterministic");
    expect(choice.reason).toContain("deterministic");
  });

  it("picks the cheapest supported AI executor otherwise", () => {
    const choice = chooseCheapestSufficient({ capability: "summarize", candidates: candidates(["codex", "api", "web"]) });
    expect(choice.runtimeId).toContain("api");
  });

  it("orders by cost then pass rate and never picks an unsupported candidate", () => {
    const choice = chooseCheapestSufficient({
      capability: "research",
      candidates: [
        { runtimeId: "api:x", kind: "api", passRate: 0.5, supported: true },
        { runtimeId: "api:y", kind: "api", passRate: 0.9, supported: true },
        { runtimeId: "web:z", kind: "web", supported: false },
        { runtimeId: "codex:cli", kind: "codex", supported: false }
      ]
    });
    expect(choice.runtimeId).toBe("api:y");
  });

  it("returns null when nothing supports the capability", () => {
    expect(chooseCheapestSufficient({ capability: "blender", candidates: [{ runtimeId: "api", kind: "api", supported: false }, { runtimeId: "web", kind: "web", supported: false }] })).toEqual({ runtimeId: null, reason: expect.stringContaining("blender") });
  });
});

describe("capability kind resolution", () => {
  it("maps capability text to execution kinds", () => {
    expect(resolveCapabilityToKind("read file src/a.ts")).toBe("deterministic");
    expect(resolveCapabilityToKind("computer:open_app")).toBe("deterministic");
    expect(resolveCapabilityToKind("web search")).toBe("web");
    expect(resolveCapabilityToKind("codex review")).toBe("codex");
    expect(resolveCapabilityToKind("reasoning task")).toBe("api");
    expect(resolveCapabilityToKind("render 3d scene")).toBe("unknown");
  });
});
