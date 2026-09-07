import fs from "node:fs";
import path from "node:path";
import { readJson, validId, writeJson } from "../commander/durable-json";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ResearchProtocol, ProtocolFreezeResult, ProtocolAmendment } from "../../src/shared/research-protocol";
import { ResearchLedger, type ResearchLedgerFile, type ResearchDecisionEntry } from "./research-ledger";
import { ResearchSupervisor, protocolHash } from "./research-supervisor";
import { ProtocolManager } from "./protocol-manager";
import { EvidenceGraph, type PrimaryRunRecord } from "./evidence/evidence-graph";
import { CitationSourceStore } from "./literature/source-store";
import { assembleManuscript, type ManuscriptOptions } from "./manuscript/manuscript-assembler";
import type { ResearchStageExecutor } from "./research-supervisor";
import { artifactKindForStage, stageArtifact, type ResearchStageArtifact } from "../../src/shared/research-roles";
import { ResearchRuntime } from "./runtime/research-runtime";
import { PrimaryRunRecorder, type PrimaryExperimentOptions, type RecordedExperiment } from "./runtime/run-recorder";
import { analyzeRecordedRuns, type RunAnalysisOptions, type RunAnalysisResult } from "./evidence/run-analysis";
import { buildReproducibilityAudit, type ReproducibilityAudit } from "./evidence/repro-audit";
import { manuscriptClaimsFromGraph, type ManuscriptClaimsDerivation } from "./evidence/graph-claims";
import { validateLevelAPlan, type LevelAPlan } from "../../src/shared/research-levela";
import { humanResearchToIR, type HumanDefinedResearchInput } from "../../src/shared/research-input";

/**
 * Research service facade (plan 9-6 Phase 5–11 glue). One object composes the
 * durable ledger, autopilot supervisor, protocol manager, evidence graph and
 * manuscript assembler under a research root, so the GUI IPC (main.ts) and an
 * offline integration test can drive a full research run without touching the
 * internals. Evidence > vote and protocol-freeze rules stay enforced by the
 * individual modules.
 */

export interface ResearchServiceOptions {
  /**
   * Research artifact root. Durable snapshots (research/<id>/research-ir.json,
   * protocol.json), the manuscript tree (research/<id>/manuscript) and audit
   * files are written under it.
   */
  root: string;
  executor: ResearchStageExecutor;
  /** Optional structured runtime; required for runExperiment(). */
  runtime?: ResearchRuntime;
  /**
   * Per-store roots (milestone §6). When omitted each store defaults to a
   * `root/<sub>` directory. The GUI passes its pre-existing durable locations
   * here (ledger files under `.boss/research/<id>.json`, protocols under
   * `.boss/research-protocols/`) so runs started before the composition-root
   * migration stay recoverable from the exact same files.
   */
  ledgerRoot?: string;
  protocolsRoot?: string;
  evidenceRoot?: string;
  citationsRoot?: string;
}

/** Fail-closed READY verdict over the durable artifact tree (milestone §21). */
export interface ResearchReadyVerdict {
  ok: boolean;
  reasons: string[];
}

export class ResearchService {
  readonly ledger: ResearchLedger;
  readonly supervisor: ResearchSupervisor;
  readonly protocols: ProtocolManager;
  readonly evidence: EvidenceGraph;
  readonly citations: CitationSourceStore;
  readonly runtime: ResearchRuntime | undefined;

  constructor(private readonly options: ResearchServiceOptions) {
    const root = options.root;
    this.ledger = new ResearchLedger(options.ledgerRoot ?? path.join(root, "ledger"));
    this.protocols = new ProtocolManager(options.protocolsRoot ?? path.join(root, "protocols"));
    this.evidence = new EvidenceGraph(options.evidenceRoot ?? path.join(root, "evidence"));
    this.citations = new CitationSourceStore(options.citationsRoot ?? path.join(root, "citations"));
    // Milestone §21: READY is gated by the durable artifact tree — the state
    // machine alone can never mark a run READY.
    this.supervisor = new ResearchSupervisor({ ledger: this.ledger, executor: options.executor, readyGate: ({ id }) => this.readiness(id) });
    this.runtime = options.runtime;
  }

