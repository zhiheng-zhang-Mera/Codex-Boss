import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sanitizeEnvironment } from "../credential-boundary/sanitized-environment";
import { candidateEnvironment } from "../credential-boundary/credential-boundary";
import { EnvironmentBossGitHubCredentialProvider, type BossGitHubCredentialProvider } from "../credential-boundary/github-credential-provider";
import { ExactShaGate } from "../promotion-gate/exact-sha-gate";
import { GitHubPromotionAdapter, type GitHubTransport } from "../promotion-gate/github-promotion-adapter";
import { PromotionController, type PromotionRecord } from "../promotion-gate/promotion-controller";
import { RootAuthority } from "../root-authority/root-authority";
import { EvolutionExecutionProfile } from "../root-authority/execution-profile";
import { ProtectedSurfaceGuard, type SurfaceChange } from "../root-authority/protected-surface-guard";
import { CandidateSupervisor, type CandidateJournal } from "../stable-candidate/candidate-supervisor";
import { materializeEvolutionLayout, evolutionLayout, type EvolutionLayout } from "../stable-candidate/runtime-isolation";
import {
  candidateChangedFiles,
  commitCandidate,
  createCandidateWorkspace,
  headSha,
  removeCandidateWorkspace,
  type CandidateWorkspace
} from "../stable-candidate/workspace-manager";
import { EmergencyControl } from "../emergency-control/emergency-control";
import { EvolutionKillSwitch } from "../emergency-control/evolution-kill-switch";
import type { PromotionState } from "../../src/shared/root-authority/promotion-state";
import { EngineeringLoopDriver, type EngineeringLoopSummary } from "../engineering/engineering-loop-driver";
import type { EngineeringFinding, ReviewerFinding } from "../../src/shared/engineering-loop";
import { EngineeringLoopStore } from "../engineering/engineering-loop-store";
import { createRepoEngineeringOperations } from "../engineering/repo-engineering-operations";
import { createLiveEngineeringOperations, type EngineeringRoleWorker } from "../engineering/live-engineering-operations";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";
import type { CommandSandbox, CommandSandboxOutcome } from "../engineering/command-runner";
import type { AllowedCommand } from "../engineering/command-runner";
import type { EvolutionSandbox, SandboxedProcessResult } from "./sandbox/sandbox-backend";
import type { SelfTargetResolver, SelfTargetResolution } from "./self-target-resolver";
import { evolutionRuns, type EvolutionRunContext, type EvolutionRunRegistry } from "./mutation-context";
import {
  EvolutionHostOperations,
  type ChangeEntry,
  type HostOperationHandlers,
  parseNameStatus
} from "./host-operations";
import { planCandidateRuntimeIsolation, StableRuntimePointer, type StablePointerRecord } from "./stable-runtime-pointer";

/**
 * Phase S2 —SelfEvolutionCoordinator
 * (Update-Plan/Alien-Prestart.md §6, §7, §8, §11, §12, §19, §20).
 *
 * The ONLY production composition root for Autonomous Evolution. Every
 * Phase 0 safety component is wired here, in one place, so the control flow
 * can be read top to bottom instead of being spread across `main.ts`,
 * `MainCommander` and `ProposalRunner`:
 *
 *   Stable Boss
 *     -> resolve self target
 *     -> read EmergencyControl
 *     -> freeze base SHA
 *     -> create Candidate workspace
 *     -> initialize RootAuthority
 *     -> initialize RootAuditLedger outside the Candidate
 *     -> initialize EvolutionExecutionProfile (sandboxed)
 *     -> run the existing engineering loop inside the Candidate
 *     -> verify / independent review / convergence
 *     -> real `git diff --name-status` -> ProtectedSurfaceGuard
 *     -> local promotion decision
 *     -> remote promotion through the host operation channel
 *     -> runtime boot acceptance / rollback
 *
 * `MainCommander` only hands a self-target task over; it makes no evolution
 * decision of its own.
 */

export type SelfEvolutionOutcome =
  | "NOT_SELF"
  | "EMERGENCY_STOPPED"
  | "BLOCKED_EXTERNAL"
  | "WAITING_FOR_ROOT_OWNER"
  | "PROMOTED"
  | "REJECTED"
  | "ROLLED_BACK"
  | "CANDIDATE_FAILED";

export interface SelfEvolutionTaskRequest {
  taskId: string;
  /** The Owner's high-level goal. Never a file list. */
  objective: string;
  /** The path the caller was about to mutate. */
  workspace: string;
  /** Optional frozen goal contract; a default one is derived when absent. */
  goal?: Omit<EngineeringGoalContract, "schemaVersion" | "id" | "createdAt"> & { id?: string };
  runId?: string;
  maxIterations?: number;
}

