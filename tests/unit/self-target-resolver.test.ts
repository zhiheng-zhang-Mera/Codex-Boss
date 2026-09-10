import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SelfTargetResolver, normalizeRepositoryIdentity } from "../../electron/self-evolution/self-target-resolver";

/**
 * Phase S1 acceptance (Update-Plan/Alien-Prestart.md §5, SF-001/SF-002).
 *
 * The resolver must recognize the same repository through every alias a real
 * workspace uses — a junction, a symlink, a `..` path, a linked worktree — and
 * must refuse a stranger's repository that merely shares a directory name.
 *
 * The fixtures are real git repositories created on disk; nothing here is
 * mocked, because the whole point of S1 is that the answer comes from host
 * facts (realpath, git root, git remote, product marker) rather than a prompt.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-self-target-"));
const bossRepo = path.join(root, "stable", "Codex-Boss");
const aliasJunction = path.join(root, "Boss");
const strangerRepo = path.join(root, "stranger", "Codex-Boss");
const siblingRepo = path.join(root, "sibling-repo");

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, windowsHide: true, stdio: "ignore" });
}

function initRepo(directory: string, name: string, remote: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0" }, null, 2), "utf8");
  fs.writeFileSync(path.join(directory, "README.md"), `# ${name}\n`, "utf8");
  git(directory, ["init", "-q", "-b", "main"]);
  git(directory, ["config", "user.email", "fixture@example.test"]);
  git(directory, ["config", "user.name", "Fixture"]);
  git(directory, ["remote", "add", "origin", remote]);
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "-q", "-m", "fixture"]);
}

let resolver: SelfTargetResolver;

beforeAll(() => {
  initRepo(bossRepo, "codex-boss", "https://github.com/zhiheng-zhang-Mera/Codex-Boss.git");
  // A stranger's repository that deliberately shares the product directory name.
  initRepo(strangerRepo, "codex-boss", "https://github.com/someone-else/Codex-Boss.git");
  // A completely unrelated repository.
  initRepo(siblingRepo, "some-other-project", "https://github.com/someone-else/other.git");
  // Alias: a junction named exactly like the product directory name.
  try {
    fs.symlinkSync(bossRepo, aliasJunction, "junction");
  } catch {
    // Junction creation can fail on hardened hosts; the remaining aliases still apply.
  }
  resolver = new SelfTargetResolver({
    stableRoot: bossRepo,
    productRepository: "zhiheng-zhang-Mera/Codex-Boss"
  });
});

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows may hold a handle briefly; the temp root is disposable.
  }
});

describe("SF-001 self repo factually recognized", () => {
  it("recognizes the installation root itself", () => {
    const resolution = resolver.resolve(bossRepo);
    expect(resolution.isSelf).toBe(true);
    expect(resolution.stableRoot?.toLowerCase()).toBe(fs.realpathSync(bossRepo).toLowerCase());
    expect(resolution.stableHeadSha).toMatch(/^[0-9a-f]{40}$/);
    expect(resolution.evidence.signals).toContain("canonical-git-root");
    expect(resolution.evidence.repositoryMatches).toBe(true);
    expect(resolution.evidence.productMarker).toBe("codex-boss");
  });

  it("recognizes a subdirectory of the installation", () => {
    expect(resolver.resolve(path.join(bossRepo, "electron", "self-evolution")).isSelf).toBe(true);
  });

  it("recognizes a `..`-laden path that normalizes back into the repository", () => {
    const convoluted = path.join(bossRepo, "electron", "..", "..", bossRepo.split(path.sep).pop()!);
    expect(resolver.resolve(convoluted).isSelf).toBe(true);
  });

  it("recognizes a junction alias by its canonical target, not its name", () => {
    if (!fs.existsSync(aliasJunction)) return;
    const resolution = resolver.resolve(aliasJunction);
    expect(resolution.isSelf).toBe(true);
    expect(resolution.evidence.signals.some((signal) => signal === "canonical-git-root" || signal === "shared-git-common-dir")).toBe(true);
  });

  it("recognizes a linked git worktree as the same repository", () => {
    const worktree = path.join(root, "worktrees", "candidate-1");
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    git(bossRepo, ["worktree", "add", "--detach", worktree, "HEAD"]);
    try {
      const resolution = resolver.resolve(worktree);
      expect(resolution.isSelf).toBe(true);
      expect(resolution.evidence.commonDirectoryMatches).toBe(true);
      expect(resolution.evidence.signals).toContain("shared-git-common-dir");
    } finally {
      git(bossRepo, ["worktree", "remove", "--force", worktree]);
    }
  });
});

describe("SF-002 false-positive self repo rejected", () => {
  it("rejects a stranger's repository that shares the product directory name", () => {
    const resolution = resolver.resolve(strangerRepo);
    expect(resolution.isSelf).toBe(false);
    expect(resolution.evidence.productNameMatches).toBe(true);
    expect(resolution.evidence.repositoryMatches).toBe(false);
    expect(resolution.reason).toMatch(/not the Boss installation/);
  });

  it("rejects an unrelated repository", () => {
    expect(resolver.resolve(siblingRepo).isSelf).toBe(false);
  });

  it("rejects a plain directory that is not a repository", () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain, { recursive: true });
    expect(resolver.resolve(plain).isSelf).toBe(false);
  });

  it("does not accept a matching remote without the product marker", () => {
    const impostor = path.join(root, "impostor");
    initRepo(impostor, "not-codex-boss", "git@github.com:zhiheng-zhang-Mera/Codex-Boss.git");
    const resolution = resolver.resolve(impostor);
    expect(resolution.evidence.repositoryMatches).toBe(true);
    expect(resolution.evidence.productNameMatches).toBe(false);
    expect(resolution.isSelf).toBe(false);
  });
});

describe("dependency-injected resolver contract", () => {
  it("never relies on the directory name alone", () => {
    const injectedRoot = path.join(root, "injected", "Boss");
    const injectedSub = path.join(injectedRoot, "sub");
    fs.mkdirSync(injectedSub, { recursive: true });
    const blind = new SelfTargetResolver({
      stableRoot: injectedRoot,
      productRepository: "zhiheng-zhang-Mera/Codex-Boss",
      gitRunner: (cwd) => (cwd.toLowerCase().startsWith(injectedRoot.toLowerCase()) ? injectedRoot : undefined),
      readFile: () => JSON.stringify({ name: "codex-boss" }),
      canonicalize: (value) => value,
      headOf: () => "a".repeat(40)
    });
    expect(blind.resolve(injectedSub).isSelf).toBe(true);
    // Same directory name, different repository: rejected.
    expect(blind.resolve(path.join(root, "elsewhere", "Boss")).isSelf).toBe(false);
  });

  it("normalizes repository identities from every remote form", () => {
    expect(normalizeRepositoryIdentity("https://github.com/zhiheng-zhang-Mera/Codex-Boss.git")).toBe("zhiheng-zhang-mera/codex-boss");
    expect(normalizeRepositoryIdentity("git@github.com:zhiheng-zhang-Mera/Codex-Boss.git")).toBe("zhiheng-zhang-mera/codex-boss");
    expect(normalizeRepositoryIdentity("ssh://git@github.com/zhiheng-zhang-Mera/Codex-Boss")).toBe("zhiheng-zhang-mera/codex-boss");
    expect(normalizeRepositoryIdentity("")).toBeUndefined();
    expect(normalizeRepositoryIdentity(undefined)).toBeUndefined();
  });
});
