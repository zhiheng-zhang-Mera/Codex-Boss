# Future opportunities — found, deliberately not built

Plan §27 forbids this round from continuing ordinary product build-out and requires
that anything discovered be recorded here instead of implemented. Nothing in this
file was built, and nothing in it was fixed during this round.

After Phase 0.5 the ordinary improvement budget belongs to Boss's own autonomous
evolution: these are inputs to Phase 1's own prioritisation, not a harness roadmap.

Two categories are listed separately:

1. **§1 — containment and wiring follow-ups**: defects and gaps noticed while reading
   the Phase 0.5 code. Several of them are the reason a requirement in
   `REQUIREMENTS.md` is marked `PARTIAL` or `NOT IMPLEMENTED`; they are deferred, not
   overlooked.
2. **§2 — opportunities in adjacent systems**, which are ordinary engineering work.
3. **§3 — the §27 non-goals**, restated for the avoidance of doubt.

---

## 1. Containment and wiring follow-ups (deferred)

| # | Opportunity | Why it is deferred |
|---|---|---|
| FO-01 | **Install the Self-Evolution host in the production composition root.** `electron/main.ts` constructs `MainCommander(…, workspaces, softwareLeases)` with no `selfEvolution` argument, and `createSelfEvolutionHost()` has no caller anywhere in the repository. Until it is wired, the §7.2 mandatory route is a prepared but unconnected seam, and a real self-target edit task is stopped by `SelfMutationDeniedError` instead of running in a Candidate. | This is the single highest-value follow-up in this list, and it is exactly the kind of production-bootstrap surgery plan §0 reserves for the round that owns the composition root. Wiring it requires the deny-root fix (FO-03) first, or the sandbox refuses every command. |
| FO-02 | **Wire the freeze checkpoints that are missing.** The plan's "before candidate process spawn" checkpoint has no call site, and `SelfEvolutionCoordinator.assertNotFrozen` — the only production-shaped caller of `EmergencyControl.emergencyStop`, and therefore the only path that aborts a *running* Candidate — is never invoked. A freeze raised mid-run is observed only after the loop has already finished. | It is a 4-line change with real behavioural consequences for an in-flight Candidate, and the plan §11 wording ("stop the current Candidate") deserves an explicit design decision about whether the abort is cooperative (supervisor signal) or forceful (job termination). |
| FO-03 | **Fix the `denyRoots` / `candidateRoot` overlap in `createSelfEvolutionHost`.** The factory sets `candidateRoot = <userData>/evolution` while listing `<userData>` as a deny root, and `prepare()` refuses grants inside a denied root — so under the default host configuration the coordinator's `write` grant on `<userData>/evolution/<runId>` is refused and every sandboxed command is reported `refused`. | It is a configuration defect in the factory, not in the backend; fixing it needs a decision on what the deny-root list is really meant to protect (the Stable app's browser profile and secrets, presumably) and a test that fails today. |
| FO-04 | **Stop discarding sandboxed command evidence.** `SandboxedEvolutionProfile.runHostSelected` returns `{ args: [], exitCode: null, output: "" }`, throwing away the `exitCode` and `output` that `SandboxedCommandRunner` produced, so a failing Candidate check gives the coder/reviewer loop no diagnostic text at all. | Reusing the failed check's output is an engineering-loop behaviour change (what the loop does with a long failure log, how it reflows), which belongs to the round that owns the loop rather than to a containment round. |
| FO-05 | **Request a memory ceiling for Candidate runs.** `JOBOBJECT_LIMIT_JOB_MEMORY` / `JOB_OBJECT_LIMIT_PROCESS_MEMORY` are implemented in the launcher but only applied when `memoryLimitMb > 0`, and the coordinator never sets it — so a runaway Candidate is bounded by wall clock only. | Choosing the ceiling is a product decision (a legitimate `tsc --build` on this repository has a real peak), and the surrounding code is a hardening boundary that should not acquire a tuning knob by accident. |
| FO-06 | **Give the sandbox a sanitized toolchain copy instead of reading the Stable tree's `node_modules`.** The coordinator's `readOnlyRoots` includes `path.join(stableRoot, "node_modules")`, which both widens the Candidate's trust domain into the Stable installation and contradicts the backend's own documented intent ("a sanitized copy of the toolchain"). | A copy strategy (hard links, a packed toolchain, a per-install cache) is a build/packaging change with real disk and install-time cost; it needs its own design and measurement. |
| FO-07 | **Implement the promoted-runtime boot acceptance entrypoint.** `planCandidateRuntimeIsolation` defaults `acceptanceEntrypoint` to `scripts/phase05-candidate-boot-acceptance.cjs`, which does not exist, and `acceptPromotedRuntime` records `stableStillRunning: true` / `candidateExited: false` as literals rather than observations — so restart evidence currently records intent, not a measured outcome. | Building the entrypoint means starting Electron headless against an isolated `--boss-data-dir` and measuring Stable's survival; that is a new runtime surface, not a wiring fix, and §20/§21 want it done deliberately. |
| FO-08 | **Classify `evidence.persist` like every other host operation.** The `evidence.persist` branch of `EvolutionHostOperations.execute` returns without calling `authorize()`, so evidence writes are the one host operation that is neither classified by `RootAuthority` nor recorded in the Root ledger, even though `OPERATION_FOR_KIND` already maps it to `evidence.write`. | Evidence persistence is deliberately best-effort (`persist()` swallows failures so a run never dies over it); making it ledgered means deciding what happens when the ledger write itself fails, which is an FI-03-shaped question. |
| FO-09 | **Test the host factory, not just the coordinator.** `tests/unit/self-evolution-route.test.ts` now exercises `SelfEvolutionCoordinator.run()` end-to-end (real loop, real git, real ledger; sandbox and GitHub transport injected), but `createSelfEvolutionHost()` itself — the object that chooses `evolutionRoot`, `governanceRoot`, the launcher root, the deny roots, the credential provider and the transport — has neither a caller nor a test. That is exactly where FO-03's defect lives and went unnoticed. | Testing the factory means asserting on paths and configuration rather than behaviour; worth doing at the same time as FO-01, so the install and its configuration are verified together. |
| FO-10 | **Collapse the two parallel mutation assertions.** `mutation-context.ts` (`assertSelfMutationContext`, `guardSelfMutation`) and `mutation-guard.ts` (`assessMutation`, `assertMutationAllowed`) implement the same §7.3 idea; only the `mutation-guard` form is installed on production seams, and `guardSelfMutation` has no caller. `mutation-guard.ts`'s own doc comment also claims `prepareWorkspace` / `prepareStepWorkspace` are guarded by a mechanism it does not itself provide (they import `assertMutationAllowed` directly, which is fine — but a reader of the comment would look in one place). | Consolidating the two is a small refactor with a wide blast radius across the Phase 0 batteries; it is safe to defer, but a future reader should know the two exist. |
| FO-11 | **Note that `RootAuthority.classify` does not throw on `DENY`.** Its doc comment says it throws on `DENY`, but only `enforce()` does; `classify()` returns the decision. Two Phase 0.5 call sites (`SandboxedEvolutionProfile.runHostSelected`, `EvolutionExecutionProfile.classifyAction`) call `classify` and ignore the return value, so a `DENY` at those sites would be recorded but not enforced. The operations involved are `ALLOW` at the floor today, so this is latent rather than open. | Changing `classify`'s contract would ripple through every Phase 0 caller; the honest short-term fix is a comment, and the real fix is a design decision about which call sites want `enforce`. |
| FO-12 | **Make an empty environment block mean "empty", not "inherit".** The launcher's wipe-and-install branch is guarded by `request.Environment.Count > 0`; a request with no `env` lines would leave the launcher's own `{ SystemRoot, PATH }` inherited by the child. Production requests always carry a sanitized block, so the seam is latent. | It is a one-line change, but it is a containment-semantics change in the launcher, and the launcher is host-owned code whose behaviour should change only with a matching acceptance case. |
| FO-13 | **Strengthen `probe()` into a real mini-run.** Today `probe()` derives the AppContainer SID and creates/close a Job Object; it does not create a confined child, so `available: true` means "the mechanism can be established", not "a confined run will succeed". | A probing run costs a process launch and a grant, and would need its own timeout policy on every Boss start; the cheaper existing shape is defensible as long as readers know what it proves (see `SANDBOX-THREAT-MODEL.md` §1). |
| FO-14 | **Offer a non-Windows containment backend or an explicit `BLOCKED_EXTERNAL` path for other platforms.** `supportsHardSandbox()` is `process.platform === "win32"`; `probe()` otherwise reports `available: false` with a reason, and the coordinator's `sandboxActive` becomes `false` — honest, but on a Linux or macOS host the plan's `READY_FOR_REAL_AUTONOMOUS_EVOLUTION` is unobtainable. | A container/VM backend or a `bwrap`/`sandbox-exec` backend is a second implementation with its own threat model and its own attack table; it must not be improvised alongside the Windows one. |
| FO-15 | **Use the `subst` mapping fingerprint in production evidence.** `mappingFingerprint()` exists and is exported, but no production caller records it, and `WindowsAppContainerSandbox.sandboxVisibleRoot()` is likewise only surfaced to callers who ask. `S5-hard-sandbox.json` would be more auditable if it recorded which alias was in force for a run. | Evidence-shape work belongs with the evidence generator (FO-16), not with the sandbox. |
| FO-16 | **Add a Phase 0.5 evidence generator.** Phase 0 shipped `scripts/root-defense-evidence.cjs` to derive per-phase JSON from a machine-produced vitest report, so a phase with a failing test emits `FAIL` and the script cannot emit a PASS that did not happen. Phase 0.5 has no equivalent, and none of `evidence/S0…S14`, `regression.json` or `final-readiness.json` exists. | Writing it is straightforward but it is the machinery of an acceptance round; whoever runs the real acceptance should build it first so the evidence cannot be hand-typed. |
| FO-17 | **Make the ordinary Work path's mutation assertion cheap and provably configured.** `assertMutationAllowed` now runs on every `applyScopedChanges` and on both workspace-preparation seams for *every* repository, resolving git identity through the resolver (a per-call `resolve(target)`), and `configureMutationGuard` is only reached from a factory nobody calls — in a packaged install the derived stable root comes from `module.__dirname`, which is not a git repository. It fails closed, but for a reason different from the one intended. | It needs measurement on the ordinary path plus a decision on whether the packaged guard should be configured from `app.getAppPath()` explicitly; both belong to the wiring round (FO-01). |
| FO-18 | **Verify that a Stable pointer rollback is a real rollback.** `StableRuntimePointer.rollback` rewrites `currentStableSha` back to the previous SHA and records the reason; it does not check that the previous commit is still fetchable, nor does it restore the binary or the runtime data. Git history is never rewritten (correctly), so the pointer is bookkeeping — a reader could mistake it for a runtime revert. | `RollbackController` (Phase 0) owns the revert-commit plan; unifying "pointer rollback" and "repository rollback" into one observable operation is a Phase 1 design question. |

