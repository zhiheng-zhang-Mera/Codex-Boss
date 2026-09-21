# RUNTIME INTELLIGENCE — INTEGRATION REPORT

**Stage:** Pre-City Integration RC, stage 1 (Runtime Intelligence).
**Integration branch:** `integration/pre-city-baseline`.
**Base:** `origin/main` = `4da0ed079c3a59362bc92b15091f7907ef064de7` (`PRE_CITY_START_MAIN_SHA`).
**Merge commit:** `432f859` — *integrate(runtime-intelligence): the mature RI plane and the RC1 installer,
from the alien2 line*.
**State after this stage:** all local gates green (§6). CI re-run on the final RC HEAD (§7).

---

## 1. Source branches examined

Six branches were in scope. Every one was classified by reading its real commit graph and diff — never by
its name. Full detail in `BRANCH_CENSUS.md` §3.

| Branch | tip | ahead/behind vs its merge-base | files | CI at tip | Verdict |
|---|---|---|---|---|---|
| `candidate/alien2-real-work-v1` | `05d63b5` | 7 / 3 | 75 | success | **SELECTED** |
| `dev/alien2-runtime-intelligence` | `ecae925` | 26 / 13 | 69 | success | already contained in the selected commit |
| `dev/ri-04-live-capture` | `8929f04` | 4 / 7 | 70 | success | superseded |
| `dev/ri-03-prospective` | `0df1487` | 3 / 7 | 66 | success | superseded (stack ancestor of `ri-04`) |
| `dev/ri-02-evaluation` | `02fa484` | 2 / 7 | 59 | success | superseded (stack ancestor of `ri-04`) |
| `dev/ri-01-core` | `90f3c7f` | 1 / 7 | 30 | success | superseded (stack ancestor of `ri-04`) |

### 1.1 The `ri-01 → ri-04` chain is a real stack, so it was not merged member by member

```
git rev-list --count origin/dev/ri-04-live-capture..origin/dev/ri-01-core        =>  0
git rev-list --count origin/dev/ri-04-live-capture..origin/dev/ri-02-evaluation  =>  0
git rev-list --count origin/dev/ri-04-live-capture..origin/dev/ri-03-prospective =>  0
```

`ri-01`, `ri-02` and `ri-03` are strict ancestors of `ri-04`. Merging all four, as the task forbids, would
have produced three merge commits carrying **zero** additional content and three opportunities to
mis-resolve a shared file. They were not merged.

### 1.2 Why the selected branch is the candidate, and why that is *not* just "it is newer"

Two independent, measured facts:

**(a) The candidate fully contains the alien2 RI line.**

```
git rev-list --count origin/candidate/alien2-real-work-v1..origin/dev/alien2-runtime-intelligence  =>  0
git rev-list --count origin/dev/alien2-runtime-intelligence..origin/candidate/alien2-real-work-v1  =>  7
```

`dev/alien2-runtime-intelligence` is a **strict ancestor**. It adds nothing. (The naive reading of its
`26 ahead / 13 behind` against `main` is misleading: those counts are against `main`'s fork point
`2129576`, not against the candidate.)

**(b) The candidate's RI subtree is object-identical to the mature alien2 RI subtree — not a re-implementation.**

```
git ls-tree -r origin/dev/alien2-runtime-intelligence -- src/shared/runtime-intelligence electron/runtime-intelligence
git ls-tree -r origin/candidate/alien2-real-work-v1   -- src/shared/runtime-intelligence electron/runtime-intelligence
=> TREE OBJECT IDENTICAL: candidate RI == dev/alien2 RI (same blobs)      [33/33 files]
```

This is the finding that decides the question the task asked: *does the candidate actually carry the mature
Runtime Intelligence, or a thinner parallel rewrite?* It carries the mature one — the same blobs — and the
`ri-01..ri-04` series is a **disjoint** history that rebuilds the same capability with different SHAs:

```
git rev-list --count origin/candidate/alien2-real-work-v1..origin/dev/ri-04-live-capture  =>  4
git rev-list --count origin/dev/ri-04-live-capture..origin/candidate/alien2-real-work-v1   =>  7
```

