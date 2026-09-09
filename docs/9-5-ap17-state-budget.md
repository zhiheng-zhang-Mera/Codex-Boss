# AP17 — State.json Array Lifecycle + L0–L4 Tiers/TTL (seam)

Compact handoff closing the remaining AP17 seam (plan §17; audit: checkpoint-generation retention
existed via storage-budget.ts, unbounded state.json arrays and L0–L4 tiers/TTL absent).
Branch `9-5`.

## Why

`storage-budget.ts` bounded the append-only ledger checkpoints, but the in-memory + persisted
arrays in `state.json` (tasks / runs / artifacts / councils / evidence bundles / final responses /
dispatch checkpoints) grew without bound, and the plan's L0–L4 tier vocabulary had no code
representation. This pack ships the tier model and a state-array budget that prunes terminal rows
with cascading orphan cleanup while never touching active work.

## What was added

- **`src/shared/data-lifecycle.ts`** (new, pure)
  - `DataTier = L0…L4`, `TierRule`, `DEFAULT_TIER_RULES` (L0 temporary → L4 cold archive with
    plan §17 TTL days), `classifyRecord({family, updatedAt, terminal?})` — deterministic family →
    tier mapping (tasks/runs/artifacts/evidence/final-response/checkpoint/event).
  - `withinTtl(updatedAt, tier, rules, now)`, `StorageBudgetPolicy {maxCompletedTasksPerConversation,
    maxRunsPerTask, enforceTtl, protectedFamilies}`, `validateBudgetPolicy`, `LifecyclePruneReport`.
- **`electron/commander/state-budget.ts`** (new)
  - `applyStateStorageBudget(snapshot, policy, now)` — hard rules:
    - active work (queued/running/waiting/paused) is never pruned;
    - completed tasks beyond the per-conversation cap are removed with a cascade that drops their
      orphaned runs/artifacts/councils/evidence/final-responses/checkpoints;
    - optional per-task run-history cap and opt-in terminal-task TTL (aged to L4);
    - `protectedFamilies` blocks pruning; reports per-family removed counts + retained tasks.
- **`electron/store.ts`** (wired)
  - `StateStore.applyStorageBudget(policy?)` — applies the budget to the live snapshot and
    persists only when something was removed (idempotent, default = no-op policy).
- **`tests/state-budget.test.ts`** (new, 5 tests) — pure tier classification + TTL window +
  policy validation; active-task protection + newest-completed-per-conversation retention; orphan
  cascade when tasks are pruned; opt-in TTL pruning + `protectedFamilies`; run-history cap.
  Also `tests/storage-budget.test.ts` (existing, 3) still PASS.

## Verification

- Targeted: `state-budget` (5) + `storage-budget` (3) + `store` (8) + `state` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: 80 files / 374 tests PASS (run before the final batch land).

## Boundary notes

- Default policy is a no-op: enabling retention is an explicit operator choice
  (`applyStorageBudget` on startup / IPC), matching the repo's "never silently delete" stance.
- Ledger checkpoints (`.boss/tasks/…`) are bounded by `storage-budget.ts`; this pack bounds the
  state.json arrays only. Callers enabling per-conversation caps should flush/retain ledger data
  they still need (documented on the method).
- Events were already capped at 200 in the store (`event()`); unchanged.

## Checkpoint

Commit with: `src/shared/data-lifecycle.ts`, `electron/commander/state-budget.ts`,
`electron/store.ts`, `tests/state-budget.test.ts`, this handoff.
