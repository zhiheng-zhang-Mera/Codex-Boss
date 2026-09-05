# AP01a — Workspace Model Core (object + registry + resolver + task binding)

Compact handoff for Acceptance Pack **AP01a** (plan §4.1 Workspace + §30 convergence; the plan's
central structural gap). Branch `9-4`.

## Why

Audit A: "workspace" was only a per-task filesystem path with git isolation — no Workspace
object, registry, resolver, active workspace, or task binding, and no scratch/default shim. The
plan requires a first-class logical Workspace that tasks belong to, converging without breaking
the current single-repo behavior.

## What was added

- **`src/shared/workspace.ts`** (new, pure)
  - `WORKSPACE_SCHEMA_VERSION = 1`; `Workspace { id, name, repositories[], schema_version,
    created_at, updated_at }`; `DEFAULT_WORKSPACE_ID` (single-repo shim) and
    `SCRATCH_WORKSPACE_ID`; `validWorkspaceId` + fail-closed `validateWorkspace`.
- **`electron/workspace/workspace-registry.ts`** (new)
  - `WorkspaceRegistry` — schemaVersion-1 durable registry (`list/get/create/setActive/
    resolveForPath`), path resolver picks the **most specific** repository workspace and falls
    back to the default shim; `ensureShims(repo?)` creates Default (bound to the current app
    root) and Scratch; corrupt registry fails closed.
- **`src/shared/contracts.ts` / `electron/store.ts`**
  - `BossTask.workspaceId?` (additive) + `bindTaskToWorkspace(taskId, workspaceId, path?)`.
- **`electron/commander/main-commander.ts` / `electron/main.ts`**
  - Optional registry wired through; `createTask` binds every task to a workspace (default shim
    when no path given) — with the registry configured, every task belongs to one workspace;
    without it, behavior is unchanged (compat shim).
- **`tests/workspace.test.ts`** (new, 5 tests) — multi-workspace creation + shims + persistence,
  most-specific path resolution vs default fallback, active workspace + unknown-id rejection +
  corrupt fail-closed, task binding with/without registry.

## Verification

- Targeted: `workspace` (5) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Task binding is **logical only** in this pack: durable roots (ledger/memory/budget/evidence/
  sessions) stay app-global, matching current single-repo behavior. Re-rooting under per-
  workspace roots is AP01b.
- No UI workspace switcher yet; registry/resolver APIs are the seam for it.
- `workspaceId` is additive/optional so old snapshots and tests without a registry behave
  exactly as before (the shim is Default).

## Checkpoint

Commit with: `src/shared/workspace.ts`, `electron/workspace/workspace-registry.ts`,
`src/shared/contracts.ts`, `electron/store.ts`, `electron/commander/main-commander.ts`,
`electron/main.ts`, `tests/workspace.test.ts`.
