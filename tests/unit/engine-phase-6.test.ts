/**
 * Engine Phase 6 evidence test — adaptive scorer + RoleRouter integration.
 *
 * The adaptive layer may only SOFT-RANK hard-eligible candidates. Acceptance:
 * A23 (only eligible reordered), A24 (excluded never restored), A25
 * (capability-less never restored), A26 (pin keeps priority), A27 (scorer
 * exception ⇒ static route), A28 (profile DB broken ⇒ tasks still route),
 * A31 (historically low completion + high confidence ⇒ down-weighted),
 * A35 (explainable routing), A37 (adaptive off ⇒ deterministic order).
 */
import { describe, expect, it } from "vitest";
import { RoleRouter } from "../../electron/commander/role-router";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { AdaptiveScorer } from "../../electron/learning/routing/adaptive-scorer";
import { RoutingFeedbackLedger } from "../../electron/learning/routing/routing-feedback";
import { ProviderProfileStore } from "../../electron/learning/providers/behaviour-model";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";
import { DEFAULT_ADAPTIVE_FLAGS, resolveAdaptiveFlags } from "../../src/shared/adaptive-flags";
import { expectedUtility, type AdaptiveRerankRequest, type AdaptiveReranker } from "../../src/shared/adaptive-routing";
import type { RuntimeAdapter, RuntimeResult } from "../../electron/runtimes/runtime";

const at = "2026-09-10T00:00:00.000Z";

function runtime(id: string, roles: RuntimeAdapter["capabilities"]["roles"]): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { roles, supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "ready", checkedAt: at };
    },
    async execute(request): Promise<RuntimeResult> {
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" };
    }
  };
}

function episode(runtimeId: string, covered: number, index: number): EpisodeAppendInput {
  const role = "planner";
  return {
    episodeId: `${runtimeId}-${index}`,
    taskId: `task-${index}`,
    jobId: `job-${index}`,
    timestamp: `2026-09-10T00:00:${String(index).padStart(2, "0")}.000Z`,
    canonicalGoalHash: "goal",
    taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf([role, "planning"]), role, capabilities: ["planning"] },
    runtimeId,
    provider: runtimeId.replace("web:", ""),
    surface: "web",
    role,
    runtimeStatus: "SUCCESS",
    semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }),
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: 100,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

const LEARNING_ON = () => resolveAdaptiveFlags({ adaptiveProviderLearning: true, adaptiveRouting: true, semanticOutcomeEvaluation: true });

/** Profiles where web:a is historically poor and web:b is historically strong. */
function profiles(): ProviderProfileStore {
  const store = new EpisodeStore();
  for (let index = 0; index < 8; index++) store.append(episode("web:a", 0.2, index));
  for (let index = 0; index < 8; index++) store.append(episode("web:b", 1, index + 100));
  const profileStore = new ProviderProfileStore();
  profileStore.rebuild(store.all(), { builtAt: at });
  return profileStore;
}

function routerWith(adaptive: AdaptiveReranker | undefined, ids: string[] = ["web:a", "web:b", "local:native"]): RoleRouter {
  const registry = new RuntimeRegistry();
  for (const id of ids) registry.register(runtime(id, ["planning", "coding"]));
  const budgets = new BudgetManager();
  void registry.refreshHealth();
  return new RoleRouter(registry, budgets, undefined, adaptive, () => ({ taskId: "task-adaptive" }));
}

describe("Phase 6 — expected utility", () => {
  it("is monotone in completion and penalised by restriction/blocking/latency", () => {
    const base = { completion: 1, quality: 1, goalFidelity: 1, restrictionImpact: 0, runtimeReliability: 1 };
    expect(expectedUtility(base)).toBeGreaterThan(expectedUtility({ ...base, completion: 0 }));
    expect(expectedUtility(base)).toBeGreaterThan(expectedUtility({ ...base, restrictionImpact: 1 }));
    expect(expectedUtility(base)).toBeGreaterThan(expectedUtility({ ...base, runtimeReliability: 0 }));
    expect(expectedUtility(base)).toBeGreaterThan(expectedUtility({ ...base, latencyMs: 10_000 }));
  });
});

describe("Phase 6 — scorer behaviour", () => {
  it("A31: a provider with historically low completion and high confidence is down-weighted", () => {
    const scorer = new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at, decisionIdProvider: () => "rd-1" });
    const request: AdaptiveRerankRequest = { taskId: "t", role: "planner" };
    const candidates = [
      { runtimeId: "web:a", rank: 0, reason: "static" },
      { runtimeId: "web:b", rank: 1, reason: "static" }
    ];
    const result = scorer.rerank(request, candidates)!;
    expect(result.ordered.map((item) => item.runtimeId)).toEqual(["web:b", "web:a"]);
    const a = result.decision.candidates.find((item) => item.runtimeId === "web:a")!;
    const b = result.decision.candidates.find((item) => item.runtimeId === "web:b")!;
    expect(a.expectedUtility!).toBeLessThan(b.expectedUtility!);
    expect(a.confidence).toBeGreaterThan(0.5); // high confidence ⇒ the down-weight is justified
  });

  it("candidates without a learned profile keep their static relative order (neutral prior, no punishment)", () => {
    const scorer = new AdaptiveScorer({ profiles: new ProviderProfileStore(), flags: LEARNING_ON, now: () => at, decisionIdProvider: () => "rd-2" });
    const candidates = [
      { runtimeId: "web:x", rank: 0, reason: "static" },
      { runtimeId: "web:y", rank: 1, reason: "static" }
    ];
    const result = scorer.rerank({ taskId: "t", role: "planner" }, candidates)!;
    expect(result.ordered.map((item) => item.runtimeId)).toEqual(["web:x", "web:y"]);
    expect(result.decision.candidates[0].explanation.join(" ")).toContain("neutral prior");
  });

  it("A37: adaptive routing disabled ⇒ scorer inert (deterministic order untouched)", () => {
    const scorer = new AdaptiveScorer({ profiles: profiles(), flags: () => DEFAULT_ADAPTIVE_FLAGS, now: () => at });
    expect(scorer.enabled()).toBe(false);
    expect(scorer.rerank({ taskId: "t", role: "planner" }, [{ runtimeId: "web:a", rank: 0, reason: "s" }])).toBeUndefined();
  });
});

