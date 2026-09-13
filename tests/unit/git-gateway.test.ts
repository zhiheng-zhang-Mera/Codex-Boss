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

  it("is the only place the engineering modules spawn git", () => {
    // The rule the phase exists to establish: a module that needs git asks the
    // gateway. The remaining direct spawns are listed by name — a shrinking debt
    // list, not a blanket exemption — and adding a new one fails here.
    const engineering = path.join(process.cwd(), "electron", "engineering");
    // The remaining direct spawns, by name. `acceptance-session.ts`,
    // `autonomous-evolution-*.ts` and `native-tools.ts` are Root Trust Surface, so
    // migrating them is a separate, epoch-carrying change; the rest move as the
    // gateway gains the shapes they need. Adding an unlisted one fails here.
    const declaredDebt = new Set([
      "acceptance-session.ts",
      "autonomous-evolution-identity.ts",
      "autonomous-evolution-runner.ts",
      "native-tools.ts",
      "candidate-guardian.ts",
      "git-checkpoint.ts",
      "release-runner.ts",
      "soak-runner.ts",
      "world-model.ts"
    ]);
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(engineering, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const text = fs.readFileSync(path.join(engineering, entry.name), "utf8");
      if (!/execFile\(\s*["']git["']|execFileSync\(\s*["']git["']|spawnSync\(\s*["']git["']|spawn\(\s*["']git["']/.test(text)) continue;
      if (declaredDebt.has(entry.name)) continue;
      offenders.push(entry.name);
    }
    expect(offenders).toEqual([]);
  });
});