Neither contains the other. The tie is broken by content: same RI, **plus** the packaging work, which
`ri-04` does not have. So `ri-04` is `SUPERSEDED` — its capability is represented — rather than `EXCLUDE`.

### 1.3 The Owner's stated hypothesis, re-proved

The Owner's prior was that `candidate/alien2-real-work-v1` should be the final candidate because its latest
`Desktop CI` was `success` and it carried both Runtime Intelligence and real runtime/installer work.
Re-measured here: `gh run list --branch candidate/alien2-real-work-v1 --limit 1` → `success` at `05d63b5`.
**Confirmed.** The re-proof added §1.2(a) and §1.2(b), which the hypothesis did not claim and which make the
choice robust rather than lucky.

---

## 2. Selected commits

Merged with `git merge --no-ff`, preserving the branch's own topology rather than replaying it as new SHAs.
7 commits, all from `candidate/alien2-real-work-v1`, all with `7315f78` as their root — a commit that is an
ancestor of `main`, so this is a clean divergence, not a rebase over unrelated history.

| # | SHA | Subject | Area |
|---|---|---|---|
| 1 | `6836558` | runtime-intelligence: the advisory core (RI-01) | RI |
| 2 | `9581568` | runtime-intelligence: offline evaluation (RI-02) | RI |
| 3 | `2070f9c` | runtime-intelligence: the prospective window and the policy freeze (RI-03) | RI |
| 4 | `8688cb9` | runtime-intelligence: live shadow capture on the existing seams (RI-04) | RI |
| 5 | `b6892a4` | fix(deploy): a packaged build keeps its data out of the install directory | installer |
| 6 | `945c278` | feat(deploy): a thin RC1 Windows installer over the portable package | installer |
| 7 | `05d63b5` | fix(deploy): the published manifests carry no builder-absolute paths | installer |

Commits 5–7 are the RC1 installer line. They are part of the same branch and are integrated with it; they
are reported here because they are part of this merge, and they are covered by the Installer/Bootstrap
capability in `CAPABILITY_INVENTORY.md`.

### 2.1 What arrived (75 files, 21 968 insertions, 10 deletions)

* `src/shared/runtime-intelligence/` — 29 modules: `contracts`, `scheduling-advisor`, `model-ledger`,
  `skill-loadout`, `continuation-evaluator`, `continuation-benchmark`, `scheduler-benchmark`,
  `node-profile`, `calibration`, `measurement`, `outcome-ingestion`, `telemetry`, `context-lifecycle`,
  `context-contribution`, `dispatch-attribution`, `step-completion`, `snapshot-retention`,
  `policy-registry`, `prospective-window`, `temporal-guard`, `replay-corpus`, `live-capture`,
  `evaluation-report`.
* `electron/runtime-intelligence/` — 9 main-process modules: `runtime-intelligence-service`,
  `intelligence-store`, `live-capture`, `node-profiler`, `node-telemetry-log`, `outcome-source`,
  `prospective-store`, `replay-cases`, `replay-corpus-io`.
* `scripts/runtime-intelligence-report.cjs`, `scripts/runtime-intelligence-diff-guard.cjs`.
* `docs/runtime-intelligence-plane.md` (1177 lines).
* 29 test files under `tests/unit/runtime-intelligence/` (plus `authority-boundary.test.ts` and
  `policy-freeze.test.ts`).
* `installer/windows/Installer.cs`, `installer/windows/installer.manifest`,
  `scripts/package-installer.cjs`, and the `package:installer` script.

### 2.2 Integration mechanics

`git merge-tree --write-tree --name-only origin/main origin/candidate/alien2-real-work-v1` returned a clean
tree **before** the merge was attempted, so the merge was known conflict-free in advance. The merge then
reported exactly one auto-merged file and no conflict.

**`--no-ff` was used deliberately.** A fast-forward was impossible (`main` had moved on), and a rebase was
rejected: it would have rewritten the candidate's 7 published SHAs, discarding the CI run that actually
validated those commits. `--no-ff` keeps the evidence attached to the SHAs that earned it.

