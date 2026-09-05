import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import type { ResearchProtocol } from "../src/shared/research-protocol";
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
    const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return brief.evidenceIds.length ? `${brief.section} supports @${brief.evidenceIds.join(", @")}` : `${brief.section} no claims`; } };

    const output = await svc.manuscript(id, {
      title: "Evidence vs Majority", authors: ["Boss"], plan: { id, claimsToSections: { "claim:accuracy": ["abstract", "results"] } },
      claims: derived.claims, evidenceIds: derived.evidenceIds, writer, reproducibility: repro, citations: svc.citations.list()
    });
    const rootDir = path.join(workspace, ".boss", id);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "paper.md"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "paper.tex"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "manuscript", "references.bib"))).toBe(true);
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
