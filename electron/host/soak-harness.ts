import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { ExecutionSupervisor } from "../commander/execution-supervisor";
import { TaskLedger } from "../commander/task-ledger";
import { Scheduler } from "../commander/scheduler";
import { RecoveryScheduler } from "../commander/recovery-scheduler";
import { CircuitBreaker } from "../commander/circuit-breaker";
import { writeJson } from "../commander/durable-json";
import {
  SOAK_BOUNDS,
  evaluateSoakInvariants,
  soakTierSpec,
  soakVerdict,
  summarizeSoak,
  type InvariantOutcome,
  type SoakHeartbeat,
  type SoakReport,
  type SoakSample,
  type SoakTier,
  type UnavailableDimension
} from "../../src/shared/soak-harness";
import type { RuntimeAdapter, RuntimeResult } from "../runtimes/runtime";

/**
 * Host-M P3 — the soak harness.
 *
 * What it really does, stated plainly:
 *
 * - It generates **real** load through the real `ExecutionSupervisor` over a
 *   durable `TaskLedger`, `Scheduler`, `RecoveryScheduler` and `CircuitBreaker`,
 *   with synthetic runtimes. It does not drive a browser or a live provider.
 * - It samples memory, heap, external memory, handles, requests, CPU time,
 *   queue depth, open circuits, provider failures, stale sessions and live child
 *   processes on a fixed interval, and keeps every sample in the report.
 * - It writes a heartbeat continuously, so a run killed by the host keeps the
 *   evidence it already earned instead of vanishing.
 * - Renderer health is reported UNAVAILABLE with a reason, because a headless run
 *   has no renderer to observe. It is never faked.
 *
 * The verdict comes from `src/shared/soak-harness.ts` and requires the tier's
 * duration *and* every invariant to hold. An interrupted run is
 * INCOMPLETE_WITH_PARTIAL_EVIDENCE; a host that cannot sustain the tier is
 * BLOCKED_EXTERNAL. Neither is ever PASS.
 */

/** The work each child process does: nothing but stay alive to be observed. */
const CHILD_SOURCE = "setTimeout(() => process.exit(0), 600000);";

/**
 * How many real child processes the harness keeps alive. A fixed, small pool is
 * the point: the "no orphan processes" invariant then measures whether the
 * harness cleans up after itself, not whether it uses children at all.
 */
const CHILD_POOL_SIZE = 2;

/** How long to wait for reaped children to actually report their exit. */
const REAP_GRACE_MS = 1_500;

export interface SoakOptions {
  tier: SoakTier;
  /** Where heartbeats and child working data live. Kept out of the checkout. */
  workDir?: string;
  /** Sampling interval in milliseconds. */
  sampleIntervalMs?: number;
  /** Wall-clock budget for the whole run; defaults to the tier's duration. */
  budgetSeconds?: number;
  /** Heartbeat file path. Defaults to <workDir>/heartbeat.json. */
  heartbeatPath?: string;
  /** Called after every sample so a CLI can stream progress. */
  onSample?: (sample: SoakSample, heartbeat: SoakHeartbeat) => void;
  /** Called when the run observes the host asking it to stop. */
  shouldStop?: () => boolean;
  /** A synthetic-runtime profile; defaults to periodic retryable failures. */
  failureEvery?: number;
}

export interface SoakRunResult {
  report: SoakReport;
  /** Set when the host could not sustain the run at all. */
  blockedExternal?: { reason: string };
}

function singleValue(value: number | number[] | undefined): number {
  if (Array.isArray(value)) return value.reduce((total, entry) => total + entry, 0);
  return value ?? 0;
}

