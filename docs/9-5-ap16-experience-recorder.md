# AP16 — Contribution Metrics Wired into Experience Observe (seam)

Compact handoff closing the remaining AP16 seam (plan §14/§16; audit: experience hierarchy +
promotion existed, worker contribution metrics not fed into `observe`). Branch `9-5`.

## Why

AP16b shipped the four-level experience hierarchy + structural promotion rules, but nothing fed
real worker outcomes into `ExperienceStore.observe` — observations had no contribution metrics, so
plan §16's "worker contribution metrics" were absent from the Performance/Experience path.

## What was added

- **`src/shared/experience.ts`** (extended, pure)
  - `ExperienceContribution { outcome: "success"|"failure"; weight?: number }` on
    `ExperienceObservation` (default weight 1; cost/token normalization can scale later).
  - `contributionStats(entry)` → `{ success, failure, rate }` aggregate for routing/health claims.
- **`electron/experience/experience-store.ts`** (extended)
  - `observe()` accepts `contribution` and persists it with the observation (200/entry bound
    unchanged).
- **`electron/experience/experience-recorder.ts`** (new)
  - `attachExperienceRecorder(events, store, options)` — subscribes the domain bus
    (WORKER_COMPLETED / WORKER_FAILED) and records two claims per worker event:
    `runtime <id> serves its role` (worker-routing domain) and `runtime <id> outcome <x>`
    (runtime-health domain), each with the contribution metric. `sourceFor(taskId)` maps events to
    their workspace so two tasks in one workspace never fabricate cross-workspace evidence.
- **`electron/main.ts`** (wired) — recorder attached next to the telemetry recorder with
  `sourceFor` reading the task's bound `workspaceId` (falls back to taskId for legacy chat tasks).
- **`tests/experience.test.ts`** (extended, 5 tests) — success/failure contribution recorded,
  contribution stats computed, workspace-mapped sources, recorder attach/detach.

## Verification

- Targeted: `experience` (5) + `telemetry` (3) + `event-bus` (5) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Promotion rules remain structural (observation counts); contribution stats are recorded for
  later trust-weighted promotion, not yet gating promotion (documented extension).
- Recorder is deterministic and side-effect free beyond the durable store.

## Checkpoint

Commit with: `src/shared/experience.ts`, `electron/experience/experience-store.ts`,
`electron/experience/experience-recorder.ts`, `electron/main.ts`, `tests/experience.test.ts`,
this handoff.
