# Architecture — Phase 0.5 production wiring and hard containment

This document explains how Phase 0.5 composes the Phase 0 safety components into
one real production path, and why each structural choice was made. It is written
for the reader who has to change something here, so it records the ordering
constraints and the places where the code and the plan do not yet agree.

---

## 1. `SelfEvolutionCoordinator.run()` — the composed control flow

The entry point is `SelfEvolutionCoordinator.run(request: SelfEvolutionTaskRequest)`
in `electron/self-evolution/self-evolution-coordinator.ts`. Everything below is
that one method (plus `attemptRemotePromotion`, which it calls), in order. The
step numbers match the comments in the source.

### Step 0 — self-target resolution (S1)

```ts
const selfTarget = this.resolveSelfTarget(request.workspace);
if (!selfTarget.isSelf) return { ...base, outcome: "NOT_SELF", ... };
```

| Phase 0 component | None — this is new in Phase 0.5 |
|---|---|

`SelfTargetResolver.resolve()` decides from host facts only: canonicalized path
(`fs.realpathSync.native`), `git rev-parse --show-toplevel`, `--absolute-git-dir`,
`--path-format=absolute --git-common-dir`, `remote get-url origin`, the
repository's `package.json.name`, and the configured Stable root. The decisive
signals are `canonical-git-root`, `shared-git-common-dir` and `installation-root`;
a matching remote counts only together with the product marker. That is what makes
`C:\Boss`, a junction, a `..` path and a linked worktree resolve to self while a
stranger's `Codex-Boss` directory does not.

**Why the resolver is not consulted later.** The resolution runs exactly once per
task, and the rest of the pipeline uses `selfTarget.stableRoot` and
`selfTarget.stableHeadSha`. A second resolution mid-run could observe a different
repository state and would silently rebind the run to a different Stable.

### Step 1 — governance handles

```ts
const { emergency, killSwitch } = this.governanceHandles();
```

| Phase 0 component | `EvolutionKillSwitch`, `EmergencyControl` |
|---|---|

Both are constructed over durable files under `governanceRoot`:
`evolution-control.json`, `evolution-frozen.sentinel`, `emergency-evidence.jsonl`.
`governanceHandles()` memoizes one pair per coordinator so freeze state is read from
one file, and prefers injected handles (`options.killSwitch` / `options.emergency`)
when the host supplied them — `self-evolution-host.ts` does, with
`candidateRoots: [evolutionRoot]` so the kill switch refuses a control file that a
Candidate could write.

### Step 2 — checkpoint: before candidate creation

```ts
try { emergency.assertCandidateCreationAllowed(); }
catch (error) { return { ...outcome: "EMERGENCY_STOPPED"... }; }
```

| Phase 0 component | `EmergencyControl.assertCandidateCreationAllowed()` → `EvolutionKillSwitch.assertEvolutionEnabled()` |
|---|---|

This is checkpoint 1 of 6 (see §2). It returns an outcome instead of throwing, so a
frozen system produces a durable, explainable run record rather than an exception
at the top of the Electron main process. The kill switch re-reads its files on every
call, so an Owner freeze that happened while the app was running is honoured without
a restart.

### Step 3 — freeze the base SHA and create the Candidate workspace

```ts
const baseSha = selfTarget.stableHeadSha ?? (await headSha(stableRoot));
const candidate = await createCandidateWorkspace({ stableRoot, evolutionRoot, baseSha, runId });
const layout = candidate.layout;
materializeEvolutionLayout(layout);
```

| Phase 0 component | `electron/stable-candidate/workspace-manager.ts` (`createCandidateWorkspace`, `headSha`), `runtime-isolation.ts` (`evolutionLayout`, `materializeEvolutionLayout`, `EvolutionLayout`) |
|---|---|

The Candidate is a **linked git worktree** at
`<evolutionRoot>/<runId>/workspace` on branch `<layout.candidateBranch>`, with its
own `runtime-data`, `temp`, `logs`, `evidence` and `journal` directories and its own
`processNamespace`. The base is Stable's current HEAD, resolved from the resolver's
observation or read live — never "any commit". Validating one tree and promoting
another is the classic way this goes wrong, and a default of "any commit" would make
it easy.

