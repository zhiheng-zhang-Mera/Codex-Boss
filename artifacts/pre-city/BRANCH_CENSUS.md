# BRANCH CENSUS — Codex-Boss, Pre-City Integration RC

**Surveyed at:** fresh clone, `git fetch --all --tags --prune` completed against
`https://github.com/zhiheng-zhang-Mera/Codex-Boss.git`.
**Census commit:** `PRE_CITY_START_MAIN_SHA = 4da0ed079c3a59362bc92b15091f7907ef064de7`
**Worktree:** `D:\Boss-PreCity-RC` (fresh clone; no pre-existing working directory was modified).

`main` HEAD at survey time is `4da0ed0`, which **matches** the SHA the Owner recorded and reported as recent.
It was re-fetched and re-measured rather than assumed; the value agreed, so no discrepancy to report.

---

## 0. Method

Every metric below is measured, not inherited from a branch name.

| Field | Command |
|---|---|
| `merge-base` | `git merge-base origin/main <ref>` |
| `ahead` | `git rev-list --count <merge-base>..<ref>` |
| `behind` | `git rev-list --count <merge-base>..origin/main` |
| changed files | `git diff --name-only <merge-base>..<ref>` |
| contained in main | `git merge-base --is-ancestor <ref> origin/main` |
| latest CI | `gh run list --branch <b> --limit 1 --json conclusion,headSha,workflowName,createdAt` |

Two facts are separated throughout, because conflating them is the failure this census exists to prevent:

* **containment** — is the branch's content already reachable from `origin/main`? (`--is-ancestor`)
* **its own CI conclusion** — the colour of that branch's *last run*, which on an old tip reflects that old
  tip against old tooling, **not** whether its content is on main.

A branch can therefore be `ALREADY_INCLUDED` while its recorded CI is `failure`. That is not a contradiction
and it is not a reason to re-merge it.

**Taxonomy (from the task, used verbatim):**
`ALREADY_INCLUDED`, `SUPERSEDED`, `INCLUDE_CANDIDATE`, `HISTORICAL_ONLY`, `BLOCKED_BY_QUALIFICATION`,
`EXCLUDE`, `UNKNOWN_REQUIRES_INSPECTION`.

---

## 1. Census summary

35 refs under `origin/`, of which 33 are branches (`origin`, `origin/HEAD`, `origin/main` are not branches).

| Classification | Count | Branches |
|---|---|---|
| `ALREADY_INCLUDED` | 24 | all 0-ahead branches (23) + `dev/alien2-runtime-intelligence` (contained in the selected candidate) |
| `INCLUDE_CANDIDATE` → integrated | 1 | `candidate/alien2-real-work-v1` |
| `SUPERSEDED` | 4 | `dev/ri-01-core`, `dev/ri-02-evaluation`, `dev/ri-03-prospective`, `dev/ri-04-live-capture` |
| `BLOCKED_BY_QUALIFICATION` | 1 | `feat/pf020-identity-convergence` |
| `HISTORICAL_ONLY` (as a secondary note) | 6 | the `Prestart*` line |
| `EXCLUDE` | 0 | — |
| `UNKNOWN_REQUIRES_INSPECTION` | 0 | — |

Net integration action: **one** branch merged for Runtime Intelligence + installer, **one** stacked tip merged
for the three Self-\* capabilities. Nothing else was merged, and no branch was deleted.

---

## 2. Full table

`mb` = merge-base with `origin/main`. `ahead`/`behind` are relative to that merge-base.
`files` = files changed on the branch relative to `mb`.
CI = conclusion of that branch's most recent `Desktop CI` run **at its own tip** (see §0 caveat).

### 2.1 Zero-ahead — already contained in main

All 23 satisfy `git merge-base --is-ancestor origin/<b> origin/main` **and** `ahead = 0`. These were
re-checked, not assumed from the previous observation.

