#!/usr/bin/env node
/**
 * Offline full-chain research acceptance (Overcomplete §9 / §23 P1).
 *
 * Drives the REAL research pipeline without any provider session: a local
 * benchmark implementation (real spawned runs emitting METRICS), deterministic
 * host statistics/evidence/reproducibility, host literature fallback (offline
 * ⇒ empty, recorded), and a FIXTURE semantic provider that only supplies the
 * minimal requested JSON per stage (hypothesis / empty votes / empty verdicts /
 * clean manuscript verdict). Real experiment processes + deterministic host
 * stages are exercised end-to-end; the run is expected to stop at the BUILD
 * gate when no TeX engine exists (paper.md/.tex/bib + audits still produced).
 *
 * Requires `pnpm run build` first (loads dist-electron/*).
 * Usage: node scripts/acceptance-research-offline.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const moduleAt = (file) => require(path.join(__dirname, "..", "dist-electron", "electron", file));
const { ResearchService } = moduleAt("research/research-service");
const { ResearchRuntime } = moduleAt("research/runtime/research-runtime");
const { LiveResearchExecutor } = moduleAt("research/live-research-executor");
const { ResearchConductor } = moduleAt("research/research-conductor");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-research-offline-"));
const workspace = path.join(root, "workspace");
const dataRoot = path.join(root, "data");
fs.mkdirSync(path.join(workspace, "experiments"), { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
const startedAt = new Date().toISOString();
const evidence = { kind: "OFFLINE_RESEARCH_CHAIN", status: "RUNNING", startedAt, root, workspace };

// Real benchmark: per-seed deterministic accuracy-style metric + declared baseline.
fs.writeFileSync(path.join(workspace, "experiments", "bench-accuracy.cjs"), `// offline acceptance bench
const seed = Number(process.argv[3] ?? 1);
const noise = ((seed * 2654435761) >>> 0) % 1000 / 10000;
const accuracy = Math.min(0.999, 0.62 + noise);
process.stdout.write('METRICS ' + JSON.stringify({ answer_accuracy: accuracy }) + '\\n');
process.stdout.write('METRICS_META ' + JSON.stringify({ baseline: 0.5, source: 'random-chance' }) + '\\n');
`, "utf8");

const FIXTURE_ANSWERS = {
  QUESTION_FORMULATION: { hypothesis: "Evidence-weighted adjudication reduces review errors in a controlled software-engineering benchmark." },
  LITERATURE_REVIEW: [],
  ANALYSIS: { votes: [] },
  CITATION_AUDIT: { verdicts: [] },
  MANUSCRIPT: { approved: true, notes: [] }
};
const fixtureProvider = {
  async ask(input) {
    const answer = FIXTURE_ANSWERS[input.stage];
    if (answer === undefined) throw new Error(`Fixture provider has no answer for stage ${input.stage}`);
    return JSON.stringify(answer);
  }
};

(async () => {
  const research = new ResearchService({
    root: dataRoot,
    executor: new LiveResearchExecutor({
      inner: new ResearchConductor({
        service: () => research,
        provider: fixtureProvider,
        // §9.3 host retrieval: offline harness returns empty + honest note, so
        // the AI fallback (fixture []) leaves zero invented sources recorded.
        hostLiterature: async () => ({ records: [], note: "offline acceptance harness: no network access" })
      })
    }),
    runtime: new ResearchRuntime()
  });
  const record = research.startHumanResearch({
    researchQuestion: "Does evidence-weighted adjudication reduce review errors relative to majority-vote adjudication on a fixed software-engineering benchmark?",
    workspace,
    reviewers: ["reviewer-a"],
    budget: { maxSteps: 200, maxExperiments: 3, maxProviderCalls: 100 }
  });
  const researchId = record.ir.id;
  evidence.researchId = researchId;
  const outcome = await research.supervisor.runUntilBlocked(researchId, { maxSteps: 200 });
  evidence.outcome = outcome;
  const ledgerRecord = research.ledger.load(researchId);
  evidence.stages = ledgerRecord.decisions.map((entry) => ({ stage: entry.stage, decision: entry.decision, reason: String(entry.reason).slice(0, 160) }));
  const state = ledgerRecord.ir.state;
  evidence.state = state;
  evidence.status = "PARTIAL_PIPELINE_PASS";
  evidence.message = "offline deterministic research chain reached " + state + " (BUILD/PDF requires a TeX engine; manuscript + audits are produced)";
  // Durable artifact assertions: real recorded runs, stats, repro audit,
  // manuscript tree present.
  const artifactRoot = research.artifactDir(researchId);
  evidence.artifacts = {
    analysis: fs.existsSync(path.join(artifactRoot, "analysis.json")),
    reproducibility: fs.existsSync(path.join(path.dirname(artifactRoot), "audit", "reproducibility.json")),
    manuscriptMd: fs.existsSync(path.join(path.dirname(artifactRoot), "manuscript", "paper.md")),
    manuscriptTex: fs.existsSync(path.join(path.dirname(artifactRoot), "manuscript", "paper.tex")),
    baselineProvenance: fs.existsSync(path.join(artifactRoot, "baseline-provenance.json"))
  };
  const runs = research.evidence.runs(researchId);
  evidence.recordedRuns = runs.map((run) => ({ seed: run.seed, metrics: run.metrics }));
  const ok = evidence.artifacts.analysis && evidence.artifacts.reproducibility && evidence.artifacts.manuscriptMd && evidence.artifacts.manuscriptTex && evidence.artifacts.baselineProvenance && runs.length >= 2;
  if (!ok) throw new Error("Offline research chain artifacts incomplete: " + JSON.stringify(evidence.artifacts) + " runs=" + runs.length);
  evidence.status = "PASS";
  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => { evidence.status = "FAILED"; evidence.error = String(error); console.error(JSON.stringify(evidence, null, 2)); process.exitCode = 1; }).finally(() => {
  const outDir = path.join(__dirname, "..", "Update-Plan", "overcomplete", "evidence", "research");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "offline-chain-" + startedAt.slice(0, 19).replace(/[:T]/g, "-") + ".json"), JSON.stringify(evidence, null, 2));
});
