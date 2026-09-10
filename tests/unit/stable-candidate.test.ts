import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  READ_ONLY_SHARED_SURFACES,
  STABLE_WRITABLE_SURFACES,
  assertRuntimeWriteAllowed,
  assessRuntimeWrite,
  evolutionDataDirArg,
  evolutionEnvironmentOverrides,
  evolutionLayout,
  materializeEvolutionLayout,
  quarantineCandidateRuntime,
  verifyRuntimeSeparation
} from "../../electron/stable-candidate/runtime-isolation";
import { CandidateSupervisor } from "../../electron/stable-candidate/candidate-supervisor";
import {
  CandidateWorkspaceError,
  candidateChangedFiles,
  candidateHeadSha,
  candidateIsDirty,
  commitCandidate,
  createCandidateWorkspace,
  headSha,
  removeCandidateWorkspace
} from "../../electron/stable-candidate/workspace-manager";
import { cleanupFixtures, commit, currentBranch, gitRepo, tempDir, write } from "../helpers/root-fixtures";

/**
 * F2 ...Stable / Candidate isolation acceptance (Isolation-Finalization.md §8,
 * §23 RD-004 "Candidate cannot write Stable", RD-005 "Runtime data isolation",
 * RD-006 "Candidate crash isolation"; §14 RT-04, RT-18, RT-19).
 *
 * Every test uses a real git repository and a real filesystem tree. The claim
 * being verified is not "the code intends to isolate" but "the Candidate's
 * working tree, refs and writable surfaces are physically separate from Stable's".
 */

afterEach(cleanupFixtures);

const RUN_ID = "run-2026-09-10-alpha";

describe("Run layout and runtime-data separation (§8.2, §8.3, RD-005)", () => {
  it("gives each run its own workspace, runtime-data, temp, logs, evidence and journal", () => {
    const evolutionRoot = tempDir("boss-evolution-");
    const layout = evolutionLayout(evolutionRoot, RUN_ID, "a".repeat(40));
    expect(layout.candidateBranch).toBe(`evolution/${RUN_ID}`);
    expect(layout.processNamespace).toBe(`codex-boss-evolution-${RUN_ID}`);
    const unique = new Set([layout.workspace, layout.runtimeData, layout.temp, layout.logs, layout.evidence, layout.journal]);
    expect(unique.size).toBe(6);
    for (const directory of unique) expect(directory.startsWith(layout.root)).toBe(true);

    // A different run id yields a disjoint tree.
    const other = evolutionLayout(evolutionRoot, "run-2026-09-10-beta", "a".repeat(40));
    expect(other.root).not.toBe(layout.root);
    expect(other.workspace).not.toBe(layout.workspace);
  });

  it("rejects an invalid run id or a malformed base SHA", () => {
    const evolutionRoot = tempDir("boss-evolution-");
    expect(() => evolutionLayout(evolutionRoot, "../escape", "a".repeat(40))).toThrow();
    expect(() => evolutionLayout(evolutionRoot, "ok", "not-a-sha")).toThrow();
  });

  it("redirects every writable environment surface into the run", () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    const overrides = evolutionEnvironmentOverrides(layout);
    expect(overrides.TEMP).toBe(layout.temp);
    expect(overrides.TMP).toBe(layout.temp);
    expect(overrides.TMPDIR).toBe(layout.temp);
    expect(overrides.CODEX_BOSS_DATA_DIR).toBe(layout.runtimeData);
    expect(evolutionDataDirArg(layout)).toBe(`--boss-data-dir=${layout.runtimeData}`);
    for (const directory of [layout.workspace, layout.runtimeData, layout.temp, layout.logs, layout.evidence, layout.journal]) {
      expect(fs.existsSync(directory)).toBe(true);
    }
  });

  it("denies a Candidate write into any Stable writable surface (RT-04, RD-004)", () => {
    const stableRoot = tempDir("boss-stable-");
    const layout = evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40));
    materializeEvolutionLayout(layout);

    // Inside the Candidate: allowed.
    expect(assessRuntimeWrite(layout, stableRoot, path.join(layout.runtimeData, "state.json")).decision).toBe("ALLOW");
    expect(assessRuntimeWrite(layout, stableRoot, path.join(layout.workspace, "src", "a.ts")).decision).toBe("ALLOW");

    // Any Stable writable surface: denied.
    for (const surface of STABLE_WRITABLE_SURFACES) {
      const target = path.join(stableRoot, surface, "state.json");
      const assessment = assessRuntimeWrite(layout, stableRoot, target);
      expect(assessment.decision, surface).toBe("DENY");
      expect(assessment.sharedSurfaces.length, surface).toBeGreaterThan(0);
      expect(() => assertRuntimeWriteAllowed(layout, stableRoot, target)).toThrow();
    }

    // Anything else outside the Candidate: also denied.
    const outside = assessRuntimeWrite(layout, stableRoot, path.join(tempDir("boss-elsewhere-"), "x.json"));
    expect(outside.decision).toBe("DENY");
    expect(outside.escaped).toBe(true);
  });

  it("verifies there is no overlap between the run tree and Stable", () => {
    const stableRoot = tempDir("boss-stable-");
    const evolutionRoot = path.join(stableRoot, "evolution");
    const layout = evolutionLayout(evolutionRoot, RUN_ID, "a".repeat(40));
    // A run tree nested inside Stable is refused: that is exactly the overlap
    // this module exists to prevent.
    expect(verifyRuntimeSeparation(layout, stableRoot).separated).toBe(false);

    const outside = evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40));
    expect(verifyRuntimeSeparation(outside, stableRoot).separated).toBe(true);
    expect(READ_ONLY_SHARED_SURFACES).toContain("node_modules");
  });

  it("quarantines corrupt Candidate runtime-data instead of repairing Stable", () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    write(layout.runtimeData, "corrupt.json", "{ not json");
    const stableSentinel = path.join(tempDir("boss-stable-"), "keep.json");
    fs.writeFileSync(stableSentinel, "stable", "utf8");

    const quarantined = quarantineCandidateRuntime(layout, "2026-09-10T00-00-00Z");
    expect(quarantined).toBeDefined();
    expect(fs.existsSync(quarantined as string)).toBe(true);
    expect(fs.existsSync(path.join(quarantined as string, "corrupt.json"))).toBe(true);
    // A clean runtime-data root is left behind, and Stable is untouched.
    expect(fs.existsSync(layout.runtimeData)).toBe(true);
    expect(fs.readdirSync(layout.runtimeData)).toHaveLength(0);
    expect(fs.readFileSync(stableSentinel, "utf8")).toBe("stable");
  });
});

