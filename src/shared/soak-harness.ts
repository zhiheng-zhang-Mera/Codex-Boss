/**
 * Host-M P3 — Long-run / Soak Harness (pure contract).
 *
 * A soak run is only worth reading if it can fail. The existing 2h closure soak
 * writes `status: "PASS"` unconditionally once its clock expires, records no
 * resource metrics and asserts no invariants, so a run that leaked memory or
 * never drained its queue would still be reported green. This harness is built
 * the other way round:
 *
 * - PASS requires the target duration *and* every invariant holding.
 * - A run that stops early is never PASS: an interrupted run is
 *   `INCOMPLETE_WITH_PARTIAL_EVIDENCE` and a host that cannot sustain the
 *   duration is `BLOCKED_EXTERNAL`. Neither is dressed up as success.
 * - A heartbeat carries partial progress, so a run killed by the host keeps the
 *   evidence it had already earned.
 * - Each measurement records whether it is actually available here rather than
 *   inventing a value: renderer health needs a live GUI, so it is reported
 *   UNAVAILABLE with a reason instead of a made-up number.
 *
 * This module is pure. The sampling and the load generation live in
 * `electron/host/soak-harness.ts`.
 */

export const SOAK_TIERS = ["smoke", "30m", "2h", "8h", "overnight"] as const;
export type SoakTier = (typeof SOAK_TIERS)[number];

export interface SoakTierSpec {
  tier: SoakTier;
  label: string;
  /** Nominal wall-clock duration of the tier. */
  durationSeconds: number;
  /**
   * The shortest run that still proves the tier was exercised. A 2h tier that
   * only ran 5 minutes has not demonstrated anything about 2h.
   */
  auditSeconds: number;
}

export const SOAK_TIER_SPECS: Record<SoakTier, SoakTierSpec> = {
  smoke: { tier: "smoke", label: "smoke (harness self-check)", durationSeconds: 20, auditSeconds: 10 },
  "30m": { tier: "30m", label: "30 minutes", durationSeconds: 30 * 60, auditSeconds: 30 * 60 },
  "2h": { tier: "2h", label: "2 hours", durationSeconds: 2 * 60 * 60, auditSeconds: 2 * 60 * 60 },
  "8h": { tier: "8h", label: "8 hours", durationSeconds: 8 * 60 * 60, auditSeconds: 8 * 60 * 60 },
  overnight: { tier: "overnight", label: "overnight (12 hours)", durationSeconds: 12 * 60 * 60, auditSeconds: 12 * 60 * 60 }
};

export function soakTierSpec(tier: string): SoakTierSpec {
  if (!(SOAK_TIERS as readonly string[]).includes(tier)) {
    throw new Error(`Unknown soak tier: ${tier} (expected one of ${SOAK_TIERS.join(", ")})`);
  }
  return SOAK_TIER_SPECS[tier as SoakTier];
}

/** Every measured dimension the plan requires, plus whether it is available. */
export interface SoakSample {
  /** Milliseconds since the run started. */
  elapsedMs: number;
  at: string;
  /** Resident set size of the harness process, MiB. */
  rssMiB: number;
  /** Heap actually in use, MiB (the leak-sensitive number). */
  heapUsedMiB: number;
  externalMiB: number;
  /** Node's view of open handles and requests. */
  handles: number;
  requests: number;
  /**
   * CPU time consumed by the process, milliseconds. Reported as a delta rate
   * rather than an instantaneous percentage, which is not measurable in-process.
   */
  cpuMs: number;
  /** Cumulative load counters at this sample. */
  completed: number;
  failed: number;
  retries: number;
  /** Tasks submitted but not yet settled — the queue depth. */
  queueDepth: number;
  /** Providers currently open circuits, by runtime id. */
  openCircuits: string[];
  /** Runtime ids that failed since the previous sample. */
  providerFailures: string[];
  /** Sessions whose heartbeat is older than the declared staleness bound. */
  staleSessions: number;
  /**
   * Live child processes the harness is deliberately running. This is an
   * informational resource reading, not a leak: a bounded pool of workers is
   * normal.
   */
  orphanProcesses: number;
  /**
   * Child processes still alive *after* the harness reaped them. Only the final
   * sample carries this, and it is the number the orphan invariant reads —
   * conflating it with the live pool would fail a healthy run.
   */
  orphansAfterCleanup?: number;
  /**
   * Renderer health. `undefined` when no GUI renderer is attached to this run —
   * reported UNAVAILABLE rather than guessed.
   */
  rendererHealthy?: boolean;
  /** The harness process id, so an unexpected restart is detectable. */
  pid: number;
}

