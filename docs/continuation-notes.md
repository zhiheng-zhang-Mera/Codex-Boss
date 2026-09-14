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
- **AppContainer profiles accumulate and then break the sandbox suite.** Every run
  of `tests/unit/evolution-sandbox.test.ts` creates a
  `CodexBossEvolution-rt-sandbox-<pid>` profile. What accumulates is the
  **registration**, not the folder: this machine reached 59 folders and **125
  registrations** under `HKCU\Software\Classes\Local Settings\Software\Microsoft\
  Windows\CurrentVersion\AppContainer\Storage`, and in that state **every case in
  that file failed in milliseconds, including its own CONTROL case** — which reads
  like a containment regression and is not one. Symptom to recognise: wholesale,
  instant failures in that one file. Deleting the profile *folders* under
  `%LOCALAPPDATA%\Packages` is NOT enough — that leaves the registrations and the
  next run fails the same way (measured). Remove the registration keys too, or run
  the suite, whose `afterAll` now deregisters and removes its own profile: a full
  `pnpm run test:slow` went from leaving +1 registration per run to netting zero.
  Still outstanding, and the durable fix: the launcher only calls
  `CreateAppContainerProfile`, so nothing in the product can unregister a profile —
  a `DeleteAppContainerProfile` path belongs in the sandbox backend.
- **Do not write `electron/main.ts` or other UTF-8-with-Chinese files with
  PowerShell** (`Set-Content -Encoding utf8` corrupted them before); use the edit
  tool.
- **`.cache/` and `artifacts/` are gitignored.** `artifacts/acceptance/**` and
  `artifacts/evolution/**` are the attested chain's live state — do not prune them
  by hand; the gate sequence's `acceptance:session:start --clean` owns that.
  The 400 MB `artifacts/Codex-Boss-1.0.0-*` package output is regenerable and is
  what accumulates: keep the newest one or two.

## What is left, in plan order

1. **F — `providers`, the pool slice** (the largest remaining piece): the
   `ProviderViews` instance, `attachProviderViews`, `ProviderAutomation`, the
   `provider(id)` lookup and `openProviderWithinLimit` — 32 `providerViews` and
   ~30 `automation` references, and the CDP desktop acceptance drives provider
   panes through all of it. Needs a full round with a buffer. The API-side half
   (the client, the GitHub machine identity and the API-runtime registration) is
   already extracted into `electron/bootstrap/providers.ts`.
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
6. **J** the remaining `MIGRATE` items, **K** 213 unused exports / 886 unused
   types, **P** a real clean-clone run, **Q** the repo-wide comment sweep.

## Snapshots (as of the checkpoint)

- `electron/main.ts`: **1315 lines** (from 1884), constructor calls **92 → 61**,
  inline IPC handlers 51 → **0**; **20** boot modules in `electron/bootstrap/`.
- Tests: **171 files / 1863 tests** in the default tier, 62 postbuild, 25 slow;
  eight layers declared in `vitest.tiers.mjs` and enforced by
  `tests/unit/test-layers.test.ts`.
- Gates: **0 files spawning git directly** (git gateway, empty debt list);
  **8** process call sites on `electron/process/process-gateway.ts` and **10**
  declared supervising runners.
