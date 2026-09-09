import { describe, expect, it } from "vitest";
import {
  advanceLifecycle,
  DEFAULT_STALL_BOUNDS,
  isTerminalRecovery,
  nextRecoveryStep,
  observeJob,
  resolveProviderReplacement,
  stragglerDecision,
  RECOVERY_LADDER,
  type JobHeartbeat
} from "../../src/shared/autonomy-supervisor";

const BOUNDS = { quietAfterMs: 10_000, hardStallAfterMs: 60_000, failAfterMs: 200_000 };

function heartbeat(partial: Partial<JobHeartbeat> & { startedAt: number }): JobHeartbeat {
  return partial;
}

describe("autonomy-supervisor: lifecycle transitions", () => {
  it("advances along legal transitions and rejects illegal ones", () => {
    expect(advanceLifecycle("QUEUED", "DISPATCHING")).toBe("DISPATCHING");
    expect(advanceLifecycle("ACTIVE", "QUIET")).toBe("QUIET");
    expect(advanceLifecycle("QUIET", "PROBING")).toBe("PROBING");
    expect(advanceLifecycle("PROBING", "RECOVERING")).toBe("RECOVERING");
    expect(advanceLifecycle("RECOVERING", "ACTIVE")).toBe("ACTIVE");
    expect(() => advanceLifecycle("COMPLETED", "ACTIVE")).toThrow();
    expect(() => advanceLifecycle("QUEUED", "ACTIVE")).toThrow();
  });

  it("recovery ladder walks R0..R8 in fixed order and terminates at fresh episode", () => {
    expect(RECOVERY_LADDER.length).toBe(9);
    expect(RECOVERY_LADDER[0]).toBe("R0_INSPECT_CURRENT_STATE");
    expect(nextRecoveryStep(undefined)).toBe("R0_INSPECT_CURRENT_STATE");
    expect(nextRecoveryStep("R3_RESTEER_SAME_SESSION")).toBe("R4_RETRY_SAFE_UNSENT_ACTION");
    expect(nextRecoveryStep("R6_COMPUTER_USE_REPAIR")).toBe("R7_ALTERNATE_PROVIDER");
    expect(isTerminalRecovery(nextRecoveryStep("R7_ALTERNATE_PROVIDER"))).toBe(true);
  });
});