export interface SelfEvolutionRunReport {
  runId: string;
  taskId: string;
  isSelf: boolean;
  selfReason: string;
  outcome: SelfEvolutionOutcome;
  detail: string;
  baseSha?: string;
  candidateWorkspace?: string;
  candidateHeadSha?: string;
  changedFiles: string[];
  protectedPaths: string[];
  promotionState?: PromotionState;
  loopState?: EngineeringLoopSummary["state"];
  candidateJournal?: CandidateJournal;
  blockedExternal?: string;
  sandboxMechanism?: string;
  sandboxActive: boolean;
  evidenceFile?: string;
  stablePointer?: StablePointerRecord;
  startedAt: string;
  finishedAt: string;
}

export interface SelfEvolutionCoordinatorOptions {
  /** Stable installation root. */
  stableRoot: string;
  /** Host-owned root for evolution run trees. Must be outside the Stable tree. */
  evolutionRoot: string;
  /** Governance root: control file, ledger, promotion record, stable pointer. */
  governanceRoot: string;
  /** Reviewed repository identity, e.g. `zhiheng-zhang-Mera/Codex-Boss`. */
  productRepository: string;
  /** Hard-execution sandbox for every Candidate subprocess. */
  sandbox: EvolutionSandbox;
  /** Host operation handlers —the ONLY route to a host side effect. */
  hostHandlers: HostOperationHandlers;
  /** Self-target resolver (S1). */
  resolver: SelfTargetResolver;
  /** Coder/reviewer worker for the real engineering loop. */
  worker: EngineeringRoleWorker;
  /** Dedicated Boss identity; defaults to the environment provider. */
  credentialProvider?: BossGitHubCredentialProvider;
  transport?: GitHubTransport;
  baseBranch?: string;
  /** Injectable for tests: overrides the default EmergencyControl wiring. */
  killSwitch?: EvolutionKillSwitch;
  emergency?: EmergencyControl;
  registry?: EvolutionRunRegistry;
  ownerControlOwner?: string;
  candidateTimeoutMs?: number;
  now?: () => Date;
  /**
   * Deterministic editor/reviewer seams, mirroring the existing
   * `MainCommander.runEngineeringGoal` injection point. Production leaves both
   * undefined so the live role-routed coder and reviewer are used; the Solo
   * Flight acceptance harness injects scripted ones so a run is reproducible.
   */
  implement?: (finding: EngineeringFinding) => Promise<{ changedFiles: string[]; error?: string }>;
  review?: (finding: EngineeringFinding, changedFiles: string[], evidence: { buildPassed: boolean; testsPassed: boolean }) => Promise<{ findings: ReviewerFinding[]; raw?: string }>;
}

interface OwnedGovernance {
  killSwitch: EvolutionKillSwitch;
  emergency: EmergencyControl;
}

/** Adapts the OS sandbox to the engineering loop's `CommandSandbox` seam (S4). */
export class SandboxedCommandRunner implements CommandSandbox {
  constructor(
    private readonly sandbox: EvolutionSandbox,
    private readonly input: {
      layout: EvolutionLayout;
      containerName: string;
      readOnlyRoots: readonly string[];
      controlDirectory: string;
      evidenceDirectory: string;
      activeProcessLimit: number;
      /** Read-only Stable toolchain used when the Candidate has no node_modules. */
      toolchainRoot?: string;
    },
    /**
     * §11 - the "before candidate process spawn" freeze checkpoint. Called
     * immediately before every Candidate subprocess is created, so an Owner
     * freeze stops a run that is already in flight rather than only the next one.
     */
    private readonly beforeSpawn?: () => void
  ) {}

  async run(request: { command: AllowedCommand; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }): Promise<CommandSandboxOutcome> {
    this.beforeSpawn?.();
    const stem = `${request.command}-${Date.now().toString(36)}`;
    const result: SandboxedProcessResult = await this.sandbox.run({
      executable: process.execPath,
      args: request.args,
      cwd: request.cwd,
      environment: request.env,
      // The toolchain read roots are declared on the sandbox itself, not as a
      // per-request grant: a per-request grant is checked against the sandbox
      // deny roots, and the Stable toolchain lives inside the Stable tree.
      grants: [{ path: this.input.layout.root, access: "write" }],
      timeoutMs: 15 * 60 * 1000,
      activeProcessLimit: this.input.activeProcessLimit,
      stdoutFile: path.join(this.input.evidenceDirectory, `${stem}.out.txt`),
      stderrFile: path.join(this.input.evidenceDirectory, `${stem}.err.txt`),
      containerName: this.input.containerName,
      controlDirectory: this.input.controlDirectory
    });
    if (result.refused) {
      // The sandbox refusing to start is a FAILED check, never a silent pass.
      return { passed: false, exitCode: null, output: `sandbox refused to run ${request.command}: ${result.failure ?? "unknown"}` };
    }
    return { passed: !result.timedOut && result.exitCode === 0, exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
  }
}

export class SelfEvolutionCoordinator {
  private readonly options: SelfEvolutionCoordinatorOptions;
  private readonly registry: EvolutionRunRegistry;
  private governance?: OwnedGovernance;

