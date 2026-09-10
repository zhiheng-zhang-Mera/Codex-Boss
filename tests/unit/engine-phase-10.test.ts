/**
 * Engine Phase 10 evidence test — policy evolution.
 * Acceptance: A42 (replay before promotion), A43 (replay regression ⇒ no
 * promotion), A44 (shadow failure ⇒ no replacement), A45 (promotion carries
 * version + rollback pointer), A46 (rollback restores the previous stable).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STABLE_POLICY, STABLE_POLICY_VERSION, type AdaptivePolicy, type EvaluationSummary } from "../../electron/learning/evolution/policy-candidate";
import { replayPolicy } from "../../electron/learning/evolution/historical-replay";
import { evaluateShadow, type ShadowObservation } from "../../electron/learning/evolution/shadow-evaluator";
import { PolicyPromotionGate } from "../../electron/learning/evolution/promotion-gate";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";

const at = "2026-09-10T00:00:00.000Z";

function episode(taskId: string, runtimeId: string, covered: number, modelSnapshotId?: string): EpisodeAppendInput {
  return {
    episodeId: `${taskId}-${runtimeId}`,
    taskId,
    jobId: `j-${taskId}`,
    timestamp: at,
    canonicalGoalHash: "goal",
    taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf(["planner", "planning"]), role: "planner", capabilities: ["planning"] },
    runtimeId,
    provider: runtimeId.replace("web:", ""),
    surface: "web",
    role: "planner",
    modelSnapshotId,
    runtimeStatus: "SUCCESS",
    semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }),
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: 100,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

function passSummary(): EvaluationSummary & { passed: boolean } {
  return { passed: true, tasksEvaluated: 6, stableMean: 0.6, candidateMean: 0.7, delta: 0.1, regressions: 0, notes: ["ok"] };
}

const EXPLORING_POLICY: AdaptivePolicy = {
  policyVersion: "candidate-001",
  params: { epsilon: 0.5, uncertaintyBonus: 0.2, avoidBelowUtility: -0.1, competitivenessMargin: 0.35, minSamplesPerProfile: 3 }
};

describe("Phase 10 — historical replay", () => {
  it("replays deterministically and reports no regression for an equivalent policy", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 5; index++) {
      store.append(episode(`task-${index}`, "web:a", 1));
      store.append(episode(`task-${index}`, "web:b", 0.5));
    }
    const first = replayPolicy(STABLE_POLICY, STABLE_POLICY, store.all(), { minGroups: 3 });
    const second = replayPolicy(STABLE_POLICY, STABLE_POLICY, store.all(), { minGroups: 3 });
    expect(first).toEqual(second);
    expect(first.passed).toBe(true);
    expect(first.regressions).toBe(0);
    expect(first.tasksEvaluated).toBe(5);
  });

  it("A43: a candidate that regresses historical tasks fails the replay", () => {
    const store = new EpisodeStore();
    // web:good is proven (5 samples, completion 1). web:risky is genuinely
    // UNCERTAIN: its samples are spread over three model snapshots, so no single
    // profile reaches the trust threshold (neutral prior, confidence 0).
    for (let index = 0; index < 5; index++) {
      store.append(episode(`task-${index}`, "web:good", 1));
      store.append(episode(`task-${index}`, "web:risky", 0.5, `MS-${index % 3}`));
    }
    // An "explore everything" policy: broad competitiveness margin + epsilon 1 means
    // it takes the uncertain runtime over the proven one.
    const aggressive: AdaptivePolicy = {
      policyVersion: "candidate-002",
      params: { epsilon: 1, uncertaintyBonus: 0.2, avoidBelowUtility: -10, competitivenessMargin: 10, minSamplesPerProfile: 3 }
    };
    const outcome = replayPolicy(aggressive, STABLE_POLICY, store.all(), { minGroups: 3 });
    expect(outcome.passed).toBe(false);
    expect(outcome.regressions).toBeGreaterThan(0);
    expect(outcome.candidateMean).toBeLessThan(outcome.stableMean);
    expect(outcome.notes.join(" ")).toContain("regression");
  });

  it("reports insufficient history instead of pretending to validate", () => {
    const store = new EpisodeStore();
    store.append(episode("task-1", "web:a", 1));
    store.append(episode("task-1", "web:b", 1));
    const outcome = replayPolicy(EXPLORING_POLICY, STABLE_POLICY, store.all(), { minGroups: 3 });
    expect(outcome.passed).toBe(false);
    expect(outcome.notes.join(" ")).toContain("replayable group");
  });
});

describe("Phase 10 — shadow evaluation", () => {
  it("A44: a shadow run with regressions does not pass", () => {
    const observations: ShadowObservation[] = Array.from({ length: 5 }, (_unused, index) => ({
      decisionId: `d${index}`,
      stableRuntimeId: "web:good",
      candidateRuntimeId: "web:risky",
      observedCompletion: 0.9,
      candidateObservedCompletion: 0.1
    }));
    const outcome = evaluateShadow(EXPLORING_POLICY, observations, { minObservations: 3 });
    expect(outcome.passed).toBe(false);
    expect(outcome.regressions).toBe(5);
  });

  it("passes when the shadow agrees or improves, and reports divergence", () => {
    const observations: ShadowObservation[] = [
      { decisionId: "d1", stableRuntimeId: "web:a", candidateRuntimeId: "web:a", observedCompletion: 0.8, candidateObservedCompletion: 0.8 },
      { decisionId: "d2", stableRuntimeId: "web:a", candidateRuntimeId: "web:b", observedCompletion: 0.8, candidateObservedCompletion: 0.9 },
      { decisionId: "d3", stableRuntimeId: "web:a", candidateRuntimeId: "web:a", observedCompletion: 0.7, candidateObservedCompletion: 0.7 }
    ];
    const outcome = evaluateShadow(EXPLORING_POLICY, observations, { minObservations: 3 });
    expect(outcome.passed).toBe(true);
    expect(outcome.divergences).toBe(1);
    expect(outcome.divergenceRate).toBeCloseTo(1 / 3, 3);
  });

  it("requires a minimum number of shadow observations", () => {
    const outcome = evaluateShadow(EXPLORING_POLICY, [{ decisionId: "d1", stableRuntimeId: "web:a", candidateRuntimeId: "web:a" }], { minObservations: 3 });
    expect(outcome.passed).toBe(false);
    expect(outcome.notes.join(" ")).toContain("insufficient");
  });
});

describe("Phase 10 — promotion gate", () => {
  it("A42: promotion before historical replay is refused", () => {
    const gate = new PolicyPromotionGate(undefined, () => at);
    gate.register(EXPLORING_POLICY);
    const result = gate.promote("candidate-001");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("replay required");
    expect(gate.stablePolicy().policyVersion).toBe(STABLE_POLICY_VERSION);
  });

  it("A43: a replay regression marks the candidate failed and blocks promotion", () => {
    const gate = new PolicyPromotionGate(undefined, () => at);
    gate.register(EXPLORING_POLICY);
    gate.recordReplay("candidate-001", {
      passed: false,
      tasksEvaluated: 5,
      stableMean: 0.8,
      candidateMean: 0.2,
      delta: -0.6,
      regressions: 4,
      notes: ["4 regression group(s)"],
      skippedGroups: 0
    });
    expect(gate.get("candidate-001")?.status).toBe("REPLAY_FAILED");
    const result = gate.promote("candidate-001");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("regression");
  });

  it("A44: a failed shadow run blocks promotion even after a passing replay", () => {
    const gate = new PolicyPromotionGate(undefined, () => at);
    gate.register(EXPLORING_POLICY);
    gate.recordReplay("candidate-001", { ...passSummary(), skippedGroups: 0 });
    expect(gate.get("candidate-001")?.status).toBe("REPLAY_PASSED");
    gate.recordShadow("candidate-001", {
      passed: false,
      tasksEvaluated: 5,
      stableMean: 0.9,
      candidateMean: 0.1,
      delta: -0.8,
      regressions: 5,
      notes: ["5 shadow regression(s)"],
      divergences: 5,
      divergenceRate: 1
    });
    expect(gate.get("candidate-001")?.status).toBe("SHADOW_FAILED");
    expect(gate.promote("candidate-001").ok).toBe(false);
  });

  it("stage order is enforced: shadow before replay is ignored", () => {
    const gate = new PolicyPromotionGate(undefined, () => at);
    gate.register(EXPLORING_POLICY);
    gate.recordShadow("candidate-001", { passed: true, tasksEvaluated: 9, stableMean: 0.5, candidateMean: 0.6, delta: 0.1, regressions: 0, notes: [], divergences: 0, divergenceRate: 0 });
    expect(gate.get("candidate-001")?.status).toBe("DRAFT");
  });

  it("A45/A46: a fully validated candidate is promoted with version + rollback pointer, and rollback restores the parent", () => {
    const gate = new PolicyPromotionGate(undefined, () => at);
    gate.register(EXPLORING_POLICY);
    gate.recordReplay("candidate-001", { ...passSummary(), skippedGroups: 0 });
    gate.recordShadow("candidate-001", { passed: true, tasksEvaluated: 6, stableMean: 0.5, candidateMean: 0.6, delta: 0.1, regressions: 0, notes: [], divergences: 1, divergenceRate: 0.16 });
    gate.recordTrial("candidate-001", passSummary());
    expect(gate.get("candidate-001")?.status).toBe("READY_FOR_PROMOTION");

    const promoted = gate.promote("candidate-001");
    expect(promoted.ok).toBe(true);
    expect(promoted.policy?.policyVersion).toBe("candidate-001");
    expect(promoted.policy?.parentVersion).toBe(STABLE_POLICY_VERSION);
    const record = gate.get("candidate-001")!;
    expect(record.promotedAt).toBe(at);
    expect(record.rollbackPointer).toBe(STABLE_POLICY_VERSION);
    expect(record.replay && record.shadow && record.trial).toBeTruthy(); // evaluation summary retained
    expect(gate.stablePolicy().policyVersion).toBe("candidate-001");

    const rolledBack = gate.rollback();
    expect(rolledBack.ok).toBe(true);
    expect(gate.stablePolicy().policyVersion).toBe(STABLE_POLICY_VERSION);
    expect(gate.get("candidate-001")?.status).toBe("ROLLED_BACK");
    expect(gate.rollback().ok).toBe(false); // nothing left to restore
  });

  it("promotion and rollback survive a restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p10-"));
    const file = path.join(dir, "policies.json");
    try {
      const gate = new PolicyPromotionGate(file, () => at);
      gate.register(EXPLORING_POLICY);
      gate.recordReplay("candidate-001", { ...passSummary(), skippedGroups: 0 });
      gate.recordShadow("candidate-001", { passed: true, tasksEvaluated: 6, stableMean: 0.5, candidateMean: 0.6, delta: 0.1, regressions: 0, notes: [], divergences: 0, divergenceRate: 0 });
      gate.recordTrial("candidate-001", passSummary());
      gate.promote("candidate-001");

      const reloaded = new PolicyPromotionGate(file, () => at);
      expect(reloaded.stablePolicy().policyVersion).toBe("candidate-001");
      expect(reloaded.get("candidate-001")?.rollbackPointer).toBe(STABLE_POLICY_VERSION);
      expect(reloaded.rollback().ok).toBe(true);
      expect(reloaded.stablePolicy().policyVersion).toBe(STABLE_POLICY_VERSION);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrupt gate store keeps the deterministic stable policy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p10-bad-"));
    const file = path.join(dir, "policies.json");
    try {
      fs.writeFileSync(file, "{ broken", "utf8");
      const gate = new PolicyPromotionGate(file, () => at);
      expect(gate.stablePolicy().policyVersion).toBe(STABLE_POLICY_VERSION);
      expect(gate.status().degradedReason).toContain("unreadable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
