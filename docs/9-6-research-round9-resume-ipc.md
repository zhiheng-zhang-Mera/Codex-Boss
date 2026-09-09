# 9-6 Research Round 9 — Resume Control for Paused Research Runs

Compact handoff for the round-9 slice: after round 8 made reviewer-gated stages pause honestly
(run parks at `WAITING_FOR_PROVIDER` with `pendingStage`), the GUI/IPC surface still only had
"推进下一阶段" (step) — which now correctly no-ops on a paused run — and resumption was only
reachable through the Phase-4 intervention card (`resolve-intervention`). A run parked at a
reviewer gate had no direct resume control. This round closes that loop. Branch `9-6-research`.

## Why

Round 8's rule: a reviewer-gated run must never advance past a gate no executor actually passed;
it parks at a control state and resumes to its *pending stage*. For that contract to be usable,
the GUI must offer an explicit resume action that returns the run to the exact stage it paused
at (never a restart from SCOPING).

## What was added

- **`src/shared/contracts.ts`**
  - `BossBridge.researchResume(id): Promise<boolean>` — true only when the run actually
    resumed from a control state.
- **`electron/main.ts`**
  - IPC `boss:research-resume` — calls `researchSupervisor.resume(id)`; on a real resume it
    publishes `HUMAN_APPROVED` (the standard continuation event) so automation/progress stay
    live, and returns the boolean.
- **`electron/preload.ts`**
  - Bridge `researchResume` → `ipcRenderer.invoke("boss:research-resume", id)`.
- **`src/renderer/main.tsx`**
  - `resumeResearch()` handler + status-row branching: when the open research run is in
    `WAITING_FOR_PROVIDER` / `WAITING_FOR_USER` / `RECOVERING`, the control becomes
    "恢复研究（回到待办阶段）" instead of "推进下一阶段"; the runs list refreshes afterwards.
    Stepping a paused run is no longer offered (round 8: step is a no-op on control states).

## Verification

- typecheck (renderer + electron) PASS; `build:renderer` PASS; `build:electron` PASS.
- Full suite: run with the batch before landing.
- Supervisor resume semantics themselves (pending-stage return, non-resumable states) remain
  covered by `tests/research-supervisor.test.ts` (round 8 additions).

## Boundary notes

- No renderer unit-test harness exists (documented repo constraint); IPC + bridge are typed via
  `BossBridge` and the electron build, matching how prior research IPC slices were verified.
- Live web-AI Level-B still requires a GUI session with logged-in providers; this slice only
  makes the honest pause/resume state machine operable from the Research view.

## Checkpoint

Commit with: `src/shared/contracts.ts`, `electron/main.ts`, `electron/preload.ts`,
`src/renderer/main.tsx`, this handoff.
