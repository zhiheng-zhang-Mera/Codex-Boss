# Requirements traceability — Phase 0

Every normative clause of `Update-Plan/Isolation-Finalization.md` is listed here
with its implementation site and the acceptance case that proves it. Nothing is
marked satisfied by inspection alone; each row names an executing test.

---

## §4 Permission model

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §4.0 | A single `RootDecision` vocabulary: `ALLOW \| REQUIRE_OWNER \| DENY` | `src/shared/root-authority/contracts.ts` | `tests/unit/root-authority.test.ts` (composition) |
| §4.ALLOW | Ordinary code, knowledge, UI, adapters, fleet, scheduler, research, engineering logic, tests, docs, Candidate work and post-gate promotion stay autonomous | `ROOT_OPERATION_FLOOR` ALLOW group; `decideRootOperation` | `tests/unit/owner-authority.test.ts` ("does not swallow ordinary product code"), `tests/unit/promotion-gate.test.ts` |
| §4.REQUIRE_OWNER | Root Surface, CI gate, Root Authority, credential boundary, promotion gate, Stable/Candidate boundary, emergency control, Root invariant tests, Owner identity, Root policy park on `WAITING_FOR_ROOT_OWNER` | `ROOT_OPERATION_FLOOR` REQUIRE_OWNER group; `promotion-state.ts` | `tests/unit/root-authority.test.ts`, `tests/unit/promotion-gate.test.ts`, RT-09…RT-13 |
| §4.REQUIRE_OWNER | The wait must be an explicit `WAITING_FOR_ROOT_OWNER`, never a generic `WAITING_FOR_USER` | `PromotionState` includes the state; `decidePromotion` returns it | `tests/unit/promotion-gate.test.ts` ("stops a fully green Root Surface change") |
| §4.DENY | No mode may turn `DENY` into `ALLOW` (`OWNER_RESULT` / `AUTONOMOUS` / any future mode) | `decideRootOperation` applies the immutable floor *after* the policy; `mode` is attribution only | `tests/unit/root-authority.test.ts` ("has no mode that turns DENY into ALLOW"), `tests/unit/self-elevation.test.ts` |
| §4.DENY | Every enumerated escalation (17 of them) is denied | `ROOT_OPERATION_FLOOR` DENY group | `tests/unit/self-elevation.test.ts` (EG-01…EG-17) |

## §5 Recommended structure

| Clause | Requirement | Status |
|---|---|---|
| §5 | `src/shared/root-authority/{contracts,root-policy,protected-surface,promotion-state}.ts` | Created exactly as listed |
| §5 | `electron/root-authority/{root-authority,root-policy-loader,protected-surface-guard,root-audit-ledger}.ts` | Created as listed, plus `execution-profile.ts` for §10 (the plan permits a light structural adjustment) |
| §5 | `electron/credential-boundary/{credential-boundary,sanitized-environment,github-credential-provider}.ts` | Created as listed |
| §5 | `electron/stable-candidate/{workspace-manager,runtime-isolation,candidate-supervisor}.ts` | Created as listed |
| §5 | `electron/promotion-gate/{promotion-controller,exact-sha-gate,github-promotion-adapter}.ts` | Created as listed |
| §5 | `electron/emergency-control/{emergency-control,evolution-kill-switch}.ts` | Created as listed |
| §5 | `electron/root-recovery/rollback-controller.ts` | Created as listed |
| §5 | Test paths named by the plan | Created: `root-authority`, `owner-authority`, `self-elevation`, `credential-boundary`, `promotion-gate`, `stable-candidate`, `emergency-control`, `root-recovery` (plus `root-authority-execution-profile`, `root-authority-red-team`, `stable-candidate-fault-isolation` to cover §10/§14/§15) |
| §5 | No new npm dependency | Satisfied: `package.json` and `pnpm-lock.yaml` are **unchanged**. Only `node:fs`, `node:path`, `node:crypto`, `node:child_process` and existing seams are used |
| §5 | Do not modify `ci.yml` / `package.json` / `pnpm-lock.yaml` merely for convenience | All three unchanged. `.gitignore` gained two entries so the new Root policy file and the new evidence directory are trackable — no gate was touched |

## §6 Phase F0 — baseline freeze

