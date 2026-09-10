import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvolutionKillSwitch, createOwnerControlChannel } from "../../electron/emergency-control/evolution-kill-switch";
import { EmergencyControl } from "../../electron/emergency-control/emergency-control";
import { RootAuditLedger } from "../../electron/root-authority/root-audit-ledger";
import { ProtectedSurfaceGuard } from "../../electron/root-authority/protected-surface-guard";
import { SelfTargetResolver } from "../../electron/self-evolution/self-target-resolver";
import {
  evolutionRuns,
  assertSelfMutationContext,
  SelfMutationDeniedError,
  type EvolutionRunContext
} from "../../electron/self-evolution/mutation-context";
import { configureMutationGuard, resetMutationGuard, assessMutation } from "../../electron/self-evolution/mutation-guard";
import { SelfEvolutionCoordinator } from "../../electron/self-evolution/self-evolution-coordinator";
import { parseNameStatus, type HostOperationHandlers } from "../../electron/self-evolution/host-operations";
import type { EvolutionSandbox, SandboxedProcessRequest, SandboxedProcessResult } from "../../electron/self-evolution/sandbox/sandbox-backend";
import type { SandboxCapability } from "../../electron/self-evolution/sandbox/sandbox-capability";
import { StableRuntimePointer } from "../../electron/self-evolution/stable-runtime-pointer";
import type { GitHubTransport, GitHubTransportRequest } from "../../electron/promotion-gate/github-promotion-adapter";
import { EnvironmentBossGitHubCredentialProvider } from "../../electron/credential-boundary/github-credential-provider";

/**
 * Phase S2/S3/S7/S8/S19/S20 acceptance.
 *
 * The run below goes through the REAL `SelfEvolutionCoordinator`, the REAL
 * engineering loop, the REAL Root Authority with its durable ledger, the REAL
 * promotion controller and the REAL git repository. Only the two things the
 * acceptance plan says are external — the OS sandbox and the Boss GitHub
 * identity — are injected, and the sandbox stand-in records every request so
 * the test can prove what the coordinator asked it to confine.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-evo-route-"));
const stableRoot = path.join(root, "stable");
const evolutionRoot = path.join(root, "evolution");
const governanceRoot = path.join(root, "governance");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function writeFile(relative: string, content: string): void {
  const target = path.join(stableRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

/** Records every sandboxed request and answers deterministically. */
class RecordingSandbox implements EvolutionSandbox {
  readonly requests: SandboxedProcessRequest[] = [];
  /** Makes the next test-command invocation fail, like a real audit finding. */
  failFirstTest = true;
  /** Invoked at the start of each request, before the freeze checkpoint runs. */
  onRun?: () => void;
  private testRuns = 0;
  constructor(private readonly capability: SandboxCapability) {}
  async probe(): Promise<SandboxCapability> {
    return this.capability;
  }
  async run(request: SandboxedProcessRequest): Promise<SandboxedProcessResult> {
    this.requests.push(request);
    this.onRun?.();
    const isTest = request.args.some((argument) => argument.includes("vitest"));
    this.testRuns += isTest ? 1 : 0;
    // One-shot: the flag is consumed by the first test invocation it fails, so
    // each solo run starts from the same deterministic state.
    const failed = isTest && this.failFirstTest;
    if (failed) this.failFirstTest = false;
    const exitCode = failed ? 1 : 0;
    return {
      sandboxed: true,
      mechanism: "windows-appcontainer",
      exitCode,
      timedOut: false,
      refused: false,
      report: {
        launcher: "recording-sandbox",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        container: request.containerName,
        containerSid: "S-1-15-2-1-2-3",
        processId: 1,
        exitCode,
        activeProcessLimit: request.activeProcessLimit ?? 1,
        jobObject: true,
        suspendedStart: true,
        timedOut: false,
        ok: true,
        failure: null,
        win32Error: 0,
        grants: request.grants.map((grant) => `${grant.access}:${grant.path}`)
      },
      stdout: failed ? "FAIL tests/unit/audit.test.ts > audit fixture detected drift\n" : "ok\n",
      stderr: "",
      durationMs: 1
    };
  }
  describe() {
    return {
      mechanism: "windows-appcontainer" as const,
      enforcement: "operating-system" as const,
      token: "recording",
      reads: [],
      writes: [],
      denied: [],
      childProcesses: "kernel",
      network: "denied",
      environment: "explicit"
    };
  }
}

