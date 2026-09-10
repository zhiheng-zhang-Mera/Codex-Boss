# Autonomous Evolution — Phase 0.5 execution record

**Plan:** `Update-Plan/Alien-Prestart.md`
**Phase:** 0.5 — Production Wiring, Hard Execution Containment & Solo Flight Acceptance
**Base branch:** `main`
**BASE_SHA:** not recorded in this document set — `evidence/S0-baseline.json` is a
separate deliverable (see `REQUIREMENTS.md` §S0). The Phase 0 baseline frozen by
the previous round was `fc14988395d60a0fb9a8f7d955657b55a0bfce87`; **do not**
assume it is the Phase 0.5 base.
**Nature of the round:** the last harness-driven engineering round before
Codex-Boss begins Autonomous Evolution Phase 1. Non-functional build-out only:
no ordinary product feature was added (plan §27).

---

## 1. Scope statement

Phase 0 built and tested a set of safety components. Phase 0.5 must prove three
different things about them:

1. that real, user-initiated Boss self-modification is **structurally unable** to
   reach Stable without passing through those components (production wiring);
2. that Candidate-controlled code, **when it is actually executed** by vitest /
   node / a build tool / a generated script, cannot leave the Candidate sandbox
   (hard execution containment);
3. that Boss can complete three real closed loops — an ordinary promotion, an
   injected failure, and a Root temptation — using a non-Owner GitHub identity,
   without the harness writing any of the code (solo flight acceptance).

Nothing in this round changes the Root contract. `.github/CODEOWNERS`, the
main-protection ruleset, the required `validate` check, the Root immutable floor,
the Owner-credential DENY set, the direct-main-mutation DENY set, the exact-SHA
contract, the append-only Root ledger and the emergency-control asymmetry are all
untouched (plan §26).

---

## 2. What Phase 0 delivered vs. what Phase 0.5 adds

### 2.1 Delivered by Phase 0 (unchanged, composed by this round)

| Module | Role |
|---|---|
| `src/shared/root-authority/{contracts,root-policy,protected-surface,promotion-state}.ts` | Decision vocabulary, `ROOT_OPERATION_FLOOR`, protected-surface manifest, promotion state machine |
| `electron/root-authority/root-authority.ts` | Floor + policy + path composition; records every decision |
| `electron/root-authority/root-audit-ledger.ts` | Append-only JSONL ledger with a hash chain; refuses to continue after truncation |
| `electron/root-authority/protected-surface-guard.ts` | Classifies a change set against CODEOWNERS + the immutable manifest |
| `electron/root-authority/execution-profile.ts` | §10 capability set, command classifier, credential-free child environment |
| `electron/credential-boundary/{sanitized-environment,credential-boundary,github-credential-provider}.ts` | Two credential trust domains; `AVAILABLE` / `BLOCKED_EXTERNAL` only |
| `electron/stable-candidate/{workspace-manager,runtime-isolation,candidate-supervisor}.ts` | Linked worktree Candidate, per-run layout, supervised lifecycle |
| `electron/promotion-gate/{promotion-controller,exact-sha-gate,github-promotion-adapter}.ts` | Local promotion decision, live-HEAD SHA gate, ordinary-merge-only adapter |
| `electron/emergency-control/{emergency-control,evolution-kill-switch}.ts` | Owner stop, fail-closed read policy, no self-clear |
| `electron/root-recovery/rollback-controller.ts` | Checkpointed revert-based rollback |
| `tests/unit/root-authority-red-team.test.ts` | 25 red-team cases; `tests/unit/stable-candidate-fault-isolation.test.ts` | 5 combined-fault cases |

### 2.2 Added by Phase 0.5