---

## 3. Discarded / superseded commits

| Source | Commits | Why not taken |
|---|---|---|
| `dev/ri-01-core` | `90f3c7f` | Strict ancestor of `ri-04`; contained. |
| `dev/ri-02-evaluation` | `02fa484` | Strict ancestor of `ri-04`; contained. |
| `dev/ri-03-prospective` | `0df1487` | Strict ancestor of `ri-04`; contained. |
| `dev/ri-04-live-capture` | `8929f04` | Disjoint rebuild of the same capability; no installer work; superseded by the selected line. |
| `dev/alien2-runtime-intelligence` | 26 commits, incl. `ecae925`, `45670bf`, `c24d8c1`, `8b25f6a`, `5e1b051`, `627dbf9`, `2f53cf7`, `8096bd2`, `0bdca0f`, `2e24327`, `becef36`, `22b36f2`, `8e01485`, `2d26b8b`, `66d9c8b`, `0dc23b4`, `677b1db`, `5df5e36`, `0836161`, `7d89790`, `3591d3d`, `2dd722b`, `ff1b52e`, `0046971`, `e3601a7` | **Not discarded — contained.** The candidate is a descendant, so every one of these commits is reachable from the merge. The task asked whether any *valuable logic* in this branch is not covered by what comes after; the blob-identity check in §1.2(b) answers it directly: the RI trees are the same 33 objects, so there is no uncovered logic. Three of these are merge commits pulling in `origin/main` (`3591d3d`→`2129576`, `2dd722b`→`b999339`, `ff1b52e`→`9d698c0`); their main-side content was already on `main` and is therefore not a reason to merge this branch. |

Nothing was discarded on the basis of a subject line. Each row is backed by an ancestry count or the
blob-identity comparison.

---

## 4. Conflicts and resolution rationale

**Conflicts encountered: none.** The auto-merge reported no conflict markers, and the pre-merge
`merge-tree` preview was already clean.

Absence of textual conflict is not evidence of correctness, so the three files the task singled out were
checked **semantically** — the merge was not accepted merely because git did not complain.

### 4.1 `config/capability-modules.json`

Auto-merged. Verified by diffing the merge result against `origin/main`; the diff is **purely additive** and
contains only the two Runtime Intelligence entries:

```diff
@@ -275,6 +275,7 @@
     "tenx": [
       "electron/commander",
       "electron/fleet",
+      "electron/runtime-intelligence",
       "electron/tenx",
@@ -285,6 +286,7 @@
       "src/shared/node-capabilities.ts",
       "src/shared/optional-review.ts",
       "src/shared/resource-model.ts",
+      "src/shared/runtime-intelligence",
       "src/shared/tenx/contracts.ts",
```

`main` had itself edited this file after the fork point (`git diff --stat 0a1bce7f..origin/main` shows
`1 +`). That change **survives**: the diff against `origin/main` contains only the `+` lines above. Had the
merge taken "ours", the RI registration would be missing; had it taken "theirs", main's later line would be
gone. It did neither.

### 4.2 `config/test-catalogue.json`

`main` had modified this file after the fork point (`7c718aa` retired the 100k durable-event case to a
`REAL_HOST_SCALE` tier). The merge result differs from `origin/main` by **206 insertions and 0 deletions**,
and `REAL_HOST_SCALE` is still present at line 1089. Neither side was taken wholesale.

### 4.3 `electron/main.ts`

Not modified by `main` after the fork point, so the candidate's version applies cleanly. Two changes:

1. A packaged build now resolves a **per-user** data root (`LOCALAPPDATA\Codex-Boss`) instead of owning
   user data inside its own install directory, with a guard so the legacy migration can never copy a root
   onto itself. This is a real data-loss fix: the installer replaces its directory on upgrade.
2. The persistence module's live capture is handed to the automation module as the **same instance**, so
   checkpoint evidence and bus evidence land in one window with one set of counters.

