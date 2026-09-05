# 9-6 Research Phase 3 — Live Progress / Waiting Animation

Compact handoff for codex-boss-9-6-research-plan.md Phase 3 (§3). Branch `9-6-research`.

## Why

Web-provider answers arrive asynchronously; the controller previously showed raw state without an
operational "waiting on AI i/n → collecting → verifying" summary and no live progress line. This
phase adds the deterministic progress vocabulary + aggregator, an event-bus recorder that feeds it
from domain events, an IPC read surface, and a compact live-progress strip in the controller.

## What was added

- **`src/shared/progress.ts`** (new, pure)
  - `ProgressEvent { id, taskId, stage, status, label, detail?, source, createdAt }` with
    `ProgressStatus` (RUNNING/WAITING/SUCCESS/RECOVERING/ATTENTION/FAILED) and `ProgressSource`
    (COMMANDER/WEB/RESEARCH/EXPERIMENT/ANALYSIS/SYSTEM); fail-closed `validateProgressEvent`.
  - `ProgressAggregator` — one latest summary per task (latest event wins by createdAt), bounded
    detail timeline (default 200), per-task round counts (`observeCount`), and live summary list.
    Never exposes private reasoning: only operational labels/stages cross the boundary.
- **`electron/commander/progress-recorder.ts`** (new)
  - `attachProgressRecorder(events)` maps domain events (WORKER_COMPLETED/FAILED,
    HUMAN_APPROVED, TOOL_RESULT_READY, DEPENDENCY_READY) into ProgressEvents.
- **`electron/main.ts`** (wired) — recorder attached to the domain bus (module-level aggregator),
  IPC `boss:progress` returns live summaries + recent detail (≤100).
- **`electron/preload.ts` + `src/shared/contracts.ts`** — `window.boss.progress()`.
- **`src/renderer/main.tsx` + styles.css** — live-progress strip above the conversation turns for
  non-terminal tasks, polling every 1.5 s while open; CSS pulse animation for waiting dots.
- **`tests/progress.test.ts`** (new, 4 tests) — coalescing per task, bounded timeline + newest
  label, fail-closed validation, recorder attach/detach over the domain bus.

## Verification

- Targeted: `progress` (4) + `telemetry` (3) + `continuation-waker` (3) PASS.
- typecheck + renderer build PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Progress shows operational summaries only (no hidden chain-of-thought); the domain bus is the
  single source, so research/engineering stages can publish the same way later.
- The 1.5 s poll is a thin read surface for the renderer; a pushed `progress-updated` event
  channel can replace polling without changing the model.

## Checkpoint

Commit with: `src/shared/progress.ts`, `electron/commander/progress-recorder.ts`,
`electron/main.ts`, `electron/preload.ts`, `src/shared/contracts.ts`, `src/renderer/main.tsx`,
`src/renderer/styles.css`, `tests/progress.test.ts`, this handoff.
