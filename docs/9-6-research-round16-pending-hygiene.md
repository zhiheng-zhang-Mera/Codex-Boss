# 9-6 Research Round 16 — Pending-Stage Hygiene + GUI Freeze Consistency

Compact handoff for the round-16 deterministic slice: stale `pendingStage` could survive a
main-state transition, and the GUI freeze IPC did not mirror `ResearchService.freeze`.
Branch `9-6-research`.

## Why

Round 8 introduced `pendingStage` so a reviewer-gate pause resumes into the exact stage. But
`ResearchLedger.setState` never cleared it: if a paused run (WAITING_FOR_PROVIDER +
pendingStage) was moved to a main/terminal state — protocol freeze, fail, manual set — the stale
pending stage stayed on the IR, so a later control-state wait + resume could resurrect a stage
that had already been superseded. Separately, main.ts's `boss:research-protocol-freeze` only
froze in the ProtocolManager and never moved the run to `PROTOCOL_FROZEN` or recorded the
canonical hash on the run IR, unlike `ResearchService.freeze` — so GUI-frozen runs could not be
fed to experiment/analysis steps that require `ir.protocolHash` + `PROTOCOL_FROZEN`.

## What was added

- **`electron/research/research-ledger.ts`**
  - `setState` clears `pendingStage` when the target is a main/terminal state (freeze, fail,
    manual set) but **keeps** it across control-state transitions (a human-guidance wait layered
    on a gate pause must still resume to the gate).
- **`electron/main.ts`**
  - `boss:research-protocol-freeze` now mirrors `ResearchService.freeze`: when the ledger run
    exists it records `ir.protocolHash` and moves the run to `PROTOCOL_FROZEN` (clearing
    pendingStage via the ledger rule); freeze with no ledger record keeps its previous
    protocol-manager-only behavior.
- **`tests/research-supervisor.test.ts`** (+1 test)
  - paused at LITERATURE_REVIEW → setState(PROTOCOL_FROZEN) clears pendingStage; paused at
    MANUSCRIPT → setState(WAITING_FOR_USER) keeps pendingStage (resume can still return there).

## Verification

- Targeted: `research-supervisor` (8) + `research-service` (3) PASS; typecheck PASS.
- Full suite + electron build: run with the batch before landing.

## Boundary notes

- GUI freeze now matches service freeze semantics; experiment/analysis/manuscript still require
  a GUI/live session with logged-in providers and the real Level-B flow.

## Checkpoint

Commit with: `electron/research/research-ledger.ts`, `electron/main.ts`,
`tests/research-supervisor.test.ts`, this handoff.
