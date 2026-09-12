import { readJson, writeJson } from "../commander/durable-json";
import { recordOwnerIntervention } from "../engineering/owner-intervention-ledger";
import {
  assertTransition,
  canTransition,
  decidePromotion,
  isTerminalPromotionState,
  type ExactShaBinding,
  type PromotionEvidence,
  type PromotionOutcome,
  type PromotionState
} from "../../src/shared/root-authority/promotion-state";
import type { RootAuthority } from "../root-authority/root-authority";
import type { ExactShaGate } from "./exact-sha-gate";
import type { EmergencyControl } from "../emergency-control/emergency-control";

/**
 * Promotion controller (Update-Plan/Isolation-Finalization.md §11, §16, §15
 * FI-04/FI-05).
 *
 * The durable, host-owned gate between "the Candidate finished" and "Stable
 * changed". It owns three things the rest of the system relies on:
 *
 *   1. **State is durable.** `WAITING_FOR_ROOT_OWNER` survives a restart, is
 *      idempotent under re-evaluation, and is never reclassified as stagnation
 *      and bypassed (FI-05). The controller explicitly short-circuits while
 *      waiting instead of running the normal advance path.
 *   2. **Evidence is bound to a SHA.** The decision comes from
 *      `decidePromotion`, which refuses to trust any green signal until all four
 *      SHAs agree, and re-validates against the live workspace HEAD (§11.2).
 *   3. **Promotion is a separate, explicit step.** `evaluate` never promotes.
 *      Only `beginPromotion` (from PROMOTABLE, or from an Owner-approved
 *      WAITING_FOR_ROOT_OWNER) may move to PROMOTING, and only `completePromotion`
 *      may reach PROMOTED — so no worker `DONE`, reviewer comment or local green
 *      test can become a promotion by accident.
 *
 * An external blocker (no dedicated Boss credential, GitHub unreachable) parks
 * the run in BLOCKED_EXTERNAL with the local work intact; it never becomes a
 * fake PASS (FI-04).
 */

export interface PromotionRecord {
  runId: string;
  state: PromotionState;
  createdAt: string;
  updatedAt: string;
  binding: ExactShaBinding;
  /** Root Surface paths the change set touches, if any. */
  protectedPaths: string[];
  /** Machine reasons for the current state. */
  reasons: string[];
  /** The PR, once created. Reused after a restart instead of opening another. */
  pullRequest: { number: number; headSha: string } | null;
  /** Owner approval, bound to the SHA it was granted for. */
  rootOwnerApproval: { sha: string; at: string; by: string } | null;
  history: { at: string; from: PromotionState; to: PromotionState; reasons: string[] }[];
  rollback: { from: string; to: string; reason: string; at: string; previousStableSha: string } | null;
}

export interface PromotionEvaluateInput {
  binding: ExactShaBinding;
  requiredChecksPassed: boolean;
  branchUpToDate: boolean;
  reviewerClean: boolean;
  /** Repo-relative changed files vs the immutable base SHA. */
  changedFiles: readonly string[];
  /** Explicit Owner approval for this exact SHA, when one exists. */
  rootOwnerApprovedSha?: string | null;
  rootOwnerApprovedBy?: string | null;
}

export interface PromotionControllerOptions {
  /** Durable record file. Must live outside the Candidate workspace. */
  storeFile: string;
  runId: string;
  authority: RootAuthority;
  exactShaGate: ExactShaGate;
  emergency?: EmergencyControl;
  now?: () => Date;
  /** Stable SHA currently promoted; recorded for deterministic rollback. */
  stableSha?: string | null;
}

/** Canonical forward path; `evaluate` walks it rather than jumping states. */
const FORWARD_PATH: readonly PromotionState[] = ["CREATED", "WORKING", "VERIFYING", "REVIEWING", "READY_FOR_PR", "WAITING_FOR_CI"];

export class PromotionController {
  private readonly storeFile: string;
  private readonly runId: string;
  private readonly authority: RootAuthority;
  private readonly exactShaGate: ExactShaGate;
  private readonly emergency: EmergencyControl | undefined;
  private readonly now: () => Date;
  private readonly stableSha: string | null;

