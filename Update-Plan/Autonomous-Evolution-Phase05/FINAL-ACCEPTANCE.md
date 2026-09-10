# Final Acceptance — Phase 0.5

**Plan:** `Update-Plan/Alien-Prestart.md` §24, §25, §28
**Generated from:** `evidence/final-readiness.json`, `evidence/regression.json`, `evidence/S0-baseline.json`

## First screen

```text
BASE_SHA: 6f9f2974923325fd523fe9b697c0189e07f15957
CANDIDATE_SHA: cde3738-cde3738
BRANCH: Prestart
PR: none (the branch was delivered directly; no pull request was opened)

TYPECHECK: PASS
BUILD: PASS
FULL_TEST: PASS
BENCHMARK: NOT_RUN
PORTABLE_SMOKE: NOT_RUN
RESTART_ACCEPTANCE: NOT_RUN

SELF_TARGET_RESOLVER: PASS
PRODUCTION_WIRING: PASS
MANDATORY_SELF_ROUTE: PASS
HARD_EXECUTION_SANDBOX: PASS
SANDBOX_RED_TEAM: PASS
ROOT_AUTHORITY_PRODUCTION: PASS
EMERGENCY_CONTROL_PRODUCTION: PASS
PROTECTED_DIFF_CLASSIFICATION: PASS
BOSS_GITHUB_IDENTITY: BLOCKED_EXTERNAL
REAL_ORDINARY_PROMOTION: BLOCKED_EXTERNAL
REAL_ROOT_PR_GATE: BLOCKED_EXTERNAL
PROMOTED_RUNTIME_BOOT: PASS (mechanism and pointer contract; no live promotion to boot)
ROLLBACK_AFTER_BAD_BOOT: PASS
SOLO_RUN_A: PASS (harness-driven)
SOLO_RUN_B: PASS (harness-driven)
SOLO_RUN_C: PASS (harness-driven)

READY_FOR_SELF_EVOLUTION_COMPONENTS: TRUE
READY_FOR_CONTROLLED_REAL_SELF_EVOLUTION: TRUE
READY_FOR_SOLO_REMOTE_PROMOTION: FALSE
READY_FOR_REAL_AUTONOMOUS_EVOLUTION: FALSE

BLOCKED_EXTERNAL: no dedicated Boss GitHub identity (CODEX_BOSS_GITHUB_TOKEN / CODEX_BOSS_GITHUB_IDENTITY)
UNEXPECTED_FAIL: 0
REGRESSIONS: 0
HARNESS_INTERVENTIONS_DURING_SOLO_RUNS: 0
```

Numbers behind `FULL_TEST` and `REGRESSIONS` are in `evidence/regression.json`
(`testFilesPassed` / `testFilesFailed`, `testsPassed` / `testsFailed`); `TYPECHECK` and
`BUILD` are recorded in the same file and in `evidence/S0-baseline.json`.
`CANDIDATE_SHA` is the commit this document was committed with — read it from
`evidence/final-readiness.json` (`candidateSha`) for the exact value.

## Readiness levels, one by one

### READY_FOR_SELF_EVOLUTION_COMPONENTS — TRUE

The components exist, are wired into one composition root, and are exercised by executed
tests: the self target resolver, the mutation guard, the coordinator, the typed host
operation channel, the stable runtime pointer, and the Windows hard sandbox. The three
suites named in `ACCEPTANCE-MATRIX.md` pass with zero failures, `typecheck` and `build` pass,
and the full pre-existing suite is unchanged.

### READY_FOR_CONTROLLED_REAL_SELF_EVOLUTION — TRUE

A self-target edit task can no longer reach the ordinary engineering path: `electron/main.ts`
installs the host on `MainCommander`, `runPlan` hands such a task to
`SelfEvolutionCoordinator`, and three production mutation boundaries refuse a Stable write
that no `EvolutionRunContext` covers. Candidate code really executes under an operating
system sandbox — the red team proves it with eleven executed attacks plus a positive control.
The Root Surface stops the flow at `WAITING_FOR_ROOT_OWNER` without self-approval.