| Area | What is new |
|---|---|
| Self-target recognition (S1) | `electron/self-evolution/self-target-resolver.ts` — host-fact resolution from realpath, git root, git common dir, remote identity, product marker, installation root |
| Production composition root (S2) | `electron/self-evolution/self-evolution-coordinator.ts` — `SelfEvolutionCoordinator.run()` |
| Mandatory route (S3) | `SelfEvolutionHost` seam on `MainCommander`; `electron/self-evolution/mutation-guard.ts` + `mutation-context.ts` assertions on the mutating seams |
| Host production adapter (S2/S3) | `electron/self-evolution/self-evolution-host.ts` — builds the resolver, kill switch, sandbox, GitHub adapter and coordinator |
| Typed host channel (S19) | `electron/self-evolution/host-operations.ts` — finite operation vocabulary, each classified by `RootAuthority` |
| Hard sandbox (S5) | `electron/self-evolution/sandbox/` — AppContainer lowbox token + Job Object launcher, drive alias, capability contract |
| Sandbox red-team (S6) | `tests/unit/evolution-sandbox.test.ts` — CONTROL + SB-01…SB-11, executing real Candidate code |
| Stable pointer (S20/S21) | `electron/self-evolution/stable-runtime-pointer.ts` — `NEXT_STABLE_SHA`, restart evidence, boot acceptance, rollback |

### 2.3 The three goals and where they live

| Goal | Primary artifacts |
|---|---|
| **Production Wiring** | `self-evolution-coordinator.ts`, `self-evolution-host.ts`, `mutation-guard.ts`, `mutation-context.ts`, `MainCommander.selfEvolution` seam, `electron/engineering/verification.ts` + `electron/engineering/workspace.ts` assertions |
| **Hard Execution Containment** | `sandbox/sandbox-backend.ts`, `sandbox/sandbox-capability.ts`, `sandbox/windows-appcontainer-backend.ts`, `sandbox/windows-appcontainer/launcher.cs`, `sandbox/sandbox-drive.ts`, `SandboxedCommandRunner` in the coordinator |
| **Solo Flight Acceptance** | `host-operations.ts` + `GitHubPromotionAdapter` wiring in `self-evolution-host.ts`, `stable-runtime-pointer.ts`, the S12/S13 run records (not produced by this documentation pass) |

---

## 3. Phase map

