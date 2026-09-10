import fs from "node:fs";
import path from "node:path";
import type { EvolutionControlState } from "./evolution-kill-switch";
import { EvolutionKillSwitch } from "./evolution-kill-switch";

/**
 * Emergency Control (Update-Plan/Isolation-Finalization.md §13, §17, §23
 * RD-014/RD-015; §14 RT-20/RT-21).
 *
 * One Owner-facing stop that fans out to the four things that must stop:
 *
 *   - no new Candidate may be created          (`assertCandidateCreationAllowed`)
 *   - the running Candidate is aborted         (`emergencyStop` -> supervisor)
 *   - no promotion may proceed                 (`assertPromotionAllowed`)
 *   - autonomous evolution is frozen           (the kill switch sentinel)
 *
 * …and to the two things that must NOT stop: Stable's ordinary chat/work/
 * research/knowledge functions never consult this module, and evidence collected
 * so far is retained (the stop appends to an evidence log rather than clearing
 * anything).
 *
 * Raising the stop is deliberately unauthenticated — anyone who can reach the
 * control surface may halt autonomous evolution, because a stop that requires
 * approval is not an emergency stop. Clearing it is the authenticated direction.
 */

export interface EmergencyStopInput {
  /** Who raised the stop. */
  actor: string;
  reason: string;
  /** The in-flight Candidate, if any; aborted when present. */
  candidate?: { abort(reason: string): boolean };
  runId?: string;
}

export interface EmergencyStopResult {
  state: EvolutionControlState;
  stoppedCandidate: boolean;
  /** Where the stop was recorded. Evidence is retained, never cleared. */
  evidenceFile: string;
  recordedAt: string;
  signals: string[];
}

export interface EmergencyControlOptions {
  killSwitch: EvolutionKillSwitch;
  /** Root Owner named by the Root Policy. */
  rootOwner: string;
  /** Append-only evidence log for stop/clear events. */
  evidenceFile: string;
}

export class EmergencyControl {
  private readonly killSwitch: EvolutionKillSwitch;
  private readonly rootOwner: string;
  private readonly evidenceFile: string;

  constructor(options: EmergencyControlOptions) {
    this.killSwitch = options.killSwitch;
    this.rootOwner = options.rootOwner;
    this.evidenceFile = path.resolve(options.evidenceFile);
  }

  /** Current control state, re-read from disk on every call. */
  status(): ReturnType<EvolutionKillSwitch["status"]> {
    return this.killSwitch.status();
  }

  isFrozen(): boolean {
    return this.killSwitch.isFrozen();
  }

  /**
   * §13 emergency stop. Freezes evolution, aborts the running Candidate and
   * records the event. Stable keeps running: this method touches nothing outside
   * the evolution subsystem.
   */
  emergencyStop(input: EmergencyStopInput): EmergencyStopResult {
    const status = this.killSwitch.freeze({ frozenBy: input.actor, reason: input.reason, runId: input.runId });
    const stoppedCandidate = input.candidate?.abort(`emergency stop by ${input.actor}: ${input.reason}`) ?? false;
    const recordedAt = new Date().toISOString();
    this.appendEvidence({
      event: "EMERGENCY_STOP",
      at: recordedAt,
      actor: input.actor,
      reason: input.reason,
      runId: input.runId ?? null,
      stoppedCandidate,
      state: status.state
    });
    return { state: status.state, stoppedCandidate, evidenceFile: this.evidenceFile, recordedAt, signals: status.signals };
  }

  /** Gate: may a new Candidate be created? (§13 "禁止创建新 Candidate"). */
  assertCandidateCreationAllowed(): void {
    this.killSwitch.assertEvolutionEnabled("creating a new Candidate");
  }

  /** Gate: may this run be promoted? (§13 "禁止 promotion"). */
  assertPromotionAllowed(): void {
    this.killSwitch.assertEvolutionEnabled("promotion");
  }

  /**
   * Owner-gated clear. Delegates to the kill switch, which requires a registered
   * Owner control channel whose login matches the Root Policy. Boss cannot
   * self-clear (RD-015).
   */
  clear(channel: Parameters<EvolutionKillSwitch["clearFreeze"]>[0], reason: string): ReturnType<EvolutionKillSwitch["clearFreeze"]> {
    const status = this.killSwitch.clearFreeze(channel, this.rootOwner, reason);
    this.appendEvidence({ event: "EMERGENCY_CLEAR", at: new Date().toISOString(), actor: channel.owner, reason, state: status.state });
    return status;
  }

  /**
   * Records an attempt to clear the freeze that did not present a valid Owner
   * channel. The freeze is unaffected; the attempt is evidence.
   */
  recordUnauthorizedClearAttempt(actor: string, reason: string): void {
    this.appendEvidence({ event: "EMERGENCY_CLEAR_DENIED", at: new Date().toISOString(), actor, reason, state: this.status().state });
  }

  private appendEvidence(entry: Record<string, unknown>): void {
    try {
      fs.mkdirSync(path.dirname(this.evidenceFile), { recursive: true });
      fs.appendFileSync(this.evidenceFile, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // Evidence retention is important but must never be the reason Stable
      // stops. The durable control record written by the kill switch is the
      // authoritative freeze signal; this log is corroboration.
    }
  }
}