  constructor(options: SelfEvolutionCoordinatorOptions) {
    this.options = options;
    this.registry = options.registry ?? evolutionRuns;
  }

  /** Resolves whether a path is the Boss repository itself (S1). */
  resolveSelfTarget(workspace: string): SelfTargetResolution {
    return this.options.resolver.resolve(workspace);
  }

  private governancePaths(): OwnedGovernance & { controlFile: string; sentinelFile: string; evidenceFile: string } {
    const governanceRoot = path.resolve(this.options.governanceRoot);
    const controlFile = path.join(governanceRoot, "evolution-control.json");
    const sentinelFile = path.join(governanceRoot, "evolution-frozen.sentinel");
    const evidenceFile = path.join(governanceRoot, "emergency-evidence.jsonl");
    return {
      controlFile,
      sentinelFile,
      evidenceFile,
      killSwitch: this.options.killSwitch ?? this.governance?.killSwitch ?? new EvolutionKillSwitch({ controlFile, sentinelFile }),
      emergency:
        this.options.emergency ??
        this.governance?.emergency ??
        new EmergencyControl({ killSwitch: this.options.killSwitch ?? new EvolutionKillSwitch({ controlFile, sentinelFile }), rootOwner: this.options.ownerControlOwner ?? "unresolved", evidenceFile })
    };
  }

  /** Shared governance handles so freeze state is read from one durable file. */
  private governanceHandles(): OwnedGovernance {
    if (this.options.killSwitch && this.options.emergency) return { killSwitch: this.options.killSwitch, emergency: this.options.emergency };
    if (!this.governance) {
      const governanceRoot = path.resolve(this.options.governanceRoot);
      const killSwitch = this.options.killSwitch ?? new EvolutionKillSwitch({
        controlFile: path.join(governanceRoot, "evolution-control.json"),
        sentinelFile: path.join(governanceRoot, "evolution-frozen.sentinel")
      });
      const emergency = this.options.emergency ?? new EmergencyControl({
        killSwitch,
        rootOwner: this.options.ownerControlOwner ?? "unresolved",
        evidenceFile: path.join(governanceRoot, "emergency-evidence.jsonl")
      });
      this.governance = { killSwitch, emergency };
    }
    return this.governance;
  }

  /**
   * §11 — one of the six production freeze checkpoints. Called immediately
   * before a Candidate subprocess would be created: an Owner freeze that lands
   * mid-run stops the Candidate instead of waiting for the next one.
   */
  assertCandidateProcessSpawnAllowed(
    action: string,
    supervisor: { abort(reason: string): boolean },
    runId: string
  ): void {
    const { emergency, killSwitch } = this.governanceHandles();
    if (!killSwitch.isFrozen()) return;
    emergency.emergencyStop({ actor: "owner-freeze", reason: action, candidate: supervisor, runId });
    emergency.assertCandidateCreationAllowed();
  }

