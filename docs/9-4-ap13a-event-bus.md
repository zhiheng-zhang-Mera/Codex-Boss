# AP13a — Domain Event Bus (event-driven scheduler seed)

Compact handoff for Acceptance Pack **AP13a** (plan §13.1 Event-Driven; audit item 9: typed
AuditEvent log exists but scheduler is round/poll/timer-driven). Branch `9-4`.

## Why

The plan wants scheduler transitions driven by domain events (WORKER_COMPLETED, WORKER_FAILED,
DEPENDENCY_READY, PROVIDER_AVAILABLE, TOOL_RESULT_READY, HUMAN_APPROVED) rather than high-frequency
polling. The repo already had a capped typed audit log and timers, but no in-process bus whose
events reach the scheduler. This pack adds the typed bus and starts replacing timer waits with
event-driven wakeups at the recovery boundary.

## What was added

- **`electron/commander/event-bus.ts`** (new)
  - `DomainEventType` vocabulary from plan §13.1; `DomainEvent` with taskId/jobId/runtimeId/
    retryAt/message/result/at; `subscribe/on/publish`; handler isolation (a throwing/rejecting
    handler never blocks others or the publisher) and unsubscribe.
- **`electron/commander/recovery-scheduler.ts`**
  - Accepts an optional bus; subscribes `DEPENDENCY_READY` → `runDue()`. When a schedule() call
    is already due, it publishes `DEPENDENCY_READY` so the single-flight run happens immediately
    instead of waiting for the next timer tick. Future deadlines still wait.
- **`electron/commander/execution-supervisor.ts`**
  - Accepts an optional bus; publishes `WORKER_COMPLETED` on verified success and `WORKER_FAILED`
    on interruptions (with retryAt) so consumers can react without polling the ledger.
- **`electron/commander/main-commander.ts` / `electron/main.ts`**
  - Threads a shared `DomainEventBus` into the supervisor and the recovery scheduler.
- **`tests/event-bus.test.ts`** (new, 5 tests) — typed delivery + unsubscribe, handler
  isolation, supervisor WORKER_COMPLETED/WORKER_FAILED emission, and recovery wakeup now-vs-future.

## Verification

- Targeted: `event-bus` (5) + `recovery-closure` + `execution-supervisor` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the bus + first consumer (recovery wakeup). Round/council continuation is still
  explicit; converting the full commander to event-driven dispatch is the remaining AP13 work
  (event bus driving automation/council stages).
- Audit-log events (`AuditEvent`) remain the persisted record; the domain bus is in-process and
  ephemeral. Bridging bus → audit log for a subset of events is a follow-up.
- PROVIDER_AVAILABLE / TOOL_RESULT_READY / HUMAN_APPROVED vocabulary exists on the type and is
  ready for later adapters (vision results, human release).

## Checkpoint

Commit with: `electron/commander/event-bus.ts`, `electron/commander/recovery-scheduler.ts`,
`electron/commander/execution-supervisor.ts`, `electron/commander/main-commander.ts`,
`electron/main.ts`, `tests/event-bus.test.ts`.
