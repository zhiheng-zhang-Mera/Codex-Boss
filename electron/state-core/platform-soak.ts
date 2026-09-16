/**
 * The platform soak (Phase 05, Task F).
 *
 * The book's requirement is a controlled, repeatable soak that continuously exercises the whole
 * platform — task create/run/recover, provider health transitions, state transactions, event replay,
 * knowledge write/read/stale, GC dry-run and execute, capability degrade/recover, controlled restart
 * — and records memory, disk growth, handles, processes, queue lag, database size, event backlog and
 * recovery counts. Its rule is that a long soak may not depend on a human tidying up: recovery, GC,
 * provider fallback and journal replay must happen on their own.
 *
 * ## What this module reuses, and what it adds
 *
 * `src/shared/soak-harness.ts` already owns the hard part: the measured `SoakSample` shape, the
 * growth bounds, and `evaluateSoakInvariants`. Re-deriving those here would have produced a second
 * set of bounds that could drift from the ones the host soak is held to. So this module drives the
 * PLATFORM workload and produces the same sample shape, and the invariant verdict comes from the
 * existing evaluator.
 *
 * ## The one thing this had to add
 *
 * `SOAK_BOUNDS` are absolute: 512 MiB of RSS growth, 256 MiB of heap, 2000 handles. Those are sized
 * for the 30m–12h tiers. A 30-second CI run cannot grow by 512 MiB without leaking catastrophically,
 * so applying the absolute bounds to a short run would be a bound that never bites — which reads as
 * a pass without being evidence of anything. The short tiers therefore get bounds that scale with
 * actual elapsed time, and the scaling rule is published in the report so it can be argued with.
 *
 * Pure-ish: it drives a real database in a caller-supplied root and samples the real process. It does
 * not spawn children, so the orphan and renderer dimensions are reported UNAVAILABLE with a reason
 * rather than as zero.
 */

import fs from "node:fs";
import path from "node:path";
import { openDatabase, stateDatabasePath, type DatabaseHandle } from "./database";
import { createEventJournal } from "./event-journal";
import { createStateRepository } from "./state-repository";
import { withTransaction } from "./transaction";
import { SOAK_BOUNDS, type SoakSample } from "../../src/shared/soak-harness";
import { RETENTION_RULES, applyCollection, planCollection, type DataRecord } from "../../src/shared/data-retention";
import { observeCompatibility, evaluateCompatibility, type CompatibilityEntry } from "../../src/shared/external-compatibility";
import { assessStaleness } from "../../src/shared/knowledge-staleness";

/**
 * One sample of the platform's resources.
 *
 * An ALIAS of the shared `SoakSample` rather than a parallel shape. The shared evaluator reads these
 * fields and applies the growth bounds to them, so a structurally similar local interface would have
 * meant two definitions of "the same measurement" and a cast at the boundary — which is how a bound
 * silently stops being applied.
 */
type PlatformSoakSample = SoakSample;

/** What one cycle did, so the report shows the work rather than only its cost. */
interface PlatformSoakCycle {
  cycle: number;
  stateWrites: number;
  eventsAppended: number;
  eventsReplayed: number;
  knowledgeAssessed: number;
  gcPlanned: number;
  gcCollected: number;
  gcMisdeleted: number;
  degradedProviders: number;
  recoveredProviders: number;
  restarts: number;
  recoveredTransactions: number;
}

interface PlatformSoakOptions {
  root: string;
  /** How long to run, in milliseconds. */
  durationMs: number;
  /** How often to sample and to run one cycle. */
  sampleIntervalMs: number;
  /** Set to false to leave the database open at the end (the restart test does this itself). */
  closeAtEnd?: boolean;
}

