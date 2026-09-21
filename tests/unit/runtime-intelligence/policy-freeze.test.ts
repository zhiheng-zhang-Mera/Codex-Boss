import { describe, expect, it } from "vitest";
import { CONTINUATION_POLICY_FALLBACK, CONTINUATION_POLICY_STOP_EVIDENCE, CONTINUATION_THRESHOLDS, continuationPolicyHash } from "../../../src/shared/runtime-intelligence/continuation-evaluator";
import { policyRegistry } from "../../../src/shared/runtime-intelligence/policy-registry";

/**
 * The policy freeze guard.
 *
 * The live shadow capture changed what the plane OBSERVES, and it must not have changed what the
 * plane DECIDES. A hash comparison is the only version of that claim that cannot be argued with:
 * each policy's identity is derived from the rules, thresholds, fallbacks and weights that define
 * it, so any edit that changes a decision changes the hash and fails here.
 *
 * The literals below were read from the frozen round at commit
 * `c24d8c194f5ca9ed58dc6649eaaffff9e27ef33d`, before the capture path was attached. They are
 * recorded rather than recomputed on purpose: a guard that reads its expectation from the code it
 * is guarding cannot detect a change to that code.
 */

const FROZEN_POLICY_HASHES: Readonly<Record<string, string>> = {
  "continuation-policy-v0": "ee438080bd3e600d7d852cb596f8f363dfd368f41be0ba0e293fe6e914d82a49",
  "continuation-policy-v1": "24aa883343e56fad18225fa8e4d190b1b99ac0faf5bef2dd88577e3edb3cf053",
  "scheduler-policy-v0": "c6488ce44cb20b0dcd1e8f890bf1ea358e8e4503094930cba50e999944e49a65",
  "skill-loadout-policy-v0": "78d8a1f7f321564d1edf3308f717dad57239dfaa598cdba35624109aa5266fe9",
  "confidence-policy-v0": "f05ac0e57995d31007d45d504c719bc6d8cfd93c8ca273cdf70e922187f3c23c"
};

describe("every frozen policy keeps the identity it was frozen with", () => {
  it("reports POLICY_FREEZE_BROKEN when any policy hash moved", () => {
    const moved: string[] = [];
    for (const [policyId, frozen] of Object.entries(FROZEN_POLICY_HASHES)) {
      const identity = policyRegistry().find((entry) => entry.policyId === policyId);
      expect(identity, `${policyId} is missing from the registry`).toBeDefined();
      if (identity?.policyHash !== frozen) moved.push(`${policyId}: ${frozen} -> ${identity?.policyHash}`);
    }
    expect(moved, `POLICY_FREEZE_BROKEN: ${moved.join("; ")}`).toEqual([]);
  });

  it("keeps the continuation semantics the hash is derived from identical", () => {
    // A hash can only be trusted if the fields it covers are the fields that decide. These are
    // asserted separately so a semantic change is caught even by a reader who does not recompute.
    expect(CONTINUATION_POLICY_FALLBACK["continuation-policy-v0"]).toBe("STOP");
    expect(CONTINUATION_POLICY_FALLBACK["continuation-policy-v1"]).toBe("CONTINUE");
    expect(CONTINUATION_POLICY_STOP_EVIDENCE["continuation-policy-v0"]).toBe("PROGRESS_OR_UNRESOLVED");
    expect(CONTINUATION_POLICY_STOP_EVIDENCE["continuation-policy-v1"]).toBe("TASK_COMPLETE");
    expect(CONTINUATION_THRESHOLDS).toEqual({
      repetitionRate: 0.8,
      stalledNovelty: 0.1,
      reviewerDisagreementRate: 0.5,
      selfContradictionsForReview: 2,
      uncertaintyForReview: 0.7,
      decomposeAfterSteps: 4,
      decomposeProgress: 0.25,
      decomposeNovelty: 0.2,
      completeProgress: 1
    });
    expect(continuationPolicyHash("continuation-policy-v1")).toBe(continuationPolicyHash("continuation-policy-v1"));
    expect(continuationPolicyHash("continuation-policy-v0")).not.toBe(continuationPolicyHash("continuation-policy-v1"));
  });

  it("keeps the frozen continuation policy marked as under observation", () => {
    const frozen = policyRegistry().find((entry) => entry.policyId === "continuation-policy-v1");
    expect(frozen?.status).toBe("FROZEN_FOR_PROSPECTIVE_VALIDATION");
    // Four policies are frozen; the baseline is retired and stays runnable so the comparison
    // remains re-measurable.
    expect(policyRegistry().filter((entry) => entry.status === "FROZEN_FOR_PROSPECTIVE_VALIDATION")).toHaveLength(4);
    expect(policyRegistry().find((entry) => entry.policyId === "continuation-policy-v0")?.status).toBe("RETIRED");
  });
});
