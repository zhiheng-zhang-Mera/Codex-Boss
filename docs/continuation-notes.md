# Continuation notes

> The minimum needed to resume this work cold: where the repository is, the ritual
> every change goes through, the hazards that have actually cost incidents, and
> what is left in plan order. The authoritative per-phase record is
> `docs/phase-status.md`; this file is the handoff, not a second ledger.
>
> **Re-measured 2026-09-19 on `main` at `9d698c05659c92b9d9c1eed1be7321ff610bf780` (Root Trust epoch 23).**
> Every number in this file was re-derived from this tree with the tool named beside it, or is marked
> `NEEDS_REMEASUREMENT` where the repository cannot prove it. The previous snapshot was **not** copied
> forward: it recorded branch `Prestart-checkpoint-5`, epoch 20 / 54 surface files, 24 boot modules, 2748
> exports and 182 files / 1932 tests, and every one of those had moved.

## Where this stands

- **Canonical branch `main`**, remote `origin` = `zhiheng-zhang-Mera/Codex-Boss`, HEAD `9d698c05…`. The old
  `Prestart-checkpoint-N` branch convention is historical; nothing in the current workflow depends on it.
- **Root Trust: epoch 23 (`boss-root-trust-23`), 63 files on the surface, matching the live tree.**
  `node scripts/acceptance-evolution-bless.cjs --check` prints `epoch 23 (boss-root-trust-23) MATCHES the live
  surface`, aggregate `0ddb900014c924bb93b6e0998495576b8c6d72dc62afb9647f1e3363c3956a0a`. A Root Trust
  Surface change still requires `--advance` **in the same commit**; the migration writes
  `trust-policy/trust-epoch.json` and rewrites `trust-policy/root-trust-surface.json` byte-identically.
- **Cloud CI is four jobs** — `quality`, `unit`, `acceptance`, `package` (`.github/workflows/ci.yml`, and
  observed as real check contexts). Current green reference: run **35428430102** on `9d698c0` — quality 13/13
  steps, unit 15/15, acceptance 74/74 with **0 skipped**, package 13/13, attempt 1, no re-run.
- **`Main-Protection` requires exactly those four checks.** Two lanes are deliberately *not* required, because
  they are not part of the per-push merge contract: `finalize` (`trust-epoch-finalization.yml`,
  dispatch-only behind the `boss-root-trust-owner` protected environment) and `hosted-runner-status`
  (`platform-qualification.yml`, the hosted diagnostic that states it cannot qualify a real host). The real
  Phase 01–05 qualification runs on the real soak host, driven by the separate private
  `Boss-Qualification-Control` repository.
