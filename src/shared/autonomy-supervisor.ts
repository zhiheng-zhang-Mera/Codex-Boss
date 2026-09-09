/**
 * Autonomy supervisor — provider-job lifecycle + heartbeat + stall detection
 * (Update-Plan/Owner-Result.md Rev.2 §7–§14, §40). Pure + shareable: no
 * fs/electron/DOM; the clock is injected so every transition is deterministic.
 *
 * A provider job is never "await forever". We track activity heartbeats
 * (lastAnyActivityAt / lastSemanticProgressAt / lastResponseDeltaAt /
 * lastPageStateAt + busy evidence) and classify each observation into
 * WORKING / SLOW / STALLED / FAILED — the §40 requirement that "慢 ≠ 杀掉"
 * and "卡死 ≠ 永远等". Soft deadline (ACTIVE → QUIET → PROBE) and hard stall
 * (→ STALLED → recovery ladder R0–R8) mirror §10–§12. §13 straggler policy
 * and §14 provider replacement are here too.
 */

export type JobLifecycleState =
  | "QUEUED"
  | "DISPATCHING"
  | "ACTIVE"
  | "QUIET"
  | "PROBING"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED";

export const JOB_LIFECYCLE_STATES: readonly JobLifecycleState[] = [
  "QUEUED", "DISPATCHING", "ACTIVE", "QUIET", "PROBING", "RECOVERING", "COMPLETED", "FAILED"
];

/** Heartbeat model (§9). All timestamps are epoch ms from the injected clock. */
export interface JobHeartbeat {
  startedAt: number;
  /** Any observed activity (page state, DOM, output bytes…). */
  lastAnyActivityAt?: number;
  /** Last semantic progress (a real step forward, not noise). */
  lastSemanticProgressAt?: number;
  /** Last response-length / token change. */
  lastResponseDeltaAt?: number;
  /** Last provider page-state observation. */
  lastPageStateAt?: number;
  /** Provider-side busy evidence (e.g. “generation busy” DOM flag). */
  busy?: boolean;
}

export interface StallBounds {
  /** No output progress + no busy evidence past this window ⇒ QUIET → probe. */
  quietAfterMs: number;
  /** No semantic progress + no busy + no delta + probe cannot prove activity ⇒ STALLED. */
  hardStallAfterMs: number;
  /** Nothing at all past this bound ⇒ FAILED (terminal, recovery exhausted). */
  failAfterMs: number;
}

export const DEFAULT_STALL_BOUNDS: StallBounds = {
  quietAfterMs: 20_000,
  hardStallAfterMs: 90_000,
  failAfterMs: 15 * 60_000
};

export type StallVerdict = "WORKING" | "SLOW" | "STALLED" | "FAILED";

export interface Observation {
  verdict: StallVerdict;
  lifecycle: JobLifecycleState;
  /** True when a provider probe should run before declaring anything (soft deadline). */
  probeSuggested: boolean;
  /** Human-readable reason (audit + ledger). */
  reason: string;
  /** Age of the freshest heartbeat evidence (ms). */
  stalenessMs: number;
}

function latestEvidenceMs(heartbeat: JobHeartbeat, now: number): number {
  const candidates = [heartbeat.lastAnyActivityAt, heartbeat.lastSemanticProgressAt, heartbeat.lastResponseDeltaAt, heartbeat.lastPageStateAt]
    .filter((value): value is number => Number.isFinite(value));
  if (!candidates.length) return heartbeat.startedAt;
  return Math.max(heartbeat.startedAt, ...candidates);
}

/**
 * Classifies one provider-job observation. Deterministic over (now, heartbeat,
 * bounds): SLOW means evidence of life still exists (busy/page state/response
 * delta) but no semantic progress; STALLED means no evidence at all past the
 * hard-stall window; FAILED means the job exceeded the absolute fail bound.
 *
 * The `busy` flag is only as fresh as the page state it was observed in: a
 * busy flag with zero page/response activity past the hard-stall window is a
 * stuck indicator that must not mask a stall (it yields STALLED → recovery,
 * never eternal WORKING). QUIET is a caller-managed lifecycle state between
 * observations (soft-deadline probe), mirroring §10.
 */