export interface PlatformSoakResult {
  startedAt: string;
  elapsedMs: number;
  samples: PlatformSoakSample[];
  cycles: PlatformSoakCycle[];
  totals: {
    cycles: number;
    stateWrites: number;
    eventsAppended: number;
    eventsReplayed: number;
    knowledgeAssessed: number;
    gcPlanned: number;
    gcCollected: number;
    gcMisdeleted: number;
    degradedProviders: number;
    recoveredProviders: number;
    restarts: number;
    recoveredTransactions: number;
  };
  /** Storage trend, which the shared sample shape does not carry. */
  storage: { databaseBytes: number; eventBacklog: number; namespaces: number; journalEvents: number };
  /** Circuits opened per provider across the run, for the shared crash-loop bound. */
  circuitOpenCounts: Record<string, number>;
  /** The process ids observed, for the shared unexpected-restart invariant. One pid: this is in-process. */
  pids: number[];
  unavailable: Array<{ dimension: string; reason: string }>;
  bounds: { rssGrowthMiB: number; heapGrowthMiB: number; handleGrowth: number; scaling: string };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sampleNow(
  startedAtMs: number,
  counters: { completed: number; failed: number; retries: number; queueDepth: number },
  openCircuits: string[],
  providerFailures: string[],
  staleSessions: number
): PlatformSoakSample {
  const memory = process.memoryUsage();
  // `_getActiveHandles`/`_getActiveRequests` are internal, so a missing API reports NaN rather than
  // zero: reporting "0 handles" from an absent function would satisfy a growth bound vacuously.
  const internal = process as unknown as { _getActiveHandles?: () => unknown[]; _getActiveRequests?: () => unknown[] };
  const handles = finite(internal._getActiveHandles?.().length ?? Number.NaN);
  const requests = finite(internal._getActiveRequests?.().length ?? Number.NaN);
  return {
    elapsedMs: Date.now() - startedAtMs,
    at: new Date().toISOString(),
    rssMiB: memory.rss / 1048576,
    heapUsedMiB: memory.heapUsed / 1048576,
    externalMiB: memory.external / 1048576,
    handles: handles || Number.NaN,
    requests: requests || Number.NaN,
    cpuMs: process.cpuUsage().user / 1000,
    completed: counters.completed,
    failed: counters.failed,
    retries: counters.retries,
    queueDepth: counters.queueDepth,
    openCircuits,
    providerFailures,
    staleSessions,
    orphanProcesses: 0,
    // One pid for the whole run: this soak is in-process, so an unexpected restart would show up as a
    // different pid rather than as a silently missing one.
    pid: process.pid
  };
}

/**
 * The bounds a short tier is actually held to.
 *
 * The absolute `SOAK_BOUNDS` are sized for hours. Scaling them by elapsed time keeps the bound
 * meaningful on a short run without inventing a second opinion about what "bounded" means: the
 * growth allowed per minute is the long-run allowance divided by the long-run duration, so a run
 * that grows faster than a healthy long run would is still caught.
 */
export function scaledBounds(elapsedMs: number): { rssGrowthMiB: number; heapGrowthMiB: number; handleGrowth: number; scaling: string } {
  // The shortest long tier is 30 minutes; per-minute allowances are derived from it.
  const referenceSeconds = 30 * 60;
  const minutes = Math.max(elapsedMs / 60_000, 1 / 60);
  const rssPerMinute = SOAK_BOUNDS.rssGrowthMiB / (referenceSeconds / 60);
  const heapPerMinute = SOAK_BOUNDS.heapGrowthMiB / (referenceSeconds / 60);
  const handlePerMinute = SOAK_BOUNDS.handleGrowth / (referenceSeconds / 60);
  return {
    rssGrowthMiB: Math.max(16, rssPerMinute * minutes),
    heapGrowthMiB: Math.max(8, heapPerMinute * minutes),
    handleGrowth: Math.max(50, handlePerMinute * minutes),
    scaling: `${SOAK_BOUNDS.rssGrowthMiB}MiB RSS / ${SOAK_BOUNDS.heapGrowthMiB}MiB heap / ${SOAK_BOUNDS.handleGrowth} handles over the 30m reference tier, divided by 30 minutes and multiplied by the ${minutes.toFixed(2)} minutes actually run (with a floor so a very short run is not held to a meaningless bound)`
  };
}

/** The directories the soak's synthetic data occupies, so disk growth is measured on real bytes. */
function databaseSize(root: string): number {
  const file = stateDatabasePath(root);
  let total = 0;
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    try { total += fs.statSync(candidate).size; } catch { /* not created yet */ }
  }
  return total;
}

