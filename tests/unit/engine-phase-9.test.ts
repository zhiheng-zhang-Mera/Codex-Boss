/**
 * Engine Phase 9 evidence test — contextual exploration.
 * Acceptance: A32 (unknown-but-competitive may be explored), A31 (high-confidence
 * low performer is never force-explored), A26/A38/A39 (exploration can never
 * override an explicit pin, permissions or the ExecutionGate — it only reorders
 * candidates the hard layer already approved).
 */
import { describe, expect, it } from "vitest";
import { planExploration } from "../../electron/learning/routing/exploration-policy";
import { AdaptiveScorer } from "../../electron/learning/routing/adaptive-scorer";
import { RoleRouter } from "../../electron/commander/role-router";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { ProviderProfileStore } from "../../electron/learning/providers/behaviour-model";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";
import { resolveAdaptiveFlags } from "../../src/shared/adaptive-flags";
import type { RuntimeAdapter, RuntimeResult } from "../../electron/runtimes/runtime";

const at = "2026-09-10T00:00:00.000Z";
const LEARNING_ON = () => resolveAdaptiveFlags({ adaptiveProviderLearning: true, adaptiveRouting: true, semanticOutcomeEvaluation: true });

function runtime(id: string): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { roles: ["planning", "coding"], supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "ready", checkedAt: at };
    },
    async execute(request): Promise<RuntimeResult> {
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" };
    }
  };
}

function episode(runtimeId: string, covered: number, index: number): EpisodeAppendInput {
  return {
    episodeId: `${runtimeId}-${index}`,
    taskId: `t-${index}`,
    jobId: `j-${index}`,
    timestamp: `2026-09-10T00:00:${String(index).padStart(2, "0")}.000Z`,
    canonicalGoalHash: "goal",
    taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf(["planner", "planning"]), role: "planner", capabilities: ["planning"] },
    runtimeId,
    provider: runtimeId.replace("web:", ""),
    surface: "web",
    role: "planner",
    runtimeStatus: "SUCCESS",
    semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }),
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: 100,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

describe("Phase 9 — exploration policy", () => {
  it("A32: an uncertain but competitive candidate can be explored", () => {
    // epsilon 1 ⇒ the deterministic draw always takes the exploratory branch
    const plan = planExploration(
      [
        { runtimeId: "web:best", expectedUtility: 0.6, confidence: 0.9 },
        { runtimeId: "web:new", expectedUtility: 0.45, confidence: 0.0 }
      ],
      { epsilon: 1, uncertaintyBonus: 0.3 }
    );
    expect(plan.explore).toBe(true);
    expect(plan.explorerId).toBe("web:new");
    expect(plan.assignments.find((item) => item.runtimeId === "web:new")?.adjustedUtility).toBeGreaterThan(0.45);
    expect(plan.reason).toContain("bounded exploration");
  });

  it("A31: a high-confidence low performer is never force-explored", () => {
    const plan = planExploration(
      [
        { runtimeId: "web:good", expectedUtility: 0.6, confidence: 0.9 },
        { runtimeId: "web:bad", expectedUtility: -0.4, confidence: 0.95 }
      ],
      { epsilon: 1, uncertaintyBonus: 0.5 }
    );
    expect(plan.assignments.find((item) => item.runtimeId === "web:bad")?.class).toBe("AVOID");
    expect(plan.explore).toBe(false);
    expect(plan.order[0]).toBe("web:good");
  });

  it("exploration is bounded to a single explorer and deterministic", () => {
    const candidates = [
      { runtimeId: "web:a", expectedUtility: 0.5, confidence: 0.9 },
      { runtimeId: "web:b", expectedUtility: 0.45, confidence: 0.1 },
      { runtimeId: "web:c", expectedUtility: 0.44, confidence: 0.1 }
    ];
    const first = planExploration(candidates, { epsilon: 1 });
    const second = planExploration(candidates, { epsilon: 1 });
    expect(first).toEqual(second); // deterministic
    expect(first.assignments.filter((item) => item.reason.includes("exploration bonus"))).toHaveLength(1);
  });

  it("epsilon 0 disables exploration entirely", () => {
    const plan = planExploration(
      [
        { runtimeId: "web:a", expectedUtility: 0.5, confidence: 0.9 },
        { runtimeId: "web:b", expectedUtility: 0.45, confidence: 0.0 }
      ],
      { epsilon: 0 }
    );
    expect(plan.explore).toBe(false);
    expect(plan.reason).toContain("exploitation");
  });

  it("A26: a pin keeps the top position even when an explorer receives a bonus", () => {
    const plan = planExploration(
      [
        { runtimeId: "web:pinned", expectedUtility: 0.2, confidence: 0.9 },
        { runtimeId: "web:new", expectedUtility: 0.19, confidence: 0.0 }
      ],
      { epsilon: 1, uncertaintyBonus: 0.9, pinnedRuntime: "web:pinned" }
    );
    expect(plan.selectedRuntimeId).toBe("web:pinned");
  });
});

describe("Phase 9 — scorer integration", () => {
  it("reports exploration in the routing decision and never adds candidates (A38/A39 boundary)", async () => {
    const profiles = new ProviderProfileStore();
    const store = new EpisodeStore();
    // A mediocre-but-known runtime: the neutral-prior unknown is competitive with it.
    for (let index = 0; index < 8; index++) store.append(episode("web:known", 0.5, index));
    profiles.rebuild(store.all(), { builtAt: at });

    const scorer = new AdaptiveScorer({
      profiles,
      flags: LEARNING_ON,
      now: () => at,
      decisionIdProvider: () => "rd-explore",
      exploration: { epsilon: 1, uncertaintyBonus: 0.5 }
    });
    const result = scorer.rerank({ taskId: "t", role: "planner" }, [
      { runtimeId: "web:known", rank: 0, reason: "static" },
      { runtimeId: "web:unknown", rank: 1, reason: "static" }
    ])!;
    expect(result.decision.exploration?.enabled).toBe(true);
    expect(result.decision.exploration?.reason).toContain("exploration");
    expect(result.ordered.map((item) => item.runtimeId).sort()).toEqual(["web:known", "web:unknown"]); // same set, only reordered
  });

  it("exploration never restores a runtime the hard layer excluded", async () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime("web:a"));
    registry.register(runtime("web:b"));
    const budgets = new BudgetManager();
    await registry.refreshHealth();
    const scorer = new AdaptiveScorer({ profiles: new ProviderProfileStore(), flags: LEARNING_ON, now: () => at, exploration: { epsilon: 1 } });
    const router = new RoleRouter(registry, budgets, undefined, scorer);
    const routed = router.route({ role: "planner", excludedRuntimes: ["web:b"] });
    expect(routed.map((candidate) => candidate.runtimeId)).toEqual(["web:a"]);
  });
});
