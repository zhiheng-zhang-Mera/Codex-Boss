import { describe, expect, it } from "vitest";
import { oneSampleEffectSize, oneSamplePermutationP } from "../../src/shared/research-statistics";

describe("one-sample statistics against a baseline (Overcomplete §9.12)", () => {
  it("reports a positive effect size when the mean exceeds the baseline", () => {
    const values = [0.7, 0.75, 0.72, 0.69, 0.74, 0.71, 0.73, 0.7];
    expect(oneSampleEffectSize(values, 0.5)).toBeGreaterThan(1);
    expect(oneSampleEffectSize(values, 0.5)).toBeLessThan(50);
  });

  it("returns NaN for underpowered samples", () => {
    expect(oneSampleEffectSize([0.5], 0.5)).toBeNaN();
    expect(oneSamplePermutationP([0.5], 0.5)).toBeNaN();
  });

  it("produces a deterministic small p for a strong mean-above-baseline signal", () => {
    const values = Array.from({ length: 30 }, (_, index) => 0.7 + (index % 5) * 0.01);
    const first = oneSamplePermutationP(values, 0.5, { seed: 42, permutations: 2000 });
    const second = oneSamplePermutationP(values, 0.5, { seed: 42, permutations: 2000 });
    expect(first).toBe(second); // deterministic
    expect(first).toBeLessThan(0.01);
  });

  it("does not reject noise around the baseline", () => {
    const values = Array.from({ length: 20 }, (_, index) => 0.5 + ((index % 7) - 3) * 0.01);
    expect(oneSamplePermutationP(values, 0.5, { seed: 1, permutations: 2000 })).toBeGreaterThan(0.01);
  });
});
