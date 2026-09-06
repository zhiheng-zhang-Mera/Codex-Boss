# S4 semantic execution and recovery audit

Status: S4 implementation and local stage acceptance passed. Remote publication and CI are tracked by the stage commit. This is not a stable V1.0 declaration. S5 hardening and its acceptance matrix are still required.

## Plan requirements

| Requirement | Main-flow implementation | Verified evidence |
| --- | --- | --- |
| 7.1 UIA actions | Exact process/window/control selectors; configured launch; focus, find, ValuePattern entry, InvokePattern click, bounded wait and verification | Real WPF fixture: eight actions passed, including a control created after a 2.5-second delay. artifacts/uia-e8378d7e-4173-4310-bef8-171a43c87016/result.json |
| 7.2 Structured applications | Commander routes directory, terminal log, Git, VS Code and browser reads without a model | Four real local interfaces: artifacts/structured-0caf00de-8414-4c5e-9858-168350ca648e/result.json. Real browser DOM: artifacts/vision-6f17316e-b650-4036-9f54-f5bfc73b8d8b/result.json |
| 7.3 Vision fallback | Local screenshot OCR, unique target, action proposal, explicit task-bound authorization, frame revalidation and post-action verification; structured browser failures fall back to OCR | Real canvas button through Commander: one click, no model call, verified changed text; normal DOM uses structured backend, injected DOM failure uses vision. artifacts/vision-6f17316e-b650-4036-9f54-f5bfc73b8d8b/result.json |
| Uncertain mutations | Intent journal written before effects; uncertainty survives reconstruction; original expected state required before another mutation; selector ordering canonicalized | semantic-runtime.test.ts and vision-backend.test.ts verify no repeated click after uncertain results, authorization refusal, changed-frame refusal and persistence |
| 7.4 Memory wiring | Separate user/project guidance, task summaries and runtime observations; ledger and context remain authoritative | plan-integration.test.ts checks actual Commander context, matching project scope and exclusion of other-task data |
| 7.5 Degradation | Persisted FULL, REDUCED, LIGHTWEIGHT, DETERMINISTIC, PAUSED; compatible runtime health/quota/task budget drive context and concurrency limits | degraded-controller.test.ts covers all modes and recovery; Commander invokes the controller before role dispatch and native work |

## Interruption matrix

| Interruption | Evidence and scope |
| --- | --- |
| Boss restart | Two real Electron processes. Immediate exit before artifact delivery; restoration delivers one artifact and rendered final response, graph attempts remains one. artifacts/restart-302b82e9-d10f-4fd2-8640-26ad85027c72/restart-result.json |
| Browser crash | Real renderer terminated; render-process-gone reports crashed/exitCode 2. Original loopback conversation restored, final response captured, server POST count remains one. artifacts/browser-crash-96198a13-64de-4924-ad05-2097486e2782/result.json |
| Session expiry | Real Electron with a controlled login page. Recovery pauses, explicit user resume re-arms it after session restoration; one POST. artifacts/browser-crash-6f74debd-15ab-464f-a677-013365ce1848/result.json |
| Quota wait | recovery-closure.test.ts verifies durable observed reset deadlines, scheduled recovery, session continuity and no duplicate completed call; existing S1 API acceptance exercises HTTP 429/Retry-After |
| Network outage | Actual loopback TCP disconnection produces ERR_EMPTY_RESPONSE; the persisted deadline is awaited and original-page reload completes with one POST. artifacts/browser-crash-0237bf18-32eb-4074-9a81-456f7c6dddb9/result.json |
| Worker death | cli-process-recovery.test.ts kills a real controlled child, observes PROCESS_CRASH and resumes the same job; completed checkpoints are reused. Cancellation remains paused, and every attempt has its own output path |

Startup and executor entry points respect user pauses, cancellations, reconciliation markers and future deadlines. User continuation explicitly wakes paused recovery records. Restoration reloads the recorded page even when Chromium retains its URL on an error page; post-load identity must match. New recovery views do not start a competing homepage navigation.

## Validation and boundaries

The full regression passed 130 tests across 38 files; the build passed. artifacts/s4-unit-results.json records the run. The final automatic browser-to-OCR fallback change is included in this regression and build.

Packaging audit found and fixed a missing windows-ocr.ps1 dependency. The final package Codex-Boss-1.0.0-preview.1-1788537829103 passed package-local OCR (artifacts/s4-packaged-ocr.json) and renderer/native IPC smoke (artifacts/smoke-1c815c4da65747fda58b7a6358c40144/smoke-result.json).

Evidence does not establish universal Windows application or external-provider outage coverage. UIA requires usable accessibility patterns. Vision currently recognizes text inside provider views; image-only icons and arbitrary desktop-window vision are outside this verified surface. Terminal integration reads persisted process output, and VS Code integration reads its real CLI process/workspace state; neither implies unsaved-buffer access or general terminal control. The VS Code fixture used an isolated D-drive profile and was confirmed exited afterward.

Failures are retained locally: initial network restoration exposed error-page handling; initial restart injection correctly triggered a human hold; full-suite process testing exposed the default five-second test timeout and cleanup race. Fixes were revalidated. Artifact directories and private runtime data remain excluded from Git; source, tests and this bounded evidence record form the stage release.
