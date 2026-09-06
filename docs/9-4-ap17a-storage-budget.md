# AP17a — Data Lifecycle / Storage Budget (bounded checkpoint retention)

Compact handoff for Acceptance Pack **AP17a** (plan §17 Data Lifecycle + Storage Budget; audit
item 4: ledger checkpoints append unbounded, state arrays unbounded). Branch `9-4`.

## Why

The audits flagged the append-only ledger as the first real storage risk: every `TaskLedger.save`
writes a new `<task>/checkpoints/NNNNNNNN.json` generation and nothing ever deletes, so a
long-running or long-lived task accumulates unbounded files. Full L0–L4 tiering is a v3-scale
design; this pack delivers the smallest sound step: bounded generation retention with a
fail-closed prune.

## What was added

- **`electron/commander/storage-budget.ts`** (new)
  - `RetentionPolicy { keepGenerations }` (default 50, min 5) and `PruneReport`.
  - `pruneTaskCheckpoints(root, taskId, policy)` removes only the oldest generations and keeps
    the newest `keep`; refuses an invalid policy and never deletes when the newest generation
    cannot be identified (fail-closed).
- **`electron/commander/task-ledger.ts`**
  - `save()` performs an **amortized** prune every 20 revisions so checkpoint growth is bounded
    while recovery semantics (read newest only, monotonic revision) are untouched.
- **`tests/storage-budget.test.ts`** (new, 3 tests) — explicit prune keeps newest generations and
  preserves newest revision; policy guard + no-op within budget; ledger save-path bounding.

## Verification

- Targeted: `storage-budget` (3) + `recovery-closure`, `execution-supervisor`, `provider-state`
  PASS (ledger round-trips unchanged).
- Electron `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Only checkpoint generations are bounded here. Unbounded `state.json` arrays (tasks/runs/
  artifacts/evidence) and the remaining L0–L4 tiers, TTL and dedup/summary layers stay queued —
  this pack is the deliberate first storage-budget step, matching the audit's smallest-first
  ordering.
- Prune is amortized (every 20 revisions), so it does not add per-save directory scans on the
  hot path.

## Checkpoint

Commit with: `electron/commander/storage-budget.ts`, `electron/commander/task-ledger.ts`,
`tests/storage-budget.test.ts`.
