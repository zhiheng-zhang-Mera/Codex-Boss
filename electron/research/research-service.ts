import path from "node:path";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ResearchProtocol, ProtocolFreezeResult } from "../../src/shared/research-protocol";
import { ResearchLedger, type ResearchLedgerFile, type ResearchDecisionEntry } from "./research-ledger";
import { ResearchSupervisor, protocolHash } from "./research-supervisor";
import { ProtocolManager } from "./protocol-manager";
import { EvidenceGraph, type PrimaryRunRecord } from "./evidence/evidence-graph";
import { assembleManuscript, type ManuscriptOptions } from "./manuscript/manuscript-assembler";
import type { ResearchStageExecutor } from "./research-supervisor";
import { ResearchRuntime } from "./runtime/research-runtime";
import { PrimaryRunRecorder, type PrimaryExperimentOptions, type RecordedExperiment } from "./runtime/run-recorder";
import { analyzeRecordedRuns, type RunAnalysisOptions, type RunAnalysisResult } from "./evidence/run-analysis";

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
  readonly runtime: ResearchRuntime | undefined;

  constructor(private readonly options: ResearchServiceOptions) {
    const root = options.root;
    this.ledger = new ResearchLedger(path.join(root, "ledger"));
    this.protocols = new ProtocolManager(path.join(root, "protocols"));
    this.evidence = new EvidenceGraph(path.join(root, "evidence"));
    this.supervisor = new ResearchSupervisor({ ledger: this.ledger, executor: options.executor });
    this.runtime = options.runtime;
  }

  start(ir: ResearchIR): ResearchLedgerFile { return this.supervisor.start(ir); }
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

  /** Reference hash helper so callers never hand-roll canonical JSON. */
  hashProtocol(protocol: ResearchProtocol): string { return protocolHash(protocol); }

  /** Assembles the manuscript tree for a ready run (writes research/<id>/manuscript + audit). */
  manuscript(id: string, options: ManuscriptOptions): Promise<Awaited<ReturnType<typeof assembleManuscript>>> {
    return assembleManuscript(this.options.root, options);
  }
}
