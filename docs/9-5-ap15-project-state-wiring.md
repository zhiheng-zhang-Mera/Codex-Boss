# AP15 — Task Completion → Project State + Goal-Tree UI (seam)

Compact handoff closing the remaining AP15 seam (plan AP15; audit: per-workspace project-state
store existed, task-completion wiring and goal-tree UI absent). Branch `9-5`.

## Why

`ProjectStateStore` recorded goals/decisions/research when asked, but nothing wrote into it when
a task completed, and there was no renderer-consumable goal-tree projection. This pack wires task
completion into project state (decision + research ledger + goal status + next actions) and
provides the shared goal-tree view model + IPC surface for the UI.

## What was added

- **`src/shared/project-tree.ts`** (new, pure)
  - `buildGoalTree(goals)` → rooted `GoalView` tree with status counts; fail-closed on duplicate
    ids, invalid status, missing parent, cycles/unreachable nodes, unbounded depth.
  - `summaryOf(goals)`, `ProjectStateSummary { workspaceId, goals, decisionCount, researchCount,
    openQuestions, nextActions, tree, updatedAt }` (renderer-safe DTO).
- **`electron/project/project-state.ts`** (extended)
  - `upsertGoal`, `setGoalStatus`, `recordTaskCompletion(workspaceId, …)` (marks the matched goal
    done, appends accepted decision + research-ledger entry with evidence refs, bounded next
    actions) and `summary(workspaceId)`.
- **`electron/project/task-completion-recorder.ts`** (new) — `recordTaskCompletion` helper with
  title/goal-id matching; `workspaceForTask` snapshot lookup.
- **`electron/main.ts`** (wired)
  - `recordTaskOutcome(taskId)` invoked at durable completion paths (council synthesis completion
    and the automation finalize callback) so accepted tasks land in project state without model
    summary text.
  - IPC `boss:project-state(workspaceId?)` returning the summary.
- **`electron/preload.ts` + `src/shared/contracts.ts`** (surface) — `projectState()` on the bridge.
- **`src/renderer/main.tsx`** — fetches the summary on snapshot updates and renders a goal-tree
  panel (`GoalNodeView`) with status counts, open questions and next actions inside Runtime
  Status.
- **`tests/project-state-recorder.test.ts`** (new, 3 tests) — tree building/status counts +
  cycle/orphan/duplicate rejection; upsert + completion recording → decisions/research/goal-done/
  next actions + summary projection; fail-closed unknown workspace/goal.

## Verification

- Targeted: `project-state-recorder` (3) + `project-state` (existing) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Recording is advisory: a failure never blocks task completion.
- Goal matching is deterministic (title or explicit goal id); auto-creating goals from free text
  is deliberately not done (research plan owns goal intake UI).
- Task-completion recording is wired at the two durable finalize paths present in `main.ts`;
  additional completion sources (e.g. future research runtime) should call
  `recordTaskOutcome(taskId)` after `saveFinalResponse`.

## Checkpoint

Commit with: `src/shared/project-tree.ts`, `electron/project/project-state.ts`,
`electron/project/task-completion-recorder.ts`, `electron/main.ts`, `electron/preload.ts`,
`src/shared/contracts.ts`, `src/renderer/main.tsx`, `tests/project-state-recorder.test.ts`,
this handoff.
