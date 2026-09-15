import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Phase H — the battery's quiescence rule (spec sec. 34/59) is exercised directly.
 *
 * Why this file exists: the rule used to treat `alive(pid) && !released_at` as proof of a
 * concurrent run. That claim cannot be carried by pid liveness on Windows, and the harness proved
 * it against itself — lock `evolution-1789347366120` (killed 2026-09-14, never released) recorded
 * pid 2064, which an unrelated `svchost` later owned, so the gate refused at step 66/70 with
 * `EVOLUTION_BATTERY_REFUSED:NOT_QUIESCENT` a day after the run died and could never clear. The
 * cases below pin the replacement rule in both directions: a spent mutex must not block the gate,
 * and a run that is genuinely still working must still be refused.
 *
 * The module is CJS (the battery `require`s it), so it is loaded through `createRequire` and its
 * report is typed here at that boundary.
 */

interface ForeignLock {
  run_id: string;
  pid: number | null;
  alive: boolean;
  released: boolean;
  classification: string;
  heartbeat_age_ms: number | null;
  heartbeat_fresh: boolean;
  stranded_head: boolean;
  scratch_branch: string;
}

interface Refusal {
  code: string;
  run_id: string;
  pid: number | null;
  reason: string;
  remedy?: string;
}

interface QuiescenceReport {
  lock_file: string;
  foreign_locks: ForeignLock[];
  live_children: string[];
  refusals: Refusal[];
  pending_git_operations: string[];
  heartbeat_window_ms: number;
  current_head: string;
  system_quiescent: boolean;
  checked_at: string;
}

interface Deps {
  root: string;
  runId: string;
  lockFile: string;
  now: number;
  isAlive: (pid: unknown) => boolean;
  currentHeadRef: () => string;
  readJournal: (file: string) => { records?: Array<Record<string, unknown>> };
  pendingGitOperations: (root: string) => string[];
  relativeToRoot: (file: string) => string;
  freshnessMs?: number;
}

const require_ = createRequire(import.meta.url);
const rule = require_("../../scripts/acceptance-evolution-quiescence.cjs") as {
  HEARTBEAT_FRESH_MS: number;
  scratchBranchFor: (runId: string) => string;
  heartbeatAgeMs: (runDir: string, now: number) => number | null;
  assessQuiescence: (deps: Deps) => QuiescenceReport;
};

const CURRENT_RUN = "evolution-current";
const HOUR_MS = 60 * 60 * 1000;

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-quiescence-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function runDirOf(root: string, runId: string): string {
  return path.join(root, "artifacts", "evolution", runId);
}

function writeLock(root: string, runId: string, lock: Record<string, unknown>): string {
  const runDir = runDirOf(root, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, "battery.lock");
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return file;
}

function writeJournal(root: string, runId: string, records: Array<Record<string, unknown>>): void {
  const runDir = runDirOf(root, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "evolution-journal.ndjson"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

/** Backdate every artefact of a run, so the heartbeat age is a fact the test controls. */
function ageRun(root: string, runId: string, ageMs: number): void {
  const seconds = (Date.now() - ageMs) / 1000;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else fs.utimesSync(full, seconds, seconds);
    }
  };
  walk(runDirOf(root, runId));
}

function assess(root: string, overrides: Partial<Deps> = {}): QuiescenceReport {
  return rule.assessQuiescence({
    root,
    runId: CURRENT_RUN,
    lockFile: path.join(runDirOf(root, CURRENT_RUN), "battery.lock"),
    now: Date.now(),
    isAlive: () => false,
    currentHeadRef: () => "Prestart-checkpoint-5",
    // The real adapter is the runner's `readJournalSync`: parse the ndjson that is on disk, so
    // these cases exercise the rule against the journals they write.
    readJournal: (file: string) => {
      if (!fs.existsSync(file)) return { records: [] };
      return {
        records: fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      };
    },
    pendingGitOperations: () => [],
    relativeToRoot: (file: string) => path.relative(root, file).split(path.sep).join("/"),
    ...overrides
  });
}