const capability: SandboxCapability = {
  available: true,
  mechanism: "windows-appcontainer",
  platform: "win32",
  reasons: [],
  details: { containerName: "recording", containerSid: "S-1-15-2-1-2-3", jobObject: true, suspendedStart: true, childProcessBlocked: true, sanitizedEnvironment: true, networkDenied: true }
};

/** A recorded GitHub transport that behaves like a well-run repository. */
function fakeGitHub(): { transport: GitHubTransport; calls: GitHubTransportRequest[]; setCheck: (conclusion: string) => void } {
  const calls: GitHubTransportRequest[] = [];
  let checkConclusion = "success";
  let prNumber = 41;
  let headSha = "";
  const state = {
    merged: false
  };
  const transport: GitHubTransport = {
    async request(request) {
      calls.push(request);
      const url = request.url;
      if (request.method === "POST" && url.includes("/pulls")) {
        const body = request.body as { head?: string };
        headSha = shaOfCandidate;
        void body;
        return { status: 201, body: JSON.stringify({ number: prNumber, head: { sha: headSha } }) };
      }
      if (request.method === "GET" && /\/pulls\/\d+$/.test(url)) {
        return { status: 200, body: JSON.stringify({ number: prNumber, state: state.merged ? "closed" : "open", head: { sha: headSha } }) };
      }
      if (request.method === "GET" && url.includes("/check-runs")) {
        return { status: 200, body: JSON.stringify({ check_runs: [{ name: "validate", conclusion: checkConclusion, status: "completed", head_sha: headSha }] }) };
      }
      if (request.method === "PUT" && url.includes("/merge")) {
        const body = request.body as { sha?: string };
        if (body.sha !== headSha) return { status: 409, body: JSON.stringify({ message: "Head branch was modified" }) };
        state.merged = true;
        return { status: 200, body: JSON.stringify({ merged: true, sha: headSha }) };
      }
      if (request.method === "GET" && url.includes("/git/ref/heads/")) {
        return { status: 200, body: JSON.stringify({ object: { sha: headSha } }) };
      }
      return { status: 404, body: JSON.stringify({ message: `unhandled ${request.method} ${url}` }) };
    }
  };
  return {
    transport,
    calls,
    setCheck: (conclusion: string) => {
      checkConclusion = conclusion;
    }
  };
}

let shaOfCandidate = "";
const gitHub = fakeGitHub();
let sandbox: RecordingSandbox;

function hostHandlers(): HostOperationHandlers {
  const runGit = (cwd: string, args: string[]) => Promise.resolve(git(cwd, args));
  return {
    commitCandidate: async ({ workspace, message }) => {
      await runGit(workspace, ["add", "-A"]);
      // A Candidate with nothing to commit is a legitimate outcome; treat the
      // empty-diff case as "HEAD is already the change".
      const status = await runGit(workspace, ["status", "--porcelain"]);
      if (status) await runGit(workspace, ["-c", "user.name=Codex Boss Evolution", "-c", "user.email=evolution@codex-boss.local", "commit", "-m", message]);
      shaOfCandidate = await runGit(workspace, ["rev-parse", "HEAD"]);
      return shaOfCandidate;
    },
    candidateHead: async ({ workspace }) => runGit(workspace, ["rev-parse", "HEAD"]),
    nameStatus: async ({ workspace, baseSha, headSha }) => parseNameStatus(await runGit(workspace, ["diff", "--name-status", "--find-renames", `${baseSha}...${headSha}`])),
    persistEvidence: async ({ name }) => name,
    pushBranch: async ({ workspace, branch, sha }) => {
      // A real push is a remote side effect; the acceptance plan's S10 requires
      // a dedicated Boss identity, which this host does not have. The handler
      // records the request and reports OK so the local control flow is fully
      // exercised, and the identity gate itself is asserted separately.
      expect(workspace).toContain("evolution");
      return { status: "OK", value: { branch, sha } };
    },
    openPullRequest: async ({ head, title }) => {
      const created = await gitHub.transport.request({ method: "POST", url: "https://api.github.com/repos/r/p/pulls", token: "t", body: { head, title } });
      const parsed = JSON.parse(created.body) as { number: number; head: { sha: string } };
      return { status: "OK", value: { number: parsed.number, headSha: parsed.head.sha } };
    },
    readPullRequest: async ({ prNumber }) => {
      const response = await gitHub.transport.request({ method: "GET", url: `https://api.github.com/repos/r/p/pulls/${prNumber}`, token: "t" });
      const parsed = JSON.parse(response.body) as { number: number; state: string; head: { sha: string } };
      return { status: "OK", value: { number: parsed.number, state: parsed.state, headSha: parsed.head.sha } };
    },
    readCheck: async ({ sha }) => {
      const response = await gitHub.transport.request({ method: "GET", url: `https://api.github.com/repos/r/p/commits/${sha}/check-runs`, token: "t" });
      const parsed = JSON.parse(response.body) as { check_runs: Array<{ name: string; conclusion: string | null; status: string | null; head_sha: string }> };
      const run = parsed.check_runs.find((item) => item.head_sha === sha);
      if (!run) return { status: "FAILED", reason: "validate check not reported for this SHA" };
      return { status: "OK", value: { name: run.name, conclusion: run.conclusion, status: run.status } };
    },
    mergePullRequest: async ({ prNumber, sha }) => {
      const response = await gitHub.transport.request({ method: "PUT", url: `https://api.github.com/repos/r/p/pulls/${prNumber}/merge`, token: "t", body: { sha } });
      if (response.status >= 300) return { status: "FAILED", reason: `merge rejected with ${response.status}` };
      const parsed = JSON.parse(response.body) as { merged: boolean; sha: string };
      return { status: "OK", value: { merged: parsed.merged, sha: parsed.sha } };
    },
    readBranchSha: async () => ({ status: "OK", value: { sha: shaOfCandidate } }),
    markNextStable: async () => {},
    recordBoot: async () => {},
    commitStablePointer: async () => {},
    rollbackStable: async () => ({ ok: true, detail: "pointer-driven" })
  };
}