export type InvariantId =
  | "duration-reached"
  | "no-unexpected-restart"
  | "rss-bounded"
  | "heap-bounded"
  | "handles-bounded"
  | "queue-drained"
  | "failure-ratio-bounded"
  | "throughput-above-floor"
  | "no-stale-sessions"
  | "no-orphan-processes"
  | "provider-crash-loop-bounded";

export type InvariantStatus = "PASS" | "FAIL" | "UNAVAILABLE";

export interface InvariantOutcome {
  id: InvariantId;
  label: string;
  status: InvariantStatus;
  /** The measured value, quoted so the evidence is auditable. */
  observed: string;
  /** The bound that was applied. */
  bound: string;
  reason?: string;
}

/** Measured dimensions that this host cannot produce, with the reason. */
export interface UnavailableDimension {
  dimension: string;
  reason: string;
}

export interface SoakReport {
  schemaVersion: 1;
  kind: "HOST_SOAK";
  tier: SoakTier;
  label: string;
  generatedAt: string;
  startedAt: string;
  /** Wall-clock seconds actually run. */
  elapsedSeconds: number;
  targetSeconds: number;
  /** Tasks settled during the run. */
  completed: number;
  failed: number;
  retries: number;
  /** Throughput over the run. */
  tasksPerSecond: number;
  samples: SoakSample[];
  invariants: InvariantOutcome[];
  unavailable: UnavailableDimension[];
  /** First and last sample, the two the memory trend is read from. */
  firstSample?: SoakSample;
  lastSample?: SoakSample;
  overall: "PASS" | "FAIL" | "BLOCKED_EXTERNAL" | "INCOMPLETE_WITH_PARTIAL_EVIDENCE";
  verdictReason: string;
  heartbeatPath?: string;
}

/** Partial progress, written continuously so a killed run keeps its evidence. */
export interface SoakHeartbeat {
  schemaVersion: 1;
  tier: SoakTier;
  pid: number;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  targetSeconds: number;
  completed: number;
  failed: number;
  retries: number;
  queueDepth: number;
  samples: number;
  latest?: SoakSample;
  /** Set when the harness observed its own process identity change. */
  restarts: number;
}

/**
 * The bounds. Every one is a declared policy, not a fitted number, and each is
 * generous enough that a healthy run cannot trip it by accident while a real
 * leak or crash loop still does.
 */
export const SOAK_BOUNDS = {
  /** RSS growth allowed between first and last sample. */
  rssGrowthMiB: 512,
  /** Heap growth allowed between first and last sample — the leak signal. */
  heapGrowthMiB: 256,
  /** Handle growth allowed. Node counts timers and sockets here. */
  handleGrowth: 2_000,
  /** Queue depth may never stay at or above this for the whole run. */
  queueDepthCeiling: 500,
  /** Failed / settled ratio. */
  failureRatio: 0.5,
  /** Minimum tasks per second for the load generator to have loaded anything. */
  minTasksPerSecond: 0.2,
  /** A session older than this many seconds counts as stale. */
  staleSessionSeconds: 1_800,
  /** Circuit-open transitions allowed per runtime over the run. */
  providerCrashLoopLimit: 25
} as const;

export interface InvariantInput {
  tier: SoakTier;
  elapsedSeconds: number;
  samples: readonly SoakSample[];
  completed: number;
  failed: number;
  retries: number;
  /** Circuits opened per runtime id across the run. */
  circuitOpenCounts: Record<string, number>;
  /** Process ids observed across the run, in order. */
  pids: readonly number[];
}

function growth(first: number, last: number): number {
  return last - first;
}

function maxOf(samples: readonly SoakSample[], pick: (sample: SoakSample) => number): number {
  return samples.reduce((highest, sample) => Math.max(highest, pick(sample)), Number.NEGATIVE_INFINITY);
}

function lastN(samples: readonly SoakSample[], count: number): SoakSample[] {
  return samples.slice(Math.max(0, samples.length - count));
}

/**
 * Evaluates every invariant. Deliberately independent: one failing invariant does
 * not stop the others from being measured, so a run reports everything it learned.
 */
