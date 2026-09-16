import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  EVIDENCE_FLOORS,
  KNOWLEDGE_KINDS,
  adjudicate,
  assertValidClaim,
  derivableConfidence,
  dispute,
  isCurrent,
  isImmutableSource,
  supersede,
  validateClaim,
  type ConfidenceLevel,
  type KnowledgeClaim
} from "../../../src/shared/knowledge-claim";
import { assessStaleness, pathIntersects, reasonHistogram, staleClaims } from "../../../src/shared/knowledge-staleness";
import {
  DATA_CLASSES,
  RETENTION_RULES,
  applyCollection,
  buildCompactionSummary,
  classifyData,
  planCollection,
  plansCorrespond,
  type CompactionSummary,
  type DataRecord
} from "../../../src/shared/data-retention";
import { rankOf, retrieveClaims, runRetrievalBenchmark, type RetrievalBenchmarkCase } from "../../../src/shared/knowledge-retrieval-guard";

/**
 * Phase 04 acceptance — knowledge provenance and data lifecycle.
 *
 * Covers gates 2 to 6 of the engineering book: no verified claim without provenance, deterministic
 * staleness when a depended-on code path changes, conflicts keeping both sides until adjudication,
 * GC dry-run parity with zero misdeletion, and a 10k-record retrieval that is not drowned by stale
 * history.
 *
 * Everything here drives the real modules over real (if synthetic) corpora. Nothing is mocked,
 * because the properties being claimed are properties of the algorithms.
 */

const AT = "2026-06-01T00:00:00.000Z";
const PROJECT = "Codex-Boss";
const REPO = "zhiheng-zhang-Mera/Codex-Boss";

function claim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: overrides.id ?? "k-1",
    claim: overrides.claim ?? "Module X must not call Y",
    kind: overrides.kind ?? "fact",
    scope: overrides.scope ?? { project: PROJECT, repo: REPO },
    provenance: overrides.provenance ?? { sourceType: "commit", sourceRef: "abc1234" },
    ...(overrides.code ? { code: overrides.code } : {}),
    validity: overrides.validity ?? { validFrom: "2026-01-01T00:00:00.000Z", validUntil: null },
    confidence: overrides.confidence ?? { level: "verified", basis: "bound to a commit" },
    supersededBy: overrides.supersededBy ?? null,
    ...(overrides.disputedWith ? { disputedWith: overrides.disputedWith } : {}),
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z"
  };
}

const OBSERVATION = { at: AT };

