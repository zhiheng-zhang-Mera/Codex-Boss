# AP19a — Software Session Ownership + Lease Registry

Compact handoff for the **AP19a foundation slice** (plan §16 Software Session Ownership + AP19
Software Adapter SDK; audit item 6: no lease/ownership anywhere). Branch `9-4`.

## Why

`RuntimeAdapter` is an AI-provider runtime; nothing models *software* targets that tasks must
mutually exclude (e.g. one desktop app/window). The plan requires sessions with
exclusive/shared-read modes, ownership by workspace+task, bounded leases and a resource profile
per action. This pack delivers that registry and enforces it on the existing computer execution
path so two tasks can never mutate the same software target concurrently.

## What was added

- **`src/shared/software-session.ts`** (new, pure)
  - `SoftwareSession { session_id, owner_workspace?, owner_task, target, mode:
    "exclusive"|"shared-read", lease_until, state_hash? }`, `sessionAllows` (shared-read
    coexists; exclusive blocks everything; expired leases are free), `resourceProfile(action)`
    mapping semantic actions to read/mutate mode.
- **`electron/computer/software-lease.ts`** (new)
  - `SoftwareLeaseRegistry` — per-target leases: `canAccess`, `acquire` (throws with the
    conflicting holder when denied), `release` (owner-only), `held` (auto-expires).
- **`electron/commander/main-commander.ts` / `electron/main.ts`**
  - Desktop (`computer:`) actions now acquire a shared-read/exclusive lease keyed by realpath
    of the workspace and released in `finally` on every exit path; a single registry is shared
    process-wide. Deferred (UNCERTAIN) steps release so their replay re-acquires.
- **`tests/software-lease.test.ts`** (new, 6 tests) — resource profile mapping, session access
  rules incl. expiry, exclusive exclusion, shared-read concurrency vs mutation block, lease
  expiry, owner-only release.

## Verification

- Targeted: `software-lease` (6) + `plan-integration` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Scope is the ownership/lease layer for desktop actions. A full SoftwareAdapter SDK
  (Action/Observation/Verification/Health/permission/resource-profile objects over arbitrary
  software, plus software sessions bound to workspace durable roots) remains queued.
- The registry is in-memory (process lifetime); persisted software-session state is a later
  adapter pack.
- Workspaces/`owner_workspace` are plumbed optionally; desktop actions run under a single
  computer target today so workspace isolation of leases lands with real multi-workspace
  software targets.

## Checkpoint

Commit with: `src/shared/software-session.ts`, `electron/computer/software-lease.ts`,
`electron/commander/main-commander.ts`, `electron/main.ts`, `tests/software-lease.test.ts`.