describe("Phase 6 — RoleRouter integration", () => {
  it("A01/A37: with no reranker the router behaves exactly as before", async () => {
    const router = routerWith(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.route({ role: "planner" }).map((candidate) => candidate.runtimeId)).toEqual(["web:a", "web:b", "local:native"]);
    expect(router.adaptiveOutcome()?.adaptive).toBeUndefined();
  });

  it("A23: adaptive reorders only the candidates the hard layer approved", async () => {
    const router = routerWith(new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at, decisionIdProvider: () => "rd-3" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routed = router.route({ role: "planner" });
    const ids = routed.map((candidate) => candidate.runtimeId);
    expect(ids).toContain("web:a");
    expect(ids).toContain("web:b");
    expect(new Set(ids).size).toBe(ids.length);
    expect(router.adaptiveOutcome()?.adaptive?.usedFallbackRouter).toBe(false);
  });

  it("A24/A25: an excluded or capability-less runtime can never be restored by the reranker", async () => {
    const router = routerWith(new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const excluded = router.route({ role: "planner", excludedRuntimes: ["web:a"] });
    expect(excluded.map((candidate) => candidate.runtimeId)).not.toContain("web:a");
    const capabilityBound = router.route({ role: "planner", requiredCapabilities: ["critique"] });
    expect(capabilityBound).toEqual([]); // no runtime has critique ⇒ nothing to reorder
  });

  it("A26: an explicit pin keeps priority ahead of the learned ranking", async () => {
    const router = routerWith(new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pinned = router.route({ role: "planner", pinnedRuntime: "web:a" }); // web:a is the poorly-rated one
    expect(pinned[0].runtimeId).toBe("web:a");
    expect(pinned[0].reason).toBe("explicit pin");
  });

  it("A27: a throwing reranker falls back to the static order", async () => {
    const throwing: AdaptiveReranker = {
      rerank: () => {
        throw new Error("adaptive service exploded");
      }
    };
    const router = routerWith(throwing);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.route({ role: "planner" }).map((candidate) => candidate.runtimeId)).toEqual(["web:a", "web:b", "local:native"]);
  });

  it("A27: a reranker that tries to add/drop candidates is rejected", async () => {
    const cheating: AdaptiveReranker = {
      rerank: (_request, candidates) => ({
        ordered: [{ runtimeId: "web:injected", rank: 0, reason: "sneaky" }, ...candidates],
        decision: { decisionId: "rd-x", taskId: "t", policyVersion: "p", candidates: [], usedFallbackRouter: false }
      })
    };
    const router = routerWith(cheating);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routed = router.route({ role: "planner" });
    expect(routed.map((candidate) => candidate.runtimeId)).toEqual(["web:a", "web:b", "local:native"]);
  });

  it("A28: a corrupt/broken profile store still routes deterministically", async () => {
    const brokenProfiles = {
      resolve: () => {
        throw new Error("profile DB unavailable");
      }
    };
    const scorer = new AdaptiveScorer({ profiles: brokenProfiles, flags: LEARNING_ON, now: () => at });
    const router = routerWith(scorer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.route({ role: "planner" }).map((candidate) => candidate.runtimeId)).toEqual(["web:a", "web:b", "local:native"]);
  });

  it("A35: the routing decision explains why B was selected over A", () => {
    const ledger = new RoutingFeedbackLedger(undefined, () => at);
    const scorer = new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at, decisionIdProvider: () => "rd-explain" });
    const result = scorer.rerank({ taskId: "t-explain", role: "planner" }, [
      { runtimeId: "web:a", rank: 0, reason: "static" },
      { runtimeId: "web:b", rank: 1, reason: "static" }
    ])!;
    ledger.record(result.decision);
    const lines = ledger.explain("rd-explain");
    expect(lines[0]).toContain("selected web:b");
    expect(lines.join("\n")).toContain("completion");
    expect(lines.join("\n")).toContain("expected utility");
    expect(lines.some((line) => line.startsWith("web:a:"))).toBe(true);
  });

  it("feedback ledger links a decision to the episode it produced", () => {
    const ledger = new RoutingFeedbackLedger(undefined, () => at);
    const scorer = new AdaptiveScorer({ profiles: profiles(), flags: LEARNING_ON, now: () => at, decisionIdProvider: () => "rd-link" });
    const result = scorer.rerank({ taskId: "t-link", role: "planner" }, [{ runtimeId: "web:a", rank: 0, reason: "s" }, { runtimeId: "web:b", rank: 1, reason: "s" }])!;
    ledger.record(result.decision);
    ledger.attachEpisode("rd-link", "ep-9");
    expect(ledger.get("rd-link")?.episodeIds).toEqual(["ep-9"]);
    expect(ledger.latestForTask("t-link")?.decisionId).toBe("rd-link");
    expect(ledger.attachEpisode("missing", "ep-x")).toBeUndefined();
  });
});
