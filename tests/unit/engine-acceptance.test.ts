/**
 * Engine acceptance battery — Update-Plan/Engine/03-ACCEPTANCE-MATRIX.md.
 *
 * Covers the items not already asserted directly by the per-phase suites:
 *  - the mandatory failure-injection battery (learning degrades ≠ Boss crashes),
 *  - the statistical-pollution proof (100× TIMEOUT/AUTH/PAGE_CHANGED),
 *  - the version-isolation scenario (epoch 1 vs epoch 2 of the same model),
 *  - multi-device aggregation with device health kept out of provider behaviour.
 *
 * Each `it` names the acceptance ID(s) it discharges.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { LearningService } from "../../electron/learning/learning-service";
import { ProviderProfileBuilder } from "../../electron/learning/providers/provider-profile";
import { BehaviourModel, ProviderProfileStore } from "../../electron/learning/providers/behaviour-model";
import { AdaptiveScorer } from "../../electron/learning/routing/adaptive-scorer";
import { BehaviourEpochLedger } from "../../electron/learning/providers/behaviour-epoch";
import { ConceptMiner } from "../../electron/learning/concepts/concept-miner";
import { ConceptRegistry } from "../../electron/learning/concepts/concept-registry";
import { RoleRouter } from "../../electron/commander/role-router";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";
import { DEFAULT_ADAPTIVE_FLAGS, resolveAdaptiveFlags } from "../../src/shared/adaptive-flags";
import type { RuntimeAdapter, RuntimeResult } from "../../electron/runtimes/runtime";

const at = "2026-09-10T00:00:00.000Z";
const ON = () => resolveAdaptiveFlags({ adaptiveProviderLearning: true, adaptiveRouting: true, semanticOutcomeEvaluation: true, modelIdentityObservation: true, behaviourEpochDetection: true });

function fakeRuntime(id: string): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { roles: ["planning", "coding", "research", "review", "synthesis", "validation", "critique"], supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "ready", checkedAt: at };
    },
    async execute(request): Promise<RuntimeResult> {
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" };
    }
  };
}

function episode(overrides: Partial<EpisodeAppendInput> & { index?: number } = {}): EpisodeAppendInput {
  const index = overrides.index ?? 0;
  return {
    episodeId: overrides.episodeId ?? `ep-${index}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: overrides.taskId ?? `task-${index}`,
    jobId: overrides.jobId ?? `job-${index}`,
    timestamp: overrides.timestamp ?? `2026-09-10T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    canonicalGoalHash: "goal",
    taskFingerprint: overrides.taskFingerprint ?? { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf(["planner", "planning"]), role: "planner", capabilities: ["planning"] },
    runtimeId: overrides.runtimeId ?? "web:p1",
    provider: overrides.provider ?? "p1",
    surface: overrides.surface ?? "web",
    nodeId: overrides.nodeId,
    causalSource: overrides.causalSource,
    role: overrides.role ?? "planner",
    modelSnapshotId: overrides.modelSnapshotId,
    behaviourEpochId: overrides.behaviourEpochId,
    runtimeStatus: overrides.runtimeStatus ?? "SUCCESS",
    runtimeFailureCode: overrides.runtimeFailureCode,
    semanticEvaluation: overrides.semanticEvaluation,
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: overrides.durationMs ?? 100,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

function ok(covered: number, index = 0): EpisodeAppendInput {
  return episode({ index, semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }) });
}

function runtimeFailure(code: string, index: number, causalSource?: EpisodeAppendInput["causalSource"]): EpisodeAppendInput {
  return episode({ index, runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: code, causalSource, semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: code }) });
}

describe("Engine acceptance — failure injection battery", () => {
  it("episode DB unavailable degrades learning without throwing (A28/A36)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-acc-f1-"));
    try {
      // Make the episode file a DIRECTORY so every append fails.
      fs.mkdirSync(path.join(dir, "episodes.jsonl"), { recursive: true });
      const store = new EpisodeStore(dir, { now: () => at });
      expect(() => store.append(ok(1))).not.toThrow();
      expect(store.status().degradedReason).toContain("append failed");
      // Boss-facing work continues: profiles can still be rebuilt (empty) and the panel renders.
      const learning = new LearningService({ rootDir: dir, now: () => at });
      expect(() => learning.panel(at)).not.toThrow();
      expect(learning.panel(at).providers).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("profile builder exception never reaches the router (A26/A27/A28)", async () => {
    const registry = new RuntimeRegistry();
    registry.register(fakeRuntime("web:a"));
    registry.register(fakeRuntime("web:b"));
    await registry.refreshHealth();
    const exploding = {
      resolve: () => {
        throw new Error("profile builder exception");
      }
    };
    const scorer = new AdaptiveScorer({ profiles: exploding, flags: ON, now: () => at });
    const router = new RoleRouter(registry, new BudgetManager(), undefined, scorer);
    expect(router.route({ role: "planner" }).map((candidate) => candidate.runtimeId)).toEqual(["web:a", "web:b"]);
  });

  it("concept miner that throws keeps previous concepts and basic routing (A29)", () => {
    const registry = new ConceptRegistry();
    const proto = { kind: "structural" as const, signature: structuralHashOf(["planner", "planning"]) };
    const created = registry.upsert(proto, { signature: proto.signature, episodeId: "e1", at });
    const brokenMiner = new ConceptMiner(
      {
        find: () => {
          throw new Error("miner exploded");
        },
        upsert: () => {
          throw new Error("miner exploded");
        },
        reinforce: () => {
          throw new Error("miner exploded");
        }
      } as unknown as ConceptRegistry,
      { minSupport: 1 }
    );
    expect(() => brokenMiner.mine([episode({ index: 1, taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: proto.signature, role: "planner", capabilities: ["planning"] } })], at)).not.toThrow();
    expect(registry.get(created.concept.conceptId)?.conceptId).toBe(created.concept.conceptId); // old knowledge kept
  });

  it("change-point detector / epoch ledger with corrupt state leaves tasks alone (A30)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-acc-f4-"));
    const file = path.join(dir, "epochs.json");
    try {
      fs.writeFileSync(file, "{ not json", "utf8");
      const ledger = new BehaviourEpochLedger(file, () => at);
      expect(ledger.status().degradedReason).toContain("unreadable");
      expect(ledger.current({ provider: "p1", surface: "web" })).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("all adaptive flags off is the default and the kill switch (A01/A36/A50)", () => {
    expect(DEFAULT_ADAPTIVE_FLAGS.adaptiveProviderLearning).toBe(false);
    const learning = new LearningService({ now: () => at });
    expect(learning.learningEnabled()).toBe(false);
    expect(learning.adaptiveRoutingEnabled()).toBe(false);
  });
});

describe("Engine acceptance — statistical pollution", () => {
  it("100× TIMEOUT/AUTH_REQUIRED/PAGE_CHANGED never depress semantic metrics", () => {
    const polluted = new EpisodeStore();
    const control = new EpisodeStore();
    // 40 genuine semantic observations in both stores.
    for (let index = 0; index < 40; index++) {
      polluted.append(ok(index % 4 === 0 ? 1 : 0.5, index));
      control.append(ok(index % 4 === 0 ? 1 : 0.5, index));
    }
    // 100 runtime-layer faults only in the polluted store.
    for (let index = 0; index < 34; index++) polluted.append(runtimeFailure("TIMEOUT", 100 + index));
    for (let index = 0; index < 33; index++) polluted.append(runtimeFailure("AUTH_REQUIRED", 200 + index));
    for (let index = 0; index < 33; index++) polluted.append(runtimeFailure("PAGE_CHANGED", 300 + index));

    const builder = new ProviderProfileBuilder();
    const a = builder.build({ runtimeId: "web:p1" }, polluted.all(), { builtAt: at });
    const b = builder.build({ runtimeId: "web:p1" }, control.all(), { builtAt: at });

    expect(polluted.count()).toBe(140);
    // semantic metrics are IDENTICAL to the fault-free control
    expect(a.global.completion).toEqual(b.global.completion);
    expect(a.global.goalFidelity).toEqual(b.global.goalFidelity);
    expect(a.global.restrictionImpact).toEqual(b.global.restrictionImpact);
    expect(a.global.completion.samples).toBe(40);
    expect(a.global.restrictionImpact.mean).toBeLessThan(0.1); // no fabricated restriction penalty
    // runtime reliability IS affected (it is a runtime-layer metric) — and correctly so.
    expect(a.global.runtimeReliability.mean).toBeLessThan(b.global.runtimeReliability.mean);
  });

  it("A47/A48: node contributions aggregate into one store, device faults stay out of provider behaviour", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 4; index++) store.append({ ...ok(1, index), nodeId: "node-a" });
    for (let index = 0; index < 4; index++) store.append({ ...ok(0.5, 100 + index), nodeId: "node-b" });
    // A laptop network timeout contributes NO provider evidence.
    store.append({ ...runtimeFailure("TIMEOUT", 200, "NETWORK"), nodeId: "node-b" });

    expect(store.query({ nodeId: "node-a" })).toHaveLength(4);
    expect(store.query({ nodeId: "node-b" })).toHaveLength(5);

    const profile = new ProviderProfileBuilder().build({ runtimeId: "web:p1" }, store.all(), { builtAt: at });
    expect(profile.global.completion.samples).toBe(8); // both nodes' semantic observations
    expect(profile.global.runtimeReliability.samples).toBe(8); // the NETWORK-attributed fault is excluded
    expect(profile.global.runtimeReliability.mean).toBe(1);

    const withoutDevice = new ProviderProfileBuilder().build({ runtimeId: "web:p1" }, store.query({ providerAttributedOnly: true }), { builtAt: at });
    expect(withoutDevice.global.completion).toEqual(profile.global.completion); // device fault never moved semantics
  });
});

describe("Engine acceptance — version isolation", () => {
  it("epoch 2 of the same model converges to the new behaviour while epoch 1 stays queryable (A33/A34)", () => {
    let clock = "2026-09-10T00:00:00.000Z";
    const store = new EpisodeStore();
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    const scope = { provider: "p1", surface: "web", selectedModel: "Auto", observedModelId: "model-A" };
    const epoch1 = ledger.observe(scope, [], {}).epoch;

    // 50 episodes at completion 0.5 on model-A epoch 1
    for (let index = 0; index < 50; index++) {
      store.append({ ...ok(0.5, index), behaviourEpochId: epoch1.epochId, modelSnapshotId: "MS-A" });
    }
    // The observed model changes → new epoch (A18/A19 boundary)
    clock = "2026-09-11T00:00:00.000Z";
    const epoch2 = ledger.observe({ ...scope, observedModelId: "model-B" }, [], {}).epoch;
    expect(epoch2.parentEpochId).toBe(epoch1.epochId);
    // 50 episodes at completion 0.95 on the new version
    for (let index = 0; index < 50; index++) {
      store.append({ ...ok(1, 100 + index), behaviourEpochId: epoch2.epochId, modelSnapshotId: "MS-B" });
    }

    const builder = new ProviderProfileBuilder();
    const profileEpoch2 = builder.build({ runtimeId: "web:p1", modelSnapshotKey: "MS-B", behaviourEpochId: epoch2.epochId }, store.all(), { builtAt: clock });
    const profileEpoch1 = builder.build({ runtimeId: "web:p1", modelSnapshotKey: "MS-A", behaviourEpochId: epoch1.epochId }, store.all(), { builtAt: clock });

    // epoch 2's current prediction is close to the new behaviour
    expect(profileEpoch2.global.completion.mean).toBeGreaterThan(0.9);
    // epoch 1 history remains separately queryable
    expect(profileEpoch1.global.completion.mean).toBeCloseTo(0.5, 2);
    expect(profileEpoch1.builtFromEpisodeCount).toBe(50);

    // version-aware routing resolves the epoch-specific profile, not the family average
    const profiles = new ProviderProfileStore();
    profiles.rebuild(store.all(), { builtAt: clock });
    const resolved = profiles.resolve({ runtimeId: "web:p1", modelSnapshotKey: "MS-B", behaviourEpochId: epoch2.epochId });
    expect(resolved?.modelSnapshotKey).toBe("MS-B");
    const model = new BehaviourModel(resolved);
    expect(model.global("completion").mean).toBeGreaterThan(0.9); // not diluted by the old version
    expect(profiles.list().length).toBeGreaterThan(1); // family aggregate still displayable
  });
});