  async run(request: SelfEvolutionTaskRequest): Promise<SelfEvolutionRunReport> {
    const startedAt = new Date().toISOString();
    const base = {
      taskId: request.taskId,
      startedAt,
      changedFiles: [] as string[],
      protectedPaths: [] as string[],
      sandboxActive: false
    };
    const selfTarget = this.resolveSelfTarget(request.workspace);
    if (!selfTarget.isSelf) {
      return { ...base, runId: request.runId ?? "-", isSelf: false, selfReason: selfTarget.reason, outcome: "NOT_SELF", detail: selfTarget.reason, finishedAt: new Date().toISOString() };
    }

    const { emergency, killSwitch } = this.governanceHandles();
    const stableRoot = selfTarget.stableRoot ?? path.resolve(this.options.stableRoot);
    const runId = request.runId ?? `evo-${Date.now().toString(36)}`;
    const evidenceFile = path.join(path.resolve(this.options.governanceRoot), "runs", `${runId}.json`);

    // 1. before candidate creation
    try {
      emergency.assertCandidateCreationAllowed();
    } catch (error) {
      return {
        ...base,
        runId,
        isSelf: true,
        selfReason: selfTarget.reason,
        outcome: "EMERGENCY_STOPPED",
        detail: `evolution is frozen by the Owner: ${String((error as Error).message)}`,
        sandboxMechanism: killSwitch.status().state,
        finishedAt: new Date().toISOString()
      };
    }

    // 2. freeze the base SHA —a Candidate can only ever be built on this commit.
    const baseSha = selfTarget.stableHeadSha ?? (await headSha(stableRoot));
    const candidate: CandidateWorkspace = await createCandidateWorkspace({
      stableRoot,
      evolutionRoot: this.options.evolutionRoot,
      baseSha,
      runId
    });
    const layout = candidate.layout;
    materializeEvolutionLayout(layout);

    // 3. initialize authority with a ledger OUTSIDE the Candidate.
    const ledgerFile = path.join(path.resolve(this.options.governanceRoot), "root-audit-ledger.jsonl");
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    const authority = new RootAuthority({ root: layout.workspace, ledgerFile, runId, candidateSha: baseSha, actor: "self-evolution-coordinator" });

    const context: EvolutionRunContext = {
      runId,
      candidateRoot: layout.root,
      candidateWorkspace: layout.workspace,
      stableRoot,
      baseSha,
      ledgerFile,
      evidenceDirectory: layout.evidence
    };
    this.registry.register(context);
    const host = new EvolutionHostOperations(context, authority, this.options.hostHandlers);
    const sandboxProbe = await this.options.sandbox.probe();

    const supervisor = new CandidateSupervisor({ layout, timeoutMs: this.options.candidateTimeoutMs ?? 45 * 60 * 1000 });
    let promotion: PromotionController | undefined;
    let summary: EngineeringLoopSummary | undefined;
    let changedFiles: string[] = [];

    try {
      const supervised = await supervisor.supervise(async ({ signal, setState }) => {
        if (signal.aborted) throw new Error("candidate aborted before start");

        // 4. sandboxed execution profile for everything the Candidate runs.
        const readOnlyRoots = [path.dirname(process.execPath), path.join(stableRoot, "node_modules")].filter((root) => fs.existsSync(root));
        const environment = candidateEnvironment(process.env, {
          inject: {
            TEMP: layout.temp,
            TMP: layout.temp,
            TMPDIR: layout.temp,
            CODEX_BOSS_EVOLUTION_RUN: layout.runId,
            CODEX_BOSS_EVOLUTION_NAMESPACE: layout.processNamespace,
            CODEX_BOSS_EVOLUTION_ROOT: layout.root,
            CODEX_BOSS_DATA_DIR: layout.runtimeData,
            ELECTRON_RUN_AS_NODE: "1"
          }
        });
        const commandSandbox = new SandboxedCommandRunner(
          this.options.sandbox,
          {
            layout,
            containerName: layout.processNamespace,
            readOnlyRoots,
            controlDirectory: layout.journal,
            evidenceDirectory: layout.evidence,
            activeProcessLimit: 1,
            toolchainRoot: stableRoot
          },
          // §11 checkpoint 2 of 6: before candidate process spawn. A freeze that
          // lands mid-run aborts the in-flight Candidate here.
          () => {
            this.assertCandidateProcessSpawnAllowed("freeze before a Candidate subprocess", supervisor, runId);
          }
        );
        // The Phase 0 execution profile stays the classification authority; the
        // subclass only redirects the spawn through the OS sandbox.
        class SandboxedEvolutionProfile extends EvolutionExecutionProfile {
          constructor() {
            super({ root: layout.workspace, authority, environment, actor: "evolution-worker" });
          }
          async runHostSelected(command: AllowedCommand, files: string[] = []) {
            authority.classify({ operation: command === "test" ? "candidate.test" : "candidate.build", detail: `sandboxed ${command}`, actor: "evolution-worker" });
            const args = commandArgv(layout.workspace, command, files, stableRoot);
            const outcome = await commandSandbox.run({ command, args, cwd: layout.workspace, env: this.childEnvironment() });
            // The real argv, exit code and transcript are reported unchanged so a
            // failing Candidate check gives the loop real diagnostics to work on.
            return { command, args, passed: outcome.passed, exitCode: outcome.exitCode, output: outcome.output };
          }
        }
        const profile = new SandboxedEvolutionProfile();
        // Touch the profile so the credential-free post-condition is enforced.
        profile.childEnvironment();

        setState("WORKING");
        const goal = this.buildGoal(request, layout.workspace);
        const loopStore = new EngineeringLoopStore(path.join(layout.journal, "engineering-loop.json"));
        loopStore.freezeGoal(goal);
        const live = createLiveEngineeringOperations({
          workspace: layout.workspace,
          goal,
          worker: this.options.worker,
          checkOptions: { env: sanitizeEnvironment(environment as NodeJS.ProcessEnv), sandbox: commandSandbox }
        });
        const operations = createRepoEngineeringOperations({
          workspace: layout.workspace,
          env: sanitizeEnvironment(environment as NodeJS.ProcessEnv),
          sandbox: commandSandbox,
          implement: this.options.implement ?? ((finding) => live.implement(goal, finding)),
          review: this.options.review ?? ((finding, files, evidence) => live.review(goal, finding, files, evidence))
        });
        summary = await new EngineeringLoopDriver({ store: loopStore, operations, maxIterations: request.maxIterations ?? 4 }).run();

        setState("VERIFYING");
        // 5. before verify
        emergency.assertCandidateCreationAllowed();

        setState("REVIEWING");
        await host.execute({ kind: "git.commitCandidate", message: `evolution(${runId}): ${request.objective.slice(0, 64)}` });
        const candidateHeadSha = await host.execute<string>({ kind: "git.candidateHead" });

        // 6. real change set from git, then the protected-surface guard (S8).
        const entries = await host.execute<ChangeEntry[]>({ kind: "git.nameStatus", baseSha, headSha: candidateHeadSha });
        changedFiles = entries.map((entry) => entry.path);
        const surfaceChanges: SurfaceChange[] = entries.map((entry) => ({
          path: entry.path,
          kind: entry.status === "A" ? "create" : entry.status === "D" ? "delete" : entry.status === "R" ? "rename" : "write",
          ...(entry.from ? { from: entry.from } : {})
        }));
        const guard = new ProtectedSurfaceGuard({ root: layout.workspace });
        const assessment = guard.assessChanges(surfaceChanges);

        // 7. the promotion controller, wired to the Root ledger and the freeze switch.
        const exactShaGate = new ExactShaGate(layout.workspace);
        promotion = new PromotionController({
          storeFile: path.join(path.resolve(this.options.governanceRoot), "runs", `${runId}-promotion.json`),
          runId,
          authority,
          exactShaGate,
          emergency,
          stableSha: baseSha
        });
        const credential = (this.options.credentialProvider ?? new EnvironmentBossGitHubCredentialProvider({ rootOwner: authority.rootOwner })).getAutomationCredential();
        const blockedReason = credential.status === "AVAILABLE" ? undefined : credential.requiredExternalAction;
        if (blockedReason) promotion.setExternalBlocker(blockedReason);
        setState("COMPLETED");
        return { candidateHeadSha, assessment, summary, changedFiles, blockedReason };
      });

      if (!supervised.ok) {
        await this.persist(host, runId, {
          runId,
          outcome: "CANDIDATE_FAILED",
          detail: supervised.error ?? supervised.state,
          baseSha,
          changedFiles,
          journal: supervised.journal
        });
        return {
          ...base,
          runId,
          isSelf: true,
          selfReason: selfTarget.reason,
          outcome: "CANDIDATE_FAILED",
          detail: supervised.error ?? `candidate ended in ${supervised.state}`,
          baseSha,
          candidateWorkspace: layout.workspace,
          changedFiles,
          loopState: summary?.state,
          candidateJournal: supervised.journal,
          sandboxMechanism: sandboxProbe.mechanism,
          sandboxActive: sandboxProbe.available,
          evidenceFile,
          finishedAt: new Date().toISOString()
        };
      }

      const value = supervised.value as {
        candidateHeadSha: string;
        assessment: { decision: string; protected: Array<{ path: string }> };
        summary: EngineeringLoopSummary;
        changedFiles: string[];
        blockedReason?: string;
      };
      const protectedPaths = value.assessment.protected.map((hit) => hit.path);

      // 8/9. local promotion decision followed by remote promotion. The exact-SHA
      // contract means a promotion decision without CI evidence is a rejection,
      // so the order is: push -> PR -> read validate -> evaluate -> merge. A Root
      // Surface change still reaches a PR and a CI PASS; it stops there.
      const remote = await this.attemptRemotePromotion(
        host,
        promotion!,
        value.candidateHeadSha,
        request,
        layout,
        value.changedFiles,
        value.summary,
        value.blockedReason
      );
      const outcome = remote.outcome;
      const blockedExternal = remote.blockedExternal;

      const report: SelfEvolutionRunReport = {
        ...base,
        runId,
        isSelf: true,
        selfReason: selfTarget.reason,
        outcome,
        detail: promotion?.record().reasons.join(", ") || outcome,
        baseSha,
        candidateWorkspace: layout.workspace,
        candidateHeadSha: value.candidateHeadSha,
        changedFiles: value.changedFiles,
        protectedPaths,
        promotionState: promotion?.record().state,
        loopState: value.summary.state,
        candidateJournal: supervised.journal,
        blockedExternal,
        sandboxMechanism: sandboxProbe.mechanism,
        sandboxActive: sandboxProbe.available,
        evidenceFile,
        finishedAt: new Date().toISOString()
      };
      await this.persist(host, runId, report);
      return report;
    } finally {
      this.registry.release(runId);
    }
  }

