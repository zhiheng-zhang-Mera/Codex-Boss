# 9-6 Research Round 34 — Protocol Freeze Control in the Research View

Compact handoff for the round-34 renderer slice: the Research view exposed Start/Step/Resume but
had **no way to freeze a protocol** from the UI — the live Level-B/Level-A drive (Final
Acceptance G/H) requires freeze before experiments, and the round-16 freeze IPC was unreachable
from the app. Branch `9-6-research`.

## Why

Round 16 aligned `boss:research-protocol-freeze` with `ResearchService.freeze` (records
`ir.protocolHash`, moves the run to PROTOCOL_FROZEN), but no renderer code ever called it. An
operator could not freeze a protocol in the GUI; the runbook had to instruct bridge calls by
hand. Also, run rows now expose `protocolHash`/`pendingStage` (round 32) but the UI didn't show
them.

## What was added

- **`src/renderer/main.tsx`**
  - `researchStatus` tracks `protocolHash`; when the open run is not yet frozen, the status area
    renders a **freeze-protocol form** (hypothesis / primary metric / baseline / sample
    definition / evaluation criterion) whose submit calls `researchProtocolFreeze` and then
    refreshes status (frozen hash + `PROTOCOL_FROZEN` shown).
  - Once frozen, the status row shows `协议已冻结 <hash8>` and keeps Step/Resume controls.
  - The runs list rows show `已冻结` and `待办 <pendingStage>` from the round-32 list fields.

## Verification

- typecheck (renderer + electron) PASS; `build:renderer` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- UI behavior is exercised in the GUI/live session (no renderer unit-test harness exists — the
  repo convention); this slice makes the freeze step reachable from the app the runbook drives.

## Checkpoint

Commit with: `src/renderer/main.tsx`, this handoff.
