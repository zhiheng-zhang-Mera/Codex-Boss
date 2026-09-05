# AP16a — Telemetry Aggregation + Event-Driven Recorder (Performance DB)

Compact handoff for Acceptance Pack **AP16a** (plan §12 metrics + §16 telemetry / async
writer; audit item 7 "Performance DB … decision → reason → outcome"). Branch `9-4`.

## Why

Per-worker results were observed (ledger `usage`, `RuntimeMetrics`, budgets) but not aggregated
into a durable Performance DB, and nothing consumed the new domain bus as a telemetry source.
This pack turns worker outcome events into records with decision → reason → outcome semantics
and per-runtime aggregates.

## What was added

- **`electron/telemetry/telemetry-store.ts`** (new)
  - `TelemetryRecord { taskId, jobId, runtimeId, role, outcome: SUCCESS|FAILED|CANCELLED|
    DEFERRED, reason?, modelCalls, estimatedTokens, latencyMs, retries, at }`.
  - `TelemetryStore` — schemaVersion-1 JSON store (`record/list/byTask/byRuntime`), bounded
    history (last 2000), fail-closed on corrupt files; `RuntimeAggregate` per runtime
    (runs/success/failures/modelCalls/estimatedTokens/totalLatencyMs).
- **`electron/telemetry/telemetry-recorder.ts`** (new)
  - `attachTelemetryRecorder(events, store, estimateTokens?)` subscribes `WORKER_COMPLETED` →
    SUCCESS and `WORKER_FAILED` → FAILED(reason) records from the domain bus (AP13a); returns a
    detach function.
- **`electron/main.ts`** — recorder attached to the shared `DomainEventBus` writing
  `.boss/telemetry.json`.
- **`tests/telemetry.test.ts`** (new, 3 tests) — store aggregation + persistence, corrupt
  fail-closed, event-driven recorder outcome mapping and clean detach.

## Verification

- Targeted: `telemetry` (3) + `event-bus` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Recorder currently attaches per-process; the file lives under the same `.boss` state family as
  budgets/recovery/breaker. The `changed()`/flush integration is deferred to the async
  telemetry writer pack; writes are synchronous today like the rest of the state stores.
- Experience hierarchy (Workspace/Domain/Global) and promotion rules are the remaining AP16
  half, intentionally not part of this bounded pack.

## Checkpoint

Commit with: `electron/telemetry/telemetry-store.ts`,
`electron/telemetry/telemetry-recorder.ts`, `electron/main.ts`, `tests/telemetry.test.ts`.
