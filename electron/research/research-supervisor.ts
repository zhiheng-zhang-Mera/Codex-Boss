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
  run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<StageOutcome>;
}

export interface StageOutcome {
  summary: string;
  evidenceRefs?: string[];
  /** When true the stage needs an external reviewer/decision: pause, never advance. */
  pause?: boolean;
  pauseReason?: string;
  /**
   * When true the stage failed closed (e.g. budget exhausted, real work could
   * not be produced, compile failed): the run moves to FAILED and never
   * advances. Milestone §7/§21 — reaching READY requires real stage work, so a
   * stage that cannot do real work fails the run instead of passing through.
   */
  fail?: { reason: string };
}

export interface SupervisorOptions {
  executor: ResearchStageExecutor;
  ledger: ResearchLedger;
  /**
   * Fail-closed READY gate (milestone §21): consulted whenever a step would
   * advance a run into READY. The gate is the final authority over the durable
   * artifact tree — reaching READY in the state machine is never sufficient by
   * itself. When it returns ok:false the run is FAILED with the reasons.
   */
  readyGate?: (input: { id: string; record: ResearchLedgerFile }) => { ok: boolean; reasons: string[] };
  /**
   * Automatic provider recovery (milestone §20): consulted when runUntilBlocked
   * parks at WAITING_FOR_PROVIDER. A live provider pool answers 'resume' when
   * it recovered (auto-resume the pending stage — never a manual Resume click);
   * 'stay' keeps the run parked (e.g. auth required → the caller escalates to
   * WAITING_FOR_USER, or budget exhausted → FAILED). Without this option
   * WAITING_FOR_PROVIDER stays a genuine block.
   */
  providerRecovery?: (input: { id: string; record: ResearchLedgerFile }) => Promise<"resume" | "stay">;
}

export class ResearchSupervisor {
  constructor(private readonly options: SupervisorOptions) {}

  /** Boots a run into SCOPING and returns the durable record. */
  start(ir: ResearchIR): ResearchLedgerFile {
    validateResearchIR(ir);
    return this.options.ledger.create(ir);
  }

  /**
   * Autopilot: runs the current stage then advances to the plan's successor —
   * unless the executor outcome requests a pause (reviewer-gated stage needing a
   * web-AI reviewer). A pause moves the run to WAITING_FOR_PROVIDER and records
   * the pending stage so resume() returns exactly there; the main state never
   * advances past a gate that was not actually passed (evidence > vote; no
   * fabricated advancement).
   */
  async step(id: string): Promise<{ state: ResearchState; decision?: ResearchDecisionEntry }> {
    const record = this.options.ledger.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    const stage = record.ir.state;
    // Control states only move through an explicit resume() — never an autopilot
    // step, otherwise a paused run would silently restart from SCOPING.
    if (stage === "RECOVERING" || stage === "WAITING_FOR_PROVIDER" || stage === "WAITING_FOR_USER") return { state: stage };
    const next = nextResearchState(stage, true);
    if (!next) return { state: stage }; // READY / FAILED are terminal
    let outcome: StageOutcome;
    try {
      outcome = await this.options.executor.run({ ir: record.ir, stage, workspace: record.ir.scope.workspace });
    } catch (error) {
      // Fail closed: an executor that cannot perform the stage (or throws doing
      // real work) never advances — the run becomes FAILED with the reason
      // recorded, so a placeholder/error can never look like a passed stage.
      const reason = String(error instanceof Error ? error.message : error).slice(0, 500);
      this.options.ledger.appendDecision(id, { stepId: stage, decision: `failed:${stage}`, reason, evidenceRefs: [] });
      this.options.ledger.setState(id, "FAILED", `stage ${stage} failed closed: ${reason}`);
      return { state: "FAILED" };
    }
    const decision = this.options.ledger.appendDecision(id, {
      stepId: stage,
      decision: outcome.pause ? `paused:${stage}` : outcome.fail ? `failed:${stage}` : stage.toLowerCase(),
      reason: (outcome.pauseReason ?? outcome.fail?.reason ?? outcome.summary).slice(0, 500),
      evidenceRefs: outcome.evidenceRefs ?? []
    });
    if (outcome.fail) {
      this.options.ledger.setState(id, "FAILED", outcome.fail.reason);
      return { state: "FAILED", decision };
    }
    if (outcome.pause) {
      // Reviewer gate: do NOT advance. Park at WAITING_FOR_PROVIDER and remember
      // the exact stage so a later resume() re-enters it for a real reviewer.
      this.options.ledger.pauseAt(id, stage, outcome.pauseReason ?? `stage ${stage} needs a web-AI reviewer`);
      return { state: "WAITING_FOR_PROVIDER", decision };
    }
    const advanced = this.options.ledger.advance(id, `stage ${stage} → ${next}`);
    // Milestone §21: READY only when the fail-closed gate over the durable
    // artifact tree passes. A run that merely reached the last machine state
    // (or whose gate files are missing/corrupt) is FAILED with recorded
    // reasons — never READY.
    if (advanced?.ir.state === "READY" && this.options.readyGate) {
      const gate = this.options.readyGate({ id, record: advanced });
      if (!gate.ok) {
        const reasonText = gate.reasons.join("; ").slice(0, 500);
        this.options.ledger.appendDecision(id, { stepId: "READY", decision: "failed:READY", reason: `READY gate failed: ${reasonText}`, evidenceRefs: [] });
        this.options.ledger.setState(id, "FAILED", `READY gate failed: ${reasonText}`);
        return { state: "FAILED" };
      }
    }
    return { state: advanced?.ir.state ?? stage, decision };
  }