  private async attemptRemotePromotion(
    host: EvolutionHostOperations,
    promotion: PromotionController,
    candidateHeadSha: string,
    request: SelfEvolutionTaskRequest,
    layout: EvolutionLayout,
    changedFiles: readonly string[],
    summary: EngineeringLoopSummary,
    blockedReason?: string
  ): Promise<{ outcome: SelfEvolutionOutcome; blockedExternal?: string }> {
    const { emergency } = this.governanceHandles();
    const branch = layout.candidateBranch;
    const reviewerClean = summary.state === "ENGINEERING_CONVERGED" || summary.state === "OPTIONAL_IMPROVEMENTS";
    const title = `Autonomous evolution ${request.runId ?? ""}`.trim();

    // No dedicated Boss identity: the run parks in BLOCKED_EXTERNAL with the
    // exact external action the Owner must take. Nothing is pushed.
    if (blockedReason) {
      const parked = await promotion.evaluate({
        binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
        requiredChecksPassed: false,
        branchUpToDate: true,
        reviewerClean,
        changedFiles
      });
      return { outcome: mapPromotionOutcome(parked.state), blockedExternal: blockedReason };
    }

    // before PR creation
    emergency.assertCandidateCreationAllowed();

    const push = await host.execute<{ status: string; reason?: string; requiredExternalAction?: string; value?: { sha: string } }>({
      kind: "promote.pushBranch",
      branch,
      sha: candidateHeadSha
    });
    if (push.status !== "OK") {
      const reason = push.requiredExternalAction ?? push.reason ?? "push failed";
      promotion.setExternalBlocker(reason);
      const parked = await promotion.evaluate({
        binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
        requiredChecksPassed: false,
        branchUpToDate: true,
        reviewerClean,
        changedFiles
      });
      return { outcome: mapPromotionOutcome(parked.state), blockedExternal: reason };
    }

    const opened = await host.execute<{ status: string; value?: { number: number; headSha: string }; reason?: string; requiredExternalAction?: string }>({
      kind: "promote.openPullRequest",
      head: branch,
      title,
      body: `Owner goal: ${request.objective}`
    });
    if (opened.status !== "OK" || !opened.value) {
      const reason = opened.requiredExternalAction ?? opened.reason ?? "pull request creation failed";
      promotion.setExternalBlocker(reason);
      const parked = await promotion.evaluate({
        binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
        requiredChecksPassed: false,
        branchUpToDate: true,
        reviewerClean,
        changedFiles
      });
      return { outcome: mapPromotionOutcome(parked.state), blockedExternal: reason };
    }
    promotion.recordPullRequest(opened.value.number, opened.value.headSha);

    const check = await host.execute<{ status: string; value?: { conclusion: string | null }; reason?: string }>({ kind: "promote.readCheck", sha: opened.value.headSha });
    const checked = check.status === "OK" && check.value?.conclusion === "success";
    // The exact-SHA gate has the last word: a stale PASS may not promote.
    const evaluated = await promotion.evaluate({
      binding: { candidateHeadSha, ciValidatedSha: checked ? opened.value.headSha : null, prHeadSha: opened.value.headSha, promotionSha: candidateHeadSha },
      requiredChecksPassed: checked,
      branchUpToDate: true,
      reviewerClean,
      changedFiles
    });
    if (evaluated.state !== "PROMOTABLE") return { outcome: mapPromotionOutcome(evaluated.state) };

    // before beginPromotion
    emergency.assertPromotionAllowed();
    promotion.beginPromotion();
    // immediately before merge
    emergency.assertPromotionAllowed();
    const head = await host.execute<{ status: string; value?: { headSha: string }; reason?: string }>({ kind: "promote.readPullRequest", prNumber: opened.value.number });
    if (head.status !== "OK" || head.value?.headSha !== candidateHeadSha) {
      promotion.setExternalBlocker("PR head SHA changed after validation; the previous CI PASS is void");
      const stale = await promotion.evaluate({
        binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: head.value?.headSha ?? null, promotionSha: candidateHeadSha },
        requiredChecksPassed: false,
        branchUpToDate: true,
        reviewerClean,
        changedFiles
      });
      return { outcome: mapPromotionOutcome(stale.state) };
    }
    const merged = await host.execute<{ status: string; value?: { sha: string }; reason?: string; requiredExternalAction?: string }>({
      kind: "promote.merge",
      prNumber: opened.value.number,
      sha: candidateHeadSha,
      title
    });
    if (merged.status !== "OK") {
      const reason = merged.requiredExternalAction ?? merged.reason ?? "merge failed";
      promotion.markBlockedExternal(reason);
      return { outcome: "BLOCKED_EXTERNAL", blockedExternal: reason };
    }
    promotion.completePromotion(candidateHeadSha);
    return { outcome: "PROMOTED" };
  }

