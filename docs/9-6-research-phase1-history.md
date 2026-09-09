# 9-6 Research Phase 1 — History Archive / Delete / Duplicate / Export

Compact handoff for the 9-6 research-plan Phase 1 (§1 History). Branch `9-6-research`.

## Why

Conversation history previously supported rename/move only. Phase 1 adds the remaining life
cycle so users can archive (not delete) old chats, cascade-delete with no orphan
state/history files, duplicate a conversation with fresh ids (never sharing run/checkpoint ids),
and export a conversation's `messages.md` plus its artifacts/evidence.

## What was added

- **State store / history (electron)**
  - `StateStore.setConversationArchived` (archive toggle — archive never equals delete);
    `deleteConversation` performs the full cascade including ledger purge +
    history-directory cleanup; `duplicateConversation` clones with fresh conversation/task/run
    ids.
  - `TaskLedger.purgeTask`; `HistoryRepository.exportConversation` (timestamped output dir with
    `messages.md` + artifacts/evidence).
  - Domain event vocabulary additions for the new operations.
- **IPC / preload / bridge**
  - `archive / delete / duplicate / export` conversation handlers typed through `BossBridge`
    (contracts.ts) and exposed on `window.boss`.
- **Renderer**
  - `ConversationContextMenu` (right-click and `···` share one menu: rename / move /
    duplicate / export / archive / delete, with a delete confirmation); archived toggle +
    styling; renderer handlers wired to the bridge.
- **Tests** — `tests/history.test.ts` (10 tests): folder/chat tree creation with physical
    files, rename moves, reserved/traversal path sanitization, download routing, restart
    restore without blank history, sent-task persistence, archive ≠ delete, delete full cascade
    (no orphans), duplicate with fresh ids, export with messages + artifacts.

## Verification

- Targeted: `history` (10) PASS; typecheck PASS; full suite run with the batch before landing.

## Boundary notes

- Renderer structural extraction (HistorySidebar, ConversationTurn, ProviderGrid/ProviderPane…)
  is deliberately folded into later phases as each new UI lands — no zero-test re-shuffle.

## Checkpoint

Phase 1 progress: committed on `9-6-research` (history ops + IPC + renderer menu + tests +
this handoff).
