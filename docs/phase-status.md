# Convergence round — phase status

> Codex-Boss 当前版本收束与彻底代码清理执行书. This file records what was
> **actually executed and verified** this round, and what was not. Nothing here
> is "expected to pass": an item is PASS only with the command or test that
> proves it, and everything else is explicitly `NOT VERIFIED`.

Baseline: branch `Prestart-checkpoint-4`, Node v24.14.1, pnpm 11.19.0,
Electron 44.0.0, Windows 10.0.26200, working tree clean at `e2759a5`.

## Verdict per phase

| Phase | What it asks for | Status | Evidence |
| --- | --- | --- | --- |
| A — real baseline | record branch/HEAD/status/toolchain/test counts | **PASS** | this file's header + the round's commit |
| B — fix the red CI | all failing tests fixed by root cause | **PASS** | `e2759a5` and `49af9de`; 21 + 7 failures were two production defects (path identity under Windows 8.3 short names); cloud CI green on both |
| C — recovery finalisation | every autonomous mutating route takes a recovery point | **PASS (with one justified exception)** | `docs/engineering-recovery-audit.md` + `tests/unit/repository-boundary-guards.test.ts`; the failed-candidate route now removes its own worktree and branch and reports a cleanup failure; the Owner-driven plan route is justified, not a gap |
| D — one path truth | normalize→validate→resolve→persist, one semantics | **PASS** | containment collapsed 6→1; canonical identity at every site that decides a cwd, scope, fingerprint or write target; `canonicalRealPathOrNormalized` is the total form; the research workspace is validated at the IPC boundary |
| E — runtime roots | one root model, no subsystem invents a directory | **PASS** | `runtimeRoots()` in `electron/runtime-paths.ts`; guard test forbids hand-joined roots |
| F — split `main.ts` | controlled decomposition | **PARTIAL** | `electron/bootstrap/` holds `boot-module.ts` (the `BootModule<T>` contract, health reporting at boot, reverse-order disposal) plus seven extracted slices: `workspace-ipc`, `attachment-ipc`, `conversation-ipc`, `provider-ipc`, `status-ipc`, `engineering-surface-ipc`, `research-ipc`. `main.ts`: 1884 → 1797 lines. The remaining ~1790 lines still need the same treatment group by group |
| G — IPC boundary | handlers validate/call/translate only | **PARTIAL** | 41 channels across the seven modules are `validate → service → publish` and take a narrow service surface instead of reaching into the composition root; guards forbid `ipcMain.handle` for them in `main.ts`, forbid Electron imports in boot modules, forbid fs/git/process work there, and require the autonomous goal channel to stay the only one that reaches the goal runner. The remaining handlers (task lifecycle, theme, research start/compile, intervention resolution) are unchanged |
| H — error model | no core failure swallowed | **PARTIAL** | every fail-open guard closed (unreadable CODEOWNERS, `assertEngineeringWorkspace`, the recovery ledger, the research ledger's damaged runs, the event bus's dropped handler rejections, `replaceGoal`'s archive, the two lost durable records in `main.ts`); the audit's remaining must-fix sites are listed below |
| I — state ownership | one authoritative owner per durable state | **PARTIAL** | `.boss/tasks/**` now has ONE `TaskLedger` (the store and the commander share the composition root's instance, so their read-modify-write cycles stop failing each other); `.boss/project-state.json`, the theme tree and `.boss/research/**` remain multi-writer and are listed below |
| J — compatibility debt | every legacy item classified | **PARTIAL** | 2 provably dead files deleted; 2 quarantined test files covering LIVE code restored into `tests/` (15 tests); the rest classified in this file and in the round's audit |
| K — dead code | remove provably dead code | **PARTIAL** | the 31 "unreferenced" modules are documented product surfaces (`docs/9-4-*.md`, `docs/9-5-*.md`, …) with quarantined tests, so deleting them is a product decision, not cleanup — recorded, not deleted |
| L — dependency rules | shared ↑ domain ↑ services ↑ app/renderer | **PASS** | asserted by `tests/unit/repository-boundary-guards.test.ts` |
| M — side-effect boundary | few explicit entries per side effect | **NOT VERIFIED** | audit only: 13 git wrappers + 3 process runners identified, no consolidation attempted |
| N — test architecture | `pnpm test` fast/deterministic, no build-artifact coupling | **NOT VERIFIED** | two facts now measured: `tests/unit/closure-terminal-logic.test.ts` spawns acceptance harnesses that need `dist-electron`, and `tests/acceptance/review-loop.test.ts#C-03` (~28s alone) trips the 60s global timeout under the load of a full parallel run. Both files are Root Trust Surface, so they move with Phase O. Also measured: `pnpm run typecheck` covers `src/**` and `electron/**` but **not** `tests/**`, so a stale identifier in a test only fails at runtime |
| O — CI structure | split into logical jobs | **NOT VERIFIED** | `.github/workflows/ci.yml` is Root Trust Surface; changing it requires a trust-epoch migration (`scripts/acceptance-evolution-bless.cjs --advance`) and a fresh certificate — a separate, explicitly sequenced operation |
| P — migration readiness | clone elsewhere → install/build/test/run | **PARTIAL** | asserted: no tracked source file hard-codes an absolute path naming this machine's profile or this repository's folder, and every durable root is derived from `app.getAppPath()` at run time; an actual clean-clone run is **NOT VERIFIED** |
| Q — comment/code truth | no stale or plan-number-dependent comments | **PARTIAL** | the modules this round touched explain the rule instead of a plan number; the repo-wide sweep is **NOT VERIFIED** |
| R — final acceptance | full pipeline, 0 FAIL, 0 stale evidence | **PASS** | see "Acceptance" below |

## What changed this round (code)

- **Root model.** `electron/runtime-paths.ts` gained `RuntimeRoots`/`runtimeRoots()` and the
  `*Under(root)` helpers. `electron/main.ts` now derives `dataRoot`/`cache`/`history`/
  `temp` from it, and the four subsystems that used to spell the directory
  themselves (`provider-automation`, `github/bootstrap`, `github/live-acceptance`,
  `host/sentinel-capture`, `host/doctor`, `stable-candidate/runtime-isolation`,
  `self-evolution-coordinator`) go through it.
- **One containment predicate.** `electron/workspace/path-utils.ts` now exports
  `isInsideWorkspace` (lexical, or symlink-aware on request) and the six copies —
  `workbook-dispatch`, `root-authority/execution-profile`, `self-evolution/mutation-context`,
  `stable-candidate/runtime-isolation`, `emergency-control/evolution-kill-switch`,
  `engineering/native-tools` — delegate to it.
- **One canonicaliser.** `canonicalRealPathSync` replaces the non-native
  `fs.realpathSync` at the identity sites that decide a cwd, a fingerprint, a
  project scope or a write target (`command-runner`, `engineering/workspace`,
  `main-commander`, `research-conductor`, `levela-planner`, `default-levelb-executor`,
  `finding-scope`, `repo-engineering-operations`, `live-engineering-operations`,
  `native-tools`, `protected-surface-guard`).
- **Fail-open guards closed.** An unreadable `.github/CODEOWNERS` no longer compiles
  the protected surface without its patterns; `assertEngineeringWorkspace` refuses
  with a machine code instead of a raw filesystem error; the recovery ledger
  distinguishes "no ledger" from "ledger unreadable".
- **Recovery ledger** exposes `read()` with `readable`/`problem`, so a corrupt
  ledger cannot masquerade as an empty one.

## Deliberate non-changes (with the reason)

- **`isOwnerAdministrationTarget`** keeps answering `false` for an unparseable URL.
  The error audit recommended fail-closed; the repository's verified contract
  (`tests/unit/credential-boundary.test.ts`) asserts `false` for `""` and
  `"not a url"`, and the predicate *recognises* the Owner's admin surface rather
  than gatekeeping navigation. Changing it would have required weakening an
  existing assertion, which this round forbids. Recorded, not changed.
- **`.boss/tasks/**` has two `TaskLedger` instances** (`store.ts` and `main.ts`).
  Real ownership defect; fixing it changes the state-persistence path that the
  restart acceptance exercises, so it is recorded with its minimal resolution
  rather than changed in a cleanup round.
- **The 31 unreferenced modules** (including the whole `protocols/` subtree) are
  reported, not deleted: several are described as shipped capabilities in
  `docs/`, and deleting a capability is a product decision.

## Remaining work (in plan order)

| Phase | What is left | Why it was not done in this round |
| --- | --- | --- |
| F/G | Continue the extraction group by group: `bootstrap/runtime.ts` (roots + window lifecycle), `persistence.ts`, `providers.ts`, `engineering.ts`, `research.ts`, `knowledge.ts`, `automation.ts`, and the remaining IPC groups behind application services | Started this round with the two cohesive groups that had no cross-dependencies; each further group needs the acceptance chain re-run, and the book caps this phase at "受控拆分 / 不得大重写" |
| H | The audit's remaining must-fix swallowed failures: `main.ts` headless preflight (`updateRun`/`setTaskStatus`), `candidate-supervisor` journal write, `context-manager` restore, `evaluation-store` golden, `verification-engine` corrupt ledger, `final-acceptance-gate` corrupt record, `recovery-engine` corrupt backlog, `candidate-guardian` git-status/package.json, `root-authority/protected-surface-guard` (done), `autonomous-evolution-surface/identity` unreadable files, `repo-manifest` `"unreadable"` hash, `self-evolution-coordinator` evidence persist | Each one changes a failure path that an acceptance gate currently exercises; they are triaged by severity and the highest were fixed first |
| I | `.boss/project-state.json` has two `ProjectStateStore` instances for one workspace; the theme tree is written by `theme-storage` and `theme-service`; `.boss/research/**` mixes a ledger layout (`<id>.json`) with a service layout (`<id>/*`) | Fixing them changes where durable state lives while the acceptance chain reads those exact files; each needs its own verification pass |
| J | The `MIGRATE` items other than the two restored tests: two stale `hardening-matrix` suite names, the permanently-disabled `legacy:v1-audit` acceptance entry, dropping the five delegating containment wrappers | The wrappers are public API imported by tests; the catalog entries are Root-Trust-adjacent data |
| K | 213 unused exports and 886 unused type exports across `electron/**` and `src/**` | Mechanical but wide, with no behaviour impact either way — deliberately deferred rather than rushed |
| M | 13 git wrappers and 3 process runners with inconsistent timeouts/buffers/cwd handling | Consolidating them touches every subsystem; the survivor needs choosing by behaviour, not by looks |
| N | Move build-artifact-dependent suites out of `pnpm test` and declare the layers (`unit`, `integration`, `acceptance`, `desktop`, `migration`, `recovery`, `adversarial`, `soak`) | Changes what `pnpm test` means for CI, so it belongs with Phase O |
| O | Split `.github/workflows/ci.yml` into logical jobs (`quality`, `unit`, `integration`, `acceptance-core`, `acceptance-desktop`, `autonomous-evolution`, `package`) | The file is Root Trust Surface: any edit moves the trust epoch, which requires `scripts/acceptance-evolution-bless.cjs --advance` plus a full re-certification. That is a separate, explicitly sequenced operation, not a cleanup commit |
| P | An actual clean-clone run (clone to a different path → `pnpm install --frozen-lockfile` → `build` → `test` → `run`) | The static checks are asserted; the real clone run was not executed in this round |
| Q | Repo-wide comment sweep for stale claims | Only the modules this round touched were verified |


| Item | Where | Why it is still there |
| --- | --- | --- |
| `main.ts` as composition root | `electron/main.ts` | Phase F; needs its own acceptance cycle |
| IPC handlers with orchestration inline | `electron/main.ts` | Phase G, same reason |
| CI not split into jobs | `.github/workflows/ci.yml` | Root Trust Surface: an epoch migration is a separate, explicitly-sequenced operation |
| 28 must-fix swallowed failures | see the audit list in this round's commit message | each changes a failure path that acceptance currently exercises; triaged by severity, highest fixed first |
| 13 git wrappers / 3 process runners | `electron/**` | Phase M; consolidating them touches every subsystem |
| Research-autopilot workspace writes | `research-conductor.ts` | Phase C route 5; a product decision about resumability |
| `removeCandidateWorkspace` uncalled | `stable-candidate/workspace-manager.ts` | Phase C route 6; Self-Evolution lifecycle behaviour |
| 213 unused exports / 886 unused types | `electron/**`, `src/**` | removing exports is mechanical but wide; no behaviour risk either way, so it is deferred rather than rushed |

## Acceptance

Commands are run from the repository root on the round's final commit; a PASS
below means the command exited 0 in that run and its transcript is under
`artifacts/gate-run/<stamp>/`.

```text
pnpm run typecheck          PASS
pnpm run security:scan      PASS
pnpm run build              PASS
pnpm test                   PASS
full ci.yml sequence        PASS (68/68 steps, including prestart, autonomous
                            evolution and the certificate verifiers)
```

The Windows-native manual steps the book lists (Browse, Cancel, select folder,
invalid path, deleted remembered path, restart) are covered by
`pnpm run acceptance:workspace-paths`, which drives the real Electron renderer
over CDP; the native dialog itself and its Cancel button are modal OS UI and are
reported as NOT_AUTOMATABLE, never as a pass.
