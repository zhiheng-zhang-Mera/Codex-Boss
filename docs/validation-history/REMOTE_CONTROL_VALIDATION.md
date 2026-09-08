# PC Remote Control Validation

Updated: 2026-09-03

## Implemented contract

- WeChat process allowlist: `WeChat`, `Weixin`, `WXWork`.
- QQ process allowlist: `QQ`, `QQNT`, `TIM`.
- The listener is disabled by default and starts only after an explicit setting change.
- Only visible UI Automation text beginning with the configured prefix (default `/boss`) is emitted.
- Electron accepts only validated `status` or `command` NDJSON records from its own child process.
- Received commands remain `pending`; loading fills the current composer but never submits a task.
- A non-empty composer prevents a remote command from replacing the current draft.
- Channel settings and command audit state persist locally; credentials and client tokens are never requested or stored.
- Disabling a channel or closing the app terminates its child listener. Changing a live prefix replaces the old listener without letting an old exit event delete the new process handle.

## Evidence

| Check | Result | Evidence |
|---|---|---|
| TypeScript contracts and IPC | PASS | `pnpm run typecheck` |
| Store, parser, prefix and pending-approval tests | PASS | `tests/remote-control.test.ts` |
| Windows UI Automation script startup | PASS | Live bounded run returned structured `waiting` records with no QQ client present |
| Production Electron launcher and cleanup | PASS | Smoke completed at 2026-09-03T13:12:56+10:00; exact process query found zero relay children afterward |
| Settings UI accessibility inspection | PASS | Live Electron tree exposed PC remote control, WeChat/QQ status, prefix, opt-in checkbox and save controls |
| Pending-inbox live rendering | NOT_RUN | No real prefixed WeChat/QQ message was received; conditional UI and state transitions are covered by code/tests only |
| Real QQ logged-in command receipt | NOT_RUN | No logged-in QQ client and authorized test message were available |
| Real WeChat logged-in command receipt | NOT_RUN | No logged-in WeChat client and authorized test message were available |
| Automatic execution or reply | NOT_SUPPORTED | Deliberately excluded; every command requires local load and submit actions |

## Platform boundary

This feature is a local accessibility companion for an already logged-in Windows client. It is not a Tencent bot identity, does not use an unofficial wire protocol, and does not claim headless or service-grade delivery. QQ's official bot platform uses authenticated webhook or WebSocket event subscriptions; personal WeChat desktop login does not expose an equivalent supported bot API. A production unattended deployment should use an authorized official platform integration rather than desktop accessibility polling.