export function evaluateSoakInvariants(input: InvariantInput): InvariantOutcome[] {
  const spec = SOAK_TIER_SPECS[input.tier];
  const samples = input.samples;
  const outcomes: InvariantOutcome[] = [];
  const first = samples[0];
  const last = samples[samples.length - 1];

  outcomes.push({
    id: "duration-reached",
    label: "the tier's duration was actually run",
    status: input.elapsedSeconds >= spec.auditSeconds ? "PASS" : "FAIL",
    observed: `${Math.round(input.elapsedSeconds)}s`,
    bound: `>= ${spec.auditSeconds}s`,
    reason: input.elapsedSeconds >= spec.auditSeconds ? undefined : `only ${Math.round(input.elapsedSeconds)}s of the required ${spec.auditSeconds}s was run`
  });

  const distinctPids = [...new Set(input.pids)];
  outcomes.push({
    id: "no-unexpected-restart",
    label: "the harness never silently restarted",
    status: distinctPids.length <= 1 ? "PASS" : "FAIL",
    observed: `${distinctPids.length} process id(s)`,
    bound: "1",
    reason: distinctPids.length <= 1 ? undefined : `observed pids ${distinctPids.join(", ")}`
  });

  if (!first || !last || samples.length < 2) {
    outcomes.push({
      id: "rss-bounded",
      label: "resident memory stayed bounded",
      status: "UNAVAILABLE",
      observed: `${samples.length} sample(s)`,
      bound: `growth <= ${SOAK_BOUNDS.rssGrowthMiB} MiB`,
      reason: "at least two samples are needed to read a trend"
    });
    outcomes.push({
      id: "heap-bounded",
      label: "heap stayed bounded",
      status: "UNAVAILABLE",
      observed: `${samples.length} sample(s)`,
      bound: `growth <= ${SOAK_BOUNDS.heapGrowthMiB} MiB`,
      reason: "at least two samples are needed to read a trend"
    });
    outcomes.push({
      id: "handles-bounded",
      label: "handle count stayed bounded",
      status: "UNAVAILABLE",
      observed: `${samples.length} sample(s)`,
      bound: `growth <= ${SOAK_BOUNDS.handleGrowth}`,
      reason: "at least two samples are needed to read a trend"
    });
  } else {
    const rss = growth(first.rssMiB, last.rssMiB);
    outcomes.push({
      id: "rss-bounded",
      label: "resident memory stayed bounded",
      status: rss <= SOAK_BOUNDS.rssGrowthMiB ? "PASS" : "FAIL",
      observed: `${rss >= 0 ? "+" : ""}${rss.toFixed(1)} MiB (${first.rssMiB.toFixed(1)} -> ${last.rssMiB.toFixed(1)})`,
      bound: `growth <= ${SOAK_BOUNDS.rssGrowthMiB} MiB`,
      reason: rss <= SOAK_BOUNDS.rssGrowthMiB ? undefined : `resident memory grew by ${rss.toFixed(1)} MiB`
    });
    const heap = growth(first.heapUsedMiB, last.heapUsedMiB);
    outcomes.push({
      id: "heap-bounded",
      label: "heap stayed bounded",
      status: heap <= SOAK_BOUNDS.heapGrowthMiB ? "PASS" : "FAIL",
      observed: `${heap >= 0 ? "+" : ""}${heap.toFixed(1)} MiB (${first.heapUsedMiB.toFixed(1)} -> ${last.heapUsedMiB.toFixed(1)})`,
      bound: `growth <= ${SOAK_BOUNDS.heapGrowthMiB} MiB`,
      reason: heap <= SOAK_BOUNDS.heapGrowthMiB ? undefined : `heap grew by ${heap.toFixed(1)} MiB`
    });
    const handles = growth(first.handles, last.handles);
    outcomes.push({
      id: "handles-bounded",
      label: "handle count stayed bounded",
      status: handles <= SOAK_BOUNDS.handleGrowth ? "PASS" : "FAIL",
      observed: `${handles >= 0 ? "+" : ""}${handles} (${first.handles} -> ${last.handles})`,
      bound: `growth <= ${SOAK_BOUNDS.handleGrowth}`,
      reason: handles <= SOAK_BOUNDS.handleGrowth ? undefined : `handles grew by ${handles}`
    });
  }

  // The queue must actually drain rather than being undrained work measured only
  // at the end. The tail window has to show a real zero; a backlog still present
  // in the last stretch of samples means work accumulated faster than it was
  // processed, however empty it looks afterwards. The window is floored at three
  // samples so a ten-sample run cannot be judged on its final reading alone.
  const settled = input.completed + input.failed;
  const tail = lastN(samples, Math.min(samples.length, Math.max(3, Math.ceil(samples.length * 0.1))));
  const tailMax = tail.length ? Math.max(...tail.map((sample) => sample.queueDepth)) : 0;
  const tailMin = tail.length ? Math.min(...tail.map((sample) => sample.queueDepth)) : 0;
  const peakDepth = samples.length ? maxOf(samples, (sample) => sample.queueDepth) : 0;
  const tailDrained = tail.length > 0 && tailMin === 0;
  outcomes.push({
    id: "queue-drained",
    label: "the queue drained rather than growing without bound",
    status: tailDrained ? "PASS" : "FAIL",
    observed: `peak ${peakDepth}; over the last ${tail.length} sample(s) the depth ranged ${tailMin}..${tailMax}`,
    bound: "0 at least once in the final stretch of samples",
    reason: tailDrained ? undefined : `the queue was still holding ${tailMin}..${tailMax} task(s) across the last ${tail.length} sample(s)`
  });

  const failureRatio = settled === 0 ? 0 : input.failed / settled;
  outcomes.push({
    id: "failure-ratio-bounded",
    label: "failures stayed a minority of settled work",
    status: failureRatio <= SOAK_BOUNDS.failureRatio ? "PASS" : "FAIL",
    observed: `${(failureRatio * 100).toFixed(1)}% (${input.failed}/${settled})`,
    bound: `<= ${SOAK_BOUNDS.failureRatio * 100}%`,
    reason: failureRatio <= SOAK_BOUNDS.failureRatio ? undefined : `${input.failed} of ${settled} settled tasks failed`
  });

  const rate = input.elapsedSeconds > 0 ? settled / input.elapsedSeconds : 0;
  // A run too short to have generated load cannot claim a throughput floor.
  const rateStatus: InvariantStatus =
    input.elapsedSeconds < 5 ? "UNAVAILABLE" : rate >= SOAK_BOUNDS.minTasksPerSecond ? "PASS" : "FAIL";
  outcomes.push({
    id: "throughput-above-floor",
    label: "the load generator actually generated load",
    status: rateStatus,
    observed: `${rate.toFixed(3)} tasks/s over ${Math.round(input.elapsedSeconds)}s`,
    bound: `>= ${SOAK_BOUNDS.minTasksPerSecond} tasks/s`,
    reason: rateStatus === "PASS" ? undefined : rateStatus === "UNAVAILABLE" ? "the run was too short to measure a rate" : `only ${rate.toFixed(3)} tasks/s settled`
  });

  const maxStale = samples.length ? maxOf(samples, (sample) => sample.staleSessions) : 0;
  outcomes.push({
    id: "no-stale-sessions",
    label: "no session went stale",
    status: maxStale === 0 ? "PASS" : "FAIL",
    observed: `peak ${maxStale} stale session(s)`,
    bound: "0",
    reason: maxStale === 0 ? undefined : `${maxStale} session(s) exceeded ${SOAK_BOUNDS.staleSessionSeconds}s without a heartbeat`
  });

  const orphanValues = samples.map((sample) => sample.orphansAfterCleanup).filter((value): value is number => value !== undefined);
  const orphansLeft = orphanValues.length ? Math.max(...orphanValues) : 0;
  outcomes.push({
    id: "no-orphan-processes",
    label: "no child process survived cleanup",
    status: orphanValues.length === 0 ? "UNAVAILABLE" : orphansLeft === 0 ? "PASS" : "FAIL",
    observed: orphanValues.length === 0 ? "no post-cleanup reading was taken" : `${orphansLeft} still alive after reaping`,
    bound: "0 live after cleanup",
    reason:
      orphanValues.length === 0
        ? "the run ended before cleanup could be observed"
        : orphansLeft === 0
          ? undefined
          : `${orphansLeft} child process(es) were still running after the harness reaped them`
  });

  const crashLoops = Object.entries(input.circuitOpenCounts).filter(([, count]) => count > SOAK_BOUNDS.providerCrashLoopLimit);
  outcomes.push({
    id: "provider-crash-loop-bounded",
    label: "no provider entered a crash loop",
    status: crashLoops.length === 0 ? "PASS" : "FAIL",
    observed: Object.keys(input.circuitOpenCounts).length
      ? Object.entries(input.circuitOpenCounts).map(([id, count]) => `${id}=${count}`).join(", ")
      : "no circuit opened",
    bound: `<= ${SOAK_BOUNDS.providerCrashLoopLimit} open transitions per runtime`,
    reason: crashLoops.length === 0 ? undefined : `${crashLoops.map(([id, count]) => `${id} opened ${count}x`).join(", ")}`
  });

  return outcomes;
}