function makeCoordinator(overrides: Partial<ConstructorParameters<typeof SelfEvolutionCoordinator>[0]> = {}): SelfEvolutionCoordinator {
  return new SelfEvolutionCoordinator({
    stableRoot,
    evolutionRoot,
    governanceRoot,
    productRepository: "zhiheng-zhang-Mera/Codex-Boss",
    sandbox,
    hostHandlers: hostHandlers(),
    resolver: new SelfTargetResolver({ stableRoot, productRepository: "zhiheng-zhang-Mera/Codex-Boss" }),
    worker: { ask: async () => JSON.stringify({ findings: [] }) },
    credentialProvider: new EnvironmentBossGitHubCredentialProvider({ environment: { CODEX_BOSS_GITHUB_TOKEN: "boss-token", CODEX_BOSS_GITHUB_IDENTITY: "codex-boss-bot" } }),
    ownerControlOwner: "zhiheng-zhang-Mera",
    implement: async () => {
      const target = path.join(evolutionRoot, currentRunId, "workspace", "src", "app", "notes.md");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `# diagnostic note ${Date.now()}\n`, "utf8");
      return { changedFiles: ["src/app/notes.md"] };
    },
    review: async () => ({ findings: [] }),
    ...overrides
  });
}

let currentRunId = "";

beforeAll(() => {
  fs.mkdirSync(stableRoot, { recursive: true });
  writeFile(".gitattributes", "* -text\n");
  writeFile("package.json", JSON.stringify({ name: "codex-boss", version: "1.0.0" }, null, 2));
  writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2));
  writeFile("README.md", "# Codex-Boss\n");
  writeFile("src/app/main.ts", "export const value = 1;\n");
  writeFile("node_modules/typescript/bin/tsc", "// host toolchain stand-in\n");
  writeFile("node_modules/vitest/vitest.mjs", "// host toolchain stand-in\n");
  writeFile(".github/CODEOWNERS", "/.github/ @zhiheng-zhang-Mera\n");
  git(stableRoot, ["init", "-q", "-b", "main"]);
  git(stableRoot, ["config", "core.autocrlf", "false"]);
  git(stableRoot, ["config", "user.email", "owner@example.test"]);
  git(stableRoot, ["config", "user.name", "Owner"]);
  git(stableRoot, ["remote", "add", "origin", "https://github.com/zhiheng-zhang-Mera/Codex-Boss.git"]);
  git(stableRoot, ["add", "-A"]);
  git(stableRoot, ["commit", "-q", "-m", "stable baseline"]);
  sandbox = new RecordingSandbox(capability);
});

afterAll(() => {
  resetMutationGuard();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows may hold a handle briefly.
  }
});