describe("Phase 04 gate 2 — no verified claim without provenance", () => {
  it("refuses a claim whose source reference is empty", () => {
    const problems = validateClaim(claim({ provenance: { sourceType: "commit", sourceRef: "  " } }));
    expect(problems.join("\n")).toContain("requires provenance with an immutable sourceRef");
    expect(() => assertValidClaim(claim({ provenance: { sourceType: "commit", sourceRef: "" } }))).toThrow(/sourceRef/);
    expect(() => assertValidClaim(claim())).not.toThrow();
  });

  it("refuses a verified claim resting on a mutable source", () => {
    // An artifact can be rewritten and a URL can change its content, so neither can support
    // `verified` — the claim may be true, but it cannot be traced to bytes that cannot move.
    for (const sourceType of ["artifact", "external"] as const) {
      const problems = validateClaim(claim({ provenance: { sourceType, sourceRef: "art-1" } }));
      expect(problems.join("\n"), sourceType).toContain("exceeds what its evidence supports");
      expect(isImmutableSource(sourceType)).toBe(false);
    }
    // A commit, a test run and the owner can.
    for (const sourceType of ["commit", "test", "owner"] as const) {
      expect(isImmutableSource(sourceType), sourceType).toBe(true);
      expect(validateClaim(claim({ provenance: { sourceType, sourceRef: "ref-1" } }))).toEqual([]);
    }
  });

  it("caps each kind at what its own evidence floor allows", () => {
    expect(EVIDENCE_FLOORS.fact.maxConfidence).toBe("verified");
    expect(EVIDENCE_FLOORS.decision.maxConfidence).toBe("verified");
    expect(EVIDENCE_FLOORS.constraint.maxConfidence).toBe("verified");
    // A lesson generalises from experience, so repetition cannot make it a fact.
    expect(EVIDENCE_FLOORS.lesson.maxConfidence).toBe("supported");
    // A hypothesis is explicitly unproven.
    expect(EVIDENCE_FLOORS.hypothesis.maxConfidence).toBe("tentative");
    for (const kind of KNOWLEDGE_KINDS) {
      expect(EVIDENCE_FLOORS[kind].why.length, `${kind} has no stated why`).toBeGreaterThan(30);
    }
    expect(validateClaim(claim({ kind: "hypothesis", confidence: { level: "verified", basis: "many agents agree" } })).join("\n")).toContain("a hypothesis cannot be verified");  });

  it("refuses a bare confidence level with no basis", () => {
    expect(validateClaim(claim({ confidence: { level: "verified", basis: "  " } })).join("\n")).toContain("needs a stated basis");
  });

  it("REFUSES to let repetition raise confidence: there is no citation input at all", () => {
    // The prohibition made structural. `derivableConfidence` takes evidence and a kind; there is no
    // parameter for how many agents asserted the claim, so "fifty agents agreed" cannot appear in a
    // call even by accident.
    const once = derivableConfidence({ kind: "lesson", provenance: { sourceType: "test", sourceRef: "run-1" } });
    const withCitations = derivableConfidence as unknown as (input: Record<string, unknown>) => { level: ConfidenceLevel };
    const repeated = withCitations({ kind: "lesson", provenance: { sourceType: "test", sourceRef: "run-1" }, citations: 50, corroborations: 50 });
    expect(repeated.level).toBe(once.level);
    expect(repeated.level).toBe("supported");
  });

  it("refuses a claim with no project scope, so knowledge cannot leak unscoped", () => {
    expect(validateClaim(claim({ scope: { project: "" } })).join("\n")).toContain("a project scope is required");
  });

  it("names every problem at once rather than the first", () => {
    const problems = validateClaim(claim({ id: "", claim: "", scope: { project: "" }, confidence: { level: "verified", basis: "" } }));
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Phase 04 Task A — code-bound knowledge names its revision", () => {
  it("requires a repo, a revision and at least one path", () => {
    expect(validateClaim(claim({ code: { repo: "", revision: "abc", paths: ["a.ts"] } })).join("\n")).toContain("needs a repo");
    expect(validateClaim(claim({ code: { repo: REPO, revision: "", paths: ["a.ts"] } })).join("\n")).toContain("needs a revision");
    expect(validateClaim(claim({ code: { repo: REPO, revision: "abc", paths: [] } })).join("\n")).toContain("needs at least one path");
  });

  it("refuses a code binding that disagrees with the claim's scope", () => {
    expect(validateClaim(claim({ code: { repo: "other/repo", revision: "abc", paths: ["a.ts"] } })).join("\n")).toContain("while the scope names");
  });
});

describe("Phase 04 gate 3 — a changed code path marks knowledge stale, deterministically", () => {
  const bound = claim({ id: "code-1", code: { repo: REPO, revision: "aaa1111", paths: ["src/app.ts"] } });

  it("marks the claim stale when a bound path changes at a later revision", () => {
    const result = assessStaleness(bound, {
      at: AT,
      changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "bbb2222" }]
    });
    expect(result.verdict).toBe("STALE");
    expect(result.findings[0].reason).toBe("code-changed");
    expect(result.findings[0].evidence).toContain("bbb2222");
  });

  it("does NOT mark it stale for a change at the bound revision", () => {
    // The claim was true OF that revision; a change recorded at it is not a change after it.
    const result = assessStaleness(bound, { at: AT, changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "aaa1111" }] });
    expect(result.verdict).toBe("CURRENT");
  });

  it("does not mark it stale for a change in another repo, or an unrelated path", () => {
    expect(assessStaleness(bound, { at: AT, changedPaths: [{ repo: "other/repo", paths: ["src/app.ts"], revision: "bbb" }] }).verdict).toBe("CURRENT");
    expect(assessStaleness(bound, { at: AT, changedPaths: [{ repo: REPO, paths: ["src/other.ts"], revision: "bbb" }] }).verdict).toBe("CURRENT");
  });

  it("compares paths segment-wise, so app.ts does not match app.tsx", () => {
    // A raw `startsWith` would make this true, and the false "stale" would teach a reader to
    // ignore the marker.
    expect(pathIntersects("src/app.ts", "src/app.tsx")).toBe(false);
    expect(pathIntersects("src/app.ts", "src/app.ts")).toBe(true);
    // A directory binding covers what is under it, and only under it.
    expect(pathIntersects("src/engine", "src/engine/loop.ts")).toBe(true);
    expect(pathIntersects("src/engine", "src/engine-old/loop.ts")).toBe(false);
    expect(pathIntersects("src/engine/", "src/engine/loop.ts")).toBe(true);
  });

  it("is deterministic: the same observation always gives the same verdict", () => {
    const observation = { at: AT, changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "bbb2222" }] };
    const first = assessStaleness(bound, observation);
    for (let index = 0; index < 5; index++) expect(assessStaleness(bound, observation)).toEqual(first);
  });

  it("reports EVERY reason a claim is stale, and which source found it", () => {
    const result = assessStaleness(bound, {
      at: AT,
      changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "bbb" }],
      missingSources: ["abc1234"]
    });
    const reasons = result.findings.map((finding) => finding.reason).sort();
    expect(reasons).toEqual(["code-changed", "source-missing"]);
    for (const finding of result.findings) expect(finding.evidence).toBeTruthy();
  });

  it("marks a claim stale when a capability it depends on changes generation", () => {
    const dependent = claim({ id: "cap-1", scope: { project: PROJECT, repo: REPO, capability: "persistence@1.0.0" } });
    expect(assessStaleness(dependent, { at: AT, capabilityVersions: { persistence: "1.0.0" } }).verdict).toBe("CURRENT");
    const moved = assessStaleness(dependent, { at: AT, capabilityVersions: { persistence: "2.0.0" } });
    expect(moved.verdict).toBe("STALE");
    expect(moved.findings[0].reason).toBe("capability-version-changed");
  });

  it("marks a claim stale when the owner invalidates it, and reports that FIRST", () => {
    const result = assessStaleness(bound, {
      at: AT,
      ownerInvalidations: { "code-1": "the design changed" },
      changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "bbb" }]
    });
    // An explicit invalidation is a decision, not an inference, so it leads.
    expect(result.findings[0].reason).toBe("owner-invalidated");
    expect(result.findings.map((finding) => finding.reason)).toContain("code-changed");
  });

  it("marks a claim stale when its source was quarantined, naming the reason", () => {
    const result = assessStaleness(claim({ id: "q-1" }), { at: AT, quarantinedSources: { abc1234: "unreadable JSON" } });
    expect(result.verdict).toBe("STALE");
    expect(result.findings[0].reason).toBe("source-quarantined");
    expect(result.findings[0].detail).toContain("unreadable JSON");
  });

  it("marks a time-sensitive claim stale once its declared window passes, and only then", () => {
    const expiring = claim({ id: "exp-1", provenance: { sourceType: "external", sourceRef: "https://example.com/doc" }, confidence: { level: "supported", basis: "an external document" } });
    expect(assessStaleness(expiring, { at: AT, expiries: {} }).verdict).toBe("CURRENT");
    expect(assessStaleness(expiring, { at: AT, expiries: { "exp-1": "2026-05-01T00:00:00.000Z" } }).verdict).toBe("STALE");
    expect(assessStaleness(expiring, { at: AT, expiries: { "exp-1": "2026-07-01T00:00:00.000Z" } }).verdict).toBe("CURRENT");
  });

  it("does not invent an expiry for a claim that declared none", () => {
    // A durable fact must not look stale merely because time passed; the engine has no idea which
    // facts are time-sensitive and will not guess.
    const durable = claim({ id: "durable-1" });
    expect(assessStaleness(durable, { at: "2099-01-01T00:00:00.000Z" }).verdict).toBe("CURRENT");
  });

  it("summarises a mixed corpus by reason", () => {
    const results = [
      assessStaleness(claim({ id: "a", code: { repo: REPO, revision: "aaa", paths: ["x.ts"] } }), { at: AT, changedPaths: [{ repo: REPO, paths: ["x.ts"], revision: "bbb" }] }),
      assessStaleness(claim({ id: "b", code: { repo: REPO, revision: "aaa", paths: ["y.ts"] } }), { at: AT, changedPaths: [{ repo: REPO, paths: ["y.ts"], revision: "bbb" }] }),
      assessStaleness(claim({ id: "c" }), { at: AT })
    ];
    expect(staleClaims(results).map((result) => result.claimId)).toEqual(["a", "b"]);
    expect(reasonHistogram(results)["code-changed"]).toBe(2);
  });
});

