import { describe, expect, it } from "vitest";
import { buildBlindEvaluationPack, summarizeBlindScores, type BlindEvaluationItemInput } from "../../src/shared/evaluation";

const SAMPLE: BlindEvaluationItemInput[] = [
  { recordId: "r1", producer: "boss", goldenId: "g1", complexity: "medium", prompt: "fix the flaky test", output: "patched retry logic with evidence" },
  { recordId: "r2", producer: "single-ai", goldenId: "g1", complexity: "medium", prompt: "fix the flaky test", output: "removed the flaky assertion" },
  { recordId: "r3", producer: "boss", goldenId: "g2", complexity: "complex", prompt: "audit the repo", output: "found 3 issues, all with stack traces" },
  { recordId: "r4", producer: "single-ai", goldenId: "g2", complexity: "complex", prompt: "audit the repo", output: "looks fine to me" }
];

describe("blind evaluation pack (Overcomplete §10.4)", () => {
  it("anonymizes outputs, randomizes order with a seed, and keeps a decoding key", () => {
    const pack = buildBlindEvaluationPack({ items: SAMPLE, seed: 7 });
    expect(pack.items).toHaveLength(4);
    expect(pack.items.map((item) => item.itemId).every((id) => id.startsWith(pack.packId))).toBe(true);
    // No judge-facing item leaks producer/golden record ids.
    expect(JSON.stringify(pack.items)).not.toContain("boss");
    expect(JSON.stringify(pack.items)).not.toContain("single-ai");
    expect(JSON.stringify(pack.items)).not.toContain("r1");
    expect(Object.keys(pack.decodingKey)).toHaveLength(4);
    expect(pack.decodingKey[pack.items[0].itemId]).toBeDefined();
    // Deterministic for the same seed.
    expect(buildBlindEvaluationPack({ items: SAMPLE, seed: 7 }).items.map((item) => item.itemId)).toEqual(pack.items.map((item) => item.itemId));
  });

  it("randomizes judge-facing order for some seed (and is deterministic given it)", () => {
    const positionOf = (pack: { items: Array<{ itemId: string }>; decodingKey: Record<string, { recordId: string }> }, recordId: string) =>
      pack.items.findIndex((item) => pack.decodingKey[item.itemId].recordId === recordId);
    let found = false;
    for (let seed = 1; seed <= 25 && !found; seed++) {
      const pack = buildBlindEvaluationPack({ items: SAMPLE, seed });
      const order = SAMPLE.map((record) => positionOf(pack, record.recordId)).join();
      if (order !== "0,1,2,3") {
        found = true;
        const again = buildBlindEvaluationPack({ items: SAMPLE, seed });
        expect(again.items.map((item) => item.itemId)).toEqual(pack.items.map((item) => item.itemId));
      }
    }
    expect(found).toBe(true);
  });

  it("summarizes decoded judge scores per producer deterministically", () => {
    const pack = buildBlindEvaluationPack({ items: SAMPLE, seed: 7 });
    const entryFor = (recordId: string) => Object.entries(pack.decodingKey).find(([, decoded]) => decoded.recordId === recordId)![0];
    const scores = [
      { itemId: entryFor("r1"), metric: "task_completion", score: 5 },
      { itemId: entryFor("r3"), metric: "task_completion", score: 4 },
      { itemId: entryFor("r2"), metric: "task_completion", score: 2 },
      { itemId: entryFor("r4"), metric: "task_completion", score: 1 }
    ];
    const summary = summarizeBlindScores(scores, pack.decodingKey);
    expect(summary["boss"].count).toBe(2);
    expect(summary["single-ai"].count).toBe(2);
    expect(summary["boss"].average).toBe(4.5);
    expect(summary["single-ai"].average).toBe(1.5);
  });
});