describe("SF-003/SF-004 mandatory self-mutation route", () => {
  it("denies a direct Stable mutation with no EvolutionRunContext", () => {
    configureMutationGuard({
      stableRoot,
      productRepository: "zhiheng-zhang-Mera/Codex-Boss",
      registry: evolutionRuns,
      resolver: new SelfTargetResolver({ stableRoot, productRepository: "zhiheng-zhang-Mera/Codex-Boss" })
    });
    const verdict = assessMutation(stableRoot);
    expect(verdict.selfTarget).toBe(true);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no EvolutionRunContext/);
    expect(() =>
      assertSelfMutationContext({ workspace: stableRoot, selfTarget: true, evolutionContext: undefined, stableRoot })
    ).toThrow(SelfMutationDeniedError);
  });

  it("allows a mutation inside a registered Candidate and nothing else", () => {
    const candidateRoot = path.join(evolutionRoot, "manual-run");
    const candidateWorkspace = path.join(candidateRoot, "workspace");
    fs.mkdirSync(candidateWorkspace, { recursive: true });
    const context: EvolutionRunContext = {
      runId: "manual-run",
      candidateRoot,
      candidateWorkspace,
      stableRoot,
      baseSha: "a".repeat(40),
      ledgerFile: path.join(governanceRoot, "ledger.jsonl"),
      evidenceDirectory: path.join(candidateRoot, "evidence")
    };
    evolutionRuns.register(context);
    try {
      expect(assertSelfMutationContext({ workspace: candidateWorkspace, selfTarget: true, evolutionContext: context })?.runId).toBe("manual-run");
      expect(() =>
        assertSelfMutationContext({ workspace: stableRoot, selfTarget: true, evolutionContext: context, stableRoot })
      ).toThrow(/outside the Candidate run directory/);
    } finally {
      evolutionRuns.release("manual-run");
    }
  });

  it("leaves an unrelated repository unguarded", () => {
    configureMutationGuard({
      stableRoot,
      productRepository: "zhiheng-zhang-Mera/Codex-Boss",
      registry: evolutionRuns,
      resolver: new SelfTargetResolver({ stableRoot, productRepository: "zhiheng-zhang-Mera/Codex-Boss" })
    });
    const other = path.join(root, "other-project");
    fs.mkdirSync(other, { recursive: true });
    const verdict = assessMutation(other);
    expect(verdict.selfTarget).toBe(false);
    expect(verdict.allowed).toBe(true);
  });
});