**Why a worktree and not a clone.** Phase 0 records the three conditions (no worker
git shell, host-only git ref writes, Candidate-rooted file access) under which plan
§8.2 permits it; Phase 0.5 keeps all three: the sandbox denies process creation
outright, every git ref write goes through `EvolutionHostOperations` →
`workspace-manager`, and file access is rooted at `layout.workspace`.

### Step 4 — RootAuthority and the ledger, placed outside the Candidate

```ts
const ledgerFile = path.join(path.resolve(this.options.governanceRoot), "root-audit-ledger.jsonl");
const authority = new RootAuthority({ root: layout.workspace, ledgerFile, runId, candidateSha: baseSha, actor: "self-evolution-coordinator" });
```

| Phase 0 component | `RootAuthority`, `RootAuditLedger` |
|---|---|

The ledger is `<governanceRoot>/root-audit-ledger.jsonl` — outside the Candidate
worktree **and** outside the Stable tree. `RootAuthority`'s constructor independently
enforces this: it throws `RootSurfaceError` if the ledger path resolves inside
`root`. This is the one placement in the whole design that cannot be moved by
configuration, because a Candidate that can rewrite its own audit trail has no audit
trail.

`candidateSha: baseSha` is recorded on every ledger entry, so the audit trail of a
run is bound to the commit the run was built on.

### Step 5 — bind the run context and open the typed host channel

```ts
const context: EvolutionRunContext = { runId, candidateRoot: layout.root, candidateWorkspace: layout.workspace, stableRoot, baseSha, ledgerFile, evidenceDirectory: layout.evidence };
this.registry.register(context);
const host = new EvolutionHostOperations(context, authority, this.options.hostHandlers);
const sandboxProbe = await this.options.sandbox.probe();
```

| Phase 0 component | none directly — this module is new in Phase 0.5; `RootAuthority` classification is used per host operation |
|---|---|

`EvolutionRunContext` (`mutation-context.ts`) is what every mutating seam looks up;
`EvolutionRunRegistry` is deliberately in-memory, so a restarted process inherits
no authority. `EvolutionHostOperations` is constructed **with** a real context, so
an unbound channel cannot be created by accident: every `execute()` call
classifies its operation through `RootAuthority` and records the decision in the
ledger before the handler runs.

`registry.register(context)` happens before any Candidate process can start, and
`finally { this.registry.release(runId) }` releases it even when the run throws.

### Step 6 — the sandboxed execution profile

Everything the Candidate runs is created inside
`supervisor.supervise(async ({ signal, setState }) => { ... })`, so a crash or
timeout inside the loop is contained by the Phase 0 supervisor rather than by the
coordinator's own error handling.

```ts
const readOnlyRoots = [path.dirname(process.execPath), path.join(stableRoot, "node_modules")].filter(fs.existsSync);
const environment = candidateEnvironment(process.env, { inject: { TEMP, TMP, TMPDIR, CODEX_BOSS_EVOLUTION_RUN, CODEX_BOSS_EVOLUTION_NAMESPACE, CODEX_BOSS_EVOLUTION_ROOT, CODEX_BOSS_DATA_DIR, ELECTRON_RUN_AS_NODE: "1" } });
const commandSandbox = new SandboxedCommandRunner(this.options.sandbox, { layout, containerName: layout.processNamespace, readOnlyRoots, controlDirectory: layout.journal, evidenceDirectory: layout.evidence, activeProcessLimit: 1 });
```

| Phase 0 component | `candidateEnvironment` (`credential-boundary/credential-boundary.ts`), `sanitizeEnvironment` (`credential-boundary/sanitized-environment.ts`), `EvolutionExecutionProfile` (`root-authority/execution-profile.ts`) |
|---|---|

| Phase 0.5 component | `SandboxedCommandRunner`, `WindowsAppContainerSandbox` |
|---|---|

The layering is deliberate and each layer answers a different question:

1. `candidateEnvironment(process.env, …)` removes Owner credentials and injects the
   Candidate's isolated paths. It is the *content* of the environment.
2. `EvolutionExecutionProfile`'s constructor re-runs `candidateEnvironment` and then
   `assertNoCredentialLeak` as a **post-condition**, so the environment handed to a
   child is proven credential-free before any child exists. `profile.childEnvironment()`
   is touched explicitly in `run()` so the property is enforced even if nothing else
   uses the profile object.
