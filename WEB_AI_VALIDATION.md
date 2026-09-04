# Web AI and cache acceptance — 2026-09-04

## Observed live result

One Controller submission of `仅回复：连接测试成功` automatically sent to ChatGPT, Qwen and Grok. Each provider returned exactly `连接测试成功`. All three stored response artifacts contain that exact answer, all runs have `completed / SUCCESS`, and the group checkpoint is `COMMITTED` with no failed providers or reconciliation requirement.

- Task: `a83f86dd-5ca9-49a4-8c6a-9fe770a735bd`
- Checkpoint: `e439181e-5754-43e9-a3ad-221e70f86188`
- Completed: `2026-09-04T02:08:52.048Z`
- Transport: visible web pages, not API fallback.

Root cause: Grok exposes a visible auxiliary textarea in addition to its real ProseMirror editor. The adapter now prioritizes the real editor. Short nonempty replies are no longer discarded by an arbitrary 20-character threshold. Window shutdown no longer publishes to a destroyed host.

## Cache migration

Project-local cache root: `.cache/` (Git-ignored, contains private browser session data).

- Browser profile/cache: `.cache/browser-profile/`
- Temporary files: `.cache/tmp/`
- Crash dumps: `.cache/crash-dumps/`
- Launcher package caches: `.cache/npm/`, `.cache/electron/`

Migrated and SHA-256 verified 2,104 non-excluded source files. Windows encrypted cross-volume copy requires a verified byte-copy fallback. The readiness marker prevents overwriting an existing migrated profile. The old C-drive login/storage data remains as a recovery copy; task state is not cache and remains in LocalAppData.

Cleared rebuildable caches under the project-specific LocalAppData/CodexBoss and Roaming/codex-boss directories. Initial cache inventory was 639,539,542 bytes (about 610 MiB). A second pass removed remnants, with immediate and independent checks confirming zero remaining cache bytes. After restarting, the C-drive cache inventory remained zero while new Grok cache files were observed under the D-drive profile. Shared Codex/Node caches were not touched.

Restart acceptance: all three sessions remain READY; a new Controller conversation has zero tasks; the completed test task remains saved; the provider pages reload to their home/new-chat screens.

## Checks and limits

- 56 unit/regression tests passed across 19 files.
- Full TypeScript and production build passed.
- Generated adapter JavaScript syntax, real-editor selection, short replies, shutdown safety, and profile migration/fallback have regression coverage.
- This is a real three-provider connection smoke test, not proof of every long-running or multi-round workflow. Site DOM changes, rate limits, expired logins and challenges can still require further adaptation or user action.
