# AP02d — Explainable Config Layering

Compact handoff for Acceptance Pack **AP02d** (plan §7 Config Layering). Branch `9-4`.

## Why

The plan requires a fixed precedence chain — System Defaults → Global → Workspace →
Initiative/Task → Emergency — where every final value can explain itself
(`max_workers = 3  source = workspace.yaml`). Before this pack operational limits were a bare
literal `{modelCalls: 12, retries: 3, toolCalls: 100}` baked into `TaskLedger.create()`, with no
layer concept and no provenance.

## What was added

- **`src/shared/config-layering.ts`** (new)
  - `ConfigLayerName` + fixed `CONFIG_LAYER_ORDER` (system < global < workspace < initiative <
    task < emergency).
  - `resolveConfig(systemDefaults, layers)` merges values in that order and records per-key
    provenance; `explainConfigKey`, `configEntries`.
  - `resolveOperationalLimits(task?, global?, workspace?)` — typed resolver for the operational
    budget keys with system defaults `{modelCalls:12, retries:3, toolCalls:100}`; returns
    `values` + per-key `sources`.
- **`electron/commander/task-ledger.ts`** (adoption)
  - `TaskLedgerRecord` gains optional `limitsSource` (per-key `ConfigLayerName`), persisted in the
    checkpoint envelope (additive; old records load unchanged).
  - `create(taskId, objective, constraints, budget?)` resolves limits through
    `resolveOperationalLimits` instead of a hardcoded literal, and records provenance.
  - `TaskBudgetOptions` + `explainTaskBudget(record)` → `"modelCalls = 4 (source: task)"`.
- **`electron/commander/main-commander.ts`** — `CommanderTaskInput.budget?` is passed to
  `ledger.create`, so a caller/task can override limits from the task layer.
- **`tests/config-layering.test.ts`** (new, 5 tests) — precedence + source explanation,
  undefined-override protection, default system provenance, per-key task override, and
  persistence across ledger reload.

## Verification

- Targeted: `config-layering` (5) + `execution-supervisor` + `recovery-closure` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green (defaults unchanged, only provenance added).

## Boundary notes

- Only the **operational limits** were moved onto the layered resolver (first real adoption).
  Global/workspace layers are wired but currently empty by default; workspace config arrives
  with the Workspace object (AP01), and a global user-config file can plug into
  `resolveOperationalLimits` later without changing the ledger contract.
- Renderer/UI has no new config surface in this pack; explanations are available programmatically
  (`explainTaskBudget`) for a later settings panel.

## Checkpoint

Commit with: `src/shared/config-layering.ts`, `electron/commander/task-ledger.ts`,
`electron/commander/main-commander.ts`, `tests/config-layering.test.ts`.
