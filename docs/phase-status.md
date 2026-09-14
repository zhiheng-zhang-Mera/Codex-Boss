# Convergence round — phase status

> Codex-Boss 当前版本收束与彻底代码清理执行书. This file records what was
> **actually executed and verified** this round, and what was not. Nothing here
> is "expected to pass": an item is PASS only with the command or test that
> proves it, and everything else is explicitly `NOT VERIFIED`.

Baseline: branch `Prestart-checkpoint-4`, Node v24.14.1, pnpm 11.19.0,
Electron 44.0.0, Windows 10.0.26200. The round began from a clean tree at
`e2759a5` and every phase below landed as its own commit on that branch; the
rows marked PASS were re-verified at the round's final commit.

## Verdict per phase

| Phase | What it asks for | Status | Evidence |
| --- | --- | --- | --- |
| A — real baseline | record branch/HEAD/status/toolchain/test counts | **PASS** | this file's header + the round's commit |
| B — fix the red CI | all failing tests fixed by root cause | **PASS** | `e2759a5` and `49af9de`; 21 + 7 failures were two production defects (path identity under Windows 8.3 short names); cloud CI green on both |
| C — recovery finalisation | every autonomous mutating route takes a recovery point | **PASS (with one justified exception, and one harness gap found)** | `docs/engineering-recovery-audit.md` + `tests/unit/repository-boundary-guards.test.ts`; the failed-candidate route now removes its own worktree and branch and reports a cleanup failure; the Owner-driven plan route is justified, not a gap. **Found this round, in the acceptance harness rather than the product**: `scripts/acceptance-evolution-battery.cjs` runs in `IN_PLACE` mode and checks the repository out onto its `boss/evolution/<id>` branch. A *completed* run restores the branch — verified — but an **interrupted** one leaves the repository on that branch, with only a `battery.lock` whose pid is dead. The lock itself is already tolerated (the `alive && !released_at` rule), so the battery does not refuse afterwards; the branch is the residue. It cost a real incident: a commit landed on the evolution branch and `git push origin <branch>` then reported "Everything up-to-date" while pushing a stale local ref |
| D — one path truth | normalize→validate→resolve→persist, one semantics | **PASS** | containment collapsed 6→1; canonical identity at every site that decides a cwd, scope, fingerprint or write target; `canonicalRealPathOrNormalized` is the total form; the research workspace is validated at the IPC boundary |
| E — runtime roots | one root model, no subsystem invents a directory | **PASS** | `runtimeRoots()` in `electron/runtime-paths.ts`; guard test forbids hand-joined roots |
| F — split `main.ts` | controlled decomposition | **PARTIAL** | `electron/bootstrap/` holds `boot-module.ts` (the `BootModule<T>` contract, health reporting at boot, reverse-order disposal) plus **sixteen** extracted slices: `workspace-ipc`, `attachment-ipc`, `conversation-ipc`, `provider-ipc`, `status-ipc`, `engineering-surface-ipc`, `research-ipc`, `host-status-ipc`, `settings-ipc`, `theme-ipc`, `task-lifecycle-ipc`, `research-owner-ipc`, `task-state-ipc`, `research-run-ipc`, `task-creation-ipc` and `dispatch-ipc` — and one **domain** module, `electron/tasks/task-inputs.ts`. `main.ts`: 1884 → … → 1474 → 1442 → **1366 lines**, and the inline handler count is down from 51 to **0**. The composition root still *calls* `ipcMain.handle` — it is the registrar it hands to each module — but it no longer names a channel, and `tests/unit/repository-boundary-guards.test.ts` now asserts exactly that, so a new inline handler is caught even if nobody adds it to the channel list. The input rules both creation paths share live in the domain module because both callers need them; they take their store lookups as an argument, so they are testable without a composition root, and the attachment store is a *property* rather than a lookup function, because "no store attached" must stay distinguishable from "no path for this ref". What remains of Phase F is the `bootstrap/{runtime,persistence,providers,engineering,knowledge,automation}.ts` grouping the plan names — services and window lifecycle rather than IPC |
| G — IPC boundary | handlers validate/call/translate only | **PASS for the IPC boundary** | **92 channels across the sixteen modules** are `validate → service → publish`, none of them registered inline: `main.ts` contains **no** `ipcMain.handle("<channel>"` at all, and a guard asserts it. The boot modules take a narrow service surface instead of reaching into the composition root, and guards forbid Electron imports, fs/git/process work there, and any second route to the goal runner. Each module states its dependency surface rather than re-declaring it: `ThemeSurface` derives from the real `ThemeService` with `Pick`, several modules derive their record types from the functions that consume them, and `dispatch-ipc` derives its escalation decision from `decideEscalation` — a hand-written version had made `requiredCapabilities` optional, which is looser than the decision is and broke the staged transition consuming it. Where the surface is wide it is wide by necessity and says so: driving a task really does touch the store, commander, automation and recovery scheduler, and every such method is typed to the **real** return (`unknown` for results only ever asked about by truthiness). Real defects found along the way: `boss:update-role-route` took an **untyped** role; a duplicated theme id could have escaped the `custom-` namespace; `ResearchContractStore` uses a **directory per run**, one of the mixed layouts under `.boss/research/**` that Phase I lists; and `main.ts` re-exported `assertDispatchGroupSize` "for callers that already import from the bridge" when **no caller did**. Moving the dispatch route also moved an entry in the Owner-intervention route table: `src/shared/owner-intervention.ts` declares where each escalation route lives, and the OI-10 acceptance scenario fails if a declared marker is no longer in its declared file — which is exactly what happened when `workEscalationVerdict` left the composition root. The declaration was updated to follow the code, which is a **Root Trust Surface** change, so it carried **epoch 14** (`boss-root-trust-14`) with it |
| H — error model | no core failure swallowed | **PARTIAL** | every fail-open guard closed (unreadable CODEOWNERS, `assertEngineeringWorkspace`, the recovery ledger, the research ledger's damaged runs, the event bus's dropped handler rejections, `replaceGoal`'s archive, the two lost durable records in `main.ts`); the audit's remaining must-fix sites are listed below |
| I — state ownership | one authoritative owner per durable state | **PARTIAL** | `.boss/tasks/**` now has ONE `TaskLedger` (the store and the commander share the composition root's instance, so their read-modify-write cycles stop failing each other); `.boss/project-state.json`, the theme tree and `.boss/research/**` remain multi-writer and are listed below |
| J — compatibility debt | every legacy item classified | **PARTIAL** | 2 provably dead files deleted; 2 quarantined test files covering LIVE code restored into `tests/` (15 tests); the rest classified in this file and in the round's audit |
| K — dead code | remove provably dead code | **PARTIAL** | the 31 "unreferenced" modules are documented product surfaces (`docs/9-4-*.md`, `docs/9-5-*.md`, …) with quarantined tests, so deleting them is a product decision, not cleanup — recorded, not deleted |
| L — dependency rules | shared ↑ domain ↑ services ↑ app/renderer | **PASS** | asserted by `tests/unit/repository-boundary-guards.test.ts` |
| M — side-effect boundary | few explicit entries per side effect | **PASS for git; PARTIAL for process** | `electron/git/git-gateway.ts` is the single entry for git: `runGit`/`runGitSync` never throw and return `{stdout, stderr, code, ok, spawnError}`, with explicit timeout/buffer bands. `spawnError` was added this round because the sites being migrated distinguish "git said no" from "git never ran", and an empty stderr cannot tell those apart. **Seventeen modules moved onto it**: `engineering/{git-checkpoint, soak-runner, world-model, candidate-guardian, release-runner, native-tools}`, `host/{host-probes, doctor, sentinel-capture}`, `self-evolution/{self-target-resolver, self-evolution-host, self-evolution-coordinator}`, `repro-snapshot`, `root-recovery/rollback-controller`, `stable-candidate/workspace-manager`, `input/github-resolver` and `promotion-gate/github-promotion-adapter` — and three of those (`host-probes`, `doctor`, `sentinel-capture`) had been running `execFileSync` with **no timeout at all**, so an unbounded wait in a diagnostic path is now a bounded one that reports `unknown`. Two of the migrations needed the gateway to grow first: `gitBinary` (a caller with its own executable) and `env` (a credential handed to git through `GIT_CONFIG_*`, never argv), and both new options have their own tests. The guard is **repo-wide**: any new direct git spawn anywhere under `electron/**` fails `tests/unit/git-gateway.test.ts` unless it is in a declared debt list, and a second test fails when a listed file no longer spawns git, so the list cannot rot. **Twenty modules now route through it and the declared debt list is EMPTY** — the last three were `engineering/{acceptance-session, autonomous-evolution-identity, autonomous-evolution-runner}`, which are Root Trust Surface, so their move was an epoch-carrying change: `scripts/acceptance-evolution-bless.cjs --advance` established **epoch 13 (`boss-root-trust-13`)** over the new surface in the same commit, and the chain re-certified it (cloud run [34777953012](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/34777953012), local `verify:certificate` PASS). Five of the twenty had been running git with **no timeout at all** (`host-probes`, `doctor`, `sentinel-capture`, `acceptance-session`, `autonomous-evolution-identity`), so unbounded waits in diagnostic and session-bookkeeping paths are now bounded and report an unreadable repository as one. Two migrations needed the gateway to grow first: `gitBinary` (a caller with its own executable) and `env` (a credential handed to git through `GIT_CONFIG_*`, never argv), and both new options have their own tests. The guard is **repo-wide**: any direct git spawn anywhere under `electron/**` fails `tests/unit/git-gateway.test.ts`, and a second test fails when a listed file no longer spawns git, so the (now empty) list cannot rot. What is **not** done is the other half of the phase: process runners other than git (the verification engine's and the research runtime's) still choose their own timeouts and error conventions |
| N — test architecture | `pnpm test` fast/deterministic, no build-artifact coupling | **PASS for the build coupling; PARTIAL overall** | **Four declared tiers**, listed in one place (`vitest.tiers.mjs`) so the configurations cannot drift: `vitest.config.mjs` (everything — kept complete because an explicitly named file that a config excludes makes vitest exit 1, "No test files found", which silently disabled the review gate until the acceptance chain caught it), `vitest.unit.config.mjs` (`pnpm test`), `vitest.slow.config.mjs` (`test:slow`) and `vitest.postbuild.config.mjs` (`test:postbuild`). The build coupling is **resolved and measured in both directions**: with `dist/` and `dist-electron/` renamed away `pnpm test` passes 159 files / 1780 tests and exits 0, while `test:postbuild` fails 2 tests and exits 1 — so the suites that read real build output still genuinely need it, they are simply no longer inside the tier a clean checkout is expected to run. The coupling was `A-05`, `EV-15` and two closure-harness cases. Three tiers now exist: `pnpm test` runs 162 files / 1759 tests through `vitest.unit.config.mjs`, and `pnpm run test:slow` runs the suites that compile and execute real projects (`tests/acceptance/review-loop.test.ts`, ~28s alone) one file at a time with a measured ceiling — that suite had turned three green commits red under full-suite parallelism. A claim recorded earlier in this round — that the two heavy suites *conflict* with each other and therefore need one process each — was **wrong and is corrected here**: measured together in a single clean invocation they pass 25/25 in 116.6s, and the wholesale failure (CONTROL case included) that prompted the split was caused by 83 stale `codexbossevolution-rt-sandbox*` AppContainer profiles left behind by interrupted evolution-battery runs; clearing them restored the suite. `pnpm run test:slow` is therefore one invocation again — the slow config already serialises the files itself. The measured facts now in `vitest.tiers.mjs`: `review-loop.test.ts` is ~113s as a file and its slowest scenario (C-03) is ~29s alone but crossed the 60s default per-test ceiling under parallelism; `evolution-sandbox.test.ts` is ~45s; and a passing sandbox run still leaves one profile behind (2 → 3), so the pileup is a cleanup leak worth fixing rather than a property of the tier. The list lives in `vitest.tiers.mjs` so the three configurations cannot drift, and `vitest.config.mjs` stays complete because an explicitly named file that a config excludes makes vitest exit 1 ("No test files found") — which silently disabled the review gate until the acceptance chain caught it. Still open: `pnpm run typecheck` covers `src/renderer`, `src/shared` and `electron/**` but **not `tests/**`**, so a stale identifier in a test only fails at runtime — which is exactly how a `ReferenceError: main is not defined` survived in `tests/unit/repository-boundary-guards.test.ts` until it ran. `tsconfig.tests.json` + `pnpm run typecheck:tests` now exist as the target project, deliberately **not wired into `typecheck` or CI until it is clean** — running it today is a truthful report of remaining work, not a gate. Baseline **103 errors**, now **69** after two rounds: 5 from `allowJs` (so the `.mjs` harness imports are inferred rather than `any`), 3 from this repository's own bootstrap tests, and 26 from four more files this round. What the check has found so far is a list of tests that were **not testing what they appeared to**:
— `SessionLifecycle` has no `AUTHENTICATED` and `InputObjectKind` has no `WORKBOOK`, so two fixtures passed invalid values;
— an `escalateDecisionFor` test asserted only `toHaveProperty("escalate")`, which passes whatever the answer is (it now asserts both directions);
— `engineering-recovery` read `outcome.ok`, which only exists once `attempted` is true, so a narrowing helper now fails with the code and reason when no rollback was attempted;
— `context-knowledge-section` passed `"executor"` as a `RoleId`, which is not one of the seven;
— `multi-fault-isolation` and `phase-j-scenarios` passed **role names** (`"planner"`) where the runtime capability set holds gerunds (`"planning"`) — production is self-consistent here, the tests were the outliers — and used `"SESSION_EXPIRED"`, which is not a `RuntimeAvailability`;
— and `multi-fault-isolation`'s scripted runtime called its script thunks with **no arguments**, so `technicalFailure(runtimeId, jobId)` had been producing results whose `runtimeId` and `jobId` were `undefined`.
Remaining: 57 in `tests/unit/**` and **12 in `tests/acceptance/**`** — the latter is Root Trust Surface, so that batch carries its own epoch advance. The rule for every fix is that the suite must still pass afterwards, so a cast that silences an error without correcting the fixture is not a fix. Closing the gap is therefore real work, not a config line, and it is **not** purely mechanical: at `tests/acceptance/autonomous-evolution-adversarial.test.ts:488` the fixture is `const decoy = "\uff53ession.json"` — a deliberate Unicode-confusable filename — so `decoy !== "session.json"` is reported as TS2367 ("no overlap") precisely because the two are different, which is the property the test exists to assert. An over-eager sweep would "fix" that assertion and delete the adversarial case |
| O — CI structure | split into logical jobs | **PASS** | `.github/workflows/ci.yml` is four jobs ordered by `needs:` — `quality` (typecheck + secret scan), `unit` (build + both test tiers), `acceptance` (the whole attested chain), `package` (portable build + smoke). Verified in the cloud: all four ran and passed independently ([run 34760152895](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/34760152895)). The acceptance chain stays one job on purpose — it reads and writes `artifacts/acceptance/**` in one working tree, so splitting it would make attestation depend on artifact plumbing. Changing this file moved the Root Trust Surface (52 files, aggregate `6ec8ba30…`); **epoch 11** was established over it with `scripts/acceptance-evolution-bless.cjs --advance` (parent `cd07f51e`) and committed with the change, as the plan requires |
| P — migration readiness | clone elsewhere → install/build/test/run | **PARTIAL** | asserted: no tracked source file hard-codes an absolute path naming this machine's profile or this repository's folder, and every durable root is derived from `app.getAppPath()` at run time; an actual clean-clone run is **NOT VERIFIED** |
| Q — comment/code truth | no stale or plan-number-dependent comments | **PARTIAL** | the modules this round touched explain the rule instead of a plan number; the repo-wide sweep is **NOT VERIFIED**. One real defect surfaced while checking a comment: `electron/ingestion/docx-reader.ts` had lost text to a UTF-8-bytes-read-as-GBK round trip, and in that file it reached **code, not prose**. Its list-marker regex had lost the bullet glyph *and* the closing bracket of its character class, silently reducing `[-*+•]|\[[ xX]\]|\d+[.)]` to the numbered forms only, so Word dash/star/plus/bullet lines and both checkbox forms were ingested as ordinary prose. Recovered with the exact inverse transform (GBK-encode the mojibake run, decode those bytes as strict UTF-8), repaired, and pinned by three new tests that fail against the pre-fix literal (7 of their 9 markers do not match it). The same corruption had also reached comment text in two more files. **That is now repaired**: `electron/theme/theme-knowledge.ts` (7 sites) and `electron/self-evolution/sandbox/windows-appcontainer-backend.ts` (7 sites). The two classes were treated differently and deliberately — where the mojibake was **byte-proven** (`搂`→`§`, recovered exactly by the inverse transform) the original character was restored; where it was **lossy** (`鈥`/`鈫`/`閳` had each lost a byte to a `?`) the original cannot be recovered from the bytes, so it was restored from context, which is unambiguous — every one of those sites sits where an em dash belongs, and the single one inside a code span became ASCII dots so it cannot recur. One site was neither: a parenthetical that had lost a section marker nobody can now know, rewritten as `(see Update-Plan/Alien-Prestart.md)` rather than inventing a reference. A scan for the recorded artifact code points across every tracked source and markdown file now finds them only here, quoted, in this paragraph |
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
- **One git entry, and the migration is now enforced.** `electron/git/git-gateway.ts` is
  the single place a git process is started: `runGit`/`runGitSync` never throw, return
  `{stdout, stderr, code, ok, spawnError}`, and take explicit timeout/buffer bands.
  `electron/engineering/{change-points, workspace, live-engineering-operations,
  git-checkpoint, soak-runner, world-model, candidate-guardian, release-runner,
  native-tools}`, `electron/host/{host-probes, doctor, sentinel-capture}`,
  `electron/self-evolution/{self-target-resolver, self-evolution-host,
  self-evolution-coordinator}`, `electron/repro-snapshot.ts`,
  `electron/root-recovery/rollback-controller.ts`,
  `electron/stable-candidate/workspace-manager.ts`,
  `electron/input/github-resolver.ts`,
  `electron/promotion-gate/github-promotion-adapter.ts` and
  `electron/engineering/{acceptance-session, autonomous-evolution-identity,
  autonomous-evolution-runner}.ts` all route through it. The guard test walks every
  `.ts` file under `electron/` and fails a direct git spawn that is not in the declared
  debt list — which is now empty; a companion test fails when a listed file no longer
  spawns git, so the list cannot rot in either direction.
- **A corrupted regex repaired.** `electron/ingestion/docx-reader.ts` had lost the
  bullet glyph and the closing bracket of the list-marker character class to an
  encoding round trip, so `[-*+•]|\[[ xX]\]|\d+[.)]` matched only `1.`/`1)`. The
  literal was recovered by the exact inverse transform and is now covered by tests
  for all nine markers plus the two negatives (middle dot, plain prose).
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
| M | The process-runner half of the phase: non-git process runners (`engineering/verification-engine`, `research/runtime/process-runner`, `software/media-adapters`, `computer/backends/*`) each choose their own timeouts and result shapes | The git half is complete and every git call site is behind one entry point; the process half is a wider set of call sites with genuinely different contracts, so it needs the same measured treatment the git half got rather than a sweep |
| Q | The repo-wide sweep for stale claims outside the modules this round touched | The encoding corruption that surfaced during that sweep is now repaired in both files; the remaining question is whether other comments still describe behaviour that has since changed, which needs reading rather than scanning |
| N | Move build-artifact-dependent suites out of `pnpm test`, declare the layers (`unit`, `integration`, `acceptance`, `desktop`, `migration`, `recovery`, `adversarial`, `soak`), bring `tests/**` under `pnpm run typecheck` (100 errors measured) | The first two change what `pnpm test` means and where a suite lives; the third is real work with at least one intentional TS2367 that must be preserved rather than silenced |
| O | Split `.github/workflows/ci.yml` into logical jobs (`quality`, `unit`, `integration`, `acceptance-core`, `acceptance-desktop`, `autonomous-evolution`, `package`) | The file is Root Trust Surface: any edit moves the trust epoch, which requires `scripts/acceptance-evolution-bless.cjs --advance` plus a full re-certification. That is a separate, explicitly sequenced operation, not a cleanup commit |
| P | An actual clean-clone run (clone to a different path → `pnpm install --frozen-lockfile` → `build` → `test` → `run`) | The static checks are asserted; the real clone run was not executed in this round |
| Q | Repo-wide comment sweep for stale claims | Only the modules this round touched were verified |


| Item | Where | Why it is still there |
| --- | --- | --- |
| `main.ts` as composition root | `electron/main.ts` | Phase F; needs its own acceptance cycle |
| IPC handlers with orchestration inline | `electron/main.ts` | Phase G, same reason |
| Repo-wide comment sweep | `electron/**`, `src/**` | Phase Q; the encoding corruption found during it is repaired, but "does this comment still describe the code" needs reading, not scanning |
| 28 must-fix swallowed failures | see the audit list in this round's commit message | each changes a failure path that acceptance currently exercises; triaged by severity, highest fixed first |
| 0 files spawning git directly / several process runners | `electron/**` | Phase M's git half is complete: twenty modules use the gateway, the declared debt list is empty and the rule is enforced repo-wide at epoch 13. The process-runner half is untouched |
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
pnpm test                   PASS (and passes with the build removed, which is the
                            point of the tier split)
pnpm run test:postbuild     PASS (and fails with the build removed, as it must)
full ci.yml sequence        PASS (70/70 steps, including prestart, autonomous
                            evolution and the certificate verifiers)
```

The Windows-native manual steps the book lists (Browse, Cancel, select folder,
invalid path, deleted remembered path, restart) are covered by
`pnpm run acceptance:workspace-paths`, which drives the real Electron renderer
over CDP; the native dialog itself and its Cancel button are modal OS UI and are
reported as NOT_AUTOMATABLE, never as a pass.