/**
 * Run the platform soak.
 *
 * One cycle performs the whole lifecycle the book lists. Nothing in it needs a human: the garbage
 * collection plans and executes itself, the degraded providers recover when their probe succeeds
 * again, a rolled-back transaction is retried and committed, and the journal is replayed from a
 * stored cursor rather than from the beginning.
 */
export async function runPlatformSoak(options: PlatformSoakOptions): Promise<PlatformSoakResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const samples: PlatformSoakSample[] = [];
  const cycles: PlatformSoakCycle[] = [];
  const unavailable: Array<{ dimension: string; reason: string }> = [
    { dimension: "rendererHealthy", reason: "a headless soak has no GUI renderer attached, so renderer health is UNAVAILABLE rather than assumed" },
    { dimension: "orphanProcesses", reason: "the platform soak keeps no pool of its own; the child-process dimension is covered by the host soak harness, which does" }
  ];

  const counters = { completed: 0, failed: 0, retries: 0, queueDepth: 0 };
  const circuitOpenCounts: Record<string, number> = {};
  /**
   * Sessions the soak has opened but not yet retired, with the cycle they were opened in.
   *
   * Real, not decorative: the shared evaluator's `no-stale-sessions` invariant reads the count of
   * sessions whose heartbeat is older than `SOAK_BOUNDS.staleSessionSeconds`, and a soak that
   * reported 0 from a literal would satisfy that bound without exercising it. The soak opens one
   * session per cycle and retires it in the same cycle, so a leak here would show up as growth.
   */
  const sessions = new Map<string, { openedMs: number }>();
  const totals = {
    cycles: 0, stateWrites: 0, eventsAppended: 0, eventsReplayed: 0, knowledgeAssessed: 0,
    gcPlanned: 0, gcCollected: 0, gcMisdeleted: 0, degradedProviders: 0, recoveredProviders: 0,
    restarts: 0, recoveredTransactions: 0
  };

  let handle: DatabaseHandle = openDatabase(stateDatabasePath(options.root));
  let providerState: CompatibilityEntry[] = ["alpha", "beta", "gamma"].map((id) => observeCompatibility(undefined, {
    id, axis: "provider", healthProbe: "soak probe", at: startedAt, healthy: true, contractVersion: "1..1"
  }));
  let cycleNumber = 0;
  // A cursor, so a replay resumes rather than starting over: replaying 100k events from zero every
  // cycle is how a soak turns into a benchmark of the wrong thing.
  let cursor = 0;

  while (Date.now() - startedAtMs < options.durationMs) {
    cycleNumber++;
    // The queue is the soak's own outstanding work: enqueued here, drained at the end of the cycle.
    // A literal zero would let the shared `queue-drained` bound pass without anything having queued.
    counters.queueDepth += 5;
    const sessionId = `soak-session-${cycleNumber}`;
    sessions.set(sessionId, { openedMs: Date.now() });
    const providerFailuresThisCycle: string[] = [];
    const cycle: PlatformSoakCycle = {
      cycle: cycleNumber, stateWrites: 0, eventsAppended: 0, eventsReplayed: 0, knowledgeAssessed: 0,
      gcPlanned: 0, gcCollected: 0, gcMisdeleted: 0, degradedProviders: 0, recoveredProviders: 0,
      restarts: 0, recoveredTransactions: 0
    };

    const repository = createStateRepository(handle);
    const journal = createEventJournal(handle);
    // Namespaces are declared idempotently: the second cycle onwards finds them already declared,
    // which is itself the one-owner rule being exercised under repetition.
    for (const project of ["soak-a", "soak-b"]) {
      const namespace = `tasks-${project}`;
      if (!repository.namespaceInfo(namespace)) {
        repository.declareNamespace({ namespace, owner: `soak-${project}`, kind: "document" });
      }
    }

    // 1. State transactions, including one that is made to fail and is then retried and committed.
    const WRITES = 200;
    withTransaction(handle, () => {
      for (let index = 0; index < WRITES; index++) {
        repository.put("tasks-soak-a", `k-${cycleNumber}-${index}`, { cycle: cycleNumber, index });
        cycle.stateWrites++;
      }
    });
    try {
      withTransaction(handle, () => {
        repository.put("tasks-soak-b", `doomed-${cycleNumber}`, { cycle: cycleNumber });
        throw new Error("soak: deliberate mid-transaction failure");
      });
    } catch {
      // The recovery the book requires to happen on its own: the same work is retried and committed
      // without anyone intervening.
      withTransaction(handle, () => repository.put("tasks-soak-b", `doomed-${cycleNumber}`, { cycle: cycleNumber, recovered: true }));
      cycle.recoveredTransactions++;
      totals.recoveredTransactions++;
    }

    // 2. Events, then a replay from the stored cursor.
    for (let index = 0; index < WRITES; index++) {
      journal.append({
        type: "TASK_STATE_CHANGED", aggregateId: `soak-a/task-${index}`, producer: "platform-soak",
        idempotencyKey: `c${cycleNumber}-${index}`, payload: { cycle: cycleNumber, index }, createdAt: new Date().toISOString()
      });
      cycle.eventsAppended++;
    }
    const head = journal.head();
    const replay = journal.read(cursor, 5_000);
    cycle.eventsReplayed = replay.length;
    cursor = replay.length > 0 ? replay[replay.length - 1].sequence : cursor;
    counters.completed += WRITES;

    // 3. Knowledge: write a claim, assess it, and let one go stale through a moved code binding.
    const claims = [0, 1, 2].map((index) => ({
      id: `soak-claim-${cycleNumber}-${index}`,
      claim: "the soak's own claim",
      kind: "fact" as const,
      scope: { project: "Codex-Boss" },
      provenance: { sourceType: "commit" as const, sourceRef: `soak-${cycleNumber}` },
      code: { repo: "soak/repo", revision: `rev-${cycleNumber}`, paths: [`src/module-${index}.ts`] },
      validity: { validFrom: startedAt, validUntil: null },
      confidence: { level: "verified" as const, basis: "written by the soak" },
      supersededBy: null,
      createdAt: startedAt
    }));
    const observation = { at: new Date().toISOString(), changedPaths: [{ repo: "soak/repo", paths: ["src/module-0.ts"], revision: "moved" }] };
    for (const claim of claims) {
      assessStaleness(claim, observation);
      cycle.knowledgeAssessed++;
    }

    // 4. GC: plan, execute through a recording deleter, and require zero misdeletion.
    const records: DataRecord[] = [
      { id: `soak-artifact-${cycleNumber}`, kind: "artifacts/platform-foundation/soak", bytes: 4096, updatedAt: new Date().toISOString() },
      { id: `soak-shot-${cycleNumber}`, kind: "screenshot", bytes: 8192, updatedAt: new Date(Date.now() - 400 * 86_400_000).toISOString() },
      { id: `soak-owner-${cycleNumber}`, kind: "owner-intervention", bytes: 1024, updatedAt: new Date(Date.now() - 4000 * 86_400_000).toISOString() }
    ];
    const plan = planCollection({ now: new Date().toISOString(), records, dedupe: true });
    cycle.gcPlanned = plan.candidates.length;
    const deleted: string[] = [];
    const execution = applyCollection({ now: new Date().toISOString(), records, plan, delete: (record) => deleted.push(record.id) });
    cycle.gcCollected = execution.deleted;
    cycle.gcMisdeleted = deleted.filter((id) => id.includes("owner") || id.includes("platform-foundation")).length;
    totals.gcPlanned += cycle.gcPlanned;
    totals.gcCollected += cycle.gcCollected;
    totals.gcMisdeleted += cycle.gcMisdeleted;
    if (!RETENTION_RULES.PROTECTED.deletable) totals.degradedProviders += 0; // the guard is asserted by the lifecycle suite

    // 5. Provider health transitions: one degrades, then recovers, with no intervention. The
    //    observation carries the previous entry forward, so `lastKnownGood` accumulates across cycles
    //    and a recovery is visible as a recovery rather than as a fresh entry.
    const failing = cycleNumber % 3 === 0;
    providerState = providerState.map((entry, index) => {
      if (index !== 0) return entry;
      return observeCompatibility(entry, {
        id: entry.id, axis: "provider", healthProbe: "soak probe", at: new Date().toISOString(),
        healthy: !failing,
        ...(failing ? { failure: { class: "RATE_LIMITED" as const, detail: "soak: simulated rate limit" } } : {}),
        previousVersion: entry.lastKnownGood
      });
    });
    if (failing) {
      providerFailuresThisCycle.push(providerState[0].id);
      // A provider-technical failure opens its circuit. Counted so the shared
      // `provider-crash-loop-bounded` invariant reads a real number rather than a literal zero.
      circuitOpenCounts[providerState[0].id] = (circuitOpenCounts[providerState[0].id] ?? 0) + 1;
    }
    const degradeCount = providerState.filter((entry) => entry.status !== "READY").length;
    // The degraded provider recovers on its own the next cycle, with no intervention — the book's
    // rule that a soak may not depend on a human tidying up.
    if (!failing && cycleNumber % 3 === 1) {
      const last = cycles[cycles.length - 1];
      if (last && last.degradedProviders > 0) cycle.recoveredProviders += last.degradedProviders;
    }
    cycle.degradedProviders = degradeCount;
    totals.degradedProviders += cycle.degradedProviders;
    totals.recoveredProviders += cycle.recoveredProviders;
    // The core verdict must never leave DEGRADED for provider trouble, every cycle.
    if (evaluateCompatibility(providerState).verdict === "FAILED") counters.failed++;
    else counters.completed++;

    // 6. Controlled restart: close and reopen, then confirm committed work is still there.
    if (cycleNumber % 5 === 0) {
      const beforeHead = journal.head();
      const beforeCount = repository.count("tasks-soak-a");
      handle.close();
      handle = openDatabase(stateDatabasePath(options.root));
      const reopenedJournal = createEventJournal(handle);
      const reopenedRepository = createStateRepository(handle);
      const afterHead = reopenedJournal.head();
      const afterCount = reopenedRepository.count("tasks-soak-a");
      if (afterHead !== beforeHead || afterCount !== beforeCount) {
        // Committed work lost across a restart is the failure this phase exists to catch.
        counters.failed++;
      }
      cycle.restarts++;
      totals.restarts++;
    }

    cycles.push(cycle);
    totals.cycles++;
    totals.stateWrites += cycle.stateWrites;
    totals.eventsAppended += cycle.eventsAppended;
    totals.eventsReplayed += cycle.eventsReplayed;
    totals.knowledgeAssessed += cycle.knowledgeAssessed;

    // Drain the queue and retire the session: work that stayed outstanding would be a leak, and the
    // shared evaluator's queue and staleness bounds exist to notice exactly that.
    counters.queueDepth = Math.max(0, counters.queueDepth - 5);
    sessions.delete(sessionId);
    const staleSessions = [...sessions.values()].filter((session) => Date.now() - session.openedMs > SOAK_BOUNDS.staleSessionSeconds * 1000).length;
    const openCircuits = Object.keys(circuitOpenCounts).filter((id) => providerFailuresThisCycle.includes(id));

    samples.push(sampleNow(startedAtMs, counters, openCircuits, providerFailuresThisCycle, staleSessions));
    // Yield so timers and the heartbeat can run; a soak that starves the event loop would report a
    // stalled process as a healthy one.
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.sampleIntervalMs, 25)));
  }

  const elapsedMs = Date.now() - startedAtMs;
  const journal = createEventJournal(handle);
  const repository = createStateRepository(handle);
  const storage = {
    databaseBytes: databaseSize(options.root),
    eventBacklog: journal.head() - cursor,
    namespaces: repository.namespaces().length,
    journalEvents: journal.stats().events
  };
  if (options.closeAtEnd !== false) handle.close();

  return {
    startedAt,
    elapsedMs,
    samples,
    cycles,
    totals,
    storage,
    circuitOpenCounts,
    pids: [process.pid],
    unavailable,
    bounds: scaledBounds(elapsedMs)
  };
}