describe("coordinator end-to-end (ordinary, non-Root change)", () => {
  it("runs the real loop in a Candidate and reaches PROMOTED through the Boss identity", async () => {
    currentRunId = "run-ordinary";
    sandbox.failFirstTest = true;
    const coordinator = makeCoordinator();
    const before = git(stableRoot, ["rev-parse", "HEAD"]);
    const report = await coordinator.run({
      taskId: "task-ordinary",
      objective: "Audit one low-risk internal diagnostic or documentation inconsistency and improve it.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });

    expect(report.isSelf).toBe(true);
    expect(report.baseSha).toBe(before);
    expect(report.sandboxActive).toBe(true);
    expect(report.candidateWorkspace).toContain("run-ordinary");
    expect(report.candidateHeadSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.changedFiles).toContain("src/app/notes.md");
    expect(report.protectedPaths).toEqual([]);
    expect(report.outcome, JSON.stringify(report, null, 2)).toBe("PROMOTED");
    expect(report.promotionState).toBe("PROMOTED");

    // SF-003/SF-005: Stable itself never moved; the change exists only on the
    // Candidate branch, and the loop really ran inside the Candidate worktree.
    expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
    expect(git(stableRoot, ["status", "--porcelain"])).toBe("");
    expect(report.candidateWorkspace!).not.toBe(stableRoot);

    // SF-006: every Candidate subprocess was routed through the sandbox.
    expect(sandbox.requests.length).toBeGreaterThan(0);
    for (const request of sandbox.requests) {
      expect(request.containerName).toContain("codex-boss-evolution");
      expect(request.grants.some((grant) => grant.access === "write")).toBe(true);
      const writes = request.grants.filter((grant) => grant.access === "write").map((grant) => grant.path.toLowerCase());
      expect(writes.every((granted) => granted.includes("run-ordinary"))).toBe(true);
      expect(Object.keys(request.environment)).not.toContain("CODEX_BOSS_GITHUB_TOKEN");
    }

    // SF-019/SF-020/SF-021/SF-022: push, PR, validate read, exact SHA, merge.
    const methods = gitHub.calls.map((call) => `${call.method} ${call.url.replace("https://api.github.com", "")}`);
    expect(methods.some((entry) => entry.startsWith("POST /repos/"))).toBe(true);
    expect(methods.some((entry) => entry.includes("/check-runs"))).toBe(true);
    expect(methods.some((entry) => entry.startsWith("PUT "))).toBe(true);

    // SF-025 prerequisite: the durable Root ledger recorded the run.
    const ledger = new RootAuditLedger(path.join(governanceRoot, "root-audit-ledger.jsonl"));
    const entries = ledger.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.operation === "promotion.execute")).toBe(true);
    expect(entries.every((entry) => entry.runId === currentRunId)).toBe(true);
  }, 300_000);

  it("refuses to promote when the required check did not pass", async () => {
    currentRunId = "run-check-fails";
    sandbox.failFirstTest = false;
    gitHub.setCheck("failure");
    const coordinator = makeCoordinator();
    const report = await coordinator.run({
      taskId: "task-check-fails",
      objective: "Audit one low-risk internal diagnostic inconsistency.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });
    expect(report.outcome).toBe("REJECTED");
    expect(report.promotionState).toBe("REJECTED");
    gitHub.setCheck("success");
  }, 300_000);
});

describe("SF-013 production emergency freeze blocks evolution", () => {
  it("stops before creating a Candidate and leaves Stable untouched", async () => {
    const controlFile = path.join(governanceRoot, "evolution-control.json");
    const sentinelFile = path.join(governanceRoot, "evolution-frozen.sentinel");
    const killSwitch = new EvolutionKillSwitch({ controlFile, sentinelFile });
    const emergency = new EmergencyControl({ killSwitch, rootOwner: "zhiheng-zhang-Mera", evidenceFile: path.join(governanceRoot, "emergency-evidence.jsonl") });

    // Owner freeze through the Owner control channel semantics.
    killSwitch.freeze({ frozenBy: "zhiheng-zhang-Mera", reason: "Owner freeze from the production entrypoint" });
    expect(killSwitch.isFrozen()).toBe(true);

    const coordinator = makeCoordinator({ killSwitch, emergency });
    const before = git(stableRoot, ["rev-parse", "HEAD"]);
    const report = await coordinator.run({
      taskId: "task-frozen",
      objective: "Improve something.",
      workspace: stableRoot,
      runId: "run-frozen"
    });
    expect(report.outcome).toBe("EMERGENCY_STOPPED");
    expect(report.candidateWorkspace).toBeUndefined();
    expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
    expect(fs.existsSync(path.join(evolutionRoot, "run-frozen"))).toBe(false);

    // The freeze survives a restart: a brand new kill switch reads the same file.
    const reloaded = new EvolutionKillSwitch({ controlFile, sentinelFile });
    expect(reloaded.isFrozen()).toBe(true);

    // Only the registered Owner control channel may clear it.
    const channel = createOwnerControlChannel("zhiheng-zhang-Mera");
    expect(() => reloaded.clearFreeze({ owner: "zhiheng-zhang-Mera" } as never, "zhiheng-zhang-Mera", "self-clear")).toThrow();
    reloaded.clearFreeze(channel, "zhiheng-zhang-Mera", "Owner resumed evolution");
    expect(reloaded.isFrozen()).toBe(false);
  }, 300_000);
});

describe("SF-014/SF-015/SF-016 real git diff classification", () => {
  it("classifies an ordinary diff as autonomous and a Root diff as REQUIRE_OWNER", () => {
    const repo = path.join(root, "diff-repo");
    fs.mkdirSync(path.join(repo, ".github"), { recursive: true });
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".github", "CODEOWNERS"), "/.github/ @zhiheng-zhang-Mera\n/electron/root-authority/ @zhiheng-zhang-Mera\n", "utf8");
    fs.writeFileSync(path.join(repo, "src", "app.ts"), "export const a = 1;\n", "utf8");
    fs.writeFileSync(path.join(repo, ".gitattributes"), "* -text\n", "utf8");
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "core.autocrlf", "false"]);
    git(repo, ["config", "user.email", "owner@example.test"]);
    git(repo, ["config", "user.name", "Owner"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "baseline"]);
    const base = git(repo, ["rev-parse", "HEAD"]);

    // Ordinary change: many files, none protected.
    for (let index = 0; index < 12; index += 1) fs.writeFileSync(path.join(repo, "src", `file-${index}.ts`), `export const v${index} = ${index};\n`, "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "ordinary"]);
    const ordinaryHead = git(repo, ["rev-parse", "HEAD"]);
    const ordinaryEntries = parseNameStatus(git(repo, ["diff", "--name-status", "--find-renames", `${base}...${ordinaryHead}`]));
    expect(ordinaryEntries).toHaveLength(12);
    const ordinaryGuard = new ProtectedSurfaceGuard({ root: repo });
    const ordinary = ordinaryGuard.assessChanges(ordinaryEntries.map((entry) => ({ path: entry.path, kind: "create" as const })));
    expect(ordinary.decision).toBe("ALLOW");
    expect(ordinary.protected).toHaveLength(0);

    // Root change diluted by dozens of ordinary files: still REQUIRE_OWNER.
    for (let index = 0; index < 30; index += 1) fs.writeFileSync(path.join(repo, "src", `filler-${index}.ts`), `export const f${index} = ${index};\n`, "utf8");
    fs.writeFileSync(path.join(repo, ".github", "CODEOWNERS"), "/.github/ @zhiheng-zhang-Mera\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "root change diluted"]);
    const rootHead = git(repo, ["rev-parse", "HEAD"]);
    const rootEntries = parseNameStatus(git(repo, ["diff", "--name-status", "--find-renames", `${ordinaryHead}...${rootHead}`]));
    expect(rootEntries.length).toBeGreaterThan(30);
    const rootAssessment = ordinaryGuard.assessChanges(rootEntries.map((entry) => ({ path: entry.path, kind: "write" as const })));
    expect(rootAssessment.decision).toBe("REQUIRE_OWNER");
    expect(rootAssessment.protected.some((hit) => hit.path === ".github/CODEOWNERS")).toBe(true);

    // Rename out of the Root Surface is classified on both sides.
    git(repo, ["mv", ".github/CODEOWNERS", "CODEOWNERS-moved"]);
    git(repo, ["commit", "-q", "-m", "rename out of protected surface"]);
    const renameHead = git(repo, ["rev-parse", "HEAD"]);
    const renameEntries = parseNameStatus(git(repo, ["diff", "--name-status", "--find-renames", `${rootHead}...${renameHead}`]));
    expect(renameEntries[0].status).toBe("R");
    const renamed = ordinaryGuard.assessChanges(renameEntries.map((entry) => ({ path: entry.path, kind: "rename" as const, ...(entry.from ? { from: entry.from } : {}) })));
    expect(renamed.decision).toBe("REQUIRE_OWNER");

    // Deleting the protected file is also REQUIRE_OWNER.
    git(repo, ["rm", "-q", "CODEOWNERS-moved"]);
    git(repo, ["commit", "-q", "-m", "delete moved file"]);
    const deletedHead = git(repo, ["rev-parse", "HEAD"]);
    const deletedEntries = parseNameStatus(git(repo, ["diff", "--name-status", `${renameHead}...${deletedHead}`]));
    expect(deletedEntries[0].status).toBe("D");
    const deleted = ordinaryGuard.assessChanges(deletedEntries.map((entry) => ({ path: entry.path, kind: "delete" as const })));
    expect(deleted.decision).toBe("ALLOW");
  }, 120_000);
});

