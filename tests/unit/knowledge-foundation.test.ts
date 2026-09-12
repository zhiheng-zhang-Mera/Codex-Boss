/**
 * checkpoint-1 §5 — durable knowledge base, extraction and the foundation
 * facade.
 *
 * These cases are about the properties the plan makes non-negotiable: knowledge
 * survives a restart, a superseded fact is never deleted, a refused claim is
 * parked rather than stored, a corrupt file cannot stop Boss from starting, and
 * every extracted fact carries provenance the host actually observed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { KnowledgeBase } from "../../electron/knowledge/knowledge-base";
import { KnowledgeFoundation } from "../../electron/knowledge/knowledge-foundation";
import { extractKnowledgeFromDispatch } from "../../src/shared/knowledge-extraction";
import { repositoryModelFrom, scanRepo } from "../../electron/engineering/repo-inspector";
import type { KnowledgeCandidate } from "../../src/shared/knowledge-object";
import type { CompiledTaskContract } from "../../src/shared/task-contract";
import type { WorkBookDispatchRecord } from "../../src/shared/workbook-dispatch";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-knowledge-"));
const AT = "2026-03-01T00:00:00.000Z";
const WORKBOOK_HASH = "f".repeat(64);

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
});

function declaration(kind: string, items: string[], text: string) {
  return {
    kind: kind as never,
    authority: "WORKBOOK" as const,
    source_document_id: "doc-1",
    items,
    text,
    overridable: true,
    item_provenance: items.map((item) => ({ item, source_document_id: "doc-1", heading: kind }))
  };
}

function contract(): CompiledTaskContract {
  return {
    version: 1,
    goal: [declaration("GOAL", ["Add a latency guard to checkout"], "Add a latency guard to checkout")],
    scope: [declaration("SCOPE", ["checkout handler"], "checkout handler")],
    constraints: [declaration("CONSTRAINTS", ["the guard must not exceed 100 ms of overhead"], "constraints")],
    inputs: [{ document_id: "doc-1", file_name: "latency.md", hash: WORKBOOK_HASH, sections_used: 4 }],
    dependencies: [],
    deliverables: [declaration("DELIVERABLES", ["latency guard module"], "deliverables")],
    acceptance_criteria: [declaration("ACCEPTANCE_CRITERIA", ["AC-1 the guard aborts a slow call"], "acceptance")],
    risk: [],
    permissions: [],
    execution_strategy: { mode: "WORK", analysis_only: false, requires_planning: false, required_capabilities: [], reference_sections: [], rationale: "executable workbook" },
    source_workbook: { document_ids: ["doc-1"], classifications: [{ document_id: "doc-1", file_name: "latency.md", kind: "EXECUTABLE_WORKBOOK", confidence: 0.9 }], primary_document_id: "doc-1", has_workbook: true },
    overrides: [],
    diagnostics: { warnings: [], missing: [], analysis_only_reasons: [], classification_reasons: [] }
  };
}

function record(): WorkBookDispatchRecord {
  return {
    schemaVersion: 1,
    stage: "RUNNING",
    stageHistory: [{ stage: "READY", at: AT, detail: "intake complete" }],
    resolved_title: "Bounded latency work book",
    analysis_only: false,
    auto_run: true,
    has_workbook: true,
    workbook_hash: WORKBOOK_HASH,
    classification: "EXECUTABLE_WORKBOOK",
    confidence: 0.9,
    classification_reasons: [],
    documents: [{ document_id: "doc-1", file_name: "latency.md", hash: WORKBOOK_HASH, status: "OK", sections: 4, classification: "EXECUTABLE_WORKBOOK", relation: "NEW", diagnostics: [] }],
    roles: {},
    primary_document_id: "doc-1",
    conflicts: [],
    contract: contract(),
    discovery: {
      repository: true,
      root: ROOT,
      files: 12,
      test_files: 3,
      fingerprint: "b".repeat(64),
      skipped_directories: 2,
      repository_model: {
        schemaVersion: 1,
        top_level: ["electron", "src", "tests"],
        manifests: ["package.json", "pnpm-lock.yaml"],
        entry_points: ["electron/main.ts", "index.html"],
        test_files: ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"],
        ui_surface_files: ["src/renderer/main.tsx", "src/renderer/styles.css"],
        languages: ["TypeScript", "CSS"],
        truncated: false
      }
    }
  };
}

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    type: "CONSTRAINT",
    scope: "project:demo",
    subject: "checkout latency budget",
    source: "workbook:latency.md#constraints",
    source_hash: WORKBOOK_HASH,
    content: "the guard must not exceed 100 ms of overhead",
    summary: "latency guard overhead budget",
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

describe("§5.3/§5.4 durable knowledge base", () => {
  const activeId = (base: KnowledgeBase): string => base.active()[0].id;

  it("round-trips through disk and keeps a superseded fact forever", () => {
    const file = path.join(ROOT, "round-trip.json");
    const base = new KnowledgeBase(file, () => AT);
    const first = base.commit(candidate());
    expect(first.outcome).toBe("ACCEPT");
    const upgraded = base.commit(candidate({
      authority: "OWNER",
      source: "user:override",
      content: "the guard may add up to 250 ms of overhead",
      summary: "latency guard overhead budget (owner)",
      verification_evidence: ["user message 2026-03-01"]
    }));
    expect(upgraded.outcome).toBe("SUPERSEDE");

    const reloaded = new KnowledgeBase(file);
    const objects = reloaded.objects();
    expect(objects).toHaveLength(2);
    expect(objects.filter((object) => object.status === "ACTIVE")).toHaveLength(1);
    expect(objects.filter((object) => object.status === "SUPERSEDED")).toHaveLength(1);
    expect(reloaded.active("project:demo")[0].authority).toBe("OWNER");
    expect(reloaded.conflicts()[0].resolution).toBe("ACTIVE");
    expect(reloaded.conflicts()[0].members.map((member) => member.authority).sort()).toEqual(["OWNER", "WORKBOOK"]);
  });

  it("parks a refused claim in quarantine and never in the active set", () => {
    const base = new KnowledgeBase(path.join(ROOT, "quarantine.json"), () => AT);
    base.commit(candidate({ authority: "OWNER" }));
    const refused = base.commit(candidate({ producer: "MODEL", authority: "MODEL", verification: "UNVERIFIED", verification_evidence: [], content: "a model believes the budget is 900 ms", summary: "model claim" }));
    expect(refused.outcome).toBe("QUARANTINE");
    expect(base.active()).toHaveLength(1);
    expect(base.quarantine()).toHaveLength(1);
    expect(base.gateLog().at(-1)?.outcome).toBe("QUARANTINE");
    expect(base.gateLog().at(-1)?.phases.every((phase) => typeof phase.ok === "boolean")).toBe(true);
  });

  it("stores nothing at all for a REJECT and keeps the reason in the audit log", () => {
    const base = new KnowledgeBase(path.join(ROOT, "reject.json"), () => AT);
    const rejected = base.commit(candidate({ source: "" }));
    expect(rejected.outcome).toBe("REJECT");
    expect(base.objects()).toHaveLength(0);
    expect(base.summary().rejected).toBe(1);
    expect(base.gateLog()[0].reasons.join(" ")).toContain("PROVENANCE");
  });

  it("records an unresolved conflict and closes it on an owner decision without deleting the loser", () => {
    const base = new KnowledgeBase(path.join(ROOT, "conflict.json"), () => AT);
    const existing = base.commit(candidate());
    expect(existing.outcome).toBe("ACCEPT");
    const tie = base.commit(candidate({ content: "the guard may add up to five seconds", summary: "latency guard overhead budget (other)" }));
    expect(tie.outcome).toBe("QUARANTINE");
    const open = base.unresolvedConflicts();
    expect(open).toHaveLength(1);
    expect(open[0].members).toHaveLength(2);
    expect(open[0].members.every((member) => member.source_hash.length === 64 && member.verification === "VERIFIED")).toBe(true);

    const closed = base.decideConflict(open[0].id, { owner: "owner@example", winnerId: open[0].members[0].object_id, resolution: "ACTIVE", reason: "the WorkBook constraint stands" });
    expect(closed.resolution).toBe("ACTIVE");
    // The loser is retained — marked SUPERSEDED — never deleted.
    expect(base.objects()).toHaveLength(1);
    expect(base.quarantine()).toHaveLength(1);
    expect(base.quarantine()[0].status).toBe("SUPERSEDED");
    expect(base.unresolvedConflicts()).toHaveLength(0);
  });

  it("promotes an owner-approved parked claim into the active set exactly once", () => {
    const base = new KnowledgeBase(path.join(ROOT, "promote.json"), () => AT);
    const original = base.commit(candidate());
    expect(original.outcome).toBe("ACCEPT");
    const tie = base.commit(candidate({ content: "the guard may add up to five seconds", summary: "latency guard overhead budget (other)" }));
    expect(tie.outcome).toBe("QUARANTINE");
    const open = base.unresolvedConflicts();
    expect(open).toHaveLength(1);
    const challenger = open[0].members.find((member) => member.object_id !== activeId(base));
    expect(challenger).toBeDefined();
    expect(base.quarantine()).toHaveLength(1);

    base.decideConflict(open[0].id, { owner: "owner@example", winnerId: challenger!.object_id, resolution: "ACTIVE", reason: "the newer wording wins" });
    const promoted = base.active();
    expect(promoted.map((object) => object.id)).toEqual([challenger!.object_id]);
    expect(promoted[0].version).toBe(1);
    expect(promoted[0].conflict_set).toBe(open[0].id);
    // The previously active fact is retained as SUPERSEDED, and the parked copy
    // of the winner is gone (it is active now, not duplicated).
    expect(base.objects().filter((object) => object.status === "SUPERSEDED")).toHaveLength(1);
    expect(base.quarantine()).toHaveLength(0);
    expect(base.unresolvedConflicts()).toHaveLength(0);
  });

  it("reports a corrupt file instead of throwing or silently overwriting it", () => {
    const file = path.join(ROOT, "corrupt.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    const base = new KnowledgeBase(file, () => AT);
    expect(base.loadFailure()).toBeDefined();
    expect(base.active()).toHaveLength(0);
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
  });
});

describe("§5 knowledge extraction", () => {
  it("derives architecture, test, UI, constraint, requirement and decision facts with provenance", () => {
    const candidates = extractKnowledgeFromDispatch({
      taskId: "task-1",
      scope: "project:demo",
      workspacePath: ROOT,
      record: record(),
      outcome: "DISPATCHED",
      observedAt: AT
    });
    const types = candidates.map((entry) => entry.type);
    expect(types).toContain("ARCHITECTURE");
    expect(types).toContain("TEST");
    expect(types).toContain("UI_SURFACE");
    expect(types).toContain("CONSTRAINT");
    expect(types).toContain("REQUIREMENT");
    expect(types).toContain("DECISION");
    for (const entry of candidates) {
      expect(entry.source_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.task_ref).toBe("task-1");
      expect(entry.verification).toBe("VERIFIED");
      expect(entry.verification_evidence.length).toBeGreaterThan(0);
      expect(entry.content.trim().length).toBeGreaterThan(0);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
    }
    const architecture = candidates.find((entry) => entry.type === "ARCHITECTURE");
    expect(architecture?.content).toContain("top-level: electron, src, tests");
    expect(architecture?.authority).toBe("VERIFIED_HOST");
    const constraint = candidates.find((entry) => entry.type === "CONSTRAINT");
    expect(constraint?.authority).toBe("WORKBOOK");
    expect(constraint?.document_ref).toBe("doc-1");
    const decision = candidates.find((entry) => entry.type === "DECISION");
    expect(decision?.source).toBe("dispatch:task-1");
    expect(decision?.content).toContain("outcome: DISPATCHED");
  });

  it("caps the extracted volume so one repository cannot flood the base", () => {
    const flood = record();
    flood.discovery!.repository_model!.test_files = Array.from({ length: 500 }, (_, index) => `tests/t${index}.test.ts`);
    const candidates = extractKnowledgeFromDispatch({ taskId: "t", scope: "project:demo", record: flood, outcome: "DISPATCHED", observedAt: AT, limits: { testFiles: 5 } });
    const test = candidates.find((entry) => entry.type === "TEST");
    expect(test?.content).toContain("truncated at the knowledge limit");
    const listed = (test?.content ?? "").split("\n").filter((line) => line.startsWith("- ") && !line.includes("truncated at the knowledge limit"));
    expect(listed).toHaveLength(5);
  });

  it("derives a bounded repository model from a real scan", () => {
    const workspace = path.join(ROOT, "repo");
    fs.mkdirSync(path.join(workspace, "src", "renderer"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "tests"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), "{\"name\":\"fixture\"}", "utf8");
    fs.writeFileSync(path.join(workspace, "index.html"), "<html></html>", "utf8");
    fs.writeFileSync(path.join(workspace, "src", "renderer", "main.tsx"), "export const a = 1;", "utf8");
    fs.writeFileSync(path.join(workspace, "src", "renderer", "styles.css"), "body{}", "utf8");
    fs.writeFileSync(path.join(workspace, "tests", "sample.test.ts"), "it('x', () => {});", "utf8");
    const model = repositoryModelFrom(scanRepo(workspace));
    expect(model.manifests).toContain("package.json");
    expect(model.entry_points).toContain("index.html");
    expect(model.test_files).toEqual(["tests/sample.test.ts"]);
    expect(model.ui_surface_files).toEqual(expect.arrayContaining(["src/renderer/main.tsx", "src/renderer/styles.css"]));
    expect(model.languages).toContain("TypeScript");
    expect(model.truncated).toBe(false);
  });
});

describe("§5 foundation facade", () => {
  it("scopes knowledge to a stable project identity, never a temporary path alone", () => {
    const foundation = new KnowledgeFoundation(new KnowledgeBase(), () => AT);
    expect(foundation.projectScopeFor({ projectId: "owner/repo" })).toBe("project:owner/repo");
    expect(foundation.projectScopeFor({ workspacePath: "C:\\Work\\Demo\\" })).toBe("project:c:/work/demo");
    expect(foundation.projectScopeFor({})).toBe("global");
  });

  it("records a dispatch and then answers a later task from the base with zero repository reads", () => {
    const file = path.join(ROOT, "foundation.json");
    const foundation = new KnowledgeFoundation(new KnowledgeBase(file, () => AT), () => AT);
    const summary = foundation.recordWorkBookDispatch({
      taskId: "task-1",
      scope: foundation.projectScopeFor({ workspacePath: ROOT }),
      workspacePath: ROOT,
      record: record(),
      outcome: "DISPATCHED",
      observedAt: AT
    });
    expect(summary.ok).toBe(true);
    expect(summary.accepted.length).toBeGreaterThan(0);
    expect(summary.outcomes.ACCEPT).toBeGreaterThan(0);
    expect(summary.rejected).toBe(0);

    // A second task, a different goal, no filesystem access on the read path.
    const section = foundation.sectionForTask({
      taskId: "task-2",
      goal: "implement the latency guard module and its tests",
      scope: foundation.projectScopeFor({ workspacePath: ROOT }),
      maxObjects: 8
    });
    expect(section.repositoryReads).toBe(0);
    expect(section.text).toContain("REUSED_PROJECT_KNOWLEDGE");
    expect(section.text).toContain("Test layout");
    expect(section.retrieval.selected.length).toBeGreaterThan(0);
    expect(section.text.length).toBeLessThanOrEqual(4000 + 400); // bounded, plus the header lines

    const evidence = foundation.evidence();
    expect(evidence.summary.active).toBeGreaterThan(0);
    expect(evidence.retrievals.at(-1)?.taskId).toBe("task-2");
    expect(evidence.loadFailure).toBeUndefined();
  });

  it("isolates a knowledge failure so it can never fail a task", () => {
    const foundation = new KnowledgeFoundation(new KnowledgeBase(), () => AT);
    // A record with no contract and no discovery is legal — it just extracts little.
    const summary = foundation.recordWorkBookDispatch({
      taskId: "task-3",
      scope: "project:empty",
      record: { schemaVersion: 1, stage: "BLOCKED", stageHistory: [], analysis_only: false, auto_run: false, has_workbook: false, classification_reasons: [], documents: [], roles: {}, conflicts: [], blocked_reason: "GUARDIAN_DENIED" },
      outcome: "BLOCKED",
      observedAt: AT
    });
    expect(summary.ok).toBe(true);
    expect(summary.outcomes.ACCEPT).toBe(1); // the DECISION fact is still worth recording
    expect(summary.failures).toEqual([]);
  });
});
