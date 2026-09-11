import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkbookRegistry } from "../../electron/ingestion/workbook-registry";
import { SOURCE_ROLES, assignRoles, detectSectionConflicts, scoreRoles } from "../../electron/ingestion/role-assignment";
import { classifyWorkBook, logicalKeyFor } from "../../src/shared/workbook";
import { compileTaskContract } from "../../src/shared/task-contract";
import { ingressFromText } from "../helpers/workbook-test-helpers";

function registry(): WorkbookRegistry {
  return new WorkbookRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wb-registry-")), "registry.json"));
}

const SPEC_V1 = [
  "# Installment payments",
  "",
  "## Goal",
  "Let users choose installments at checkout.",
  "",
  "## Scope",
  "- checkout UI",
  "",
  "## Deliverables",
  "- installment selector",
  "",
  "## Acceptance Criteria",
  "- [ ] FR-1 selector visible at checkout",
  "- [ ] AC-2 fallback to full payment"
].join("\n");

const SPEC_V2 = SPEC_V1.replace("Let users choose installments at checkout.", "Let users choose installments at checkout, up to 24 months.");

describe("duplicate / resume / amended-supersedes relations", () => {
  it("reports NEW for a first ingestion and persists the revision", async () => {
    const store = registry();
    const document = await ingressFromText("spec.md", SPEC_V1);
    const plan = store.plan([document]);
    expect(plan.decisions[0].relation).toBe("NEW");
    expect(plan.decisions[0].revision).toBe(1);
    expect(plan.to_process).toEqual([document.id]);
    expect(plan.skipped).toEqual([]);

    const revision = store.record(document);
    expect(revision.revision).toBe(1);
    expect(store.documentIdForHash(document.hash)).toBe(document.id);
  });

  it("reports DUPLICATE with resume for identical bytes", async () => {
    const store = registry();
    const first = await ingressFromText("spec.md", SPEC_V1);
    store.record(first);

    // Same content, different source name: identity is the content hash.
    const again = await ingressFromText("spec-copy.md", SPEC_V1);
    expect(again.hash).toBe(first.hash);
    const plan = store.plan([again]);
    expect(plan.decisions[0].relation).toBe("DUPLICATE");
    expect(plan.decisions[0].duplicate_of_document_id).toBe(first.id);
    expect(plan.decisions[0].resume).toBe(true);
    expect(plan.skipped).toEqual([again.id]);
    expect(plan.to_process).toEqual([]);
    expect(plan.decisions[0].reasons[0]).toContain("identical bytes already ingested");
  });

  it("reports AMENDED with a supersedes link for a changed same-logical workbook", async () => {
    const store = registry();
    const v1 = await ingressFromText("spec.md", SPEC_V1);
    store.record(v1);

    const v2 = await ingressFromText("spec-v2.md", SPEC_V2);
    expect(v2.logical_key).toBe(v1.logical_key);
    expect(v2.hash).not.toBe(v1.hash);

    const plan = store.plan([v2]);
    expect(plan.decisions[0].relation).toBe("AMENDED");
    expect(plan.decisions[0].supersedes_document_id).toBe(v1.id);
    expect(plan.decisions[0].revision).toBe(2);
    expect(plan.to_process).toEqual([v2.id]);

    const revision = store.record(v2);
    expect(revision.supersedes).toBe(v1.id);
    expect(store.entryFor(v1.logical_key)?.revisions.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(store.entryFor(v1.logical_key)?.latest_document_id).toBe(v2.id);

    // The amended content is still recognised by hash for future resume.
    expect(store.documentIdForHash(v2.hash)).toBe(v2.id);
  });

  it("classifies an intra-batch amendment chain and warns about it", async () => {
    const store = registry();
    const v1 = await ingressFromText("spec.md", SPEC_V1);
    const v2 = await ingressFromText("spec-v2.md", SPEC_V2);
    const plan = store.plan([v1, v2]);
    expect(plan.decisions.map((decision) => decision.relation)).toEqual(["NEW", "AMENDED"]);
    expect(plan.decisions[1].supersedes_document_id).toBe(v1.id);
    expect(plan.warnings.some((warning) => warning.includes("amend another document in the same batch"))).toBe(true);
  });

  it("treats an identical duplicate inside one batch as DUPLICATE", async () => {
    const store = registry();
    const first = await ingressFromText("spec.md", SPEC_V1);
    const second = await ingressFromText("spec-again.md", SPEC_V1);
    const plan = store.plan([first, second]);
    expect(plan.decisions.map((decision) => decision.relation)).toEqual(["NEW", "DUPLICATE"]);
    expect(plan.decisions[1].duplicate_of_document_id).toBe(first.id);
  });

  it("survives a restart (durable JSON) and re-records idempotently", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wb-registry-durable-"));
    const file = path.join(directory, "registry.json");
    const document = await ingressFromText("spec.md", SPEC_V1);
    new WorkbookRegistry(file).record(document);

    const reopened = new WorkbookRegistry(file);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.documentIdForHash(document.hash)).toBe(document.id);
    expect(reopened.record(document).revision).toBe(1);
    expect(reopened.list()[0].revisions).toHaveLength(1);
    expect(reopened.plan([document]).decisions[0].relation).toBe("DUPLICATE");
  });

  it("keeps unrelated documents independent and supports removal", async () => {
    const store = registry();
    const spec = await ingressFromText("spec.md", SPEC_V1);
    const other = await ingressFromText("notes.md", "# Notes\n\n## Goal\n\nSomething unrelated but long enough to classify.\n");
    expect(other.logical_key).not.toBe(spec.logical_key);
    store.recordAll([spec, other]);
    expect(store.list()).toHaveLength(2);
    expect(store.remove(spec.logical_key)).toBe(true);
    expect(store.remove(spec.logical_key)).toBe(false);
    expect(store.documentIdForHash(spec.hash)).toBeUndefined();
    expect(store.plan([spec]).decisions[0].relation).toBe("NEW");
  });

  it("derives one logical key per revision family", () => {
    expect(logicalKeyFor("spec-v2.md", "x".repeat(64))).toBe(logicalKeyFor("spec.md", "y".repeat(64)));
    expect(logicalKeyFor("规格说明 (1).md", "x".repeat(64))).toBe(logicalKeyFor("规格说明-定稿.md", "y".repeat(64)));
  });
});

