# 9-6 Research Round 8 — Honest Reviewer-Gate Pauses

Compact handoff for the round-8 deterministic slice: reviewer-gated research stages no longer
"advance anyway" while a text marker says a web-AI reviewer is required. Executors now signal a
real pause, and the supervisor honors it. Branch `9-6-research`.

## Why

The research plan's hard rule is **evidence > vote** (never fabricated advancement). Before this
round, `DefaultLevelBExecutor` returned a "requires web-AI reviewer" text marker for
reviewer-gated stages (literature review, RQ formulation, experiment design, analysis,
manuscript) but `ResearchSupervisor.step()` advanced the run's main state unconditionally — the
run moved past a gate no executor actually passed, which is exactly the fabricated-advancement
failure mode the plan forbids.

## What was added

- **`src/shared/research-ir.ts`**
  - `ResearchIR.pendingStage?: ResearchState` — when a run is paused at a reviewer/decision
    gate, the exact stage to resume into; validated to be a main state.
- **`electron/research/research-ledger.ts`**
  - `advance()` clears any stale `pendingStage` (an advance is a real gate crossing);
  - `pauseAt(id, pendingStage, reason)` — atomic checkpoint that parks the run at
    `WAITING_FOR_PROVIDER` with `pendingStage` recorded.
- **`electron/research/research-supervisor.ts`**
  - `step()` refuses to run while in a control state (`RECOVERING` / `WAITING_FOR_PROVIDER` /
    `WAITING_FOR_USER`) — a paused run can only move through an explicit `resume()`, never by
    stepping (which would silently restart from SCOPING);
  - `step()` honors `StageOutcome.pause`: it appends a `paused:<stage>` decision, parks the run
    at `WAITING_FOR_PROVIDER` with `pendingStage`, and does **not** advance the main state;
  - `resume()` returns a control-paused run to its recorded `pendingStage` (never a restart
    from SCOPING); falls back to SCOPING only when no pending stage exists (Phase 4 guidance
    resume stays intact).
- **`electron/research/default-levelb-executor.ts`**
  - Reviewer-gated stages (LITERATURE_REVIEW, QUESTION_FORMULATION, EXPERIMENT_GENERATION,
    ANALYSIS, MANUSCRIPT) now return `{ pause: true, pauseReason }` instead of a bare marker;
    SCOPING/PROJECT_INSPECTION/terminal stages stay deterministic/no-op and never pause.
- **`electron/research/levelb-pipeline-executor.ts`**
  - Explicit `PIPELINE_FLAGGED` handling (LITERATURE_REVIEW / QUESTION_FORMULATION /
    EXPERIMENT_GENERATION): the offline deterministic stand-in *flags* the gate in the reason
    and proceeds on injected reviewer inputs — it never fabricates evidence, and it only
    proceeds because this executor *is* the injected-reviewer offline harness. Live/headless
    flows use `DefaultLevelBExecutor`, which pauses at those gates.

## Verification

- Targeted: `research-supervisor` (7) + `research-service` (3) + `levelb-executor` (2) +
  `levelb-pipeline` (2) + `levela-planner` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Behavior notes

- `boss:research-step` on a paused run returns the paused state unchanged; the GUI must offer
  "resume" (back to the pending stage) rather than another step.
- The live web-AI Level-B flow replaces `DefaultLevelBExecutor` with a real reviewer executor;
  the pause/resume loop is the exact seam it plugs into (stage re-entered on resume → reviewer
  outcome recorded → executor returns a non-pause outcome → advance).

## Checkpoint

Commit with: `src/shared/research-ir.ts`, `electron/research/research-ledger.ts`,
`electron/research/research-supervisor.ts`, `electron/research/default-levelb-executor.ts`,
`electron/research/levelb-pipeline-executor.ts`, `tests/research-supervisor.test.ts`,
`tests/research-service.test.ts`, `tests/levelb-executor.test.ts`, this handoff.