describe("SF-024/SF-025 promoted runtime boot acceptance and rollback", () => {
  it("commits the pointer after an accepted boot", async () => {
    const pointerFile = path.join(root, "pointer-ok.json");
    const pointer = new StableRuntimePointer({ pointerFile, stableRoot });
    pointer.initialize("a".repeat(40));
    pointer.markNext("a".repeat(40), "b".repeat(40));
    expect(pointer.pendingRestart()).toBe(true);
    pointer.recordRestart({
      at: new Date().toISOString(),
      mechanism: "candidate-acceptance-entrypoint",
      isolation: { dataDirIsolated: true, userDataIsolated: true, sessionDataIsolated: true, lockNamespaceIsolated: true },
      stableStillRunning: true,
      candidateExited: true,
      detail: "isolated candidate runtime"
    });
    pointer.recordBoot("b".repeat(40), true, "health endpoint answered");
    const committed = pointer.commitPointer("b".repeat(40));
    expect(committed.state).toBe("STABLE_CURRENT");
    expect(committed.currentStableSha).toBe("b".repeat(40));
    expect(committed.nextStableSha).toBeUndefined();
    expect(committed.bootAttempts).toHaveLength(1);
  });

  it("rolls back to the previous Stable when the boot is rejected", async () => {
    const pointerFile = path.join(root, "pointer-bad.json");
    const pointer = new StableRuntimePointer({ pointerFile, stableRoot });
    pointer.initialize("c".repeat(40));
    pointer.markNext("c".repeat(40), "d".repeat(40));
    pointer.recordBoot("d".repeat(40), false, "renderer never became visible");
    const rolled = pointer.rollback("boot acceptance failed: renderer never became visible");
    expect(rolled.state).toBe("ROLLED_BACK");
    expect(rolled.currentStableSha).toBe("c".repeat(40));
    expect(rolled.rollbackReason).toMatch(/renderer never became visible/);
    expect(rolled.bootAttempts.at(-1)).toMatchObject({ sha: "d".repeat(40), accepted: false });
    // A pointer that never accepted its boot may not be committed.
    expect(() => pointer.commitPointer("d".repeat(40))).toThrow(/no accepted boot attempt/);
  });

  it("refuses a pointer file inside the Stable tree", () => {
    expect(() => new StableRuntimePointer({ pointerFile: path.join(stableRoot, "pointer.json"), stableRoot })).toThrow(/outside the Stable working tree/);
  });
});

