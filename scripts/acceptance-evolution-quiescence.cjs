"use strict";

/**
 * Quiescence assessment for the autonomous-evolution battery (spec sec. 34/59).
 *
 * The battery runs the trial IN PLACE: `setupWorkspace` re-points HEAD at
 * `boss/evolution/<run_id>` for the whole run (no file is rewritten, and the teardown restores
 * HEAD the same way). That makes the shared working tree a single-tenant resource, so a run has
 * to establish that no other run is using it before it starts. This module is that check; the
 * battery supplies the facts (pids, git, journals) and refuses when `system_quiescent` is false.
 *
 * ------------------------------------------------------------------ *
 * Why pid liveness alone cannot carry the claim (measured, not theorised)
 * ------------------------------------------------------------------ *
 *
 * The first version of this check treated `alive(pid) && !released_at` as proof of a concurrent
 * run, and refused to start when it saw one. Windows recycles pids, so a spent mutex left by a
 * killed run eventually names an unrelated live process, and the refusal then never clears: no
 * wait, no teardown and no completion of the dead run can satisfy it, and the only way forward is
 * for an operator to delete a mutex by hand - the exact outcome the `released_at` tolerance was
 * added to avoid.
 *
 * That is not hypothetical in this repository. Lock `evolution-1789347366120`, written
 * 2026-09-14T00:56:06Z by a battery killed 16/20 rounds in (baseline `89259ec`, never released),
 * had its recorded pid 2064 recycled by an unrelated `svchost` process. The next gate run refused
 * with `EVOLUTION_BATTERY_REFUSED:NOT_QUIESCENT` 34 h later (checked_at 2026-09-15T10:56:55Z versus
 * a lock whose newest artefact was already 34.1 h old), reporting `alive: true` for a run that had
 * been dead for more than a day, and step 66/70 of the gate could not pass at all.
 *
 * ------------------------------------------------------------------ *
 * The rule
 * ------------------------------------------------------------------ *
 *
 * An unfinished (unreleased) lock is evidence of a live concurrent run only when the recorded pid
 * is alive AND at least one of two independent witnesses says that run is still working:
 *
 *   1. HEARTBEAT. A running battery writes inside its own run directory continuously - the round
 *      child appends a journal record and a `round-N.json` evidence file for every round. Over
 *      the 74 retained runs in this repository the gap between consecutive writes is a median of
 *      8.1 s, a p99 of 11.4 s and a maximum of 162.1 s (2572 intervals). A run whose directory has
 *      not been touched for `HEARTBEAT_FRESH_MS` (30 min, ~11x the longest observed gap) is not
 *      running. The lock itself is part of the witness set, so the window between "lock written"
 *      and "first round finished" is covered.
 *   2. STRANDED HEAD. HEAD pointing at `boss/evolution/<run_id>` means that run re-pointed the
 *      shared tree and has not restored it. A genuinely running in-place battery is in this state
 *      for its whole life, so a stalled one is still refused - which is the case where starting a
 *      second in-place battery would actually corrupt the workspace.
 *
 * A stranded HEAD refuses on its own, even for a released lock, because it is residue in the
 * workspace rather than a claim about a process: `teardownWorkspace` restores HEAD before it
 * releases the lock, and it does not restore it at all when it returns
 * `TEARDOWN_BLOCKED:DIRTY_WORKSPACE`. The refusal names the branch and the remedy
 * (`git symbolic-ref HEAD refs/heads/<branch>`, or `git checkout <branch>`).
 *
 * What is deliberately NOT relaxed:
 *   - a released lock is never a live child (unchanged: pid reuse made that rule refuse forever);
 *   - orphan round children are still refused: a journal that logs RUN_STARTED for a round with no
 *     RUN_FINISHED and whose pid is alive is an actual running process, whatever the lock says;
 *   - a repository mid-git-operation is still refused.
 *
 * Residual risk, stated rather than hidden: an ISOLATED-mode run that is alive, stalled for longer
 * than the heartbeat window and holding no stranded HEAD would be treated as spent. It cannot
 * corrupt the shared tree - isolated runs work in a linked worktree under their own run directory
 * and never write the primary one - so the overlap is bounded to machine resources, and the
 * stranding witness still covers the mode that does touch the shared tree.
 *
 * Every dependency is injected, so the rule is exercised directly by
 * `tests/unit/evolution-quiescence.test.ts` instead of only through a 20-round battery run.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * How long a foreign run directory may go untouched before its unreleased lock stops being
 * evidence of a live run. Declared, and justified by the measurement in the module docblock
 * (median 8.1 s, p99 11.4 s, max 162.1 s over 2572 observed writes).
 */