  /**
   * §20 —after a merge, Stable N+1 is marked, restarted and health-checked.
   * A failed acceptance rolls back to Stable N.
   */
  async acceptPromotedRuntime(input: {
    runId: string;
    previousStableSha: string;
    promotedSha: string;
    pointerFile: string;
    bootProbe: () => Promise<{ accepted: boolean; detail: string; stableStillRunning: boolean; candidateExited: boolean }>;
  }): Promise<StablePointerRecord> {
    const pointer = new StableRuntimePointer({ pointerFile: input.pointerFile, stableRoot: path.resolve(this.options.stableRoot) });
    pointer.initialize(input.previousStableSha);
    pointer.markNext(input.previousStableSha, input.promotedSha);
    const isolation = planCandidateRuntimeIsolation({
      runId: input.runId,
      runtimeData: path.join(path.resolve(this.options.evolutionRoot), input.runId, "runtime-data"),
      processNamespace: `codex-boss-evolution-${input.runId}`
    });
    pointer.recordRestart({
      at: new Date().toISOString(),
      mechanism: "candidate-acceptance-entrypoint",
      isolation: isolation.isolated,
      stableStillRunning: true,
      candidateExited: false,
      detail: `acceptance entrypoint ${isolation.acceptanceEntrypoint} with ${isolation.dataDirArgument}`
    });
    const probe = await input.bootProbe();
    pointer.recordBoot(input.promotedSha, probe.accepted, probe.detail);
    if (!probe.accepted) {
      return pointer.rollback(`boot acceptance failed: ${probe.detail}`, input.previousStableSha);
    }
    return pointer.commitPointer(input.promotedSha);
  }

