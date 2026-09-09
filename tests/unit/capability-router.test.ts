import { describe, expect, it } from "vitest";
import { eligibleCandidates } from "../../src/shared/capability-router";

describe("R-303 capability-aware routing", () => {
  it("never routes onto FAILED/DISABLED/RECOVERING runtimes or ones lacking the capability", () => {
    const result = eligibleCandidates(
      [
        { id: "web:a", capabilities: ["coding", "research"] },
        { id: "web:b", capabilities: ["coding"] },
        { id: "web:c", capabilities: ["coding"] }
      ],
      { "web:a": "READY", "web:b": "FAILED", "web:c": "DISABLED" },
      ["coding"]
    );
    expect(result.selected).toEqual(["web:a"]);
    expect(result.blocked).toEqual(["web:b", "web:c"]);
    expect(result.excluded.map((item) => item.id)).toEqual(["web:b", "web:c"]);
  });

  it("requires the capability — a READY runtime without it is excluded", () => {
    const result = eligibleCandidates([{ id: "native", capabilities: ["planning"] }], { native: "READY" }, ["coding"]);
    expect(result.selected).toEqual([]);
    expect(result.excluded[0].reason).toContain("missing capability");
  });

  it("DEGRADED runtimes are admitted but tracked; unknown state is not treated as present", () => {
    const result = eligibleCandidates(
      [
        { id: "web:a", capabilities: ["coding"] },
        { id: "web:z", capabilities: [] }
      ],
      { "web:a": "DEGRADED", "web:z": "READY" },
      ["coding"]
    );
    expect(result.selected).toEqual(["web:a"]);
    expect(result.degraded).toEqual(["web:a"]);
    expect(result.excluded.map((item) => item.id)).toEqual(["web:z"]);
  });
});
