# 9-6 Research Round 7 — Intervention → Research Resume Loop

Compact handoff for the round-7 deterministic slice: closing the pause/resume loop between the
Phase 4 human-guidance gate and the Phase 5 research supervisor. Branch `9-6-research`.

## Why

`boss:research-wait` paused a research run (WAITING_FOR_USER) and raised a
HumanInterventionRequest, but resolving the intervention only recorded the answer — the run
stayed paused. Resuming required a manual state write. This round closes the loop: answering a
guidance card for a research run moves it from its control state back to SCOPING and publishes
HUMAN_APPROVED so autopilot can continue.

## What was added

- **`electron/research/research-supervisor.ts`**
  - `resume(id)` — resumes a run only when it is paused at WAITING_FOR_USER /
    WAITING_FOR_PROVIDER / RECOVERING (back to SCOPING); returns false for normal/terminal states
    and unknown ids (no throw).
- **`electron/main.ts`**
  - `boss:resolve-intervention` now calls `researchSupervisor.resume(taskId)` after recording the
    answer and publishes HUMAN_APPROVED when a research run actually resumed.
- **`tests/research-supervisor.test.ts`** (+1 test) — resume from WAITING_FOR_USER → SCOPING;
    non-resumable states (PROTOCOL_FROZEN/FAILED) return false; unknown id returns false.

## Verification

- Targeted: `research-supervisor` (6) + `human-guidance-gate` (5) PASS; typecheck PASS.

## Checkpoint

Commit with: `electron/research/research-supervisor.ts`, `electron/main.ts`,
`tests/research-supervisor.test.ts`, this handoff.
