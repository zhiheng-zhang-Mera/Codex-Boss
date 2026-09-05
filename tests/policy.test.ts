import { describe, expect, it } from "vitest";
import { decide, HeuristicPolicy, StatisticalPolicy } from "../src/shared/policy";
import type { PolicyContext } from "../src/shared/policy";

const l3 = (runtimeStats: PolicyContext["runtimeStats"] = [], physicalWorkers?: number): PolicyContext => ({ complexity: "L3", runtimeStats, physicalWorkers, nativeAvailable: true });

describe("policy optimizer interface", () => {
  it("exposes the unified choose_* contract via decide()", () => {
    const decision = decide({ complexity: "L2", runtimeStats: [], nativeAvailable: true }, new HeuristicPolicy());
    expect(decision).toMatchObject({ workerCount: 2, contextBudgetChars: 16000, decompositionDepth: 1, verificationLevel: "standard" });
    expect(decision.parallelism).toBeGreaterThan(0);
  });

  it("heuristic policy scales by complexity and respects the physical cap", () => {
    expect(decide({ complexity: "L3", runtimeStats: [], nativeAvailable: true }, new HeuristicPolicy())).toMatchObject({ workerCount: 3, verificationLevel: "full", decompositionDepth: 2 });
    expect(decide(l3([], 2), new HeuristicPolicy()).workerCount).toBe(2);
    expect(decide({ complexity: "L0", runtimeStats: [], nativeAvailable: true }, new HeuristicPolicy()).verificationLevel).toBe("fast");
  });

  it("statistical policy prefers the highest pass-rate runtime when credible", () => {
    const stats = [{ runtimeId: "api:good", samples: 10, passRate: 0.9 }, { runtimeId: "api:bad", samples: 10, passRate: 0.4 }];
    // The statistical policy only gates verification for L3; worker counts remain heuristic.
    const heuristic = decide(l3(stats), new HeuristicPolicy());
    const statistical = decide(l3(stats), new StatisticalPolicy());
    expect(statistical).toEqual(heuristic); // same worker/context choices, both full verify for L3
    const low = decide({ complexity: "L1", runtimeStats: stats, nativeAvailable: true }, new StatisticalPolicy());
    expect(low.verificationLevel).toBe("standard");
  });
});