- **The old local gate runner no longer exists.** The previous note's `node .cache/run-gates.cjs` → `70/70
  steps` cannot be re-run or verified: `.cache/` is gitignored and holds no such runner in this tree. The
  replacement is `corepack pnpm run verify:targeted`, which executes the whole unit tier and then checks the
  selector against the run it just performed.
- `pnpm` is not on PATH: use `corepack pnpm …`. Node **v24.14.0** (`node -v`), Electron **44.0.0**
  (`package.json`), Windows **10.0.26200** (runner OS recorded by the qualification run).

## The ritual for every change (in this order)

1. Edit, then `corepack pnpm run typecheck` — **after** writing any new test file.
   Running it before has failed gate step 1 twice (rounds 33 and 39): an invalid
   `TaskLifecycleState` literal and a missing `visual` field are exactly the kind
   of error only the tests project catches.
2. `corepack pnpm test` (unit tier) → `corepack pnpm run build` →
   `corepack pnpm run test:postbuild` → `corepack pnpm run test:slow`.
   `test:postbuild` genuinely needs the build; the unit tier genuinely does not.
   `corepack pnpm run test:platform-qualification` is the frozen Phase 01–05 tier: it needs generated phase
   artifacts, a real full-suite pairing record and an accumulated host corpus, so it runs on the real soak
   host under the private control plane — never in this repository's CI.
3. `corepack pnpm exec node scripts/acceptance-evolution-bless.cjs --check`.
   If any Root Trust Surface file changed, run `--advance` **in the same commit**
   and say so in the message.
4. Commit (one phase per commit, with the reasoning and the measurements in the
   body — the messages are part of the record).
5. `corepack pnpm run verify:targeted` → expect `the targeted selection and the full gate agree`.
6. Push **by explicit refspec** and confirm the remote ref equals HEAD:
   `git push origin HEAD:refs/heads/main`, then `git ls-remote origin refs/heads/main`.
7. Poll cloud CI until all four jobs are green:
   `gh api repos/zhiheng-zhang-Mera/Codex-Boss/actions/runs/<id>` and `…/jobs`.

## Hazards that have cost real incidents

- **Never interrupt the gate runner.** A killed run during `acceptance:evolution-battery`
  leaves the repository checked out on its `boss/evolution/<id>` branch with a
  `battery.lock` whose pid is dead. Symptom seen in practice: a commit landed on the
  evolution branch and `git push origin <branch>` then printed "Everything
  up-to-date" while pushing a stale ref. Always verify `git ls-remote` against HEAD
  after pushing, and check `git branch --list "boss/evolution/*"` is empty.
- **A spent evolution mutex can name a live pid, and the rule that decides it is now
  witness-based.** `scripts/acceptance-evolution-quiescence.cjs` refuses a foreign run only
  when the pid is alive *and* the run directory was written inside `HEARTBEAT_FRESH_MS`
  (30 min) *or* HEAD is stranded on that run's `boss/evolution/<id>` branch. Reading
  `alive: true` in a refusal as "a run is really executing" is wrong: pid `2064` of the
  retained lock `evolution-1789347366120` belonged to `svchost` 34 h after that run was
  killed. If the battery ever refuses, read the printed `refusal <CODE>` lines — each
  carries its remedy — and never "fix" it by deleting a mutex whose HEAD witness is still
  present.
- **Boot modules may not import Electron and may not do fs/git/process work**
  (`tests/unit/repository-boundary-guards.test.ts` scans every line of every
  `electron/bootstrap/*.ts`, comments included). Inject the surface instead:
  `IpcRegistrar` for `ipcMain.handle`, a generic `createWindow` factory for the
  window, `crypto` callbacks for `safeStorage`, a `canonicalize` function for
  `realpathSync`. Note the guard also fails on the *words* `mkdirSync`,
  `writeFileSync`, `rmSync`, `execFile`, `spawn` appearing in those files.
- **Electron's `app.on` is a set of per-event overloads**: passing a union event
  name does not compile. Narrow with `if`/`else` at the injection site.
- **Do not destructure a boot module's service into names the composition root
  already declares** at module scope (`progressAggregator`, `recoveryScheduler`):
  a `const { … } =` declaration shadows them inside the function and the outer
  bindings are then never assigned. Assign into them instead.
- **Windows short names**: `fs.realpathSync` (JS) keeps 8.3 form, `fs.realpathSync.native`
  expands it. The CI runner's temp path is short-form, which once failed two tests
  that asserted the `mkdtemp` spelling. Assert the canonical form.
- **Never change a timeout or buffer bound without a measurement**, and never
  widen a per-test ceiling to make a suite pass.
- **The sandbox suite fails WHOLESALE when `%TEMP%` fills with fixtures.** Symptom to
  recognise: every case in `tests/unit/evolution-sandbox.test.ts` fails in
  milliseconds, **including its own CONTROL case**, which reads like a containment
  regression and is not one. Two causes have been measured, and the second is the one
  that actually bites:
  1. `CodexBossEvolution-rt-sandbox-<pid>` **registrations** accumulate under
     `HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\
     CurrentVersion\AppContainer\Storage`. This machine reached 59 folders and 125
     registrations. Deleting the folders is NOT enough — that leaves the
     registrations and the next run fails the same way. The suite now deregisters and
     removes its own profile in `afterAll`, which took a full `test:slow` from +1
     registration per run to netting zero.
  2. **`%TEMP%` holding tens of thousands of directories.** Measured at 36,565
     directories (31,489 of them `codex-boss-*` fixtures from earlier runs): the slow
     tier failed 12/14 including CONTROL, and after deleting the aged ones
     (`codex-boss-*`, `wb-*`, `boss-*`, `engine-p11*` older than 30 minutes) the same
     tier passed **25/25** with no other change. Space was never the issue — 390 MB —
     the entry count is. Prune it before blaming the sandbox, and note that one gate
     run adds thousands.
- **Do not write `electron/main.ts` or other UTF-8-with-Chinese files with
  PowerShell** (`Set-Content -Encoding utf8` corrupted them before); use the edit
  tool. This was learned twice: a `[System.IO.File]::WriteAllLines` splice mangled
  all 16 Chinese/em-dash runs in `main.ts` during the research extraction. The repair
  is `git checkout HEAD -- electron/main.ts` (git restores the bytes), verify with
  `git hash-object <file>` against `git rev-parse HEAD:<file>`, and redo the edits.
  If a splice is genuinely needed, do it in **Node** (`fs.readFileSync(file, "utf8")`
  → `fs.writeFileSync(file, next, "utf8")`) and assert the non-ASCII character set is
  unchanged before and after.
- **Do not READ UTF-8 source with PowerShell either, and do not author scripts
  containing non-ASCII through it.** Two traps, both hit in one round: `Get-Content`
  without `-Encoding utf8` renders this host's UTF-8 as GBK, so `§24` and `—` display
  as `搂24`/`鈥` and a perfectly clean file looks corrupted; and the reverse happens on
  the way in — a here-string containing `§` written with `Out-File -Encoding ascii`
  reaches Node as `?`, which turned a citation regex into
  `Invalid regular expression: Nothing to repeat`. Use the `read` tool (or Node) to
  inspect, and put non-ASCII in scripts as escapes (`\u00a7`) or not at all.
- **`.cache/` and `artifacts/` are gitignored.** `artifacts/acceptance/**` and
  `artifacts/evolution/**` are the attested chain's live state — do not prune them
  by hand; the gate sequence's `acceptance:session:start --clean` owns that.
  The 400 MB `artifacts/Codex-Boss-1.0.0-*` package output is regenerable and is
  what accumulates: keep the newest one or two.

## What is left — a status, not a promise

**Read this section as measurement, not as a plan.** The plan documents that name the groups below are not
tracked in this repository — the comment-citation guard exists precisely because 1308 comments cite documents
that are absent here — so a group letter's completion cannot be re-derived from the tree. Where the repository
can prove something it is stated with the number that proves it; where it cannot, the item says
`NEEDS_REMEASUREMENT` instead of guessing.

Measured now:

1. **K — closed, and re-measured rather than remembered.** The export surface under `electron/**` + `src/**` is
   **3077 exports, 0 unreachable**, and `tests/fixtures/export-surface-exceptions.json` is **empty**
   (`tests/helpers/export-surface-scan.ts`). The previous note's "2748, all referenced" was the same claim one
   round earlier: the number grew, the invariant did not move.
2. **J — no `MIGRATE` marker survives**: 0 hits across 547 source files under `electron/**` + `src/**`. That
   is not proof the phase finished — only that nothing is left marked.
3. **Q — the citation debt is unchanged, not falling.** 1458 section citations in comments (665 files, 9782
   comments scanned), **1308** of which name no tracked document, against a baseline of exactly 1308 in
   `tests/fixtures/comment-citation-baseline.json`. The guard permits the number to fall and forbids it to
   rise, so this is the number to lower next time `docs/` grows.
4. **I — the "two `ProjectStateStore`s" symptom no longer matches the code**: there is now a single
   construction site, `electron/bootstrap/persistence.ts:147`, behind an `open(…)` factory. The rest of the
   item (theme tree; `.boss/research/**` layout split) is `NEEDS_REMEASUREMENT` — `.boss/research/<id>.json`
   is still the documented layout, but no current instrument asserts the split.

`NEEDS_REMEASUREMENT` — the repository cannot currently prove these:

- **F — the `main.ts` extraction groups** (`providers`, `research`, `engineering`) and whether the remaining
  acceptance entry points should become their own modules. The previous note contradicted itself here — its
  item 1 said F was complete while item 2 listed F as remaining — and nothing in the tree settles it. Measured
  input for whoever does: `electron/main.ts` is **1448 lines** with **0** literal-channel
  `ipcMain.handle("…")` registrations and **16** `ipcMain.handle(` calls (the registrar handed to the IPC
  modules), and `electron/bootstrap/` holds **26** modules.
- **M — the supervising process runners.** The old "8 process call sites / 10 declared supervising runners"
  figures came from an audit list that is not tracked here. Measured substitutes, with the method stated:
  **10** files import `electron/process/process-gateway.ts`, **23** import `electron/git/git-gateway.ts`, and
  **11** import `node:child_process` — of which exactly **one** (`electron/git/git-gateway.ts`, the gateway
  itself) invokes git.
- **H — the four audit items** (`main.ts` headless preflight (`updateRun`/`setTaskStatus`), `evaluation-store`
  golden, `autonomous-evolution-surface/identity` unreadable files, `self-evolution-coordinator` evidence
  persist). The decisions live in the code; the item status does not.
- **P — a real clean-clone run.**

## Snapshots (re-measured 2026-09-19 at `9d698c05`, epoch 23)

| Fact | Value | How it was measured |
| --- | --- | --- |
| Root Trust epoch / surface files | `23` / `boss-root-trust-23`, **63** files | `acceptance-evolution-bless.cjs --check` |
| `electron/main.ts` | **1448** lines | line count of the tracked file |
| literal-channel `ipcMain.handle("…")` | **0** | regex over `electron/main.ts`; **16** `ipcMain.handle(` calls remain (the registrar) |
| `electron/bootstrap/` modules | **26** | tracked `.ts` files in that directory |
| exports under `electron/**` + `src/**` | **3077**, all referenced; exceptions list empty | `tests/helpers/export-surface-scan.ts` |
| comments citing a section number | **1458** citations, **1308** naming no tracked document | `tests/helpers/comment-citations.ts` |
| tests, unit tier (`pnpm test`) | **218 files / 2548 tests** | Desktop CI run 35428430102, `unit` job log |
| tests, `test:postbuild` | **8 files / 115 tests** | same run |
| tests, `test:slow` | **4 files / 36 tests** | same run |
| tests, `test:platform-qualification` | **3 files / 25 tests** | local run at `9d698c0` (real host corpus); tier declared in `vitest.tiers.mjs` |
| declared layers | **8** | `LAYER_RULES` in `vitest.tiers.mjs`, enforced by `tests/unit/test-layers.test.ts` |
| git spawning | confined to `electron/git/git-gateway.ts` (1 file imports `node:child_process` **and** invokes git; 23 files reach git through it) | import-graph scan of all 547 TS files under `electron/**` + `src/**` |
| process / child-process surface | 10 files import `process/process-gateway`, 11 import `node:child_process` | same scan |
