import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceGraphFile } from "../electron/research/evidence/evidence-graph";
import { deriveManuscriptClaims } from "../electron/research/evidence/graph-claims";
import { buildSectionBriefs, evidenceCheckDraft } from "../src/shared/research-manuscript";
import { ResearchService } from "../electron/research/research-service";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-gclaims-")); dirs.push(dir); return dir; }

const empty = (): EvidenceGraphFile => ({ schemaVersion: 1, nodes: [], edges: [] });

function ir(workspace: string, id: string) {
  return {
    schemaVersion: 1 as const, id, goal: "g",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT" as const, budget: { maxExperiments: 2, maxSteps: 10 } },
    state: "SCOPING" as const, researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

function protocol() {
  return { schemaVersion: 1 as const, hypothesis: "H", primaryMetric: "accuracy", baseline: "0", sampleDefinition: "s", evaluationCriterion: ">=0", createdAt: new Date(0).toISOString() };
}

describe("evidence-graph → manuscript claim derivation (Phase 11)", () => {
  it("binds each claim to the real evidence nodes upstream of it", () => {
    const graph: EvidenceGraphFile = {
      schemaVersion: 1,
      nodes: [
        { id: "run:run-1", kind: "run", label: "r1" },
        { id: "run:run-2", kind: "run", label: "r2" },
        { id: "stat:claim:accuracy", kind: "statistic", label: "mean" },
        { id: "claim:accuracy", kind: "claim", label: "accuracy claim" },
        { id: "claim:unbound", kind: "claim", label: "no evidence yet" }
      ],
      edges: [
        { from: "run:run-1", to: "stat:claim:accuracy" },
        { from: "run:run-2", to: "stat:claim:accuracy" },
        { from: "stat:claim:accuracy", to: "claim:accuracy" }
      ]
    };
    const derived = deriveManuscriptClaims(graph);
    expect(derived.evidenceIds).toEqual(["run:run-1", "run:run-2", "stat:claim:accuracy"]);
    const accuracy = derived.claims.find((claim) => claim.id === "claim:accuracy")!;
    expect(accuracy.evidenceIds.sort()).toEqual(["run:run-1", "run:run-2", "stat:claim:accuracy"]);
    const unbound = derived.claims.find((claim) => claim.id === "claim:unbound")!;
    expect(unbound.evidenceIds).toEqual([]);
  });

  it("yields claims usable by the manuscript model without invented evidence", () => {
    const graph: EvidenceGraphFile = {
      schemaVersion: 1,
      nodes: [
        { id: "run:run-1", kind: "run", label: "r1" },
        { id: "stat:s1", kind: "statistic", label: "s1" },
        { id: "claim:c1", kind: "claim", label: "c1" },
        { id: "hypothesis:h1", kind: "hypothesis", label: "h1" }
      ],
      edges: [{ from: "run:run-1", to: "stat:s1" }, { from: "stat:s1", to: "claim:c1" }, { from: "hypothesis:h1", to: "claim:c1" }]
    };
    const derived = deriveManuscriptClaims(graph);
    const briefs = buildSectionBriefs({ id: "paper", claimsToSections: { "claim:c1": ["results"] } }, derived.claims);
    // Only real evidence ids are allowed; the hypothesis is not evidence.
    const results = briefs.find((brief) => brief.section === "results")!;
    expect(results.claimIds).toEqual(["claim:c1"]);
    expect(results.evidenceIds.sort()).toEqual(["run:run-1", "stat:s1"]);
    // A draft may reference real evidence…
    const verdict = evidenceCheckDraft({ section: "results", allowedEvidenceIds: results.evidenceIds, content: "Accuracy from @stat:s1 via @run:run-1." }, new Set(derived.evidenceIds));
    expect(verdict.passed).toBe(true);
    // …but not invented ids.
    const bad = evidenceCheckDraft({ section: "results", allowedEvidenceIds: results.evidenceIds, content: "Depends on @run:secret." }, new Set(derived.evidenceIds));
    expect(bad.passed).toBe(false);
  });

  it("handles empty and claim-less graphs deterministically", () => {
    expect(deriveManuscriptClaims(empty())).toEqual({ claims: [], evidenceIds: [] });
    const claimsOnly = deriveManuscriptClaims({ schemaVersion: 1, nodes: [{ id: "claim:x", kind: "claim", label: "x" }], edges: [] });
    expect(claimsOnly.claims).toEqual([{ id: "claim:x", evidenceIds: [] }]);
  });
});

describe("research service manuscriptClaims (integration)", () => {
  it("derives claims from a graph the analyzer populated", async () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;");
    const svc = new ResearchService({ root: path.join(cwd, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
    const id = "run1";
    svc.start(ir(cwd, id));
    svc.freeze(id, protocol());
    const frozen = svc.protocols.load(id)!.protocolHash;
    const experiment = (accuracy: number) => ({ executable: process.execPath, args: ["-e", `console.log('METRICS ' + JSON.stringify({accuracy: ${accuracy}}))`], cwd, purpose: "EXPERIMENT" as const, timeoutMs: 30000 });
    await svc.runExperiment(id, { experimentId: "exp", protocolHash: frozen, spec: experiment(6), seed: 1 });
    await svc.runExperiment(id, { experimentId: "exp", protocolHash: frozen, spec: experiment(7), seed: 2 });
    svc.analyzeRuns(id, { claimId: "claim:accuracy", metric: "accuracy", protocolHash: frozen, votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" }] });
    const derived = svc.manuscriptClaims(id);
    // The analyzer records claim node ids as `claim:<claimId>` (claimId here is
    // "claim:accuracy"), so the derived claim carries that graph node id.
    const accuracy = derived.claims.find((claim) => claim.id === "claim:claim:accuracy")!;
    expect(accuracy.evidenceIds.length).toBeGreaterThanOrEqual(3); // ≥2 runs + statistic
    expect(derived.evidenceIds.some((evidence) => evidence.startsWith("run:exp-"))).toBe(true);
    // All derived evidence ids actually exist in the graph (no invented nodes).
    const graphIds = new Set(svc.evidence.graph(id).nodes.map((node) => node.id));
    expect(derived.evidenceIds.every((evidence) => graphIds.has(evidence))).toBe(true);
  });
});
