# AP03a — Named Provider Lifecycle States (WAITING_PROVIDER / PAUSED_PROVIDER)

Compact handoff for Acceptance Pack **AP03a** (plan AP03 list + §1.3 GOOD example: enum →
serialization → scheduler transition → resume behavior → tests). Branch `9-4`.

## Why

The ledger had only free-form `nextAction` strings, `mode: "PAUSED"`, `run.phase waiting|blocked`
and `WorkerSession.health` interruption kinds. There was no first-class, serialized contract that
says *why* a task is held and whether it may auto-resume. This pack adds the named contract the
plan requires and makes the scheduler and the resume gate consume it, so AP03's provider-waiting
semantics are explicit instead of scattered strings.

## What was added

- **`src/shared/provider-state.ts`** (new)
  - `ProviderState = "ACTIVE" | "WAITING_PROVIDER" | "PAUSED_PROVIDER"` plus `PROVIDER_STATES`.
  - `ProviderStateRecord { state, reason, autoResume, retryAt?, updatedAt }` — serializable.
  - `stateForRecovery(action, reason, retryAt, now?)` deterministic mapping:
    `WAIT | RETRY | RECONSTRUCT | DEFER → WAITING_PROVIDER` (autoResume, keeps retryAt);
    `HUMAN_REQUIRED | VERIFY_SIDE_EFFECT → PAUSED_PROVIDER` (autoResume false).
  - `pausedForProvider(reason)` for explicit pauses (user cancel); `providerStateLabel`.
- **`electron/commander/task-ledger.ts`**
  - `TaskLedgerRecord.providerState?: ProviderStateRecord` — additive optional field inside the
    v1 record envelope; existing checkpoints load unchanged, new checkpoints serialize it.
- **`electron/commander/execution-supervisor.ts`** (scheduler transition)
  - On worker interruption: `value.providerState = stateForRecovery(recovery.action, ...)`.
  - On user cancel: `providerState = pausedForProvider("worker cancelled by user")`.
  - On step completed: `delete value.providerState` (hold cleared when work progresses).
- **`electron/commander/main-commander.ts`** (resume behavior)
  - `canResumeTask`: in addition to legacy held `nextAction` values, a task with
    `providerState.state === "PAUSED_PROVIDER"` never auto-resumes, and a
    `WAITING_PROVIDER` still inside its `retryAt` deadline waits.
- **`tests/provider-state.test.ts`** (new) — 6 tests covering classification, ledger
  serialization round-trip, supervisor writes for retryable (WAITING) vs user-action (PAUSED)
  interruptions, clearing on completion, and resume gating for both states.

## Verification

- Targeted: `tests/provider-state.test.ts` PASS (6 tests).
- Related regression: `execution-supervisor`, `cli-process-recovery`, `plan-integration`,
  `circuit-breaker` PASS.
- Electron + renderer `tsc --noEmit` PASS.

## Boundary notes

- DEFER keeps its historical auto-resume behavior and maps to WAITING_PROVIDER (deferral is
  retried when the backend/deadline recovers); only human/verify-side-effect holds pause.
- No UI label wiring yet (providerStateLabel is available for a later AP07 presentation pack).
- Provider health CLOSED/OPEN/HALF_OPEN remains the circuit breaker's domain (AP03b).

## Checkpoint

Commit with: `src/shared/provider-state.ts`, `electron/commander/task-ledger.ts`,
`electron/commander/execution-supervisor.ts`, `electron/commander/main-commander.ts`,
`tests/provider-state.test.ts`.