export function soakPasses(invariants: readonly InvariantOutcome[]): boolean {
  return invariants.every((invariant) => invariant.status === "PASS");
}

/**
 * The verdict. Order matters: a run that did not reach its duration cannot be
 * PASS no matter how healthy it looked, and a host that could not sustain the run
 * is BLOCKED_EXTERNAL rather than FAIL — but never PASS.
 */
export function soakVerdict(input: {
  tier: SoakTier;
  elapsedSeconds: number;
  invariants: readonly InvariantOutcome[];
  /** Set when the run was cut short by something outside the harness's control. */
  blockedExternal?: { reason: string };
}): { overall: SoakReport["overall"]; reason: string } {
  const spec = SOAK_TIER_SPECS[input.tier];
  const failed = input.invariants.filter((invariant) => invariant.status === "FAIL");
  const unavailable = input.invariants.filter((invariant) => invariant.status === "UNAVAILABLE");

  if (input.blockedExternal) {
    return {
      overall: "BLOCKED_EXTERNAL",
      reason: `${input.blockedExternal.reason}; ${Math.round(input.elapsedSeconds)}s of the ${spec.auditSeconds}s ${spec.label} tier was completed and its partial evidence is preserved`
    };
  }
  if (input.elapsedSeconds < spec.auditSeconds) {
    return {
      overall: "INCOMPLETE_WITH_PARTIAL_EVIDENCE",
      reason: `the run stopped after ${Math.round(input.elapsedSeconds)}s of the ${spec.auditSeconds}s required for the ${spec.label} tier; this is not a pass`
    };
  }
  if (failed.length) {
    return {
      overall: "FAIL",
      reason: `${failed.length} invariant(s) breached: ${failed.map((invariant) => `${invariant.id} (${invariant.observed})`).join("; ")}`
    };
  }
  const partial = unavailable.length ? `; ${unavailable.length} invariant(s) could not be measured here: ${unavailable.map((invariant) => invariant.id).join(", ")}` : "";
  return { overall: "PASS", reason: `${spec.label} completed with every measured invariant holding${partial}` };
}