Both were checked for interaction with `main`'s later work: `main` touched neither `electron/main.ts` nor
`electron/runtime-paths.ts` after the fork point, so there is no newer fix being overwritten.

### 4.4 Trust / qualification surfaces

Checked explicitly and reported per §8. The merge touches **none** of them:

```
git diff --cached --name-only origin/main | Select-String \
  -Pattern 'trust-policy|\.github/workflows|tests/acceptance|promotion|credential'
=> (no output)
```

Concretely: no `trust-policy/`, no `credential-boundary/`, no `promotion-gate/`, no
`tests/acceptance/**`, no `.github/workflows/**`, no required-check declaration, no trust-epoch anchor, and
no qualification-semantics file. Root Trust Surface membership was taken from the repository's own
declaration (`src/shared/autonomous-evolution-trust.ts` `ROOT_TRUST_SURFACE_PATHS`), not from a guess.
Because nothing in that set changed, **no trust-epoch advance and no blessing was required or performed**
for this stage.

### 4.5 Installer / runtime-path applicability to current main

The task asked whether the installer and runtime-path changes still apply to the latest `main`.
Verified rather than assumed: `main`'s post-fork changes are confined to `src/shared/promotion-checks.ts`,
`docs/root-trust-authority-model.md`, `config/capability-modules.json`, `config/test-catalogue.json` and
the `real-host-scale` tier plumbing. None of those overlap `electron/main.ts`, `electron/runtime-paths.ts`,
`installer/windows/**` or `scripts/package-installer.cjs`. The changes apply unchanged, and the `build` and
`package` gates (§6) exercise the result.

### 4.6 Root Trust Surface, qualification semantics, and stale main fixes

* **Root Trust Surface modified?** No (§4.4).
* **Qualification semantics modified?** No. No file under `tests/acceptance/**`, `trust-policy/**` or any
  qualification producer is touched.
* **Does it overwrite a newer `main` fix?** No. For every shared file, the merge diff against `origin/main`
  was inspected and is additive; the two files `main` had edited after the fork point retain those edits.
* **Does it introduce an outdated platform/trust change?** No trust or platform change arrives at all.

---

## 5. Excluded work, and why

* **`dev/ri-01-core` … `dev/ri-04-live-capture`** — same capability, disjoint history, no installer work,
  superseded by the selected line (§1.2). Not merged. Branches retained.
* **`feat/pf020-identity-convergence`** — out of scope for this stage and separately classified
  `BLOCKED_BY_QUALIFICATION`. See `BRANCH_CENSUS.md` §5. **NOT MERGED BY DESIGN.**
* **No branch was deleted, and no existing branch was modified.** This round is not branch cleanup.

---

## 6. Tests and local verification

Run on the integration branch at `432f859` (the RI stage tip, i.e. **before** the Self-\* merge), on this
host, with `pnpm 11.19.0` (the version `ci.yml` pins) and Node 24.

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | PASS — `resolved 162, reused 162, added 162` |
| Typecheck | `pnpm run typecheck` | PASS (exit 0) — all three tsconfigs |
| Security scan | `pnpm run security:scan` | PASS — `TRACKED_SECRET_SCAN=PASS files=1256` |
| Architecture ratchet | `pnpm run architecture:ratchet` | PASS — `violations: []`, 27 capabilities, 32 namespaces |
| State probe | `pnpm run state:probe` | PASS — SQLite substrate probe, all checks `ok: true` |
| Build | `pnpm run build` | PASS (exit 0) — `tsc` ×2 + `vite build` + `tsc -p tsconfig.electron.json` |
| Test catalogue | `pnpm run test:catalogue:check` | PASS — `test catalogue is current: 265 suites` |
| Unit tier | `pnpm test` | **PASS — 249 files, 3166 tests, 0 failures** (216 s) |
| Post-build tier | `pnpm run test:postbuild` | **PASS — 8 files, 119 tests, 0 failures** (59 s) |
| Slow tier | `pnpm run test:slow` | **PASS — 4 files, 35 tests, 0 failures** (195 s) |
| Architecture snapshot | `pnpm run architecture:snapshot` | PASS (exit 0) |
| **RI-specific suite** | `vitest run tests/unit/runtime-intelligence` | **PASS — 29 files, 607 tests, 0 failures** (8.5 s) |