describe("multi-file role assignment and conflict isolation", () => {
  const PLAN = [
    "# Implementation plan",
    "",
    "## Tasks",
    "1. implement the selector component",
    "2. update the gateway adapter",
    "3. add regression tests",
    "4. deploy to staging",
    "5. verify the fallback path"
  ].join("\n");

  const ACCEPTANCE = [
    "# Acceptance sheet",
    "",
    "## Acceptance Criteria",
    "- [ ] AC-1 installment option visible at checkout",
    "- [ ] AC-2 gateway failure falls back to full payment",
    "- [ ] AC-3 audit log entry written",
    "- [ ] AC-4 no change to the full-payment path"
  ].join("\n");

  const REFERENCE = [
    "# ISO 9564 payment standard",
    "",
    "## References",
    "[1] ISO 9564-1 financial PIN management",
    "[2] RFC 4122 UUID specification",
    "",
    "## Appendix",
    "| clause | requirement |",
    "| --- | --- |",
    "| 4.1 | encryption algorithm |",
    "| 4.2 | key lifecycle |",
    "",
    "## Revision history",
    "2024-01 first release"
  ].join("\n");

  it("assigns one role per document from content features", async () => {
    const spec = await ingressFromText("spec.md", SPEC_V1);
    const plan = await ingressFromText("plan.md", PLAN);
    const acceptance = await ingressFromText("acceptance.md", ACCEPTANCE);
    const reference = await ingressFromText("standard.md", REFERENCE);
    const assignment = assignRoles([spec, plan, acceptance, reference]);

    const roleOf = (id: string) => assignment.assignments.find((entry) => entry.document_id === id)!.role;
    expect(roleOf(spec.id)).toBe("PRIMARY_SPEC");
    expect(roleOf(acceptance.id)).toBe("ACCEPTANCE_CRITERIA");
    expect(roleOf(plan.id)).toBe("SUB_PLAN");
    expect(roleOf(reference.id)).toBe("REFERENCE");
    expect(assignment.primary_document_id).toBe(spec.id);
    expect(assignment.winners.PRIMARY_SPEC).toBe(spec.id);
    // Every document gets exactly one role and all four roles are distinct.
    expect(new Set(assignment.assignments.map((entry) => entry.role)).size).toBe(4);
    expect(assignment.assignments.every((entry) => SOURCE_ROLES.includes(entry.role))).toBe(true);
  });

  it("scores roles deterministically from content, not file names", async () => {
    const acceptance = await ingressFromText("plan.md", ACCEPTANCE);
    const verdict = classifyWorkBook({ content: acceptance.content, sections: acceptance.sections });
    const scores = scoreRoles(acceptance, verdict);
    expect(scores.ACCEPTANCE_CRITERIA).toBeGreaterThan(scores.REFERENCE);
    expect(scores.ACCEPTANCE_CRITERIA).toBeGreaterThan(scores.SUB_PLAN);
  });

  it("isolates a conflicting section by document, section id and similarity", async () => {
    const left = await ingressFromText("spec-a.md", [
      "# Spec A",
      "",
      "## Scope",
      "The checkout page lets users pick between three, six or twelve monthly installments with no interest."
    ].join("\n"));
    const right = await ingressFromText("spec-b.md", [
      "# Spec B",
      "",
      "## Scope",
      "Installment selection is out of scope for this release; the payment page stays exactly as it is today."
    ].join("\n"));
    const conflicts = detectSectionConflicts([left, right]);
    const scoped = conflicts.find((entry) => entry.kind === "CONFLICTING_SECTION");
    expect(scoped).toBeDefined();
    expect(scoped!.sections.map((entry) => entry.file_name)).toEqual(["spec-a.md", "spec-b.md"]);
    expect(scoped!.sections.map((entry) => entry.section_id)).toHaveLength(2);
    expect(scoped!.sections.every((entry) => entry.hash.length === 64)).toBe(true);
    expect(scoped!.similarity).toBeLessThanOrEqual(0.5);
    expect(scoped!.normalized_heading).toBe("scope");
    expect(scoped!.message).toContain("spec-a.md");
  });

  it("classifies identical and near-identical sections separately", async () => {
    const body = "The checkout page shows three, six and twelve month installment options to every eligible user.";
    const left = await ingressFromText("a.md", `# A\n\n## Scope\n${body}\n`);
    const exact = await ingressFromText("b.md", `# B\n\n## Scope\n${body}\n`);
    const identical = detectSectionConflicts([left, exact]);
    expect(identical.map((entry) => entry.kind)).toContain("DUPLICATE_SECTION");
    expect(identical.find((entry) => entry.kind === "DUPLICATE_SECTION")!.similarity).toBe(1);

    // A genuinely cosmetic difference (punctuation/whitespace) is a near duplicate.
    const cosmetic = await ingressFromText("c.md", `# C\n\n## Scope\n${body.replace(".", "")}  \n`);
    const near = detectSectionConflicts([left, cosmetic]);
    expect(near.map((entry) => entry.kind)).toContain("NEAR_DUPLICATE_SECTION");

    // A substantive wording change is a conflict, not a duplicate.
    const conflicting = await ingressFromText("d.md", `# D\n\n## Scope\n${body.replace("twelve month installment options to every eligible user", "deferred settlement window for institutional buyers")}\n`);
    const conflict = detectSectionConflicts([left, conflicting]);
    expect(conflict.map((entry) => entry.kind)).toContain("CONFLICTING_SECTION");
  });

  it("ignores sections that are too short to judge, and short-circuits same-document pairs", async () => {
    const left = await ingressFromText("a.md", "# A\n\n## Scope\nshort\n");
    const right = await ingressFromText("b.md", "# B\n\n## Scope\ntiny\n");
    expect(detectSectionConflicts([left, right])).toEqual([]);
  });

  it("reports a role conflict when two documents claim the primary spec", async () => {
    // Both documents are plain specs (no acceptance/plan/reference headings), so
    // each genuinely claims PRIMARY_SPEC with an identical score and the tie must
    // resolve deterministically to the earlier document in ingestion order.
    const specA = "# Spec A\n\n## Goal\nShip installment payments.\n\n## Scope\n- checkout UI\n\n## Deliverables\n- selector\n";
    const specB = "# Spec B\n\n## Goal\nShip installment payments.\n\n## Scope\n- checkout UI\n\n## Deliverables\n- selector\n";
    const first = await ingressFromText("spec-a.md", specA);
    const second = await ingressFromText("spec-b.md", specB);
    const assignment = assignRoles([first, second]);
    const roleConflict = assignment.diagnostics.find((entry) => entry.kind === "ROLE_CONFLICT" && entry.message.includes("PRIMARY_SPEC"));
    expect(roleConflict).toBeDefined();
    expect(roleConflict!.severity).toBe("ERROR");
    expect(roleConflict!.sections.map((entry) => entry.file_name)).toEqual(["spec-a.md", "spec-b.md"]);
    expect(roleConflict!.message).toContain("won deterministically");

    const scores = assignment.assignments.map((entry) => entry.role_scores.PRIMARY_SPEC);
    expect(scores[0]).toBe(scores[1]);
    expect(assignment.winners.PRIMARY_SPEC).toBe(first.id);
    expect(assignment.assignments.find((entry) => entry.document_id === second.id)!.role).not.toBe("PRIMARY_SPEC");
    // Exactly one primary spec, whichever way the tie fell.
    expect(assignment.assignments.filter((entry) => entry.role === "PRIMARY_SPEC")).toHaveLength(1);
  });

  it("feeds roles and conflicts into the compiled contract", async () => {
    const spec = await ingressFromText("spec.md", SPEC_V1);
    const acceptance = await ingressFromText("acceptance.md", ACCEPTANCE);
    const assignment = assignRoles([spec, acceptance]);
    const contract = compileTaskContract({
      documents: [spec, acceptance],
      classifications: assignment.assignments.map((entry) => ({ document_id: entry.document_id, verdict: entry.verdict })),
      roles: assignment.assignments.map((entry) => ({ document_id: entry.document_id, role: entry.role })),
      primaryDocumentId: assignment.primary_document_id
    });
    expect(contract.inputs.map((entry) => entry.role)).toEqual(["PRIMARY_SPEC", "ACCEPTANCE_CRITERIA"]);
    expect(contract.source_workbook.primary_document_id).toBe(spec.id);
    // The acceptance sheet wins the acceptance-criteria declaration.
    expect(contract.acceptance_criteria[0].items[0]).toContain("AC-1");
    expect(contract.acceptance_criteria[0].source_document_id).toBe(acceptance.id);
    expect(contract.diagnostics.warnings.some((warning) => warning.includes("ACCEPTANCE_CRITERIA is declared by more than one document"))).toBe(true);
  });
});
