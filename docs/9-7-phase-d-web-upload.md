# 9-7 Phase D — Web AI 文件上传（DOM 确认，Fail-Closed）

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase D. Branch `9-7`.

## Why

Acceptance 1/2 (PDF / multi-attachment) need the visible web page to actually
receive files — not "dialog opened ≈ uploaded". The upload must happen in a
fixed order and refuse to send unless the page's own DOM confirms an attachment
chip carrying the file name (plan §9/§9.1 `UPLOAD_NOT_CONFIRMED`).

## What was added

- **Adapter metadata (`electron/adapters/registry.ts`)**
  - `AdapterDefinition` gains `fileInputSelectors`, `attachmentSelectors`
    (chip surfaces) and `uploadKinds` per provider. chatgpt/gemini/claude/
    deepseek/grok are versioned for at least IMAGE/PDF; qwen/kimi keep text-only
    (no upload surface until verified — fail closed by design).
- **Page scripts (`electron/adapters/page-scripts.ts`)**
  - `uploadFilesScript(definition, files)` — builds `File`s from base64 payloads,
    injects them into the adapter's file input via `DataTransfer`, fires `change`,
    waits for the UI. Never sends a prompt.
  - `verifyUploadScript(definition, names)` — confirms each expected file name is
    visible in a rendered chip (fallback: exact name present in page text only when
    the adapter has no versioned chip surface). Returns found/missing.
- **Upload planner (`electron/input/attachment-upload.ts`)**
  - `resolveUploadsForTask(store, attachmentStore, taskId)` — the task's bound
    input objects that still exist on disk.
  - `planAdapterUploads(definition, files)` — payloads the adapter is versioned to
    accept; **unsupported** kinds and **oversized** files (25 MB page-injection
    budget) never travel as if uploaded. `planIsRoutable` gates the whole send.
- **Automation seam (`electron/provider-automation.ts` → `prepareUploads`)**
  - After the page probe and before any prompt text is inserted, attachments are
    uploaded and DOM-verified (30 s deadline, re-poll every 1.5 s). Any failure
    marks the run blocked `UNSUPPORTED`/`PAGE_CHANGED` ("UPLOAD_NOT_CONFIRMED；
    未填写提示词，不会发送") so the existing send-failures rollback never fires
    a prompt for an unconfirmed file.
  - `ProviderAutomation` receives the `AttachmentStore` from main.ts.

## Acceptance (Phase D, deterministic core)

- `uploadFilesScript` only touches `input[type=file]`; returns `file-input-not-found`
  when missing; fires `change` with exactly the files requested.
- `verifyUploadScript` is true only when the expected file name is visible;
  missing names are returned, never assumed.
- Planner: adapter-accepted kind → routable; unversioned kind (qwen PDF) →
  `unsupported`, never uploaded; >budget → `oversized`.
- Verified by `tests/web-upload.test.ts` (8 tests, node:vm DOM style like the
  existing adapter suite).

## Verification

- `pnpm run typecheck` — green.
- `pnpm vitest run tests/web-upload.test.ts` — 8 passed.
- Live-DOM confirmation against real pages is manual (same policy as the existing
  web adapters; no browser is available in the CI-style suite).

## Next

Phase E — Chat→Work CapabilityNeedDetector + ModeEscalationGate: decide from
message + inputs whether Work is needed, ask the user exactly once, then inherit
message/attachments/context into Work automatically.