describe("evolution quiescence: a spent mutex does not block the battery", () => {
  it("the observed 2026-09-14 lock (killed run, pid since recycled by an unrelated process) is not a live run", () => {
    const root = makeRoot();
    // Exactly the retained state of artifacts/evolution/evolution-1789347366120: written by a run
    // killed 16/20 rounds in, never released, and its pid now alive as another process.
    writeLock(root, "evolution-1789347366120", {
      run_id: "evolution-1789347366120",
      pid: 2064,
      started_at: "2026-09-14T00:56:06.120Z",
      workspace: root,
      mode: "IN_PLACE",
      baseline_commit: "89259ec2e1cf275fc8577654af287420f57f9b7a",
      baseline_tree: "0ce7f7df163455aff089aa88ea14d6f3042c138e"
    });
    writeJournal(root, "evolution-1789347366120", [
      { event: "RUN_STARTED", round: 16, pid: 999999 },
      { event: "RUN_FINISHED", round: 15, pid: 999999 }
    ]);
    fs.writeFileSync(path.join(runDirOf(root, "evolution-1789347366120"), "round-16.json"), "{}\n", "utf8");
    ageRun(root, "evolution-1789347366120", 24 * HOUR_MS);

    const report = assess(root, { isAlive: (pid) => pid === 2064 });

    const lock = report.foreign_locks[0];
    expect(lock.alive).toBe(true);
    expect(lock.released).toBe(false);
    expect(lock.heartbeat_fresh).toBe(false);
    expect(lock.stranded_head).toBe(false);
    expect(lock.classification).toBe("pid_recycled_or_spent");
    expect(report.live_children).toEqual([]);
    expect(report.refusals).toEqual([]);
    expect(report.system_quiescent).toBe(true);
  });

  it("an unreleased lock whose pid is gone is a killed run, not a live one", () => {
    const root = makeRoot();
    writeLock(root, "evolution-killed", { run_id: "evolution-killed", pid: 4242, started_at: "2026-09-14T00:00:00.000Z" });
    ageRun(root, "evolution-killed", HOUR_MS);

    const report = assess(root, { isAlive: () => false });

    expect(report.foreign_locks[0].classification).toBe("killed");
    expect(report.system_quiescent).toBe(true);
  });

  it("a released lock is finished even when an unrelated process now owns its pid", () => {
    const root = makeRoot();
    writeLock(root, "evolution-released", {
      run_id: "evolution-released",
      pid: 1234,
      started_at: "2026-09-14T00:00:00.000Z",
      released_at: "2026-09-14T01:00:00.000Z"
    });

    // Fresh artefacts and a live pid: still finished, because the run said so and restored HEAD.
    const report = assess(root, { isAlive: (pid) => pid === 1234 });

    expect(report.foreign_locks[0].released).toBe(true);
    expect(report.foreign_locks[0].classification).toBe("finished");
    expect(report.system_quiescent).toBe(true);
  });

  it("the run that is starting now is never a foreign lock", () => {
    const root = makeRoot();
    const lock = writeLock(root, CURRENT_RUN, { run_id: CURRENT_RUN, pid: process.pid, started_at: new Date().toISOString() });

    const report = assess(root, {
      lockFile: lock,
      isAlive: (pid) => pid === process.pid,
      currentHeadRef: () => rule.scratchBranchFor(CURRENT_RUN)
    });

    expect(report.foreign_locks).toEqual([]);
    expect(report.system_quiescent).toBe(true);
  });
});

describe("evolution quiescence: a run that is still working is refused", () => {
  it("refuses a live in-place run: unreleased lock, live pid, fresh heartbeat, stranded HEAD", () => {
    const root = makeRoot();
    writeLock(root, "evolution-live", { run_id: "evolution-live", pid: 4242, started_at: new Date().toISOString() });
    writeJournal(root, "evolution-live", [{ event: "RUN_STARTED", round: 1, pid: 4243 }]);

    const report = assess(root, {
      isAlive: (pid) => pid === 4242,
      currentHeadRef: () => rule.scratchBranchFor("evolution-live")
    });

    expect(report.foreign_locks[0].classification).toBe("live_concurrent_run");
    expect(report.foreign_locks[0].heartbeat_fresh).toBe(true);
    expect(report.foreign_locks[0].stranded_head).toBe(true);
    expect(report.live_children).toEqual(["pid 4242 (battery evolution-live)"]);
    expect(report.refusals.map((refusal) => refusal.code)).toEqual(["LIVE_CONCURRENT_RUN"]);
    expect(report.system_quiescent).toBe(false);
  });

  it("refuses a stalled in-place run through the stranded HEAD witness alone (heartbeat long stale)", () => {
    const root = makeRoot();
    writeLock(root, "evolution-stalled", { run_id: "evolution-stalled", pid: 4242, started_at: "2026-09-14T00:00:00.000Z" });
    ageRun(root, "evolution-stalled", 2 * HOUR_MS);

    const report = assess(root, {
      isAlive: (pid) => pid === 4242,
      currentHeadRef: () => rule.scratchBranchFor("evolution-stalled")
    });

    const lock = report.foreign_locks[0];
    expect(lock.heartbeat_fresh).toBe(false);
    expect(lock.stranded_head).toBe(true);
    expect(lock.classification).toBe("live_concurrent_run");
    expect(report.system_quiescent).toBe(false);
  });

  it("refuses a stranded HEAD alone, with the remedy, even when the lock was released", () => {
    const root = makeRoot();
    writeLock(root, "evolution-teardown-blocked", {
      run_id: "evolution-teardown-blocked",
      pid: 4242,
      started_at: "2026-09-14T00:00:00.000Z",
      released_at: "2026-09-14T01:00:00.000Z"
    });
    ageRun(root, "evolution-teardown-blocked", 3 * HOUR_MS);

    const report = assess(root, {
      isAlive: () => false,
      currentHeadRef: () => rule.scratchBranchFor("evolution-teardown-blocked")
    });

    expect(report.foreign_locks[0].released).toBe(true);
    expect(report.foreign_locks[0].classification).toBe("finished");
    expect(report.live_children).toEqual([]);
    expect(report.refusals.map((refusal) => refusal.code)).toEqual(["STRANDED_IN_PLACE_HEAD"]);
    expect(report.refusals[0].reason).toContain(rule.scratchBranchFor("evolution-teardown-blocked"));
    expect(report.refusals[0].remedy).toContain("symbolic-ref");
    expect(report.system_quiescent).toBe(false);
  });

  it("refuses an orphan round child: RUN_STARTED with no RUN_FINISHED and a live pid", () => {
    const root = makeRoot();
    writeLock(root, "evolution-orphan", {
      run_id: "evolution-orphan",
      pid: 4242,
      started_at: "2026-09-14T00:00:00.000Z",
      released_at: "2026-09-14T01:00:00.000Z"
    });
    writeJournal(root, "evolution-orphan", [
      { event: "RUN_STARTED", round: 3, pid: 777 },
      { event: "RUN_FINISHED", round: 2, pid: 776 }
    ]);
    ageRun(root, "evolution-orphan", 3 * HOUR_MS);

    const report = assess(root, { isAlive: (pid) => pid === 777 });

    expect(report.refusals.map((refusal) => refusal.code)).toEqual(["ORPHAN_ROUND_CHILD"]);
    expect(report.live_children).toEqual(["round 3 of evolution-orphan (pid 777)"]);
    expect(report.system_quiescent).toBe(false);
  });

  it("refuses a repository that is mid-git-operation", () => {
    const root = makeRoot();

    const report = assess(root, { pendingGitOperations: () => ["rebase-merge", "MERGE_HEAD"] });

    expect(report.refusals.map((refusal) => refusal.code)).toEqual(["PENDING_GIT_OPERATION"]);
    expect(report.pending_git_operations).toEqual(["rebase-merge", "MERGE_HEAD"]);
    expect(report.system_quiescent).toBe(false);
  });
});

