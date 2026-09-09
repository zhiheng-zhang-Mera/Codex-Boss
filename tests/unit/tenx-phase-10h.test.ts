/**
 * Phase 10H evidence test: knowledge pipeline.
 * Raw Event → Artifact-backed Candidate → Validation → Dedup → Knowledge
 * Record; raw events are never knowledge by themselves; invalid candidates are
 * parked with explicit verdicts (never crash); duplicates contribute once;
 * durable audit trail preserves stage outcomes.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { candidateFromEvent, validateCandidate, type RawKnowledgeEvent } from "../../src/shared/tenx/knowledge";
import { TenxKnowledgeSpace } from "../../electron/tenx/knowledge-space";
import { TenxKnowledgePipeline } from "../../electron/tenx/knowledge-pipeline";

const at = "2026-09-10T00:00:00.000Z";

function event(id: string, payload: unknown, nodeId = "node-a"): RawKnowledgeEvent {
  return { eventId: id, nodeId, kind: "provider-response", payload, occurredAt: at };
}

describe("10H pure validation", () => {
  it("raw events with non-string payloads never become candidates", () => {
    expect(candidateFromEvent(event("e1", { nested: true }))).toBeUndefined();
    expect(candidateFromEvent(event("e2", "plain text"))?.artifactRef).toBe("event:e2");
  });

  it("validation rejects empty/no-source/no-artifact candidates explicitly", () => {
    expect(validateCandidate({ candidateId: "c", artifactRef: "a", content: "", source: "s", nodeId: "n", proposedAt: at }).outcome).toBe("invalid-empty");
    expect(validateCandidate({ candidateId: "c", artifactRef: "a", content: "x", source: "", nodeId: "n", proposedAt: at }).outcome).toBe("invalid-no-provenance");
    expect(validateCandidate({ candidateId: "c", artifactRef: "", content: "x", source: "s", nodeId: "n", proposedAt: at }).outcome).toBe("invalid-no-provenance");
    expect(validateCandidate({ candidateId: "c", artifactRef: "a", content: "x", source: "s", nodeId: "n", proposedAt: at }).outcome).toBe("valid");
  });
});

describe("10H durable pipeline", () => {
  it("walks raw event → record and persists stage audit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10h-"));
    const file = path.join(dir, "pipeline.json");
    try {
      const store = new TenxKnowledgeSpace(undefined, () => at);
      const pipeline = new TenxKnowledgePipeline(store, file, () => at);
      const result = pipeline.process(event("e1", "provider p1 returned success for task t1"));
      expect(result.outcome).toBe("recorded");
      expect(store.count()).toBe(1);
      const audit = pipeline.audit();
      expect(audit.some((entry) => entry.stage === "CANDIDATE" && entry.status === "ok")).toBe(true);
      expect(audit.some((entry) => entry.stage === "VALIDATION" && entry.status === "ok")).toBe(true);
      expect(audit.some((entry) => entry.stage === "RECORD")).toBe(true);
      // restart keeps the audit
      const second = new TenxKnowledgePipeline(store, file, () => at);
      expect(second.audit().length).toBe(audit.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a raw event that is not artifact-backed (never direct knowledge)", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const pipeline = new TenxKnowledgePipeline(store, undefined, () => at);
    const result = pipeline.process(event("e2", { image: "raw-bytes" }));
    expect(result.outcome).toBe("invalid");
    expect(store.count()).toBe(0);
    expect(pipeline.audit().some((entry) => entry.stage === "CANDIDATE" && entry.status === "parked")).toBe(true);
  });

  it("parks an empty candidate with an explicit verdict; Boss unaffected", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const pipeline = new TenxKnowledgePipeline(store, undefined, () => at);
    const result = pipeline.process(event("e3", "   "));
    expect(result.outcome).toBe("invalid");
    expect(result.reason).toContain("empty");
    expect(pipeline.audit().some((entry) => entry.verdict?.outcome === "invalid-empty")).toBe(true);
    // pipeline still usable afterwards
    const ok = pipeline.process(event("e4", "valid knowledge after parked candidate"));
    expect(ok.outcome).toBe("recorded");
  });

  it("exact duplicates contribute only once", () => {
    const store = new TenxKnowledgeSpace(undefined, () => at);
    const pipeline = new TenxKnowledgePipeline(store, undefined, () => at);
    expect(pipeline.process(event("e5", "the same fact")).outcome).toBe("recorded");
    const dup = pipeline.process(event("e6", "the same fact"));
    expect(dup.outcome).toBe("duplicate");
    expect(store.count()).toBe(1);
    expect(pipeline.audit().some((entry) => entry.outcome === "exact-duplicate")).toBe(true);
  });
});
