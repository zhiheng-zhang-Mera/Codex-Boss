# Codex-Boss 统一收口 — U0→U3 execution summary (round 1)

Branch `9-7`. Source plan:
`Update-Plan/Codex Boss统一收口工程计划书.md` (gitignored, local). Baseline tag
`9-7-u0-baseline` at `da5a20d` (typecheck green, builds green, 641/644 tests;
the 3 failures were fixed-5s-timeout flakes that pass standalone).

## U0 — Feature Completeness Audit (Phase 0)

Ten read-only domain audits (core/input/providers/work/computer/persistence/
history/engineering/research/ui) were executed and aggregated:

- `Update-Plan/audit/U0/domain-<name>.json` — per-domain evidence reports.
- `Update-Plan/audit/U0/completion-matrix.json` — 115 items + 38 findings.
- `Update-Plan/audit/U0/completion-report.md` — narrative + U1 fix order.

Global rollup: 8 E2E_VERIFIED · 45 FUNCTIONAL · 18 WIRED · 31 PARTIAL ·
13 NOT_IMPLEMENTED. No STUBs. Baseline remains locally reproducible.

## U1 — broken/partial feature fixes

| Commit | Fix |
|---|---|
| `4b01fc1` | **P0** API-transport runs with file attachments now fail closed at preflight instead of silently sending a text-only body and completing (`tests/api-attachment-failclosed.test.ts`); **P1** idempotent `ProjectStateStore.recordTaskCompletion` (no duplicate rows on restart) |
| `085f77c` | **P1** deep conversation duplicate (councils/evidence/final responses copied + re-linked); §13 guards — delete IPC requires explicit `userConfirmed`, state-array budget refuses auto-prune without user authorization; removed dead API/local `UnsupportedRuntime` stubs |
| `c8aac22` | **P1** evidence decision derived from claim/dispute state (§2.3 Evidence>Vote) |
| `9cd02b4` | **P1** `api:<provider>` and `local:native` rows on the runtime-control surface |
| `8892297` | **P1** web runtime health follows the account probe, not window-open |
| `6be60b8` | **P1 (research correctness)** manuscript binds full-set reproducibility statistics, not the pre-replication n=1 snapshot |

## U2 — Sequential runner / recovery closure

- `b1a6261` CODEX_REQUIRED finalization auto-retries through a durable bounded
  `finalize` recovery wakeup; no manual retry click on the normal path.

## U3 — Work mode 1/3/5 + roles

- `190daf2` `src/shared/work-mode.ts`: `WorkAgentCount = 1|3|5`, WorkRole
  vocabulary, default role sets, count/role decoupling, deterministic
  assignment; council reviewers get distinct role focus briefs.
- `b38113c` durable `workAgentCount`/`workRoles` on tasks.
- `d6e8d9b` engineering worker cap configurable 1–5 (default 3 unchanged);
  `PlanCompiler` + `MainCommander` honor a 5-AI pool for L3 plans.

## Verification this round

- Full suite green at each commit (end-of-round full run: see next commit note;
  the only earlier failures were the two known git-clone timeout flakes that
  pass standalone).
- Typecheck (both tsconfigs) and renderer/electron builds green after every
  change.

## Next (round 2+) per plan §46

U3 remainder (evidence>vote publication gate + no-self-closure N=1) → U4 UI
cleanup + MERGED/DETACHED + dynamic 1/3/5 layout → U5 managers (Web AI / API /
Profile-Account + SecretVault adoption) → U6 task-scoped web session lifecycle +
auto-archive + §14 tracking → U7 research capability registry / manuscript
depth / figures+tables gates → U8–U10 autonomous engineering loop →
U11 dogfooding. Full P1 backlog: `Update-Plan/audit/U0/completion-report.md`.