describe("autonomy-supervisor: heartbeat observation (§9-§11, §40)", () => {
  it("WORKING while busy evidence is fresh even without output deltas (long-thinking)", () => {
    const observed = observeJob(30_000, heartbeat({ startedAt: 0, busy: true, lastPageStateAt: 29_500 }), BOUNDS);
    expect(observed.verdict).toBe("WORKING");
    expect(observed.lifecycle).toBe("ACTIVE");
    expect(observed.probeSuggested).toBe(false);
  });

  it("WORKING while semantic progress / response deltas stay fresh", () => {
    const semantic = observeJob(15_000, heartbeat({ startedAt: 0, lastSemanticProgressAt: 12_000 }), BOUNDS);
    expect(semantic.verdict).toBe("WORKING");
    const delta = observeJob(15_000, heartbeat({ startedAt: 0, lastResponseDeltaAt: 13_000 }), BOUNDS);
    expect(delta.verdict).toBe("WORKING");
  });

  it("soft deadline: no fresh evidence inside hard-stall window -> SLOW + probe (not failure)", () => {
    const observed = observeJob(50_000, heartbeat({ startedAt: 0, lastAnyActivityAt: 5_000 }), BOUNDS);
    expect(observed.verdict).toBe("SLOW");
    expect(observed.probeSuggested).toBe(true);
    expect(observed.lifecycle).toBe("PROBING");
    expect(observed.stalenessMs).toBe(45_000);
  });

  it("a stuck busy flag cannot mask a hard stall (§11: never eternal WORKING)", () => {
    const observed = observeJob(90_000, heartbeat({ startedAt: 0, busy: true, lastPageStateAt: 5_000 }), BOUNDS);
    expect(observed.verdict).toBe("STALLED");
    expect(observed.lifecycle).toBe("RECOVERING");
    expect(observed.probeSuggested).toBe(false);
  });

  it("hard stall -> STALLED + recovery (slow != killed, stalled != waited forever)", () => {
    const observed = observeJob(150_000, heartbeat({ startedAt: 0, lastAnyActivityAt: 10_000 }), BOUNDS);
    expect(observed.verdict).toBe("STALLED");
    expect(observed.lifecycle).toBe("RECOVERING");
  });

  it("absolute silence past fail bound -> FAILED", () => {
    const observed = observeJob(500_000, heartbeat({ startedAt: 0 }), BOUNDS);
    expect(observed.verdict).toBe("FAILED");
    expect(observed.lifecycle).toBe("FAILED");
  });

  it("rejects invalid bounds and non-finite clocks", () => {
    expect(() => observeJob(10, heartbeat({ startedAt: 5 }), { quietAfterMs: 0, hardStallAfterMs: 1, failAfterMs: 2 })).toThrow();
    expect(() => observeJob(1, heartbeat({ startedAt: 5 }))).toThrow();
  });

  it("default bounds keep the ordering invariant", () => {
    expect(DEFAULT_STALL_BOUNDS.quietAfterMs).toBeLessThan(DEFAULT_STALL_BOUNDS.hardStallAfterMs);
    expect(DEFAULT_STALL_BOUNDS.hardStallAfterMs).toBeLessThan(DEFAULT_STALL_BOUNDS.failAfterMs);
  });
});

describe("autonomy-supervisor: straggler policy (§13)", () => {
  it("proceeds provisionally once quorum + core roles returned", () => {
    expect(stragglerDecision({ total: 5, received: 3, coreRolesReturned: true, requireAll: false })).toBe("PROCEED_PROVISIONAL");
  });

  it("waits for core roles even when quorum is met", () => {
    expect(stragglerDecision({ total: 5, received: 3, coreRolesReturned: false, requireAll: false })).toBe("WAIT_FOR_CORE");
  });

  it("waits for quorum when below the threshold", () => {
    expect(stragglerDecision({ total: 5, received: 2, coreRolesReturned: true, requireAll: false })).toBe("WAIT_FOR_QUORUM");
  });

  it("5-AI acceptance keeps requireAll semantics (bounded wait, never fake pass)", () => {
    expect(stragglerDecision({ total: 5, received: 4, coreRolesReturned: true, requireAll: true })).toBe("WAIT_FOR_ALL");
    expect(stragglerDecision({ total: 5, received: 5, coreRolesReturned: true, requireAll: true })).toBe("PROCEED_PROVISIONAL");
  });
});

describe("autonomy-supervisor: provider replacement (§14)", () => {
  it("replaces a failed provider to keep the target worker count", () => {
    const decision = resolveProviderReplacement({ failedProviderId: "gemini", candidateProviderIds: ["chatgpt", "gemini", "qwen"], targetWorkerCount: 5, brandLocked: false });
    expect(decision.canReplace).toBe(true);
    expect(decision.replacement).toBe("chatgpt");
    expect(decision.workerCount).toBe(5);
  });

  it("refuses substitution for brand-locked (provider-specific) tests", () => {
    const decision = resolveProviderReplacement({ failedProviderId: "qwen", candidateProviderIds: ["chatgpt", "qwen"], targetWorkerCount: 1, brandLocked: true });
    expect(decision.canReplace).toBe(false);
    expect(decision.replacement).toBeUndefined();
  });

  it("reports honestly when no replacement remains", () => {
    const decision = resolveProviderReplacement({ failedProviderId: "qwen", candidateProviderIds: ["qwen"], targetWorkerCount: 3, brandLocked: false });
    expect(decision.canReplace).toBe(false);
  });
});