describe("Phase 04 gate 4 — conflicts keep both sides until adjudication", () => {
  const left = claim({ id: "left", claim: "the cache must be read-through", provenance: { sourceType: "commit", sourceRef: "aaa" } });
  const right = claim({ id: "right", claim: "the cache must be write-through", provenance: { sourceType: "test", sourceRef: "run-9" } });

  it("marks both DISPUTED and supersedes neither", () => {
    const [first, second] = dispute(left, right);
    expect(first.confidence.level).toBe("disputed");
    expect(second.confidence.level).toBe("disputed");
    expect(first.supersededBy).toBeNull();
    expect(second.supersededBy).toBeNull();
    // Both keep their own evidence: that is what makes the conflict reviewable.
    expect(first.provenance.sourceRef).toBe("aaa");
    expect(second.provenance.sourceRef).toBe("run-9");
    expect(first.disputedWith).toBe("right");
    expect(second.disputedWith).toBe("left");
    // The level each held before the dispute is retained, so adjudication can restore it rather
    // than leaving the winner permanently marked as disputed.
    expect(first.disputedFromLevel).toBe("verified");
    expect(second.disputedFromLevel).toBe("verified");
  });

  it("does not offer a disputed claim as current fact", () => {
    const [first] = dispute(left, right);
    expect(isCurrent(first, AT)).toBe(false);
  });

  it("refuses an adjudication that is a preference rather than a decision", () => {
    // A reason that is too thin to be reviewed.
    expect(() => adjudicate(left, right, AT, "shorter")).toThrow(/substantive reason/);
    // Identical evidence at identical confidence means neither wins; the caller is asking for a
    // coin flip to be dressed up as a decision, and is told to leave them disputed.
    const twinA = claim({ id: "twin-a", provenance: { sourceType: "commit", sourceRef: "same" } });
    const twinB = claim({ id: "twin-b", provenance: { sourceType: "commit", sourceRef: "same" } });
    expect(() => adjudicate(twinA, twinB, AT, "it is clearly the better claim")).toThrow(/same evidence at the same confidence/);
    // A claim cannot be in conflict with itself in the first place.
    expect(() => dispute(left, left)).toThrow(/cannot conflict with itself/);
  });

  it("adjudicates on a reason, preserving the loser's lineage and evidence", () => {
    const [first, second] = dispute(left, right);
    const { winner, loser } = adjudicate(first, second, AT, "the test run reproduces it and the commit does not");
    expect(winner.disputedWith).toBeUndefined();
    expect(winner.disputedFromLevel).toBeUndefined();
    expect(winner.confidence.basis).toContain("adjudicated over right");
    // Adjudication settles the CONFLICT, not the evidence: the winner comes back at the level it
    // held before the dispute rather than being promoted or left stranded as `disputed`. Without
    // this the resolved conflict would leave nothing a reader could treat as current.
    expect(winner.confidence.level).toBe("verified");
    // The loser is superseded, not deleted: its provenance and text survive so "why did the current
    // version win" is answerable.
    expect(loser.supersededBy).toBe("left");
    expect(loser.provenance.sourceRef).toBe("run-9");
    expect(loser.claim).toBe("the cache must be write-through");
    expect(loser.validity.invalidatedBy).toContain("adjudicated");
    expect(isCurrent(winner, AT)).toBe(true);
    expect(isCurrent(loser, AT)).toBe(false);
  });

  it("does not promote a merely supported claim by adjudicating it", () => {
    const weak = claim({ id: "weak", claim: "read-through", confidence: { level: "supported", basis: "an external document" }, provenance: { sourceType: "artifact", sourceRef: "art-7" } });
    const strong = claim({ id: "strong", claim: "write-through", provenance: { sourceType: "test", sourceRef: "run-3" } });
    const [first, second] = dispute(weak, strong);
    const { winner } = adjudicate(first, second, AT, "the reproduction is stronger than the document");
    expect(winner.confidence.level).toBe("supported");
  });

  it("supersedes without overwriting: the old record keeps its own provenance", () => {
    const replacement = claim({ id: "v2", claim: "Module X must not call Y or Z", kind: "decision" });
    const superseded = supersede(claim({ id: "v1" }), replacement, AT, "the constraint widened");
    expect(superseded.supersededBy).toBe("v2");
    expect(superseded.claim).toBe("Module X must not call Y");
    expect(superseded.provenance.sourceRef).toBe("abc1234");
    expect(superseded.validity.validUntil).toBe(AT);
    expect(superseded.validity.invalidatedBy).toBe("the constraint widened");
    expect(() => supersede(claim({ id: "v1" }), { id: "v1" }, AT, "self")).toThrow(/cannot supersede itself/);
    expect(() => supersede(claim({ id: "v1" }), { id: "v2" }, AT, "  ")).toThrow(/stated reason/);
  });
});