| Plan phase | Deliverable | Artifact(s) | Status at documentation time |
|---|---|---|---|
| S0 | Baseline freeze and regression baseline | `evidence/S0-baseline.json` | **NOT PRODUCED** by this pass |
| S1 | Self Target Resolver | `electron/self-evolution/self-target-resolver.ts`; `tests/unit/self-target-resolver.test.ts` | Code + test present; test not executed here |
| S2 | `SelfEvolutionCoordinator` composition root | `electron/self-evolution/self-evolution-coordinator.ts`; exercised by `tests/unit/self-evolution-route.test.ts` | Code + end-to-end test present (real loop, real git, real ledger; sandbox and GitHub transport injected); no `evidence/S2-production-wiring.json` |
| S3 | Route into `MainCommander`; mandatory assertion | `main-commander.ts` seam, `mutation-guard.ts`, `mutation-context.ts`, `verification.ts`, `workspace.ts`, `self-evolution-host.ts` | Seam + assertions present and test-covered; **the production composition root does not yet install the host** (see `REQUIREMENTS.md` §S3) |
| S4 | Reuse the existing engineering loop inside the Candidate | `EngineeringLoopDriver`, `EngineeringLoopStore`, `createLiveEngineeringOperations`, `createRepoEngineeringOperations` + `sandbox`/`env` seams; optional deterministic `implement`/`review` seams on the coordinator | Code present; see the evidence-quality gap noted in `REQUIREMENTS.md` §S4 |
| S5 | Hard execution sandbox | `electron/self-evolution/sandbox/*`, `launcher.cs` | Implemented for `win32`; `probe()` reports `windows-appcontainer` on this host; **not re-verified live in this pass** |
| S6 | Sandbox red-team by executing malicious code | `tests/unit/evolution-sandbox.test.ts` (CONTROL + SB-01…SB-11) | Suite present; **not executed here**, so `EXECUTION_CONTAINMENT` is not claimed |
| S7 | Emergency Control at the real entry points | `emergency.assertCandidateCreationAllowed()` / `assertPromotionAllowed()` call sites in the coordinator, with the first checkpoint asserted by `self-evolution-route.test.ts` | 5 of the plan's 6 named checkpoints are wired; the "before candidate process spawn" checkpoint and the abort of a running Candidate (`EmergencyControl.emergencyStop`) have no production caller |
| S8 | Protected Surface from the real git diff | `git diff --name-status` via `host-operations` → `ProtectedSurfaceGuard.assessChanges`; ordinary-vs-Root and rename/delete cases asserted by `self-evolution-route.test.ts` | Code + test present |
| S9 | Dedicated Boss GitHub identity | `EnvironmentBossGitHubCredentialProvider`, `CODEX_BOSS_GITHUB_TOKEN` / `CODEX_BOSS_GITHUB_IDENTITY` | **BLOCKED_EXTERNAL** — neither variable is set on this machine |
| S10 | GitHub promotion real E2E | `GitHubPromotionAdapter` through `EvolutionHostOperations` | **BLOCKED_EXTERNAL** (depends on S9); no `evidence/S10-real-promotion.json` |
| S11 | Root Surface real GitHub E2E | `WAITING_FOR_ROOT_OWNER` path in `promotion-controller` | **BLOCKED_EXTERNAL** (depends on S9); no `evidence/S11-root-pr.json` |
| S12 | Real Boss solo dry run | — | **NOT PERFORMED**; no `evidence/S12-solo-run-a.json` |
| S13 | Three consecutive solo runs (A/B/C) | — | **NOT PERFORMED**; no `evidence/S13-solo-run-b.json` / `S14-solo-run-c.json` |
| §18 | Self-mutation surface inventory | `SELF-MUTATION-SURFACE-AUDIT.md` | Separate deliverable; **not written** by this pass |
| §19 | Self-Evolution ⊂ Work capability | `host-operations.ts` (typed host channel), `mutation-context.ts` | Implemented as a finite operation vocabulary; the "Computer Use inheritance" question is answered structurally, not by a runtime test |
| §20 | Stable update and restart strategy | `stable-runtime-pointer.ts`, `SelfEvolutionCoordinator.acceptPromotedRuntime`; pointer acceptance/rollback asserted by `self-evolution-route.test.ts` | Code + test present; **the default acceptance entrypoint `scripts/phase05-candidate-boot-acceptance.cjs` does not exist**, so the restart is still driven by an injected probe |
| §21 | Single-instance and Candidate runtime | `planCandidateRuntimeIsolation` | Plan/record level only; the Candidate boot itself is injected as a callback |

---

## 4. File map of the new code

### 4.1 `electron/self-evolution/`

| File | Responsibility |
|---|---|
| `self-target-resolver.ts` | S1. `SelfTargetResolver`, `resolveSelfTarget`, `resolveGitIdentity`, `normalizeRepositoryIdentity`, `canonicalComparison`. Answers "is this repository the one Boss was installed from?" from realpath + git facts |
| `self-evolution-coordinator.ts` | S2. `SelfEvolutionCoordinator.run()`, `SandboxedCommandRunner`, `commandArgv`, `mapPromotionOutcome`, `createDefaultHostHandlers`, `changeEntriesToSurfaceChanges` |
| `self-evolution-host.ts` | S2/S3. `createSelfEvolutionHost`, `createGitHostHandlers`, `detectRepositoryRoot` — the object the composition root installs on `MainCommander` |
| `host-operations.ts` | S19. `HostOperation` union, `HOST_OPERATION_KINDS`, `operationForHostAction`, `EvolutionHostOperations`, `parseNameStatus` |
| `mutation-context.ts` | S3.3. `EvolutionRunContext`, `assertSelfMutationContext`, `EvolutionRunRegistry`, `evolutionRuns`, `guardSelfMutation` |
| `mutation-guard.ts` | S3.3. `configureMutationGuard`, `assessMutation`, `assertMutationAllowed`, `targetsBossRepository` — the form of the assertion that is actually installed on the production seams |
| `stable-runtime-pointer.ts` | S20/S21. `StableRuntimePointer`, `planCandidateRuntimeIsolation` |

