/**
 * Phase 10I evidence test: knowledge dedup & conflict.
 * Exact/semantic dedup; conflicting claims coexist explicitly marked (never
 * silently deleted); conflict record holds both claims + confidence/provenance;
 * resolution supersedes the loser (history kept) and promotes winner; stale
 * sweep marks temporal-validity-lapsed records STALE; durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareClaims, isStale, mergeClaims, type KnowledgeRecordVNext } from "../../src/shared/tenx/knowledge";
import { TenxKnowledgeSpace } from "../../electron/tenx/knowledge-space";
import { TenxKnowledgeConflicts } from "../../electron/tenx/knowledge-conflicts";

const at = "2026-09-10T00:00:00.000Z";

function record(overrides: Partial<KnowledgeRecordVNext> = {}): KnowledgeRecordVNext {
  return {
    knowledgeId: `k-${Math.random().toString(36).slice(2, 8)}`,
    content: "provider p1 latency is 50ms",
    source: "probe",
    artifactRef: "art-1",
    createdByNode: "node-a",
    createdAt: at,
    updatedAt: at,
    confidence: 0.8,
    scope: "global",
    validity: {},
    version: 1,
    provenance: { chain: ["art-1"] },
    state: "ACTIVE",
    ...overrides
  };
}

describe("10I pure comparison", () => {
  it("identical claims are not conflicts; similar-but-different claims are", () => {
    const a = record({ content: "p1 latency is 50ms" });
    const b = record({ content: "p1 latency is 50ms" });
    expect(compareClaims(a, b).conflict).toBe(false);
    const c = record({ content: "p1 latency is 100ms" });
    expect(compareClaims(a, c).conflict).toBe(true);
    expect(compareClaims(a, c).conflictGroup).toBeDefined();
  });

  it("source-aware merge takes higher confidence + longer content, concatenates provenance", () => {
    const a = record({ content: "p1 region east", confidence: 0.5, provenance: { chain: ["art-a"] } });
    const b = record({ content: "p1 region east; provider is reachable", confidence: 0.9, provenance: { chain: ["art-b"] } });
    const { merged, notes } = mergeClaims(a, b);
    expect(merged.confidence).toBe(0.9);
    expect(merged.content).toContain("reachable");
    expect(merged.provenance.chain).toEqual(["art-a", "art-b"]);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("isStale detects lapsed temporal validity", () => {
    const now = "2026-09-10T00:00:00.000Z";
    expect(isStale(record({ validity: { validUntil: "2026-01-01T00:00:00.000Z" } }), now)).toBe(true);
    expect(isStale(record({ validity: { validUntil: "2027-01-01T00:00:00.000Z" } }), now)).toBe(false);
    expect(isStale(record({ validity: {} }), now)).toBe(false);
  });
});

describe("10I durable conflict handling", () => {
  it("exact and semantic duplicates are gated before storage", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const conflicts = new TenxKnowledgeConflicts(store, undefined, () => at);
    const first = conflicts.submit(record({ content: "unique fact alpha beta gamma delta epsilon zeta" }));
    expect(first.outcome).toBe("new");
    const dup = conflicts.submit(record({ content: "unique fact alpha beta gamma delta epsilon zeta" }));
    expect(dup.outcome).toBe("exact-duplicate");
    // same token set in a different order → semantic duplicate (similarity 1.0, text differs)
    const semantic = conflicts.submit(record({ content: "alpha beta gamma delta epsilon zeta unique fact" }));
    expect(semantic.outcome).toBe("semantic-duplicate");
    expect(store.count()).toBe(1);
  });

  it("conflicting claims coexist, explicitly flagged, never silently deleted", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const conflicts = new TenxKnowledgeConflicts(store, undefined, () => at);
    const a = conflicts.submit(record({ content: "target model is gpt-4" }));
    const b = conflicts.submit(record({ content: "target model is gpt-5" }));
    expect(a.outcome).toBe("new");
    expect(b.outcome).toBe("conflict");
    expect(conflicts.unresolved().length).toBe(1);
    // both records still exist and are marked conflicting
    expect(store.count()).toBe(2);
    expect(store.list().every((item) => item.state === "CONFLICTING")).toBe(true);
    const conflict = conflicts.unresolved()[0];
    expect(conflict.claims.length).toBe(2);
    expect(conflict.claims.every((claim) => claim.content.startsWith("target model is"))).toBe(true);
    expect(conflict.claims.every((claim) => claim.provenance.chain.length > 0)).toBe(true);
  });

  it("resolution keeps the winner ACTIVE and supersedes the loser (history kept)", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const conflicts = new TenxKnowledgeConflicts(store, undefined, () => at);
    conflicts.submit(record({ content: "answer is 41", confidence: 0.6 }));
    const b = conflicts.submit(record({ content: "answer is 42", confidence: 0.9 }));
    expect(b.outcome).toBe("conflict");
    const conflict = conflicts.unresolved()[0];
    const resolved = conflicts.resolve(conflict.conflictId, "keep-b", "node-reviewer");
    expect(resolved.ok).toBe(true);
    const loserId = conflict.claims[0].knowledgeId;
    expect(store.get(loserId)).toBeUndefined(); // loser no longer live
    expect(store.history(loserId).some((item) => item.state === "SUPERSEDED")).toBe(true); // but preserved
    expect(store.list().length).toBe(1);
    expect(store.list()[0].content).toBe("answer is 42");
    expect(conflicts.unresolved().length).toBe(0);
  });

  it("stale sweep marks lapsed records STALE without deleting them", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const conflicts = new TenxKnowledgeConflicts(store, undefined, () => at);
    const staleRecord = store.contribute({ content: "old news", source: "probe", createdByNode: "node-a", validity: { validUntil: "2026-01-01T00:00:00.000Z" } });
    store.contribute({ content: "fresh news", source: "probe", createdByNode: "node-a", validity: { validUntil: "2030-01-01T00:00:00.000Z" } });
    const { stale } = conflicts.sweepStale();
    expect(stale).toEqual([staleRecord.knowledgeId]);
    expect(store.get(staleRecord.knowledgeId)).toBeUndefined(); // no longer live
    // preserved in history as STALE, never deleted
    expect(store.history(staleRecord.knowledgeId).some((item) => item.state === "STALE")).toBe(true);
  });

  it("durable restart restores unresolved conflicts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10i-"));
    const file = path.join(dir, "conflicts.json");
    try {
      const store = new TenxKnowledgeSpace(undefined, () => at);
      const first = new TenxKnowledgeConflicts(store, file, () => at);
      first.submit(record({ content: "route is A" }));
      first.submit(record({ content: "route is B" }));
      const second = new TenxKnowledgeConflicts(store, file, () => at);
      expect(second.unresolved().length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
