import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EnvironmentBossGitHubCredentialProvider, type BossGitHubCredentialProvider } from "../credential-boundary/github-credential-provider";
import { fetchGitHubTransport, GitHubPromotionAdapter, type GitHubTransport } from "../promotion-gate/github-promotion-adapter";
import { EvolutionKillSwitch } from "../emergency-control/evolution-kill-switch";
import { EmergencyControl } from "../emergency-control/emergency-control";
import type { EngineeringRoleWorker } from "../engineering/live-engineering-operations";
import type { TaskIR } from "../../src/shared/task-ir";
import { SelfTargetResolver } from "./self-target-resolver";
import { configureMutationGuard } from "./mutation-guard";
import { EvolutionRunRegistry, evolutionRuns } from "./mutation-context";
import { WindowsAppContainerSandbox } from "./sandbox/windows-appcontainer-backend";
import type { EvolutionSandbox } from "./sandbox/sandbox-backend";
import { SelfEvolutionCoordinator, type SelfEvolutionRunReport } from "./self-evolution-coordinator";
import { StableRuntimePointer } from "./stable-runtime-pointer";
import type { ChangeEntry, HostOperationHandlers } from "./host-operations";

/**
 * Phase S2/S3 — production host adapter for the Self-Evolution trust domain.
 *
 * This is the object the composition root installs on `MainCommander`. It owns
 * the real Stable root, the real path to the running app's own repository, the
 * governance directory that holds the Root ledger / freeze record / promotion
 * record / stable pointer, and the sandbox. `MainCommander` sees only
 * `isSelfTarget` and `runTask`.
 */

export interface CreateSelfEvolutionHostOptions {
  /** Repository identity the running Boss was installed from. */
  productRepository?: string;
  /** Explicit Stable root; defaults to the running app's repository root. */
  stableRoot?: string;
  /** Host-owned evolution run root; defaults to `<userData>/evolution`. */
  evolutionRoot?: string;
  /** Governance root; defaults to `<userData>/evolution/governance`. */
  governanceRoot?: string;
  /** Root the app was launched from (`app.getAppPath()`). */
  appPath: string;
  /** Electron `app.getPath("userData")`. */
  userData: string;
  /** Owner login from the Root policy. */
  rootOwner: string;
  /** Lazily resolved coder/reviewer worker (needs the commander instance). */
  worker: () => EngineeringRoleWorker;
  baseBranch?: string;
  credentialProvider?: BossGitHubCredentialProvider;
  transport?: GitHubTransport;
  sandbox?: EvolutionSandbox;
  registry?: EvolutionRunRegistry;
  candidateTimeoutMs?: number;
}

export interface SelfEvolutionHostHandle {
  isSelfTarget(workspace: string): boolean;
  runTask(input: { taskId: string; objective: string; workspace: string; plan: TaskIR }): Promise<{
    outcome: string;
    runId: string;
    changedFiles: string[];
    protectedPaths: string[];
    detail: string;
    blockedExternal?: string;
  }>;
  /** Escape hatch for evidence scripts and the acceptance harness. */
  coordinator(): SelfEvolutionCoordinator;
  resolver(): SelfTargetResolver;
  sandbox(): EvolutionSandbox;
  stableRoot(): string;
  governanceRoot(): string;
  evolutionRoot(): string;
  pointer(): StableRuntimePointer;
  lastRun(): SelfEvolutionRunReport | undefined;
}

/** The git-backed default host handlers (host-selected argv only). */
export function createGitHostHandlers(base: {
  persistEvidence(file: string, payload: unknown): void;
  runGit(cwd: string, args: string[]): Promise<string>;
  promotion: Pick<HostOperationHandlers, "pushBranch" | "openPullRequest" | "readPullRequest" | "readCheck" | "mergePullRequest" | "readBranchSha">;
}): HostOperationHandlers {
  return {
    commitCandidate: async ({ workspace, message }) => {
      await base.runGit(workspace, ["add", "-A"]);
      await base.runGit(workspace, ["-c", "user.name=Codex Boss Evolution", "-c", "user.email=evolution@codex-boss.local", "commit", "-m", message]);
      return base.runGit(workspace, ["rev-parse", "HEAD"]);
    },
    candidateHead: async ({ workspace }) => base.runGit(workspace, ["rev-parse", "HEAD"]),
    nameStatus: async ({ workspace, baseSha, headSha }): Promise<ChangeEntry[]> => {
      const output = await base.runGit(workspace, ["diff", "--name-status", "--find-renames", `${baseSha}...${headSha}`]);
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          const statusField = parts[0].trim();
          const status = (statusField[0] ?? "M").toUpperCase() as ChangeEntry["status"];
          if (status === "R" || status === "C") return { status, from: parts[1], path: parts[2] ?? parts[1] };
          return { status, path: parts[1] ?? parts[0] };
        })
        .filter((entry) => Boolean(entry.path));
    },
    persistEvidence: async ({ name, payload }) => {
      base.persistEvidence(name, payload);
      return name;
    },
    ...base.promotion,
    markNextStable: async () => {},
    recordBoot: async () => {},
    commitStablePointer: async () => {},
    rollbackStable: async () => ({ ok: true, detail: "rollback is driven by the stable runtime pointer" })
  };
}

