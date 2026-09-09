import { describe, expect, it } from "vitest";
import { escalationAfterFailure, postActionVerified, readinessFromProbe, READINESS_GATES } from "../../src/shared/action-readiness";

describe("R-201 action readiness core (§5.1)", () => {
  it("ordered chain: DOM-ready / target / visible / enabled / stable gates exist", () => {
    expect(READINESS_GATES).toEqual([
      "NAVIGATION_ACCEPTED", "DOM_READY", "TARGET_EXISTS", "TARGET_VISIBLE", "TARGET_ENABLED", "TARGET_STABLE", "ACTION_ALLOWED"
    ]);
  });

  it("a fully-ready probe is ready with no blockers", () => {
    const verdict = readinessFromProbe({ readyState: "complete", found: true, visible: true, enabled: true, stableSamples: 1 });
    expect(verdict.ready).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it("a non-ready DOM blocks with the failing gates listed", () => {
    const verdict = readinessFromProbe({ readyState: "loading", found: true, visible: false, enabled: true });
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers).toContain("DOM_READY");
    expect(verdict.blockers).toContain("TARGET_VISIBLE");
    expect(verdict.blockers).not.toContain("TARGET_ENABLED");
  });

  it("post-action verification never assumes a change happened", () => {
    expect(postActionVerified({})).toBe(false);
    expect(postActionVerified({ changed: true })).toBe(true);
    expect(postActionVerified({ expected: "QWEN-OK", text: "answer QWEN-OK" })).toBe(true);
    expect(postActionVerified({ expected: "QWEN-OK", text: "no marker" })).toBe(false);
  });

  it("bounded escalation: bounded retry → selector refresh → alternate strategy", () => {
    expect(escalationAfterFailure(0, 1)).toBe("BOUNDED_RETRY");
    expect(escalationAfterFailure(1, 1)).toBe("SELECTOR_REFRESH");
    expect(escalationAfterFailure(2, 1)).toBe("ALTERNATE_STRATEGY");
  });
});