export function observeJob(now: number, heartbeat: JobHeartbeat, bounds: StallBounds = DEFAULT_STALL_BOUNDS): Observation {
  if (!Number.isFinite(now) || now < heartbeat.startedAt) throw new Error("observeJob: now must be finite and >= startedAt");
  if (bounds.quietAfterMs <= 0 || bounds.hardStallAfterMs < bounds.quietAfterMs || bounds.failAfterMs < bounds.hardStallAfterMs) {
    throw new Error("observeJob: invalid stall bounds (0 < quiet <= hardStall <= fail)");
  }
  const fresh = latestEvidenceMs(heartbeat, now);
  const stalenessMs = now - fresh;
  const semanticRecent = typeof heartbeat.lastSemanticProgressAt === "number" && now - heartbeat.lastSemanticProgressAt <= bounds.quietAfterMs;
  const deltaRecent = typeof heartbeat.lastResponseDeltaAt === "number" && now - heartbeat.lastResponseDeltaAt <= bounds.quietAfterMs;
  const pageRecent = typeof heartbeat.lastPageStateAt === "number" && now - heartbeat.lastPageStateAt <= bounds.quietAfterMs;
  const busyFresh = heartbeat.busy === true && stalenessMs <= bounds.hardStallAfterMs;

  // Hard evidence of life within the windows (§9: busy 长思考 may outrun deltas).
  if (semanticRecent || deltaRecent || pageRecent || busyFresh) {
    return {
      verdict: "WORKING",
      lifecycle: "ACTIVE",
      probeSuggested: false,
      reason: semanticRecent ? "semantic progress observed" : deltaRecent ? "response delta observed" : pageRecent ? "page state observed" : "fresh provider busy evidence",
      stalenessMs
    };
  }
  // No fresh life evidence but still inside the hard-stall window: the soft
  // deadline has passed — §10 ACTIVE→QUIET→PROBE (probe is never a failure).
  if (stalenessMs <= bounds.hardStallAfterMs) {
    return {
      verdict: "SLOW",
      lifecycle: "PROBING",
      probeSuggested: true,
      reason: heartbeat.busy === true
        ? "busy flag stale with no page/response activity — soft deadline reached, probe provider"
        : `no evidence within quiet window; soft deadline reached — probe provider (stale ${stalenessMs}ms)`,
      stalenessMs
    };
  }
  // Hard stall: nothing past hardStallAfterMs and probe cannot prove activity.
  if (stalenessMs <= bounds.failAfterMs) {
    return {
      verdict: "STALLED",
      lifecycle: "RECOVERING",
      probeSuggested: false,
      reason: `no activity, no busy, no response delta past hard-stall window (stale ${stalenessMs}ms) — enter recovery ladder`,
      stalenessMs
    };
  }
  return {
    verdict: "FAILED",
    lifecycle: "FAILED",
    probeSuggested: false,
    reason: `no evidence past absolute fail bound (stale ${stalenessMs}ms) — job FAILED`,
    stalenessMs
  };
}

/**
 * §12 Provider Recovery Ladder R0–R8. Ranks are fixed; each step is entered only
 * after the previous one failed. Returns the next step after the current one.
 */
export type RecoveryLadderStep =
  | "R0_INSPECT_CURRENT_STATE"
  | "R1_RECAPTURE_EXISTING_RESPONSE"
  | "R2_REMONITOR"
  | "R3_RESTEER_SAME_SESSION"
  | "R4_RETRY_SAFE_UNSENT_ACTION"
  | "R5_REOPEN_RECOVER_SESSION"
  | "R6_COMPUTER_USE_REPAIR"
  | "R7_ALTERNATE_PROVIDER"
  | "R8_FRESH_EPISODE";

export const RECOVERY_LADDER: readonly RecoveryLadderStep[] = [
  "R0_INSPECT_CURRENT_STATE",
  "R1_RECAPTURE_EXISTING_RESPONSE",
  "R2_REMONITOR",
  "R3_RESTEER_SAME_SESSION",
  "R4_RETRY_SAFE_UNSENT_ACTION",
  "R5_REOPEN_RECOVER_SESSION",
  "R6_COMPUTER_USE_REPAIR",
  "R7_ALTERNATE_PROVIDER",
  "R8_FRESH_EPISODE"
];

export function nextRecoveryStep(current: RecoveryLadderStep | undefined): RecoveryLadderStep {
  if (!current) return "R0_INSPECT_CURRENT_STATE";
  const index = RECOVERY_LADDER.indexOf(current);
  if (index < 0) throw new Error(`Unknown recovery ladder step: ${current}`);
  return RECOVERY_LADDER[Math.min(RECOVERY_LADDER.length - 1, index + 1)];
}

