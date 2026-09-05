# 9-6 Research Progress

Tracks execution of `Update-Plan/codex-boss-9-6-research-plan.md` on branch `9-6-research`
(created from `9-5`, which carries the committed AP01–AP30 v1–v3 pack work).

## Phase 0 — Baseline Freeze (done)

Recorded on 9-5 before branching:

- unit tests: **86 files / 407 tests PASS**
- typecheck (renderer + electron): PASS
- production build: renderer + electron steps PASS individually (`pnpm run build` aggregate
  fails only because the nested `pnpm` invocation cannot resolve through `corepack` here; each
  underlying step is green)
- Direct / Council / Engineering / Recovery acceptance = the vitest suites that cover them
  (delivery-integration, council, engineering-runtime, recovery-closure, launcher) PASS;
  live acceptance scripts (`scripts/acceptance-*.cjs`) require an installed Codex CLI / desktop
  GUI and are exercised in release validation (CI + packaged smoke), as documented in the repo.

Branch `9-6-research` created from `9-5` after the AP pack commits.

## Phase 1 — Renderer history management (in progress)

Done this round:

- Durable conversation operations in `electron/store.ts`:
  - `setConversationArchived` (archived flag; restore removes the flag),
  - `deleteConversation` — full cascade (tasks/runs/councils/artifacts/evidenceBundles/
    finalResponses/dispatchCheckpoints) plus `TaskLedger.purgeTask` and history-directory cleanup
    through the existing `HistoryRepository.sync`;
  - `duplicateConversation` — fresh ids for conversation/tasks/runs/artifacts, never reusing old
    run/checkpoint ids.
  - Event vocabulary extended (conversation.archived/deleted/duplicated/exported).
- `electron/commander/task-ledger.ts`: `purgeTask`.
- `electron/history-repository.ts`: `exportConversation` (messages.md + artifacts/ + evidence/
  into `<userData>/exports/<folder>/<conversation>-<timestamp>`).
- IPC + preload + bridge: `boss:archive-conversation`, `boss:delete-conversation`,
  `boss:duplicate-conversation`, `boss:export-conversation`.
- Renderer: `ConversationContextMenu` component (right-click and `···` share the same menu:
  rename / move / duplicate / export / archive / delete), archived-conversation toggle (🗄),
  archived rows shown struck-through; delete asks for confirmation.
- Tests: `tests/history.test.ts` 10 tests (archive/restore, cascade delete with no orphan
  history dirs, duplicate with fresh ids, export into timestamped dir).

Still open (next slice): extract the remaining renderer components (HistorySidebar,
ConversationTurn, ProviderGrid/ProviderPane, LiveTaskProgress, HumanInterventionCard,
Composer, SettingsPanel…) per Phase 1 layout; add `···`-equivalent validation in live Electron
smoke; then Phases 2–12 of the research plan.

## Up next

Phase 2 (3-AI 1×3 layout + auto zoom + provider order persistence) → Phase 3 (live progress) →
… → Phase 12 / Final Acceptance (see the research plan file for acceptance criteria).
