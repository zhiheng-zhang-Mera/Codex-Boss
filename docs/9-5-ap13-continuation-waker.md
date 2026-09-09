# AP13 — Event-Driven Automation/Council Continuation (seam)

Compact handoff closing the remaining AP13 seam (plan §13.1; audit: typed bus + recovery wakeup +
supervisor worker events existed, council/automation continuation still explicit). Branch `9-5`.

## Why

The plan's event vocabulary (WORKER_COMPLETED / DEPENDENCY_READY / HUMAN_APPROVED /
TOOL_RESULT_READY / …) was published by the recovery scheduler and execution supervisor, but
council and automation rounds still advanced only through explicit `continueIfReady` calls at
dispatch/capture/human-release sites. This pack lets the domain bus wake automation
continuation, so a round that becomes ready can advance without an explicit call site.

## What was added

- **`electron/commander/continuation-waker.ts`** (new)
  - `CONTINUATION_EVENT_TYPES` (WORKER_COMPLETED, TOOL_RESULT_READY, HUMAN_APPROVED);
    `taskIdForEvent(event, types?)` — maps an event to a task id to wake, ignoring failed worker
    results and events without a taskId.
  - `attachContinuationWaker(events, waker, {cooldownMs, extraTypes, now})` — subscribes the
    waker to continuation-relevant events with a per-task cooldown (burst coalescing) and full
    handler isolation; returns a detach function.
- **`electron/provider-automation.ts`** (wired)
  - Constructor accepts an optional `DomainEventBus`; after API answers for a round are captured
    and the dispatch round committed, it publishes `TOOL_RESULT_READY` (per answer run id).
- **`electron/main.ts`** (wired)
  - Module-level `domainEventBus` + `detachContinuationWaker`; the automation instance receives
    the bus; a continuation waker routes bus events to `automation.continueIfReady(taskId)`
    (re-attached on window re-create, old waker detached).
  - `boss:release-review` publishes `HUMAN_APPROVED` before the existing continuation call so
    subscribers observe the approval event (the existing awaited call remains authoritative).
- **`tests/continuation-waker.test.ts`** (new, 3 tests) — task-id mapping incl. failed-result
  exclusion; cooldown coalescing + detach; extra event types + waker failure isolation.

## Verification

- Targeted: `continuation-waker` (3) + `event-bus` (5) + `telemetry` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The explicit `continueIfReady` calls remain as the deterministic path (continuation is
  idempotent via `continuedRounds`); the waker adds event-driven wakeups for the same entry
  point. Migration of every call site to events is deliberately conservative.
- `HUMAN_APPROVED` publishing from the IPC release path is additive; recovery and supervisor
  consumers already subscribe to their own event kinds.

## Checkpoint

Commit with: `electron/commander/continuation-waker.ts`, `electron/provider-automation.ts`,
`electron/main.ts`, `tests/continuation-waker.test.ts`, this handoff.