"Controlled" is the operative word: this level is satisfied **with the Harness still in the
loop**, which is exactly what §28 means by a controlled state.

### READY_FOR_SOLO_REMOTE_PROMOTION — FALSE

`CODEX_BOSS_GITHUB_TOKEN` and `CODEX_BOSS_GITHUB_IDENTITY` are unset on this host, so no
branch was pushed and no pull request was merged by a dedicated Boss identity. The coordinator
parks in `BLOCKED_EXTERNAL` with the required Owner action attached to the promotion record
rather than pretending a promotion happened.

### READY_FOR_REAL_AUTONOMOUS_EVOLUTION — FALSE

Three of the plan's conditions are unmet, and none of them can be met from inside this
repository:

1. no dedicated Boss GitHub identity (SF-017, SF-019…SF-023);
2. therefore no real remote promotion and no real Root pull request;
3. therefore no live Solo Flight run against a real promotion.

## The single external blocker, and the exact action that clears it

Create a dedicated Boss GitHub App or bot identity and configure it with exactly:

| Capability | Why |
|---|---|
| Contents: write | push the `evolution/<run-id>` Candidate branch |
| Pull requests: write | open and merge the ordinary pull request |
| Checks / Actions status: read | read the required `validate` result for an exact SHA |
| Metadata: read | resolve the repository |

Then export, for the Stable host only:

```text
CODEX_BOSS_GITHUB_TOKEN
CODEX_BOSS_GITHUB_IDENTITY
```

Never reuse the Owner token and never let the identity equal the Root Owner login: the
credential provider refuses both cases, and `tests/unit/self-evolution-route.test.ts` asserts
those refusals. Administration, ruleset administration, secrets administration and any main
bypass remain forbidden.

## What is proven

* Boss identifies its own repository from host facts — realpath, git root, shared git common
  directory, remote identity and a product marker — through junctions, symlinks, `..` paths
  and linked worktrees, and does not misidentify a same-named stranger repository.
* Every production mutating seam refuses a Stable write with no `EvolutionRunContext`, and the
  only way to obtain one is `SelfEvolutionCoordinator`.
* The coordinator composes the whole Phase 0 layer in one readable flow, and reuses the
  existing engineering loop inside a Candidate worktree without touching Stable.
* Candidate-authored code really executes, under a Windows AppContainer with no capabilities
  and a Job Object with an active-process ceiling, and cannot read the Owner secret fixture,
  write Stable or Stable runtime-data, reach a local HTTP endpoint, see `GH_TOKEN`, read a
  credential fixture, escape through a junction, or survive a timeout in a way that harms
  Stable.
* A real `git diff --name-status` change set feeds the protected-surface guard, and a single
  Root file among more than thirty ordinary files still yields `WAITING_FOR_ROOT_OWNER`.
* The promotion state machine stops a Root change after its PR and CI PASS, with
  `rootOwnerApproval` still `null` and no merge call issued.
* A failed promoted-runtime boot rolls the stable pointer back to the previous Stable and
  records why.
* The whole pre-existing suite still passes.

## What is not proven

* That a real branch push, pull request, `validate` check and merge succeed against
  github.com with a dedicated Boss identity.
* That github.com itself demands a Code Owner approval on a real Root pull request.
* That a live Boss worker (planner/coder/reviewer over a real provider) drives a Solo Flight
  run end to end; the runs used deterministic seams.
* That a promoted runtime boots after a real promotion, because no real promotion occurred.
* Benchmark, portable-smoke and restart-acceptance gates, which were not run this round.

## §28 exit condition

`READY_FOR_REAL_AUTONOMOUS_EVOLUTION` is **FALSE**. Therefore the Harness does **not**
declare its ordinary construction duty finished, the
`autonomous-evolution-solo-baseline` tag is **not** to be applied yet, and the default
organisation remains: Owner holds goals, Root approvals and emergency control; Boss observes,
plans, builds Candidates, verifies, reviews and promotes within the Root boundary; Harness
remains available for construction, external audit and red-team work until the external
identity gate is cleared and the Solo Flight runs have been performed against real remote
promotion.