export function isTerminalRecovery(step: RecoveryLadderStep): boolean {
  return step === "R8_FRESH_EPISODE";
}

/**
 * §13 Straggler policy. A council may enter provisional synthesis once the
 * evidence quorum is reached AND the core roles have returned; late workers may
 * append but never block the whole. A task that explicitly demands 5-AI
 * acceptance keeps requireAll=true and waits under bounded recovery instead of
 * waiting forever.
 */
export interface StragglerInput {
  total: number;
  received: number;
  coreRolesReturned: boolean;
  requireAll: boolean;
  /** Minimum votes needed for quorum when requireAll is false (default: majority floor). */
  quorum?: number;
}

export type StragglerDecision = "PROCEED_PROVISIONAL" | "WAIT_FOR_QUORUM" | "WAIT_FOR_ALL" | "WAIT_FOR_CORE";

export function stragglerDecision(input: StragglerInput): StragglerDecision {
  const { total, received, coreRolesReturned, requireAll } = input;
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(received) || received < 0 || received > total) {
    throw new Error("stragglerDecision: invalid counts");
  }
  if (requireAll) return received >= total ? "PROCEED_PROVISIONAL" : coreRolesReturned ? "WAIT_FOR_ALL" : "WAIT_FOR_CORE";
  const quorum = Math.max(1, input.quorum ?? Math.floor(total / 2) + 1);
  if (received >= Math.min(total, quorum) && coreRolesReturned) return "PROCEED_PROVISIONAL";
  if (received >= Math.min(total, quorum)) return "WAIT_FOR_CORE";
  return "WAIT_FOR_QUORUM";
}

/**
 * §14 Provider replacement. Keeps the target worker count by swapping in a
 * replacement — unless the task is provider-specific (brand-locked, e.g. a Qwen
 * verification test), in which case replacement is refused so nobody fakes a
 * pass by substituting a different brand.
 */
export interface ReplacementInput {
  failedProviderId: string;
  candidateProviderIds: readonly string[];
  targetWorkerCount: number;
  /** True when the test must exercise the exact failed provider (no substitution). */
  brandLocked: boolean;
}

export interface ReplacementDecision {
  replacement?: string;
  workerCount: number;
  canReplace: boolean;
  reason: string;
}

export function resolveProviderReplacement(input: ReplacementInput): ReplacementDecision {
  const { failedProviderId, candidateProviderIds, targetWorkerCount, brandLocked } = input;
  if (!Number.isInteger(targetWorkerCount) || targetWorkerCount < 1) throw new Error("resolveProviderReplacement: targetWorkerCount must be >= 1");
  if (brandLocked) {
    return {
      workerCount: targetWorkerCount,
      canReplace: false,
      reason: `brand-locked: ${failedProviderId} must be repaired in place; substitution would fake the acceptance`
    };
  }
  const replacement = candidateProviderIds.find((candidate) => candidate !== failedProviderId);
  if (!replacement) {
    return { workerCount: targetWorkerCount, canReplace: false, reason: "no replacement candidate remains" };
  }
  return {
    replacement,
    workerCount: targetWorkerCount,
    canReplace: true,
    reason: `${failedProviderId} replaced by ${replacement}; worker count stays ${targetWorkerCount}`
  };
}

/**
 * §8 lifecycle advancer for explicit transitions (the parts the pure module can
 * decide without observing provider pages). Dispatch/retry paths use this.
 */
export function advanceLifecycle(from: JobLifecycleState, to: JobLifecycleState): JobLifecycleState {
  const legal: Partial<Record<JobLifecycleState, readonly JobLifecycleState[]>> = {
    QUEUED: ["DISPATCHING", "FAILED", "COMPLETED"],
    DISPATCHING: ["ACTIVE", "QUIET", "FAILED", "COMPLETED"],
    ACTIVE: ["QUIET", "PROBING", "RECOVERING", "COMPLETED", "FAILED"],
    QUIET: ["ACTIVE", "PROBING", "RECOVERING", "COMPLETED", "FAILED"],
    PROBING: ["ACTIVE", "QUIET", "RECOVERING", "COMPLETED", "FAILED"],
    RECOVERING: ["ACTIVE", "QUIET", "PROBING", "COMPLETED", "FAILED"],
    COMPLETED: [],
    FAILED: []
  };
  if (from === to) return to;
  if (!legal[from]?.includes(to)) throw new Error(`Invalid job lifecycle transition: ${from} -> ${to}`);
  return to;
}