| Clause | Requirement | Evidence |
|---|---|---|
| §6.1 | Confirm HEAD equals the named base SHA, or record the equivalent new HEAD | `F0-baseline.json`: `baseSha = fc14988…`, fetched from `origin/main` |
| §6.2–6.4 | Save baseline commit, test count, and run typecheck/build/test/benchmark | `F0-baseline.json`: 82 test files / 687 tests; all four gates PASS |
| §6.5–6.6 | Save baseline git status and confirm no unexplained pollution | `F0-baseline.json`: `statusPorcelain: ""` |
| §6.7–6.8 | Build an isolated branch/workspace; never edit `main` | Linked git worktree on branch `Alien-Prestart-Isolation` |

## §7 Phase F1 — Root Authority

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §7.1 | Repository-side, secret-free Root Policy at `.codex-boss/root/root-policy.json` | `root-policy.json`, `root-policy-loader.ts` | `tests/unit/root-authority.test.ts` |
| §7.1 | Policy holds policy only — no PAT, key, session, cookie or impersonation material | `parseRootPolicy` refuses any secret-shaped content via `scanSecrets` | `tests/unit/root-authority.test.ts` ("refuses to load a policy that carries secret material") |
| §7.1 | The Root policy itself is a Root Surface | `/.codex-boss/root/` in `ROOT_PROTECTED_MANIFEST` | `tests/unit/root-authority.test.ts`, RT-09 |
| §7.2 | Machine-readable protected surface; host decides; worker/prompt never does | `protected-surface-guard.ts` + `protected-surface.ts` | `tests/unit/root-authority.test.ts` |
| §7.2 | Normalize before classifying; correct case handling; real path after symlink/junction; rename checks source *and* destination; delete checks; new files in protected directories hit | `normalizeRepoPath`, `assessChanges`, `workspacePath` containment | `tests/unit/root-authority.test.ts`, RT-01…RT-03 |
| §7.3 | Durable ledger for every ALLOW / REQUIRE_OWNER / DENY with the §7.3 field set | `root-audit-ledger.ts` (JSONL, sequence + hash chain) | `tests/unit/root-authority.test.ts` |
| §7.3 | The ledger may not be truncated and continue | `assertHistoryIntact` | `tests/unit/root-authority.test.ts` ("detects truncation, deletion and tampering") |

## §8 Phase F2 — Stable / Candidate isolation

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §8.1 | Stable supervises; a Candidate may crash; Stable stays alive; no in-place overwrite of running Stable | `candidate-supervisor.ts` | `tests/unit/stable-candidate.test.ts`, RT-18/RT-19 |
| §8.2 | Immutable base SHA, unique run id, branch, workspace, runtime-data, temp, process namespace, log/evidence directory | `evolutionLayout` | `tests/unit/stable-candidate.test.ts` |
| §8.2 | Never construct in the `main` working tree | `createCandidateWorkspace` builds a linked worktree | `tests/unit/stable-candidate.test.ts` |
| §8.2 | worktree vs clone chosen deliberately, with the reason recorded | `workspace-manager.ts` header comment; the three conditions hold (no worker shell, host-only git writes, candidate-rooted file API) | `tests/unit/stable-candidate.test.ts`, `ARCHITECTURE.md` §5 |
| §8.3 | No shared writable DB, history, session state, account session, checkpoints, browser partition, PID/lock, temp, artifact dir, candidate journal | `STABLE_WRITABLE_SURFACES` + `assessRuntimeWrite` | `tests/unit/stable-candidate.test.ts`, RT-04 |
| §8.4 | Candidate crash / uncaught exception / forced kill / bad config / corrupt runtime-data: Stable survives, is not locked, loses no durable state, does not auto-promote, can start the next Candidate | `CandidateSupervisor.supervise` returns an outcome and never rethrows; `recoverStaleLock`; `quarantineRuntime` | `tests/unit/stable-candidate.test.ts`, RT-18/RT-19 |

