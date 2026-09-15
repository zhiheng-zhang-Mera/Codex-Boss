# Continuation notes

> The minimum needed to resume this work cold: where the repository is, the ritual
> every change goes through, the hazards that have actually cost incidents, and
> what is left in plan order. The authoritative per-phase record is
> `docs/phase-status.md`; this file is the handoff, not a second ledger.

## Where this stands

- Branch `Prestart-checkpoint-5` (branches follow `Prestart-checkpoint-N`; 1–4 are
  the earlier checkpoints), remote `origin` = `zhiheng-zhang-Mera/Codex-Boss`.
- Root Trust Surface epoch **17** (`boss-root-trust-17`), 52 files.
- Local gate sequence: **70/70 steps** (`node .cache/run-gates.cjs`, which mirrors
  `.github/workflows/ci.yml` step order and writes transcripts to
  `artifacts/gate-run/<stamp>/`). Cloud CI: four jobs — `quality`, `unit`,
  `acceptance`, `package`.
- `pnpm` is not on PATH: use `corepack pnpm …`. Node v24.14.1, Electron 44,
  Windows 10.0.26200.

## The ritual for every change (in this order)

1. Edit, then `corepack pnpm run typecheck` — **after** writing any new test file.
   Running it before has failed gate step 1 twice (rounds 33 and 39): an invalid
   `TaskLifecycleState` literal and a missing `visual` field are exactly the kind
   of error only the tests project catches.
2. `corepack pnpm test` (unit tier) → `corepack pnpm run build` →
   `corepack pnpm run test:postbuild` → `corepack pnpm run test:slow`.
   `test:postbuild` genuinely needs the build; the unit tier genuinely does not.
3. `corepack pnpm exec node scripts/acceptance-evolution-bless.cjs --check`.
   If any Root Trust Surface file changed, run `--advance` **in the same commit**
   and say so in the message.
4. Commit (one phase per commit, with the reasoning and the measurements in the
   body — the messages are part of the record).
5. `node .cache/run-gates.cjs` → expect `70/70 steps passed`.
6. Push **by explicit refspec** and confirm the remote ref equals HEAD:
   `git push origin HEAD:refs/heads/<branch>`, then `git ls-remote origin refs/heads/<branch>`.
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

## What is left, in plan order

1. **F is complete for every plan-named group.** `providers` (API side, pool policies
   and pool objects), `research` and `engineering` are all extracted; what is left in
   `electron/main.ts` is the composition of them plus the acceptance entry points
   (the smoke block and the headless research run), which are entry points rather than
   groups. The next F-shaped work, if it is wanted, is deciding whether those entry
   points should become their own module — and that is a decision about how the
   acceptance harness names things, not about `main.ts`.
2. **F — `engineering`** and **F — `research`**: the remaining plan-named groups.
3. **M — the supervising process runners**: `host/process-runner`,
   `research/runtime/process-runner`, `remote-relay`, `host/soak-harness`,
   `self-evolution-coordinator`, the Codex agent process, the UIA/OCR bridges and
   the two sandbox modules. They stream over the operation's life or must signal
   the child later, so they need a supervision surface, not the capture-and-return
   gateway.
4. **H — four audit items**: `main.ts` headless preflight (`updateRun`/`setTaskStatus`),
   `evaluation-store` golden, `autonomous-evolution-surface/identity` unreadable
   files, `self-evolution-coordinator` evidence persist (the policy is right, the
   silence is not). Seven sites are already closed; the pattern that worked is:
   keep the fail-safe decision, record the reason, expose it, correct any comment
   that claimed a distinction the code did not make.
5. **I** multi-writer durable state (`.boss/project-state.json` has two
   `ProjectStateStore`s; theme tree; `.boss/research/**` layout split).
6. **J** the remaining `MIGRATE` items, **P** a real clean-clone run, **Q** the
   repo-wide comment sweep. **K is closed**: the "213 unused exports / 886 unused
   types" item was a name-import count, and re-measuring it through the import graph
   and the whole tracked tree showed **zero** unreferenced exports — 1080 of them
   simply did not need the keyword (3828 → 2748 exports, 337 files, each verified as
   an `export`-only diff plus a clean `typecheck`). `tests/unit/export-surface.test.ts`
   now fails when a new export is neither reachable nor mentioned anywhere, so the
   surface cannot silently rot again.

## Snapshots (as of the checkpoint)

- `electron/main.ts`: **1314 lines** (from 1884), literal-channel `ipcMain.handle("…"`
  registrations 51 → **0** (the 16 remaining `ipcMain.handle(` occurrences are the
  registrar handed to the 16 IPC modules); **24** boot modules in
  `electron/bootstrap/` (16 IPC + 8 service/domain).
- Exports under `electron/**`/`src/**`: **2748**, all of them referenced; the surface
  is enforced by `tests/unit/export-surface.test.ts`.
- Comments citing a section number: **1452**, of which 1308 name no document that
  exists here — frozen by `tests/unit/comment-citation.test.ts`, and meant to fall.
- Tests: **182 files / 1932 tests** in the default tier, 62 postbuild, 25 slow;
  eight layers declared in `vitest.tiers.mjs` and enforced by
  `tests/unit/test-layers.test.ts`.
- Gates: **0 files spawning git directly** (git gateway, empty debt list);
  **8** process call sites on `electron/process/process-gateway.ts` and **10**
  declared supervising runners.
