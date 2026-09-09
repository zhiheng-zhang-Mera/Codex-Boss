# 9-6 Research Round 26 — Level-A Plan Starts a Durable Research Run

Compact handoff for the round-26 deterministic slice: `LevelAPlanner` produced a validated
`LevelAPlan`, but nothing seeded a durable research run from it — the selected falsifiable
question + hypothesis never entered the ResearchIR, so Level-A planning ended at the plan object.
Branch `9-6-research`.

## Why

Phase 12 Level-A should drive the same research pipeline: planner output → run IR (question +
hypothesis recorded) → freeze (live) → experiments → analysis → manuscript. Without an adapter,
the plan object is the terminal artifact and the durable run has to be re-typed by hand.

## What was added

- **`electron/research/research-service.ts`**
  - `startLevelA({ id, goal, workspace, reviewers, plan })` — fail-closed
    (`validateLevelAPlan`: falsifiable question + ≥2 replication runs required), starts a run in
    SCOPING with `researchQuestions` = the selected question and `hypotheses` = the plan's
    hypothesis. It never invents a protocol — `freeze()` is still required before experiments.
- **`tests/research-service.test.ts`** (+1 test)
  - Level-A plan → run seeded with question/hypothesis, state SCOPING, no protocol hash yet; a
    plan with 1 replication run fails closed.

## Verification

- Targeted: `research-service` (5) + `levela-planner` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Protocol freeze and experiments remain live/GUI steps; this slice makes Level-A planning reach
  the durable run scaffold deterministically.

## Checkpoint

Commit with: `electron/research/research-service.ts`, `tests/research-service.test.ts`,
this handoff.
