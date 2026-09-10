/**
 * Engine Phase 2 evidence test — episode store.
 * Append-only observations, schemaVersion rows, full query surface, restart
 * durability, corrupt-row tolerance (learning degrades, Boss keeps running) and
 * evaluator revisions that never overwrite the original observation.
 * Acceptance: A09, A10 (+ rebuild readiness for A11/A12 in Phase 5).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { episodeContributesToProfile, isValidEpisode } from "../../src/shared/learning-episode";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";

const at = "2026-09-10T00:00:00.000Z";

function fingerprint(role: string, capabilities: string[], conceptIds: string[] = [], specificity = 0.5) {
  return {
    schemaVersion: 1 as const,
    fingerprintVersion: "fingerprint-1.0.0",
    structuralHash: structuralHashOf([role, ...capabilities, specificity]),
    role,
    capabilities,
    specificity,
    concepts: conceptIds.map((conceptId) => ({ conceptId, similarity: 0.9, confidence: 0.6 }))
  };
}

function episode(overrides: Partial<EpisodeAppendInput> = {}): EpisodeAppendInput {
  const role = overrides.role ?? "planner";
  return {
    episodeId: overrides.episodeId ?? `ep-${Math.random().toString(36).slice(2, 8)}`,
    taskId: overrides.taskId ?? "task-1",
    jobId: overrides.jobId ?? "job-1",
    timestamp: overrides.timestamp ?? at,
    canonicalGoalHash: overrides.canonicalGoalHash ?? "goal-hash-1",
    taskFingerprint: overrides.taskFingerprint ?? fingerprint(role, ["planning"]),
    runtimeId: overrides.runtimeId ?? "web:chatgpt",
    provider: overrides.provider ?? "chatgpt",
    surface: overrides.surface ?? "web",
    role,
    modelSnapshotId: overrides.modelSnapshotId,
    behaviourEpochId: overrides.behaviourEpochId,
    runtimeStatus: overrides.runtimeStatus ?? "SUCCESS",
    runtimeFailureCode: overrides.runtimeFailureCode,
    semanticEvaluation: overrides.semanticEvaluation,
    artifactRefs: overrides.artifactRefs ?? ["art-1"],
    evidenceRefs: overrides.evidenceRefs ?? ["ev-1"],
    durationMs: overrides.durationMs ?? 1000,
    resourceCost: overrides.resourceCost,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

describe("Phase 2 — episode contract", () => {
  it("validates rows structurally and exposes a profile-contribution predicate", () => {
    const row = { schemaVersion: 1 as const, ...episode({ semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "ok" }) }) };
    expect(isValidEpisode(row)).toBe(true);
    expect(isValidEpisode({ ...row, schemaVersion: 2 })).toBe(false);
    expect(isValidEpisode({})).toBe(false);
    expect(episodeContributesToProfile(row)).toBe(true);
    const unclassified = { ...row, semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT" }) };
    expect(episodeContributesToProfile(unclassified)).toBe(false); // runtime faults never feed profiles
  });
});

describe("Phase 2 — durable store", () => {
  it("A09: episodes are queryable by task/job/runtime/model/epoch/time/fingerprint/concept", () => {
    const store = new EpisodeStore();
    store.append(episode({ episodeId: "e1", runtimeId: "web:chatgpt", provider: "chatgpt", modelSnapshotId: "MS-1", behaviourEpochId: "EP-1", taskId: "t1", jobId: "j1", timestamp: "2026-09-10T00:00:00.000Z", taskFingerprint: fingerprint("planner", ["planning"], ["C-018"]) }));
    store.append(episode({ episodeId: "e2", runtimeId: "api:claude", provider: "claude", modelSnapshotId: "MS-2", taskId: "t2", jobId: "j2", timestamp: "2026-09-10T01:00:00.000Z", taskFingerprint: fingerprint("coder", ["coding"]) }));
    store.append(episode({ episodeId: "e3", runtimeId: "web:chatgpt", provider: "chatgpt", modelSnapshotId: "MS-1", behaviourEpochId: "EP-2", taskId: "t3", jobId: "j3", timestamp: "2026-09-10T02:00:00.000Z", taskFingerprint: fingerprint("planner", ["planning"], ["C-041"]) }));

    expect(store.query({ runtimeId: "web:chatgpt" }).map((row) => row.episodeId)).toEqual(["e1", "e3"]);
    expect(store.query({ provider: "claude" }).map((row) => row.episodeId)).toEqual(["e2"]);
    expect(store.query({ modelSnapshotId: "MS-1" }).map((row) => row.episodeId)).toEqual(["e1", "e3"]);
    expect(store.query({ behaviourEpochId: "EP-1" }).map((row) => row.episodeId)).toEqual(["e1"]);
    expect(store.query({ taskId: "t2" }).map((row) => row.episodeId)).toEqual(["e2"]);
    expect(store.query({ jobId: "j3" }).map((row) => row.episodeId)).toEqual(["e3"]);
    expect(store.query({ conceptId: "C-018" }).map((row) => row.episodeId)).toEqual(["e1"]);
    expect(store.query({ structuralHash: fingerprint("coder", ["coding"]).structuralHash }).map((row) => row.episodeId)).toEqual(["e2"]);
    expect(store.query({ from: "2026-09-10T01:30:00.000Z" }).map((row) => row.episodeId)).toEqual(["e3"]);
    expect(store.query({ to: "2026-09-10T00:30:00.000Z" }).map((row) => row.episodeId)).toEqual(["e1"]);
    expect(store.query({ limit: 1 }).map((row) => row.episodeId)).toEqual(["e1"]);
  });

  it("A10: restart keeps every observation (append-only JSONL)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p2-"));
    try {
      const first = new EpisodeStore(dir, { now: () => at });
      first.append(episode({ episodeId: "e1" }));
      first.append(episode({ episodeId: "e2" }));
      const second = new EpisodeStore(dir, { now: () => at });
      expect(second.count()).toBe(2);
      expect(second.query().map((row) => row.episodeId)).toEqual(["e1", "e2"]);
      // appending after restart continues the same file
      second.append(episode({ episodeId: "e3" }));
      expect(new EpisodeStore(dir).count()).toBe(3);
      const lines = fs.readFileSync(path.join(dir, "episodes.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt rows degrade learning without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p2-bad-"));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "episodes.jsonl"), `${JSON.stringify({ schemaVersion: 1, ...episode({ episodeId: "good" }) })}\nnot-json\n{"schemaVersion":9}\n`, "utf8");
      const store = new EpisodeStore(dir);
      expect(store.count()).toBe(1);
      expect(store.status().degradedReason).toContain("invalid episode row");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid episode instead of storing garbage", () => {
    const store = new EpisodeStore();
    expect(() => store.append({ ...episode(), episodeId: "" })).toThrow();
    expect(store.count()).toBe(0);
  });

  it("evaluator revisions append and never overwrite the original evaluation", () => {
    const store = new EpisodeStore(undefined, { now: () => "2026-09-10T03:00:00.000Z" });
    const original = deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "partial answer", signals: { deliverablesCovered: 0.5 } });
    store.append(episode({ episodeId: "e1", semanticEvaluation: original }));
    const revision = store.revise({ episodeId: "e1", revisedBy: "evaluator-v2", evaluatorVersion: "semantic-evaluator-2.0.0", reason: "re-checked deliverables" });
    expect(revision?.originalOutcome).toBe("PARTIAL_COMPLETION");
    expect(revision?.revised.evaluatorVersion).toBe("semantic-evaluator-2.0.0");
    expect(store.get("e1")?.semanticEvaluation).toEqual(original); // observation untouched
    expect(store.revisionsFor("e1")).toHaveLength(1);
    expect(store.revise({ episodeId: "missing", revisedBy: "x" })).toBeUndefined();
  });

  it("rebuild readiness: aggregate replay from stored rows is deterministic (A11/A12 precursor)", () => {
    const store = new EpisodeStore();
    for (let index = 0; index < 10; index++) {
      store.append(episode({
        episodeId: `e${index}`,
        timestamp: `2026-09-10T00:00:${String(index).padStart(2, "0")}.000Z`,
        semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: `answer ${index}`, signals: { deliverablesCovered: index < 4 ? 1 : 0.5 } })
      }));
    }
    // runtime faults injected: must not change the semantic aggregate
    for (let index = 0; index < 5; index++) {
      store.append(episode({
        episodeId: `fault${index}`,
        timestamp: `2026-09-10T01:00:${String(index).padStart(2, "0")}.000Z`,
        runtimeStatus: "RETRYABLE_FAILURE",
        runtimeFailureCode: "TIMEOUT",
        semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "RETRYABLE_FAILURE", runtimeFailureCode: "TIMEOUT" })
      }));
    }
    const replay = (source: EpisodeStore) => {
      const usable = source.query({ semanticOnly: true });
      const completion = usable.reduce((sum, row) => sum + (row.semanticEvaluation?.axes.completion ?? 0), 0) / usable.length;
      const restriction = usable.reduce((sum, row) => sum + (row.semanticEvaluation?.axes.restrictionImpact ?? 0), 0) / usable.length;
      const goalFidelity = usable.reduce((sum, row) => sum + (row.semanticEvaluation?.axes.goalFidelity ?? 0), 0) / usable.length;
      return { samples: usable.length, completion: Number(completion.toFixed(4)), restriction: Number(restriction.toFixed(4)), goalFidelity: Number(goalFidelity.toFixed(4)) };
    };
    const withFaults = replay(store);

    // Control store: the same 10 semantic rows WITHOUT the 5 runtime faults.
    const control = new EpisodeStore();
    for (const row of store.query({ semanticOnly: true })) control.append({ ...row, schemaVersion: 1 });

    expect(replay(control)).toEqual(withFaults); // timeouts changed nothing (statistical pollution guard)
    expect(withFaults.samples).toBe(10); // 5 timeout rows excluded from semantic aggregation
    expect(withFaults.completion).toBe(0.7); // (4×1 + 6×0.5)/10
    expect(withFaults.restriction).toBe(0.03); // partial-completion baseline only, no timeout penalty
    expect(replay(store)).toEqual(withFaults); // repeatable rebuild
  });
});