3. `SandboxedCommandRunner` implements the engineering loop's `CommandSandbox` seam
   and is the only object that talks to the OS sandbox. Because
   `createRepoEngineeringOperations({ …, sandbox: commandSandbox })` passes it into
   `runAllowedCommand`, the Candidate's vitest/tsc/eslint children are created by the
   **sandbox launcher**, not by `execFile`.
4. The sandbox backend's `prepare()` refuses any grant inside `denyRoots` before the
   OS is asked, derives metadata-only `traverse` grants for the ancestors the Windows
   loader will `lstat`, and maps the Candidate tree onto a `subst` drive alias when a
   `candidateRoot` is configured.

`SandboxedEvolutionProfile extends EvolutionExecutionProfile` and overrides only
`runHostSelected(command, files)`: the Phase 0 profile stays the classification
authority (`candidate.build` / `candidate.test` are classified through
`RootAuthority`), while the spawn itself is redirected into the sandbox with
host-computed argv from `commandArgv(root, command, files)`. A Candidate never
supplies a command string: `AllowedCommand` is a closed union
(`"test" | "typecheck" | "build" | "lint"`).

**A refusal is a failure.** `SandboxedCommandRunner.run` maps
`result.refused === true` to `{ passed: false, exitCode: null, output: "sandbox refused to run <command>: …" }`.
A sandbox that cannot start never reads as a green check.

### Step 7 — the existing engineering loop, rooted in the Candidate

```ts
const goal = this.buildGoal(request, layout.workspace);
const loopStore = new EngineeringLoopStore(path.join(layout.journal, "engineering-loop.json"));
loopStore.freezeGoal(goal);
const live = createLiveEngineeringOperations({ workspace: layout.workspace, goal, worker: this.options.worker });
const operations = createRepoEngineeringOperations({ workspace: layout.workspace, env: sanitizeEnvironment(environment), sandbox: commandSandbox, implement: this.options.implement ?? ((finding) => live.implement(goal, finding)), review: this.options.review ?? ((finding, files, evidence) => live.review(goal, finding, files, evidence)) });
summary = await new EngineeringLoopDriver({ store: loopStore, operations, maxIterations: request.maxIterations ?? 4 }).run();
```

| Phase 0 component | None directly; this is the Phase-0-preserved engineering subsystem with two new optional seams (`env`, `sandbox`) |
|---|---|

| Phase 0.5 component | `buildGoal` (default goal contract), the `env`/`sandbox` seams in `repo-engineering-operations.ts` and `command-runner.ts` |

Every workspace argument is `layout.workspace`. `EngineeringLoopStore` writes its
state into `layout.journal`, so a Candidate can never write loop state into the
Stable tree. `createLiveEngineeringOperations` is the coder/reviewer worker path, so
planner/coder/reviewer, reviewer reflow, stagnation detection and the convergence
policy are the **same** machinery the ordinary Work path uses — Phase 0.5 adds no
second engineering implementation.

`buildGoal` supplies a default `EngineeringGoalContract` when the caller does not:
`protectedProductBehavior: ["no Root Surface change"]`,
`allowedChangeScope: ["non-Root source, tests and documentation"]`,
`forbiddenChangeScope: [".github", "electron/root-authority", "electron/promotion-gate"]`,
`convergencePolicy: { cleanRoundsRequired: 1 }`. These are defaults for a goal, not
the enforcement boundary — the enforcement boundary is the real diff assessment in
step 9.

`SelfEvolutionCoordinatorOptions.implement` / `.review` are optional deterministic
overrides of the coder and reviewer roles, mirroring the existing
`MainCommander.runEngineeringGoal` injection point. Production leaves both
`undefined`, so the live role-routed worker (`this.options.worker`) is used; the Solo
Flight acceptance harness injects scripted ones so that a run is reproducible. The
seam exists so that acceptance can exercise the real coordinator without a model in
the loop — it does not change what the production path does.

### Step 8 — checkpoint: before verify

```ts
setState("VERIFYING");
emergency.assertCandidateCreationAllowed();
```

| Phase 0 component | `EmergencyControl.assertCandidateCreationAllowed()` |
|---|---|