  constructor(options: PromotionControllerOptions) {
    this.storeFile = options.storeFile;
    this.runId = options.runId;
    this.authority = options.authority;
    this.exactShaGate = options.exactShaGate;
    this.emergency = options.emergency;
    this.now = options.now ?? (() => new Date());
    this.stableSha = options.stableSha ?? null;
  }

  /** The durable record; a fresh one is created on first read. */
  record(): PromotionRecord {
    const existing = readJson<PromotionRecord>(this.storeFile);
    if (existing) return existing;
    const created: PromotionRecord = {
      runId: this.runId,
      state: "CREATED",
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      binding: { candidateHeadSha: null, ciValidatedSha: null, prHeadSha: null, promotionSha: null },
      protectedPaths: [],
      reasons: ["created"],
      pullRequest: null,
      rootOwnerApproval: null,
      history: [],
      rollback: null
    };
    this.persist(created);
    return created;
  }

  private persist(record: PromotionRecord): PromotionRecord {
    record.updatedAt = this.now().toISOString();
    writeJson(this.storeFile, record);
    return record;
  }

  private transition(record: PromotionRecord, to: PromotionState, reasons: string[] = []): PromotionRecord {
    if (record.state === to) {
      record.reasons = reasons.length ? reasons : record.reasons;
      return this.persist(record);
    }
    // Emergency control is allowed to force REJECTED from any non-terminal
    // state, including mid-PROMOTING (§13, RT-20/RT-21).
    const emergencyStop = to === "REJECTED" && this.emergency?.isFrozen() === true;
    if (!emergencyStop) assertTransition(record.state, to);
    else if (isTerminalPromotionState(record.state)) throw new Error(`cannot stop a run already in terminal state ${record.state}`);
    record.history.push({ at: this.now().toISOString(), from: record.state, to, reasons });
    record.state = to;
    record.reasons = reasons;
    return this.persist(record);
  }

  /** Walks the canonical forward path to `target`, one legal edge at a time. */
  private advanceTo(record: PromotionRecord, target: PromotionState): PromotionRecord {
    if (record.state === target) return record;
    if (isTerminalPromotionState(record.state)) return record;
    const targetIndex = FORWARD_PATH.indexOf(target);
    if (targetIndex >= 0) {
      const startIndex = FORWARD_PATH.indexOf(record.state);
      // Not on the forward path (e.g. WAITING_FOR_ROOT_OWNER): there is nothing
      // to walk. The caller applies the evaluated outcome directly.
      if (startIndex === -1) return record;
      let current = record;
      for (let index = startIndex + 1; index <= targetIndex; index++) {
        current = this.transition(current, FORWARD_PATH[index], [`advance:${FORWARD_PATH[index]}`]);
      }
      return current;
    }
    // Non-forward targets are only reachable from WAITING_FOR_CI onwards.
    const advanced = this.advanceTo(record, "WAITING_FOR_CI");
    if (advanced.state === target) return advanced;
    if (!canTransition(advanced.state, target)) return advanced;
    return this.transition(advanced, target, [`evaluate:${target}`]);
  }