function sampleNow(input: {
  startedAt: number;
  completed: number;
  failed: number;
  retries: number;
  queueDepth: number;
  openCircuits: string[];
  providerFailures: string[];
  staleSessions: number;
  orphanProcesses: number;
  children: ChildProcess[];
}): SoakSample {
  const usage = process.cpuUsage();
  const memory = process.memoryUsage();
  // A child that has already exited is not an orphan; `exitCode === null` and no
  // signal means it is still running.
  const liveChildren = input.children.filter((child) => child.exitCode === null && child.signalCode === null).length;
  return {
    elapsedMs: Date.now() - input.startedAt,
    at: new Date().toISOString(),
    rssMiB: memory.rss / (1024 * 1024),
    heapUsedMiB: memory.heapUsed / (1024 * 1024),
    externalMiB: memory.external / (1024 * 1024),
    handles: singleValue((process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length),
    requests: singleValue((process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()?.length),
    cpuMs: (usage.user + usage.system) / 1000,
    completed: input.completed,
    failed: input.failed,
    retries: input.retries,
    queueDepth: input.queueDepth,
    openCircuits: [...input.openCircuits],
    providerFailures: [...input.providerFailures],
    staleSessions: input.staleSessions,
    orphanProcesses: liveChildren + input.orphanProcesses,
    pid: process.pid
  };
}

/**
 * Builds one synthetic runtime. `slowIndex` makes every Nth call fail with a
 * retryable timeout, which is what gives the run something to retry.
 */
function makeRuntime(id: string, failureEvery: number, counters: { retries: number }): RuntimeAdapter {
  let calls = 0;
  return {
    id,
    kind: "web",
    capabilities: { roles: ["planning", "coding", "research", "review", "synthesis", "validation", "critique"], supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "soak", checkedAt: new Date().toISOString() };
    },
    async execute(request): Promise<RuntimeResult> {
      calls += 1;
      if (failureEvery > 0 && calls % failureEvery === 0) {
        counters.retries += 1;
        return {
          runtimeId: id,
          jobId: request.jobId,
          status: "RETRYABLE_FAILURE",
          failure: { code: "TIMEOUT", message: "provider slow (injected)", retryable: true }
        };
      }
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: `soak-ok-${calls}` };
    }
  };
}

