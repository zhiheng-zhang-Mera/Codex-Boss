/**
 * checkpoint-1 §5.1–§5.5 unit acceptance for the unified Knowledge Object.
 *
 * Every case here is about a rule the plan states explicitly: provenance is not
 * optional, a model cannot certify itself, a weaker claim never overwrites a
 * stronger one, a tie stays UNRESOLVED, and retrieval is bounded and ranked in
 * the order §5.5 fixes.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_AUTHORITIES,
  KNOWLEDGE_TYPES,
  compareCandidateToActive,
  gateKnowledgeWrite,
  knowledgeIdFor,
  knowledgeKeyFor,
  knowledgeTypeWeights,
  renderKnowledgeSection,
  resolveKnowledgeConflict,
  selectKnowledgeForTask,
  type KnowledgeCandidate,
  type KnowledgeObject
} from "../../src/shared/knowledge-object";
import { buildStructuralFingerprint } from "../../src/shared/task-fingerprint";

const AT = "2026-01-01T00:00:00.000Z";
const AT_LATER = "2026-02-01T00:00:00.000Z";
const HASH = "a".repeat(64);

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    type: "CONSTRAINT",
    scope: "project:demo",
    subject: "checkout latency budget",
    source: "workbook:spec.md#constraints",
    source_hash: HASH,
    content: "the checkout response must complete within one hundred milliseconds",
    summary: "checkout latency budget is 100 ms",
    captured_at: AT,
    producer: "DETERMINISTIC_HOST",
    produced_by: "codex-boss/test@1",
    verification: "VERIFIED",
    verification_evidence: ["compiled contract constraints[0]"],
    confidence: 0.9,
    authority: "WORKBOOK",
    freshness: AT,
    task_ref: "task-1",
    ...overrides
  };
}

function accepted(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeObject {
  const result = gateKnowledgeWrite(candidate(overrides), []);
  if (!result.object) throw new Error(`expected an object, got ${result.outcome}: ${result.reasons.join("; ")}`);
  return result.object;
}

describe("§5.1 knowledge object vocabulary", () => {
  it("declares the plan's type vocabulary exactly once", () => {
    expect([...KNOWLEDGE_TYPES].sort()).toEqual([
      "ARCHITECTURE", "BENCHMARK", "BUG", "CAPABILITY_GAP", "CONSTRAINT", "DECISION", "FIX", "PROVIDER",
      "REQUIREMENT", "RESEARCH", "TEST", "THEME", "THEME_VALIDATION", "UI_CONTRACT", "UI_SURFACE",
      "USER_OVERRIDE", "WORKFLOW"
    ]);
  });

  it("orders authority from the owner down to an inference", () => {
    expect(KNOWLEDGE_AUTHORITIES[0]).toBe("OWNER");
    expect(KNOWLEDGE_AUTHORITIES.at(-1)).toBe("INFERRED");
  });

  it("derives a content-addressed id and a scope+type+subject conflict key", () => {
    const object = accepted();
    expect(object.id).toMatch(/^ko-[0-9a-f]{32}$/);
    expect(object.key).toBe(knowledgeKeyFor({ scope: "project:demo", type: "CONSTRAINT", subject: "checkout latency budget" }));
    expect(knowledgeIdFor(candidate())).toBe(object.id);
    // Same content in another project is a different object.
    expect(knowledgeIdFor(candidate({ scope: "project:other" }))).not.toBe(object.id);
  });
});

describe("§5.2 provenance is not optional", () => {
  it("rejects a candidate with no source, and records the phase that refused it", () => {
    const result = gateKnowledgeWrite(candidate({ source: "" }), []);
    expect(result.outcome).toBe("REJECT");
    expect(result.object).toBeUndefined();
    expect(result.phases.find((phase) => phase.phase === "PROVENANCE")?.ok).toBe(false);
  });

  it("rejects a candidate whose source hash is not a sha256", () => {
    expect(gateKnowledgeWrite(candidate({ source_hash: "not-a-hash" }), []).outcome).toBe("REJECT");
  });

  it("rejects a candidate with no document/task/run reference at all", () => {
    const result = gateKnowledgeWrite(candidate({ document_ref: undefined, task_ref: undefined, run_ref: undefined }), []);
    expect(result.outcome).toBe("REJECT");
    expect(result.reasons.join(" ")).toContain("document/task/run ref");
  });

  it("rejects a VERIFIED claim that cannot show its verification evidence", () => {
    const result = gateKnowledgeWrite(candidate({ verification_evidence: [] }), []);
    expect(result.outcome).toBe("REJECT");
    expect(result.phases.find((phase) => phase.phase === "VERIFICATION")?.ok).toBe(false);
  });

  it("rejects a contradicted claim", () => {
    expect(gateKnowledgeWrite(candidate({ verification: "CONTRADICTED", verification_evidence: ["review:1"] }), []).outcome).toBe("REJECT");
  });

  it("never stores a secret-shaped value", () => {
    const result = gateKnowledgeWrite(candidate({ content: "the deployment key is sk-proj-Q7wE9rT2yU5iO8pA3sD6fGH1jK4lZ" }), []);
    expect(result.outcome).toBe("REJECT");
    expect(result.reasons.join(" ")).toContain("secret");
  });

  it("rejects a fact long enough to be a document rather than knowledge", () => {
    expect(gateKnowledgeWrite(candidate({ content: "x".repeat(9000) }), []).outcome).toBe("REJECT");
  });
});

describe("§5.2 a model cannot certify itself", () => {
  it("quarantines an unverified model claim instead of accepting it", () => {
    const result = gateKnowledgeWrite(candidate({
      producer: "MODEL",
      authority: "MODEL",
      verification: "UNVERIFIED",
      verification_evidence: [],
      produced_by: "provider:chatgpt"
    }), []);
    expect(result.outcome).toBe("QUARANTINE");
    expect(result.reasons.join(" ")).toContain("cannot certify itself");
  });

  it("accepts a model claim only when an independent verification is cited", () => {
    const result = gateKnowledgeWrite(candidate({
      producer: "MODEL",
      authority: "REVIEWER",
      verification: "VERIFIED",
      verification_evidence: ["test:checkout-latency PASS"],
      produced_by: "provider:chatgpt"
    }), []);
    expect(result.outcome).toBe("ACCEPT");
  });
});

describe("§5.3 gate outcomes", () => {
  it("accepts a first fact and deduplicates an identical second one", () => {
    const first = accepted();
    const second = gateKnowledgeWrite(candidate(), [first]);
    expect(second.outcome).toBe("ACCEPT");
    expect(second.deduplicated).toBe(true);
    expect(second.object?.id).toBe(first.id);
  });

  it("supersedes a weaker authority with a stronger one", () => {
    const existing = accepted({ authority: "WORKBOOK" });
    const result = gateKnowledgeWrite(candidate({
      authority: "OWNER",
      content: "the checkout response may take up to five seconds while the cache warms",
      summary: "checkout latency budget is 5 s",
      source: "user:override",
      verification_evidence: ["user message 2026-02-01"]
    }), [existing]);
    expect(result.outcome).toBe("SUPERSEDE");
    expect(result.supersedes).toBe(existing.id);
    expect(result.object?.version).toBe(existing.version + 1);
    expect(result.object?.supersedes).toBe(existing.id);
  });

  it("quarantines a self-certified model claim without touching the active set", () => {
    const existing = accepted({ authority: "OWNER" });
    const result = gateKnowledgeWrite(candidate({ authority: "MODEL", producer: "MODEL", verification: "UNVERIFIED", verification_evidence: [] }), [existing]);
    expect(result.outcome).toBe("QUARANTINE");
    expect(result.reasons.join(" ")).toContain("cannot certify itself");
  });

  it("quarantines a weaker verified claim and names the active fact it contradicts", () => {
    const existing = accepted({ authority: "OWNER" });
    const result = gateKnowledgeWrite(candidate({
      authority: "REVIEWER",
      verification: "VERIFIED",
      verification_evidence: ["review:2"],
      content: "the checkout response may take up to five seconds",
      summary: "checkout latency budget is 5 s"
    }), [existing]);
    expect(result.outcome).toBe("QUARANTINE");
    expect(result.conflicts_with).toEqual([existing.id]);
  });

  it("treats an equal-strength contradiction as an unresolved conflict", () => {
    const existing = accepted();
    const result = gateKnowledgeWrite(candidate({
      content: "the checkout response is allowed to take up to five seconds",
      summary: "checkout latency budget is 5 s"
    }), [existing]);
    expect(result.outcome).toBe("QUARANTINE");
    expect(result.reasons.join(" ")).toContain("unresolved");
  });

  it("never lets an explicit supersede overwrite a stronger fact", () => {
    const existing = accepted({ authority: "OWNER" });
    const result = gateKnowledgeWrite(candidate({
      authority: "REVIEWER",
      verification: "VERIFIED",
      verification_evidence: ["review:3"],
      content: "the checkout response may take up to five seconds",
      summary: "checkout latency budget is 5 s",
      supersedes: existing.id
    }), [existing]);
    expect(result.outcome).toBe("QUARANTINE");
    expect(result.conflicts_with).toEqual([existing.id]);
  });

  it("honours an explicit supersede between equals (an amended work book)", () => {
    const existing = accepted({ freshness: AT });
    const amended = gateKnowledgeWrite(candidate({
      freshness: AT,
      content: "the guard must not add more than 100 ms of overhead per request",
      summary: "latency guard overhead budget (amended)",
      supersedes: existing.id
    }), [existing]);
    expect(amended.outcome).toBe("SUPERSEDE");
    expect(amended.supersedes).toBe(existing.id);
  });

  it("compares strength on authority, then verification, then freshness", () => {
    const existing = accepted({ freshness: AT });
    expect(compareCandidateToActive(candidate({ authority: "OWNER" }), existing)).toBe(1);
    expect(compareCandidateToActive(candidate({ authority: "INFERRED", producer: "MODEL", verification: "UNVERIFIED", verification_evidence: [] }), existing)).toBe(-1);
    expect(compareCandidateToActive(candidate({ freshness: AT_LATER }), existing)).toBe(1);
    expect(compareCandidateToActive(candidate(), existing)).toBe(0);
  });
});

describe("§5.4 conflicts never overwrite", () => {
  it("records a conflict set with authority, freshness, source and validation for each claim", () => {
    const existing = accepted();
    const challenger = candidate({ content: "the checkout response may take five seconds", summary: "checkout latency budget is 5 s", authority: "REVIEWER", verification: "UNVERIFIED", verification_evidence: [] });
    const result = gateKnowledgeWrite(challenger, [existing]);
    expect(result.outcome).toBe("QUARANTINE");
    const resolution = resolveKnowledgeConflict({
      key: existing.key,
      members: [
        { object_id: existing.id, scope: existing.scope, type: existing.type, subject: existing.subject, authority: existing.authority, freshness: existing.freshness, source: existing.source, source_hash: existing.provenance.source_hash, verification: existing.provenance.verification, summary: existing.summary, content: existing.content },
        { object_id: "ko-challenger", scope: challenger.scope, type: challenger.type, subject: challenger.subject, authority: challenger.authority, freshness: challenger.freshness, source: challenger.source, source_hash: challenger.source_hash, verification: challenger.verification, summary: challenger.summary, content: challenger.content }
      ]
    }, AT);
    expect(resolution.resolution).toBe("ACTIVE");
    expect(resolution.winner_id).toBe(existing.id);
    expect(resolution.superseded_ids).toEqual(["ko-challenger"]);
  });

  it("leaves a genuine tie UNRESOLVED with every member marked", () => {
    const left = { object_id: "a", scope: "project:demo" as const, type: "CONSTRAINT" as const, subject: "x", authority: "WORKBOOK" as const, freshness: AT, source: "s", source_hash: HASH, verification: "UNVERIFIED" as const, summary: "s", content: "c" };
    const right = { ...left, object_id: "b" };
    const resolution = resolveKnowledgeConflict({ key: "k", members: [left, right] }, AT);
    expect(resolution.resolution).toBe("UNRESOLVED");
    expect(resolution.winner_id).toBeUndefined();
    expect(resolution.statuses).toEqual({ a: "UNRESOLVED", b: "UNRESOLVED" });
  });
});

describe("§5.5 retrieval is task-aware and bounded", () => {
  const coding = buildStructuralFingerprint({ role: "executor", capabilities: ["coding"], goal: "implement the latency guard and its tests" });
  const uiOnly = buildStructuralFingerprint({ role: "executor", capabilities: ["ui"], goal: "restyle the settings panel" });

  const architecture = accepted({ type: "ARCHITECTURE", subject: "repository layout", content: "files: 120", summary: "repository layout summary", authority: "VERIFIED_HOST" });
  const test = accepted({ type: "TEST", subject: "test layout", content: "test files: 12", summary: "test layout summary", source: "repo-scan:x", source_hash: "b".repeat(64) });
  const decision = accepted({ type: "DECISION", subject: "dispatch decision", content: "DISPATCHED", summary: "dispatch decision summary", source: "dispatch:t", source_hash: "c".repeat(64) });
  const theme = accepted({ type: "THEME", subject: "theme tokens", content: "accent #6cf", summary: "theme token summary", source: "theme:a", source_hash: "d".repeat(64) });

  it("offers a coding task its architecture, tests and decisions but never a theme fact", () => {
    const result = selectKnowledgeForTask({ fingerprint: coding, goal: "implement the latency guard", objects: [architecture, test, decision, theme], characterBudget: 4000 });
    const types = result.selected.map((object) => object.type);
    expect(types).toContain("ARCHITECTURE");
    expect(types).toContain("TEST");
    expect(types).toContain("DECISION");
    expect(types).not.toContain("THEME");
    expect(result.ranking.find((step) => step.object_id === theme.id)?.selected).toBe(false);
    expect(result.not_offered).toBe(1);
  });

  it("offers a UI task its theme facts and not the test layout", () => {
    const result = selectKnowledgeForTask({ fingerprint: uiOnly, goal: "restyle the settings panel", objects: [architecture, test, theme], characterBudget: 4000 });
    const types = result.selected.map((object) => object.type);
    expect(types).toContain("THEME");
    expect(types).not.toContain("TEST");
  });

  it("weights the owner's own words highest", () => {
    const weights = knowledgeTypeWeights(coding);
    expect(weights.USER_OVERRIDE).toBeGreaterThan(weights.ARCHITECTURE);
    expect(weights.ARCHITECTURE).toBeGreaterThan(weights.PROVIDER);
  });

  it("honours the character budget instead of returning the whole base", () => {
    const objects = Array.from({ length: 40 }, (_, index) => accepted({
      type: "REQUIREMENT",
      subject: `requirement ${index}`,
      content: `requirement body ${index} `.repeat(20),
      summary: `requirement summary ${index}`,
      source_hash: index.toString(16).padStart(64, "0")
    }));
    const result = selectKnowledgeForTask({ fingerprint: coding, goal: "implement the latency guard", objects, characterBudget: 600, maxObjects: 5 });
    expect(result.characters).toBeLessThanOrEqual(600);
    expect(result.selected.length).toBeLessThanOrEqual(5);
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
    expect(renderKnowledgeSection(result).length).toBeLessThan(1200);
  });

  it("never returns a superseded, quarantined or foreign-scope fact", () => {
    const superseded: KnowledgeObject = { ...architecture, id: "ko-old", status: "SUPERSEDED" };
    const unresolved: KnowledgeObject = { ...architecture, id: "ko-q", status: "UNRESOLVED" };
    const foreign: KnowledgeObject = { ...architecture, id: "ko-f", scope: "project:elsewhere" };
    const result = selectKnowledgeForTask({
      fingerprint: coding,
      goal: "implement the latency guard",
      objects: [architecture, superseded, unresolved, foreign],
      characterBudget: 4000,
      scope: "project:demo"
    });
    expect(result.selected.map((object) => object.id)).toEqual([architecture.id]);
  });

  it("excludes the calling task's own facts", () => {
    const result = selectKnowledgeForTask({
      fingerprint: coding,
      goal: "implement the latency guard",
      objects: [architecture, test],
      characterBudget: 4000,
      excludeTaskRef: "task-1"
    });
    expect(result.selected.every((object) => object.provenance.task_ref !== "task-1")).toBe(true);
  });

  it("records why every candidate was selected or dropped", () => {
    const result = selectKnowledgeForTask({ fingerprint: coding, goal: "latency guard", objects: [architecture, test], characterBudget: 4000 });
    expect(result.ranking).toHaveLength(2);
    for (const step of result.ranking) {
      expect(step.reason.length).toBeGreaterThan(0);
      expect(step.authority_rank).toBeGreaterThan(0);
    }
  });

  it("renders an empty section when there is nothing to reuse", () => {
    expect(renderKnowledgeSection(selectKnowledgeForTask({ fingerprint: coding, goal: "x", objects: [], characterBudget: 100 }))).toBe("");
  });
});