  /**
   * Evaluates promotion evidence and parks the run in the correct state.
   *
   * Repeated calls while `WAITING_FOR_ROOT_OWNER` are idempotent: the run stays
   * waiting, a new PR is not opened, and the wait is never re-read as failure.
   */
  async evaluate(input: PromotionEvaluateInput): Promise<PromotionRecord> {
    let record = this.record();

    // FI-05: a durable Owner wait is sticky. Only an approval for the same SHA,
    // an emergency stop, or an explicit rejection moves the run out of it.
    const assessment = this.authority.assessChangeSet(input.changedFiles);
    const approval = input.rootOwnerApprovedSha && input.rootOwnerApprovedSha === input.binding.candidateHeadSha
      ? { sha: input.rootOwnerApprovedSha, at: this.now().toISOString(), by: input.rootOwnerApprovedBy ?? this.authority.rootOwner }
      : null;

    if (record.state === "WAITING_FOR_ROOT_OWNER" && !approval) {
      record.binding = input.binding;
      record.protectedPaths = assessment.protected.map((hit) => hit.path);
      record.reasons = ["waiting-for-root-owner", ...assessment.reasons.map((reason) => reason.code)];
      return this.persist(record);
    }

    record = this.advanceTo(record, "WAITING_FOR_CI");
    record.binding = input.binding;
    record.protectedPaths = assessment.protected.map((hit) => hit.path);
    if (approval) record.rootOwnerApproval = approval;

    // Path containment failure is a hard denial, recorded as such before any
    // promotion question is asked (§7.2 / RT-01).
    if (assessment.decision === "DENY") {
      this.authority.classify({ operation: "workspace.escape", detail: `promotion change set escaped the candidate root`, targets: assessment.escapes.slice(0, 10) });
      return this.transition(record, "REJECTED", ["change-set-escape", ...assessment.reasons.map((reason) => reason.code)]);
    }

    const exact = await this.exactShaGate.evaluate(input.binding);
    // The live check has the last word. When it fails, the recorded CI PASS is
    // void, so the evidence handed to `decidePromotion` is corrected rather than
    // merely annotated — otherwise a self-consistent binding would still read as
    // green while the workspace has already moved on (RT-14/RT-15).
    const observed = exact.observedCandidateHeadSha;
    const effectiveBinding: ExactShaBinding = exact.ok
      ? { ...input.binding, candidateHeadSha: observed, promotionSha: exact.sha ?? null }
      : { ...input.binding, candidateHeadSha: observed ?? input.binding.candidateHeadSha, ciValidatedSha: null };
    record.binding = effectiveBinding;

    const externalBlocker = this.externalBlocker();
    const evidence: PromotionEvidence = {
      ...effectiveBinding,
      requiredChecksPassed: input.requiredChecksPassed,
      branchUpToDate: input.branchUpToDate,
      reviewerClean: input.reviewerClean,
      emergencyStopEngaged: this.emergency?.isFrozen() ?? false,
      protectedSurfaceTouched: assessment.protected.length > 0,
      rootOwnerApproved: Boolean(approval),
      externalBlocker
    };
    const outcome: PromotionOutcome = decidePromotion(evidence);
    if (!exact.ok) outcome.reasons.unshift(`${exact.code}: ${exact.detail}`);

    // Record the Root decision durably beside the state (§16: RootDecision must
    // be durable state, not a log string).
    this.authority.record({
      timestamp: this.now().toISOString(),
      runId: this.runId,
      actor: "promotion-controller",
      operation: outcome.state === "PROMOTABLE" ? "promotion.evaluate" : "promotion.gate.mutate",
      target: `candidate:${input.binding.candidateHeadSha ?? "unbound"}`,
      decision: outcome.state === "PROMOTABLE" ? "ALLOW" : outcome.state === "WAITING_FOR_ROOT_OWNER" ? "REQUIRE_OWNER" : "DENY",
      reason: `${outcome.state}: ${outcome.reasons.join(", ") || "all gates green"}`,
      candidateSha: input.binding.candidateHeadSha
    });

    const nextState = mapOutcomeToState(outcome);
    // checkpoint-2 §7.4: a durable Owner wait is an Owner intervention, and the only
    // way one is recorded is the central ledger. Without an active acceptance session
    // this is a no-op, so ordinary product runs are unaffected.
    if (nextState === "WAITING_FOR_ROOT_OWNER") {
      recordOwnerIntervention({
        source: "promotion-gate",
        blocker_class: "HB1_AUTHORITY",
        reason: `promoting ${input.binding.candidateHeadSha ?? "an unbound candidate"} touches the Root Surface, and only the Owner may approve it`,
        requested_action: "approve or reject the promotion for this exact SHA",
        outcome: "WAITING_FOR_ROOT_OWNER"
      });
    }
    return this.transition(record, nextState, outcome.reasons.length ? outcome.reasons : [`state:${outcome.state}`]);
  }
  /**
   * The only path into `PROMOTING`. Requires PROMOTABLE, or an Owner approval
   * already bound to this exact SHA.
   */
  beginPromotion(): PromotionRecord {
    const record = this.record();
    if (record.state === "WAITING_FOR_ROOT_OWNER") {
      const approvedSha = record.rootOwnerApproval?.sha;
      if (!approvedSha || approvedSha !== record.binding.candidateHeadSha) {
        return this.persist({ ...record, reasons: ["owner-approval-missing-or-bound-to-another-sha"] });
      }
    } else if (record.state !== "PROMOTABLE") {
      return this.persist({ ...record, reasons: [`cannot begin promotion from ${record.state}`] });
    }
    this.emergency?.assertPromotionAllowed();
    return this.transition(record, "PROMOTING", ["begin-promotion"]);
  }

