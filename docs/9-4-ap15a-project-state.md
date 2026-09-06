# AP15a — Project State + Decision/Research Ledger

Compact handoff for Acceptance Pack **AP15a** (plan AP15; audit: ContextManager + evidence only
approximate it, no goal tree/initiatives/decision ledger). Branch `9-4`.

## Why

The plan wants a workspace-scoped project state: goal tree, initiatives, accepted/rejected
decisions with reasons and evidence refs, constraints, open questions, next actions, and a
research ledger (what was investigated, findings, which decisions it changed) linked to
reproducibility snapshots. Nothing like it existed outside ephemeral task context.

## What was added

- **`electron/project/project-state.ts`** (new)
  - `GoalNode { id, title, parent?, status }`, `DecisionRecord { decision, outcome:
    accepted|rejected, reason, evidenceRefs, at }`, `ResearchLedgerEntry { question, findings,
    reproSnapshotId?, changedDecisionIds }`, `ProjectState { workspaceId, goals, decisions,
    constraints, openQuestions, nextActions, research, updatedAt }`.
  - `ProjectStateStore` — schemaVersion-1 persisted store: `load/save/appendDecision/
    appendResearch/setOpenQuestions`; workspace-id isolation (a store file may serve multiple
    workspace roots, unknown/mismatched workspace ⇒ empty state); fail-closed corrupt files.
- **`electron/main.ts`** — a store is wired for the active workspace at
  `.boss/project-state.json` under its durable root (same pattern as permission manifests).
- **`tests/project-state.test.ts`** (new, 4 tests) — empty-state + persistence, per-workspace
  isolation, decision/research appends, corrupt/mismatch fail-closed or empty.

## Verification

- Targeted: `project-state` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the ledger/state store seed. Wiring appendDecision/appendResearch from real task
  completions, research/evidence flows (and a goal-tree UI) is the remaining AP15 half.
- Repro snapshot linking is by `reproSnapshotId` reference; the writer from AP05b already
  produces those ids.

## Checkpoint

Commit with: `electron/project/project-state.ts`, `electron/main.ts`,
`tests/project-state.test.ts`.