---

## 2. Opportunities noticed in adjacent systems

| # | Opportunity | Area |
|---|---|---|
| FO-19 | `electron/engineering/workspace.ts` refuses any isolation when the workspace is dirty (`"Commit or preserve workspace changes before isolation"`). For a self-evolution run on a working checkout that is occasionally too strict; a "snapshot then isolate" path would help. | Engineering loop |
| FO-20 | `commandArgv` in the coordinator and the argv construction in `command-runner.ts` are two implementations of the same allow-list. They agree today; a shared builder would make divergence impossible. | Engineering loop |
| FO-21 | `parseNameStatus` in `host-operations.ts` and the inline name-status parser in `createGitHostHandlers` parse the same git output twice. The second does not carry `score`, so rename scores are lost on the production host path. | Host operations |
| FO-22 | `SandboxedCommandRunner` writes one `stdout`/`stderr` pair per invocation named `<command>-<base36 time>`, which can collide within the same millisecond and gives no run-unique index. A monotonic run-scoped counter would make evidence files stable. | Evidence |
| FO-23 | The sandbox compiles its launcher with the in-box .NET Framework `csc.exe`. If that compiler is absent the sandbox reports `available: false` and every Candidate check fails closed — correct, but a pre-flight check at Boss start-up would surface it earlier than the first evolution run. | Operability |
| FO-24 | `WindowsAppContainerSandbox.release()` must be called to remove the `subst` mapping, and nothing in the production path calls it. A stale mapping is inert and reusable, but a run-scoped cleanup (or a documented "leave it mapped" decision) would remove the ambiguity. | Operability |
| FO-25 | `mutationGuardConfigured()` is exported for observability but nothing reports it. Exposing it in the Root status surface would tell the Owner whether the production guard is actually installed — the question FO-01 is about. | Observability |
| FO-26 | The repository's full test suite now includes a suite that compiles C# and creates a `subst` drive mapping. A documented "slow/privileged suites" convention would let a fast local loop skip it without weakening CI. | Developer experience |

