/**
 * Engine Phase 4 evidence test — task fingerprint.
 * An OPEN fingerprint (no topic enum), deterministic structural hash, and an
 * optional embedding backend that degrades to the structural fingerprint when
 * missing, slow or malformed.
 */
import { describe, expect, it } from "vitest";
import {
  TASK_FINGERPRINT_VERSION,
  buildStructuralFingerprint,
  deriveContextScale,
  deriveExternalEffectLevel,
  deriveModalities,
  deriveSpecificity,
  structuralHashOf
} from "../../src/shared/task-fingerprint";
import { MemoryVectorStore, TaskFingerprinter, type EmbeddingBackend } from "../../electron/learning/task-fingerprint";

describe("Phase 4 — structural fingerprint", () => {
  it("is deterministic and free of any topic enum", () => {
    const input = { role: "coder", capabilities: ["coding"], goal: "refactor the loader module and keep tests passing", executionRiskLevel: "medium" as const };
    const first = buildStructuralFingerprint(input);
    const second = buildStructuralFingerprint(input);
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(1);
    expect(first.fingerprintVersion).toBe(TASK_FINGERPRINT_VERSION);
    expect(first.structuralHash).toMatch(/^[0-9a-f]{8}$/);
    // no hard-coded topic vocabulary is used as a schema field
    expect(Object.keys(first)).not.toContain("topics");
    expect(Object.keys(first)).not.toContain("category");
  });

  it("capability and modality order does not change the hash", () => {
    const a = buildStructuralFingerprint({ role: "coder", capabilities: ["coding", "validation"], goal: "implement tests" });
    const b = buildStructuralFingerprint({ role: "coder", capabilities: ["validation", "coding"], goal: "implement tests" });
    expect(a.structuralHash).toBe(b.structuralHash);
  });

  it("derives specificity, modality, context scale and external effect deterministically", () => {
    expect(deriveSpecificity("fix it")).toBeLessThan(deriveSpecificity("refactor the provider adapter and add regression tests for the retry ladder"));
    expect(deriveModalities("implement the module and run tests")).toContain("code");
    expect(deriveModalities("summarize this report")).toContain("text");
    expect(deriveModalities(undefined)).toEqual(["text"]); // never empty
    expect(deriveContextScale(undefined)).toBe(0);
    expect(deriveContextScale(20)).toBeGreaterThan(0);
    expect(deriveContextScale(2_000_000)).toBeLessThanOrEqual(1);
    expect(deriveExternalEffectLevel({ executionRiskLevel: "low" })).toBe(0.1);
    expect(deriveExternalEffectLevel({ executionRiskLevel: "low", goal: "delete the production database" })).toBeGreaterThanOrEqual(0.9);
    expect(deriveExternalEffectLevel({ executionRiskLevel: "high", externalEffectLevel: 5 })).toBe(1);
  });

  it("concept references ride along without changing the structural hash", () => {
    const base = buildStructuralFingerprint({ role: "planner", capabilities: ["planning"], goal: "plan the migration" });
    const withConcepts = buildStructuralFingerprint({
      role: "planner",
      capabilities: ["planning"],
      goal: "plan the migration",
      concepts: [{ conceptId: "C-018", similarity: 0.9, confidence: 0.5 }]
    });
    expect(withConcepts.structuralHash).toBe(base.structuralHash); // concepts are learned, not structural
    expect(withConcepts.concepts?.[0].conceptId).toBe("C-018");
  });

  it("hash helper is stable across calls and sensitive to content", () => {
    expect(structuralHashOf(["a", 1])).toBe(structuralHashOf(["a", 1]));
    expect(structuralHashOf(["a", 1])).not.toBe(structuralHashOf(["a", 2]));
    expect(structuralHashOf([undefined, "x"])).toBe(structuralHashOf(["", "x"]));
  });
});

describe("Phase 4 — embeddable fingerprinter with graceful degradation", () => {
  const input = { role: "researcher", capabilities: ["research"], goal: "summarize the literature on retry ladders" };

  it("uses the semantic backend when available and stores the vector by reference", async () => {
    const store = new MemoryVectorStore();
    const backend: EmbeddingBackend = { id: "test-embed", embed: () => [0.1, 0.2, 0.3] };
    const fingerprinter = new TaskFingerprinter({ backend, store });
    const result = await fingerprinter.build(input);
    expect(result.semantic).toBe(true);
    expect(result.fingerprint.semanticVectorRef).toBeDefined();
    expect(store.get(result.fingerprint.semanticVectorRef!)?.length).toBe(3);
    expect(result.fingerprint.structuralHash).toBe(buildStructuralFingerprint(input).structuralHash); // structure unchanged
  });

  it("falls back to the structural fingerprint when no backend is configured", async () => {
    const result = await new TaskFingerprinter().build(input);
    expect(result.semantic).toBe(false);
    expect(result.fingerprint.semanticVectorRef).toBeUndefined();
    expect(result.notes.join(" ")).toContain("structural fingerprint only");
  });

  it("falls back when the backend throws", async () => {
    const backend: EmbeddingBackend = {
      id: "broken",
      embed: () => {
        throw new Error("backend exploded");
      }
    };
    const result = await new TaskFingerprinter({ backend }).build(input);
    expect(result.semantic).toBe(false);
    expect(result.notes.join(" ")).toContain("failed");
    expect(result.fingerprint.structuralHash).toBeTruthy(); // still usable
  });

  it("falls back when the backend returns a malformed vector", async () => {
    const backend: EmbeddingBackend = { id: "bad-shape", embed: () => [Number.NaN, 1] as number[] };
    const result = await new TaskFingerprinter({ backend }).build(input);
    expect(result.semantic).toBe(false);
    expect(result.notes.join(" ")).toContain("unusable vector");
  });

  it("falls back when the backend hangs beyond the timeout", async () => {
    const backend: EmbeddingBackend = { id: "hangs", embed: () => new Promise<number[]>(() => {}) };
    const result = await new TaskFingerprinter({ backend, timeoutMs: 25 }).build(input);
    expect(result.semantic).toBe(false);
    expect(result.notes.join(" ")).toContain("timed out");
  });

  it("skips the semantic step for an empty goal without failing", async () => {
    const backend: EmbeddingBackend = { id: "e", embed: () => [1] };
    const result = await new TaskFingerprinter({ backend }).build({ role: "planner", goal: "   " });
    expect(result.semantic).toBe(false);
    expect(result.notes.join(" ")).toContain("empty goal");
  });
});
