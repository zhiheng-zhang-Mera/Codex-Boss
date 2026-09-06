# 9-6 Research Phase 12 — Level-A Planning Core

Compact handoff for codex-boss-9-6-research-plan.md Phase 12 (§12 core). Branch `9-6-research`.

## Why

Level-A accepts only a project goal ("研究 Codex Boss 的多 AI 决策机制…") and must auto-produce
the research question, hypothesis, protocol, benchmark/experiment, statistics, replication,
claims, manuscript and PDF with **0 manual continuation clicks** except genuine decisions.
Execution of real experiments/PDF remains live, but the whole *planning* half (inspect →
novelty/feasibility review → falsifiable RQ selection → experiment spec with replication) is
deterministic and now exists.

## What was added

- **`src/shared/research-levela.ts`** (new, pure)
  - `ProjectSignals` (files/testFiles/languages/topModules from repo inspection);
  - `noveltyReview(candidate, signals)` → `{noveltyScore, feasibilityScore, reasons}` — heuristic
    overlap vs existing tested modules, language breadth, falsifiability, test-harness presence;
  - `levelAGate(review)` — requires novelty + feasibility ≥ 2.0;
  - `buildExperimentSpec` (primary metric + ≥2 replication runs + seed) and
    `validateLevelAPlan`.
- **`electron/research/levela-planner.ts`** (new)
  - `inspectProjectSignals(workspace)` — real bounded repo scan;
  - `LevelAPlanner({propose, primaryMetric})` — `plan(goal, workspace)` runs:
    project inspection → web-AI proposals → `selectFalsifiableQuestion` (Phase 8) →
    novelty review + gate → replicable experiment spec. Live web-AI proposers are injected;
    real experiments are never replaced by mocks (the spec is drafted, execution is live).
- **`tests/levela-planner.test.ts`** (new, 4 tests) — novelty/feasibility + gate; replicable spec
  drafting + validation fail-closed; end-to-end planner on a real temp repo with injected
  proposers; rejection when nothing passes falsifiable/novelty gates.

## Verification

- Targeted: `levela-planner` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Level-A *execution* (benchmark implementation, experiment run, replication, stats, claims,
  manuscript, PDF) rides the Phase 5 supervisor + Phase 6 runtime + Phase 10 evidence +
  Phase 11 manuscript cores under live web-AI; this phase locks the deterministic plan so that
  live Level-A E2E can run with 0 continuation clicks once reviewers/executors are attached.

## Checkpoint

Commit with: `src/shared/research-levela.ts`, `electron/research/levela-planner.ts`,
`tests/levela-planner.test.ts`, this handoff.
