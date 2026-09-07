# Codex-Boss 统一收口 — Plan execution close-out (branch 9-7)

Status of the U1→U11 unification plan on top of the U0 audit baseline (`da5a20d`).
Full evidence: `Update-Plan/audit/U0/completion-report.md` (close-out section).

## Final verification

- Full test suite: **147 files / 735 tests green** — both in the normal developer
  environment and in the autonomous-loop audit environment (`ELECTRON_RUN_AS_NODE=1`).
- Electron typecheck: PASS.
- U11 headless E2E dogfood: `MainCommander.runEngineeringGoal` against this repo →
  **ENGINEERING_CONVERGED** (1 iteration, 0 findings, working tree untouched), using real
  typecheck + full-suite audits (~9.7 min). Runner: `tests/u11-dogfood.test.ts`
  (`BOSS_DOGFOOD=1`; no-ops inside the nested audit).

## Unit status

| Unit | Status | Key commits |
|---|---|---|
| U0 audit | DONE | `4b01fc1` |
| U1 broken/partial feature fixes | CLOSED | `4b01fc1 c8aac22 085f77c 9cd02b4 8892297 6be60b8` |
| U2 sequential auto-continuation + closure | CLOSED | `b1a6261` |
| U3 1/3/5 Work Mode + roles + evidence>vote | CLOSED | `190daf2 b38113c d6e8d9b aba5494` |
| U4 layout/panes/live-state/split-merge | DONE — DETACHED two-window mode live-validated on the running app (`2268a87`): MERGED↔DETACHED via `setWorkspaceView`; panes migrate between Boss window and window B with sessions intact; window B self-lays-out and its close returns to MERGED | `c99eb0e 4be8035 7dd376a 2268a87` |
| U5 Web-AI/API/Profile-Account managers | PART (masked-key done; UI surfaces + SecretVault decision recorded) | `33ca489` |
| U6 session lifecycle (archive default, manual-only delete, fresh conversation) | MOSTLY (retryable archive automation pass done `3b0e550`; live page-state attempt + recovery trigger need the running app) | `99b0d5f 9091fda 493ed6b 3b0e550` |
| U7 research registry + manuscript depth + tables/visual gate | MOSTLY (PDF-embedded figures need the live pipeline) | `cfea2e5 84dcd44 7b62849` |
| U8–U10 autonomous engineering loop | DONE headless (goal contract, boundary, iteration machine, convergence/stagnation, §38 checkpoint/rollback, real-env audit commands, durable status read-model `2834ee3`, goal IPC surface `08e8169`) | `0db171e b0476af 93c9c94 fd55af0 2834ee3 08e8169` |
| U11 E2E dogfood + full regression | DONE headless | `7d5738b` |

## Live GUI validation (rounds 10+, user-opened Codex Boss instance)

A user-opened Codex Boss instance is now drivable from this environment: relaunched
with `--remote-debugging-port=9223` (same `runtime-data`/browser profile; state and
the logged-in ChatGPT provider page survived the restart). Reusable CDP driver:
`Update-Plan/live-cdp/cdp.mjs` (gitignored). Live-validated end-to-end on the real app:

- Boss renderer bridge live: `window.boss` present (56 methods).
- Rebuilt `dist-electron` loaded round-8 IPC: `engineeringGoalStatus` /
  `engineeringGoalRun` exposed on the live bridge.
- `window.boss.engineeringGoalStatus()` returned the durable snapshot over
  renderer → preload → main → EngineeringLoopStore.

Remaining GUI units are now implementable and live-verifiable through this channel
(DETACHED two-window mode, manager/goal React panels, live archive attempts,
coder-backed goal runs against the open ChatGPT session).

## Remaining (live-GUI / provider-session bound, now live-verifiable)

DETACHED two-window mode; Web-AI/Profile-Account manager UI; U6 retryable external-archive
automation + council fresh-context seam; U10 live coder-backed implement/reviewer ops + goal UI
start surface; computer permission/PerceptionLoop/DOM-tier leftovers; ExecutionGate production
caller; microtask decomposition in the Commander spine. None blocks the deterministic scope:
every headless contract ships committed with tests, and the loop is E2E-proven on this repo.