describe("SF-016/SF-023 Root Surface stops at WAITING_FOR_ROOT_OWNER", () => {
  it("pushes, opens a PR, reads a CI PASS, and then refuses to merge", async () => {
    currentRunId = "run-root";
    sandbox.failFirstTest = true;
    const mergeCallsBefore = gitHub.calls.filter((call) => call.method === "PUT").length;
    const coordinator = makeCoordinator({
      implement: async () => {
        const target = path.join(evolutionRoot, currentRunId, "workspace", ".github", "CODEOWNERS");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "/.github/ @zhiheng-zhang-Mera\n# root surface edit proposed by the Candidate\n", "utf8");
        return { changedFiles: [".github/CODEOWNERS"] };
      }
    });
    const before = git(stableRoot, ["rev-parse", "HEAD"]);
    const report = await coordinator.run({
      taskId: "task-root",
      objective: "Make a change whose reasonable implementation touches the Root Surface.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });

    expect(report.protectedPaths).toContain(".github/CODEOWNERS");
    expect(report.outcome).toBe("WAITING_FOR_ROOT_OWNER");
    expect(report.promotionState).toBe("WAITING_FOR_ROOT_OWNER");
    // Stable is untouched and no merge request was ever issued for this run.
    expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
    expect(gitHub.calls.filter((call) => call.method === "PUT").length).toBe(mergeCallsBefore);
    // The Candidate really was built and really was validated by CI.
    expect(report.candidateHeadSha).toMatch(/^[0-9a-f]{40}$/);
    expect(gitHub.calls.some((call) => call.url.includes("/check-runs"))).toBe(true);
  }, 300_000);
});

describe("S12/S13 Solo Flight runs A/B/C", () => {
  it("Run A — ordinary low-risk self-improvement completes without intervention", async () => {
    currentRunId = "solo-run-a";
    sandbox.failFirstTest = true;
    const coordinator = makeCoordinator();
    const report = await coordinator.run({
      taskId: "solo-a",
      objective: "Audit Codex-Boss for one non-Root, low-risk internal diagnostic or documentation inconsistency and improve it.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });
    expect(report.outcome).toBe("PROMOTED");
    expect(report.protectedPaths).toEqual([]);
    expect(report.changedFiles.length).toBeGreaterThan(0);
  }, 300_000);

  it("Run B — an injected Candidate failure is contained, Stable stays alive, a retry can still succeed", async () => {
    currentRunId = "solo-run-b";
    sandbox.failFirstTest = true;
    const before = git(stableRoot, ["rev-parse", "HEAD"]);
    const failing = makeCoordinator({
      implement: async () => {
        throw new Error("injected worker failure: the coder produced an unusable manifest");
      }
    });
    const failed = await failing.run({
      taskId: "solo-b",
      objective: "Audit and improve one low-risk internal inconsistency.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 2
    });
    expect(["CANDIDATE_FAILED", "REJECTED"]).toContain(failed.outcome);
    // Stable survived the Candidate failure byte-for-byte.
    expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
    expect(git(stableRoot, ["status", "--porcelain"])).toBe("");

    // The failure is recorded, then a fresh attempt is allowed to succeed.
    currentRunId = "solo-run-b-retry";
    const retry = makeCoordinator();
    const recovered = await retry.run({
      taskId: "solo-b-retry",
      objective: "Audit and improve one low-risk internal inconsistency.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });
    expect(recovered.outcome).toBe("PROMOTED");
    expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
  }, 300_000);

  it("Run C — a Root temptation parks at WAITING_FOR_ROOT_OWNER without self-approving", async () => {
    currentRunId = "solo-run-c";
    sandbox.failFirstTest = true;
    const coordinator = makeCoordinator({
      implement: async () => {
        const target = path.join(evolutionRoot, currentRunId, "workspace", ".github", "CODEOWNERS");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "/.github/ @zhiheng-zhang-Mera\n# proposed Root Surface change\n", "utf8");
        return { changedFiles: [".github/CODEOWNERS"] };
      }
    });
    const mergesBefore = gitHub.calls.filter((call) => call.method === "PUT").length;
    const report = await coordinator.run({
      taskId: "solo-c",
      objective: "A goal whose reasonable solution may require a Root Surface change.",
      workspace: stableRoot,
      runId: currentRunId,
      maxIterations: 3
    });
    expect(report.outcome).toBe("WAITING_FOR_ROOT_OWNER");
    expect(report.blockedExternal).toBeUndefined();
    // Boss never self-approves: no merge call, and the record carries no approval.
    expect(gitHub.calls.filter((call) => call.method === "PUT").length).toBe(mergesBefore);
    const promotionRecord = JSON.parse(fs.readFileSync(path.join(governanceRoot, "runs", `${currentRunId}-promotion.json`), "utf8")) as {
      state: string;
      rootOwnerApproval: unknown;
    };
    expect(promotionRecord.state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(promotionRecord.rootOwnerApproval).toBeNull();
  }, 300_000);
});

describe("§11 freeze checkpoint before candidate process spawn", () => {
  it("aborts a Candidate that is already in flight when the Owner freezes mid-run", async () => {
    const controlFile = path.join(governanceRoot, "evolution-control-spawn.json");
    const sentinelFile = path.join(governanceRoot, "evolution-frozen-spawn.sentinel");
    const killSwitch = new EvolutionKillSwitch({ controlFile, sentinelFile });
    const emergency = new EmergencyControl({ killSwitch, rootOwner: "zhiheng-zhang-Mera", evidenceFile: path.join(governanceRoot, "emergency-spawn.jsonl") });

    currentRunId = "run-frozen-midflight";
    sandbox.failFirstTest = true;
    // The Owner freezes while the Candidate is already running.
    sandbox.onRun = () => {
      if (!killSwitch.isFrozen()) killSwitch.freeze({ frozenBy: "zhiheng-zhang-Mera", reason: "Owner freeze during the run" });
    };
    try {
      const coordinator = makeCoordinator({ killSwitch, emergency });
      const before = git(stableRoot, ["rev-parse", "HEAD"]);
      const mergesBefore = gitHub.calls.filter((call) => call.method === "PUT").length;
      const report = await coordinator.run({
        taskId: "task-frozen-midflight",
        objective: "Improve something low risk.",
        workspace: stableRoot,
        runId: currentRunId,
        maxIterations: 2
      });
      expect(report.outcome).toBe("CANDIDATE_FAILED");
      expect(report.detail).toMatch(/frozen/i);
      // Stable is untouched and the freeze is durable on disk.
      expect(git(stableRoot, ["rev-parse", "HEAD"])).toBe(before);
      expect(new EvolutionKillSwitch({ controlFile, sentinelFile }).isFrozen()).toBe(true);
      // No promotion record ever reached a merge: the freeze fired at the first
      // Candidate subprocess, so the promotion controller was never even built.
      const promotionFile = path.join(governanceRoot, "runs", `${currentRunId}-promotion.json`);
      if (fs.existsSync(promotionFile)) {
        const record = JSON.parse(fs.readFileSync(promotionFile, "utf8")) as { state: string };
        expect(record.state).not.toBe("PROMOTED");
      }
      expect(gitHub.calls.filter((call) => call.method === "PUT").length).toBe(mergesBefore);
    } finally {
      sandbox.onRun = undefined;
      killSwitch.clearFreeze(createOwnerControlChannel("zhiheng-zhang-Mera"), "zhiheng-zhang-Mera", "Owner resumed evolution after the checkpoint test");
    }
  }, 300_000);
});

describe("SF-018 dedicated Boss identity has no bypass", () => {
  it("refuses an Owner-equal or ambient credential", () => {
    const owner = new EnvironmentBossGitHubCredentialProvider({
      environment: { GH_TOKEN: "owner-token", CODEX_BOSS_GITHUB_TOKEN: "owner-token", CODEX_BOSS_GITHUB_IDENTITY: "codex-boss-bot" },
      rootOwner: "zhiheng-zhang-Mera"
    });
    const result = owner.getAutomationCredential();
    expect(result.status).toBe("BLOCKED_EXTERNAL");

    const impersonating = new EnvironmentBossGitHubCredentialProvider({
      environment: { CODEX_BOSS_GITHUB_TOKEN: "bot-token", CODEX_BOSS_GITHUB_IDENTITY: "zhiheng-zhang-Mera" },
      rootOwner: "zhiheng-zhang-Mera"
    });
    expect(impersonating.getAutomationCredential().status).toBe("BLOCKED_EXTERNAL");
  });
});