  /** The only path into `PROMOTED`. */
  completePromotion(sha: string): PromotionRecord {
    const record = this.record();
    if (record.state !== "PROMOTING") return this.persist({ ...record, reasons: [`cannot complete promotion from ${record.state}`] });
    if (record.binding.promotionSha && record.binding.promotionSha !== sha) {
      return this.transition(record, "REJECTED", [`promoted SHA ${sha.slice(0, 12)} does not match the validated SHA ${record.binding.promotionSha.slice(0, 12)}`]);
    }
    return this.transition(record, "PROMOTED", ["promoted", `sha:${sha}`]);
  }

  /** Parks the run behind an external blocker without losing local work (FI-04). */
  markBlockedExternal(reason: string): PromotionRecord {
    const record = this.record();
    if (isTerminalPromotionState(record.state)) return record;
    if (record.state === "BLOCKED_EXTERNAL") return this.persist({ ...record, reasons: [reason] });
    if (!canTransition(record.state, "BLOCKED_EXTERNAL")) return this.persist({ ...record, reasons: [`cannot park from ${record.state}: ${reason}`] });
    return this.transition(record, "BLOCKED_EXTERNAL", [reason]);
  }

  /** Marks a promoted run as rolled back (used by the rollback controller). */
  markRolledBack(reason: string, previousStableSha: string): PromotionRecord {
    const record = this.record();
    if (record.state !== "PROMOTED") return this.persist({ ...record, reasons: [`cannot roll back from ${record.state}`] });
    const next = this.transition(record, "ROLLED_BACK", [`rollback: ${reason}`]);
    next.rollback = { from: "PROMOTED", to: "ROLLED_BACK", reason, at: this.now().toISOString(), previousStableSha };
    return this.persist(next);
  }

  /** Records (or reuses) the pull request so a restart cannot open a second one. */
  recordPullRequest(prNumber: number, headSha: string): PromotionRecord {
    const record = this.record();
    record.pullRequest = { number: prNumber, headSha };
    return this.persist(record);
  }

  /** True when this run already has a pull request (FI-05 duplicate guard). */
  hasPullRequest(): boolean {
    return Boolean(this.record().pullRequest);
  }

  /**
   * Why promotion is externally blocked right now, or null. The emergency-stop
   * case is not "external": it is an Owner decision and is handled by
   * `decidePromotion` as a rejection.
   */
  private externalBlocker(): string | null {
    return this.externalBlockerReason;
  }

  private externalBlockerReason: string | null = null;

  /**
   * Injects the current external blocker (missing Boss credential, GitHub
   * unavailable). Set by the caller that owns the adapter, so the controller
   * stays free of remote concerns.
   */
  setExternalBlocker(reason: string | null): void {
    this.externalBlockerReason = reason;
  }
}

function mapOutcomeToState(outcome: PromotionOutcome): PromotionState {
  switch (outcome.state) {
    case "PROMOTABLE": return "PROMOTABLE";
    case "WAITING_FOR_ROOT_OWNER": return "WAITING_FOR_ROOT_OWNER";
    case "WAITING_FOR_CI": return "WAITING_FOR_CI";
    case "BLOCKED_EXTERNAL": return "BLOCKED_EXTERNAL";
    case "REJECTED": return "REJECTED";
  }
}