## §9 Phase F3 — Credential boundary

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §9.1 | Boss and Owner credentials are different trust domains | `credential-boundary.ts`, `github-credential-provider.ts` | `tests/unit/credential-boundary.test.ts` |
| §9.2 | Candidate/worker subprocesses use a sanitized environment; `GH_TOKEN`, `GITHUB_TOKEN`, Owner tokens, SSH agent forwarding, admin vars, Stable-only secrets and signing secrets are blocked; `process.env` is not passed through | `sanitized-environment.ts`; `command-runner.ts` gained an **optional** env seam whose default is unchanged | `tests/unit/credential-boundary.test.ts` (real child process probe), RT-23 |
| §9.2 | Audit whether the existing runner can leak ambient credentials | Audited; a sanitized env is now injectable and the evolution profile always injects one | `tests/unit/root-authority-execution-profile.test.ts` |
| §9.3 | Dedicated `BossGitHubCredentialProvider`; no Owner credential read; no ambient admin fallback; missing credential returns `BLOCKED_EXTERNAL` | `github-credential-provider.ts` | `tests/unit/credential-boundary.test.ts`, RT-22 |
| §9.4 | Boss identity may branch/commit/PR/read CI/merge ordinary PRs; may never administer the repo, mutate rulesets or secrets, bypass main or grant itself permission | `github-promotion-adapter.ts` URL guard; `isForbiddenApiUrl`; ordinary merge only | `tests/unit/promotion-gate.test.ts` |
| §9.4 | The real GitHub App/bot is an Owner action; the harness must not impersonate Boss identity with an Owner token | No live GitHub identity was created or used. `READY_FOR_UNATTENDED_PROMOTION` is reported honestly | `FINAL-ACCEPTANCE.md` |

## §10 Phase F4 — Execution profile

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §10.ALLOW | Workspace-scoped read, bounded patch, host-selected test/build, git status/diff, Candidate-local test, branch metadata read, evidence write, reviewer role | `EVOLUTION_WORKER_ALLOWED` | `tests/unit/root-authority-execution-profile.test.ts` |
| §10.DENY | Arbitrary shell, `git push main`, `git checkout main`, `git reset --hard`, `gh api` admin, `curl` with an Owner token, arbitrary PowerShell, credential-manager/registry dump, home-directory secret scan, browser navigation to Owner admin, Stable process kill, Stable runtime-data write | `EVOLUTION_WORKER_DENIED`, `classifyEvolutionCommand`, `isOwnerAdministrationTarget` | `tests/unit/root-authority-execution-profile.test.ts`, RT-05/RT-06/RT-24 |
| §10 | Remote GitHub side effects go through the host promotion adapter, never a worker shell | Only `github-promotion-adapter.ts` reaches the network | `tests/unit/promotion-gate.test.ts` |

## §11 Phase F5 — Promotion gate

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §11.1 | The full state machine; worker `DONE`, reviewer "looks good" and local PASS never map to `PROMOTED` | `promotion-state.ts` table; `PromotionController.beginPromotion` / `completePromotion` | `tests/unit/promotion-gate.test.ts` |
| §11.2 | Bind `candidateHeadSha == ciValidatedSha == prHeadSha == promotionSha`; any change voids the old PASS | `evaluateExactShaBinding`, `ExactShaGate` (reads live HEAD) | `tests/unit/promotion-gate.test.ts`, RT-14/RT-15 |
| §11.3 | Ordinary code + exact SHA + green CI + up-to-date + clean review + no stop ⇒ `PROMOTABLE` | `decidePromotion` | `tests/unit/promotion-gate.test.ts` |
| §11.4 | Root Surface ⇒ `WAITING_FOR_ROOT_OWNER` even when everything is green | `decidePromotion` protected-surface branch | `tests/unit/promotion-gate.test.ts`, RT-09…RT-13 |
| §11.5 | GitHub ruleset/CODEOWNERS/`validate`/user-only bypass is the external second gate; Boss may not assume its internal `ALLOW` overrides it | The adapter has no administration endpoint and no admin merge | `tests/unit/promotion-gate.test.ts` |

## §12 Phase F6 — Rollback & Root recovery

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §12.1 | Compile fail, test fail, reviewer blocker, CI fail, stale SHA, unapproved Root Surface, crash, timeout, state corruption never pollute Stable | `assessStableImpact` (all nine classes) | `tests/unit/root-recovery.test.ts` |
| §12.2 | Retain previous Stable SHA, promoted SHA, run id, evidence and reason; deterministic rollback; no model memory, no provider history, no checkpoint-less rollback | `RollbackController` (checkpoint required, revert-commit plan) | `tests/unit/root-recovery.test.ts` |
| §12.3 | An evolution-module fault degrades/aborts **evolution**, not Boss | `assessStableImpact.evolutionState`; `EmergencyControl` evidence log | `tests/unit/root-recovery.test.ts`, RT-25 |