describe("Candidate workspace is a real, separate git working tree (§8.1, §8.2)", () => {
  it("creates a worktree on a unique branch at the frozen base SHA, leaving Stable alone", async () => {
    const stable = gitRepo("boss-stable-repo-");
    const evolutionRoot = tempDir("boss-evolution-");
    const stableHeadBefore = await headSha(stable.root);

    const candidate = await createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: stable.sha, runId: RUN_ID });
    expect(candidate.strategy).toBe("worktree");
    expect(candidate.baseSha).toBe(stable.sha);
    expect(candidate.stableHeadSha).toBe(stableHeadBefore);
    expect(candidate.workspace.startsWith(evolutionRoot)).toBe(true);
    expect(fs.existsSync(path.join(candidate.workspace, "README.md"))).toBe(true);
    expect(await candidateHeadSha(candidate.workspace)).toBe(stable.sha);

    // Stable's own branch and HEAD are untouched.
    expect(await headSha(stable.root)).toBe(stableHeadBefore);
    expect(currentBranch(stable.root)).toBe("main");
    expect(candidate.layout.candidateBranch).not.toBe("main");

    // The Candidate can move its own HEAD without moving Stable's.
    write(candidate.workspace, "README.md", "# candidate\n");
    const candidateSha = await commitCandidate(candidate.workspace, "candidate change");
    expect(candidateSha).not.toBe(stable.sha);
    expect(await headSha(stable.root)).toBe(stableHeadBefore);
    expect(await candidateHeadSha(candidate.workspace)).toBe(candidateSha);
    expect(await candidateChangedFiles(candidate.workspace, stable.sha)).toEqual(["README.md"]);
    expect(await candidateIsDirty(candidate.workspace)).toBe(false);
  });

  it("freezes the base: a base that is not Stable's current HEAD is refused", async () => {
    const stable = gitRepo("boss-stable-repo-");
    const previous = stable.sha;
    write(stable.root, "next.txt", "next\n");
    commit(stable.root, "second");
    const evolutionRoot = tempDir("boss-evolution-");

    await expect(createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: previous, runId: RUN_ID })).rejects.toThrow(/unfrozen base/);
    // …unless the caller explicitly asks for a historical base.
    const allowed = await createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: previous, runId: RUN_ID, allowNonHeadBase: true });
    expect(allowed.baseSha).toBe(previous);
  });

  it("refuses a base that is not a commit, a duplicate run directory and a non-repository", async () => {
    const stable = gitRepo("boss-stable-repo-");
    const evolutionRoot = tempDir("boss-evolution-");
    await expect(createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: "f".repeat(40), runId: RUN_ID })).rejects.toThrow(CandidateWorkspaceError);
    await createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: stable.sha, runId: RUN_ID });
    await expect(createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: stable.sha, runId: RUN_ID })).rejects.toThrow(/already exists/);
    await expect(createCandidateWorkspace({ stableRoot: tempDir("boss-not-a-repo-"), evolutionRoot, baseSha: stable.sha, runId: "another-run" })).rejects.toThrow();
  });

  it("removes a Candidate workspace without damaging Stable", async () => {
    const stable = gitRepo("boss-stable-repo-");
    const evolutionRoot = tempDir("boss-evolution-");
    const candidate = await createCandidateWorkspace({ stableRoot: stable.root, evolutionRoot, baseSha: stable.sha, runId: RUN_ID });
    write(candidate.workspace, "extra.txt", "x\n");
    await removeCandidateWorkspace(candidate.workspace, stable.root);
    expect(fs.existsSync(candidate.workspace)).toBe(false);
    expect(await headSha(stable.root)).toBe(stable.sha);
    expect(currentBranch(stable.root)).toBe("main");
  });
});

