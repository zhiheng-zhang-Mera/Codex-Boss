import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { expandSectionPromptsFromContract, sufficiencyAudit, violatesContract, type ResearchContract } from "../../src/shared/research-contract";
import { ResearchContractStore, auditRun, evidenceFromLedger } from "../../electron/research/research-contract-store";

/**
 * Phase G (R-701/R-702): Research Contract anchors paper expansion; the
 * sufficiency gate blocks a final paper when evidence/experiments/citations/
 * reviews are missing.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-contract-")); dirs.push(dir); return dir; }

const contract: ResearchContract = {
  researchQuestion: "does Q measure R?",
  hypotheses: ["Q improves R"],
  claims: [{ id: "c1", statement: "Q improves R (method)", evidenceRequirement: "experiment_execution" }],
  experimentPlan: { runsPerHypothesis: 3, metric: "R", baseline: "0.5" },
  evaluationCriterion: "mean R > baseline",
  citationPolicy: "strict-verbatim",
  sections: ["Introduction", "Method", "Results"],
  acceptanceGates: ["evidence", "review"],
  frozenAt: "2026-09-09T00:00:00.000Z"
};

it("R-701: section prompts expand strictly from the contract (no free rewrite of the goal)", () => {
  const specs = expandSectionPromptsFromContract(contract);
  expect(specs.map((spec) => spec.section)).toEqual(["Introduction", "Method", "Results"]);
  expect(specs[0].prompt).toContain(contract.researchQuestion);
  expect(specs[0].prompt).not.toContain("free rewrite");
  expect(violatesContract(specs[0], "I propose studying a brand new question instead", contract)).toBeDefined();
  expect(violatesContract(specs[0], "This section reports on Q improving R per the frozen contract.", contract)).toBeUndefined();
});

it("R-702: sufficiency gate blocks a final when evidence/experiments/citations/reviews are missing", () => {
  const ok = sufficiencyAudit(contract, { evidenceRefs: ["c1", "experiment_execution"], executedExperiments: 3, reviewsCompleted: 1, citationsTraceable: 2, openCriticism: [] });
  expect(ok.sufficient).toBe(true);
  const poor = sufficiencyAudit(contract, { evidenceRefs: [], executedExperiments: 1, reviewsCompleted: 0, citationsTraceable: 0, openCriticism: [] });
  expect(poor.sufficient).toBe(false);
  expect(poor.missing.length).toBeGreaterThan(0);
});

it("durable store persists the contract and auditRun fails closed without one", () => {
  const dir = root();
  const store = new ResearchContractStore(dir);
  store.save("r-1", contract);
  expect(store.load("r-1")?.evaluationCriterion).toBe("mean R > baseline");

  const decisions = [
    { stepId: "EXPERIMENT_EXECUTION", decision: "experiment_execution", evidenceRefs: ["experiment_execution/c1"] },
    { stepId: "CITATION_AUDIT", decision: "citation_audit", evidenceRefs: ["ref/1"] },
    { stepId: "CLAIM_REVIEW", decision: "claim_review", evidenceRefs: [] }
  ];
  expect(evidenceFromLedger(decisions).executedExperiments).toBe(1);
  expect(auditRun(store.load("r-1"), decisions).audit.sufficient).toBe(false); // 3 runs required, 1 executed
  expect(auditRun(undefined, decisions).contractPresent).toBe(false);
  expect(auditRun(undefined, decisions).audit.sufficient).toBe(false);
});