### 4.2 `electron/self-evolution/sandbox/`

| File | Responsibility |
|---|---|
| `sandbox-backend.ts` | `EvolutionSandbox`, `SandboxedProcessRequest`, `SandboxedProcessResult`, `SandboxPolicyError`, `normalizeSandboxPath`, `ancestorDirectories` |
| `sandbox-capability.ts` | `SandboxMechanism`, `SandboxGrant`, `SandboxCapability`, `SandboxBoundaryDescription`, `sandboxContainerName`, `defaultSandboxLauncherRoot` |
| `windows-appcontainer-backend.ts` | `WindowsAppContainerSandbox` (compile + drive the launcher), `findCSharpCompiler`, `supportsHardSandbox` |
| `sandbox-drive.ts` | `ensureDriveMapping`, `removeDriveMapping`, `toSandboxPath`, `toHostPath`, `mappingFingerprint` — the `subst` alias |
| `windows-appcontainer/launcher.cs` | The authoritative launcher: AppContainer SID, DACL grants, Job Object, suspended start, explicit environment, stdio, JSON report |
| `windows-appcontainer/launcher-source.ts` | `SANDBOX_LAUNCHER_SOURCE` — the same launcher embedded as a raw string so the host compiles it without reading the Candidate tree |

### 4.3 Tests and seams added elsewhere

| File | Change |
|---|---|
| `tests/unit/evolution-sandbox.test.ts` | New. CONTROL + SB-01…SB-11 executed-code attacks |
| `tests/unit/self-target-resolver.test.ts` | New. SF-001/SF-002 alias and false-positive batteries |
| `tests/unit/self-evolution-route.test.ts` | New. S2/S3/S7/S8/S19/S20 acceptance: the real coordinator, real engineering loop, real git and the real Root ledger, with a recording sandbox and a recorded GitHub transport injected. Covers the mandatory-route guard, an ordinary promoted run, a failing required check, the pre-Candidate freeze, real-diff classification (ordinary vs diluted Root vs rename/delete), the Stable pointer acceptance/rollback, and the credential refusals |
| `electron/engineering/command-runner.ts` | Optional `sandbox` seam on `runAllowedCommand`; `CommandSandbox`, `CommandSandboxOutcome` |
| `electron/engineering/repo-engineering-operations.ts` | Optional `env` + `sandbox` passed to every audit/build/test child |
| `electron/engineering/verification.ts` | `assertMutationAllowed(root)` at the `applyScopedChanges` write funnel |
| `electron/engineering/workspace.ts` | `assertMutationAllowed(root)` in `prepareWorkspace` and `prepareStepWorkspace` |
| `electron/commander/main-commander.ts` | `SelfEvolutionHost` interface + the §7.2 handoff inside `executePlan` |

---

## 5. Running the new test suites

```text
node_modules\.bin\vitest.CMD run tests/unit/evolution-sandbox.test.ts
node_modules\.bin\vitest.CMD run tests/unit/self-target-resolver.test.ts
node_modules\.bin\vitest.CMD run tests/unit/self-evolution-route.test.ts
```

Notes that matter for interpreting the results:

* `self-evolution-route.test.ts` is the end-to-end acceptance for the coordinator. It
  runs the real `SelfEvolutionCoordinator`, the real engineering loop, real git and
  the real `RootAuditLedger`; only the OS sandbox (`RecordingSandbox`) and the GitHub
  transport (a recorded fake) are injected, because plan §13 makes those external. Its
  `pushBranch` handler returns `OK` **without** contacting GitHub, so it exercises
  control flow, not SF-019.
* `evolution-sandbox.test.ts` **executes** Candidate code; on this host SB-04 and
  SB-05 are expected to end in `timedOut === true` with the launcher's exit code
  `124`, because an AppContainer process cannot complete `CreateProcess` at all
  (see `SANDBOX-THREAT-MODEL.md` §4). The suite's per-case timeouts are raised to
  `180_000 ms` for those two cases; a default-timeout run will report them as
  suite timeouts rather than as a containment result.