describe("Phase 04 Task D — the five data classes", () => {
  it("declares retention, compression, dedup, archive and delete permissions per class", () => {
    expect([...DATA_CLASSES].sort()).toEqual(["COLD", "DISPOSABLE", "HOT", "PROTECTED", "WARM"]);
    for (const dataClass of DATA_CLASSES) {
      const rule = RETENTION_RULES[dataClass];
      expect(rule.why.length, `${dataClass} has no stated why`).toBeGreaterThan(30);
      expect(typeof rule.compressible).toBe("boolean");
      expect(typeof rule.dedupable).toBe("boolean");
      expect(typeof rule.archivable).toBe("boolean");
      expect(typeof rule.deletable).toBe("boolean");
    }
    // The invariant that keeps audit evidence alive.
    expect(RETENTION_RULES.PROTECTED.deletable).toBe(false);
    expect(RETENTION_RULES.PROTECTED.retentionDays).toBeNull();
    // The active working set is not collectable by age either.
    expect(RETENTION_RULES.HOT.deletable).toBe(false);
    // The disposable class is the first thing reclaimed.
    expect(RETENTION_RULES.DISPOSABLE.deletable).toBe(true);
    expect(RETENTION_RULES.DISPOSABLE.retentionDays).toBe(7);
  });

  it("classifies by markers and by use, resolving ambiguity toward keeping", () => {
    expect(classifyData({ id: "a", kind: "screenshot", bytes: 1, updatedAt: AT }, AT)).toBe("DISPOSABLE");
    expect(classifyData({ id: "b", kind: "owner-intervention", bytes: 1, updatedAt: AT }, AT)).toBe("PROTECTED");
    expect(classifyData({ id: "c", kind: "task", bytes: 1, updatedAt: AT, active: true }, AT)).toBe("HOT");
    // A record that could be read either way goes to PROTECTED: a false keep costs storage, a false
    // delete destroys evidence.
    expect(classifyData({ id: "d", kind: "audit-screenshot", bytes: 1, updatedAt: AT }, AT)).toBe("PROTECTED");
    expect(classifyData({ id: "e", kind: "artifact", bytes: 1, updatedAt: "2020-01-01T00:00:00.000Z" }, AT)).toBe("COLD");
  });
});