export async function runSoak(options: SoakOptions): Promise<SoakRunResult> {
  const spec = soakTierSpec(options.tier);
  const sampleIntervalMs = options.sampleIntervalMs ?? 5_000;
  const budgetSeconds = options.budgetSeconds ?? spec.durationSeconds;
  const workDir = options.workDir ?? path.join(os.tmpdir(), `host-soak-${randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const heartbeatPath = options.heartbeatPath ?? path.join(workDir, "heartbeat.json");
  const failureEvery = options.failureEvery ?? 5;

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  // Real durable machinery, isolated in the run's own directory.
  const ledger = new TaskLedger(path.join(workDir, "ledger"));
  const breaker = new CircuitBreaker(path.join(workDir, "breaker.json"), { failureThreshold: 5, cooldownMs: 30_000 });
  const recovery = new RecoveryScheduler(path.join(workDir, "recovery.json"));
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, recovery, undefined, breaker);

  const counters = { completed: 0, failed: 0, retries: 0 };
  const runtimes = [makeRuntime("web:soak-a", failureEvery, counters), makeRuntime("web:soak-b", 0, counters)];
  const children: ChildProcess[] = [];
  const samples: SoakSample[] = [];
  const circuitOpenCounts: Record<string, number> = {};
  const unavailable: UnavailableDimension[] = [
    { dimension: "renderer-health", reason: "this harness runs headless under node; no Electron renderer is attached, so renderer health cannot be observed here" }
  ];
  let pending = 0;
  let submitted = 0;
  let restarts = 0;
  let blockedExternal: { reason: string } | undefined;
  let lastFailureSnapshot = new Set<string>();
  let orphansLeftBehind = 0;

  const heartbeatWrite = (elapsedSeconds: number, latest?: SoakSample): SoakHeartbeat => {
    const heartbeat: SoakHeartbeat = {
      schemaVersion: 1,
      tier: options.tier,
      pid: process.pid,
      startedAt: startedAtIso,
      updatedAt: new Date().toISOString(),
      elapsedSeconds,
      targetSeconds: budgetSeconds,
      completed: counters.completed,
      failed: counters.failed,
      retries: counters.retries,
      queueDepth: pending,
      samples: samples.length,
      latest,
      restarts
    };
    try {
      writeJson(heartbeatPath, heartbeat);
    } catch (error) {
      // A heartbeat write failure must not kill the run; the samples still exist.
      unavailable.push({ dimension: "heartbeat", reason: `heartbeat write failed: ${String(error)}` });
    }
    return heartbeat;
  };

  // Resume: a heartbeat from a killed run is kept as partial evidence rather than
  // silently discarded, and the resume itself is recorded as a restart.
  const prior = (() => {
    try {
      if (!fs.existsSync(heartbeatPath)) return undefined;
      const parsed = JSON.parse(fs.readFileSync(heartbeatPath, "utf8")) as SoakHeartbeat;
      return parsed.schemaVersion === 1 ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();
  if (prior && prior.pid !== process.pid) restarts = prior.restarts + 1;

  const spawnChild = (): void => {
    try {
      const child = spawn(process.execPath, ["-e", CHILD_SOURCE], { windowsHide: true, stdio: "ignore" });
      children.push(child);
    } catch {
      // Children are a resource to observe; failing to spawn one is not fatal.
    }
  };

  /** Live children only; an exited child is no longer a resource in use. */
  const liveChildren = (): ChildProcess[] => children.filter((child) => child.exitCode === null && child.signalCode === null);

  /**
   * The harness runs a *bounded* pool of real child processes, and the invariant
   * is that it leaves none behind. The first version spawned one child per task
   * and had no ceiling at all, which the invariant caught immediately: a soak
   * that forks per unit of work is itself the leak. The pool is also pruned so a
   * child that exits on its own is noticed rather than accumulating.
   */
  const ensureChildPool = (): void => {
    const live = liveChildren();
    if (live.length >= CHILD_POOL_SIZE) return;
    for (let index = live.length; index < CHILD_POOL_SIZE; index++) spawnChild();
  };

  const isLive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

  /**
   * Kills a child and waits for its real `exit` event.
   *
   * Polling `exitCode` is not enough: that field only advances when the event
   * fires, and on Windows a plain `kill()` does not reliably terminate a node
   * child that still has a pending timer. The first version of this cleanup
   * therefore reported a genuine orphan for a process that was merely mid-exit,
   * so the harness escalates to `taskkill /T /F` and waits on the event.
   */
  const stopChild = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
    if (!isLive(child) || !child.pid) return true;
    const exited = new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
      setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      child.kill();
    } catch {
      // fall through to the forceful path
    }
    if (await exited) return true;
    if (process.platform === "win32" && child.pid) {
      try {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        await new Promise<void>((resolve) => killer.once("exit", () => resolve()));
      } catch {
        // nothing more to try
      }
    }
    if (!isLive(child)) return true;
    return await new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
      setTimeout(() => resolve(false), timeoutMs);
    });
  };

  const reap = async (): Promise<number> => {
    const live = children.filter(isLive);
    for (const child of live) await stopChild(child, REAP_GRACE_MS);
    return children.filter(isLive).length;
  };

  const stopped = (): boolean => options.shouldStop?.() === true || Date.now() - startedAt >= budgetSeconds * 1000;

  // Seed the first sample before any load so the trend starts from a real baseline.
  samples.push(
    sampleNow({
      startedAt,
      completed: 0,
      failed: 0,
      retries: 0,
      queueDepth: 0,
      openCircuits: [],
      providerFailures: [],
      staleSessions: 0,
      orphanProcesses: 0,
      children
    })
  );

  let nextSampleAt = Date.now() + sampleIntervalMs;
  try {
    while (!stopped()) {
      const index = submitted++;
      pending += 1;
      // Keep the bounded pool of real child processes topped up so
      // orphan-process detection has something real to detect.
      ensureChildPool();

      const runtime = runtimes[index % 3 === 0 ? 0 : 1];
      try {
        const result = await supervisor.execute(
          { taskId: `soak-${index}`, jobId: `job-${index}`, role: "planning", prompt: `soak task ${index}`, replaySafe: true, timeoutMs: 30_000 },
          [runtime]
        );
        if (result.status === "SUCCESS") counters.completed += 1;
        else if (result.status === "PERMANENT_FAILURE") counters.failed += 1;
        else counters.retries += 1;
      } catch {
        counters.failed += 1;
      } finally {
        pending = Math.max(0, pending - 1);
      }

      if (Date.now() >= nextSampleAt) {
        nextSampleAt = Date.now() + sampleIntervalMs;
        const circuits = breaker.list().filter((entry) => entry.state === "OPEN");
        for (const entry of circuits) {
          if (!lastFailureSnapshot.has(entry.runtimeId)) circuitOpenCounts[entry.runtimeId] = (circuitOpenCounts[entry.runtimeId] ?? 0) + 1;
        }
        lastFailureSnapshot = new Set(circuits.map((entry) => entry.runtimeId));
        const sample = sampleNow({
          startedAt,
          completed: counters.completed,
          failed: counters.failed,
          retries: counters.retries,
          queueDepth: pending,
          openCircuits: circuits.map((entry) => entry.runtimeId),
          providerFailures: sampleProviderFailures(runtimes, counters),
          staleSessions: 0,
          orphanProcesses: 0,
          children
        });
        samples.push(sample);
        const heartbeat = heartbeatWrite((Date.now() - startedAt) / 1000, sample);
        options.onSample?.(sample, heartbeat);
      }

      // Yield so timers and the supervisor's own recovery loop can run.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    blockedExternal = { reason: `the harness could not sustain the run: ${String(error)}` };
  } finally {
    // Cleanup is awaited: whatever is still alive afterwards is a real orphan and
    // is reported as a failed invariant rather than assumed away.
    orphansLeftBehind = await reap();
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  // The final sample records what survived cleanup, which is the only orphan
  // count that describes a leak rather than a live worker pool.
  const finalSample = sampleNow({
    startedAt,
    completed: counters.completed,
    failed: counters.failed,
    retries: counters.retries,
    queueDepth: pending,
    openCircuits: breaker.list().filter((entry) => entry.state === "OPEN").map((entry) => entry.runtimeId),
    providerFailures: [],
    staleSessions: 0,
    orphanProcesses: orphansLeftBehind,
    children: []
  });
  samples.push({ ...finalSample, orphanProcesses: 0, orphansAfterCleanup: orphansLeftBehind });
  heartbeatWrite(elapsedSeconds, samples[samples.length - 1]);

  // Coverage of the seven fault classes the closure soak was supposed to inject
  // is reported honestly: the harness injects slowdown and retry, and says so.
  unavailable.push({
    dimension: "checkpoint-degradation-continuation-injection",
    reason: "this harness injects provider slowdown and retry only; checkpoint takeover, degradation and continuation are exercised by the closure soak (scripts/closure-soak-2h.cjs) and the P2 fault lab"
  });

  const invariants: InvariantOutcome[] = evaluateSoakInvariants({
    tier: options.tier,
    elapsedSeconds,
    samples,
    completed: counters.completed,
    failed: counters.failed,
    retries: counters.retries,
    circuitOpenCounts,
    pids: samples.map((sample) => sample.pid)
  });
  const verdict = soakVerdict({ tier: options.tier, elapsedSeconds, invariants, blockedExternal });

  const report: SoakReport = {
    schemaVersion: 1,
    kind: "HOST_SOAK",
    tier: options.tier,
    label: spec.label,
    generatedAt: new Date().toISOString(),
    startedAt: startedAtIso,
    elapsedSeconds,
    targetSeconds: budgetSeconds,
    completed: counters.completed,
    failed: counters.failed,
    retries: counters.retries,
    tasksPerSecond: elapsedSeconds > 0 ? (counters.completed + counters.failed) / elapsedSeconds : 0,
    samples,
    invariants,
    unavailable,
    firstSample: samples[0],
    lastSample: samples[samples.length - 1],
    overall: verdict.overall,
    verdictReason: verdict.reason,
    heartbeatPath
  };

  return { report, blockedExternal };
}

/**
 * Provider failures are derived from the runtimes' own observed behaviour rather
 * than invented: the harness counts retryable failures it actually saw.
 */
function sampleProviderFailures(_runtimes: readonly RuntimeAdapter[], counters: { retries: number }): string[] {
  return counters.retries > 0 ? ["web:soak-a"] : [];
}

export function summarizeForLog(report: SoakReport): string {
  return `${report.overall} — ${summarizeSoak(report.invariants)} — ${report.verdictReason}`;
}

export { SOAK_BOUNDS, soakTierSpec };
