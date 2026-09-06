# AP01b — Workspace-Scoped Durable Roots (layout seam) + Multi-Repo

Compact handoff for the **AP01b seam** (plan AP01b; full re-homing of every durable family is the
remaining large half). Branch `9-4`.

## Why

AP01a delivered the Workspace object + registry + logical task binding. AP01b requires durable
state (ledger/memory/budget/recovery/evidence/sessions) to live *under* its workspace and one
Workspace to reference several repositories. Full re-homing across all existing `.boss` stores
at once is a high-risk migration; this pack lands the layout primitive + multi-repo schema with
a compatibility shim and adopts it on one real store, so the remaining re-homing is mechanical.

## What was added

- **`src/shared/workspace.ts`**
  - `Workspace.artifact_roots?: string[]` (reserved per-workspace durable roots) + validation.
- **`electron/workspace/durable-roots.ts`** (new)
  - `durableRootFor(dataRoot, workspaceId)` — Default/Scratch keep the **legacy app-global
    root** (single-repo shim: existing data stays readable); any named workspace gets
    `<dataRoot>/workspaces/<id>`.
  - `durableFileFor(dataRoot, workspaceId, relative)` — resolves inside that root with an
    escape guard.
- **`electron/workspace/workspace-registry.ts`**
  - `create()` accepts `artifact_roots`; validation covers them.
- **`electron/main.ts`** — the permission-manifest store now lives under the active workspace's
  durable root via `durableFileFor` (first real scoped adoption).
- **`tests/workspace.test.ts`** (+2 tests = 7) — multi-repo + artifact-root workspace and
  per-workspace durable-root layout with shim + escape guard.

## Verification

- Targeted: `workspace` (7) + `permission` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Only the permission-manifest store is re-homed so far; ledger/memory/budget/recovery/evidence
  remain app-global until the mechanical re-homing pack lands (each store gets a
  `durableFileFor`-derived path; the Default/Scratch shim keeps reading the legacy root, so
  nothing breaks).
- UI multi-repo picker is out of scope; resolver supports a workspace with several repositories
  today.

## Checkpoint

Commit with: `src/shared/workspace.ts`, `electron/workspace/durable-roots.ts`,
`electron/workspace/workspace-registry.ts`, `electron/main.ts`, `tests/workspace.test.ts`.
