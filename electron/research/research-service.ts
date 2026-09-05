import fs from "node:fs";
import path from "node:path";
import { validId, writeJson } from "../commander/durable-json";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ResearchProtocol, ProtocolFreezeResult, ProtocolAmendment } from "../../src/shared/research-protocol";
import { ResearchLedger, type ResearchLedgerFile, type ResearchDecisionEntry } from "./research-ledger";
import { ResearchSupervisor, protocolHash } from "./research-supervisor";
import { ProtocolManager } from "./protocol-manager";
import { EvidenceGraph, type PrimaryRunRecord } from "./evidence/evidence-graph";
import { CitationSourceStore } from "./literature/source-store";
import { assembleManuscript, type ManuscriptOptions } from "./manuscript/manuscript-assembler";
import type { ResearchStageExecutor } from "./research-supervisor";
import { ResearchRuntime } from "./runtime/research-runtime";
import { PrimaryRunRecorder, type PrimaryExperimentOptions, type RecordedExperiment } from "./runtime/run-recorder";
import { analyzeRecordedRuns, type RunAnalysisOptions, type RunAnalysisResult } from "./evidence/run-analysis";
import { buildReproducibilityAudit, type ReproducibilityAudit } from "./evidence/repro-audit";
import { manuscriptClaimsFromGraph, type ManuscriptClaimsDerivation } from "./evidence/graph-claims";
import { validateLevelAPlan, type LevelAPlan } from "../../src/shared/research-levela";

/**
 * Research service facade (plan 9-6 Phase 5–11 glue). One object composes the
 * durable ledger, autopilot supervisor, protocol manager, evidence graph and
 * manuscript assembler under a research root, so the GUI IPC (main.ts) and an
 * offline integration test can drive a full research run without touching the
 * internals. Evidence > vote and protocol-freeze rules stay enforced by the
 * individual modules.
 */

export interface ResearchServiceOptions {
  root: string;
  executor: ResearchStageExecutor;
  /** Optional structured runtime; required for runExperiment(). */
  runtime?: ResearchRuntime;
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
    this.ledger = new ResearchLedger(path.join(root, "ledger"));
    this.protocols = new ProtocolManager(path.join(root, "protocols"));
    this.evidence = new EvidenceGraph(path.join(root, "evidence"));
    this.citations = new CitationSourceStore(path.join(root, "citations"));
    this.supervisor = new ResearchSupervisor({ ledger: this.ledger, executor: options.executor });
    this.runtime = options.runtime;
  }

  start(ir: ResearchIR): ResearchLedgerFile { return this.supervisor.start(ir); }

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
   * the protocol must already be frozen, and the protocol hash of the run must
   * match the frozen one (Phase 7 silent-mutation guard) — an experiment can
   * never attach to an unfrozen or amended protocol.
   */
  async runExperiment(id: string, options: PrimaryExperimentOptions): Promise<RecordedExperiment> {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    if (record.ir.state !== "PROTOCOL_FROZEN" || !record.ir.protocolHash) throw new Error("Protocol must be frozen before experiments run");
    if (options.protocolHash !== record.ir.protocolHash) throw new Error("Experiment protocol hash does not match the frozen protocol");
    if (!this.runtime) throw new Error("Research runtime not configured for this service");
    const recorder = new PrimaryRunRecorder(this.evidence, this.runtime);
    return recorder.run(id, options);
  }

  /**
   * Analyzes the real recorded runs of a frozen protocol into deterministic
   * statistics + an evidence>vote claim verdict (Phase 10). Same fail-closed
   * rules as runExperiment: run must exist, protocol frozen, hash must match.
   */
  analyzeRuns(id: string, options: RunAnalysisOptions): RunAnalysisResult {
    const record = this.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    if (record.ir.state !== "PROTOCOL_FROZEN" || !record.ir.protocolHash) throw new Error("Protocol must be frozen before analysis");
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