This is checkpoint 3 of the plan's six. Note the ordering honestly: the loop has
already run and the Candidate's subprocesses have already been spawned by the time
this check fires, so it gates *the rest of the run* (commit, assessment, promotion),
not the Candidate's build/test traffic. See §2.

### Step 9 — commit, read the real change set, assess the protected surface

```ts
setState("REVIEWING");
await host.execute({ kind: "git.commitCandidate", message: `evolution(${runId}): …` });
const candidateHeadSha = await host.execute<string>({ kind: "git.candidateHead" });
const entries = await host.execute<ChangeEntry[]>({ kind: "git.nameStatus", baseSha, headSha: candidateHeadSha });
const surfaceChanges = entries.map(…);
const assessment = new ProtectedSurfaceGuard({ root: layout.workspace }).assessChanges(surfaceChanges);
```

| Phase 0 component | `ProtectedSurfaceGuard`, `ROOT_PROTECTED_MANIFEST`, CODEOWNERS compilation, `workspacePath` containment |
|---|---|

Order matters: commit first, then read `git diff --name-status <baseSha>...<head>`,
then assess. Assessing the change set from the working tree would classify
uncommitted edits that promotion will never see; assessing after the exact-SHA gate
would assess a tree that has already moved. `parseNameStatus` handles `R<score>` /
`C<score>` with `from`, so a rename is assessed on **both** sides, and a case-only
rename is not silently an add.

`git.commitCandidate` is a host operation (`candidate.workspace.write`), so only the
host writes Candidate history — the worker has no git ref channel.

### Step 10 — local promotion decision

```ts
const exactShaGate = new ExactShaGate(layout.workspace);
promotion = new PromotionController({ storeFile: …, runId, authority, exactShaGate, emergency, stableSha: baseSha });
const credential = (this.options.credentialProvider ?? new EnvironmentBossGitHubCredentialProvider({ rootOwner: authority.rootOwner })).getAutomationCredential();
if (credential.status !== "AVAILABLE") promotion.setExternalBlocker(credential.requiredExternalAction);
const record = await promotion.evaluate({ binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: null }, requiredChecksPassed: false, branchUpToDate: true, reviewerClean: summary.state === "ENGINEERING_CONVERGED" || summary.state === "OPTIONAL_IMPROVEMENTS", changedFiles });
```

| Phase 0 component | `ExactShaGate`, `PromotionController`, `decidePromotion`, `EnvironmentBossGitHubCredentialProvider` |
|---|---|

The first evaluation is deliberately pessimistic: no CI has run, no PR exists, so
`ciValidatedSha`/`prHeadSha`/`promotionSha` are `null` and `requiredChecksPassed` is
`false`. The only thing this evaluation can conclude is
`WAITING_FOR_ROOT_OWNER` (a Root path in `changedFiles`), `BLOCKED_EXTERNAL` (no Boss
credential) or `REJECTED`. It cannot conclude `PROMOTABLE`, which is why the remote
phase is a separate, evidence-bearing step rather than a formality.

`reviewerClean` is derived from the loop's own terminal state
(`ENGINEERING_CONVERGED` / `OPTIONAL_IMPROVEMENTS`); the worker's "DONE" never
reaches promotion.

### Step 11 — remote promotion through the typed host channel

```ts
if (value.promotion.state === "PROMOTABLE") { const remote = await this.attemptRemotePromotion(host, promotion!, value.candidateHeadSha, request, layout); … }
```

| Phase 0 component | `GitHubPromotionAdapter` (behind `HostOperationHandlers`), `PromotionController.recordPullRequest` / `beginPromotion` / `completePromotion` / `markBlockedExternal`, `ExactShaGate` |
|---|---|

`attemptRemotePromotion` in order:

| # | Action | Host operation | Root operation | Freeze checkpoint |
|---|---|---|---|---|
| 1 | Assert evolution is enabled | — | — | **before PR creation** (`assertCandidateCreationAllowed`) |
| 2 | Push `layout.candidateBranch` at `candidateHeadSha` | `promote.pushBranch` | `promotion.execute` | — |
| 3 | Open the PR (`head` = Candidate branch, title `Autonomous evolution <runId>`, body carries the Owner goal) | `promote.openPullRequest` | `promotion.execute` | — |
| 4 | Record the PR number and head SHA in the promotion record | — | — | — |
| 5 | Read the required check for that exact SHA | `promote.readCheck` | `promotion.evaluate` | — |
| 6 | Re-evaluate with the live binding (`ciValidatedSha`/`prHeadSha` = observed head SHA, `requiredChecksPassed` = `conclusion === "success"`) | — | — | — |
| 7 | `emergency.assertPromotionAllowed()` then `promotion.beginPromotion()` | — | — | **before `beginPromotion`** |
| 8 | `emergency.assertPromotionAllowed()` (again), read the PR head, require `headSha === candidateHeadSha` | `promote.readPullRequest` | `promotion.evaluate` | **immediately before merge** |
| 9 | Merge at the exact SHA | `promote.merge` | `promotion.execute` | — |
| 10 | `promotion.completePromotion(candidateHeadSha)` | — | — | — |

Steps 7 and 8 are deliberately two separate checks: `beginPromotion` moves the
record to `PROMOTING`, and an Owner freeze raised between `PROMOTING` and the merge
call must still stop the merge. Step 8's SHA re-read is what makes a stale CI PASS
void: if the PR head moved after `validate` passed, the run returns `REJECTED` with
the reason `"PR head SHA changed after validation; the previous CI PASS is void"`.

Every one of these operations passes through `EvolutionHostOperations.execute`, so
each is classified against `ROOT_OPERATION_FLOOR` (`promotion.execute` and
`promotion.evaluate` are `ALLOW` at the floor; the Root ceiling for a promotion
comes from the protected-surface assessment, not from the floor) and each is
appended to the Root audit ledger with its decision and detail. A `DENY`
classification throws before any handler runs.

**Why the adapter is behind the host channel rather than called directly.** The
Candidate never reaches `GitHubPromotionAdapter`; it has no object reference, no URL
and no credential. The only way a network side effect happens is a `HostOperation`
the host decides to execute, which is what plan §19 asks for
(`Candidate request → typed host operation → RootAuthority → Stable host adapter`).

### Step 12 — evidence, report, release

```ts
await this.persist(host, runId, report);
… finally { this.registry.release(runId); }
```

| Phase 0 component | `RootAuditLedger` (already written per decision) |
|---|---|

The report is written through `evidence.persist` into
`<governanceRoot>/runs/<runId>.json`. `persist()` deliberately swallows its own
failure — evidence persistence must never be the reason a run dies, because the
durable Root ledger already records every decision. Note that the
`evidence.persist` branch of `EvolutionHostOperations.execute` does **not** call
`authorize()`, so these writes are the one host operation that is not classified or
ledgered; that asymmetry is recorded as a gap in `REQUIREMENTS.md` §18.

`SelfEvolutionRunReport` carries the run's whole story: `isSelf`, `selfReason`,
`outcome`, `baseSha`, `candidateWorkspace`, `candidateHeadSha`, `changedFiles`,
`protectedPaths`, `promotionState`, `loopState`, `candidateJournal`,
`blockedExternal`, `sandboxMechanism`, `sandboxActive`, `evidenceFile`,
`stablePointer`, `startedAt`, `finishedAt`.

### Step 13 — Stable N+1 acceptance (separate method, §20/§21)

`acceptPromotedRuntime({ runId, previousStableSha, promotedSha, pointerFile, bootProbe })`
is not part of `run()`; it is called by the host after a successful merge.

```text
StableRuntimePointer.initialize(previousStableSha)
  → markNext(previousStableSha, promotedSha)      // NEXT_STABLE_MARKED; Stable N still running
  → planCandidateRuntimeIsolation({ runId, runtimeData, processNamespace })
  → recordRestart({ mechanism, isolation, stableStillRunning, candidateExited, detail })
  → await bootProbe()
  → recordBoot(promotedSha, accepted, detail)
       accepted  → commitPointer(promotedSha)     // STABLE_CURRENT
       rejected  → rollback("boot acceptance failed: …", previousStableSha)
```

| Phase 0 component | None — the pointer is new |
|---|---|

| Phase 0.5 component | `StableRuntimePointer`, `planCandidateRuntimeIsolation` |
|---|---|