| Branch | mb (short) | ahead | behind | files | CI at tip | Classification |
|---|---|---|---|---|---|---|
| `Prestart` | `f4d800c` | 0 | 264 | 0 | success | `ALREADY_INCLUDED` |
| `Prestart-checkpoint-1` | `fc86021` | 0 | 260 | 0 | success | `ALREADY_INCLUDED` |
| `Prestart-checkpoint-2` | `313e63a` | 0 | 226 | 0 | success | `ALREADY_INCLUDED` |
| `Prestart-checkpoint-3` | `4ae1bb5` | 0 | 216 | 0 | success | `ALREADY_INCLUDED` |
| `Prestart-checkpoint-4` | `e081f17` | 0 | 125 | 0 | success | `ALREADY_INCLUDED` |
| `Prestart-checkpoint-5` | `4b623b9` | 0 | 107 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/01-architecture-contracts` | `426f635` | 0 | 102 | 0 | failure | `ALREADY_INCLUDED` |
| `platform-foundation/01-architecture-contracts-tmp` | `4b623b9` | 0 | 107 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/02-durable-state-events` | `0623e0c` | 0 | 95 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/03-capability-security-plugins` | `977ecae` | 0 | 89 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/04-knowledge-data-lifecycle` | `c499c3e` | 0 | 87 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/05-scale-verification-soak` | `14fd222` | 0 | 62 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/06-dogfooding-closure` | `e135f8c` | 0 | 51 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/07-semantic-acceptance` | `c175245` | 0 | 42 | 0 | success | `ALREADY_INCLUDED` |
| `platform-foundation/08-production-qualification` | `601285a` | 0 | 36 | 0 | failure | `ALREADY_INCLUDED` |
| `promotion-test/platform-foundation-08` | `601285a` | 0 | 36 | 0 | success | `ALREADY_INCLUDED` |
| `platform-stabilization/01-hardening` | `9093fab` | 0 | 33 | 0 | failure | `ALREADY_INCLUDED` |
| `chore/platform-trust-epoch-migration` | `c3c739e` | 0 | 27 | 0 | success | `ALREADY_INCLUDED` |
| `chore/root-trust-authority-lockdown` | `c58cef9` | 0 | 22 | 0 | success | `ALREADY_INCLUDED` |
| `chore/qualification-real-host-lane` | `ac3865b` | 0 | 21 | 0 | success | `ALREADY_INCLUDED` |
| `fix/ci-windows-sandbox-test-isolation` | `3f16e44` | 0 | 28 | 0 | success | `ALREADY_INCLUDED` |
| `perf/pf019-real-host-scale-tier` | `7c718aa` | 0 | 9 | 0 | success | `ALREADY_INCLUDED` |
| `trust/pf-debt-017-epoch-24` | `234f96d` | 0 | 6 | 0 | success | `ALREADY_INCLUDED` |

**Duplicate tips worth naming** (dedup evidence, not name matching):

* `platform-foundation/01-architecture-contracts-tmp` and `Prestart-checkpoint-5` both point at `4b623b9`.
* `platform-foundation/08-production-qualification` and `promotion-test/platform-foundation-08` both point at `601285a`.

**On the three `failure` rows.** `platform-foundation/01-architecture-contracts` (`426f635`, 2026-09-16),
`platform-foundation/08-production-qualification` (`601285a`, 2026-09-18) and `platform-stabilization/01-hardening`
(`9093fab`, 2026-09-18) each carry a red *historical* run from before the fixes that landed on main afterwards
(for example `601285a`'s own subject is a catalogue CRLF fix; main later gained the `REAL_HOST_SCALE` tier
retirement at `7c718aa`). Their content is contained in main, and main at `4da0ed0` is green. These are
**stale red runs on contained commits**, not unintegrated work, and they were not re-merged on the strength of
a branch name or re-run to manufacture a green colour they never had at that tip.

### 2.2 Non-trivial branches

| Branch | tip | mb (short) | ahead | behind | files | CI at tip | Classification |
|---|---|---|---|---|---|---|---|
| `candidate/alien2-real-work-v1` | `05d63b5` | `7315f78` | 7 | 3 | 75 | success | `INCLUDE_CANDIDATE` → **integrated** |
| `dev/alien2-runtime-intelligence` | `ecae925` | `2129576` | 26 | 13 | 69 | success | `ALREADY_INCLUDED` (contained in the selected candidate) |
| `dev/ri-04-live-capture` | `8929f04` | `326d6d3` | 4 | 7 | 70 | success | `SUPERSEDED` |
| `dev/ri-03-prospective` | `0df1487` | `326d6d3` | 3 | 7 | 66 | success | `SUPERSEDED` |
| `dev/ri-02-evaluation` | `02fa484` | `326d6d3` | 2 | 7 | 59 | success | `SUPERSEDED` |
| `dev/ri-01-core` | `90f3c7f` | `326d6d3` | 1 | 7 | 30 | success | `SUPERSEDED` |
| `dev/self-case-record-v1` | `6cc84d2` | `0a1bce7` | 9 | 10 | 36 | success | `INCLUDE_CANDIDATE` → **integrated** |
| `dev/self-diagnosis-v1` | `32bc058` | `0a1bce7` | 6 | 10 | 25 | success | `SUPERSEDED` (stack ancestor) |
| `dev/self-cognition-v1` | `9d1b8b2` | `0a1bce7` | 4 | 10 | 14 | success | `SUPERSEDED` (stack ancestor) |
| `feat/pf020-identity-convergence` | `add5774` | `1d78ee6` | 2 | 2 | 16 | success | `BLOCKED_BY_QUALIFICATION` |

---

## 3. Runtime Intelligence — why one branch, and which

Six branches were in scope. The decision is recorded in full in
`RUNTIME_INTELLIGENCE_INTEGRATION_REPORT.md`; the census-level outcome:

### 3.1 `ri-01 → ri-02 → ri-03 → ri-04` is a genuine stack

Measured by ancestry, not by the naming pattern:

```
git rev-list --count origin/dev/ri-04-live-capture..origin/dev/ri-0N   =>  0   for N = 1, 2, 3
```

So `ri-01`, `ri-02` and `ri-03` are strict ancestors of `ri-04` and contribute nothing `ri-04` lacks.
`ri-04` is the only non-redundant member. Merging all four would have created three duplicate-history
merge commits for zero content.

### 3.2 `dev/alien2-runtime-intelligence` and the selected candidate

```
git rev-list --count origin/dev/alien2-runtime-intelligence..origin/candidate/alien2-real-work-v1  =>  7
git rev-list --count origin/candidate/alien2-real-work-v1..origin/dev/alien2-runtime-intelligence  =>  0
```

`dev/alien2-runtime-intelligence` is a **strict ancestor** of the candidate: fully contained, adds nothing.
Note this is the opposite of the naive reading of "26 ahead / 13 behind" against `main` — those counts are
against `main`'s fork point `2129576`, not against the candidate.

The decisive measurement is that the candidate's RI subtree is **object-identical** to
`dev/alien2-runtime-intelligence`'s:

```
git rev-list --count (ls-tree diff on src/shared/runtime-intelligence + electron/runtime-intelligence)
=> TREE OBJECT IDENTICAL: candidate RI == dev/alien2 RI (same blobs)   [33/33 files]
```

So the candidate carries the *mature* implementation, not a re-implementation, and additionally carries the
RC1 installer work that `dev/alien2-runtime-intelligence` does not. The candidate is 3 behind main because it
forked at `7315f78`, which is an ancestor of `main`'s `4da0ed0`.

### 3.3 `ri-01..ri-04` vs the selection — disjoint, and superseded

```
git rev-list --count origin/dev/ri-01-core..origin/dev/ri-04-live-capture  =>  0   (ri-04 contains ri-01..03)
git rev-list --count origin/candidate/alien2-real-work-v1..origin/dev/ri-04-live-capture  =>  4
git rev-list --count origin/dev/ri-04-live-capture..origin/candidate/alien2-real-work-v1  =>  7
```

The two lines are **disjoint histories** (neither contains the other) that build the *same* capability.
`ri-0N` and the candidate's `6836558/9581568/2070f9c/8688cb9` carry the same four subjects but different SHAs.
The candidate's line is the superset: same RI, plus packaging. `ri-04` has no installer work and no test
catalogue entries the candidate lacks. → `SUPERSEDED`, not `EXCLUDE` (the work is real; it is represented).

### 3.4 CI evidence for the selection

| Branch | tip | latest `Desktop CI` |
|---|---|---|
| `candidate/alien2-real-work-v1` | `05d63b5` | success |
| `dev/ri-04-live-capture` | `8929f04` | success |
| `dev/alien2-runtime-intelligence` | `ecae925` | success |

The Owner's stated hypothesis — that the candidate has a green `Desktop CI` and carries both Runtime
Intelligence and real runtime/installer work — is **confirmed by measurement**. It was re-proved here rather
than accepted, and the re-proof added the object-identity finding above, which the hypothesis did not claim.

---

## 4. Self-\* — one stacked tip, not three merges

Ancestry measurement:

```
git rev-list --count origin/dev/self-case-record-v1..origin/dev/self-cognition-v1  =>  0
git rev-list --count origin/dev/self-case-record-v1..origin/dev/self-diagnosis-v1  =>  0
```

Both are strict ancestors of `dev/self-case-record-v1`, so the chain
`self-cognition-v1 → self-diagnosis-v1 → self-case-record-v1` is a **pure stack** and the tip is the complete
end capability. Only `dev/self-case-record-v1` was merged. The other two are `SUPERSEDED` as stack ancestors.

All three capabilities are verified present on the integration branch afterwards by real paths:
`src/shared/self-cognition/`, `src/shared/self-diagnosis/` + `electron/self-diagnosis/`,
`src/shared/self-case-record/` + `electron/self-case-record/`.

---

## 5. `feat/pf020-identity-convergence` — NOT MERGED BY DESIGN

Classification: **`BLOCKED_BY_QUALIFICATION`**. Retained, not deleted, not merged.

This branch is the one case where "clear the branch list" pressure must lose to the qualification rule. Its
own measured state:

| Fact | Measurement |
|---|---|
| `ahead` / `behind` | 2 / 2 against merge-base `1d78ee6` |
| Latest `Desktop CI` at `add5774` | success (`7d558cb` was red; `add5774` is the fix) |
| Local `HEAD` of the pre-existing checkout | `add5774` — the branch was the working tip elsewhere |
| Files touched | `electron/credential-boundary/`, `electron/promotion-gate/`, `electron/self-evolution/`, `tests/unit/promotion-gate.test.ts`, `tests/unit/root-trust-authority-lockdown.test.ts`, `config/test-catalogue.json`, `scripts/generate-test-catalogue.cjs`, `package.json` |

It touches **exactly** the regions §8 of the task marks high-sensitivity: credential boundary, promotion gate,
self-evolution authority, required-check logic. And its own author already measured that the required live
evidence does not exist on this host.

### 5.1 The blocker, independently re-measured on this host

Rather than trust the branch's own docstring, the host was inspected directly:

```
.boss\github-machine-identity.json                     -> False
.boss\secret-vault.json                                -> False
runtime-data\.boss\github-machine-identity.json        -> False
<LOCALAPPDATA>\CodexBoss                               -> False
<LOCALAPPDATA>\Codex-Boss                              -> False
```

There is **no machine identity installed in this host's data root**. `createGitHubMachineRuntime(...)`
therefore answers `configured: false`, and the acceptance that §7 requires exits `2`
(`BLOCKED_EXTERNAL`) without pushing or merging anything. Independently confirmed: the script
`acceptance:promotion-identity:live` exists on the branch's `package.json` and **does not exist on `main`** —
so the code is genuinely unlanded, not merely mislabelled.

`main` already records this honestly at `0491125` (`docs/root-trust-authority-model.md` §7 entry 4): the
promotion path on `main@1d78ee67` read the required checks exactly once with no wait, so against real CI it
always decided `required-checks-not-passed`; the repair is *prepared and NOT landed*; and
`PROVEN_IN_PRACTICE` is deliberately still unwritten.

### 5.2 Decision

**NOT MERGED BY DESIGN.** This is a correct terminal state, not an unfinished one. Merging it would have:

1. landed a Root Trust / credential-boundary change to clear a branch, which §7 and §23 forbid;
2. put an unproven high-authority capability on the pre-city baseline, where the next phase would inherit it
   as an assumed foundation;
3. turned a green `Desktop CI` into a false claim of live qualification — the exact conflation §9 and §23 ban.

The branch is preserved. The required Owner action is unchanged and is quoted verbatim from `main`:
`corepack pnpm run bootstrap:github-machine` on a host that has the identity, then
`corepack pnpm run acceptance:promotion-identity:live`.

---

## 6. Branches deliberately NOT deleted

§4 and §23: this round is not branch cleanup. All 34 non-`main` branches still exist on the remote,
including the `SUPERSEDED` RI line, the `Prestart*` history and the blocked `pf020`. Nothing was
force-pushed, no history was rewritten, and no existing branch was modified. The only new ref is
`integration/pre-city-baseline`.

## 7. Discrepancies from the Owner's stated prior

Reported per §4 ("if the real repository state differs, record the difference"):

1. The Owner listed `dev/alien2-runtime-intelligence` alongside the candidate as a peer to compare. In fact
   it is a **strict ancestor** of the candidate — there was never a choice between them.
2. The Owner's list of expected 0-ahead branches named 8; the real count of 0-ahead branches is **23**. The
   additional 15 are the `platform-foundation/*` and `Prestart*` lines, all contained.
3. The candidate's relationship to `ri-01..ri-04` is **disjoint history, same capability** — not a superset by
   ancestry. The supersession is established by content (object-identical RI tree) plus the installer work,
   which is a stronger argument than "newer", and is the one recorded.
4. No branch fell into `EXCLUDE` or `UNKNOWN_REQUIRES_INSPECTION`; every branch's real commit graph and diff
   were inspected, so no branch rests on a name-based classification.