describe("Candidate crash isolation (§8.4, RD-006, RT-18/RT-25)", () => {
  function supervisorFor() {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    return new CandidateSupervisor({ layout, timeoutMs: 5000 });
  }

  it("survives a thrown error and an async rejection in the task", async () => {
    const supervisor = supervisorFor();
    const thrown = await supervisor.supervise(() => { throw new Error("candidate blew up"); });
    expect(thrown.ok).toBe(false);
    expect(thrown.state).toBe("CRASHED");
    expect(thrown.error).toMatch(/candidate blew up/);
    expect(thrown.stableSurvived).toBe(true);

    const rejected = await supervisor.supervise(async () => { throw new Error("async rejection"); });
    expect(rejected.state).toBe("CRASHED");
    expect(rejected.stableSurvived).toBe(true);
  });

  it("survives a real candidate process crash: uncaught exception, forced kill and a bad config", async () => {
    const supervisor = supervisorFor();
    const crashed = await supervisor.supervise(async () => {
      // A genuinely separate process that dies with an uncaught exception.
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, ["-e", "setTimeout(() => { throw new Error('candidate process died'); }, 0)"], { windowsHide: true, timeout: 15000 }, (error) => (error ? reject(new Error(`candidate process crashed: ${error.code ?? error.message}`)) : resolve()));
      });
      return "unreachable";
    });
    expect(crashed.ok).toBe(false);
    expect(crashed.state).toBe("CRASHED");
    expect(crashed.stableSurvived).toBe(true);

    const killed = await supervisor.supervise(async () => {
      await new Promise<void>((_resolve, reject) => {
        execFile(process.execPath, ["-e", "process.exit(7)"], { windowsHide: true, timeout: 15000 }, (error) => reject(new Error(`forced kill exit code ${error?.code}`)));
      });
      return "unreachable";
    });
    expect(killed.state).toBe("CRASHED");

    const badConfig = await supervisor.supervise(async () => { JSON.parse("{ this is not config }"); return "unreachable"; });
    expect(badConfig.state).toBe("CRASHED");
    expect(badConfig.error).toMatch(/JSON/);
    // Stable can still run the next Candidate after all three.
    expect(supervisor.canStartNext()).toBe(true);
  });

  it("survives a forced kill / timeout and can start the next Candidate", async () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    const supervisor = new CandidateSupervisor({ layout, timeoutMs: 60 });
    const timedOut = await supervisor.supervise(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5000)));
    expect(timedOut.state).toBe("TIMED_OUT");
    expect(timedOut.stableSurvived).toBe(true);
    expect(supervisor.canStartNext()).toBe(true);

    // The next Candidate starts from a clean supervisor state on the same run.
    const next = await supervisor.supervise(async () => "recovered");
    expect(next.ok).toBe(true);
    expect(next.value).toBe("recovered");
    expect(next.journal.attempts).toBe(2);
  });

  it("does not let a stale lock from a killed Candidate wedge Stable", () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    fs.writeFileSync(path.join(layout.journal, "candidate.lock"), JSON.stringify({ pid: 999999, runId: RUN_ID }), "utf8");
    const supervisor = new CandidateSupervisor({ layout });
    expect(supervisor.recoverStaleLock()).toBe(true);
    expect(fs.existsSync(path.join(layout.journal, "candidate.lock"))).toBe(false);
    expect(supervisor.canStartNext()).toBe(true);
    expect(supervisor.state().error).toMatch(/recovered stale candidate lock/);
  });

  it("records corrupt runtime-data as a crash and keeps the journal readable", () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    write(layout.runtimeData, "broken.json", "not json");
    const supervisor = new CandidateSupervisor({ layout });
    const journal = supervisor.quarantineRuntime("stamp");
    expect(journal.state).toBe("CRASHED");
    expect(journal.quarantinedRuntimeData).toBeTruthy();
    expect(new CandidateSupervisor({ layout }).state().state).toBe("CRASHED");
  });

  it("aborts an in-flight Candidate on request and reports it as aborted", async () => {
    const layout = materializeEvolutionLayout(evolutionLayout(tempDir("boss-evolution-"), RUN_ID, "a".repeat(40)));
    const supervisor = new CandidateSupervisor({ layout, timeoutMs: 5000 });
    const pending = supervisor.supervise(({ signal }) => new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted by emergency control")));
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(supervisor.abort("emergency stop")).toBe(true);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.stableSurvived).toBe(true);
    expect(supervisor.canStartNext()).toBe(true);
  });

  it("never promotes: a completed Candidate is only COMPLETED", async () => {
    const supervisor = supervisorFor();
    const outcome = await supervisor.supervise(async ({ setState }) => { setState("VERIFYING"); return "done"; });
    expect(outcome.state).toBe("COMPLETED");
    expect(JSON.stringify(outcome)).not.toMatch(/PROMOTED/);
  });
});
