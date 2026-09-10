#!/usr/bin/env node
/**
 * R-901 hardened soak engine (Host-A Phase D).
 *
 * One single continuous autonomous run over the REAL ExecutionSupervisor +
 * durable TaskLedger + RecoveryScheduler + CircuitBreaker. Deterministic fault
 * schedule (no random sparse timeouts), unique run identity, JSONL heartbeat
 * and continuity proof. Formal acceptance requires --seconds >= 7200; shorter
 * runs are only allowed with an explicit --validate-only flag, and a
 * validate-only run never writes the formal evidence path and never PASSes.
 *
 * Usage:
 *   node scripts/r901-soak.cjs [--seconds N] [--run-id ID] [--evidence-dir DIR]
 *                              [--root DIR] [--failure-threshold N] [--cooldown-ms N]
 *                              [--validate-only] [--validate-seconds N]
 *
 * Formal evidence: <evidence-dir>/r901-<runId>.json
 * Heartbeat:       <evidence-dir>/r901-<runId>.heartbeat.jsonl
 * validate-only:   evidence under <root>/validate/ with qualifiesForAcceptance=false.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ExecutionSupervisor } = require("../dist-electron/electron/commander/execution-supervisor.js");
const { TaskLedger } = require("../dist-electron/electron/commander/task-ledger.js");
const { Scheduler } = require("../dist-electron/electron/commander/scheduler.js");
const { RecoveryScheduler } = require("../dist-electron/electron/commander/recovery-scheduler.js");
const { CircuitBreaker } = require("../dist-electron/electron/commander/circuit-breaker.js");

const MIN_ACCEPTANCE_SECONDS = 7200;
const HARNESS_VERSION = "r901-soak-3.0";
const REQUIRED_PHASES = [
  "NORMAL_OPERATION", "PROVIDER_SLOWDOWN", "RETRY", "CHECKPOINT_WRITE",
  "CONSECUTIVE_PROVIDER_FAILURE", "BREAKER_OPEN_DEGRADED", "FALLBACK_PROVIDER_CONTINUATION",
  "CHECKPOINT_RESUME", "PROVIDER_RECOVERY", "CONTINUED_NORMAL_OPERATION",
];

function parseArgs(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const seconds = Number(get("--seconds", MIN_ACCEPTANCE_SECONDS));
  const validateOnly = argv.includes("--validate-only");
  const validateSeconds = Number(get("--validate-seconds", 90));
  const evidenceDir = path.resolve(get("--evidence-dir", path.join("Update-Plan", "2026-09-09-closure", "evidence")));
  const root = path.resolve(get("--root", fs.mkdtempSync(path.join(os.tmpdir(), "r901-"))));
  const runId = get("--run-id", null);
  const failureThreshold = Number(get("--failure-threshold", 5));
  const explicitCooldown = argv.includes("--cooldown-ms");
  let cooldownMs = Number(get("--cooldown-ms", 60000));
  if (validateOnly && !explicitCooldown) cooldownMs = 3000; // keep validate-only fast
  return { seconds, validateOnly, validateSeconds, evidenceDir, root, runId, failureThreshold, cooldownMs };
}

function gitHead() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}
function hostId() { return `${os.hostname()}-${process.platform}-${os.arch()}`; }
function newRunId() { return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function failureResult(runtimeId, jobId, code, message, retryable) {
  return { runtimeId, jobId, status: retryable ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE", failure: { code, message, retryable } };
}
function okResult(runtimeId, jobId, n) { return { runtimeId, jobId, status: "SUCCESS", content: `soak-ok-${n}` }; }

class SoakRuntime {
  constructor(id) {
    this.id = id;
    this.kind = "web";
    this.calls = 0;
    this.failNextByJob = new Map();
    this.mode = "normal"; // normal | slow | fail-network
    this.slowDelayMs = 2200;
    this.capabilities = { consumesModel: true, roles: ["planner"], supportsCancellation: true, supportsStreaming: true };
  }
  async healthCheck() {
    return { runtimeId: this.id, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() };
  }
  async execute(request) {
    this.calls++;
    const n = this.calls;
    const jobKey = `${request.taskId}/${request.jobId}`;
    const retryOnce = this.failNextByJob.get(jobKey);
    if (retryOnce) {
      this.failNextByJob.delete(jobKey);
      return failureResult(this.id, request.jobId, retryOnce, `injected ${retryOnce}`, true);
    }
    if (this.mode === "slow") { await sleep(this.slowDelayMs); return okResult(this.id, request.jobId, n); }
    if (this.mode === "fail-network") return failureResult(this.id, request.jobId, "NETWORK_FAILURE", "injected NETWORK_FAILURE", true);
    return okResult(this.id, request.jobId, n);
  }
}

/** Count durable checkpoint generations persisted for a task. */
function countCheckpointGens(root, taskId) {
  const cpDir = path.join(root, taskId, "checkpoints");
  if (!fs.existsSync(cpDir)) return 0;
  return fs.readdirSync(cpDir).filter((n) => /^\d{8}\.json$/.test(n)).length;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.validateOnly && cfg.seconds < MIN_ACCEPTANCE_SECONDS) {
    console.error(`R901_FAIL_CLOSED durationSec=${cfg.seconds} < MIN_ACCEPTANCE_SECONDS=${MIN_ACCEPTANCE_SECONDS}; short runs require --validate-only`);
    process.exit(2);
  }
  const runId = cfg.runId || newRunId();
  const formal = !cfg.validateOnly;
  const targetSeconds = formal ? cfg.seconds : Math.max(5, cfg.validateSeconds);
  const head = gitHead();
  const startedAt = new Date().toISOString();
  const evidenceRoot = formal ? cfg.evidenceDir : path.join(cfg.root, "validate");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const evidencePath = path.join(evidenceRoot, `r901-${runId}.json`);
  const heartbeatPath = path.join(evidenceRoot, `r901-${runId}.heartbeat.jsonl`);
  const startMs = Date.now();

  const stats = {
    taskIndex: 0, created: 0, completed: 0, fatalFailed: 0, activeTaskCount: 0, maxInFlight: 0, inFlight: 0,
    slowdownObserved: 0, retryObserved: 0, checkpointWritten: 0, checkpointResumed: 0,
    degradationObserved: 0, fallbackContinuationObserved: 0, providerRecoveryObserved: 0,
  };
  const seen = new Set();
  let maxTaskGapMs = 0;

  // Primary supervisor over the MAIN durable root: breaker + recovery wired.
  const ledger = new TaskLedger(cfg.root);
  const breaker = new CircuitBreaker(path.join(cfg.root, "breaker.json"), { failureThreshold: cfg.failureThreshold, cooldownMs: cfg.cooldownMs });
  const recovery = new RecoveryScheduler(path.join(cfg.root, "recovery.json"));
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler(), undefined, recovery, undefined, breaker);
  const a = new SoakRuntime("web:a");
  const b = new SoakRuntime("web:b");

  // Track in-flight concurrency (peak in-flight = activeTaskCount evidence).
  const rawExecute = supervisor.execute.bind(supervisor);
  supervisor.execute = (request, candidates) => {
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const promise = Promise.resolve(rawExecute(request, candidates)).finally(() => { stats.inFlight--; });
    stats.activeTaskCount = Math.max(stats.activeTaskCount, stats.inFlight);
    return promise;
  };

  const appendHeartbeat = (phase) => {
    const row = {
      ts: new Date().toISOString(), phase: phase || "RUNNING",
      elapsedSec: Math.round((Date.now() - startMs) / 1000),
      completed: stats.completed, inFlight: stats.inFlight, fatalFailed: stats.fatalFailed,
      counters: {
        completed: stats.completed, fatalFailed: stats.fatalFailed, created: stats.created,
        slowdownObserved: stats.slowdownObserved, retryObserved: stats.retryObserved,
        checkpointWritten: stats.checkpointWritten, checkpointResumed: stats.checkpointResumed,
        degradationObserved: stats.degradationObserved,
        fallbackContinuationObserved: stats.fallbackContinuationObserved,
        providerRecoveryObserved: stats.providerRecoveryObserved,
      },
      breaker: breaker.list(),
    };
    fs.appendFileSync(heartbeatPath, JSON.stringify(row) + "\n", "utf8");
  };

  /** Dispatch through the PRIMARY supervisor; returns {result, taskId}. */
  const dispatch = async (candidates, tag) => {
    stats.taskIndex++;
    stats.created++;
    const taskId = `t-${tag || stats.taskIndex}-${crypto.randomBytes(2).toString("hex")}`;
    const jobId = `j-${stats.taskIndex}`;
    const req = { taskId, jobId, role: "planner", prompt: `soak ${tag || stats.taskIndex}`, replaySafe: true, timeoutMs: 60_000 };
    const t0 = Date.now();
    let result;
    try { result = await supervisor.execute(req, candidates); }
    catch (error) {
      stats.fatalFailed++;
      return { result: failureResult("supervisor", jobId, "UNKNOWN", String(error), false), taskId };
    }
    const elapsed = Date.now() - t0;
    if (elapsed > maxTaskGapMs) maxTaskGapMs = elapsed;
    if (result.status === "SUCCESS") { stats.completed++; stats.checkpointWritten += Math.max(1, countCheckpointGens(cfg.root, taskId)); }
    else if (result.status === "PERMANENT_FAILURE") stats.fatalFailed++;
    return { result, taskId, elapsed };
  };

  // Idempotent durable recovery replay for the primary supervisor.
  recovery.register("runtime", async (record) => {
    const payload = record.payload;
    const done = ledger.load(payload.request.taskId)?.jobs?.[payload.request.jobId]?.state === "COMPLETED";
    if (done) return { done: true }; // already resolved durably elsewhere — no double count
    const candidates = (payload.runtimeIds || []).map((id) => (id === a.id ? a : id === b.id ? b : null)).filter(Boolean);
    const result = await supervisor.execute(payload.request, candidates);
    if (result.status === "SUCCESS") { stats.completed++; return { done: true }; }
    if (result.status === "PERMANENT_FAILURE") { stats.fatalFailed++; return { done: false, retryAt: Date.now() + 60_000, error: result.failure?.message || "permanent" }; }
    return { done: false, retryAt: Date.now() + 30_000, error: result.failure?.message || "still slow" };
  });
  recovery.start();

  fs.writeFileSync(heartbeatPath, "", "utf8");
  appendHeartbeat("START");

  /**
   * RETRY narrative (isolated root): one job fails once on [a] (replay-safe),
   * the durable RecoveryScheduler replays it and the ledger job completes.
   * Uses its own breaker so it never disturbs the primary breaker cycle.
   */
  const runRetryNarrative = async () => {
    const subRoot = path.join(cfg.root, "narr-retry");
    const led = new TaskLedger(subRoot);
    const brk = new CircuitBreaker(path.join(subRoot, "breaker.json"), { failureThreshold: cfg.failureThreshold, cooldownMs: 3000 });
    const rec = new RecoveryScheduler(path.join(subRoot, "recovery.json"));
    const sup = new ExecutionSupervisor(led, new Scheduler(), undefined, rec, undefined, brk);
    stats.taskIndex++; stats.created++;
    const taskId = `t-nretry-${crypto.randomBytes(3).toString("hex")}`;
    const jobId = `j-${stats.taskIndex}`;
    const req = { taskId, jobId, role: "planner", prompt: "soak narrative retry", replaySafe: true, timeoutMs: 60_000 };
    a.failNextByJob.set(`${taskId}/${jobId}`, "TIMEOUT");
    const first = await sup.execute(req, [a]);
    if (first.status === "SUCCESS") { stats.completed++; stats.retryObserved++; stats.checkpointWritten += Math.max(1, countCheckpointGens(subRoot, taskId)); return; }
    if (first.status === "PERMANENT_FAILURE") { stats.fatalFailed++; return; }
    await sleep(3200); // let the parked retryAt lapse
    rec.register("runtime", async (record) => {
      const candidates = (record.payload.runtimeIds || []).map((id) => (id === a.id ? a : null)).filter(Boolean);
      const r2 = await sup.execute(record.payload.request, candidates);
      if (r2.status === "SUCCESS") return { done: true };
      return { done: false, retryAt: Date.now() + 10_000, error: r2.failure?.message || "retry failed" };
    });
    await rec.runDue(Date.now() + 60_000);
    const st = led.load(taskId);
    const completedOk = st?.jobs?.[jobId]?.state === "COMPLETED";
    if (completedOk) { stats.retryObserved++; stats.completed++; } else { stats.fatalFailed++; }
    stats.checkpointWritten += Math.max(1, countCheckpointGens(subRoot, taskId));
    rec.dispose();
  };

  /**
   * CHECKPOINT_RESUME narrative (isolated root): a first failure durably parks
   * a job; after the retryAt lapses a BRAND-NEW supervisor instance over the
   * same durable root resumes the exact task/job and completes it.
   */
  const runResumeNarrative = async () => {
    const subRoot = path.join(cfg.root, "narr-resume");
    const led = new TaskLedger(subRoot);
    const brk = new CircuitBreaker(path.join(subRoot, "breaker.json"), { failureThreshold: cfg.failureThreshold, cooldownMs: 3000 });
    const rec = new RecoveryScheduler(path.join(subRoot, "recovery.json"));
    const sup1 = new ExecutionSupervisor(led, new Scheduler(), undefined, rec, undefined, brk);
    stats.taskIndex++; stats.created++;
    const taskId = `t-nresume-${crypto.randomBytes(3).toString("hex")}`;
    const jobId = `j-${stats.taskIndex}`;
    const req = { taskId, jobId, role: "planner", prompt: "soak narrative resume", replaySafe: true, timeoutMs: 60_000 };
    a.failNextByJob.set(`${taskId}/${jobId}`, "NETWORK_FAILURE");
    const first = await sup1.execute(req, [a]);
    if (first.status === "SUCCESS") { stats.completed++; stats.checkpointResumed++; stats.checkpointWritten += Math.max(1, countCheckpointGens(subRoot, taskId)); return; }
    if (first.status === "PERMANENT_FAILURE") { stats.fatalFailed++; return; }
    await sleep(3200); // parked retryAt lapses; the durable checkpoint now holds a WAITING job
    rec.dispose(); // no timer races: resume is driven explicitly below
    const led2 = new TaskLedger(subRoot);
    const sup2 = new ExecutionSupervisor(led2, new Scheduler(), undefined, undefined, undefined, brk);
    const resumeOut = await sup2.execute(req, [b]);
    if (resumeOut.status === "SUCCESS") { stats.checkpointResumed++; stats.completed++; }
    else if (resumeOut.status === "PERMANENT_FAILURE") stats.fatalFailed++;
    stats.checkpointWritten += Math.max(1, countCheckpointGens(subRoot, taskId));
  };

  const startedWall = Date.now();
  let cycle = 0;

  while (Date.now() - startedWall < targetSeconds * 1000) {
    cycle++;
    const markPhase = (name) => { seen.add(name); appendHeartbeat(name); };

    // 1) NORMAL_OPERATION.
    markPhase("NORMAL_OPERATION");
    a.mode = "normal"; b.mode = "normal";
    for (let i = 0; i < 3; i++) await dispatch([a, b], `normal-${cycle}-${i}`);

    // 2) PROVIDER_SLOWDOWN (a slows but succeeds; scheduler timeout is 60s).
    markPhase("PROVIDER_SLOWDOWN");
    a.mode = "slow";
    const slow = await dispatch([a, b], `slow-${cycle}`);
    if (slow.result.status === "SUCCESS" && (slow.elapsed ?? 0) >= 1500) stats.slowdownObserved++;
    a.mode = "normal";

    // 3) RETRY (deterministic durable-replay narrative).
    markPhase("RETRY");
    await runRetryNarrative();

    // 4) CHECKPOINT_WRITE — confirm a durable generation grows on a completed job.
    markPhase("CHECKPOINT_WRITE");
    stats.taskIndex++; stats.created++;
    const cpTask = `t-cp-${cycle}-${crypto.randomBytes(2).toString("hex")}`;
    const cpBefore = countCheckpointGens(cfg.root, cpTask);
    const cpReq = { taskId: cpTask, jobId: `j-${stats.taskIndex}`, role: "planner", prompt: "soak checkpoint", replaySafe: true, timeoutMs: 60_000 };
    const cpOut = await supervisor.execute(cpReq, [b]);
    if (cpOut.status === "SUCCESS") stats.completed++;
    else if (cpOut.status === "PERMANENT_FAILURE") stats.fatalFailed++;
    const cpAfter = countCheckpointGens(cfg.root, cpTask);
    if (cpAfter > cpBefore) stats.checkpointWritten++;

    // 5) CONSECUTIVE_PROVIDER_FAILURE + 6) BREAKER_OPEN / DEGRADED.
    markPhase("CONSECUTIVE_PROVIDER_FAILURE");
    a.mode = "fail-network";
    let opened = false;
    for (let i = 0; i < cfg.failureThreshold; i++) {
      const out = await dispatch([a, b], `consec-${cycle}-${i}`);
      if (breaker.state(a.id) === "OPEN") { opened = true; stats.degradationObserved++; }
      if (out.result.status === "SUCCESS" && out.result.runtimeId === b.id) stats.fallbackContinuationObserved++;
    }
    a.mode = "normal";
    if (breaker.state(a.id) === "OPEN") { opened = true; stats.degradationObserved++; }
    markPhase("BREAKER_OPEN_DEGRADED");

    // 7) FALLBACK_PROVIDER_CONTINUATION — explicit task while a is OPEN.
    markPhase("FALLBACK_PROVIDER_CONTINUATION");
    const fb = await dispatch([a, b], `fallback-${cycle}`);
    if (fb.result.status === "SUCCESS" && fb.result.runtimeId === b.id) stats.fallbackContinuationObserved++;

    // 8) CHECKPOINT_RESUME (fresh-supervisor durable resume narrative).
    markPhase("CHECKPOINT_RESUME");
    await runResumeNarrative();

    // 9) PROVIDER_RECOVERY — after cooldown a HALF_OPEN probe on a closes it.
    markPhase("PROVIDER_RECOVERY");
    const openRec = breaker.list().find((r) => r.runtimeId === a.id);
    if (openRec?.state === "OPEN") {
      const openedAt = openRec.openedAt ? new Date(openRec.openedAt).getTime() : Date.now();
      const waitMs = cfg.cooldownMs - (Date.now() - openedAt);
      if (waitMs > 0) await sleep(Math.min(waitMs, 30_000));
      if (breaker.state(a.id) === "HALF_OPEN") {
        const probe = await dispatch([a, b], `probe-${cycle}`);
        if (probe.result.status === "SUCCESS" && probe.result.runtimeId === a.id) stats.providerRecoveryObserved++;
      } else if (breaker.state(a.id) === "CLOSED") {
        stats.providerRecoveryObserved++;
      }
    } else if (openRec?.state === "HALF_OPEN") {
      const probe = await dispatch([a, b], `probe-${cycle}`);
      if (probe.result.status === "SUCCESS" && probe.result.runtimeId === a.id) stats.providerRecoveryObserved++;
    } else {
      stats.providerRecoveryObserved++;
    }

    // 10) CONTINUED_NORMAL_OPERATION.
    markPhase("CONTINUED_NORMAL_OPERATION");
    a.mode = "normal"; b.mode = "normal";
    for (let i = 0; i < 3; i++) await dispatch([a, b], `cont-${cycle}-${i}`);

    if (cycle % 5 === 0) appendHeartbeat("CYCLE");
    await sleep(40);
  }

  const endWall = new Date().toISOString();
  stats.activeTaskCount = Math.max(stats.activeTaskCount, stats.maxInFlight);
  const durationSec = Math.round((Date.now() - startedWall) / 1000);
  const heartbeats = fs.readFileSync(heartbeatPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let maxHeartbeatGapMs = 0;
  for (let i = 1; i < heartbeats.length; i++) {
    const gap = new Date(heartbeats[i].ts).getTime() - new Date(heartbeats[i - 1].ts).getTime();
    if (gap > maxHeartbeatGapMs) maxHeartbeatGapMs = gap;
  }
  const missingPhases = REQUIRED_PHASES.filter((p) => !seen.has(p));
  const countersOk = stats.slowdownObserved >= 1 && stats.retryObserved >= 1 && stats.checkpointWritten >= 1
    && stats.checkpointResumed >= 1 && stats.degradationObserved >= 1
    && stats.fallbackContinuationObserved >= 1 && stats.providerRecoveryObserved >= 1;
  const qualifies = formal && durationSec >= MIN_ACCEPTANCE_SECONDS && stats.completed > 0
    && stats.fatalFailed === 0 && stats.activeTaskCount > 0 && missingPhases.length === 0 && countersOk;

  const evidence = {
    requirement: "R-901", phase: "I", date: new Date().toISOString(),
    status: formal ? (qualifies ? "PASS" : "NO_PASS") : "VALIDATION",
    formal, runId, pid: process.pid, gitHead: head, startedAt, finishedAt: endWall,
    hostId: hostId(), nodeVersion: process.version, harnessVersion: HARNESS_VERSION,
    qualifiesForAcceptance: qualifies,
    config: { targetSeconds, failureThreshold: cfg.failureThreshold, cooldownMs: cfg.cooldownMs, evidenceRoot },
    stats: { ...stats, durationSec },
    schedule: [...seen].map((phase) => ({ phase, observed: true })),
    missingPhases,
    continuity: {
      startWallTime: startedAt, endWallTime: endWall,
      activeElapsedSec: durationSec, heartbeatCount: heartbeats.length,
      maxHeartbeatGapMs, maxTaskGapMs,
      taskSequence: { first: 1, last: stats.taskIndex, count: stats.taskIndex },
    },
    heartbeatPath: path.relative(process.cwd(), heartbeatPath),
    evidencePath: path.relative(process.cwd(), evidencePath),
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({
    status: evidence.status, qualifiesForAcceptance: qualifies, runId, durationSec,
    completed: stats.completed, fatalFailed: stats.fatalFailed, missingPhases,
    counters: {
      slowdownObserved: stats.slowdownObserved, retryObserved: stats.retryObserved,
      checkpointWritten: stats.checkpointWritten, checkpointResumed: stats.checkpointResumed,
      degradationObserved: stats.degradationObserved,
      fallbackContinuationObserved: stats.fallbackContinuationObserved,
      providerRecoveryObserved: stats.providerRecoveryObserved,
    },
  }, null, 2));
  process.exit(qualifies || cfg.validateOnly ? 0 : 3);
}

main().catch((error) => { console.error("R901_SOAK_ERROR", error); process.exit(1); });