The RI-specific run is the dedicated check the task requires. 607 tests across all 29 RI suites pass,
including `authority-boundary.test.ts`, `policy-freeze.test.ts`, `live-capture.test.ts`,
`prospective-window.test.ts`, `replay-corpus-io.test.ts` and `service.test.ts`.

Gate ordering note: `build` was run **before** the unit/postbuild tiers, matching the real `ci.yml`
(`unit` job runs `install:electron` → `build` → `architecture:snapshot` → `pnpm test` → `test:postbuild` →
`test:slow`). The build-dependent harnesses `require` `dist-electron` at load time, so the order matters and
the real order was followed.

---

## 7. CI result

`candidate/alien2-real-work-v1` at `05d63b5`: `Desktop CI` **success** (re-queried via
`gh run list --branch candidate/alien2-real-work-v1`, not recalled).

**This is not offered as the integration CI result.** Per the task, a green CI on some other branch does not
substitute for the integration branch's own CI. The integration branch cannot run CI until it is pushed, so
its `Desktop CI` result is recorded in `PRE_CITY_FREEZE_MANIFEST.json` and
`PRE_CITY_FINAL_REPORT.md`, against the final RC HEAD, after the push in the final stage. If any run for the
RC fails, it is diagnosed and repaired there rather than explained away here.

---

## 8. Remaining limitations

Stated honestly; none of these is a green claim.

1. **RI is advisory by construction, and that was verified, not assumed.** The suite includes
   `authority-boundary.test.ts`, which asserts the plane cannot change or authorize anything. The
   integration therefore adds observation and advisory surfaces, **not** new authority. This is the
   intended pre-city posture and is recorded as such in `CITY_CLASSIFICATION.md`.
2. **Live host telemetry is host-dependent.** `node-profiler` and `node-telemetry-log` measure the real
   host; the postbuild soak output in this run shows
   `trendWithinLongRunAllowance=false generatorStatus=1 accepted=false` for a short run, which the module
   itself reports as *not* proof of bounded growth. That is the module's own honest behaviour, consistent
   with §9's ban on substituting a short run for a long soak. **The long-run/soak dimension stays
   `NOT_RUN` / host-dependent** and is not claimed.
3. **The installer was integrated but not executed end-to-end on a clean Windows VM.** `Installer.cs` and
   `scripts/package-installer.cjs` are integrated and typecheck/build; the CI `package` job exercises
   `package:portable` + `smoke-portable.ps1`, which is the portable package, not a full installer
   install/upgrade/uninstall cycle on a fresh machine. Recorded as an open external validation item.
4. **Two RI module specifiers are registered under the `tenx` capability** in
   `config/capability-modules.json` (`electron/runtime-intelligence`, `src/shared/runtime-intelligence`).
   That is how the source declares the ownership, and it was preserved rather than "corrected" — but it is a
   genuine capability-boundary finding, recorded in `STRUCTURAL_HEALTH_BASELINE.md` under
   `OVERLARGE_CAPABILITY` / `HIDDEN_COUPLING` rather than silently re-homed during an integration round.
5. **`docs/runtime-intelligence-plane.md` is 1177 lines of design prose that no test asserts against.** It
   is documentation, not an executable contract; drift between it and the code is not mechanically caught.
6. **No real-host qualification, machine credential or external provider acceptance was performed or
   claimed.** Those require a qualification host and are `BLOCKED_EXTERNAL` / `NOT_RUN` by design (§9).

---

## 9. Stage verdict

**PASS.** The mature Runtime Intelligence plane and the RC1 installer are integrated into
`integration/pre-city-baseline` at `432f859`, with zero conflicts, zero Root Trust Surface changes, the two
shared config files merged semantically rather than by side, and every locally executable gate green —
including the 607-test RI-specific suite. Per the stage rule, only a fully green stage permits proceeding,
and the Self-\* stage proceeded.
