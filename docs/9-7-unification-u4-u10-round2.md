# Codex-Boss 统一收口 — U0→U10 execution summary (rounds 1–2)

Branch `9-7`. Source plan:
`Update-Plan/Codex Boss统一收口工程计划书.md` (gitignored, local). Baseline tag
`9-7-u0-baseline` at `da5a20d`.

See `docs/9-7-unification-u0-u3.md` for the U0→U3 narrative; this file records
round 2 (U3 remainder + U4–U10 deterministic foundations).

## U3 — Work mode + Evidence>Vote publication gate

| Commit | Fix |
|---|---|
| `aba5494` | Finalizer never auto-publishes while the accepted evidence holds unresolved claims: bundle with DISPUTED/INSUFFICIENT claims or disputes parks the task at `READY_FOR_USER_REVIEW` + blocker; operator explicitly accepts via `boss:accept-evidence` (decision → PASS) and Boss finalizes. Direct/clean paths unchanged |

## U4 — UI layout (§9.1/§9.2) + pure workspace-layout model

| Commit | Fix |
|---|---|
| `c99eb0e` | `src/shared/workspace-layout.ts` (MERGED/DETACHED state, deterministic full-height horizontal 1..5 pane layout, persisted order, manual-zoom override); styles: all counts single-row full-height (never the legacy 2×3 five-pane grid); per-pane zoom −/＋/reload IPC + renderer controls; `ProviderViews.setManualZoom` wins over auto-fit |

## U5 — API manager security (masked key display)

| Commit | Fix |
|---|---|
| `33ca489` | `ApiProviderSetting.keyTail` — snapshot exposes only the last 4 chars (`sk-••••••••42A9`), never the full key to the renderer; tests assert no leakage |

## U6 — session lifecycle: auto-archive + external archive ledger

| Commit | Fix |
|---|---|
| `99b0d5f` | `src/shared/archive-policy.ts`: conversation auto-archives (flag only, never delete) when its last task finishes and no sibling stays active; wired into completion (active conversation is kept visible for the user) |
| `…external` | `src/shared/external-session.ts` + `electron/workspace/external-session-ledger.ts` (§14): durable per task+provider external web-session records with strict ACTIVE→ARCHIVE_PENDING→ARCHIVED/FAILED transitions; completion defers external archive to retryable ARCHIVE_PENDING (never fake-archived); `boss:external-session-list` IPC |

## U7 — Research manuscript depth (deterministic gates)

| Commit | Fix |
|---|---|
| `cfea2e5` | `research-manuscript.ts` §18 per-section sufficiency obligations + §19 `antiPrematureClosure` (undiscussed claims/evidence, results-without-interpretation); conductor records verdicts into `manuscript-review.json` |
| `84dcd44` | `research-capability-registry.ts` (§20): 16 capabilities with deterministic NEEDED/NOT_NEEDED per study profile; qualitative studies never invoke stats/replication/chart modules |

## U8–U10 — Autonomous engineering loop (foundation + real ops)

| Commit | Fix |
|---|---|
| `…loop-core` | `src/shared/engineering-loop.ts` (§26–§41): goal contract + validation, product boundary guard, severity/triage, iteration stage machine, `decideConvergence` (Critical=0/High=0 + clean rounds + OPTIONAL stop), stagnation signals; `engineering-loop-store.ts` durable ledger; `engineering-loop-driver.ts` deterministic driver (audit→triage→implement one finding→build/test/verify→review→regression→re-audit→converge) |
| `b0476af` | `repo-engineering-operations.ts` real audit/build/test (allowed commands, failures→HIGH findings); command-runner records missing tooling as FAILED (not throw); `MainCommander.runEngineeringGoal` facade freezes goal + runs driver with injected editor/reviewer (honest ABORT without an editor) |

## Verification

Full suite at round end: **135 files / 680 tests green** (timeouts raised on the
two process/git-heavy tests fixed the earlier full-suite-only flakes). Typecheck
(both tsconfigs) + renderer/electron builds green after every commit.

## Remaining (rounds 3+)

- U4 remainder: **DETACHED** two-window mode (needs live Electron GUI
  validation) and pane live-state surface.
- U5 remainder: Web AI Manager / Profile-Account manager UI + SecretVault
  adoption decision (guardian ceremony on rotation).
- U6 remainder: fresh external web conversation per new task + fresh-context
  council reviews (page-navigation seam) + §14 retryable external archive
  automation.
- U7 remainder: figures/PDF embedding + table builder + visual-evidence gate
  wiring into readiness.
- U10 remainder: live coder-backed implement/reviewer operations + UI start
  surface + checkpoint/rollback + regression ladder; stagnation reporting.
- U11: real E2E dogfooding of the autonomous engineering goal against a
  non-toy repo and full-suite regression.

Backlog + per-domain evidence: `Update-Plan/audit/U0/completion-report.md`.
