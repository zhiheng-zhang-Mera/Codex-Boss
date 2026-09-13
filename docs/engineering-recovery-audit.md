# Engineering recovery: which routes take a recovery point, and why

> Codex-Boss convergence book, Phase C. Every claim below was produced by reading
> the repository (`grep` + direct reads), not from intent. Line numbers are as of
> commit `e2759a5` plus this round's edits.

## The rule

```text
Autonomous Mutating Engineering Entry
        ↓
Validated Workspace
        ↓
Recovery Point (captureRecoveryPoint)
        ↓
Mutation
        ↓
Independent Verification
        ↓
CONVERGED ?  YES → preserve / NO → rollback
```

`captureRecoveryPoint` has exactly **one** production caller: `MainCommander.runEngineeringGoal`
(`electron/commander/main-commander.ts`). `restoreRecoveryPoint` has two: the driver-exception
path and the non-converged path in the same method. That is enforced by
`tests/unit/repository-boundary-guards.test.ts`, which also asserts the ordering
inside the method (recovery point → driver construction → `driver.run()`).

## The routes

| # | entry point | mutates | recovery point | rollback | verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `MainCommander.runEngineeringGoal`, IPC `boss:engineering-goal-run` | the user's workspace | yes, before the driver exists | yes, both on a driver throw and on every non-converged terminal state | **COVERED** |
| 2 | `MainCommander.executePlan` → `ProposalRunner` → `applyScopedChanges` (`electron/engineering/verification.ts`) | the user's workspace | no | no | **Owner-driven** (see below) |
| 3 | `engineering/workspace.ts#prepareWorkspace` / `prepareStepWorkspace` | branch/worktree refs in the user's repo | no | no | Owner-driven (route 2 only) |
| 4 | `MainCommander.executeDeterministic` → `runNative` → `runAllowedCommand` | build/test outputs inside the workspace | no | no | Owner-driven (route 2 only) |
| 5 | `boss:research-autopilot` → `ResearchConductor` writes `<workspace>/experiments/*.js` | the user's research workspace | no | removes only its own probe file | **NOT COVERED** |
| 6 | `SelfEvolutionCoordinator.run` → candidate worktree + branch | an isolated candidate worktree, plus a branch ref | isolation replaces the point | candidate isolation; `removeCandidateWorkspace` has no caller | **GAP** |
| 7 | `promotion-gate/github-promotion-adapter` → `git push` | the remote | promotion record + `stable.rollback` | pointer rollback + Guardian gate | justified |
| 8 | `engineering/verification-engine.ts#applyChangeUnit` | a target repo | per-unit `before` snapshot | returned closure | justified (caller-owned; used by the soak harness) |
| 9 | `engineering/release-runner.ts`, `git-checkpoint.ts` | the repo it runs from | git-checkpoint record | git-checkpoint restore | justified |
| 10 | `input/github-resolver.ts` clone/fetch into the app cache | the app's own cache | n/a | n/a | justified (not user work) |
| 11 | `self-engineering/self-mod-sandbox.ts` | app data + a candidate branch | sandbox isolation | `conclude()` discard | justified |
| 12 | `scripts/**` acceptance harnesses | fixtures, `artifacts/`, temp | n/a | n/a | justified |

## Why route 2 is deliberately not covered

The book's rule is about **autonomous** mutation. `executePlan` is not: the Owner
dispatched that task with a specific objective, and the product's verified
contract (MODEL_DONE ≠ COMPLETED, `PARTIAL_STATE`, the review ladder) is that
partial work is **kept and surfaced** for the Owner to inspect and retry — the
same work the Owner asked for. Rolling that back automatically would overturn a
verified behaviour, which this round forbids.

The distinction is therefore the rule, and it is asserted rather than remembered:

- the autonomous route takes a recovery point before it can touch anything;
- the Owner-driven route keeps its writes visible and reports its state.

`tests/unit/repository-boundary-guards.test.ts` asserts both halves — that
`applyScopedChanges` does *not* call `captureRecoveryPoint`, and that this
document explains why.

## Gaps this round did not close (with the reason)

1. **Route 5 — research autopilot.** `ResearchConductor.generateExperimentImplementation`
   writes generated experiment source into the workspace the Owner selected for
   the research run. Removing it on non-convergence changes what a paused
   research run leaves behind, which is a product decision about resumability,
   not a mechanical fix. **Deferred**, not verified.
2. **Route 6 — candidate cleanup.** `removeCandidateWorkspace`
   (`electron/stable-candidate/workspace-manager.ts`) has no caller, so a failed
   candidate leaves its worktree and branch behind. Calling it changes
   Self-Evolution lifecycle behaviour and belongs with the Self-Evolution
   acceptance round. **Deferred**; the dead-code finding is recorded in
   `docs/phase-status.md`.
3. **Routes 3/4** inherit route 2's reasoning, but a *terminal* failure that
   leaves a worktree behind has no cleanup. Recorded as deferred for the same
   reason.

## Verification

`tests/unit/engineering-recovery.test.ts` drives the covered route over the real
`MainCommander` and a real git repository for every terminal state: checkpoint
unavailable, driver exception (with and without a rollback failure), ABORTED,
STAGNANT, CONVERGED, plus workspace-identity cases. Nothing in this document is
claimed on the strength of a code read alone.