describe("evolution quiescence: the rule fails loudly rather than open", () => {
  it("throws when a dependency is missing instead of assessing quiescence without it", () => {
    const root = makeRoot();
    const deps = {
      root,
      runId: CURRENT_RUN,
      lockFile: path.join(runDirOf(root, CURRENT_RUN), "battery.lock"),
      now: Date.now(),
      isAlive: () => false,
      currentHeadRef: () => "main",
      readJournal: () => ({ records: [] }),
      pendingGitOperations: () => [],
      relativeToRoot: (file: string) => file
    };

    expect(() => rule.assessQuiescence({ ...deps, isAlive: undefined } as unknown as Deps)).toThrow(/requires the 'isAlive' dependency/);
    expect(() => rule.assessQuiescence({ ...deps, readJournal: "yes" } as unknown as Deps)).toThrow(/requires 'readJournal' to be a function/);
    expect(() => rule.assessQuiescence({ ...deps, freshnessMs: 0 })).toThrow(/positive freshnessMs/);
    expect(() => rule.assessQuiescence(deps)).not.toThrow();
  });

  it("a run directory with nothing timable has no heartbeat (no evidence either way)", () => {
    const root = makeRoot();
    const runDir = runDirOf(root, "evolution-empty");
    fs.mkdirSync(runDir, { recursive: true });

    expect(rule.heartbeatAgeMs(runDir, Date.now())).toBeNull();
    expect(rule.heartbeatAgeMs(path.join(root, "absent"), Date.now())).toBeNull();

    fs.writeFileSync(path.join(runDir, "round-1.json"), "{}\n", "utf8");
    ageRun(root, "evolution-empty", 5000);
    const age = rule.heartbeatAgeMs(runDir, Date.now());
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(4000);
    expect(age as number).toBeLessThan(60000);
  });

  it("the declared window is what decides freshness at the boundary", () => {
    const root = makeRoot();
    writeLock(root, "evolution-boundary", { run_id: "evolution-boundary", pid: 4242, started_at: new Date().toISOString() });
    ageRun(root, "evolution-boundary", 5000);

    const fresh = assess(root, { freshnessMs: 10_000, isAlive: (pid) => pid === 4242 });
    const stale = assess(root, { freshnessMs: 1_000, isAlive: (pid) => pid === 4242 });

    expect(fresh.foreign_locks[0].heartbeat_fresh).toBe(true);
    expect(fresh.foreign_locks[0].classification).toBe("live_concurrent_run");
    expect(fresh.heartbeat_window_ms).toBe(10_000);
    expect(stale.foreign_locks[0].heartbeat_fresh).toBe(false);
    expect(stale.foreign_locks[0].classification).toBe("pid_recycled_or_spent");
    expect(stale.system_quiescent).toBe(true);
    // The declared production window is the measured one, not the test override.
    expect(rule.HEARTBEAT_FRESH_MS).toBe(30 * 60 * 1000);
  });
});