* The suite compiles `launcher.cs` with the in-box .NET Framework compiler
  (`csc.exe`) into a host-owned directory (`launcherRoot`, here a temp directory;
  in production `<userData>/sandbox`). The first run therefore includes a
  compiler invocation.
* The suite creates a `subst` drive mapping for its Candidate root and removes it
  in `afterAll`; a killed run can leave the mapping behind. `sandbox-drive.ts`
  reclaims a dead mapping on the next run.
* Neither suite was executed for this document set. Every result quoted in
  `SANDBOX-THREAT-MODEL.md` is the result the suite *asserts*, not a result
  observed in this session.

Full gates (plan §20) are unchanged and are the Phase 0 commands:

```text
pnpm run typecheck
pnpm run build
pnpm test
pnpm run benchmark
pnpm run package:portable
powershell -NoProfile -File scripts/smoke-portable.ps1
node scripts/acceptance-restart.cjs
```

---

## 6. Reading order

1. `REQUIREMENTS.md` — every clause of S0–S13 plus §18–§21, mapped to an
   implementation, an acceptance ID, and an explicit status marker.
2. `ARCHITECTURE.md` — the composed control flow of `SelfEvolutionCoordinator.run()`
   and the trust-domain argument.
3. `SANDBOX-THREAT-MODEL.md` — the Windows mechanism, its ACL model, its honest
   limits, and the SB-01…SB-11 table.
4. `FUTURE-OPPORTUNITIES.md` — everything plan §27 forbids this round from
   building, plus defects noticed while reading the code.

---

## 7. Documentation basis and limitations

Stated explicitly so no reader mistakes these documents for acceptance evidence:

* **No test, build, benchmark, packaging or restart gate was run** while producing
  them. Every "PASS" that the plan requires must come from
  `ACCEPTANCE-MATRIX.md` / `evidence/*.json`, which this pass did not produce.
* The Phase 0.5 tree was **being written concurrently** with this read. Files were
  observed changing between 21:26 and 21:42 local time: the sandbox modules, the
  engineering-loop seams, `self-evolution-host.ts`, two revisions of
  `self-evolution-coordinator.ts` (the second adding the deterministic
  `implement`/`review` acceptance seams), and three new test files —
  `evolution-sandbox.test.ts`, `self-target-resolver.test.ts` and
  `self-evolution-route.test.ts`, the last two appearing *during* this pass. The
  documents therefore describe the tree as read in that window, and claims are tied
  to file paths and exported symbols rather than to line numbers; a line number
  quoted here is a reading aid, not a frozen citation. **Re-read the cited files
  before acting on any status marked `PARTIAL`, `NOT IMPLEMENTED` or `DEFECT`.**
* The findings that carry the most weight were re-verified against the last
  revision observed (21:41): the coordinator still has five production freeze call
  sites with `assertNotFrozen` unused, `runHostSelected` still discards `exitCode`
  and `output`, `readOnlyRoots` still contains `<stableRoot>/node_modules`, no
  `memoryLimitMb` is requested, `acceptPromotedRuntime` still passes
  `stableStillRunning: true` / `candidateExited: false` as literals,
  `createSelfEvolutionHost` still has no caller, and `electron/main.ts` still
  constructs `MainCommander` without a `selfEvolution` argument.
* Where a claim would need live evidence (a git remote, a GitHub identity, a real
  merge, a boot acceptance, a sandbox run), the document says so and marks the
  requirement `BLOCKED_EXTERNAL`, `NOT IMPLEMENTED`, or
  `NEEDS LIVE EVIDENCE` instead of asserting it.
* `CODEX_BOSS_GITHUB_TOKEN` and `CODEX_BOSS_GITHUB_IDENTITY` are **not set** on
  this machine (verified by reading the environment). Every requirement that
  depends on a dedicated Boss GitHub identity is therefore `BLOCKED_EXTERNAL`
  here, and `READY_FOR_SOLO_REMOTE_PROMOTION` cannot be `TRUE`.
