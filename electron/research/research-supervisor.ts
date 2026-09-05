import { createHash } from "node:crypto";
import { nextResearchState, validateResearchIR, type ResearchIR, type ResearchState } from "../../src/shared/research-ir";
import { ResearchLedger, type ResearchDecisionEntry, type ResearchLedgerFile } from "./research-ledger";

/**
 * Order-independent canonical JSON (sorted keys) so a frozen protocol hashes
 * stably regardless of object key insertion order.
 */
function canonicalStable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalStable(record[key])}`).join(",")}}`;
}

export function protocolHash(protocol: string | object): string {
  const content = typeof protocol === "string" ? protocol : canonicalStable(protocol);
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Research supervisor (plan 9-6 Phase 5/6). Autopilot driver over the durable
 * ledger: it advances a research run stage by stage and, at protocol-freezing
 * points, records an immutable protocol hash so later phases (experiment,
 * analysis, manuscript) never silently mutate the frozen hypothesis/primary
 * metric (Phase 7 amendment rules plug in here). Executors are injected so the
 * control flow is deterministic and testable without live web AIs.
 */

export interface ResearchStageExecutor {
  /** Executes one stage; returns a compact outcome to record as a decision. */
  run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<{ summary: string; evidenceRefs?: string[] }>;
}

export interface SupervisorOptions {
  executor: ResearchStageExecutor;
  ledger: ResearchLedger;
}

export class ResearchSupervisor {
  constructor(private readonly options: SupervisorOptions) {}

  /** Boots a run into SCOPING and returns the durable record. */
  start(ir: ResearchIR): ResearchLedgerFile {
    validateResearchIR(ir);
    return this.options.ledger.create(ir);
  }

  /** Autopilot: runs the current stage then advances to the plan's successor. */
  async step(id: string): Promise<{ state: ResearchState; decision?: ResearchDecisionEntry }> {
    const record = this.options.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const stage = record.ir.state;
    const next = nextResearchState(stage, true);
    if (!next) return { state: stage }; // READY / FAILED are terminal
    const outcome = await this.options.executor.run({ ir: record.ir, stage, workspace: record.ir.scope.workspace });
    const decision = this.options.ledger.appendDecision(id, { stepId: stage, decision: stage.toLowerCase(), reason: outcome.summary.slice(0, 500), evidenceRefs: outcome.evidenceRefs ?? [] });
    const advanced = this.options.ledger.advance(id, `stage ${stage} → ${next}`);
    return { state: advanced?.ir.state ?? stage, decision };
  }

  /** Jumps to a control state (used by the supervisor on provider/user waits). */
  wait(id: string, state: Extract<ResearchState, "WAITING_FOR_USER" | "WAITING_FOR_PROVIDER">, reason: string): void {
    this.options.ledger.setState(id, state, reason);
  }

  /** Resumes a run paused at a control state back to SCOPING (user answered / provider ready). */
  resume(id: string): boolean {
    const record = this.options.ledger.load(id);
    if (!record) return false;
    const state = record.ir.state;
    if (state !== "WAITING_FOR_USER" && state !== "WAITING_FOR_PROVIDER" && state !== "RECOVERING") return false;
    this.options.ledger.setState(id, "SCOPING", `resumed from ${state}`);
    return true;
  }

  fail(id: string, reason: string): void {
    this.options.ledger.setState(id, "FAILED", reason);
  }
}