const HEARTBEAT_FRESH_MS = 30 * 60 * 1000;

/** The scratch branch an in-place run re-points HEAD at for the length of its run. */
function scratchBranchFor(runId) {
  return `boss/evolution/${runId}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Age in ms of the newest artefact a running battery would have written, or `null` when the run
 * directory holds nothing that can be timed (an emptied run directory: no evidence either way).
 */
function heartbeatAgeMs(runDir, now) {
  let newest = 0;
  const consider = (file) => {
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      /* absent: nothing to time */
    }
  };
  consider(path.join(runDir, "battery.lock"));
  consider(path.join(runDir, "evolution-journal.ndjson"));
  consider(path.join(runDir, "probes", "evolution-journal.ndjson"));
  consider(path.join(runDir, "fault-injection", "evolution-journal.ndjson"));
  let entries = [];
  try {
    entries = fs.readdirSync(runDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (entry.isFile() && /^round-.*\.json$/.test(entry.name)) consider(path.join(runDir, entry.name));
  }
  return newest === 0 ? null : Math.max(0, now - newest);
}

const REQUIRED_DEPENDENCIES = [
  "root",
  "runId",
  "lockFile",
  "now",
  "isAlive",
  "currentHeadRef",
  "readJournal",
  "pendingGitOperations",
  "relativeToRoot"
];

/**
 * Assess whether the shared workspace is idle enough to start a run.
 *
 * @param {object} deps injected facts and adapters (all required, validated below)
 * @param {string} deps.root repository root
 * @param {string} deps.runId the run that is starting now (its own lock/dir/branch are ignored)
 * @param {string} deps.lockFile absolute path of the lock this run has just written
 * @param {number} deps.now epoch ms
 * @param {(pid: unknown) => boolean} deps.isAlive pid liveness probe
 * @param {() => string} deps.currentHeadRef abbreviated branch name at HEAD, or "HEAD" if detached
 * @param {(file: string) => {records?: Array<Record<string, unknown>>}} deps.readJournal journal reader
 * @param {(root: string) => string[]} deps.pendingGitOperations mid-operation probes
 * @param {(file: string) => string} deps.relativeToRoot path display helper
 * @param {number} [deps.freshnessMs] override for `HEARTBEAT_FRESH_MS` (tests only)
 */
function assessQuiescence(deps) {
  for (const key of REQUIRED_DEPENDENCIES) {
    if (deps === null || deps === undefined || deps[key] === undefined || deps[key] === null) {
      throw new Error(`assessQuiescence requires the '${key}' dependency`);
    }
  }
  for (const key of ["isAlive", "currentHeadRef", "readJournal", "pendingGitOperations", "relativeToRoot"]) {
    if (typeof deps[key] !== "function") throw new Error(`assessQuiescence requires '${key}' to be a function`);
  }
  const freshnessMs = deps.freshnessMs ?? HEARTBEAT_FRESH_MS;
  if (!Number.isFinite(freshnessMs) || freshnessMs <= 0) throw new Error("assessQuiescence requires a positive freshnessMs");

  const evolutionRoot = path.join(deps.root, "artifacts", "evolution");
  const headRef = deps.currentHeadRef();
  const foreignLocks = [];
  const liveChildren = [];
  const refusals = [];

  let dirs = [];
  try {
    dirs = fs
      .readdirSync(evolutionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    dirs = [];
  }

  for (const name of dirs) {
    const runDir = path.join(evolutionRoot, name);
    const lock = path.join(runDir, "battery.lock");
    // A run directory without a lock is skipped: the battery writes its lock before it starts any
    // round, so a directory that holds journal records or round evidence always has one.
    if (!fs.existsSync(lock)) continue;
    const parsed = readJson(lock);
    if (!parsed) continue;
    const runId = typeof parsed.run_id === "string" && parsed.run_id !== "" ? parsed.run_id : name;
    if (runId === deps.runId) continue;

    const alive = deps.isAlive(parsed.pid);
    const released = Boolean(parsed.released_at);
    const heartbeatAge = heartbeatAgeMs(runDir, deps.now);
    const fresh = heartbeatAge !== null && heartbeatAge <= freshnessMs;
    const scratchBranch = scratchBranchFor(runId);
    const strandedHead = headRef === scratchBranch;
    const classification = released
      ? "finished"
      : alive && (fresh || strandedHead)
        ? "live_concurrent_run"
        : alive
          ? "pid_recycled_or_spent"
          : "killed";

    foreignLocks.push({
      run_id: runId,
      pid: parsed.pid,
      alive,
      started_at: parsed.started_at,
      released,
      classification,
      heartbeat_age_ms: heartbeatAge,
      heartbeat_fresh: fresh,
      stranded_head: strandedHead,
      scratch_branch: scratchBranch,
      baseline_commit: parsed.baseline_commit ?? ""
    });

    if (classification === "live_concurrent_run") {
      liveChildren.push(`pid ${parsed.pid} (battery ${runId})`);
      refusals.push({
        code: "LIVE_CONCURRENT_RUN",
        run_id: runId,
        pid: parsed.pid,
        reason:
          `battery ${runId} holds an unreleased lock, its pid ${parsed.pid} is alive, and ` +
          `${fresh ? `its run directory was written ${Math.round(heartbeatAge / 1000)} s ago` : "HEAD is on its scratch branch"}`,
        remedy: "wait for that run to finish; if its process is confirmed gone, delete its battery.lock"
      });
    } else if (strandedHead) {
      refusals.push({
        code: "STRANDED_IN_PLACE_HEAD",
        run_id: runId,
        pid: parsed.pid,
        reason:
          `HEAD is on ${scratchBranch}, the scratch branch of battery ${runId} (${classification}), ` +
          "so an in-place run did not restore the shared tree's branch",
        remedy: `restore the intended branch: git symbolic-ref HEAD refs/heads/<branch> (or git checkout <branch>)`
      });
    }

    // Orphan round children: independent of the lock, and unchanged. A journal that logs
    // RUN_STARTED without RUN_FINISHED and whose recorded pid is alive is a running process.
    const read = deps.readJournal(path.join(runDir, "evolution-journal.ndjson"));
    const started = new Map();
    const finished = new Set();
    for (const record of read.records ?? []) {
      if (record.event === "RUN_STARTED") started.set(`${record.round}`, record);
      if (record.event === "RUN_FINISHED") finished.add(`${record.round}`);
    }
    for (const [round, record] of started) {
      if (!finished.has(round) && deps.isAlive(record.pid)) {
        liveChildren.push(`round ${round} of ${runId} (pid ${record.pid})`);
        refusals.push({
          code: "ORPHAN_ROUND_CHILD",
          run_id: runId,
          pid: record.pid,
          reason: `round ${round} of battery ${runId} logged RUN_STARTED with no RUN_FINISHED and its process is alive`,
          remedy: "wait for that round to finish, or stop it before starting another run"
        });
      }
    }
  }

  const pending = deps.pendingGitOperations(deps.root) ?? [];
  if (pending.length > 0) {
    refusals.push({
      code: "PENDING_GIT_OPERATION",
      run_id: "",
      pid: null,
      reason: `the repository is mid-git-operation: ${pending.join(", ")}`,
      remedy: "finish or abort the pending git operation"
    });
  }

  return {
    lock_file: deps.relativeToRoot(deps.lockFile),
    foreign_locks: foreignLocks,
    live_children: liveChildren,
    refusals,
    pending_git_operations: pending,
    heartbeat_window_ms: freshnessMs,
    current_head: headRef,
    system_quiescent: refusals.length === 0,
    checked_at: new Date(deps.now).toISOString()
  };
}

module.exports = { HEARTBEAT_FRESH_MS, scratchBranchFor, heartbeatAgeMs, assessQuiescence };