  /**
   * §20/§21 — runs the shipped Candidate boot acceptance entry point and turns
   * its real observations into the pointer record. Nothing here is asserted on
   * the Candidate's behalf: the process is really started, really given a
   * bounded window, and really asked whether Stable survived.
   */
  async runBootAcceptance(input: {
    runId: string;
    candidateWorkspace: string;
    runtimeData: string;
    processNamespace: string;
    pointerFile: string;
    previousStableSha: string;
    promotedSha: string;
    timeoutMs?: number;
    stablePid?: number;
  }): Promise<StablePointerRecord> {
    const script = path.resolve(__dirname, "..", "..", "scripts", "phase05-candidate-boot-acceptance.cjs");
    const reportFile = path.join(path.resolve(this.options.governanceRoot), "runs", `${input.runId}-boot.json`);
    return this.acceptPromotedRuntime({
      runId: input.runId,
      previousStableSha: input.previousStableSha,
      promotedSha: input.promotedSha,
      pointerFile: input.pointerFile,
      bootProbe: async () => {
        if (!fs.existsSync(script)) {
          return { accepted: false, detail: `boot acceptance entry point is missing: ${script}`, stableStillRunning: false, candidateExited: false };
        }
        const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn(process.execPath, [
            script,
            "--candidate",
            input.candidateWorkspace,
            "--runtime-data",
            input.runtimeData,
            "--namespace",
            input.processNamespace,
            "--timeout-ms",
            String(input.timeoutMs ?? 120_000),
            "--out",
            reportFile,
            ...(input.stablePid ? ["--stable-pid", String(input.stablePid)] : [])
          ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (chunk) => {
            stdout += String(chunk);
          });
          child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
          });
          child.on("error", () => resolve({ code: null, stdout, stderr }));
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        });
        if (outcome.code !== 0) {
          return { accepted: false, detail: `boot acceptance exited ${outcome.code}: ${outcome.stderr.slice(-400)}`, stableStillRunning: false, candidateExited: true };
        }
        try {
          const parsed = JSON.parse(fs.readFileSync(reportFile, "utf8")) as {
            accepted: boolean;
            detail: string;
            stableStillRunning: boolean;
            candidateExited: boolean;
          };
          return { accepted: parsed.accepted, detail: parsed.detail, stableStillRunning: parsed.stableStillRunning, candidateExited: parsed.candidateExited };
        } catch (error) {
          return { accepted: false, detail: `boot acceptance report unreadable: ${String((error as Error).message)}`, stableStillRunning: false, candidateExited: false };
        }
      }
    });
  }

  private buildGoal(request: SelfEvolutionTaskRequest, workspace: string): EngineeringGoalContract {
    const provided = request.goal;
    const now = new Date().toISOString();
    const objective = provided?.objective ?? request.objective;
    return {
      schemaVersion: 1,
      id: provided?.id ?? `eng-${request.runId ?? request.taskId}`,
      createdAt: now,
      objective,
      workspace,
      protectedProductBehavior: provided?.protectedProductBehavior ?? ["no Root Surface change"],
      allowedChangeScope: provided?.allowedChangeScope ?? ["non-Root source, tests and documentation"],
      forbiddenChangeScope: provided?.forbiddenChangeScope ?? [".github", "electron/root-authority", "electron/promotion-gate"],
      verificationPolicy: provided?.verificationPolicy ?? "standard",
      agentCount: provided?.agentCount ?? 1,
      convergencePolicy: provided?.convergencePolicy ?? { cleanRoundsRequired: 1 }
    } as EngineeringGoalContract;
  }

  private async persist(host: EvolutionHostOperations, runId: string, payload: unknown): Promise<void> {
    try {
      await host.execute({ kind: "evidence.persist", name: `runs/${runId}.json`, payload });
    } catch {
      // Evidence persistence must never be the reason a run fails; the durable
      // root ledger already records every decision.
    }
  }
}

