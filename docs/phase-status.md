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
| B — fix the red CI | all failing tests fixed by root cause | **PASS** | `e2759a5`; 21 failures were one production defect (path identity under Windows 8.3 short names); cloud CI run 34740454322 = success |
| C — recovery finalisation | every autonomous mutating route takes a recovery point | **PARTIAL** | `docs/engineering-recovery-audit.md` + `tests/unit/repository-boundary-guards.test.ts`; routes 5/6 deferred with reasons |
| D — one path truth | normalize→validate→resolve→persist, one semantics | **PARTIAL** | containment collapsed 6→1 (`path-utils.isInsideWorkspace`, wrappers delegate); 20+ identity sites moved to `canonicalRealPathSync`; research ingress and remaining duplicate sites listed below |
| E — runtime roots | one root model, no subsystem invents a directory | **PASS** | `runtimeRoots()` in `electron/runtime-paths.ts`; `appDataUnder`/`cacheUnder`/`historyUnder`/`acceptanceUnder`; guard test forbids hand-joined roots |
| F — split `main.ts` | controlled decomposition | **NOT VERIFIED** | deferred: a 1850-line composition root cannot be split and re-certified in this round without a dedicated acceptance cycle |
| G — IPC boundary | handlers validate/call/translate only | **NOT VERIFIED** | deferred with F (same file, same risk) |
| H — error model | no core failure swallowed | **PARTIAL** | 2 fail-open guards fixed (below); 30 must-fix sites audited and listed; 28 deferred with the triage order |
| I — state ownership | one authoritative owner per durable state | **PARTIAL** | audit table below; 4 multi-writer states named, none changed this round |
| J — compatibility debt | every legacy item classified | **PARTIAL** | audit table below (12 KEEP / 4 MIGRATE / 2 DELETE / 3 DEFER) |
| K — dead code | remove provably dead code | **NOT VERIFIED** | 31 unreferenced modules and 213 unused exports identified; none deleted — several are documented product surfaces, so deletion is a product decision, not a cleanup |
| L — dependency rules | shared ↑ domain ↑ services ↑ app/renderer | **PASS** | asserted by `tests/unit/repository-boundary-guards.test.ts` (shared↛electron, renderer↛electron, electron↛renderer, path model↛Electron) |
| M — side-effect boundary | few explicit entries per side effect | **NOT VERIFIED** | audit only: 13 git wrappers + 3 process runners identified, no consolidation attempted |
| N — test architecture | `pnpm test` fast/deterministic, no build-artifact coupling | **NOT VERIFIED** | `tests/unit/closure-terminal-logic.test.ts` still spawns acceptance harnesses that need `dist-electron`; changing it moves the CI ordering contract |
| O — CI structure | split into logical jobs | **NOT VERIFIED** | `.github/workflows/ci.yml` is Root Trust Surface; changing it requires a trust-epoch migration (`scripts/acceptance-evolution-bless.cjs --advance`) and a fresh certificate — deliberately not bundled into this round |
| P — migration readiness | clone elsewhere → install/build/test/run | **PARTIAL** | no hard-coded absolute paths outside test fixtures; the app derives every root from `app.getAppPath()`; a clean-clone run is **NOT VERIFIED** |
| Q — comment/code truth | no stale or plan-number-dependent comments | **PARTIAL** | the modules this round touched carry the rule instead of the plan number; the repo-wide sweep is **NOT VERIFIED** |
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

## Remaining intentional technical debt

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
