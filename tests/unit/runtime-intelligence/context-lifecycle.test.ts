import { describe, expect, it } from "vitest";
import * as contextLifecycle from "../../../src/shared/runtime-intelligence/context-lifecycle";
import {
  CONTEXT_LIFECYCLE_AUTHORITY,
  CONTEXT_SCORE_WEIGHTS,
  CONTEXT_THRESHOLDS,
  placementFor,
  planContextLifecycle,
  planMovesWithoutLosing,
  requestRestore,
  scoreContextRecord,
  type ContextLifecycleInput
} from "../../../src/shared/runtime-intelligence/context-lifecycle";
import type { ContextLifecyclePlan, ContextRecord } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase F. The two claims that matter are about what does NOT happen: a cold or archived
 * record is still restorable, and no amount of low heat deletes knowledge. Both are
 * asserted, along with the budget behaviour that makes the plan useful (a record kept out
 * of the prompt is a retrieval candidate, not a casualty).
 */

const NOW = "2026-01-01T12:00:00.000Z";

function hoursAgo(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

function record(overrides: Partial<ContextRecord> & { id: string }): ContextRecord {
  return { kind: "transcript", tokens: 1000, lastUsedAt: hoursAgo(1), retrievalCount: 3, successContribution: 0.8, dependencyIds: [], confidence: 0.9, ...overrides };
}

function plan(input: Partial<ContextLifecycleInput> & { records: ContextRecord[] }): ContextLifecyclePlan {
  return planContextLifecycle({ taskId: "task-1", now: NOW, ...input });
}

describe("scoring is explicit about every term", () => {
  it("scores a recent, frequently retrieved, successful record highly", () => {
    const score = scoreContextRecord(record({ id: "c1" }), NOW);
    expect(score.score).toBeGreaterThan(0.5);
    expect(score.ageHours).toBeCloseTo(1, 6);
    expect(score.terms.map((term) => term.term)).toEqual(["recency", "usage", "success", "dependency", "confidence", "size"]);
  });

  it("scores an old, unused record low", () => {
    const stale = scoreContextRecord(record({ id: "c2", lastUsedAt: hoursAgo(24 * 60), retrievalCount: 0, successContribution: 0, confidence: 0.1 }), NOW);
    const fresh = scoreContextRecord(record({ id: "c3" }), NOW);
    expect(stale.score).toBeLessThan(fresh.score);
  });

  it("treats an unusable timestamp as not recent, rather than as fresh", () => {
    const score = scoreContextRecord(record({ id: "c4", lastUsedAt: "not-a-timestamp" }), NOW);
    expect(score.ageHours).toBe(Number.POSITIVE_INFINITY);
    expect(score.terms.find((term) => term.term === "recency")?.detail).toContain("not a usable timestamp");
    expect(score.terms.find((term) => term.term === "recency")?.weight).toBe(0);
  });

  it("penalises size so a huge record cannot win on recency alone", () => {
    const small = scoreContextRecord(record({ id: "small", tokens: 100 }), NOW);
    const large = scoreContextRecord(record({ id: "large", tokens: CONTEXT_THRESHOLDS.tokenSaturation * 2 }), NOW);
    expect(large.score).toBeLessThan(small.score);
    expect(CONTEXT_SCORE_WEIGHTS.sizePenalty).toBeGreaterThan(0);
  });
});

describe("the four tiers are reachable and each placement says why", () => {
  const records = [
    record({ id: "hot", lastUsedAt: hoursAgo(1) }),
    record({ id: "warm", lastUsedAt: hoursAgo(10), retrievalCount: 1, successContribution: 0.3, confidence: 0.5, tokens: 4000 }),
    record({ id: "cold", lastUsedAt: hoursAgo(24 * 10), retrievalCount: 1, successContribution: 0.2, confidence: 0.4, tokens: 6000 }),
    record({ id: "archived", lastUsedAt: hoursAgo(24 * 400), retrievalCount: 0, successContribution: 0, confidence: 0.05, tokens: 8000 })
  ];
  const lifecycle = plan({ records });

  it("injects the hot record, keeps candidates and cold storage, and archives the coldest", () => {
    expect(placementFor(lifecycle, "hot")?.action).toBe("INJECT_NOW");
    expect(placementFor(lifecycle, "hot")?.tier).toBe("HOT");
    expect(placementFor(lifecycle, "warm")?.action).toBe("CANDIDATE_RETRIEVAL");
    expect(placementFor(lifecycle, "cold")?.tier).toBe("COLD");
    expect(placementFor(lifecycle, "archived")?.tier).toBe("ARCHIVE");
    expect(lifecycle.archivedIds).toContain("archived");
  });

  it("gives every placement at least one reason", () => {
    for (const placement of lifecycle.placements) expect(placement.reasons.length).toBeGreaterThan(0);
    expect(placementFor(lifecycle, "archived")?.reasons.join(" ")).toContain("never deleted");
  });

  it("keeps a pinned record hot however cold its evidence is", () => {
    const pinned = plan({ records: [record({ id: "pinned", lastUsedAt: hoursAgo(24 * 500), retrievalCount: 0, successContribution: 0, confidence: 0, pinned: true })] });
    expect(placementFor(pinned, "pinned")?.tier).toBe("HOT");
    expect(placementFor(pinned, "pinned")?.reasons.join(" ")).toContain("pinned");
  });

  it("injects a record the task explicitly asked for", () => {
    const requested = plan({ records: [record({ id: "old", lastUsedAt: hoursAgo(24 * 500), retrievalCount: 0, successContribution: 0, confidence: 0 })], requestedIds: ["old"] });
    expect(placementFor(requested, "old")?.action).toBe("INJECT_NOW");
  });

  it("counts the injected tokens", () => {
    // Only `hot` is injected in this set, so the projection is exactly its size.
    expect(lifecycle.injectedIds).toEqual(["hot"]);
    expect(lifecycle.projectedInjectedTokens).toBe(1000);
  });
});

describe("the injection budget demotes rather than drops", () => {
  it("keeps a budget-exceeding record as a retrieval candidate and names the budget", () => {
    const records = [record({ id: "a", tokens: 1000, lastUsedAt: hoursAgo(1) }), record({ id: "b", tokens: 1000, lastUsedAt: hoursAgo(1), retrievalCount: 2 })];
    const lifecycle = plan({ records, hotTokenBudget: 1200 });
    const injected = lifecycle.injectedIds;
    expect(injected).toHaveLength(1);
    expect(lifecycle.candidateIds).toHaveLength(1);
    const demoted = lifecycle.placements.find((placement) => placement.id !== injected[0])!;
    expect(demoted.action).toBe("CANDIDATE_RETRIEVAL");
    expect(demoted.reasons.join(" ")).toContain("would exceed the 1200-token budget");
    // The demoted record is still in the plan, which is what "not dropped" means.
    expect(planMovesWithoutLosing(lifecycle, records)).toBe(true);
  });

  it("never exceeds the budget it was given", () => {
    const records = Array.from({ length: 10 }, (_, index) => record({ id: `r${index}`, tokens: 1000, lastUsedAt: hoursAgo(1) }));
    const lifecycle = plan({ records, hotTokenBudget: 3000 });
    expect(lifecycle.projectedInjectedTokens).toBeLessThanOrEqual(3000);
    expect(lifecycle.placements).toHaveLength(10);
  });
});

describe("a dependency floor keeps injected records fetchable", () => {
  it("lifts an archived dependency of an injected record to a retrieval candidate", () => {
    const records = [
      record({ id: "cited", lastUsedAt: hoursAgo(1), dependencyIds: ["source"] }),
      record({ id: "source", lastUsedAt: hoursAgo(24 * 400), retrievalCount: 0, successContribution: 0, confidence: 0.05 })
    ];
    const lifecycle = plan({ records });
    expect(placementFor(lifecycle, "cited")?.action).toBe("INJECT_NOW");
    expect(placementFor(lifecycle, "source")?.tier).toBe("WARM");
    expect(placementFor(lifecycle, "source")?.reasons.join(" ")).toContain("dependency floor");
  });

  it("leaves an archived record that nothing injected depends on alone", () => {
    const records = [record({ id: "hot", lastUsedAt: hoursAgo(1) }), record({ id: "unrelated", lastUsedAt: hoursAgo(24 * 400), retrievalCount: 0, successContribution: 0, confidence: 0.05 })];
    const lifecycle = plan({ records });
    expect(placementFor(lifecycle, "unrelated")?.tier).toBe("ARCHIVE");
  });
});

describe("cold and archived knowledge is always restorable", () => {
  const records = [record({ id: "hot" }), record({ id: "cold", lastUsedAt: hoursAgo(24 * 10), retrievalCount: 1, successContribution: 0.2, confidence: 0.4 }), record({ id: "archived", lastUsedAt: hoursAgo(24 * 400), retrievalCount: 0, successContribution: 0, confidence: 0.05 })];
  const lifecycle = plan({ records });

  it("marks every placement restorable, including ARCHIVE", () => {
    for (const placement of lifecycle.placements) expect(placement.restorable).toBe(true);
    expect(placementFor(lifecycle, "archived")?.restorable).toBe(true);
  });

  it("restores an archived record and says where it came from", () => {
    const restored = requestRestore(lifecycle, "archived");
    expect(restored.restorable).toBe(true);
    expect(restored.from).toBe("ARCHIVE");
    expect(restored.note).toContain("archiving changed where the record lives");
  });

  it("restores a cold record and reports its real tier", () => {
    const restored = requestRestore(lifecycle, "cold");
    expect(restored.from).toBe("COLD");
  });

  it("does not pretend to restore an id the plan never had", () => {
    const restored = requestRestore(lifecycle, "never-existed");
    expect(restored.restorable).toBe(true);
    expect(restored.note).toContain("nothing to restore");
  });

  it("declares that the plan deletes nothing, and keeps every record", () => {
    expect(lifecycle.deletesNothing).toBe(true);
    expect(planMovesWithoutLosing(lifecycle, records)).toBe(true);
    expect(lifecycle.placements.map((placement) => placement.id).sort()).toEqual(["archived", "cold", "hot"]);
  });

  it("exports no function that could delete knowledge", () => {
    const deleting = Object.keys(contextLifecycle).filter((name) => /delete|remove|purge|drop|destroy|evict/i.test(name));
    expect(deleting, `this module must not be able to delete knowledge: ${deleting.join(", ")}`).toEqual([]);
  });

  it("fires that control: a deleting export WOULD be caught", () => {
    const probe = { deleteRecord: () => undefined, purgeArchive: () => undefined, requestRestore: () => undefined };
    const deleting = Object.keys(probe).filter((name) => /delete|remove|purge|drop|destroy|evict/i.test(name));
    expect(deleting).toEqual(["deleteRecord", "purgeArchive"]);
  });

  it("carries the advisory authority and the schema version", () => {
    expect(lifecycle.authority).toBe(CONTEXT_LIFECYCLE_AUTHORITY);
    expect(lifecycle.authority).toBe("ADVISORY_ONLY");
    expect(lifecycle.schemaVersion).toBe(1);
    expect(lifecycle.kind).toBe("CONTEXT_LIFECYCLE_PLAN");
  });

  it("returns ids for injected, candidate and archived records", () => {
    expect(lifecycle.injectedIds).toEqual(["hot"]);
    expect(lifecycle.candidateIds).toEqual([]);
    expect(lifecycle.archivedIds).toEqual(["archived"]);
  });
});
