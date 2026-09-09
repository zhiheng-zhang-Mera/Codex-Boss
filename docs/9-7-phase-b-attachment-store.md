# 9-7 Phase B — Attachment Store + 上传 UI

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase B. Branch `9-7`.

## Why

Users must be able to upload files exactly like GPT / Gemini web: press ＋, drop
files, or Ctrl+V a screenshot — then ask. Boss persists the bytes locally so a
restart never loses an attachment, and every upload is a typed `InputObject`
(Phase A registry) that later phases (Router, Web-AI upload, Context Package,
GitHub resolver, research literature) consume deterministically.

## What was added

- **Attachment Store (`electron/input/attachment-store.ts`)**
  - Layout per plan §5: `<dataRoot>/.boss/attachments/<conversation-id>/<attachment-id>/original.<ext>`
    + `metadata.json` (id / conversationId / originalName / mime / size / sha256 / uploadedAt).
  - `importAttachment({conversationId, originalName, mime?, sourcePath? | bytes?})` → computes
    sha256, stores bytes + metadata, returns a full `InputObject` (200 MB cap).
  - `localPathFor` / `metadataFor` / `listForConversation` (restart-safe listing),
    `removeAttachment`, `removeConversation` (cascade). No extraction/OCR/summary is created.
  - Path traversal guarded (conversation/attachment ids sanitized; root-escape rejected).
- **Contracts / preload / IPC (`contracts.ts`, `preload.ts`, `main.ts`)**
  - `BossBridge`: `pickAttachments(conversationId)` (native multi-file dialog, imports each
    picked file), `addAttachmentBytes({conversationId, originalName, mime, bytes})`
    (drag/drop + clipboard paste), `removeAttachment(conversationId, id)`,
    `attachmentPath(conversationId, id)`.
  - `boss:delete-conversation` now also removes the conversation's attachment directory.
- **Renderer (`src/renderer/main.tsx` + `components/AttachmentTray.tsx`)**
  - Attachment tray above the composer: ＋ button (native dialog), drag & drop zone,
    paste-image handler (Ctrl+V), attachment chips with name/size/kind + × removal,
    "N 个附件将随消息发送" hint.
  - Pending chips = conversation `inputObjects` not yet consumed by any task; submit binds
    them via `CreateTaskInput.inputObjectIds` so the message travels with its files.
  - CSS for tray/chips/kind dots.

## Acceptance (Phase B)

- Upload → restart Boss → conversation still restores the attachment (state registry refs +
  bytes on disk) — covered by `tests/attachment-store.test.ts` "persists refs … across a
  restart".
- Removing an attachment unbinds it from tasks and deletes its bytes.
- Verified by `tests/attachment-store.test.ts` (8 tests): import bytes/source, sha256 +
  metadata layout, size/missing-source/name validation, per-conversation list + restart,
  single + cascade removal, traversal sanitization, and the restart acceptance flow.

## Verification

- `pnpm run typecheck` — green (exit 0).
- Full `pnpm vitest run` — 111 files / 532 tests passed (includes Phase A+B).
- Renderer flow exercised by typecheck only (Electron UI smoke is manual); IPC handlers are
  thin main-process wrappers over the store+state methods covered by the tests.

## Next

Phase C — Provider capability registry + Attachment Router (deterministic MIME/kind map,
routing score over open providers, fallback chain), so Boss can decide who reads a file.