function mapPromotionOutcome(state: PromotionState): SelfEvolutionOutcome {
  switch (state) {
    case "PROMOTED":
      return "PROMOTED";
    case "WAITING_FOR_ROOT_OWNER":
      return "WAITING_FOR_ROOT_OWNER";
    case "BLOCKED_EXTERNAL":
      return "BLOCKED_EXTERNAL";
    case "ROLLED_BACK":
      return "ROLLED_BACK";
    default:
      return "REJECTED";
  }
}

/** Host-computed argv, mirroring `command-runner`'s allow-list exactly. */
/**
 * Host-computed argv, mirroring `command-runner`'s allow-list exactly.
 *
 * A fresh Candidate worktree has no `node_modules` (a `git worktree add` does
 * not create one), so the tool entry point falls back to the read-only Stable
 * toolchain, which the sandbox exposes to the Candidate as a read grant. The
 * *arguments* are still host-selected; only the executable's location moves.
 */
export function commandArgv(root: string, command: AllowedCommand, files: string[], toolchainRoot?: string): string[] {
  const absolute = files.map((file) => path.resolve(root, file));
  const tool = (relative: string): string | undefined => {
    const local = path.join(root, "node_modules", relative);
    if (fs.existsSync(local)) return local;
    const shared = toolchainRoot ? path.join(toolchainRoot, "node_modules", relative) : undefined;
    return shared && fs.existsSync(shared) ? shared : undefined;
  };
  if (command === "test") {
    const vitest = tool(path.join("vitest", "vitest.mjs"));
    return vitest ? [vitest, "run", "--maxWorkers=2", ...absolute] : ["--test", ...absolute];
  }
  if (command === "lint") {
    const eslint = tool(path.join("eslint", "bin", "eslint.js"));
    return [eslint ?? path.join(root, "node_modules", "eslint", "bin", "eslint.js"), ...(absolute.length ? absolute : [root])];
  }
  const tsc = tool(path.join("typescript", "bin", "tsc"));
  return [tsc ?? path.join(root, "node_modules", "typescript", "bin", "tsc"), ...(command === "typecheck" ? ["--noEmit"] : ["--build"])];
}

/** Rewrites `git diff --name-status` output for the protected-surface guard. */
export function changeEntriesToSurfaceChanges(entries: readonly ChangeEntry[]): SurfaceChange[] {
  return entries.map((entry) => ({
    path: entry.path,
    kind: entry.status === "A" ? "create" : entry.status === "D" ? "delete" : entry.status === "R" ? "rename" : "write",
    ...(entry.from ? { from: entry.from } : {})
  }));
}

/** Default host git handlers backed by the real repository. */
export function createDefaultHostHandlers(base: {
  persistEvidence(file: string, payload: unknown): void;
  promotion: Omit<HostOperationHandlers, "commitCandidate" | "nameStatus" | "candidateHead" | "persistEvidence">;
  diffRunner?: (input: { workspace: string; baseSha: string; headSha: string }) => Promise<string>;
}): Pick<HostOperationHandlers, "commitCandidate" | "nameStatus" | "candidateHead" | "persistEvidence"> {
  return {
    commitCandidate: async ({ workspace, message }) => commitCandidate(workspace, message),
    candidateHead: async ({ workspace }) => {
      const files = await candidateChangedFiles(workspace, "HEAD");
      void files;
      return headSha(workspace);
    },
    nameStatus: async ({ workspace, baseSha, headSha: _headSha }) => {
      const output = base.diffRunner
        ? await base.diffRunner({ workspace, baseSha, headSha: _headSha })
        : await runGitNameStatus(workspace, baseSha, _headSha);
      return parseNameStatus(output);
    },
    persistEvidence: async ({ name, payload }) => {
      base.persistEvidence(name, payload);
      return name;
    }
  };
}

async function runGitNameStatus(workspace: string, baseSha: string, headSha: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile("git", ["diff", "--name-status", "--find-renames", `${baseSha}...${headSha}`], { cwd: workspace, windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr) || String(error.message)));
      else resolve(String(stdout));
    });
  });
}

export { GitHubPromotionAdapter, removeCandidateWorkspace, evolutionLayout };