## §13 Phase F7 — Emergency control

| Clause | Requirement | Implementation | Acceptance |
|---|---|---|---|
| §13 | Owner has an independent stop that blocks new Candidates, stops the running one, blocks promotion, freezes evolution, keeps evidence and does not break Stable | `EmergencyControl.emergencyStop` | `tests/unit/emergency-control.test.ts` |
| §13 | `EvolutionControlState = ENABLED \| FROZEN_BY_OWNER`; only an Owner-controlled path clears it; no self-clear, no restart bypass, no new-run bypass | `EvolutionKillSwitch` (re-read every call, no cache) + `OwnerControlChannel` registry | `tests/unit/emergency-control.test.ts`, RT-20/RT-21 |
| §13 | An external fuse/sentinel lives outside the Candidate workspace, is unwritable by the Candidate profile, and fails closed when missing/unreadable rather than reading absence as consent | `EvolutionKillSwitch` constructor guard; documented read policy in the module header | `tests/unit/emergency-control.test.ts` |

## §14 Phase F8 — Red team

All 25 cases (RT-01…RT-25) are implemented as executing tests in
`tests/unit/root-authority-red-team.test.ts`. The plan's final note — "测试本身不能
通过修改 production guard 来特殊识别 fixture 然后装作安全" — is honoured: the
battery uses real git repositories, real directory junctions, real child
processes and real files; no production module contains fixture awareness.

## §15 Failure isolation

FI-01…FI-05 are implemented in
`tests/unit/stable-candidate-fault-isolation.test.ts`, each as a *combined*
fault rather than a single one.

## §17 Existing behaviour that must not regress

| Clause | Guard |
|---|---|
| Ordinary chat/work does not require the Owner | `tests/unit/owner-authority.test.ts` (ordinary files are `ALLOW`); the Root Authority is not consulted by chat/work paths |
| Ordinary engineering goals are not gated per step | `ALLOW` floor for the whole ordinary work group |
| A provider failure does not take down the main controller | `tests/unit/stable-candidate-fault-isolation.test.ts` (FI-01), RT-25 |
| 1/3/5 AI selection, fleet, knowledge and research pipelines unaffected | No existing module was modified except the optional env seam in `command-runner.ts`; full regression is green |
| Not every file became a CODEOWNER | `tests/unit/owner-authority.test.ts` ("boundary does not swallow ordinary product code") |
| No acceptance was deleted, no test skipped/`only`-ed, no gate weakened, no `UNAVAILABLE` turned into `PASS`, no coder standing in for the reviewer, no model self-reported convergence | No existing test file was modified or removed; the only edits to existing files are the optional `env` seam in `command-runner.ts`, the two `.gitignore` entries, and the CODEOWNERS-covered new modules |

## §18 Forbidden functional build-out

Nothing from the §18 list was built. Improvements discovered while working are
recorded in `FUTURE-OPPORTUNITIES.md` instead.

## §19 GitHub / CODEOWNERS behaviour

The final PR modifies Root Surface paths, so GitHub is expected to require
`@zhiheng-zhang-Mera` Code Owner review. That is the **success condition** of
this round, not a blocker. No Owner bypass was used, CODEOWNERS was not weakened,
required checks were not lowered, the ruleset was not touched, and no self-approval
occurred.

## §20 Gates

typecheck, build, full test, benchmark, `package:portable`,
`scripts/smoke-portable.ps1` and `scripts/acceptance-restart.cjs` were all run.
Results: `ACCEPTANCE-MATRIX.md` (RD-017/RD-018) and `evidence/regression.json`.
Where a probe could not run in this environment it is reported as
`BLOCKED_EXTERNAL` with the concrete external action required.

## §21 Two readiness verdicts

Reported separately, never merged: `READY_FOR_CONTROLLED_AUTONOMOUS_EVOLUTION`
and `READY_FOR_UNATTENDED_PROMOTION`. See `FINAL-ACCEPTANCE.md`.

## §22–§25 Evidence, acceptance matrix, final acceptance, closeout

`evidence/` holds machine-derived per-phase JSON. `ACCEPTANCE-MATRIX.md` carries
RD-001…RD-020 with no `Pending` rows. `FINAL-ACCEPTANCE.md` opens with the §24
verdict block. Closeout conditions §25.1–§25.13 are listed in
`FINAL-ACCEPTANCE.md` §4.
