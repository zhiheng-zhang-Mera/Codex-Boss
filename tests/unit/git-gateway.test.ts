import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GIT_MAX_BUFFER_BYTES,
  GIT_TIMEOUT_MS,
  runGit,
  runGitOrThrow,
  runGitSync
} from "../../electron/git/git-gateway";

/**
 * Convergence book, Phase M — one git entry point.
 *
 * The gateway is exercised against a real repository: a status read, a failing
 * command, a sync read and the throwing form. What it must establish is that a
 * failure is never silently a success, and that the timeout/buffer a call site
 * gets is the one it asked for rather than a library default.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-git-gateway-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function initRepo(): string {
  const dir = makeTree();
  const git = runGitSync(dir, ["init"]);
  if (!git.ok) throw new Error(`git init failed: ${git.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  runGitSync(dir, ["add", "."]);
  runGitSync(dir, ["-c", "user.name=T", "-c", "user.email=t@e.invalid", "commit", "-m", "baseline"]);
  return dir;
}

/**
 * A direct git spawn: the process helpers called with a git command, either the
 * literal binary or a field that holds one. Deliberately not a blanket
 * `child_process` check — a module may legitimately run a compiler or `taskkill`.
 */
const DIRECT_GIT_SPAWN = /(?:execFile|execFileSync|spawnSync|spawn)\(\s*(?:"git"|'git'|this\.gitExec|gitExec|this\.git\b)/;

/**
 * Every file that spawns git directly today, with the reason it has not moved.
 *
 * Only the Root Trust Surface three are left: moving any of them changes a file the
 * trust epoch anchors, so each move is its own epoch-carrying change rather than part
 * of a refactor. Everything else in the application now asks the gateway.
 */
const DECLARED_GIT_DEBT: Record<string, string> = {
  "electron/engineering/acceptance-session.ts": "Root Trust Surface: its move carries a trust-epoch advance",
  "electron/engineering/autonomous-evolution-identity.ts": "Root Trust Surface: its move carries a trust-epoch advance",
  "electron/engineering/autonomous-evolution-runner.ts": "Root Trust Surface: its move carries a trust-epoch advance"
};

/** The modules Phase M has already moved onto the gateway. */
const MIGRATED_TO_GATEWAY = [
  "electron/engineering/git-checkpoint.ts",
  "electron/engineering/soak-runner.ts",
  "electron/engineering/world-model.ts",
  "electron/engineering/candidate-guardian.ts",
  "electron/engineering/release-runner.ts",
  "electron/engineering/native-tools.ts",
  "electron/host/host-probes.ts",
  "electron/host/doctor.ts",
  "electron/host/sentinel-capture.ts",
  "electron/self-evolution/self-target-resolver.ts",
  "electron/repro-snapshot.ts",
  "electron/root-recovery/rollback-controller.ts",
  "electron/self-evolution/self-evolution-host.ts",
  "electron/self-evolution/self-evolution-coordinator.ts",
  "electron/stable-candidate/workspace-manager.ts",
  "electron/input/github-resolver.ts",
  "electron/promotion-gate/github-promotion-adapter.ts"
];

function repoFile(relative: string): string {
  return path.join(process.cwd(), ...relative.split("/"));
}

function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("Phase M — the git gateway", () => {
  it("reports a successful read as ok with its stdout", async () => {
    const repo = initRepo();
    const head = await runGit(repo, ["rev-parse", "HEAD"]);
    expect(head.ok).toBe(true);
    expect(head.code).toBe(0);
    expect(head.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("never throws on a failing command: the caller gets the code and stderr", async () => {
    const repo = initRepo();
    const bad = await runGit(repo, ["rev-parse", "definitely-not-a-ref"]);
    expect(bad.ok).toBe(false);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr.length).toBeGreaterThan(0);
  });

  it("reports a failure with git's own stderr rather than an empty answer", async () => {
    const repo = initRepo();
    const result = await runGit(repo, ["rev-parse", "definitely-not-a-ref"]);
    expect(result.ok).toBe(false);
    // `rev-parse` echoes the argument it could not resolve on stdout; what matters
    // is that the refusal is visible and the reason is on stderr.
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("runGitOrThrow carries git's own stderr into the error", async () => {
    const repo = initRepo();
    await expect(runGitOrThrow(repo, ["rev-parse", "definitely-not-a-ref"])).rejects.toThrow(/definitely-not-a-ref|unknown revision|ambiguous/i);
    expect(await runGitOrThrow(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toMatch(/^(main|master)$/);
  });

  it("agrees with its synchronous form", async () => {
    const repo = initRepo();
    const sync = runGitSync(repo, ["rev-parse", "HEAD"]);
    const async_ = await runGit(repo, ["rev-parse", "HEAD"]);
    expect(sync.ok).toBe(true);
    expect(sync.stdout).toBe(async_.stdout);
  });

  it("states its bands, so a call site chooses the operation's bound", () => {
    // A read against a warm repository, a normal operation, and a network/disk
    // bound operation are three different questions.
    expect(GIT_TIMEOUT_MS.quick).toBeLessThan(GIT_TIMEOUT_MS.standard);
    expect(GIT_TIMEOUT_MS.standard).toBeLessThan(GIT_TIMEOUT_MS.large);
    expect(GIT_MAX_BUFFER_BYTES.small).toBeLessThan(GIT_MAX_BUFFER_BYTES.standard);
    expect(GIT_MAX_BUFFER_BYTES.standard).toBeLessThan(GIT_MAX_BUFFER_BYTES.large);
  });

  it("runs the binary it was given, and calls a missing one a launch failure", async () => {
    // `gitBinary` exists so a caller with its own executable (a bundled git, a test
    // double) still goes through the gateway. Pointing it at nothing must be reported
    // as "never ran" rather than as an empty successful read.
    const repo = initRepo();
    const missing = await runGit(repo, ["rev-parse", "HEAD"], { gitBinary: "definitely-not-a-real-git-binary" });
    expect(missing.ok).toBe(false);
    expect(missing.spawnError).toBeTruthy();
  });

  it("passes the environment through, which is how a credential reaches git", async () => {
    // The promotion adapter hands git a token through GIT_CONFIG_* rather than argv,
    // so the secret never appears in a process listing. That only works if the
    // gateway really passes `env` to the child, so this asserts it through the same
    // mechanism instead of a proxy for it.
    const repo = initRepo();
    const result = await runGit(repo, ["config", "--get", "boss.gateway"], {
      env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "boss.gateway", GIT_CONFIG_VALUE_0: "from-the-environment" }
    });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("from-the-environment");
  });

  it("is the only place the application spawns git", () => {
    // The rule the phase exists to establish: a module that needs git asks the
    // gateway. The remaining direct spawns are named with the reason each has not
    // moved — a shrinking debt list, not a blanket exemption — so adding a new one
    // anywhere under electron/ fails here.
    const gateway = path.join("electron", "git", "git-gateway.ts").split(path.sep).join("/");
    const offenders: string[] = [];
    for (const full of sourceFilesUnder(path.join(process.cwd(), "electron"))) {
      const relative = path.relative(process.cwd(), full).split(path.sep).join("/");
      if (relative === gateway) continue;
      if (!DIRECT_GIT_SPAWN.test(fs.readFileSync(full, "utf8"))) continue;
      if (relative in DECLARED_GIT_DEBT) continue;
      offenders.push(relative);
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("keeps the debt list honest, so a migrated module cannot stay on it", () => {
    // Without this, the list would accrete entries nobody removes and would slowly
    // stop describing the repository.
    const stale = Object.keys(DECLARED_GIT_DEBT)
      .filter((relative) => !DIRECT_GIT_SPAWN.test(fs.readFileSync(repoFile(relative), "utf8")))
      .sort();
    expect(stale).toEqual([]);
  });

  it("is what the migrated modules actually reach for", () => {
    expect(MIGRATED_TO_GATEWAY.length).toBeGreaterThan(0);
    for (const relative of MIGRATED_TO_GATEWAY) {
      const text = fs.readFileSync(repoFile(relative), "utf8");
      expect(text, `${relative} should route through the gateway`).toContain("git/git-gateway");
    }
  });
});
