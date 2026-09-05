# AP05b — Reproducibility Snapshot Writer

Compact handoff for Acceptance Pack **AP05b** (plan §11 Reproducibility Snapshot). Branch `9-4`.

## Why

The plan requires that key task failures keep a minimal reproduction record — workspace
version, git commit, config hash, dependency lock, provider/harness/model, context fingerprint
and input artifact hashes — rather than a full machine image ("能复现重要失败，而不是无限归档").
Nothing like this existed before; evidence only had artifact hashes, and no git/config/environment
context was captured at failure time.

## What was added

- **`electron/repro-snapshot.ts`** (new)
  - `ReproductionSnapshot` (`schemaVersion: 1`, `capturedAt`, optional
    `workspace { path, gitCommit, gitBranch, dirty }`, `configHash`, `dependencyLock { present,
    hash }`, `provider`, `model`, `harness`, `contextFingerprint`, `inputArtifactHashes[]`).
  - `collectGitState` (commit/branch/dirty via real git), `configHash` (shipped runtime-policy
    config + schema), `dependencyLock` (pnpm/package/yarn lock), `sha256Hex`, `fileSha256`.
  - `buildReproductionSnapshot(input)` async builder; `validateReproductionSnapshot` fail-closed.
- **`electron/commander/task-ledger.ts`**
  - `saveReproduction(taskId, snapshot)` writes `<task>/repro.json` beside checkpoints;
    `loadReproduction(taskId)` reads + validates fail-closed.
- **`electron/commander/main-commander.ts`**
  - `captureReproduction(taskId, workspace, label)` — builds the snapshot (git state of the
    workspace, provider label, harness `codex-boss`, context fingerprint of the ledger record,
    current task artifact content hashes) and stores it.
  - Wired at failure points: plan compile failure (`plan-compile-failed`), plan graph failure
    (`plan-failed`), plan waiting (`plan-waiting`), native verification failure
    (`native-failed`).
- **`tests/repro-snapshot.test.ts`** (new, 4 tests) — git state in a real repo, config/lock
  hashes, fail-closed validate + ledger round-trip, and a commander integration test that a
  planner outage leaves a `plan-compile-failed` snapshot.

## Verification

- Targeted: `repro-snapshot` (4) + `plan-integration` (14) + `execution-supervisor` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Model/harness fields exist on the snapshot contract but production adapters do not yet report a
  stable model id into supervisor failures; provider + context fingerprint + git/config/lock are
  captured today. API-runtime model ids can be threaded through later without schema change.
- Snapshots are written on plan/native failure paths (workspace-known). Runtime role failures
  without a workspace intentionally do not spam a snapshot.
- No UI or evaluation consumption yet; the writer is the seed AP16 telemetry/eval replay will
  read.

## Checkpoint

Commit with: `electron/repro-snapshot.ts`, `electron/commander/task-ledger.ts`,
`electron/commander/main-commander.ts`, `tests/repro-snapshot.test.ts`.
