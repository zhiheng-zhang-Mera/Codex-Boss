# 9-6 Research Round 32 — Run List Exposes Freeze/Pause State

Compact handoff for the round-32 deterministic slice: `ResearchLedger.list()` rows (shown by
the Research view's run list + `boss:research-list`) only carried id/goal/state/revision/time —
a GUI/live drive could not see whether a run was already frozen or parked at a reviewer gate
without loading the full record. Branch `9-6-research`.

## Why

The live Level-A/Level-B drive (Final Acceptance G/H) needs the run list to distinguish
"frozen, experiments may run" from "paused at a reviewer gate, resume to pendingStage".
Exposing `protocolHash` and `pendingStage` on each list row makes freeze/resume state visible
without a full `researchStatus` load — a deterministic, testable improvement that the GUI
session consumes.

## What was added

- **`electron/research/research-ledger.ts`**
  - `list()` rows now include `protocolHash?` and `pendingStage?` (undefined when absent);
    corrupt-file tolerance and newest-first ordering unchanged.
- **`src/shared/contracts.ts`**
  - `BossBridge.researchList` return type widened with the same optional fields.
- **`tests/research-ledger-list.test.ts`** (+1 test)
  - a run with a recorded protocol hash paused at a reviewer gate appears in the list with
    `protocolHash`, `pendingStage: LITERATURE_REVIEW`, and state `WAITING_FOR_PROVIDER`.

## Verification

- Targeted: `research-ledger-list` (2) + `research-supervisor` (8) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The GUI run rows may now render freeze/pause affordances from the list; the live drive still
  needs the GUI session. This slice is purely additive to the deterministic surface.

## Checkpoint

Commit with: `electron/research/research-ledger.ts`, `src/shared/contracts.ts`,
`tests/research-ledger-list.test.ts`, this handoff.
