import { describe, expect, it } from "vitest";
import { inferBaselineProvenance } from "../../src/shared/research-protocol";

describe("baseline provenance inference (Overcomplete §9.8)", () => {
  it("honors an implementation-declared baseline with its named source", () => {
    const info = inferBaselineProvenance("review_error_rate", { baseline: 0.34, source: "known-benchmark" });
    expect(info.value).toBe("0.34");
    expect(info.kind).toBe("known-benchmark");
    expect(info.reason).toContain("declared baseline 0.34");
  });

  it("uses the named random-chance baseline for proportion-like metrics", () => {
    const info = inferBaselineProvenance("answer_accuracy");
    expect(info.value).toBe("0.5");
    expect(info.kind).toBe("random-chance");
    expect(info.reason).toContain("chance level 0.5");
  });

  it("never freezes an unexplained constant for non-proportion metrics (declared fallback excluded)", () => {
    expect(inferBaselineProvenance("training_loss").kind).toBe("host-heuristic");
    expect(inferBaselineProvenance("latency_ms").kind).toBe("host-heuristic");
    expect(inferBaselineProvenance("totally_unknown_metric").kind).toBe("host-heuristic");
  });
});
