import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { metricFigureSvg } from "../src/shared/research-figures";
import { ResearchService } from "../electron/research/research-service";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-raudit-")); dirs.push(dir); return dir; }

function ir(id: string, workspace: string) {
  return {
    schemaVersion: 1 as const, id, goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT" as const, budget: { maxExperiments: 3, maxSteps: 20 } },
    state: "SCOPING" as const, researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}
function protocol() {
  return { schemaVersion: 1 as const, hypothesis: "H: evidence beats majority", primaryMetric: "accuracy", baseline: "0.8", sampleDefinition: "tasks 1..20", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString() };
}
function metricsSpec(cwd: string, accuracy: number) {
  return { executable: process.execPath, args: ["-e", `console.log('METRICS ' + JSON.stringify({accuracy: ${accuracy}}))`], cwd, purpose: "EXPERIMENT" as const, timeoutMs: 30000 };
}

/** Builds a full offline artifact tree exactly like research-artifact-tree.test.ts. */
async function buildTree(id: string, workspace: string, withBadCitation: boolean) {
  const svc = new ResearchService({ root: path.join(workspace, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
  svc.start(ir(id, workspace));
  const frozen = svc.freeze(id, protocol());
  await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 9), seed: 1 });
  await svc.runExperiment(id, { experimentId: "exp-accuracy", protocolHash: frozen.hash, spec: metricsSpec(workspace, 11), seed: 2 });
  const options = { claimId: "claim:accuracy", metric: "accuracy", protocolHash: frozen.hash, votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" as const }] };
  const repro = svc.reproducibility(id, options);
  if (withBadCitation) svc.citations.put({ id: "cite:bad", proposedTitle: "Unverified", status: "UNSUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() });
  else svc.citations.put({ id: "cite:good", proposedTitle: "Verified", status: "CLAIM_SUPPORTED", reasons: [], updatedAt: new Date(0).toISOString() });
  const derived = svc.manuscriptClaims(id);
  const runs = svc.evidence.runs(id);
  const figure = metricFigureSvg(runs.map((run, index) => ({ label: `run ${index + 1}`, value: run.metrics.accuracy })), { title: "accuracy by run", yLabel: "accuracy" });
  const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return brief.evidenceIds.length ? `${brief.section} supports @${brief.evidenceIds.join(", @")}` : brief.section; } };
  const output = await svc.manuscript(id, {
    title: "Evidence vs Majority", plan: { id, claimsToSections: { "claim:accuracy": ["results"] } },
    claims: derived.claims, evidenceIds: derived.evidenceIds, writer, reproducibility: repro, citations: svc.citations.list(), figures: [{ name: "accuracy.svg", svg: figure }]
  });
  expect(output.figures).toContain("accuracy.svg");
  svc.registerFigure(id, "accuracy", runs.map((run) => `run:${run.runId}`));
  svc.syncEvidenceChain(id);
  svc.registerPaperSection(id, "results", { claimNodeIds: ["claim:accuracy"], figureNodeIds: ["figure:accuracy"] });
  svc.snapshotArtifacts(id);
  return svc;
}

function runAudit(svcRoot: string, id: string) {
  const script = path.resolve(__dirname, "..", "scripts", "acceptance-research-audit.cjs");
  const result = spawnSync(process.execPath, [script, svcRoot, id], { encoding: "utf8", timeout: 60000 });
  return { code: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("research acceptance audit script (Final Acceptance I + J)", () => {
  it("PASSes an artifact tree with integrity satisfied (verified citations)", { timeout: 90000 }, async () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "a.ts"), "export const a = 1;");
    const svc = await buildTree("audit-ok", workspace, false);
    const { code, report } = runAudit(path.join(workspace, ".boss"), "audit-ok");
    expect(code).toBe(0);
    expect(report.status).toBe("PASS");
    const names = report.checks.map((check: { name: string; ok: boolean }) => `${check.name}=${check.ok}`);
    expect(names.join(";")).toContain("I4-reproduced=true");
    expect(names.join(";")).toContain("J5-figures-embedded=true");
    expect(svc.evidence.runs("audit-ok")).toHaveLength(2);
  });

  it("FAILs when an UNSUPPORTED citation is bound (final audit not passed)", { timeout: 90000 }, async () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "a.ts"), "export const a = 1;");
    await buildTree("audit-bad", workspace, true);
    const { code, report } = runAudit(path.join(workspace, ".boss"), "audit-bad");
    expect(code).toBe(1);
    expect(report.status).toBe("FAIL");
    const failed = report.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { name: string }) => check.name);
    expect(failed).toContain("I5-citations");
    expect(failed).toContain("I3-final-audit");
  });
});
