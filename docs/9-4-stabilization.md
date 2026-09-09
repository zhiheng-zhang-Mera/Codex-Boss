# S0 stabilization acceptance

The original 941d4c9 preview did not consume direct COMPLETE. This stage repairs the normal user path before v0.6+ work.

Implemented: React History name dialogs with Enter/Escape, focus, validation and visible IPC errors; readable independent bounded sidebar; COMPLETE continuation; idempotent persisted FinalResponse; deterministic accepted-answer fallback; explicit required-synthesis deferral with persisted policy; answer-first Controller presentation; final answers in local history; active conversation restoration. Task state now defaults to project runtime-data, with legacy state copied without deleting the original. Isolated test instances use isolated history.

## Evidence

- UNIT / CONTROLLED_INTEGRATION: 87 tests passed (26 files), including actual automation → review → checkpoint → finalizer → restart, optional Codex failure, required Codex deferral and human release. These do not assert provider truthfulness.
- LIVE_PROVIDER: ChatGPT, 2026-09-04. From the visible Boss composer, sent a harmless exact-response request. Received BOSS_S0_LIVE_OK 2+2=4 automatically in the primary FinalResponse. Checkpoint COMMITTED; no Capture, Evidence or Codex button used. Task 8586d868-3b64-48bb-b017-70a41430f0f1. Local evidence: artifacts/s0/live-result.json and live-uia.txt.
- DESKTOP: real New conversation and Rename controls accepted Enter and preserved selection. After process restart the saved answer was visible from History (artifacts/s0/restart-uia.txt). This exposed the old new-chat-on-start behavior, now corrected and covered by regression tests.
- PACKAGED_E2E: PASS. Production portable package launched, real IPC native task completed and FinalResponse rendered. Evidence: artifacts/smoke-36d7890e12924304a9e1786f876292fd/smoke-result.json.
- CLOUD: stage commit will trigger Desktop CI; terminal status is checked separately before S1.

Remaining v1.0 gates: recovery closure, automatic plan/runtime integration, autonomous engineering, semantic/long-horizon support and hardening. This report does not declare stable v1.0 or a multi-provider success rate.