describe("Phase 04 gate 5 — dry-run parity and zero misdeletion", () => {
  const now = AT;
  const old = "2020-01-01T00:00:00.000Z";
  const records: DataRecord[] = [
    { id: "protected-1", kind: "owner-intervention", bytes: 1000, updatedAt: old },
    { id: "protected-2", kind: "audit-ledger", bytes: 2000, updatedAt: old, active: true },
    { id: "active-1", kind: "task", bytes: 3000, updatedAt: old, active: true },
    { id: "referenced-1", kind: "artifact", bytes: 4000, updatedAt: old, referencedBy: ["active-1"] },
    { id: "screenshot-old", kind: "screenshot", bytes: 5000, updatedAt: old },
    { id: "temp-old", kind: "temp-build-output", bytes: 6000, updatedAt: old },
    { id: "warm-old", kind: "conversation", bytes: 7000, updatedAt: old },
    { id: "fresh-warm", kind: "conversation", bytes: 8000, updatedAt: now }
  ];

  it("spares protected and active records before considering age or duplicates", () => {
    const plan = planCollection({ now, records, dedupe: true });
    const candidateIds = plan.candidates.map((candidate) => candidate.id);
    for (const id of ["protected-1", "protected-2", "active-1", "referenced-1", "fresh-warm"]) {
      expect(candidateIds, `${id} must never be a candidate`).not.toContain(id);
    }
    expect(candidateIds).toContain("screenshot-old");
    expect(candidateIds).toContain("temp-old");
    // A protected record says WHY it was spared, so the report explains the keep.
    const spared = plan.spared.find((entry) => entry.id === "protected-1");
    expect(spared?.reason).toContain("not deletable");
    const referenced = plan.spared.find((entry) => entry.id === "referenced-1");
    expect(referenced?.reason).toContain("still referenced");
    expect(plan.reclaimableBytes).toBe(5000 + 6000 + 7000);
    expect(plan.countsByClass.PROTECTED).toBe(2);
  });

  it("corresponds item by item between the dry-run and the execution", () => {
    const deleted: string[] = [];
    const report = applyCollection({ now, records, dedupe: true, delete: (record) => { deleted.push(record.id); } });
    const parity = plansCorrespond(report);
    expect(parity.problems).toEqual([]);
    expect(parity.correspond).toBe(true);
    // Exactly the plan's candidates were deleted, and nothing else.
    expect(deleted.sort()).toEqual(report.plan.candidates.map((candidate) => candidate.id).sort());
    expect(deleted).not.toContain("protected-1");
    expect(deleted).not.toContain("active-1");
    expect(deleted).not.toContain("referenced-1");
    // Every candidate has an audit entry.
    expect(report.audit).toHaveLength(report.plan.candidates.length);
    for (const entry of report.audit) expect(entry.detail).toBeTruthy();
    expect(report.reclaimedBytes).toBe(report.plan.reclaimableBytes);
  });

  it("reports a failure rather than claiming a deletion that did not happen", () => {
    const report = applyCollection({
      now,
      records,
      delete: (record) => { if (record.id === "temp-old") throw new Error("permission denied"); }
    });
    expect(report.failed).toBe(1);
    expect(report.deleted).toBe(2);
    const failed = report.audit.find((entry) => entry.outcome === "FAILED");
    expect(failed?.recordId).toBe("temp-old");
    expect(failed?.detail).toContain("permission denied");
    // The reclaimed figure counts only what was actually removed: the 6000-byte record that failed
    // must not be reported as space recovered. A dry-run estimate silently promoted to a result is
    // how a GC report starts lying.
    expect(report.reclaimedBytes).toBe(5000 + 7000);
    expect(report.reclaimedBytes).toBeLessThan(report.plan.reclaimableBytes);
  });

  it("reports a plan entry it could not act on, rather than shrinking the difference away", () => {
    // The execution is handed a strictly smaller corpus than the approved plan was computed over.
    // This is the case where "the dry run and the execution agree" is most tempting to fake by
    // omission: recomputing the plan here would silently produce a two-item plan and a clean parity
    // report, which is exactly the failure this asserts against.
    const approved = planCollection({ now, records });
    expect(approved.candidates.map((candidate) => candidate.id)).toContain("temp-old");
    const partial = applyCollection({
      now,
      records: records.filter((record) => record.id !== "temp-old"),
      delete: () => {},
      plan: approved
    });
    const audit = partial.audit.find((entry) => entry.recordId === "temp-old");
    expect(audit?.outcome).toBe("NOT_SUPPLIED");
    expect(audit?.detail).toContain("not supplied");
    expect(partial.deleted).toBe(2);
    // Parity is over the audit, so the missing item is still accounted for item by item.
    expect(plansCorrespond(partial).correspond).toBe(true);
    expect(partial.audit).toHaveLength(approved.candidates.length);
  });

  it("collapses an exact duplicate but keeps the newest copy", () => {
    const duplicated: DataRecord[] = [
      { id: "shot-old", kind: "screenshot", bytes: 500, updatedAt: "2020-01-01T00:00:00.000Z" },
      { id: "shot-new", kind: "screenshot", bytes: 500, updatedAt: "2026-05-31T00:00:00.000Z" }
    ];
    // The marker classifies both DISPOSABLE, but the fresh one is inside its 7-day window.
    const plan = planCollection({ now, records: duplicated, dedupe: true });
    const candidateIds = plan.candidates.map((candidate) => candidate.id);
    expect(candidateIds).toContain("shot-old");
    expect(candidateIds).not.toContain("shot-new");
  });

  it("never deletes a protected record, even when every record is old and duplicated", () => {
    // An adversarial corpus: nothing is active and everything is ancient, so the only thing
    // standing between the audit trail and deletion is the class guard.
    const adversarial: DataRecord[] = Array.from({ length: 50 }, (_, index) => ({
      id: `audit-${index}`,
      kind: "audit-evidence",
      bytes: 10,
      updatedAt: "2000-01-01T00:00:00.000Z"
    }));
    const deleted: string[] = [];
    const report = applyCollection({ now, records: adversarial, dedupe: true, delete: (record) => { deleted.push(record.id); } });
    expect(report.plan.candidates).toEqual([]);
    expect(deleted).toEqual([]);
    expect(report.plan.spared).toHaveLength(50);
  });

  it("compaction produces an index and never destroys its sources", () => {
    const summary: CompactionSummary = buildCompactionSummary({
      id: "sum-1",
      subject: `knowledge:${PROJECT}`,
      at: AT,
      claims: [{ id: "k-1", claim: "a" }, { id: "k-2", claim: "b" }]
    });
    expect(summary.sourceIds).toEqual(["k-1", "k-2"]);
    expect(summary.text).toContain("a");
    // A summary that could not name its sources would be a replacement rather than an index.
    expect(() => buildCompactionSummary({ id: "sum-2", subject: "s", at: AT, claims: [] })).toThrow(/at least one source claim/);
  });
});

