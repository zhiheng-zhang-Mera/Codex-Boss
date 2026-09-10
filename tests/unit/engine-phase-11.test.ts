/**
 * Engine Phase 11 evidence test — provider intelligence panel + owner controls.
 * The owner can inspect observed model identity (with provenance), provider
 * behaviour metrics, epochs, routing explanations and episode drill-down, and can
 * rebuild/reset derived data, disable adaptive routing while keeping learning
 * (A37) and disable learning while keeping cached profiles.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEpisodeDrilldown, buildProviderIntelligencePanel, strongSignalsOf } from "../../src/shared/provider-intelligence";
import { LearningService } from "../../electron/learning/learning-service";
import { ProviderProfileBuilder } from "../../electron/learning/providers/provider-profile";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { ModelObserver } from "../../electron/learning/providers/model-observer";
import { ModelSnapshotRegistry } from "../../electron/learning/providers/model-snapshot";
import { BehaviourEpochLedger } from "../../electron/learning/providers/behaviour-epoch";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { structuralHashOf } from "../../src/shared/task-fingerprint";
import type { BehaviourSample } from "../../electron/learning/providers/change-point-detector";

const at = "2026-09-10T00:00:00.000Z";

function episode(runtimeId: string, index: number, covered: number, overrides: Partial<EpisodeAppendInput> = {}): EpisodeAppendInput {
  return {
    episodeId: `${runtimeId}-${index}`,
    taskId: `task-${index}`,
    jobId: `job-${index}`,
    timestamp: `2026-09-10T00:00:${String(index).padStart(2, "0")}.000Z`,
    canonicalGoalHash: "goal",
    taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf(["planner", "planning"]), role: "planner", capabilities: ["planning"] },
    runtimeId,
    provider: runtimeId.replace("web:", ""),
    surface: "web",
    role: "planner",
    modelSnapshotId: overrides.modelSnapshotId,
    behaviourEpochId: overrides.behaviourEpochId,
    runtimeStatus: overrides.runtimeStatus ?? "SUCCESS",
    runtimeFailureCode: overrides.runtimeFailureCode,
    semanticEvaluation: overrides.semanticEvaluation ?? deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals: { deliverablesCovered: covered } }),
    artifactRefs: ["art-1"],
    evidenceRefs: ["ev-1"],
    durationMs: 250,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

describe("Phase 11 — panel projection", () => {
  it("projects providers with metrics, provenance and strong signals", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 6; index++) store.append(episode("web:chatgpt", index, 1));
    // web:weak hard-refuses: completion 0 with enough samples to be confident (10 ⇒ conf 0.67).
    for (let index = 0; index < 10; index++) {
      store.append(episode("web:weak", index + 10, 1, { semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "I can't help with that.", signals: { refusal: true } }) }));
    }
    const profiles = new ProviderProfileBuilder().buildAll(store.all(), { builtAt: at });
    const snapshots = new ModelSnapshotRegistry(undefined, () => at);
    snapshots.record(new ModelObserver().observe({ provider: "chatgpt", surface: "web", observedAt: at, uiSelectedModel: "Auto", networkModelId: "gpt-5-2026-08" }).identity);
    snapshots.record(new ModelObserver().observe({ provider: "weak", surface: "web", observedAt: at }).identity);

    const panel = buildProviderIntelligencePanel({
      generatedAt: at,
      controls: { learningEnabled: true, adaptiveRoutingEnabled: false, profileStale: false, degraded: [] },
      profiles,
      snapshots: snapshots.list(),
      epochs: [],
      decisions: [
        {
          decisionId: "rd-1",
          taskId: "task-1",
          policyVersion: "adaptive-policy-1.0.0",
          selectedRuntimeId: "web:chatgpt",
          usedFallbackRouter: false,
          candidates: [{ runtimeId: "web:chatgpt", expectedUtility: 0.9, confidence: 0.7, explanation: ["completion 1.000 (n=6)"] }]
        }
      ]
    });

    expect(panel.providers).toHaveLength(2);
    const chatgpt = panel.providers.find((row) => row.runtimeId === "web:chatgpt")!;
    expect(chatgpt.observedModelId).toBe("gpt-5-2026-08"); // structured metadata wins over Auto
    expect(chatgpt.observedModelProvenance).toBe("OBSERVED");
    expect(chatgpt.metrics.completion.mean).toBe(1);
    expect(chatgpt.sampleCount).toBe(6);
    expect(chatgpt.strongSignals.join(" ")).toContain("strong completion");

    const weak = panel.providers.find((row) => row.runtimeId === "web:weak")!;
    expect(weak.observedModelId).toBeUndefined(); // never fabricate
    expect(weak.observedModelProvenance).toBe("UNKNOWN");
    expect(weak.strongSignals.join(" ")).toContain("low completion");

    expect(panel.modelSnapshots).toHaveLength(2);
    expect(panel.modelSnapshots[0].provenance).toBeDefined();
    expect(panel.routing[0].candidates[0].explanation[0]).toContain("completion");
    expect(panel.controls.adaptiveRoutingEnabled).toBe(false);
  });

  it("projects epoch timeline and recent changes without leaking history", () => {
    let clock = at;
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    const scope = { provider: "chatgpt", surface: "web", selectedModel: "Auto", observedModelId: "gpt-5" };
    const stableSamples: BehaviourSample[] = Array.from({ length: 6 }, (_unused, index) => ({ episodeId: `s${index}`, timestamp: `2026-09-10T00:00:0${index}.000Z`, completion: 0.5, goalFidelity: 0.5, restrictionImpact: 0.5 }));
    ledger.observe(scope, stableSamples);
    clock = "2026-09-12T00:00:00.000Z";
    ledger.observe({ ...scope, observedModelId: "gpt-6" }, stableSamples);

    const panel = buildProviderIntelligencePanel({
      generatedAt: "2026-09-13T00:00:00.000Z",
      controls: { learningEnabled: true, adaptiveRoutingEnabled: true, profileStale: false, degraded: [] },
      profiles: [],
      snapshots: [],
      epochs: ledger.list(),
      decisions: [],
      latestEpisodeAtByRuntime: { "web:chatgpt": "2026-09-12T12:00:00.000Z" },
      recentWindowMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(panel.epochs).toHaveLength(2);
    expect(panel.epochs[0].open).toBe(false); // closed by the version change
    expect(panel.epochs[1].open).toBe(true);
    expect(panel.epochs[1].parentEpochId).toBe(panel.epochs[0].epochId);
  });

  it("episode drill-down marks whether an episode may feed the profile", () => {
    const usable = episode("web:a", 1, 1);
    const faulted = episode("web:a", 2, 1, { runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT", semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT" }) });
    const usableView = buildEpisodeDrilldown({ ...usable, semanticEvaluation: usable.semanticEvaluation });
    const faultedView = buildEpisodeDrilldown({ ...faulted, semanticEvaluation: faulted.semanticEvaluation });
    expect(usableView.contributesToProfile).toBe(true);
    expect(usableView.semanticOutcome).toBe("FULL_COMPLETION");
    expect(faultedView.contributesToProfile).toBe(false);
    expect(faultedView.runtimeFailureCode).toBe("TIMEOUT");
    expect(faultedView.axes?.restrictionImpact).toBe(0);
    expect(usableView.artifactRefs).toEqual(["art-1"]);
  });

  it("strong signals stay empty for an unobserved profile (no invented claims)", () => {
    const profile = new ProviderProfileBuilder().build({ runtimeId: "web:x" }, [], { builtAt: at });
    expect(strongSignalsOf(profile)).toEqual([]);
  });
});

describe("Phase 11 — owner controls (LearningService)", () => {
  function service(): LearningService {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p11-"));
    return new LearningService({ rootDir: dir, now: () => at });
  }

  it("rebuild produces profiles from episodes and reset keeps the episodes", () => {
    const learning = service();
    for (let index = 0; index < 5; index++) learning.recordEpisode(episode("web:a", index, 1));
    const rebuilt = learning.rebuildDerived(at);
    expect(rebuilt.profiles).toBeGreaterThan(0);
    expect(learning.panel(at).providers.length).toBeGreaterThan(0);

    const reset = learning.resetDerived();
    expect(reset.episodesKept).toBe(5); // source of truth preserved
    expect(learning.controlState().profiles).toBe(0);
    expect(learning.controlState().snapshots).toBe(0);
    // rebuildable
    expect(learning.rebuildDerived(at).profiles).toBeGreaterThan(0);
  });

  it("A37: adaptive routing can be disabled while learning continues", () => {
    const learning = service();
    learning.setLearning(true);
    learning.flags.set("adaptiveRouting", true);
    learning.recordEpisode(episode("web:a", 1, 1));

    const state = learning.setAdaptiveRouting(false);
    expect(state.flags.adaptiveRouting).toBe(false);
    expect(learning.adaptiveRoutingEnabled()).toBe(false);
    expect(learning.learningEnabled()).toBe(true); // learning untouched
    // learning keeps working: episodes still recorded
    learning.recordEpisode(episode("web:a", 2, 1));
    expect(learning.controlState().episodes).toBe(2);
  });

  it("learning can be disabled entirely while cached profiles remain readable", () => {
    const learning = service();
    learning.setLearning(true);
    learning.setAdaptiveRouting(true);
    for (let index = 0; index < 4; index++) learning.recordEpisode(episode("web:a", index, 1));
    learning.rebuildDerived(at);
    const before = learning.panel(at).providers.length;

    learning.setLearning(false);
    expect(learning.learningEnabled()).toBe(false);
    expect(learning.adaptiveRoutingEnabled()).toBe(false); // umbrella off ⇒ everything off
    expect(learning.panel(at).providers.length).toBe(before); // cached derived data still inspectable
    expect(learning.evaluator.evaluate({ runtimeStatus: "SUCCESS", content: "x" })).toBeUndefined(); // no new evaluation while disabled
  });

  it("panel is failure-isolated: a broken store degrades the panel, never throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p11-bad-"));
    fs.writeFileSync(path.join(dir, "provider-profiles.json"), "{ broken", "utf8");
    const learning = new LearningService({ rootDir: dir, now: () => at });
    const panel = learning.panel(at);
    expect(Array.isArray(panel.providers)).toBe(true);
    expect(panel.controls.degraded.join(" ")).toContain("unreadable");
  });

  it("control state reports the stable policy version and store counts", () => {
    const learning = service();
    const state = learning.controlState();
    expect(state.stablePolicyVersion).toBe("stable-1.0.0");
    expect(state.flags.adaptiveProviderLearning).toBe(false);
    expect(state.episodes).toBe(0);
  });
});
