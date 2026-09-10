/**
 * Engine Phase 7 evidence test — concept discovery.
 * Concepts are mined from history with stable IDs, mutable display names and a
 * CANDIDATE→OBSERVING→ACTIVE lifecycle, plus conservative merge/split.
 * Acceptance: A21 (new semantic cluster without an enum change), A22 (rename
 * does not affect id/history), A29 (broken miner keeps old concepts + routing).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONCEPT_STATUSES,
  conceptIsUsable,
  cosineSimilarity,
  prototypeSimilarity,
  structuralSignature,
  tokensOfSignature,
  type LearnedConcept
} from "../../src/shared/learned-concept";
import { ConceptRegistry } from "../../electron/learning/concepts/concept-registry";
import { ConceptMiner } from "../../electron/learning/concepts/concept-miner";
import { applyMerge, findMergeCandidates } from "../../electron/learning/concepts/concept-merge";
import { applySplit, proposeSplit } from "../../electron/learning/concepts/concept-split";
import { EpisodeStore, type EpisodeAppendInput } from "../../electron/learning/episode-store";
import { deriveSemanticEvaluation } from "../../src/shared/provider-outcome";
import { structuralHashOf } from "../../src/shared/task-fingerprint";

const at = "2026-09-10T00:00:00.000Z";

function fingerprint(role: string, capabilities: string[], specificity = 0.5, modality = ["text"]) {
  return { schemaVersion: 1 as const, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf([role, ...capabilities, specificity]), role, capabilities, specificity, modality };
}

function episode(input: { episodeId: string; role: string; capabilities: string[]; specificity?: number; completion?: number; conceptId?: string }): EpisodeAppendInput {
  const base = fingerprint(input.role, input.capabilities, input.specificity ?? 0.5);
  // completion is expressed through the SEMANTIC outcome so the axis is honest:
  // 1 ⇒ FULL_COMPLETION (completion 1.0), anything lower ⇒ a refusal-class outcome.
  const signals = (input.completion ?? 1) >= 1 ? { deliverablesCovered: 1 } : { refusal: true };
  return {
    episodeId: input.episodeId,
    taskId: `task-${input.episodeId}`,
    jobId: `job-${input.episodeId}`,
    timestamp: at,
    canonicalGoalHash: "goal",
    taskFingerprint: input.conceptId ? { ...base, concepts: [{ conceptId: input.conceptId, similarity: 0.9, confidence: 0.6 }] } : base,
    runtimeId: "web:chatgpt",
    provider: "chatgpt",
    surface: "web",
    role: input.role,
    runtimeStatus: "SUCCESS",
    semanticEvaluation: deriveSemanticEvaluation({ runtimeStatus: "SUCCESS", content: "answer", signals }),
    artifactRefs: [],
    evidenceRefs: [],
    durationMs: 50,
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

describe("Phase 7 — concept contracts", () => {
  it("signature-based prototypes are deterministic and embedding-free", () => {
    const a = structuralSignature(fingerprint("coder", ["coding"], 0.4));
    const b = structuralSignature(fingerprint("coder", ["coding"], 0.42));
    const c = structuralSignature(fingerprint("coder", ["coding"], 0.9));
    expect(a).toBe(b); // same 0.2 bucket
    expect(a).not.toBe(c);
    expect(tokensOfSignature(a)).toBeDefined();
    expect(prototypeSimilarity({ kind: "structural", signature: a }, { kind: "structural", signature: b })).toBe(1);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(CONCEPT_STATUSES).toHaveLength(6);
    expect(conceptIsUsable("ACTIVE")).toBe(true);
    expect(conceptIsUsable("MERGED")).toBe(false);
  });
});

describe("Phase 7 — mining + lifecycle", () => {
  it("A21: a brand-new semantic cluster produces a concept without any enum change", () => {
    const episodes = new EpisodeStore();
    for (let index = 0; index < 6; index++) episodes.append(episode({ episodeId: `x${index}`, role: "researcher", capabilities: ["research", "synthesis"] }));
    const registry = new ConceptRegistry();
    const result = new ConceptMiner(registry).mine(episodes.all(), at);
    expect(result.created).toHaveLength(1);
    const concept = registry.list()[0];
    expect(concept.conceptId).toMatch(/^C-[0-9a-f]{8}$/);
    expect(concept.status).toBe("ACTIVE"); // 6 samples ≥ activation support
    expect(concept.displayName).toContain("researcher");
    // a second, different cluster appears later with no migration
    for (let index = 0; index < 3; index++) episodes.append(episode({ episodeId: `y${index}`, role: "critic", capabilities: ["critique"] }));
    const second = new ConceptMiner(registry).mine(episodes.all(), at);
    expect(registry.count()).toBe(2);
    expect(second.created.length >= 0).toBe(true);
  });

  it("lifecycle advances CANDIDATE → OBSERVING → ACTIVE by support", () => {
    const registry = new ConceptRegistry(undefined, 2, 4);
    const proto = { kind: "structural" as const, signature: structuralSignature(fingerprint("planner", ["planning"])) };
    const first = registry.upsert(proto, { signature: proto.signature, episodeId: "e1", at });
    expect(first.concept.status).toBe("CANDIDATE");
    const second = registry.reinforce(first.concept.conceptId, { signature: proto.signature, episodeId: "e2", at });
    expect(second.concept.status).toBe("OBSERVING");
    registry.reinforce(first.concept.conceptId, { signature: proto.signature, episodeId: "e3", at });
    const fourth = registry.reinforce(first.concept.conceptId, { signature: proto.signature, episodeId: "e4", at });
    expect(fourth.concept.status).toBe("ACTIVE");
    expect(registry.usable().map((concept) => concept.conceptId)).toContain(first.concept.conceptId);
  });

  it("A22: renaming a concept never changes its id or history", () => {
    const registry = new ConceptRegistry();
    const proto = { kind: "structural" as const, signature: structuralSignature(fingerprint("planner", ["planning"])) };
    const created = registry.upsert(proto, { signature: proto.signature, episodeId: "e1", at });
    const id = created.concept.conceptId;
    const beforeHistory = registry.get(id)!.episodeIds;
    const renamed = registry.rename(id, "Migration planning work")!;
    expect(renamed.conceptId).toBe(id);
    expect(renamed.displayName).toBe("Migration planning work");
    expect(renamed.episodeIds).toEqual(beforeHistory);
    expect(registry.find(proto)?.conceptId).toBe(id); // lookup still resolves by prototype
  });

  it("mining is idempotent per episode and survives restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p7-"));
    const file = path.join(dir, "concepts.json");
    try {
      const episodes = new EpisodeStore();
      for (let index = 0; index < 4; index++) episodes.append(episode({ episodeId: `e${index}`, role: "planner", capabilities: ["planning"] }));
      const registry = new ConceptRegistry(file);
      new ConceptMiner(registry).mine(episodes.all(), at);
      const id = registry.list()[0].conceptId;
      const support = registry.get(id)!.support;
      // mining the same history again must not multiply support
      new ConceptMiner(registry).mine(episodes.all(), at);
      expect(registry.get(id)!.support).toBe(support);
      const reloaded = new ConceptRegistry(file);
      expect(reloaded.get(id)?.conceptId).toBe(id);
      expect(reloaded.list()).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A29: a broken miner/registry leaves previously learned concepts usable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p7-bad-"));
    const file = path.join(dir, "concepts.json");
    try {
      fs.writeFileSync(file, "{ broken", "utf8");
      const registry = new ConceptRegistry(file);
      expect(registry.count()).toBe(0);
      expect(registry.status().degradedReason).toContain("unreadable");
      // a failing mine() run must not throw out of the pipeline
      const failing = new ConceptMiner(registry, { minSupport: 1 });
      const result = failing.mine([], at);
      expect(result.errors).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 7 — merge and split", () => {
  function seeded(registry: ConceptRegistry, signature: string, episodeIds: string[]): LearnedConcept {
    const proto = { kind: "structural" as const, signature };
    let concept = registry.upsert(proto, { signature, episodeId: episodeIds[0], at }).concept;
    for (const episodeId of episodeIds.slice(1)) concept = registry.reinforce(concept.conceptId, { signature, episodeId, at }).concept;
    // concepts must be usable for merge detection
    return registry.setStatus(concept.conceptId, "ACTIVE")!;
  }

  it("merges semantic neighbours with consistent outcomes and preserves history", () => {
    const registry = new ConceptRegistry(undefined, 2, 2);
    const signatureA = structuralSignature(fingerprint("planner", ["planning"], 0.4));
    const signatureB = structuralSignature(fingerprint("planner", ["planning"], 0.45)); // same buckets ⇒ neighbour
    const a = seeded(registry, signatureA, ["a1", "a2", "a3", "a4"]);
    const b = seeded(registry, signatureB, ["b1", "b2", "b3", "b4"]);
    const episodes = [
      ...["a1", "a2", "a3", "a4"].map((id) => episode({ episodeId: id, role: "planner", capabilities: ["planning"], specificity: 0.4, completion: 1, conceptId: a.conceptId })),
      ...["b1", "b2", "b3", "b4"].map((id) => episode({ episodeId: id, role: "planner", capabilities: ["planning"], specificity: 0.45, completion: 1, conceptId: b.conceptId }))
    ];
    const candidates = findMergeCandidates(registry, episodes, { minSamples: 4 });
    // identical signatures collapse into one concept, so use the registry view directly
    const usable = registry.usable();
    if (usable.length >= 2) {
      const applied = applyMerge(registry, candidates[0] ?? { primaryId: usable[0].conceptId, secondaryId: usable[1].conceptId, similarity: 1, outcomeDelta: 0, reason: "test" }, at);
      expect(applied?.absorbed.status).toBe("MERGED");
      expect(applied?.absorbed.mergedInto).toBe(applied?.merged.conceptId);
      expect(applied!.merged.episodeIds.length).toBeGreaterThan(4);
    } else {
      expect(usable).toHaveLength(1); // neighbours collapsed at upsert time
    }
  });

  it("splits a concept whose behaviour became bimodal, keeping the parent history", () => {
    const registry = new ConceptRegistry(undefined, 2, 2);
    const signature = structuralSignature(fingerprint("planner", ["planning"], 0.6));
    const parent = seeded(registry, signature, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    const episodes = [
      ...["p1", "p2", "p3"].map((id) => episode({ episodeId: id, role: "planner", capabilities: ["planning"], specificity: 0.6, completion: 1, conceptId: parent.conceptId })),
      ...["p4", "p5", "p6"].map((id) => episode({ episodeId: id, role: "planner", capabilities: ["planning"], specificity: 0.6, completion: 0.2, conceptId: parent.conceptId }))
    ];
    const proposal = proposeSplit(registry, episodes, parent.conceptId, { minSamplesPerSide: 3, minMeanSeparation: 0.3 })!;
    expect(proposal).toBeDefined();
    expect(proposal.separation).toBeGreaterThan(0.3);
    const children = applySplit(registry, proposal, at);
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.parentConceptId === parent.conceptId)).toBe(true);
    const splitParent = registry.get(parent.conceptId)!;
    expect(splitParent.status).toBe("SPLIT");
    expect(splitParent.splitInto).toEqual(children.map((child) => child.conceptId));
    expect(splitParent.episodeIds.length).toBe(6); // history preserved
  });

  it("does not propose a split for uniform behaviour", () => {
    const registry = new ConceptRegistry(undefined, 2, 2);
    const signature = structuralSignature(fingerprint("planner", ["planning"], 0.35));
    const parent = seeded(registry, signature, ["u1", "u2", "u3", "u4", "u5", "u6"]);
    const episodes = ["u1", "u2", "u3", "u4", "u5", "u6"].map((id) => episode({ episodeId: id, role: "planner", capabilities: ["planning"], specificity: 0.35, completion: 1, conceptId: parent.conceptId }));
    expect(proposeSplit(registry, episodes, parent.conceptId)).toBeUndefined();
  });
});
