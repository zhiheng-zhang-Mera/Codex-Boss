# Self-mutation surface audit — every side effect reachable from Self-Evolution

**Requirement:** `Update-Plan/Alien-Prestart.md` §18 ("Production side-effect
inventory"). Surrounding contracts: §7.3 (mandatory mutating-seam assertion), §8
(reuse of the existing engineering loop), §9 (hard execution sandbox), §10
(executed-code red team), §11 (Emergency Control at six production checkpoints),
§19 (Self-Evolution must not inherit ordinary Computer Use capability), §20
(Stable update and restart).

**Method:** static enumeration with `grep` over `electron/**/*.ts` and
`scripts/**/*.cjs` (exact patterns and match counts in §10.1), then classification by
reading the code and the coordinator's composition. Plus a dynamic section (§7)
recording what `tests/unit/evolution-sandbox.test.ts` actually asserts after
executing real Candidate code.

**Status of the evidence in this document.** No build and no test command was run
while writing it. The static inventory and every classification below were derived
by reading source; the dynamic section records what the executed-code red-team
**asserts**, quoting its expectations verbatim, and is explicitly *not* a claim
that the suite passed on this machine today (`evidence/S6-sandbox-red-team.json`
does not exist). Where a recorded developer observation is the only support for a
statement, it is labelled as such.

**Label set.** Every entry carries exactly one label:

| Label | Meaning used throughout this document |
|---|---|
| `NOT_REACHABLE_FROM_SELF_EVOLUTION` | No import edge, construction edge or injected-collaborator path from `SelfEvolutionCoordinator` reaches the site. The site cannot run during a Self-Evolution run. |
| `HOST_GUARDED` | The site is reachable, but every input that determines *what* happens (argv, target path, branch, SHA, workspace) is computed by host code the Candidate cannot author, and/or the request is classified by `RootAuthority` / refused by `assertMutationAllowed` before the handler runs. The Candidate contributes content; the host contributes authority. |
| `SANDBOXED` | The side effect occurs inside the AppContainer + Job Object process created by `WindowsAppContainerSandbox`, subject to explicit ACL grants. |
| `ROOT_DENIED` | The operation's `ROOT_OPERATION_FLOOR` is `DENY`; `RootAuthority.enforce` throws `RootDeniedError` before any handler or side effect. |
| `OWNER_REQUIRED` | The operation's floor or policy is `REQUIRE_OWNER`; the run parks in `WAITING_FOR_ROOT_OWNER` and no side effect occurs until an Owner approval bound to the exact SHA exists. |

There is no `UNKNOWN` entry (see §10).

---

## 1. The reachability spine

Everything in this audit follows from one composition root, and the audit's
"reachable" claims are the import list of that file plus the production
collaborators injected into it.

`electron/self-evolution/self-evolution-coordinator.ts` imports, in full:

```
node:child_process                       (spawn, dynamic execFile)
node:fs, node:path
../credential-boundary/sanitized-environment      sanitizeEnvironment
../credential-boundary/credential-boundary        candidateEnvironment
../credential-boundary/github-credential-provider EnvironmentBossGitHubCredentialProvider
../promotion-gate/exact-sha-gate                  ExactShaGate
../promotion-gate/github-promotion-adapter        GitHubPromotionAdapter, GitHubTransport
../promotion-gate/promotion-controller            PromotionController
../root-authority/root-authority                  RootAuthority
../root-authority/execution-profile               EvolutionExecutionProfile
../root-authority/protected-surface-guard         ProtectedSurfaceGuard, SurfaceChange
../stable-candidate/candidate-supervisor          CandidateSupervisor
../stable-candidate/runtime-isolation             materializeEvolutionLayout, evolutionLayout
../stable-candidate/workspace-manager             createCandidateWorkspace, commitCandidate, headSha, removeCandidateWorkspace, candidateChangedFiles
../emergency-control/emergency-control            EmergencyControl
../emergency-control/evolution-kill-switch        EvolutionKillSwitch
../../src/shared/root-authority/promotion-state   PromotionState
../engineering/engineering-loop-driver            EngineeringLoopDriver
../engineering/engineering-loop-store             EngineeringLoopStore
../engineering/repo-engineering-operations        createRepoEngineeringOperations
../engineering/live-engineering-operations        createLiveEngineeringOperations, EngineeringRoleWorker
../engineering/command-runner                     CommandSandbox, CommandSandboxOutcome, AllowedCommand
./sandbox/sandbox-backend                         EvolutionSandbox, SandboxedProcessResult
./self-target-resolver                            SelfTargetResolver, SelfTargetResolution
./mutation-context                                evolutionRuns, EvolutionRunContext, EvolutionRunRegistry
./host-operations                                 EvolutionHostOperations, HostOperationHandlers, parseNameStatus
./stable-runtime-pointer                          StableRuntimePointer, planCandidateRuntimeIsolation
```

Two observations carry most of the audit:

1. **There is no edge to `electron/computer/**`, `electron/provider-views.ts`,
   `electron/provider-automation.ts`, `electron/remote-relay.ts` or
   `electron/workspace/**`.** Not from the coordinator, and not transitively
   through the modules above (§5 verifies this and states the one exception).
2. **The coordinator drives the engineering loop through two different containers
   at once**: `createRepoEngineeringOperations` (which receives
   `sandbox: commandSandbox`) and `createLiveEngineeringOperations` (which reaches
   `ProposalRunner`, and from there `verification.runCheck`, which receives no
   sandbox at all). §4.2 records that asymmetry as its own entry, because it is
   the single largest honest gap in the containment story.

Production wiring (`electron/main.ts` → `createSelfEvolutionHost`,
`electron/commander/main-commander.ts` → `selfEvolution.runTask`) adds exactly two
injected collaborators: the `HostOperationHandlers` object and the
`EngineeringRoleWorker`. Both are audited as separate entries (§3.3 and §5.2).

---

## 2. Summary of labels

| Group | Label(s) assigned |
|---|---|
| `electron/self-evolution/**` (coordinator, host, host-operations, guards, sandbox driver) | `HOST_GUARDED`; `OWNER_REQUIRED` for the Owner-gated kill-switch operations |
| `electron/self-evolution/sandbox/**` (AppContainer backend, launcher) | `SANDBOXED` |
| `electron/engineering/**` reached by the coordinator | `SANDBOXED` (audit/build/test through `SandboxedCommandRunner`) and `HOST_GUARDED` (Candidate writes, `ProposalRunner` verification, read-only git inspection) |
| `electron/engineering/**` not driven by the coordinator (`merge-coordinator`, `gate-runner`, `change-points`, `workspace`) | `NOT_REACHABLE_FROM_SELF_EVOLUTION`, each with the reason it is nonetheless guarded or unused |
| `electron/stable-candidate/**` | `HOST_GUARDED` |
| `electron/emergency-control/**` | `HOST_GUARDED` (freeze path) + `OWNER_REQUIRED` (clear / sentinel) |
| `electron/promotion-gate/**` incl. `github-promotion-adapter.ts` | `HOST_GUARDED`, plus `OWNER_REQUIRED` when the change set hits the Root Surface |
| `electron/root-authority/**`, `electron/credential-boundary/**` | `HOST_GUARDED` (decision + ledger writes), `ROOT_DENIED` for the floor-DENY vocabulary |
| `electron/root-recovery/rollback-controller.ts` | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `electron/computer/**`, `provider-views.ts`, `remote-relay.ts`, `workspace/**` | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `electron/provider-automation.ts` | `HOST_GUARDED` (reached only through the injected role worker; not covered by the import-graph argument) |
| `scripts/**` | `HOST_GUARDED` (one script is spawned by the coordinator) and `NOT_REACHABLE_FROM_SELF_EVOLUTION` (all the rest) |
| remaining `electron/**` modules | `NOT_REACHABLE_FROM_SELF_EVOLUTION` (outside the coordinator's import closure) |

No site was left unclassified.

---

## 3. `electron/self-evolution/**`

### 3.1 Coordinator and its directly-owned side effects

| Entry (path · exported symbol) | Side effect | How it is reached | Label |
|---|---|---|---|
| `self-evolution-coordinator.ts` · `SelfEvolutionCoordinator.run` | `fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })` | Host bookkeeping: creates `<governanceRoot>/` before constructing `RootAuthority`. `governanceRoot` is host-chosen and lives outside both Stable and the Candidate. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `runGitNameStatus` (module-private) | `execFile("git", ["diff", "--name-status", "--find-renames", base…head])` | Read-only inspection with host-computed argv; `cwd` is the Candidate worktree. Only reached via `host.execute({ kind: "git.nameStatus" })`, i.e. after `RootAuthority` classifies `candidate.git.inspect`. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `runBootAcceptance` | `spawn(process.execPath, [scripts/phase05-candidate-boot-acceptance.cjs, …])`, `fs.readFileSync(reportFile)`, and the report write performed by that script | The **only unsandboxed process launch the coordinator itself performs**. It happens *after* promotion, to prove Stable N+1 boots while Stable N is still running (§20/§21). Argv is entirely host-computed (`--candidate`, `--runtime-data`, `--namespace`, `--timeout-ms`, `--out`, optional `--stable-pid`); nothing Candidate-authored reaches it. It deliberately does not go through `EvolutionSandbox` because its subject is the promoted Stable binary, not a Candidate child. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `createDefaultHostHandlers` | Git-backed `commitCandidate` / `candidateHead` / `nameStatus` / `persistEvidence` for hosts that do not inject their own handlers | Same reasoning as above: host argv, host cwd, classified by `RootAuthority`. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `SandboxedCommandRunner` | *Every* Candidate build/test child: `this.sandbox.run({ executable: process.execPath, args, cwd, environment, grants: [layout.root write, …readOnlyRoots read], activeProcessLimit: 1, … })` | The coordinator's sanctioned route for Candidate subprocesses (§9). `environment` is `candidateEnvironment(process.env, …)` (credential-filtered, credential-free post-condition enforced by `EvolutionExecutionProfile`'s constructor). | `SANDBOXED` |
| `self-evolution-coordinator.ts` · `SandboxedEvolutionProfile.runHostSelected` | Delegates to the same `SandboxedCommandRunner` | Constructed inside `supervise`; the override is what makes the profile's classification authority agree with the sandbox. | `SANDBOXED` |
| `self-evolution-coordinator.ts` · `assertCandidateProcessSpawnAllowed` | Re-freezes the kill switch and aborts the in-flight Candidate when a freeze is already present at spawn time | Freeze checkpoint 2 of 6. Writes only the governance freeze record and the Candidate journal. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `attemptRemotePromotion` | `host.execute({ kind: "promote.pushBranch" / "promote.openPullRequest" / "promote.readCheck" / "promote.readPullRequest" / "promote.merge" })` | See §6.3 — all five are `RootAuthority`-classified host operations against `GitHubPromotionAdapter`. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `acceptPromotedRuntime`, `runBootAcceptance` | `StableRuntimePointer.markNext` / `recordRestart` / `recordBoot` / `rollback` / `commitPointer` → `writeJson(pointerFile)` into `<governanceRoot>/stable-pointer.json` | Host state, outside both trees. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `persist` | `host.execute({ kind: "evidence.persist" })` → `persistEvidence` → `fs.mkdirSync` + `fs.writeFileSync` into `<governanceRoot>/runs/<runId>.json` | Root-authority-classified `evidence.write` (floor `ALLOW`). Failures are swallowed so evidence can never be the reason a run dies. | `HOST_GUARDED` |
| `self-evolution-coordinator.ts` · `buildGoal` | `forbiddenChangeScope` default `[".github", "electron/root-authority", "electron/promotion-gate"]` | Goal contract handed to the loop; a declaration, not an enforcement point (enforcement is `ProtectedSurfaceGuard` at §12/promotion time). | `HOST_GUARDED` |
| `mutation-guard.ts` · `assertMutationAllowed`, `assessMutation`, `configureMutationGuard`, `targetsBossRepository` | *Refusal* rather than a side effect; module-level config + in-memory resolver cache | Called from `electron/engineering/verification.ts` `applyScopedChanges` and `electron/engineering/workspace.ts` `prepareWorkspace` / `prepareStepWorkspace` (§7.3). Throws `SelfMutationDeniedError` when the target is the Boss repository and no `EvolutionRunContext` covers it. Because the default config is derived from where the module lives (`repositoryRoot()`), a *future* seam added without configuration is still guarded. | `HOST_GUARDED` |
| `mutation-context.ts` · `EvolutionRunRegistry`, `evolutionRuns`, `assertSelfMutationContext`, `guardSelfMutation` | In-memory only; no filesystem side effect. Deliberately not durable, so a restarted process cannot inherit a run's authority. | Consulted by the guard above. | `HOST_GUARDED` |
| `self-target-resolver.ts` · `SelfTargetResolver.resolve` | `execFileSync("git", …)` read-only (`rev-parse`, `remote get-url`, common-dir inspection) | Read-only host fact resolution; argv is host-authored. | `HOST_GUARDED` |
| `stable-runtime-pointer.ts` · `StableRuntimePointer` | `fs.mkdirSync(path.dirname(pointerFile))` + `writeJson(pointerFile, record)` | Governance root, outside both trees. | `HOST_GUARDED` |

### 3.2 `self-evolution-host.ts` — the production composition root

| Entry | Side effect | How it is reached | Label |
|---|---|---|---|
| `createSelfEvolutionHost` | `fs.mkdirSync(governanceRoot, { recursive: true })` | Host-owned governance directory. | `HOST_GUARDED` |
| `createSelfEvolutionHost` | `configureMutationGuard({ stableRoot, productRepository, registry, resolver })` | Installs the §7.3 guard for the real installation. No filesystem effect. | `HOST_GUARDED` |
| `createSelfEvolutionHost` | Constructs `EvolutionKillSwitch` (control file + sentinel + `candidateRoots: [evolutionRoot]`) and `EmergencyControl` | The kill-switch constructor *refuses* a control or sentinel file inside a candidate root (`EvolutionFrozenError`). | `HOST_GUARDED` |
| `createSelfEvolutionHost` | Constructs `WindowsAppContainerSandbox({ launcherRoot: <userData>/sandbox, candidateRoot: evolutionRoot, denyRoots: [stableRoot] })` | See §9 item 2 for the deny-root/toolchain-grant interaction, which is a stated limitation. | `HOST_GUARDED` |
| `createGitHostHandlers` · `commitCandidate` | `git add -A`, `git -c user.name=… -c user.email=… commit -m <host message>`, `git rev-parse HEAD` — `cwd` = **Candidate** worktree | Reached only through `host.execute({ kind: "git.commitCandidate" })` → `RootAuthority.classify({ operation: "candidate.workspace.write" })` → handler receives `context.candidateWorkspace`. Candidate history is written by the host only; a Candidate process cannot run `git commit` (the classifier in `execution-profile.ts` denies that subcommand outright). | `HOST_GUARDED` |
| `createGitHostHandlers` · `candidateHead`, `nameStatus` | `git rev-parse HEAD`, `git diff --name-status --find-renames base…head` | Read-only. | `HOST_GUARDED` |
| `createGitHostHandlers` · `persistEvidence` | `fs.mkdirSync` + `fs.writeFileSync` under `<governanceRoot>` | Outside both trees. | `HOST_GUARDED` |
| `createGitHostHandlers` · `markNextStable`, `recordBoot`, `commitStablePointer` | **No-ops** (`async () => {}`) | The `stable.*` host operations are therefore ledger-recorded but have no host effect in production. The real pointer state is driven by `StableRuntimePointer` inside `SelfEvolutionCoordinator.acceptPromotedRuntime` / `runBootAcceptance`. This is a genuine wiring observation, not a hidden one. | `HOST_GUARDED` |
| `createGitHostHandlers` · `rollbackStable` | Returns `{ ok: true, detail: "rollback is driven by the stable runtime pointer" }` **without executing anything** | See §9 item 6: `RollbackController`, the only code that would `git revert` on Stable, is not wired into this handler. §20's "failed acceptance rolls back to Stable N" is currently implemented as a **pointer record**, not as a git revert. | `HOST_GUARDED` |
| `detectRepositoryRoot` | `fs.existsSync(<path>/.git)` walk | Read-only. | `HOST_GUARDED` |

### 3.3 `host-operations.ts` — the closed host-operation vocabulary

`EvolutionHostOperations.execute` is a `switch` over a finite union; the `default`
branch is typed `never`, so an unknown kind cannot be executed. Before any handler
runs, `authorize()` calls `RootAuthority.classify` with the operation from
`OPERATION_FOR_KIND`, records the decision itself, and **throws** on `DENY`:

| Host operation kind | Classified as | Floor (`ROOT_OPERATION_FLOOR`) | Label |
|---|---|---|---|
| `git.commitCandidate` | `candidate.workspace.write` | `ALLOW` | `HOST_GUARDED` |
| `git.nameStatus`, `git.candidateHead` | `candidate.git.inspect` | `ALLOW` | `HOST_GUARDED` |
| `evidence.persist` | `evidence.write` | `ALLOW` | `HOST_GUARDED` |
| `stable.markNext`, `stable.recordBoot`, `stable.commitPointer` | `evidence.write` | `ALLOW` (handlers are no-ops in production) | `HOST_GUARDED` |
| `stable.rollback` | `candidate.rollback` | `ALLOW` (handler is a no-op in production) | `HOST_GUARDED` |
| `promote.pushBranch`, `promote.openPullRequest`, `promote.merge` | `promotion.execute` | `ALLOW` | `HOST_GUARDED` |
| `promote.readPullRequest`, `promote.readCheck`, `promote.readBranchSha` | `promotion.evaluate` | `ALLOW` | `HOST_GUARDED` |

`HOST_OPERATION_KINDS` is exported precisely so this finiteness can be asserted in
evidence. There is no "run this arbitrary thing on the host" kind.

### 3.4 `electron/self-evolution/sandbox/**`

| Entry | Side effect | Label |
|---|---|---|
| `windows-appcontainer-backend.ts` · `WindowsAppContainerSandbox.run` → `spawn(this.build.executable, [requestFile])` | Creates the AppContainer + Job Object process that performs the confined work. This *is* the boundary. The launcher is driven by a **request file**; it never parses a Candidate-supplied command line. | `SANDBOXED` |
| `windows-appcontainer/launcher-source.ts` · `SANDBOX_LAUNCHER_SOURCE` (compiled C#) | `CreateAppContainerProfile` / `DeriveAppContainerSidFromAppContainerName`, `SetAccessControl` (per-grant ACEs), `CreateProcessW` (suspended), `CreateJobObjectW` + `AssignProcessToJobObject` + `SetInformationJobObject(JOB_OBJECT_LIMIT_ACTIVE_PROCESS)` + `TerminateJobObject`, and an environment block built from the host-supplied set with the launcher's own environment wiped. | `SANDBOXED` |
| `windows-appcontainer-backend.ts` · `prepare` | Refuses any `request.grants` entry inside `denyRoots` **before the OS is asked**; derives `traverse` grants for ancestors inside the mapped tree, then the explicit grants, then constructor-level `readOnlyRoots`. | `SANDBOXED` |
| `windows-appcontainer-backend.ts` · `run` request/control files | `fs.mkdirSync(controlDirectory)`, `fs.writeFileSync(requestFile)`, `fs.rmSync(requestFile)` — all under the Candidate run's `journal/` directory, and `stdoutFile`/`stderrFile` under `evidence/`. | `HOST_GUARDED` |
| `windows-appcontainer-backend.ts` · `ensureLauncher` | `fs.writeFileSync(<launcherRoot>/SandboxLauncher.cs)`, `execFileSync(csc.exe, …)` to compile, `fs.renameSync(output, executable)`, `fs.writeFileSync(stampFile)`. `launcherRoot` is host-owned (`<userData>/sandbox`, or `CODEX_BOSS_SANDBOX_HOME`), outside every Candidate and outside the Stable tree, so a Candidate can never replace the launcher that confines it. | `HOST_GUARDED` |
| `windows-appcontainer-backend.ts` · `runLauncherProbe`, `probe` | `execFileSync(executable, [requestFile])` for the capability probe; no Candidate code involved. `probe()` derives a real AppContainer SID, so `available: true` means "the mechanism can be established on this host", not "a confined run will succeed". | `HOST_GUARDED` |
| `sandbox-drive.ts` · `ensureDriveMapping`, `removeDriveMapping` | `execFileSync("subst.exe", …)` — creates, reclaims or deletes a **machine-wide drive-letter mapping** for the Candidate root. Real machine-level side effect, chosen entirely by the host; the mapping is a path alias, never a permission (the AppContainer identity is still granted only the Candidate subtree). A stale mapping is inert and is reused by the next run. | `HOST_GUARDED` |
| `sandbox-capability.ts` · `defaultSandboxLauncherRoot`, `sandboxContainerName` | Reads `CODEX_BOSS_SANDBOX_HOME` / `LOCALAPPDATA` / homedir; deterministic name derivation. No write. | `HOST_GUARDED` |
| `sandbox-backend.ts` · `EvolutionSandbox`, `SandboxedProcessRequest`, `ancestorDirectories`, `SandboxPolicyError` | Contract only; no side effect. States the rule the coordinator follows: production code must never call `child_process` directly for Candidate work. | `SANDBOXED` |

---

## 4. `electron/engineering/**`

§8 requires the coordinator to reuse the existing engineering loop. The table
below separates the modules the coordinator actually drives from the ones the plan
lists but the coordinator never calls.

### 4.1 Driven by the coordinator, through `SandboxedCommandRunner`

| Entry | Side effect | Label |
|---|---|---|
| `engineering-loop-driver.ts` · `EngineeringLoopDriver` | None directly; pure orchestration over the injected `EngineeringLoopOperations`. | `HOST_GUARDED` |
| `engineering-loop-store.ts` · `EngineeringLoopStore.freezeGoal` / `record` | `writeJson(<layout.journal>/engineering-loop.json)` — inside the Candidate run directory. | `HOST_GUARDED` |
| `repo-engineering-operations.ts` · `createRepoEngineeringOperations` | `runAllowedCommand(root, "typecheck" \| "test", …, { env: sanitizeEnvironment(...), sandbox: commandSandbox })` for `audit`, `build`, `test`. Allow-list, file budget and argv are computed here; the sandbox only decides *how* the process is confined, so attaching one can never widen what may run. | `SANDBOXED` |
| `command-runner.ts` · `runAllowedCommand` **with** `options.sandbox` | Delegates process creation to the sandbox and reports the same evidence shape. | `SANDBOXED` |
| `verification-policy.ts` · `requiredEngineeringChecks`, `engineeringChecksFor` | Read-only scan; selects `syntax` / `typecheck` / `test` / `diff` checks. No write. | `HOST_GUARDED` |
| `finding-scope.ts`, `repo-inspector.ts`, `semantic-slice.ts`, `symbol-index.ts`, `code-graph.ts`, `cached-repo-scan.ts` | Read-only repository analysis (`fs.readFileSync`, `fs.readdirSync`, `fs.statSync`) inside the Candidate workspace. | `HOST_GUARDED` |

### 4.2 Driven by the coordinator, **not** through the sandbox — the honest gap

| Entry | Side effect | How it is reached | Label |
|---|---|---|---|
| `verification.ts` · `runCheck` | For `test` / `typecheck` / `build` / `lint`: `runAllowedCommand(root, check.kind, check.files)` **with no options object** — so no `sandbox` and no sanitized `env`, and the default `options.env ?? process.env` applies. For `syntax` / `diff`: a direct `execFile(process.execPath \| "git", …, { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })`. | `SelfEvolutionCoordinator.run` → `createLiveEngineeringOperations(...).implement` → `ProposalRunner.run` → `verifyAndRepair(root, requiredChecks, …)` → `runCheck`. `requiredChecks` comes from `engineeringChecksFor`, whose caller-visible kinds on a TypeScript repo are `typecheck`, `test`, `syntax`, `diff`. | `HOST_GUARDED` — with the plain statement that these child processes are **not** confined by the OS sandbox and **do** inherit the Stable host environment. §9 requires Candidate subprocesses to go through `EvolutionSandbox`; this path does not. |
| `proposal-runner.ts` · `ProposalRunner.run` → `applyManifest` → `verification.applyScopedChanges` | `fs.mkdirSync`, `fs.writeFileSync(temp)`, `fs.renameSync(temp, target)`, `fs.unlinkSync(temp)` — performed by the **host** Node process, with full host privileges, into the Candidate workspace. | Confinement is §7.3 at the seam (`assertMutationAllowed(root)` throws `SelfMutationDeniedError` for the Stable repo without a run context) plus `workspacePath` containment plus the `authorizedPaths` scope, the protected-metadata regex (`.git`, `.codex`, `.agents`, `AGENTS.md`), the 1 MB per-file budget and the `expectedSha256` preflight. It is *not* OS-confined: a host code path that bypassed the guard could write anywhere. | `HOST_GUARDED` |
| `proposal-runner.ts` · `ProposalRunner.run` → `executeNative(root, { kind: "git_diff" })` | `execFile("git", ["diff", "--no-ext-diff", "--no-textconv"], { cwd: candidateRoot })` — read-only. | `HOST_GUARDED` |
| `live-engineering-operations.ts` · `createLiveEngineeringOperations` | Builds `ProposalRunner`; `diffEvidence` runs a read-only `git diff`; `changedFileContext` `fs.readFileSync`s Candidate files (≤100 KB each, ≤160 KB total). | `HOST_GUARDED` |
| `command-runner.ts` · `runAllowedCommand` **without** `options.sandbox` | `execFile(process.execPath, args, { cwd, env: { ...baseEnvironment, ELECTRON_RUN_AS_NODE: "1", TEMP: temp, … } })` plus `fs.mkdtempSync` for the child scratch directory. | `HOST_GUARDED` |
| `native-tools.ts` · `workspacePath` | Containment predicate: realpath the root, reject `..` and absolute escapes, then resolve the deepest existing ancestor and reject symlink/junction escapes even for not-yet-existing leaf files. No write. | `HOST_GUARDED` |
| `native-tools.ts` · `executeNative` | `git_status` / `git_diff` / `git_diff_check` via `execFile` (read-only); `read_file` / `inspect_log` / `read_ranges` / `search_text` / `list_files` via `fs` (read-only, 1 MB budget). No write path exists in this module. Its `run_*` branch calls `runAllowedCommand` **without** a sandbox, and is reachable only from `NativeRuntime` and `MainCommander`, neither of which a Self-Evolution run reaches (§5). | `HOST_GUARDED` |
| `change-manifest.ts` · `parseManifest`, `applyManifest` | Validates the manifest (allow-listed check kinds, ≤50 changes, hash shape) then delegates to `applyScopedChanges`. | `HOST_GUARDED` |

### 4.3 Listed in plan §8 but **not** driven by the coordinator

| Entry | What it does | Reachability from a Self-Evolution run | Label |
|---|---|---|---|
| `merge-coordinator.ts` · `MergeCoordinator.merge` | Reads a verified worker patch, `applyScopedChanges` into the target root, re-runs checks, throws when the merged workspace fails verification. | The coordinator never imports it; it is constructed only in `MainCommander` for multi-step plan merging. The self-target branch of `MainCommander.runPlan` returns before any step loop. Note that its `applyScopedChanges` is the same §7.3-guarded seam. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `gate-runner.ts` · `runRepoGate`, `discoveredTestFiles`, `toolAvailable`, `gateCapability` | Runs `typecheck` / `build` / `unit` / `integration` / `acceptance` / `runtime-smoke` through `runAllowedCommand` (no sandbox). | §8 names `runRepoGate` among the pieces the coordinator "continues to reuse", but the coordinator does not call it; `MainCommander` does. **Flagged as a plan/code divergence** rather than silently labelled as reused. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `change-points.ts` · `checkpointRecord`, `rollbackToCheckpoint` | `fs.writeFileSync` of snapshot content and `removeTree` of post-checkpoint untracked files; `git checkout -- <file>` for tracked files. | Imported only by `MainCommander`. Not in the coordinator's closure. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `workspace.ts` · `prepareWorkspace`, `prepareStepWorkspace` | `git switch -c`, `git worktree add -b`, `git worktree add --detach`, `fs.mkdirSync`, `fs.writeFileSync` of seeded dependency files. | The coordinator never calls these: it builds its Candidate with `stable-candidate/workspace-manager.ts#createCandidateWorkspace` instead. **But this is the §7.3 seam that makes the plan's no-fallback claim true**: a self-target task whose plan has no `edit` step falls through `MainCommander.runPlan` to `prepareWorkspace(workspace, …)`, which calls `assertMutationAllowed(root)` and throws `SelfMutationDeniedError` before any git write. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` (with the fail-closed note above) |
| `engineering-runtime.ts`, `microtask-runtime.ts`, `deferred.ts`, `dev-handoff.ts` | Graph/microtask execution and handoff document writing. | Imported by `MainCommander` / `plan-runner`, not by the coordinator. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |

---

## 5. Modules the coordinator must not reach (§19)

### 5.1 Import-graph argument

`electron/computer/**`, `electron/provider-views.ts`, `electron/remote-relay.ts`
and `electron/workspace/**` are **not** in the coordinator's import list (§1) and
are **not** in the transitive closure of that list: no module reachable from the
coordinator imports them. Their own consumers are `electron/main.ts`,
`electron/commander/main-commander.ts`, `electron/software/software-runtime.ts`,
`electron/computer/backends/*` (provider surfaces) and
`electron/commander/web-recovery.ts`.

| Entry | Notable side effects it would have | Label |
|---|---|---|
| `electron/computer/**` (`computer-service.ts`, `perception-loop.ts`, `software-lease.ts`, `semantic-runtime.ts`, `backends/windows-uia.ts`, `backends/windows-ocr.ts`, `backends/structured-apps.ts`, `backends/dom-page.ts`, `backends/provider-dom-surface.ts`, `backends/provider-vision-surface.ts`) | `spawn("powershell.exe", …)` for UIA and OCR bridges, `spawn(app.executable, …)` to launch desktop applications, `execFile` for structured CLIs, `fs.writeFileSync(<screenshot>.png)` for the vision surface, and desktop input synthesis. `createComputerRuntime` is constructed only by `MainCommander`. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `electron/provider-views.ts` · `ProviderViews` | Hosts Electron `WebContentsView`s of the Owner's logged-in provider pages (`setWindowOpenHandler`, visibility control). | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `electron/remote-relay.ts` · `RemoteCommandRelay` | `spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", <relay script>, …])` — a scripted command relay. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |
| `electron/workspace/**` (`workspace-registry.ts`, `durable-roots.ts`, `external-session-ledger.ts`, `external-archive-automation.ts`, `live-external-archive.ts`, `artifact-backbone.ts`) | Workspace registration, durable roots, external-session archive automation, artifact writes. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` |

Reinforcing reason, beyond the import graph: `MainCommander.runPlan` routes a
self-target plan that contains an `edit` step into `SelfEvolutionCoordinator` and
`return`s **before** `store.beginPlanExecution` and before the plan step loop, so
the computer/native step executors of that task never run.

### 5.2 The one exception that the import graph does **not** cover

| Entry | Side effect | Reachability | Label |
|---|---|---|---|
| `electron/provider-automation.ts` · `ProviderAutomation.executeWorker`, `prepareUploads`, `read_page` DOM surface | `view.webContents.executeJavaScript(script, true)` inside the Owner's logged-in provider view — scripted typing, upload preparation and pressing send (`userGesture = true`), plus `fs.mkdirSync` / `fs.appendFileSync` for its own run log. | **Reachable in production**, not through an import edge but through an injected collaborator: `SelfEvolutionCoordinatorOptions.worker` is supplied by `createSelfEvolutionHost`, and `electron/main.ts` supplies `{ ask: (role, prompt) => commander.dispatchRole("self-evolution-" + role, …) }`. `MainCommander.dispatchRole` routes through `RoleRouter` over the runtime registry, which contains `ProviderRuntimeAdapter("web:" + providerId)` whose `execute` is `automation.executeWorker(...)`. `RoleRouter` ranks `deterministic < api < web < codex`, and `local:native` only declares the `validation` / `research` capabilities, so a `coder` or `reviewer` turn with no available API runtime can be served by a **web** runtime. | `HOST_GUARDED` — the host chooses the runtime and the Candidate cannot name one, but the honest statement is that this route is **not** excluded by construction, and §19 names "Owner browser session" among the capabilities Self-Evolution must not inherit. The Candidate's content (file contents, failing-test transcripts, the objective) is what gets typed into that session. |

This is the one place where "Self-Evolution is a strict subset of ordinary Work"
rests on runtime availability and routing order rather than on a structural
refusal. It is recorded here rather than argued away.

---

## 6. `electron/stable-candidate/**`, `emergency-control/**`, `promotion-gate/**`, `root-authority/**`, `credential-boundary/**`, `root-recovery/**`

### 6.1 `electron/stable-candidate/**`

| Entry | Side effect | Label |
|---|---|---|
| `workspace-manager.ts` · `createCandidateWorkspace` | `materializeEvolutionLayout` (`fs.mkdirSync` of `workspace`, `runtime-data`, `temp`, `logs`, `evidence`, `journal`), `fs.rmSync(layout.workspace, { recursive: true, force: true })`, then the run's **only git ref write**: `git worktree add -b evolution/<runId> <workspace> <baseSha>` executed with `cwd = stableRoot`. | `HOST_GUARDED`. Stated plainly: this is a write into the **Stable repository's** metadata (a new branch ref plus a linked-worktree administrative entry) and it is the intended, unavoidable way to create a Candidate. Stable's own checkout, index and `HEAD` are untouched; the base SHA must equal Stable's current `HEAD` unless `allowNonHeadBase` is set; `verifyRuntimeSeparation` refuses a layout that overlaps a Stable writable surface. |
| `workspace-manager.ts` · `commitCandidate` | `git add -A`, `git -c user.name=… commit -m <host message>` in the **Candidate** worktree. | `HOST_GUARDED` |
| `workspace-manager.ts` · `removeCandidateWorkspace` | `git worktree remove --force <workspace>`, `git branch -D evolution/<runId>` (branch removal is best-effort). | `HOST_GUARDED` |
| `workspace-manager.ts` · `headSha`, `candidateHeadSha`, `candidateChangedFiles`, `candidateIsDirty` | Read-only git inspection. | `HOST_GUARDED` |
| `runtime-isolation.ts` · `materializeEvolutionLayout`, `quarantineCandidateRuntime` | `fs.mkdirSync` of run directories; `fs.renameSync(layout.runtimeData, <…>.corrupt-<stamp>)` + recreate. `STABLE_WRITABLE_SURFACES` (`runtime-data`, `history`, `.cache/browser-profile`, `.cache/tmp`, `.cache/crash-dumps`, `.boss`, `artifacts`, `secrets`) are DENY for a Candidate write (`assessRuntimeWrite`), and `verifyRuntimeSeparation` refuses a Candidate root inside Stable. | `HOST_GUARDED` |
| `candidate-supervisor.ts` · `CandidateSupervisor.supervise` / `abort` / `recoverStaleLock` / `markAborted` | `fs.mkdirSync(<journal>)`, `fs.writeFileSync(<journal>/candidate.lock)`, `fs.rmSync(lock)`, `writeJson(<journal>/candidate.json)`. All inside the run directory; the lock is deliberately recoverable so a killed Candidate can never wedge Stable. | `HOST_GUARDED` |

### 6.2 `electron/emergency-control/**`

| Entry | Side effect | Label |
|---|---|---|
| `evolution-kill-switch.ts` · `EvolutionKillSwitch.freeze` → `writeJson(controlFile)` | Writes `evolution-control.json` with `state: "FROZEN_BY_OWNER"`. Reachable from the coordinator (checkpoint 2 re-freezes an already-frozen switch). The constructor refuses a control file inside a candidate root. | `HOST_GUARDED` |
| `evolution-kill-switch.ts` · `status`, `isFrozen`, `assertEvolutionEnabled` | Read `controlFile` + `sentinelFile` from disk on **every** call, no cache; absent-and-readable-record is `ENABLED`, a corrupt/unreadable record or a present sentinel is `FROZEN_BY_OWNER` (fail-closed). | `HOST_GUARDED` |
| `evolution-kill-switch.ts` · `clearFreeze` | Writes `state: "ENABLED"`. Requires `isAuthorizedOwnerChannel(channel)` (a `WeakSet` registration created only by `createOwnerControlChannel`) **and** `channel.owner === rootOwner`, and refuses while a sentinel file exists. An object literal that merely looks like a channel is rejected at runtime. | `OWNER_REQUIRED` |
| `evolution-kill-switch.ts` · `raiseSentinel`, `removeSentinel` | `fs.mkdirSync` + `fs.writeFileSync(sentinelFile)` / `fs.rmSync(sentinelFile)` — the external fuse whose mere presence means frozen. Both require the same Owner control channel. | `OWNER_REQUIRED` |
| `evolution-control` reads the coordinator performs | None; `assertCandidateCreationAllowed` / `assertPromotionAllowed` are pure reads that throw `EvolutionFrozenError`. | `HOST_GUARDED` |
| `emergency-control.ts` · `EmergencyControl.emergencyStop`, `appendEvidence` | `fs.mkdirSync` + `fs.appendFileSync(<governanceRoot>/emergency-evidence.jsonl)`. Appends only — evidence is retained, never cleared. Raising the stop is deliberately unauthenticated; clearing is the Owner-gated direction. | `HOST_GUARDED` |
| `emergency-control.ts` · `clear`, `recordUnauthorizedClearAttempt` | Delegates to the Owner-gated `clearFreeze`; records a denied clear attempt as evidence. | `OWNER_REQUIRED` |

### 6.3 `electron/promotion-gate/**`

| Entry | Side effect | Label |
|---|---|---|
| `github-promotion-adapter.ts` · `pushCandidateBranch` | `execFile("git", ["push", "--porcelain", "https://github.com/<repo>.git", "<sha>:refs/heads/<branch>"])` with the Boss token supplied through `GIT_CONFIG_*` environment variables (never argv, never a credentials file). Refuses `input.branch === baseBranch`. | `HOST_GUARDED`. **Reachable only through `EvolutionHostOperations.execute({ kind: "promote.pushBranch" })`**, which classifies the request as `promotion.execute` through `RootAuthority` and records the decision before the handler runs; a `DENY` throws and the push never happens. |
| `github-promotion-adapter.ts` · `createPullRequest` | `POST /repos/<repo>/pulls` via `fetchGitHubTransport` (`globalThis.fetch`, Bearer token, no ambient auth). | `HOST_GUARDED` (only via `promote.openPullRequest` → `RootAuthority`) |
| `github-promotion-adapter.ts` · `readPullRequest`, `readRequiredCheck`, `readBranchSha` | `GET` on the pull request, the `validate` check runs for an exact SHA, and a branch tip. | `HOST_GUARDED` (only via `promote.readPullRequest` / `promote.readCheck` / `promote.readBranchSha` → `promotion.evaluate`) |
| `github-promotion-adapter.ts` · `mergePullRequest` | `PUT /repos/<repo>/pulls/<n>/merge` at an exact SHA, ordinary merge/squash only — no `--admin`, no bypass actor, no ruleset manipulation. `isForbiddenApiUrl` refuses rulesets, branch protection, actions secrets/permissions/variables, collaborators, teams, installations, hooks, keys and automation permissions outright. | `HOST_GUARDED` (only via `promote.merge` → `promotion.execute`, after the two EmergencyControl promotion checkpoints and after the exact-SHA gate) |
| `github-promotion-adapter.ts` · `credentialed` | Missing dedicated Boss credential ⇒ every method returns `BLOCKED_EXTERNAL`; there is no Owner fallback, no ambient `gh` session and no keyring lookup. | `HOST_GUARDED` |
| `promotion-controller.ts` · `PromotionController.evaluate` / `beginPromotion` / `completePromotion` | `writeJson(storeFile)` into `<governanceRoot>/runs/<runId>-promotion.json`; records a durable `RootDecisionRecord` per evaluation. `beginPromotion` itself calls `emergency.assertPromotionAllowed()`. | `HOST_GUARDED` |
| `promotion-controller.ts` · `evaluate` when the change set hits the Root Surface | `ProtectedSurfaceGuard` returns `REQUIRE_OWNER` (`assessChanges` composes `escapes ? DENY : hits ? REQUIRE_OWNER : ALLOW`); the run parks in `WAITING_FOR_ROOT_OWNER`, the wait is sticky across restarts and repeated evaluations, and only an approval bound to the **same** candidate head SHA clears it. A Root Surface change still reaches a PR and a CI PASS; it stops there. | `OWNER_REQUIRED` |
| `promotion-controller.ts` · `evaluate` when a path escapes the Candidate root | `assessment.decision === "DENY"` ⇒ `workspace.escape` classification recorded and the run transitions to `REJECTED` in the same call. | `ROOT_DENIED` |
| `exact-sha-gate.ts` · `ExactShaGate.evaluate` | Read-only: live Candidate `HEAD` via `candidateHeadSha`. A stale PASS voids the recorded CI evidence rather than annotating it. | `HOST_GUARDED` |

### 6.4 `electron/root-authority/**` and `electron/credential-boundary/**`

| Entry | Side effect | Label |
|---|---|---|
| `root-authority.ts` · `RootAuthority.classify`, `enforce`, `record` | Composes `strictest(floor(operation), policy(operation), path(targets))`, then **appends every decision, `ALLOW` included, to the durable ledger before returning**. If the ledger cannot be written, `classify` throws: an unrecorded permission is not a permission. | `HOST_GUARDED` |
| `root-authority.ts` · `refuseSelfElevation`, `refuseOwnerIdentityChange`, `refuseDirectMainPush`, `refuseOwnerCredentialAccess`, `refuseRepositoryAdministration`, `refuseStaleShaPromotion`, `refuseArbitraryShell`, `refuseWorkspaceEscape` | Each classifies a floor-`DENY` operation; `enforce` throws `RootDeniedError` before any handler runs. | `ROOT_DENIED` |
| `root-authority.ts` · `acceptOwnerClaim` | `REQUIRE_OWNER` when the claim matches the policy's Root Owner, `DENY` otherwise; recorded either way. | `OWNER_REQUIRED` |
| `root-audit-ledger.ts` · `RootAuditLedger.append` | `fs.mkdirSync(path.dirname(file))` + `fs.writeFileSync(fd, line)` — append-only hash-chained JSONL. `RootAuthority`'s constructor refuses a ledger path inside the Candidate workspace. | `HOST_GUARDED` |
| `root-policy-loader.ts` · `loadRootPolicy` | Reads the policy; degrades to the immutable floor with a recorded error rather than trusting an unreadable policy. | `HOST_GUARDED` |
| `protected-surface-guard.ts` · `ProtectedSurfaceGuard` | Read-only (`fs.realpathSync`, `fs.readFileSync` of `.github/CODEOWNERS`); resolves every path through `engineering/native-tools.ts#workspacePath`, so traversal and junction/symlink escape are rejected by the same containment the rest of the chain trusts. | `HOST_GUARDED` |
| `execution-profile.ts` · `EvolutionExecutionProfile` | `assertNoCredentialLeak` post-condition on the child environment; `classifyEvolutionWorkerAction` / `classifyEvolutionCommand` are pure classifiers that call `authority.enforce` on `DENY` (throwing `RootDeniedError`). No filesystem side effect of its own. | `ROOT_DENIED` for the enforced denials; `HOST_GUARDED` for the environment construction |
| `credential-boundary/sanitized-environment.ts` · `sanitizeEnvironment`, `assertNoCredentialLeak`, `findCredentialLeaks` | Pure functions over `process.env`; the two-layer deny list (explicit Owner/ambient names + a credential-shape pattern) removes `GH_TOKEN`, SSH agent plumbing, cloud keys and `CODEX_BOSS_OWNER_TOKEN`-style names before a child is created. No side effect. | `HOST_GUARDED` |
| `credential-boundary/github-credential-provider.ts` · `EnvironmentBossGitHubCredentialProvider` | Read `process.env` for the dedicated Boss identity only; returns `AVAILABLE` or `BLOCKED_EXTERNAL` with the exact external action the Owner must take. Never the Owner's own credential. | `HOST_GUARDED` |

### 6.5 `electron/root-recovery/rollback-controller.ts`

| Entry | Side effect | Reachability | Label |
|---|---|---|---|
| `rollback-controller.ts` · `RollbackController.rollback` | The **only** code in the tree that performs a git **write** with `cwd = stableRoot`: `git fetch --all --prune`, `git switch <baseBranch>`, `git revert --no-commit <promotedSha>`, `git commit -m "revert: …"`, then `rev-parse HEAD`; plus `writeJson(checkpointFile)` / `writeJson(recordFile)`, both of which the constructor requires to live **outside** the Stable working tree. History is never rewritten — rollback produces a new revert commit, and a rollback that needed a force-push is a rollback that must not happen. | **Not reachable from a Self-Evolution run, and not wired into any production path today.** Its only reference outside its own module is `tests/unit/root-recovery.test.ts`. The `rollbackStable` handler installed by `createSelfEvolutionHost` (`createGitHostHandlers`) is a stub returning `{ ok: true }`, and `SelfEvolutionCoordinator.acceptPromotedRuntime` rolls back through `StableRuntimePointer.rollback`, which writes a **pointer record**, not a git revert. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` — stated plainly, this means §20's "a failed acceptance rolls back to Stable N" currently has a bookkeeping implementation and no exercised git-revert implementation. |

---

## 7. Dynamic section — what the executed-code red-team actually observed

Source: `tests/unit/evolution-sandbox.test.ts` (plan §10, SB-01…SB-11 plus a positive
control). Every case below writes a real script into the Candidate workspace and
runs it through `WindowsAppContainerSandbox.run`; the assertions read what the
operating system did to the child, not what a classifier decided.

Control-plane facts the suite asserts (`describe("hard execution sandbox capability")`):

```
capability.platform            === "win32"
capability.available           === true
capability.mechanism           === "windows-appcontainer"
capability.details.containerSid   matches /^S-1-15-2-/
capability.details.jobObject      === true
capability.details.suspendedStart === true
capability.details.childProcessBlocked === true
capability.details.networkDenied  === true
sandbox.describe().enforcement    === "operating-system"
sandbox.describe().denied.join(" ") matches /Stable repository/
sandbox.describe().childProcesses   matches /kernel/
```

| ID | Observed outcome the suite asserts |
|---|---|
| `CONTROL` | `result.sandboxed === true`, `exitCode === 0`, output contains `CONTROL_OK inside` with the Candidate `cwd`, and `control-wrote.txt` exists in the workspace — i.e. Candidate code really runs and really writes inside its own grant. This exists so a sandbox that merely refuses to start anything cannot masquerade as a boundary. |
| `SB-01` | Output contains `SB01_BLOCKED <code>`, output does **not** contain `OWNER_SECRET_CANARY_9f3c1a7e`. |
| `SB-02` | Output contains `SB02_BLOCKED`, the Stable sentinel file is **byte-identical** afterwards and still equals `STABLE_SENTINEL_UNTOUCHED`. |
| `SB-03` | Output contains `SB03_BLOCKED`; the Stable runtime-data file still reads `stable-runtime-state`. |
| `SB-04` | Output contains `SB04_ATTEMPTING`, does **not** contain `SB04_RAN`; `result.timedOut === true`; `result.report?.exitCode === 124`; `result.report?.activeProcessLimit === 1`. |
| `SB-05` | Output contains `SB05_ATTEMPTING`, does **not** contain `SB05_RAN`; `result.timedOut === true`; `result.report?.exitCode === 124`. |
| `SB-06` | Output contains `SB06_BLOCKED`; output does **not** contain `LOCAL_SERVICE_REACHED` from a live `http.createServer` bound to `127.0.0.1`. |
| `SB-07` | Output contains `SB07_GH undefined`, `SB07_OWNER undefined`, `SB07_VARS []`; output does **not** contain the `GH_TOKEN` / `CODEX_BOSS_OWNER_TOKEN` canary. |
| `SB-08` | Output contains `SB08_BLOCKED`; output does **not** contain `BEGIN OPENSSH PRIVATE KEY`. |
| `SB-09` | A junction is planted inside the workspace with `fs.symlinkSync(outside, junction, "junction")`; output contains `SB09_BLOCKED` and does **not** contain the Owner canary. |
| `SB-10` | `result.timedOut === true`, `result.report?.exitCode === 124`, output does **not** contain `SB10_SHOULD_NOT_PRINT`; afterwards Stable is still readable **and** writable (a probe file is created and read back), and the Candidate's own earlier `control-wrote.txt` still exists. |
| `SB-11` | A request that grants `write` on the Stable tree returns `result.sandboxed === false` and `result.refused === true` — the denial happens in `prepare()` before the OS is asked. |

**Recorded limitation for SB-04 / SB-05, stated rather than hidden.** The suite
documents (in its own comment on the SB-04 case) that an AppContainer process on
this host cannot complete `CreateProcess` **at all** — the call never returns, with
or without a Job Object — so the attack cannot produce a running process and the
sandbox watchdog terminates the whole Candidate job at its deadline. The
observation is therefore "no process was ever created, the watchdog killed the
job", asserted as `timedOut === true` with `exitCode === 124`, not as an error code
returned to the attacker. The mechanism is `ActiveProcessLimit = 1` in the Job
Object, plus the AppContainer lowbox token. This is a developer observation
recorded in the suite, not a fresh measurement taken while writing this document.

**What this section is not.** `tests/unit/evolution-sandbox.test.ts` was not
executed while writing this audit (no build, no test run), and
`evidence/S6-sandbox-red-team.json` does not exist. Nothing here should be read as
a recorded `EXECUTION_CONTAINMENT = PASS`. The table records what the suite
asserts, which is a different claim.

---

## 8. EmergencyControl freeze checkpoints (§11)

§11 requires a freeze check in six production positions. All six are inside
`electron/self-evolution/self-evolution-coordinator.ts`, and each delegates to
`EmergencyControl` → `EvolutionKillSwitch.assertEvolutionEnabled`, which re-reads
both durable freeze inputs from disk on every call (no cache, so a restart cannot
restore a pre-freeze view).

| # | §11 position | Site in `self-evolution-coordinator.ts` | What it does on a freeze |
|---|---|---|---|
| 1 | before candidate creation | `SelfEvolutionCoordinator.run`, immediately before `createCandidateWorkspace`: `emergency.assertCandidateCreationAllowed()` | Returns `outcome: "EMERGENCY_STOPPED"`; no Candidate directory, branch or worktree is created. |
| 2 | before candidate process spawn | `SandboxedCommandRunner` constructor's `beforeSpawn` callback (invoked at the top of `SandboxedCommandRunner.run`) → `SelfEvolutionCoordinator.assertCandidateProcessSpawnAllowed(action, supervisor, runId)` | Calls `emergency.emergencyStop({ actor: "owner-freeze", candidate: supervisor, runId })` — which freezes the switch, calls `CandidateSupervisor.abort(reason)` on the **in-flight** Candidate and appends to `emergency-evidence.jsonl` — then `emergency.assertCandidateCreationAllowed()` throws, so no child is created. |
| 3 | before verify | `run`, right after `setState("VERIFYING")`: `emergency.assertCandidateCreationAllowed()` | The throw is caught by `CandidateSupervisor.supervise`, which never rethrows on a Candidate failure: the run ends as `CANDIDATE_FAILED` with a durable journal entry and Stable untouched. |
| 4 | before PR creation | `attemptRemotePromotion`, before `host.execute({ kind: "promote.pushBranch" })`: `emergency.assertCandidateCreationAllowed()` | Also guards the **push**, which precedes PR creation; nothing leaves the machine. |
| 5 | before beginPromotion | `attemptRemotePromotion`, after `evaluated.state === "PROMOTABLE"`: `emergency.assertPromotionAllowed()` followed by `promotion.beginPromotion()` | The transition to `PROMOTING` never happens. (`PromotionController.beginPromotion` additionally calls `this.emergency?.assertPromotionAllowed()` itself, so the check is enforced twice.) |
| 6 | immediately before merge | `attemptRemotePromotion`, after `promotion.beginPromotion()` and before `host.execute({ kind: "promote.merge" })`: `emergency.assertPromotionAllowed()` | The merge is never issued. Note the ordering detail: `promote.readPullRequest` (the stale-SHA re-read) happens *after* checkpoint 6, so a freeze landing between the checkpoint and the merge call is still caught by `PromotionController.transition`, which allows EmergencyControl to force `REJECTED` from any non-terminal state including mid-`PROMOTING`. |

Two honest notes on this table: (a) checkpoints 1, 3 and 4 call
`assertCandidateCreationAllowed` while 5 and 6 call `assertPromotionAllowed`; both
are thin wrappers over the same `EvolutionKillSwitch.assertEvolutionEnabled`, so the
difference is nomenclature and error text, not a weaker check. (b) The freeze state
lives in `<governanceRoot>` (`createSelfEvolutionHost` passes
`candidateRoots: [evolutionRoot]`, and `EvolutionKillSwitch`'s constructor refuses a
control or sentinel file inside a candidate root), which is what makes "restart does
not clear the freeze" true.

---

## 9. Known real limitations (stated, not hidden)

1. **`ProposalRunner` verification is not sandboxed.** `electron/engineering/verification.ts#runCheck`
   reaches `runAllowedCommand` with no `sandbox` and no sanitized `env`, and uses a
   direct `execFile` with `{ ...process.env, ELECTRON_RUN_AS_NODE: "1" }` for
   `syntax` / `diff`. This path *is* reached from a Self-Evolution run (§4.2). It is
   labelled `HOST_GUARDED` because the host chooses the allow-listed check kind, the
   argv and the cwd — not `SANDBOXED`, because the OS sandbox is genuinely not
   applied.
2. **The toolchain read grant and the deny-root policy disagree in production.**
   `createSelfEvolutionHost` constructs `WindowsAppContainerSandbox` with
   `denyRoots: [stableRoot]`, while `SandboxedCommandRunner.run` puts
   `path.join(stableRoot, "node_modules")` into `request.grants` with `access:
   "read"` (the coordinator's `readOnlyRoots`). `WindowsAppContainerSandbox.prepare`
   checks `denyRoots` against `request.grants` and **throws**, which `run` converts
   to `{ refused: true }` and `SandboxedCommandRunner` converts to
   `{ passed: false, output: "sandbox refused to run …" }`. As written, every
   Candidate build/test in the production wiring is refused. The read grant on
   `<stable>/node_modules` is deliberate — it is a read-only toolchain grant that
   **does** cross into the Stable tree, with no listing and no write — but it cannot
   sit behind a deny root that covers Stable. Either the deny root must exclude the
   toolchain root, or the grant must be supplied through the constructor-level
   `readOnlyRoots` instead of the per-request grants.
3. **Ancestor `traverse` ACEs expose path metadata.** `prepare` grants
   `{ access: "traverse" }` for the ancestor directories of each explicit grant
   inside the mapped tree; the launcher implements that as
   `FileSystemRights.Traverse | ReadAttributes` with `InheritanceFlags.None`. The
   confined process can therefore **stat** those path components — it can learn that
   a path exists and observe its attributes — but it cannot list directories or read
   file contents. This is metadata exposure only, and it is the minimum needed for
   the Windows loader's `lstat` walk.
4. **The read grant on the Stable toolchain crosses into the Stable tree.** Stated
   explicitly because it is the one grant in the Candidate request that names a
   path inside Stable: `<stableRoot>/node_modules` is granted `read`
   (`ReadAndExecute`) with `ContainerInherit | ObjectInherit`, i.e. recursively
   readable. It is a read-only grant with no write and no delete, and the Candidate
   cannot alter what it reads, but it is a real crossing and is not claimed
   otherwise.
5. **The Candidate worktree has no `node_modules`.** `createCandidateWorkspace`
   uses `git worktree add`, so an ignored `node_modules` is not present in the
   Candidate. `commandArgv` (`self-evolution-coordinator.ts`) falls back to
   `node --test` when `node_modules/vitest/vitest.mjs` is missing, whereas
   `runAllowedCommand`'s `local()` helper (`command-runner.ts`) throws
   `Required local tool unavailable` instead of falling back. The two tool-
   resolution strategies disagree about how a Candidate obtains its toolchain.
6. **`stable.*` host operations have no production effect.** `markNextStable`,
   `recordBoot` and `commitStablePointer` are no-ops in
   `self-evolution-host.ts#createGitHostHandlers`, and `rollbackStable` returns
   `{ ok: true }` without acting. The operations are still `RootAuthority`-classified
   and ledger-recorded, but the actual pointer state is driven by
   `StableRuntimePointer`. §20's rollback therefore currently has a bookkeeping
   implementation (`StableRuntimePointer.rollback`) and no exercised git-revert
   implementation: `RollbackController` is referenced only by a unit test.
7. **`provider-automation.ts` is reachable through the injected role worker**
   (§5.2), which is the one place the §19 strict-subset claim is not structurally
   enforced.
8. **`runRepoGate` is named in §8 but not called by the coordinator** (§4.3): a
   plan/code divergence, not a containment failure, recorded so it is not mistaken
   for a reused gate.
9. **`EvolutionExecutionProfile.runHostSelected` is overridden but not the route
   the loop uses.** The coordinator constructs `SandboxedEvolutionProfile` and calls
   `profile.childEnvironment()` to force the credential-free post-condition, but the
   loop's commands flow through `createRepoEngineeringOperations({ sandbox:
   commandSandbox })`. The override therefore documents the intended seam rather
   than carrying the traffic.

---

## 10. Coverage

### 10.1 Searched patterns

`grep` over `electron/**/*.ts` (and `scripts/**/*.cjs` for the last group):

| Pattern | Matches | Groups produced |
|---|---|---|
| `fs.(writeFileSync\|writeFile\|rmSync\|rm(\|renameSync\|rename(\|copyFile\|copyFileSync\|mkdirSync\|appendFileSync\|unlinkSync\|unlink(\|mkdtemp\|truncate\|chmodSync)` | 243 | §3–§6, and the residue in §10.2 |
| `child_process\|execFile\|spawnSync\|spawn(\|execSync` | 80 | §3.1, §3.4, §4.2, §5, §6.3, §6.5, §10.2 |
| `openExternal\|executeJavaScript\|setPermissionRequestHandler\|setPermissionCheckHandler\|net.request\|shell.openPath\|shell.showItemInFolder` | 23 | §5 (no `shell.openExternal` and no `session.setPermission*` handler exists anywhere in `electron/`; `shell.showItemInFolder` occurs once, in `main.ts`) |
| `"push"\|"commit"\|"checkout"\|"worktree"\|"reset"\|"merge"` (and single-quoted forms) | 23 | §4.3, §6.1, §6.3, §6.5 |
| `fetch(\|net.request\|shell.openExternal\|setPermission*` | 3 | §6.3 — the only `fetch` in `electron/` is `fetchGitHubTransport` |
| `git push` / `git commit` / `git worktree` / `git revert` / `git switch` argv literals | see §4.3, §6.1, §6.3, §6.5 | Every git-mutating call site in the evolution path |
| `import … (computer\|provider-views\|provider-automation\|remote-relay\|workspace\|native-tools)` | 27 | §5 |
| `provider-automation\|computer-service\|remote-relay\|native-tools\|provider-views\|executeWorker` | 34 | §5 |
| `rollbackStable\|markNextStable\|commitStablePointer` | 12 | §3.2, §3.3, §6.5 |
| `RollbackController` | 7 | §6.5 |
| `scripts/**/*.cjs`: `writeFile\|rmSync\|execFile\|spawn\|exec(\|renameSync\|copyFile\|mkdirSync\|appendFile\|unlink` | 138 | §10.3 |

### 10.2 Residue: the rest of `electron/**`

Every `electron/**` module outside the coordinator's transitive import closure is
labelled `NOT_REACHABLE_FROM_SELF_EVOLUTION`. That covers, by top-level area:
`main.ts`, `preload.ts`, `store.ts`, `api-settings.ts`, `account-sessions.ts`,
`fs-util.ts`, `history-repository.ts`, `provider-api.ts`, `provider-automation.ts`
(carried separately in §5.2 by the injected-worker route), `provider-views.ts`,
`remote-relay.ts`, `repro-snapshot.ts`, `runtime-paths.ts`,
`commander/**` except `commander/durable-json.ts` (which *is* reachable, via
`engineering-loop-store`, `candidate-supervisor`, `evolution-kill-switch`,
`promotion-controller` and `stable-runtime-pointer`), `computer/**`,
`evaluation/**`, `fleet/**`, `host/**`, `identity/**`, `input/**`, `knowledge/**`,
`learning/**`, `node/**`, `research/**`, `runtimes/**`, `security/**`,
`self-engineering/**` (including `self-mod-sandbox.ts`, which is a separate,
Phase-0-era store and not part of this coordinator's closure), `software/**`,
`tenx/**` and `workspace/**`.

Two of these deserve a one-line reason because their names invite a wrong guess:

* `electron/evaluation/evaluation-store.ts` and
  `electron/runtimes/native-api-runtime.ts` both call
  `engineering/native-tools.ts#executeNative`, which *is* reachable — but only as
  the read-only inspection entry point described in §4.2. Neither module is in the
  coordinator's closure, so `executeNative`'s unsandboxed `run_*` branch is not
  reachable from a Self-Evolution run.
* Shared helpers that are only reachable through a `NOT_REACHABLE` consumer inherit
  that consumer's label: `fs-util.ts#removeTree` (used by `change-points.ts`) and
  `commander/task-ledger.ts` (used by `engineering-runtime.ts` and
  `microtask-runtime.ts`, which only `MainCommander` and `plan-runner` construct).

### 10.3 `scripts/**`

| Entry | Side effect | Label |
|---|---|---|
| `scripts/phase05-candidate-boot-acceptance.cjs` | `fs.mkdirSync(userData/sessionData)`, `spawn(binary, [".", "--boss-data-dir=…", "--boss-candidate-acceptance", "--user-data-dir=…"])`, `fs.mkdirSync(path.dirname(args.out))` + `fs.writeFileSync(args.out)`. | `HOST_GUARDED` — spawned only by `SelfEvolutionCoordinator.runBootAcceptance` with an entirely host-computed argv, after promotion, to prove Stable N+1 boots while Stable N runs. |
| All other `scripts/*.cjs` (acceptance/evidence harness: `acceptance-*.cjs`, `host-*.cjs`, `live-*.cjs`, `root-defense-evidence.cjs`, `r901-soak.cjs`, `benchmark.cjs`, `package-portable.cjs`, `fix-utf8-mixed.cjs`, `phase05-*` others) | `fs` writes, `spawn`/`execFileSync` of electron/powershell/git, package staging. | `NOT_REACHABLE_FROM_SELF_EVOLUTION` — they are Owner/harness-invoked entry points; nothing in the evolution path spawns them. |

### 10.4 No entry is left `UNKNOWN`

Every site enumerated by §10.1 is assigned exactly one of the five labels in this
document. Where a site was genuinely reachable and not contained by a mechanism, it
was labelled `HOST_GUARDED` (the host decides, not the Candidate) and the gap was
written down in §9 rather than described as containment. Where a site exists in the
tree but cannot run inside a Self-Evolution run, it is labelled
`NOT_REACHABLE_FROM_SELF_EVOLUTION` and the reason is given — an import-graph
argument, a "constructed only by `MainCommander`" argument, or an explicit
statement that the wiring is absent (as with `RollbackController`). No site was
classified by assumption, and no site was left as `UNKNOWN`.
