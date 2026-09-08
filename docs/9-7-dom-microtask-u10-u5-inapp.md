# Codex-Boss 9-7 — 统一收口继续执行记录（DOM 真机接线 · microtask 入主线 · U10/U5 面板 · 应用内收敛）

Branch `9-7`. Supersedes the "Remaining" list of `docs/9-7-plan-closeout.md` for the items below.

## ① DOM 层真机接线（domPageSurface → provider 页面）

Before this round the §8.2 DOM tier was dead code in production: `createComputerRuntime`
only built a `DomPageBackend` when `options.domPageSurface` was provided, and no caller
ever provided one (tests only). `dom:` semantic actions ended `UNSUPPORTED`.

- `electron/computer/backends/dom-page.ts` — `DomTarget`/`DomPageSurface` gained an
  optional provider page ref; scripts still embed selectors/values via `JSON.stringify`
  (no breakout). Malformed `providerId` fails closed.
- `electron/computer/backends/provider-dom-surface.ts` (new) — production surface bound to
  the visible provider `WebContentsView`s (`ProviderViews`); evaluates on the named pane and
  throws when the pane is closed/crashed or the target is ambiguous.
- `electron/main.ts` — `domPageSurface: providerDomSurface(() => providerViews)` wired into
  `MainCommander` computer options.
- `electron/commander/main-commander.ts` `runNative` — a `dom:` target without a provider id
  is bound deterministically from the task's open providers (exactly one) or the single open
  pane, else fails closed with guidance. Reads still pass the §17/§18 gate; mutations need the
  allow-list as before.
- Live CDP evidence (running app, real logged-in ChatGPT pane): an L0 desktop task
  `dom:{"provider":"chatgpt","selector":"body"}` read_page completed and captured
  `{"status":"SUCCESS","evidence":{"text":"跳至内容 …今天有什么计划？…"},"backend":"dom"}`
  — the whole chain task → runNative → SemanticRuntime → DomPageBackend → provider
  WebContentsView executes for real. (`Update-Plan/live-cdp/dom-live-read.out.json`)

## ① AP12 microtask 递归入 Commander 主线

`MicrotaskRuntime`/`EngineeringRuntime` microtask mode existed but no production executor
declared `microtasks`, so the Commander spine always ran single-step proposals.

- `electron/engineering/deferred.ts` (new) — single `GraphDeferred` home; both runtimes import
  it (a duplicated class per module would have turned deferred microtasks into FAILED).
- `electron/commander/plan-runner.ts` — replan now purges the step's whole microtask scope
  (`graph_<stepId>_microtask*`), so a replanned step with a changed scope never trips the
  DAG-fingerprint guard into an unrecoverable failure.
- `electron/engineering/engineering-runtime.ts` — optional `microtasks.join(outputs)` hook
  (behavior-preserving when absent).
- `electron/commander/main-commander.ts` `runPlan` — the spine executor now declares
  `microtasks`; wide edit steps (kind `edit`, >6 files, non-L3) decompose into bounded
  read → propose micro-DAGs (one coder proposal per ≤5-file group). Each propose runs the
  same ProposalRunner contract (host checks + repairs), ledger `modifiedFiles`/`toolCalls`
  updated per group, durable per-microtask jobs
  (`graph_<stepId>_microtask_<microtaskId>`), and the join emits ONE canonical ProposalResult
  so every downstream consumer (step verify, sinks, engineering summary, artifact) is
  unchanged. Small / L3 steps keep the exact byte-identical single-step path.
- Tests (local, gitignored): `tests/plan-microtask-spine.test.ts` — decomposed E2E through
  real MainCommander/PlanRunner (2 coder proposals for 7 files, aggregate ProposalResult with
  all 7 changes, restart reuse with zero re-proposals, replan purge), plus a negative test that
  small steps produce zero `_microtask` jobs.

## ② U10 目标 React 启动面板 + U5 管理器面板（CDP 真机验证）

- `src/renderer/components/GoalRunPanel.tsx` (new) — the U10 goal start surface: objective /
  workspace / agent-count / convergence policy launcher plus a live monitor over the durable
  `engineeringGoalStatus` read-model (iterations, clean rounds, stage/status, changed files,
  open findings with severity) and the run result. Started from a new `工程目标` tab.
- `src/renderer/components/ManagerPanel.tsx` (new) — the U5 manager: Providers (open/close/
  reload/remove/add-custom, account mode + message, MERGED/DETACHED workspace view), API
  (masked key cards, remote channels), Runtime (runtime availability, role routes). `管理`
  header button.
- Replace semantics: `boss:engineering-goal-run` accepts `replace`; `EngineeringLoopStore.
  replaceGoal` archives the current goal ledger to `engineering-loop-<goalId>.json` (never
  deletes) before starting fresh — verified live (old 4-iteration ledger preserved).
- Live CDP on the running app (`Update-Plan/live-cdp/steps-panels.json`): both panels mount,
  tabs present, goal launcher fills and enables start, engineeringGoalStatus read-model
  returns the durable snapshot.

## ③ 应用内全绿收敛调优

Root cause class (rounds 11–13 in-app failures): `electron/main.ts` redirects the app's
`process.env.TEMP` to `<workspace>/.cache/tmp`, so `os.tmpdir()` inside the app resolved
INSIDE the audited repo; nested suites then built their git fixtures inside the audited
worktree (git discovery walked up to the repo `.git`), deterministically breaking the
non-repo-semantics tests (run-recorder canary, change-points, merge-coordinator,
github-resolver, …), plus per-test timeouts under in-app contention.

- `electron/engineering/command-runner.ts` — audit-child scratch now always lands OUTSIDE the
  audited workspace: when `os.tmpdir()` is inside the workspace, fall back to
  `%LOCALAPPDATA%\Temp`. Environment parity with a developer `pnpm test`.
- `electron/engineering/repo-engineering-operations.ts` — stored audit evidence now captures
  the TAIL of the transcript (vitest prints failures last), so the loop store keeps real error
  text instead of a truncated head.
- Test timeouts raised where in-app durations approached explicit caps
  (`engineering-tools` 15 s → 60 s; `github-resolver` clone tests 20 s → 60 s).
- `.cache/tmp` leftovers from the pre-fix rounds purged.

Headless full suite after all changes: **150 files / 752 tests green**; Electron typecheck
PASS; renderer + electron builds PASS.

## Live in-app goal run (evidence)

(Result appended when the run settles — `runtime-data/.boss/engineering-loop.json` +
`Update-Plan/live-cdp/goal-run-live.out.json`.)