export function createSelfEvolutionHost(options: CreateSelfEvolutionHostOptions): SelfEvolutionHostHandle {
  const appPath = path.resolve(options.appPath);
  const stableRoot = path.resolve(options.stableRoot ?? detectRepositoryRoot(appPath) ?? appPath);
  const evolutionRoot = path.resolve(options.evolutionRoot ?? path.join(options.userData, "evolution"));
  const governanceRoot = path.resolve(options.governanceRoot ?? path.join(evolutionRoot, "governance"));
  fs.mkdirSync(governanceRoot, { recursive: true });

  const productRepository = options.productRepository ?? "zhiheng-zhang-Mera/Codex-Boss";
  const registry = options.registry ?? evolutionRuns;
  const resolver = new SelfTargetResolver({ stableRoot, productRepository });
  // §7.3: every production mutating seam is now guarded for this installation.
  configureMutationGuard({ stableRoot, productRepository, registry, resolver });

  const killSwitch = new EvolutionKillSwitch({
    controlFile: path.join(governanceRoot, "evolution-control.json"),
    sentinelFile: path.join(governanceRoot, "evolution-frozen.sentinel"),
    candidateRoots: [evolutionRoot]
  });
  const emergency = new EmergencyControl({ killSwitch, rootOwner: options.rootOwner, evidenceFile: path.join(governanceRoot, "emergency-evidence.jsonl") });

  const sandbox =
    options.sandbox ??
    new WindowsAppContainerSandbox({
      launcherRoot: path.join(options.userData, "sandbox"),
      candidateRoot: evolutionRoot,
      // Only the Stable tree is denied. `evolutionRoot` lives under userData, so
      // denying userData would refuse the coordinator's own Candidate grant.
      denyRoots: [stableRoot],
      // Read-only toolchain roots are declared here, NOT as per-request grants,
      // because a per-request grant is checked against `denyRoots` and the Stable
      // toolchain lives inside the Stable tree.
      readOnlyRoots: [path.join(stableRoot, "node_modules"), path.dirname(process.execPath)].filter((root) => fs.existsSync(root))
    });

  const credentialProvider = options.credentialProvider ?? new EnvironmentBossGitHubCredentialProvider({ rootOwner: options.rootOwner });
  const adapter = new GitHubPromotionAdapter({
    repository: productRepository,
    baseBranch: options.baseBranch ?? "main",
    credentialProvider,
    transport: options.transport ?? fetchGitHubTransport
  });

  const runGit = (cwd: string, args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile("git", args, { cwd, windowsHide: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr) || String(error.message)));
        else resolve(String(stdout).trim());
      });
    });

  const handlers = createGitHostHandlers({
    runGit,
    persistEvidence: (file, payload) => {
      const target = path.join(governanceRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    },
    promotion: {
      pushBranch: async ({ workspace, branch, sha }) => adapter.pushCandidateBranch({ workspace, branch, sha }),
      openPullRequest: async ({ head, title, body }) => adapter.createPullRequest({ head, title, body }),
      readPullRequest: async ({ prNumber }) => adapter.readPullRequest(prNumber),
      readCheck: async ({ sha }) => adapter.readRequiredCheck(sha),
      mergePullRequest: async ({ prNumber, sha, title }) => adapter.mergePullRequest({ prNumber, sha, commitTitle: title }),
      readBranchSha: async ({ branch }) => adapter.readBranchSha(branch)
    }
  });

  const coordinator = new SelfEvolutionCoordinator({
    stableRoot,
    evolutionRoot,
    governanceRoot,
    productRepository,
    sandbox,
    hostHandlers: handlers,
    resolver,
    worker: options.worker(),
    credentialProvider,
    transport: options.transport,
    baseBranch: options.baseBranch,
    killSwitch,
    emergency,
    registry,
    ownerControlOwner: options.rootOwner,
    candidateTimeoutMs: options.candidateTimeoutMs
  });

  let lastRun: SelfEvolutionRunReport | undefined;
  const pointerFile = path.join(governanceRoot, "stable-pointer.json");

  return {
    isSelfTarget: (workspace: string) => resolver.resolve(workspace).isSelf,
    async runTask(input) {
      const report = await coordinator.run({
        taskId: input.taskId,
        objective: input.objective,
        workspace: input.workspace,
        maxIterations: 4
      });
      lastRun = report;
      return {
        outcome: report.outcome,
        runId: report.runId,
        changedFiles: report.changedFiles,
        protectedPaths: report.protectedPaths,
        detail: report.detail,
        ...(report.blockedExternal ? { blockedExternal: report.blockedExternal } : {})
      };
    },
    coordinator: () => coordinator,
    resolver: () => resolver,
    sandbox: () => sandbox,
    stableRoot: () => stableRoot,
    governanceRoot: () => governanceRoot,
    evolutionRoot: () => evolutionRoot,
    pointer: () => new StableRuntimePointer({ pointerFile, stableRoot }),
    lastRun: () => lastRun
  };
}

/** Walks up from a path looking for a git working tree. */
export function detectRepositoryRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