---

## 3. Explicit non-goals for this round (from §27)

For the avoidance of doubt, none of the following was started, and none of it should
be read as an implicit part of Phase 0.5:

| Deferred item | One-line rationale |
|---|---|
| Knowledge-base expansion | Ordinary product capability; explicitly excluded, and the plan hands it to Boss's Phase 1. |
| Self-model product capability | Same — a product feature with its own design questions, not a containment requirement. |
| Provider routing changes | Not needed for wiring, containment or single-flight acceptance; touching it would put the round's regression risk into unrelated code. |
| New browser AI capability | Same. |
| Paper / research features | Same. |
| Novel / narrative capability | Same. |
| Fleet topology work | Same; fleet was explicitly listed as mature infrastructure to leave alone. |
| New proxy features | Same. |
| Login / account-flow changes | Same. |
| UI redesign | Excluded; the Root ledger, freeze state and `WAITING_FOR_ROOT_OWNER` already have queryable APIs and no rendering, which is recorded in the Phase 0 list (FO-06 there) and still deferred. |
| Unrelated performance optimisation | Excluded; the only performance-adjacent items recorded here (FO-09, FO-17, FO-23) are consequences of this round's own changes. |
| Unrelated refactors | Excluded; every item in §1 above is scoped to code this round touched or created. |

The point of this list is not that these are bad ideas, but that deciding between
them is the first thing Boss's own Autonomous Evolution Phase 1 is supposed to do —
with its own value function and its own promotion path, rather than by harness
convenience.