  /**
   * Fail-closed READY gate (milestone §21). Checks the durable artifact tree of
   * a run and returns ok=true only when every acceptance item holds: the human
   * RQ is anchored and unchanged, the protocol is frozen with matching hashes,
   * real recorded runs (≥2 distinct seeds) bind to the frozen hash, the
   * deterministic analysis / replication / reproducibility / adjudication /
   * citation audits exist and pass, the manuscript + paper.tex/.pdf exist, the
   * compile audit is PASS and final-audit.json.passed === true. Reaching READY
   * in the state machine is never sufficient on its own.
   */
  readiness(id: string): ResearchReadyVerdict {
    const reasons: string[] = [];
    const record = this.ledger.load(id);
    if (!record) return { ok: false, reasons: ["run does not exist"] };
    const ir = record.ir;
    const runDir = path.join(this.options.root, validId(id));
    const readFile = (file: string): unknown | undefined => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } };
    const artifactExtra = (name: string): Record<string, unknown> | undefined => this.readStageArtifact(id, name)?.extra as Record<string, unknown> | undefined;
    const manuscriptDir = path.join(runDir, "manuscript");
    const auditDir = path.join(runDir, "audit");

    // 1. Human RQ anchored and not silently changed.
    if (!ir.researchQuestions[0]) reasons.push("research question not anchored");
    else if (ir.researchQuestions[0] !== ir.goal) reasons.push("research question was silently changed (immutability violation)");
    if (!ir.hypotheses[0]) reasons.push("hypothesis missing");
    // 2. Protocol frozen with matching hash in IR and protocol store.
    const store = this.protocols.load(id);
    if (!store || !ir.protocolHash) reasons.push("protocol not frozen");
    else if (store.protocolHash !== ir.protocolHash) reasons.push("protocol hash mismatch between IR and protocol store");
    if (!fs.existsSync(path.join(runDir, "protocol.json"))) reasons.push("protocol.json snapshot missing");
    // 3. Real recorded runs under the frozen protocol (no fabricated runs).
    const runs = this.evidence.runs(id);
    if (artifactExtra("primary-runs.json")) {
      if (runs.length < 2) reasons.push("fewer than 2 recorded experiment runs");
      if (new Set(runs.map((run) => run.seed)).size < 2) reasons.push("fewer than 2 distinct seeds (no independent replication)");
      if (ir.protocolHash && runs.some((run) => run.protocolHash !== ir.protocolHash)) reasons.push("recorded run protocol hash does not match the frozen protocol");
    } else {
      reasons.push("primary-runs artifact missing");
    }
    // 4. Deterministic analysis artifact exists.
    if (!artifactExtra("analysis.json")) reasons.push("analysis artifact missing (no deterministic statistics)");
    // 5. Replication + reproducibility audit.
    const replication = artifactExtra("replication.json");
    if (!replication) reasons.push("replication artifact missing");
    else if (replication.status !== "REPRODUCED") reasons.push(`reproducibility not REPRODUCED (${replication.status ?? "?"})`);
    // 6. Evidence adjudication: claim verdict recorded as SUPPORTED.
    const verdicts = artifactExtra("claim-verdicts.json");
    if (!verdicts) reasons.push("claim-verdicts artifact missing");
    else if (verdicts.status !== "SUPPORTED") reasons.push(`primary claim not SUPPORTED (${verdicts.status ?? "?"})`);
    // 7. Citation audit ok — no unsupported/contradicted citation bound.
    const citationAudit = artifactExtra("citation-audit.json");
    const citationOk = citationAudit?.audit && (citationAudit.audit as { ok?: boolean }).ok === true;
    if (!citationOk) reasons.push("citation audit not ok (unsupported/contradicted citation bound or audit missing)");
    // 8. Manuscript review passed + paper tree exists.
    const review = artifactExtra("manuscript-review.json");
    if (!review || review.sectionsRevised !== true) reasons.push("manuscript review not passed");
    for (const file of ["paper.md", "paper.tex", "references.bib"]) if (!fs.existsSync(path.join(manuscriptDir, file))) reasons.push(`${file} missing`);
    const figures = fs.existsSync(path.join(manuscriptDir, "figures")) ? fs.readdirSync(path.join(manuscriptDir, "figures")).filter((name) => /\.(svg|png|pdf|jpg)$/i.test(name)) : [];
    // U7 §21.2: a quantitative run must embed meaningful visual evidence in the
    // COMPILED artifact. Tables are embedded as LaTeX tabular; a png/pdf/jpg
    // figure is also embeddable. An SVG file alone is NOT embeddable by
    // pdflatex/xelatex and never counts as compiled visual evidence.
    const hasQuantitative = Boolean(artifactExtra("primary-runs.json"));
    if (hasQuantitative) {
      const texPath = path.join(manuscriptDir, "paper.tex");
      const tex = fs.existsSync(texPath) ? fs.readFileSync(texPath, "utf8") : "";
      const embeddableInTex = tex.includes("\\begin{table}") || /\\includegraphics/.test(tex);
      if (!embeddableInTex) reasons.push("MANUSCRIPT_VISUAL_EVIDENCE_INSUFFICIENT: quantitative run with no result table or embeddable figure in paper.tex");
    }
    if (figures.length === 0 && !hasQuantitative) reasons.push("no manuscript figure present");
    // 9. Compile audit PASS + a real paper.pdf.
    const compile = readFile(path.join(auditDir, "compile.json")) as { status?: string } | undefined;
    if (!compile || compile.status !== "PASS") reasons.push("compile audit not PASS");
    const pdf = path.join(manuscriptDir, "paper.pdf");
    if (!fs.existsSync(pdf) || fs.statSync(pdf).size === 0) reasons.push("paper.pdf missing or empty");
    // 10. final-audit.json.passed === true.
    const finalAudit = readFile(path.join(auditDir, "final-audit.json")) as { passed?: boolean } | undefined;
    if (!finalAudit || finalAudit.passed !== true) reasons.push("final-audit.json.passed !== true");
    // 11. Evidence chain: no dangling primary-claim edges.
    const graph = this.evidence.graph(id);
    const claims = this.manuscriptClaims(id);
    for (const node of graph.nodes.filter((item) => item.kind === "claim")) {
      const upstream = claims.claims.find((claim) => claim.id === node.id)?.evidenceIds ?? [];
      if (upstream.length === 0) reasons.push(`claim ${node.id} has no upstream evidence (dangling edge)`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  start(ir: ResearchIR): ResearchLedgerFile {
    // One research run owns the citation store: reset so later runs never pick
    // up another run's literature/citations.
    this.citations.reset();
    return this.supervisor.start(ir);
  }

  /**
   * Starts a research run from the milestone's human-defined input (§1/§36):
   * falsifiable research question (immutable anchor) + authorized workspace +
   * budget. The IR is built by `humanResearchToIR` (validated fail-closed:
   * RQ required, workspace required, positive integer budgets). A supplied
   * hypothesis is pre-recorded; otherwise the conductor drafts one later —
   * either way the question anchor is never rewritten.
   */
  startHumanResearch(input: HumanDefinedResearchInput): ResearchLedgerFile {
    const ir = humanResearchToIR(input);
    return this.start(ir);
  }

  /**
   * Starts a research run from a deterministic Level-A plan (round 26): the IR
   * records the selected falsifiable question + hypothesis. The live flow then
   * freezes a real protocol (freeze()) before experiments run — no protocol is
   * invented here.
   */
  startLevelA(input: { id: string; goal: string; workspace: string; reviewers: string[]; plan: LevelAPlan }): ResearchLedgerFile {
    validateLevelAPlan(input.plan); // fail-closed: falsifiable question + ≥2 replication runs required
    if (!input.plan?.selectedQuestion?.question || !input.plan.hypothesis) throw new Error("Level-A plan requires a question and hypothesis");
    const ir: ResearchIR = {
      schemaVersion: 1,
      id: input.id,
      goal: input.goal,
      scope: { workspace: input.workspace, allowedDomains: [], reviewers: input.reviewers, autonomy: "AUTOPILOT", budget: { maxExperiments: input.plan.experiment.replicationRuns + 1, maxSteps: 30 } },
      state: "SCOPING",
      researchQuestions: [input.plan.selectedQuestion.question],
      hypotheses: [input.plan.hypothesis],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return this.supervisor.start(ir);
  }
  status(id: string): ResearchLedgerFile | undefined { return this.ledger.load(id); }
  step(id: string): Promise<{ state: ResearchState; decision?: ResearchDecisionEntry }> { return this.supervisor.step(id); }
  wait(id: string, state: Extract<ResearchState, "WAITING_FOR_USER" | "WAITING_FOR_PROVIDER">, reason: string): void { this.supervisor.wait(id, state, reason); }
  fail(id: string, reason: string): void { this.supervisor.fail(id, reason); }

  freeze(id: string, protocol: ResearchProtocol): ProtocolFreezeResult {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const result = this.protocols.freeze(id, protocol);
    this.ledger.setState(id, "PROTOCOL_FROZEN", "protocol frozen");
    this.ledger.checkpoint(id, (next) => { next.ir.protocolHash = result.hash; next.ir.updatedAt = new Date().toISOString(); }, "protocol hash recorded");
    return result;
  }

  /**
   * Records an approved frozen-field amendment bound to the frozen protocol hash
   * (Phase 7: silent scientific mutation is forbidden; changes need an
   * amendment). Fail-closed: run must exist and the protocol must be frozen.
   * An amendment never changes the frozen hash the experiments bind to.
   */
  amend(id: string, amendment: Omit<ProtocolAmendment, "protocolHash" | "approved" | "createdAt">): ProtocolAmendment {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    if (record.ir.state !== "PROTOCOL_FROZEN" || !record.ir.protocolHash) throw new Error("Protocol must be frozen before amendment");
    return this.protocols.amend(id, amendment);
  }

  amendments(id: string): ProtocolAmendment[] {
    return this.protocols.amendments(id);
  }

  /**
   * Verifies one citation where source acquisition is derived from the citation
   * store's content-addressed cache (round 30): a saved source advances the
   * ladder to ≥ SOURCE_RETRIEVED deterministically; passage support is still
   * caller evidence. Fail-closed on unknown citation ids.
   */
  verifyCitation(id: string, evidence: { metadataVerified: boolean; passageLocated?: boolean; passageSupports?: boolean; passageContradicts?: boolean; passages?: Array<{ quote: string; page?: string }> }): import("../../src/shared/research-citation").CitationStatus {
    return this.citations.verifySource(id, evidence);
  }

  recordRun(id: string, run: PrimaryRunRecord): void { this.evidence.addRun(id, run); }

  /**
   * Runs a *real* experiment through the structured runtime and records the
   * primary run against the frozen protocol. Fail-closed: the run must exist,
   * the protocol must already be frozen (the IR carries the frozen hash), and
   * the protocol hash of the run must match the frozen one (Phase 7
   * silent-mutation guard) — an experiment can never attach to an unfrozen or
   * amended protocol. Frozen means "the IR records a frozen hash"; the run may
   * have autopiloted past the PROTOCOL_FROZEN state (conductor flow).
   */
  async runExperiment(id: string, options: PrimaryExperimentOptions): Promise<RecordedExperiment> {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    if (!record.ir.protocolHash) throw new Error("Protocol must be frozen before experiments run");
    if (options.protocolHash !== record.ir.protocolHash) throw new Error("Experiment protocol hash does not match the frozen protocol");
    if (!this.runtime) throw new Error("Research runtime not configured for this service");
    const recorder = new PrimaryRunRecorder(this.evidence, this.runtime);
    return recorder.run(id, options);
  }

  /**
   * Analyzes the real recorded runs of a frozen protocol into deterministic
   * statistics + an evidence>vote claim verdict (Phase 10). Same fail-closed
   * rules as runExperiment: run must exist, protocol frozen (hash present),
   * hash must match.
   */
  analyzeRuns(id: string, options: RunAnalysisOptions): RunAnalysisResult {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    if (!record.ir.protocolHash) throw new Error("Protocol must be frozen before analysis");
    if (options.protocolHash !== record.ir.protocolHash) throw new Error("Analysis protocol hash does not match the frozen protocol");
    return analyzeRecordedRuns(this.evidence, id, options);
  }

  /**
   * Deterministic reproducibility audit of a claim over its recorded runs
   * (REPRODUCED only when the round-11 analysis shows evidence + independent
   * replication). Fail-closed guards mirror analyzeRuns.
   */
  reproducibility(id: string, options: RunAnalysisOptions): ReproducibilityAudit {
    return buildReproducibilityAudit(this.analyzeRuns(id, options));
  }

  /** Reference hash helper so callers never hand-roll canonical JSON. */
  hashProtocol(protocol: ResearchProtocol): string { return protocolHash(protocol); }

  /**
   * Materializes the head of the evidence chain (Question → Hypothesis →
   * Protocol → Experiment) from the ledger IR + frozen protocol + recorded
   * runs, so experiment→run edges never dangle. Idempotent; call after freeze
   * and after experiments are recorded.
   */
  syncEvidenceChain(id: string): void {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const experimentIds = [...new Set(this.evidence.runs(id).map((run) => run.experimentId))];
    this.evidence.syncChain(id, {
      questions: record.ir.researchQuestions,
      hypotheses: record.ir.hypotheses,
      protocolHash: record.ir.protocolHash,
      experimentIds
    });
  }

  /** Assembles the manuscript tree for a ready run (writes research/<id>/manuscript + audit). */
  manuscript(id: string, options: ManuscriptOptions): Promise<Awaited<ReturnType<typeof assembleManuscript>>> {
    return assembleManuscript(this.options.root, options);
  }

  /**
   * Materializes the run's durable snapshots into the artifact tree
   * (research/<id>/research-ir.json + protocol.json, plan Phase 11 tree). The
   * protocol.json is written only once the protocol is frozen (never a stub).
   * Returns the written file paths.
   */
  snapshotArtifacts(id: string): { irFile: string; protocolFile?: string } {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const dir = path.join(this.options.root, validId(id));
    fs.mkdirSync(dir, { recursive: true });
    const irFile = path.join(dir, "research-ir.json");
    writeJson(irFile, record.ir);
    const store = this.protocols.load(id);
    let protocolFile: string | undefined;
    if (store) {
      protocolFile = path.join(dir, "protocol.json");
      writeJson(protocolFile, store);
    }
    return { irFile, protocolFile };
  }

  /**
   * Exports the finished run's deliverables to a standalone topic folder
   * (user requirement): `(Root)/Research/<Research Title>/files/…` with all
   * process + final documents grouped under the topic. The destination folder
   * is cleared first (no stale leftovers), and names never use timestamps.
   * Returns the destination path.
   */
  exportDeliverables(id: string, destRoot: string): string {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const src = path.join(this.options.root, validId(id));
    const dest = path.resolve(destRoot);
    fs.rmSync(dest, { recursive: true, force: true });
    const filesDir = path.join(dest, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    const copyTree = (rel: string): void => {
      const from = path.join(src, rel);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(filesDir, rel), { recursive: true });
    };
    copyTree("manuscript");
    copyTree("audit");
    copyTree("artifacts");
    copyTree("experiments");
    for (const file of ["research-ir.json", "protocol.json"]) {
      const from = path.join(src, file);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(filesDir, file));
    }
    // Export-only cleanup: no latex by-products or empty scratch dirs.
    for (const name of ["paper.aux", "paper.log", "paper.out"]) {
      try { fs.rmSync(path.join(filesDir, "manuscript", name), { force: true }); } catch { /* best effort */ }
    }
    for (const rel of ["experiments/logs", "experiments/runs"]) {
      try { fs.rmSync(path.join(filesDir, rel), { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return dest;
  }

  /**
   * Persists one typed stage artifact (milestone §4 Stage Artifact Contract).
   * Every stage that performs real work records a typed artifact
   * (stage + role + kind + summary + evidence refs — never prose-only) as
   * research/<id>/artifacts/<file>.json. The file name defaults to the stage's
   * artifact kind (e.g. `repo-scan.json`); callers may pass an explicit
   * milestone file name (e.g. `project-inspection.json`) when the plan names
   * one. Writes are idempotent per file (re-running a crash-recovered stage
   * overwrites the same artifact instead of duplicating it). Fail-closed on
   * unknown run ids.
   */
  saveStageArtifact(id: string, input: { stage: ResearchState; summary: string; evidenceRefs?: string[]; file?: string; extra?: Record<string, unknown> }): string {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const artifact = stageArtifact({ stage: input.stage, summary: input.summary, evidenceRefs: input.evidenceRefs });
    const dir = path.join(this.options.root, validId(id), "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const stem = validId((input.file ?? artifactKindForStage(input.stage)).replace(/\.json$/i, ""));
    const file = path.join(dir, `${stem}.json`);
    writeJson(file, { ...artifact, ...(input.extra ? { extra: input.extra } : {}) });
    return file;
  }

  /** Durable stage-artifact directory research/<id>/artifacts (milestone §4). */
  artifactDir(id: string): string {
    return path.join(this.options.root, validId(id), "artifacts");
  }

  /** Lists the durable stage artifacts of a run (sorted file paths); [] when none. */
  stageArtifacts(id: string): string[] {
    const dir = this.artifactDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(dir, name));
  }

  /** Latest typed stage artifact for one stage (or undefined when the stage never recorded one). */
  stageArtifactFor(id: string, stage: ResearchState): (ResearchStageArtifact & { extra?: Record<string, unknown> }) | undefined {
    const kind = artifactKindForStage(stage);
    const file = path.join(this.options.root, validId(id), "artifacts", `${kind}.json`);
    if (!fs.existsSync(file)) return undefined;
    return readJson<ResearchStageArtifact & { extra?: Record<string, unknown> }>(file);
  }

  /**
   * Reads one stage artifact by file name (e.g. `experiment-plan.json`,
   * `primary-runs.json`) from research/<id>/artifacts/. Returns the parsed
   * JSON or undefined. Used by the conductor to re-read durable stage plans
   * after a crash/restart instead of relying on in-memory state.
   */
  readStageArtifact(id: string, file: string): Record<string, unknown> | undefined {
    const dir = path.join(this.options.root, validId(id), "artifacts");
    const target = path.join(dir, validId(file.replace(/\.json$/i, "")) + ".json");
    return fs.existsSync(target) ? readJson<Record<string, unknown>>(target) : undefined;
  }

  /**
   * Derives the manuscript claims/evidence wiring from the evidence graph's
   * real claim + statistic nodes (round 11), so a caller can pass them into
   * manuscript() and every asserted claim stays traceable to recorded runs.
   */
  manuscriptClaims(id: string): ManuscriptClaimsDerivation {
    return manuscriptClaimsFromGraph(this.evidence, id);
  }

  /**
   * Registers a figure node bound to its source runs (round 22). Call after a
   * figure file was written (e.g. via manuscript figures) so a paper figure is
   * traceable in the evidence graph to the exact runs that produced it.
   * Returns the figure node id (e.g. `figure:accuracy`).
   */
  registerFigure(id: string, figureId: string, sourceRunIds: string[], label?: string): string {
    return this.evidence.addFigure(id, figureId, sourceRunIds, label);
  }

  /**
   * Records one paper-sentence node per manuscript section (round 28), bound to
   * the claim + figure nodes the section asserts — completing the evidence
   * chain Claim / Figure/Table → Paper Sentence. Deterministic: sections are
   * recorded after the manuscript is assembled, never invented.
   */
  registerPaperSection(id: string, sectionId: string, input: { claimNodeIds?: string[]; figureNodeIds?: string[] }, label?: string): string {
    return this.evidence.addPaperSection(id, sectionId, input, label);
  }
}
