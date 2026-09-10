import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Real-fixture helpers for the Root Defense acceptance batteries
 * (Isolation-Finalization.md §14 note: "测试本身不能通过修改 production guard 来
 * 特殊识别 fixture 然后装作安全"). Everything here builds genuine filesystem and
 * git state; no production module is aware that a test exists.
 */

const created: string[] = [];

/** Creates a temp directory tracked for cleanup by `cleanupFixtures()`. */
export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupFixtures(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Writes a file, creating parents. */
export function write(root: string, relative: string, content: string): string {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/** The CODEOWNERS boundary as the repository actually ships it. */
export const CODEOWNERS_FIXTURE = [
  "# fixture mirroring .github/CODEOWNERS",
  "/.github/CODEOWNERS @owner",
  "/.github/workflows/ @owner",
  "/package.json @owner",
  "/tsconfig.json @owner",
  "/vitest.config.* @owner",
  "/package.json @owner",
  "/.codex-boss/root/ @owner",
  "/electron/root-authority/ @owner",
  "/src/**/root-authority/ @owner",
  "/electron/credential-boundary/ @owner",
  "/electron/stable-candidate/ @owner",
  "/electron/promotion-gate/ @owner",
  "/electron/emergency-control/ @owner",
  "/electron/root-recovery/ @owner",
  "/tests/**/root-authority*.test.* @owner",
  "/tests/**/stable-candidate*.test.* @owner"
].join("\n");

/** A workspace shaped like the repository (CODEOWNERS + ordinary source). */
export function fixtureWorkspace(prefix = "boss-fixture-"): string {
  const root = tempDir(prefix);
  write(root, ".github/CODEOWNERS", CODEOWNERS_FIXTURE);
  write(root, "package.json", "{ \"name\": \"fixture\" }\n");
  write(root, "src/app/main.ts", "export const main = 1;\n");
  return root;
}

/** A real git repository with one commit; returns its root and HEAD SHA. */
export function gitRepo(prefix = "boss-git-"): { root: string; sha: string } {
  const root = tempDir(prefix);
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString().trim();
  git(["init", "-b", "main"]);
  git(["config", "user.email", "fixture@codex-boss.local"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "commit.gpgsign", "false"]);
  write(root, "README.md", "# fixture\n");
  git(["add", "-A"]);
  git(["commit", "-m", "initial"]);
  return { root, sha: git(["rev-parse", "HEAD"]) };
}

/** Commits the current working tree of a repository and returns the new SHA. */
export function commit(repoRoot: string, message: string): string {
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" }).toString().trim();
  git(["add", "-A"]);
  git(["-c", "user.email=fixture@codex-boss.local", "-c", "user.name=Fixture", "commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

export function revParse(repoRoot: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: repoRoot, stdio: "pipe" }).toString().trim();
}

/** Current branch name of a repository, or a detached marker. */
export function currentBranch(repoRoot: string): string {
  return execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, stdio: "pipe" }).toString().trim();
}

/**
 * Creates a directory junction (Windows) or symlink (POSIX) so escape tests use
 * a real filesystem link rather than a simulated one.
 */
export function linkDirectory(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/** A path outside any workspace, for ledger/checkpoint/control files. */
export function stateFile(name = "state.json"): string {
  return path.join(tempDir("boss-state-"), name);
}