  /**
   * Research autopilot (plan 9-7 §28, milestone §19/§20): keeps stepping a run
   * until it reaches a genuine blocking state (WAITING_FOR_USER / RECOVERING),
   * a terminal state (READY / FAILED), or the step cap. WAITING_FOR_PROVIDER
   * is NOT a manual-resume stop when a providerRecovery hook is configured:
   * the hook auto-resumes the pending stage once the provider recovered.
   */
  async runUntilBlocked(id: string, options: { maxSteps?: number } = {}): Promise<{ state: ResearchState; steps: number }> {
    const cap = Math.max(1, Math.min(options.maxSteps ?? 100, 500));
    for (let steps = 0; steps < cap; steps += 1) {
      const record = this.options.ledger.load(id);
      if (!record) throw new Error(`Unknown research run: ${id}`);
      const state = record.ir.state;
      if (state === "READY" || state === "FAILED") return { state, steps };
      if (state === "WAITING_FOR_USER" || state === "RECOVERING") return { state, steps };
      if (state === "WAITING_FOR_PROVIDER") {
        if (this.options.providerRecovery && (await this.options.providerRecovery({ id, record })) === "resume") {
          if (!this.resume(id)) return { state, steps };
          continue; // recovered → auto resume, keep driving
        }
        return { state, steps };
      }
      const result = await this.step(id);
      if (!result.state) return { state: record.ir.state, steps };
      // Guard against an executor that never advances (e.g. repeated pauses).
      const after = this.options.ledger.load(id)?.ir.state;
      if (after === state) return { state: after, steps };
    }
    const final = this.options.ledger.load(id)?.ir.state ?? "FAILED";
    return { state: final, steps: cap };
  }

  /** Jumps to a control state (used by the supervisor on provider/user waits). */
  wait(id: string, state: Extract<ResearchState, "WAITING_FOR_USER" | "WAITING_FOR_PROVIDER">, reason: string): void {
    this.options.ledger.setState(id, state, reason);
  }

  /**
   * Resumes a run paused at a control state. When the pause recorded a pending
   * reviewer-gated stage (executor pause), the run returns to that exact stage
   * so the reviewer outcome is fed there — never SCOPING, never a restart.
   * Without a pendingStage it resumes to SCOPING (Phase 4 guidance resumes).
   */
  resume(id: string): boolean {
    const record = this.options.ledger.load(id);
    if (!record) return false;
    const state = record.ir.state;
    if (state !== "WAITING_FOR_USER" && state !== "WAITING_FOR_PROVIDER" && state !== "RECOVERING") return false;
    const pending = record.ir.pendingStage;
    this.options.ledger.checkpoint(id, (next) => {
      next.ir.state = pending ?? "SCOPING";
      delete next.ir.pendingStage;
      next.ir.updatedAt = new Date().toISOString();
    }, pending ? `resumed from ${state} to pending stage ${pending}` : `resumed from ${state}`);
    return true;
  }

  fail(id: string, reason: string): void {
    this.options.ledger.setState(id, "FAILED", reason);
  }
}