The pointer file must live outside the Stable working tree (the constructor throws
otherwise), `commitPointer` refuses unless an **accepted** boot attempt is recorded
for that SHA, and `recordBoot(false)` moves the record to `ROLLED_BACK` with a
`rollbackReason`. That is the structural expression of "a successful git merge is not
a successful Stable upgrade".

Two honest limitations, both recorded in `REQUIREMENTS.md` §20/§21: `bootProbe` is an
injected callback and there is no implementation of the default
`scripts/phase05-candidate-boot-acceptance.cjs`, and `acceptPromotedRuntime` passes
`stableStillRunning: true, candidateExited: false` as literals rather than as
observations. Until a real probe exists, the restart evidence records the *intent*
of isolation, not a measured outcome.

---

## 2. The six freeze checkpoints, as wired

Plan §11 names six production checkpoints. What exists today:

| # | Plan checkpoint | Call site | State |
|---|---|---|---|
| 1 | before candidate creation | `run()` → `emergency.assertCandidateCreationAllowed()` | wired |
| 2 | before candidate process spawn | — | **not wired**: nothing re-reads the freeze between Candidate creation and the first sandboxed spawn |
| 3 | before verify | `run()` (inside `supervise`) → `emergency.assertCandidateCreationAllowed()` | wired, but after the loop has already run |
| 4 | before PR creation | `attemptRemotePromotion` → `emergency.assertCandidateCreationAllowed()` | wired |
| 5 | before `beginPromotion` | `attemptRemotePromotion` → `emergency.assertPromotionAllowed()` | wired |
| 6 | immediately before merge | `attemptRemotePromotion` → `emergency.assertPromotionAllowed()` | wired |

`assertNotFrozen(action, candidate, runId)` — the private helper that would call
`EmergencyControl.emergencyStop({ candidate })` and therefore abort a **running**
Candidate — has no caller, and `EmergencyControl.emergencyStop` has no production
caller at all (its only callers are the Phase 0 test batteries). The consequence is
precise and worth stating: an Owner freeze raised while a Candidate is working is
observed at checkpoint 3, after that Candidate's build/test traffic has already
happened; it stops the run from committing, assessing and promoting, but it does not
interrupt the work in progress. The reverse direction is covered: `EvolutionKillSwitch`
re-reads its durable files on every call, so no restart and no cached view can clear
a freeze.

---

## 3. Why the trust domain is a strict subset of Work

`Update-Plan/Alien-Prestart.md` §19 states the rule: a Self-Evolution worker must not
inherit arbitrary desktop automation, Explorer, terminal, GitHub Settings, credential
manager or the Owner browser session merely because Boss can normally operate the
computer. Phase 0.5 makes that structural rather than aspirational.

```text
Ordinary Work capability (unchanged)
  ├── providers / models / research / knowledge
  ├── native tools + workspace engine
  ├── Computer Use: desktop automation, Explorer, terminal, browser profiles,
  │   GitHub settings, credential manager, Owner session
  └── engineering loop: audit → implement → build/test → review → converge

Self-Evolution capability (strict subset)
  ├── engineering loop (same code, pointed at the Candidate workspace)
  ├── sandboxed process creation, only for the four AllowedCommand values
  ├── writes inside the Candidate tree
  └── typed host operations, each classified by RootAuthority before it runs
      (no desktop, no Explorer, no terminal, no browser, no credential manager,
       no GitHub settings — there is no code path, not merely no permission)
```

Four mechanisms carry the subset property:

1. **Closed inputs.** The worker's work is expressed as an `EngineeringGoalContract`
   and a `SandboxedProcessRequest`. `AllowedCommand` is a closed union, so there is
   no "run this string" surface to inherit a shell from.
2. **Closed outputs.** Anything that leaves the Candidate is a `HostOperation` from a
   finite union of 14 kinds (`HOST_OPERATION_KINDS`), each mapped to a `RootOperation`
   by `operationForHostAction`. There is no generic "execute on the host" member —
   `execute()`'s `default` branch is typed `never`, so adding one would be a
   deliberate, reviewable act.