export function summarizeSoak(invariants: readonly InvariantOutcome[]): string {
  const pass = invariants.filter((invariant) => invariant.status === "PASS").length;
  const fail = invariants.filter((invariant) => invariant.status === "FAIL").length;
  const unavailable = invariants.filter((invariant) => invariant.status === "UNAVAILABLE").length;
  return `${pass} PASS, ${fail} FAIL, ${unavailable} UNAVAILABLE of ${invariants.length}`;
}

export function renderSoakReport(report: SoakReport): string {
  const header = [
    `Host-M soak harness — ${report.overall} (tier ${report.tier})`,
    `ran ${Math.round(report.elapsedSeconds)}s of ${report.targetSeconds}s; ${report.completed} completed, ${report.failed} failed, ${report.retries} retried`,
    `throughput ${report.tasksPerSecond.toFixed(3)} tasks/s; samples ${report.samples.length}`,
    `verdict: ${report.verdictReason}`
  ];
  const invariants = report.invariants.map((invariant) => {
    const reason = invariant.reason ? `  ${invariant.reason}` : "";
    return `${invariant.status.padEnd(11)} ${invariant.id.padEnd(30)} ${invariant.observed} (bound ${invariant.bound})${reason}`;
  });
  const unavailable = report.unavailable.map((entry) => `UNAVAILABLE ${entry.dimension}  ${entry.reason}`);
  return [...header, "", ...invariants, ...(unavailable.length ? ["", ...unavailable] : [])].join("\n");
}

export type { SoakTier as SoakTierId };
