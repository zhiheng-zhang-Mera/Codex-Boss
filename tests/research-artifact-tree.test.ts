import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import type { ResearchProtocol } from "../src/shared/research-protocol";
import { metricFigureSvg } from "../src/shared/research-figures";
import { ResearchService } from "../electron/research/research-service";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-artree-")); dirs.push(dir); return dir; }

function ir(id: string, workspace: string): ResearchIR {
  return {
    schemaVersion: 1, id, goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 3, maxSteps: 20 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

function protocol(): ResearchProtocol {
  return { schemaVersion: 1, hypothesis: "H: evidence beats majority", primaryMetric: "accuracy", baseline: "0.8", sampleDefinition: "tasks 1..20", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString() };
}

function metricsSpec(cwd: string, accuracy: number) {
  return { executable: process.execPath, args: ["-e", `console.log('METRICS ' + JSON.stringify({accuracy: ${accuracy}}))`], cwd, purpose: "EXPERIMENT" as const, timeoutMs: 30000 };
}

describe("full offline artifact tree (freeze → real runs → analysis → audit → manuscript)", () => {
  it("produces the plan's paper + audit tree with truthful integrity flags", { timeout: 60000 }, async () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "a.ts"), "export const a = 1;");
    const svc = new ResearchService({ root: path.join(workspace, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
    const id = "tree1";
    svc.start(ir(id, workspace));
    const frozen = svc.freeze(id, protocol());

    // Two real experiment runs (distinct seeds) → protocol-bound primary runs.
    const run1 = await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 9), seed: 1 });
    const run2 = await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 11), seed: 2 });
    expect(run1.passed && run2.passed).toBe(true);
    expect(svc.evidence.runs(id)).toHaveLength(2);

    // Analysis + reproducibility audit.
    const analysisOptions = { claimId: "claim:accuracy", metric: "accuracy", protocolHash: frozen.hash, votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" as const }] };
    const analysis = svc.analyzeRuns(id, analysisOptions);
    expect(analysis.verdict.adopted).toBe(true);
    const repro = svc.reproducibility(id, analysisOptions);
    expect(repro.status).toBe("REPRODUCED");

    // Citation store: one verified + one UNSUPPORTED → manuscript must flag it.
    svc.citations.put({ id: "cite:a", proposedTitle: "Verified paper", status: "CLAIM_SUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() });
    svc.citations.put({ id: "cite:bad", proposedTitle: "Unverified paper", status: "UNSUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() });

    // Manuscript claims derived from the evidence graph.
    const derived = svc.manuscriptClaims(id);
    const claim = derived.claims.find((item) => item.id === "claim:accuracy")!;
    expect(claim.evidenceIds.length).toBeGreaterThanOrEqual(3);
    // Figure from the real recorded run metrics (deterministic SVG).
    const runs = svc.evidence.runs(id);
    const figure = metricFigureSvg(runs.map((run, index) => ({ label: `run ${index + 1}`, value: run.metrics.accuracy })), { title: "accuracy by run", yLabel: "accuracy" });
    const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return brief.evidenceIds.length ? `${brief.section} supports @${brief.evidenceIds.join(", @")}` : `${brief.section} no claims`; } };

    const output = await svc.manuscript(id, {
      title: "Evidence vs Majority", authors: ["Boss"], plan: { id, claimsToSections: { "claim:accuracy": ["abstract", "results"] } },
      claims: derived.claims, evidenceIds: derived.evidenceIds, writer, reproducibility: repro, citations: svc.citations.list(), figures: [{ name: "accuracy.svg", svg: figure }]
    });
    const rootDir = path.join(workspace, ".boss", id);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "paper.md"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "paper.tex"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "references.bib"))).toBe(true);
    expect(output.figures).toContain("accuracy.svg");
    expect(fs.existsSync(path.join(rootDir, "manuscript", "figures", "accuracy.svg"))).toBe(true);
    const figureSvg = fs.readFileSync(path.join(rootDir, "manuscript", "figures", "accuracy.svg"), "utf8");
    expect(figureSvg).toContain("accuracy by run");
    expect(figureSvg).toContain("run 1");
    // The figure is traceable in the evidence graph to the exact runs it plots.
    const figureNode = svc.registerFigure(id, "accuracy", runs.map((run) => `run:${run.runId}`), "accuracy by run");
    expect(figureNode).toBe("figure:accuracy");
    const graph = svc.evidence.graph(id);
    expect(graph.nodes.some((node) => node.id === "figure:accuracy" && node.kind === "figure-table")).toBe(true);
    const graphRunIds = runs.map((run) => `run:${run.runId}`);
    expect(graph.edges.filter((edge) => edge.to === "figure:accuracy").map((edge) => edge.from).sort()).toEqual([...graphRunIds].sort());
    // Paper sentences: every manuscript section asserting the claim is recorded
    // as a paper-sentence node bound to claim:accuracy + figure:accuracy —
    // completing the chain Claim / Figure/Table → Paper Sentence.
    const abstractId = svc.registerPaperSection(id, "abstract", { claimNodeIds: ["claim:accuracy"], figureNodeIds: [] });
    const resultsId = svc.registerPaperSection(id, "results", { claimNodeIds: ["claim:accuracy"], figureNodeIds: ["figure:accuracy"] });
    expect(abstractId).toBe("paper:abstract");
    expect(resultsId).toBe("paper:results");
    const full = svc.evidence.graph(id);
    expect(full.nodes.some((node) => node.id === "paper:abstract" && node.kind === "paper-sentence")).toBe(true);
    expect(full.nodes.some((node) => node.id === "paper:results" && node.kind === "paper-sentence")).toBe(true);
    expect(full.edges.some((edge) => edge.from === "claim:accuracy" && edge.to === "paper:abstract")).toBe(true);
    expect(full.edges.some((edge) => edge.from === "claim:accuracy" && edge.to === "paper:results")).toBe(true);
    expect(full.edges.some((edge) => edge.from === "figure:accuracy" && edge.to === "paper:results")).toBe(true);
    // Durable IR + frozen protocol snapshots sit beside the manuscript tree.
    const snapshots = svc.snapshotArtifacts(id);
    const irSnapshot = JSON.parse(fs.readFileSync(snapshots.irFile, "utf8"));
    expect(irSnapshot.id).toBe(id);
    expect(irSnapshot.protocolHash).toBe(frozen.hash);
    const protocolSnapshot = JSON.parse(fs.readFileSync(snapshots.protocolFile!, "utf8"));
    expect(protocolSnapshot.protocolHash).toBe(frozen.hash);
    expect(protocolSnapshot.amendments).toEqual([]);
    const citations = JSON.parse(fs.readFileSync(output.audit.citationsFile, "utf8"));
    expect(citations.unsupportedIds).toEqual(["cite:bad"]); // primary claim may not bind UNSUPPORTED
    const reproWritten = JSON.parse(fs.readFileSync(output.audit.reproducibilityFile, "utf8"));
    expect(reproWritten.status).toBe("REPRODUCED");
    const finalAudit = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(finalAudit.reproducibility).toBe("REPRODUCED");
    expect(finalAudit.citations.ok).toBe(false);
    expect(finalAudit.passed).toBe(false); // sections revised but an UNSUPPORTED citation is bound → integrity fails closed
    expect(output.paperMd).toContain("# Evidence vs Majority");
  });

  it("passes integrity end-to-end when every citation verifies", { timeout: 60000 }, async () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "a.ts"), "export const a = 1;");
    const svc = new ResearchService({ root: path.join(workspace, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
    const id = "tree2";
    svc.start(ir(id, workspace));
    const frozen = svc.freeze(id, protocol());
    await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 9), seed: 1 });
    await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 11), seed: 2 });
    const options = { claimId: "claim:accuracy", metric: "accuracy", protocolHash: frozen.hash, votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" as const }] };
    const repro = svc.reproducibility(id, options);
    svc.citations.put({ id: "cite:a", proposedTitle: "Verified", status: "CLAIM_SUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() });
    const derived = svc.manuscriptClaims(id);
    const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return brief.evidenceIds.length ? `${brief.section} @${brief.evidenceIds.join(", @")}` : brief.section; } };
    const output = await svc.manuscript(id, {
      title: "T", plan: { id, claimsToSections: { "claim:accuracy": ["results"] } },
      claims: derived.claims, evidenceIds: derived.evidenceIds, writer, reproducibility: repro, citations: svc.citations.list()
    });
    const finalAudit = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(repro.status).toBe("REPRODUCED");
    expect(finalAudit.passed).toBe(true);
    expect(finalAudit.citations.ok).toBe(true);
  });
});