3. **No object graph to the powerful surfaces.** The coordinator is constructed with
   `sandbox`, `hostHandlers`, `resolver`, `worker`, `credentialProvider`, `transport`
   and governance handles. It is not constructed with the Computer Use controller,
   the provider views, the workspace registry or the Owner's browser session, so the
   Candidate cannot reach them by holding a reference it was never given.
4. **The credential boundary has two outcomes.** `BossGitHubCredentialProvider`
   returns `AVAILABLE` or `BLOCKED_EXTERNAL` and nothing else, so the self-evolution
   path has nowhere to fall back to an Owner credential — the failure mode §2.3 and
   §9 both name.

The one place where this argument is weaker than it looks is the read-only toolchain
grant: the coordinator grants `read` on `<stableRoot>/node_modules` (see
`REQUIREMENTS.md` §S5). That is inside the Stable installation tree. It is a
deliberate trade — the toolchain has to come from somewhere and a per-run copy is
expensive — but it does mean the Candidate's trust domain includes read access to the
Stable dependency tree rather than to a sanitized copy, which is what the backend's
own `readOnlyRoots` documentation describes. It is recorded as a residual risk rather
than papered over.

---

## 4. Where each invariant is enforced

| Invariant | Enforcement point |
|---|---|
| A self-modification task cannot reach Stable without a Candidate | `SelfTargetResolver` (S1) + `MainCommander` handoff (S3) + `assertMutationAllowed` on `applyScopedChanges` / `prepareWorkspace` / `prepareStepWorkspace` |
| Candidate code cannot execute outside its sandbox | AppContainer lowbox token (no capabilities) + Job Object `ActiveProcessLimit` + suspended start + explicit environment (`launcher.cs`) |
| Candidate cannot launch a process of any kind | `activeProcessLimit: 1` from the coordinator; `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` in the launcher |
| Candidate subprocesses never see Owner credentials | `candidateEnvironment` → `EvolutionExecutionProfile` (`assertNoCredentialLeak`) → launcher environment replacement |
| A Root path in the real diff parks the run | `git diff --name-status` → `SurfaceChange[]` → `ProtectedSurfaceGuard.assessChanges` → `decidePromotion` → `WAITING_FOR_ROOT_OWNER` |
| Promotion is bound to the exact SHA | `ExactShaGate` (live HEAD) + binding re-evaluation + PR head re-read before merge |
| The audit trail cannot be rewritten by the Candidate | `RootAuthority` ledger placement guard + `RootAuditLedger` hash chain / truncation detection |
| A merge is not a Stable upgrade | `StableRuntimePointer.markNext` / `recordBoot` / `commitPointer` / `rollback` |
| Owner freeze survives restart and cannot be self-cleared | `EvolutionKillSwitch` re-read per call + `OwnerControlChannel` requirement for `clear` |

---

## 5. Composition root installation (current state)

```text
electron/main.ts
  └── new MainCommander(…, workspaces, softwareLeases)      ← no selfEvolution argument
        └── executePlan(): if (this.selfEvolution && this.selfEvolution.isSelfTarget(workspace)) …
                              ▲
                              └── undefined today

electron/self-evolution/self-evolution-host.ts
  └── createSelfEvolutionHost({ appPath, userData, rootOwner, worker, … })
        ├── SelfTargetResolver(stableRoot, productRepository)
        ├── configureMutationGuard({ stableRoot, productRepository, registry, resolver })
        ├── EvolutionKillSwitch(controlFile, sentinelFile, candidateRoots: [evolutionRoot])
        ├── EmergencyControl({ killSwitch, rootOwner, evidenceFile })
        ├── WindowsAppContainerSandbox({ launcherRoot: <userData>/sandbox, candidateRoot: evolutionRoot, denyRoots: [stableRoot, <userData>] })
        ├── GitHubPromotionAdapter({ repository, baseBranch, credentialProvider, transport: fetchGitHubTransport })
        └── SelfEvolutionCoordinator({ … }) 
```

`createSelfEvolutionHost` has no caller in the repository, so the middle of that
diagram is a factory nobody invokes. The practical consequences — and the fact that
the seam assertions still fail closed — are analysed in `REQUIREMENTS.md` §S3 along
with the `denyRoots` / `candidateRoot` overlap that would refuse the Candidate's own
grant the moment the factory *is* wired.
