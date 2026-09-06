# 9-7 Phase A — TaskInput / InputObject 统一输入模型

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase A. Branch `9-7`.

## Why

The task/input contract was `prompt: string` end-to-end, so every future extension
(attachment upload, GitHub URLs, web/PDF/CSV inputs, context packages) would have to
stuff everything into one string. Phase A introduces the typed input model first so
later phases (Upload UI, Attachment Router, escalation, GitHub resolver, research
literature input) can bind real input objects instead of re-parsing prose.

## What was added

- **Shared input model (`src/shared/input-object.ts`)**
  - `InputObjectSource` (UPLOAD / PASTE / LOCAL_PATH / GITHUB / URL) and `InputObjectKind`
    (TEXT / IMAGE / PDF / DOCUMENT / SPREADSHEET / ARCHIVE / CODE / REPOSITORY / WEB).
  - `InputObjectRef` (lightweight reference: id/source/kind/conversationId + optional
    name/mime/size/sha256/localPath/sourceUrl), `InputObject` (ref + `createdAt`),
    `WorkspaceRef`, and the unified `TaskInput { message, inputObjects, workspace? }`.
  - Deterministic extension→kind classification (`kindForFileName`) so file typing never
    needs a model call; fail-closed `validateInputObjectRef`; `uniqueInputObjectRefs`;
    `buildTaskInput` (message + refs, 1–100000 chars, empty message requires ≥1 object).
- **Contracts (`src/shared/contracts.ts`)**
  - `BossTask.inputObjectIds?` — which conversation-scoped inputs a task used
    (absent = legacy pure-text task, fully compatible).
  - `BossConversation.inputObjects?` — conversation-scoped input registry (Phase B will
    add real attachment files under it).
  - `CreateTaskInput.inputObjectIds?` — renderer→IPC pass-through.
  - Audit vocabulary `input.object.registered` / `input.object.removed`.
- **State store (`electron/store.ts`)**
  - `registerInputObjects(conversationId, refs)` — validates each ref, rejects
    conversation mismatch, dedupes by id, persists; restores after restart.
  - `removeInputObject(conversationId, id)` — removes ref and unbinds it from that
    conversation's tasks.
  - `inputObjectsFor(conversationId)` — read helper (empty for legacy conversations).
  - `createTask(..., inputObjectIds?)` — binds only ids that exist on the conversation
    (fail-closed); legacy calls without ids unchanged.
  - Read-time tolerance: snapshots without the new fields load unchanged (no version bump,
    optional additive fields only).
  - `duplicateConversation` mirrors the source conversation's input registry.
- **Commander / IPC**
  - `CommanderTaskInput.inputObjectIds?` and both `boss:create-task` /
    `boss:dispatch-task` forward `inputObjectIds` into `MainCommander.createTask`.

## Acceptance (Phase A)

- Legacy pure-text task: created exactly as before, `inputObjectIds` undefined, loads and
  runs — covered by `tests/input-object.test.ts` "keeps legacy pure-text tasks working".
- New task carries input refs: conversation registry persists refs across store restart;
  task binds requested ids and rejects unknown ids.
- Verified by `tests/input-object.test.ts` (12 tests):
  shared classification/validation/build/dedup + store register/restore/bind/remove/
  duplicate/legacy-restore.

## Verification

- `pnpm run typecheck` — green (exit 0).
- `pnpm vitest run tests/input-object.test.ts` — 12 passed.

## Next

Phase B — Upload UI + Attachment Store (real files under
`.boss/attachments/<conversation>/<attachment>/`, sha256 + metadata.json, chips,
drag/drop/paste), building on this registry.