describe("Phase 04 gate 6 — retrieval is not drowned by stale history", () => {
  const benchmark: RetrievalBenchmarkCase[] = [
    {
      name: "current-outranks-superseded",
      demonstrates: "the current claim ranks above the superseded version, which is excluded",
      request: { project: PROJECT, observation: OBSERVATION },
      claims: [
        claim({ id: "old", claim: "Module X must not call Y", supersededBy: "new" }),
        claim({ id: "new", claim: "Module X must not call Y or Z", kind: "decision" })
      ]
    },
    {
      name: "current-outranks-stale",
      demonstrates: "a stale claim is heavily penalised rather than hidden",
      request: { project: PROJECT, observation: { at: AT, changedPaths: [{ repo: REPO, paths: ["src/app.ts"], revision: "later" }] } },
      claims: [
        claim({ id: "stale", code: { repo: REPO, revision: "aaa", paths: ["src/app.ts"] } }),
        claim({ id: "current", claim: "an unrelated but current fact" })
      ]
    },
    {
      name: "disputed-is-not-a-fact",
      demonstrates: "a disputed claim is returned separately, never among the facts",
      request: { project: PROJECT, observation: OBSERVATION },
      claims: [
        (() => { const [first] = dispute(claim({ id: "d1" }), claim({ id: "d2" })); return first; })(),
        claim({ id: "solid", claim: "a settled fact" })
      ]
    },
    {
      name: "no-cross-project-pollution",
      demonstrates: "another project's knowledge is excluded regardless of how well it matches",
      request: { project: PROJECT, terms: ["cache"], observation: OBSERVATION },
      claims: [
        claim({ id: "mine", claim: "the cache must be read-through" }),
        claim({ id: "theirs", claim: "the cache must be read-through", scope: { project: "OtherProject" } })
      ]
    },
    {
      name: "missing-source-degrades",
      demonstrates: "a claim whose source is gone ranks below an otherwise equal one",
      request: { project: PROJECT, observation: { at: AT, missingSources: ["gone"] } },
      claims: [
        claim({ id: "intact", claim: "the same statement", provenance: { sourceType: "commit", sourceRef: "present" } }),
        claim({ id: "orphaned", claim: "the same statement", provenance: { sourceType: "commit", sourceRef: "gone" } })
      ]
    }
  ];

  it("satisfies every benchmark case's stated property", () => {
    const outcomes = new Map(benchmark.map((testCase) => [testCase.name, runRetrievalBenchmark(testCase)]));

    const superseded = outcomes.get("current-outranks-superseded") as ReturnType<typeof runRetrievalBenchmark>;
    expect(superseded.ranking[0]).toBe("new");
    expect(superseded.excluded).toContain("old:superseded");

    const stale = outcomes.get("current-outranks-stale") as ReturnType<typeof runRetrievalBenchmark>;
    expect(rankOf(stale, "current")).toBeLessThan(rankOf(stale, "stale"));

    const disputed = outcomes.get("disputed-is-not-a-fact") as ReturnType<typeof runRetrievalBenchmark>;
    expect(disputed.disputed).toContain("d1");
    expect(disputed.ranking).not.toContain("d1");
    expect(disputed.ranking).toContain("solid");

    const crossProject = outcomes.get("no-cross-project-pollution") as ReturnType<typeof runRetrievalBenchmark>;
    expect(crossProject.excluded).toContain("theirs:other-project");
    expect(crossProject.ranking).toEqual(["mine"]);

    const missing = outcomes.get("missing-source-degrades") as ReturnType<typeof runRetrievalBenchmark>;
    expect(rankOf(missing, "intact")).toBeLessThan(rankOf(missing, "orphaned"));
    expect(missing.scores.intact).toBeGreaterThan(missing.scores.orphaned);
  });

  it("is reproducible: the same benchmark yields the same ordering and scores", () => {
    for (const testCase of benchmark) {
      const first = runRetrievalBenchmark(testCase);
      const second = runRetrievalBenchmark(testCase);
      expect(second).toEqual(first);
    }
  });

  it("explains every ranking adjustment rather than returning a bare score", () => {
    const result = retrieveClaims(benchmark[1].claims, benchmark[1].request);
    for (const entry of result.entries) {
      for (const adjustment of entry.adjustments) {
        expect(adjustment.detail, `${entry.claimId}/${adjustment.reason} has no detail`).toBeTruthy();
      }
    }
    const staleEntry = result.entries.find((entry) => entry.claimId === "stale");
    expect(staleEntry?.adjustments.map((adjustment) => adjustment.reason)).toContain("stale");
  });

  it("is not drowned by 10k stale history records", () => {
    // The book's scale requirement: a mixed corpus of 10k+ records must still surface the current
    // knowledge. The history is deliberately well-matched on terms, so ranking — not filtering —
    // is what has to hold.
    const SIZE = 10_500;
    const history: KnowledgeClaim[] = Array.from({ length: SIZE }, (_, index) =>
      claim({
        id: `hist-${String(index).padStart(5, "0")}`,
        claim: "the cache must be read-through",
        provenance: { sourceType: "commit", sourceRef: `old-${index}` },
        code: { repo: REPO, revision: `rev-${index}`, paths: [`src/module-${index}.ts`] }
      })
    );
    const current = claim({ id: "current", claim: "the cache must be read-through", provenance: { sourceType: "commit", sourceRef: "HEAD" } });
    // Each history record's own file moved, so every one of them is genuinely stale. The changes are
    // enumerated in the same order as the claims, so each record matches on its own entry rather
    // than on the first entry in the array — a single shared change entry would make the first
    // record match every claim and demonstrate nothing about scale.
    const changedPaths = history.map((entry) => ({ repo: REPO, paths: [...(entry.code?.paths ?? [])], revision: "later" }));

    const result = retrieveClaims([...history, current], { project: PROJECT, terms: ["cache"], observation: { at: AT, changedPaths }, limit: 20 });
    expect(result.entries[0].claimId).toBe("current");
    expect(result.entries).toHaveLength(20);
    // Every returned history entry ranks below it, and says why it was penalised.
    for (const entry of result.entries.slice(1)) {
      expect(entry.adjustments.map((adjustment) => adjustment.reason)).toContain("stale");
      expect(entry.score).toBeLessThan(result.entries[0].score);
    }
    // Nothing was dropped to achieve this: the whole corpus was considered, not pre-filtered.
    expect(result.excluded).toEqual([]);
  }, 30_000);

  it("keeps the confidence vocabulary closed and ordered", () => {
    expect([...CONFIDENCE_LEVELS]).toEqual(["verified", "supported", "tentative", "disputed"]);
  });
});
