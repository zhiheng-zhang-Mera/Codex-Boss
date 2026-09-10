/**
 * Engine Phase 5 evidence test — provider behaviour profile.
 * Derived, rebuildable statistics from episodes: global/role baselines, concept
 * overrides (meaningful deviations only), confidence/uncertainty, no baked-in
 * brand stereotypes, pollution-free semantics and version cold-start priors.
 * Acceptance: A11, A12, A31 (confidence available for down-weighting), A33.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_METRIC, blendMetric, confidenceFor } from "../../src/shared/provider-profile";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { ProviderProfileBuilder, estimate } from "../../electron/learning/providers/provider-profile";
import { BehaviourModel, ProviderProfileStore } from "../../electron/learning/providers/behaviour-model";
import { structuralHashOf } from "../../src/shared/task-fingerprint";

const at = "2026-09-10T00:00:00.000Z";

function episode(overrides: Partial<EpisodeAppendInput> & { role?: string } = {}): EpisodeAppendInput {
  const role = overrides.role ?? "planner";
  return {
    episodeId: overrides.episodeId ?? `ep-${Math.random().toString(36).slice(2, 8)}`,
    taskId: overrides.taskId ?? "task-1",
    jobId: overrides.jobId ?? "job-1",
    timestamp: overrides.timestamp ?? at,
    canonicalGoalHash: overrides.canonicalGoalHash ?? "goal",
    taskFingerprint: overrides.taskFingerprint ?? {
      schemaVersion: 1,
      fingerprintVersion: "fingerprint-1.0.0",
      structuralHash: structuralHashOf([role, "planning"]),
      role,
      capabilities: ["planning"]
    },
    runtimeId: overrides.runtimeId ?? "web:chatgpt",
    provider: overrides.provider ?? "chatgpt",
    surface: overrides.surface ?? "web",
    role,
    modelSnapshotId: overrides.modelSnapshotId,
    behaviourEpochId: overrides.behaviourEpochId,
    runtimeStatus: overrides.runtimeStatus ?? "SUCCESS",
    runtimeFailureCode: overrides.runtimeFailureCode,
    semanticEvaluation: overrides.semanticEvaluation,
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: overrides.durationMs,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

function ok(covered: number, durationMs = 100) {
  return { semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }), durationMs };
}

describe("Phase 5 — statistics", () => {
  it("confidence grows with samples and never claims certainty", () => {
    expect(confidenceFor(0)).toBe(0);
    expect(confidenceFor(1)).toBeLessThan(confidenceFor(10));
    expect(confidenceFor(10_000)).toBeLessThanOrEqual(0.95);
    expect(estimate([], at)).toEqual({ ...EMPTY_METRIC, updatedAt: at });
  });

  it("no episodes ⇒ empty estimates, never a baked-in brand stereotype", () => {
    const builder = new ProviderProfileBuilder();
    const profile = builder.build({ runtimeId: "web:unknown-brand" }, [], { builtAt: at });
    for (const key of ["completion", "goalFidelity", "restrictionImpact", "runtimeReliability"] as const) {
      expect(profile.global[key]).toEqual({ ...EMPTY_METRIC, updatedAt: at });
      expect(profile.global[key].confidence).toBe(0);
    }
    expect(profile.builtFromEpisodeCount).toBe(0);
  });

  it("A12: rebuilding from identical episodes is deterministic (only rebuiltAt differs)", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 6; index++) store.append(episode({ episodeId: `e${index}`, ...ok(index < 3 ? 1 : 0.5) }));
    const builder = new ProviderProfileBuilder();
    const first = builder.buildAll(store.all(), { builtAt: at });
    const second = builder.buildAll(store.all(), { builtAt: at });
    expect(first).toEqual(second);
    expect(first[0].builderVersion).toBe(builder.builderVersion);
  });

  it("semantic metrics ignore runtime faults while runtimeReliability counts them", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 4; index++) store.append(episode({ episodeId: `ok${index}`, ...ok(1) }));
    for (let index = 0; index < 6; index++) {
      store.append(episode({
        episodeId: `fault${index}`,
        runtimeStatus: "RETRYABLE_FAILURE",
        runtimeFailureCode: "TIMEOUT",
        semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT" })
      }));
    }
    const profile = new ProviderProfileBuilder().build({ runtimeId: "web:chatgpt" }, store.all(), { builtAt: at });
    expect(profile.global.completion.samples).toBe(4); // 6 timeouts excluded
    expect(profile.global.completion.mean).toBe(1);
    expect(profile.global.restrictionImpact.mean).toBe(0);
    expect(profile.global.runtimeReliability.samples).toBe(10); // runtime layer counts all
    expect(profile.global.runtimeReliability.mean).toBe(0.4);
  });

  it("role baselines are persisted only with enough samples; concepts only when the deviation is meaningful", () => {
    const store = new EpisodeStore();
    const conceptFingerprint = (conceptId: string, role: string) => ({
      schemaVersion: 1 as const,
      fingerprintVersion: "fingerprint-1.0.0",
      structuralHash: structuralHashOf([role, conceptId]),
      role,
      capabilities: ["planning"],
      concepts: [{ conceptId, similarity: 0.9, confidence: 0.5 }]
    });
    // planner: high completion; coder: only 2 samples (below min 3)
    for (let index = 0; index < 4; index++) store.append(episode({ episodeId: `p${index}`, role: "planner", taskFingerprint: conceptFingerprint("C-018", "planner"), ...ok(1) }));
    for (let index = 0; index < 2; index++) store.append(episode({ episodeId: `c${index}`, role: "coder", taskFingerprint: conceptFingerprint("C-077", "coder"), ...ok(1) }));
    // C-041: low completion with enough samples ⇒ meaningful negative deviation
    for (let index = 0; index < 4; index++) store.append(episode({ episodeId: `x${index}`, role: "planner", taskFingerprint: conceptFingerprint("C-041", "planner"), ...ok(0.2) }));

    const profile = new ProviderProfileBuilder().build({ runtimeId: "web:chatgpt" }, store.all(), { builtAt: at });
    expect(Object.keys(profile.byRole)).toContain("planner");
    expect(Object.keys(profile.byRole)).not.toContain("coder");
    const overrides = profile.conceptOverrides.map((override) => override.conceptId);
    expect(overrides).toContain("C-041");
    expect(overrides).not.toContain("C-077"); // too few samples
    const c41 = profile.conceptOverrides.find((override) => override.conceptId === "C-041")!;
    expect(c41.deviation?.completion).toBeLessThan(-0.1); // persisted because meaningful
  });

  it("A33: a new model version inherits a decayed prior instead of a full reset or full inherit", () => {
    const prior = { mean: 0.4, confidence: 0.9, samples: 40, updatedAt: at };
    const fresh = { mean: 0.95, confidence: 0.5, samples: 3, updatedAt: at };
    const blended = blendMetric(prior, fresh, 0.5);
    expect(blended.mean).toBeGreaterThan(0.4); // moved toward the new evidence
    expect(blended.mean).toBeLessThan(0.95); // but the prior still has weight
    expect(blended.samples).toBe(3); // observed evidence count stays honest
    expect(blendMetric(prior, { ...EMPTY_METRIC, updatedAt: at }, 0.5).mean).toBe(0.4); // no new evidence ⇒ prior
    expect(blendMetric({ ...EMPTY_METRIC, updatedAt: at }, fresh, 0.5).mean).toBe(0.95); // no prior ⇒ evidence
  });
});

describe("Phase 5 — derived profile store + behaviour model", () => {
  it("A11: profiles can be deleted and rebuilt from episodes alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p5-"));
    const file = path.join(dir, "profiles.json");
    try {
      const store = new EpisodeStore();
      for (let index = 0; index < 5; index++) store.append(episode({ episodeId: `e${index}`, ...ok(1) }));
      const profiles = new ProviderProfileStore(file);
      const built = profiles.rebuild(store.all(), { builtAt: at });
      expect(built.length).toBeGreaterThan(0);

      profiles.clear(); // derived data deleted
      expect(profiles.count()).toBe(0);
      expect(store.count()).toBe(5); // episodes untouched

      const rebuilt = profiles.rebuild(store.all(), { builtAt: at });
      expect(rebuilt).toEqual(built); // identical rebuild
      expect(store.count()).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt profile store degrades to no profile (A28 precursor)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p5-bad-"));
    const file = path.join(dir, "profiles.json");
    try {
      fs.writeFileSync(file, "{ broken", "utf8");
      const store = new ProviderProfileStore(file);
      expect(store.count()).toBe(0);
      expect(store.status().degradedReason).toContain("unreadable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("behaviour model resolves role → global fallback and reports uncertainty", () => {
    const episodes = new EpisodeStore();
    for (let index = 0; index < 4; index++) episodes.append(episode({ episodeId: `e${index}`, role: "planner", ...ok(1) }));
    const profile = new ProviderProfileBuilder().build({ runtimeId: "web:chatgpt" }, episodes.all(), { builtAt: at });
    const model = new BehaviourModel(profile);
    expect(model.sampleCount()).toBe(4);
    expect(model.forRole("planner").completion.mean).toBe(1);
    expect(model.forRole("unseen-role").completion.mean).toBe(profile.global.completion.mean); // documented fallback
    expect(model.latentBehaviourVector()).toHaveLength(6);
    expect(model.uncertainty()).toBeGreaterThan(0);
    expect(model.uncertainty()).toBeLessThan(1);
    expect(new BehaviourModel(undefined).uncertainty()).toBe(1); // no profile ⇒ maximal uncertainty
  });

  it("resolve() prefers the most specific scope and falls back to runtime level", () => {
    const store = new ProviderProfileStore();
    const epochs = new EpisodeStore();
    epochs.append(episode({ episodeId: "m1", modelSnapshotId: "MS-1", behaviourEpochId: "EP-1", ...ok(1) }));
    epochs.append(episode({ episodeId: "m2", modelSnapshotId: undefined, behaviourEpochId: undefined, ...ok(0.5) }));
    store.rebuild(epochs.all(), { builtAt: at });
    const specific = store.resolve({ runtimeId: "web:chatgpt", modelSnapshotKey: "MS-1", behaviourEpochId: "EP-1" });
    expect(specific?.modelSnapshotKey).toBe("MS-1");
    const runtimeLevel = store.resolve({ runtimeId: "web:chatgpt", modelSnapshotKey: "MS-999" });
    expect(runtimeLevel).toBeDefined();
  });
});
