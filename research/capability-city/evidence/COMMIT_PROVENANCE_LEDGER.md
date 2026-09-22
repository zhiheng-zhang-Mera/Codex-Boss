# COMMIT PROVENANCE LEDGER — Capability City programme

Provenance record for every commit this programme treats as research-significant: what it is, which ref holds
it, what it produced, what superseded it, and whether it is **currently reachable from a durable ref**.
Reachability is recorded separately from production ancestry: a commit may be absent from production ancestry
and still be durably reachable (acceptable), while an unreachable commit is not acceptable at all.

---

## 1. Audit header

| Field | Value |
|---|---|
| Repository | `zhiheng-zhang-Mera/Codex-Boss` |
| Primary checkout audited | `D:\Boss-PreCity-RC`, HEAD = `da80400891f90591e37860fea3ac3c936ef7d270` (`refactor/capability-city-v1`) |
| Second checkout inspected | `D:\Boss-PF020-Live-Acceptance`, HEAD = `d9ddb1511adeb61dee21192a683eb7851d3ca556` (`fix/runtime-isolation-root-policy-v1`). Separate clone (its own `.git`), plus three linked worktrees under `D:\Boss-PF020-Live-Acceptance-evolution-1276cb9e357ea72f\` |
| Audit time | `2026-09-22 11:44:50 +1000` (local clock of the primary checkout host) |
| Date field semantics | `date` below is the **committer** date (`git log --format=%ci`), timezone `+1000` for every row. Author dates were not collected → `NOT OBSERVED` |
| Method | Read-only git only: `git log`, `git for-each-ref`, `git branch -a --contains`, `git tag --contains`, `git merge-base --is-ancestor`, `git ls-remote --heads --tags`, `git cat-file`, `git show`, `git diff`. No `commit`/`checkout`/`merge`/`rebase`, no tests, no builds, no writes outside this one file |
| Reachability rule applied | A commit counts as **reachable** only if it is contained by at least one **branch ref or tag ref** (local or remote-tracking, with the remote branch's existence independently confirmed by `git ls-remote`). Reflog entries and dangling objects are **not** counted — no claim in this ledger depends on either |
| Enumerated ref scope | Every remote head/tag returned by `git ls-remote origin` (82 refs), plus all local heads/tags of both checkouts |

### Discovery commands and what they returned

| Command (read-only) | Result |
|---|---|
| `git log --format='%H\|%ci\|%s' origin/main..refactor/capability-city-v1` | 6 commits: `347de00`, `daf20c4`, `dc42346`, `16c90d9`, `d713bb8`, `da80400` |
| `git log --format='%H\|%ci\|%s' origin/main..origin/test/pf020-runtime-isolation-production-fix-v2` | 6 commits: `7d558cb`, `add57742`, `b0e7da9`, `cc970fe`, `fc01cca`, `2f36d99` |
| `git log --format='%H\|%ci\|%s' origin/main..origin/fix/runtime-isolation-root-policy-v1` | 1 commit: `d9ddb15` |
| `git log --format='%H\|%ci\|%s' origin/main..origin/feat/pf020-identity-convergence` | 2 commits: `7d558cb`, `add57742` |
| `git log --format='%H\|%ci\|%s' origin/main..origin/evolution/acceptance-promotion-identity-20260922002642` | 1 commit: `d8fc0fb` |
| `git log --format='%H\|%ci\|%s' origin/main..integration/pre-city-baseline` | 0 commits — the pre-city integration branch is an **ancestor** of `origin/main` |
| `git log --format='%H\|%ci\|%s' integration/pre-city-baseline..origin/main` | 1 commit: `7024203` (the PR #8 merge commit) |
| `git rev-list --count 4da0ed0..836b5ed` | 24 commits — the pre-city integration series between the pre-city start point and the verified RC |
| `git ls-remote origin` | 82 refs; remote existence per ref in §3 |
| PF020 checkout: `git log origin/main..evolution/acceptance-promotion-identity-20260922002549` / `...02642` / `...010033` | 1 commit each: `3ce1ef89`, `d8fc0fb`, `16d093d3` — each a single commit whose parent is `7024203` |

### Pre-city commits discovered but judged **not** research-significant on their own

The 24 commits between the pre-city start (`4da0ed0`) and the verified RC (`836b5ed`) are ordinary production
and evidence work (trust epochs, PF-DEBT items, hosted-gate adjustments, the two integration merges). They are
covered as baseline content by the `PRODUCTION_BASELINE` rows for `432f859`, `baf4108`, `836b5ed` and
`7024203`, and none carries a decision, finding, experiment or benchmark role of its own. Two of them are
adjacent to this programme's trust thread and are named here for completeness rather than tabulated:
`1d78ee67` ("the gate requires every required check, from one source") and `0491125` ("the promotion path
could not have seen a green CI, and the acceptance is blocked, not pending"). Both are ancestors of
`origin/main` and of `pre-city-baseline-v1`, therefore reachable. Criterion for exclusion: no `D-0xx` decision,
`FINDING-0xx` entry, `GOV-0xx` experiment or metric is bound to them in the tracked research record.

---

## 2. Category index

Primary category per commit; `+` marks a secondary category carried by the same commit.

| Category | Commits |
|---|---|
| `PRODUCTION_BASELINE` | `4da0ed0`, `432f859`, `baf4108`, `836b5ed`, `7024203` |
| `PRODUCTION_REPAIR` | `23e1541`, `b0e7da9`, `d9ddb15` |
| `EXPERIMENT` | `3ce1ef89`, `d8fc0fb`, `16d093d3` |
| `INSTRUMENT` | `7d558cb`, `add57742`, `cc970fe`, `fc01cca`, `2f36d99` + `c265ede`, `027917d`, `3945270` |
| `FAILED_ATTEMPT` | `5c06f7e` (self-inflicted CI failure), `add57742`+ (Stage C attempt 1 precondition failure) |
| `BUG_EVIDENCE` | `5c06f7e`, `add57742`+, `16c90d9`+, `d713bb8`+ |
| `TEST_EVIDENCE` | `4da0ed0`+, `5c06f7e`+, `23e1541`+, `add57742`+, `b0e7da9`+, `cc970fe`+, `fc01cca`+, `2f36d99`+, `d9ddb15`+, `3945270`+, `3ce1ef89`+, `d8fc0fb`+, `16d093d3`+ |
| `TRUST_EVIDENCE` | `7024203`+, `7d558cb`+, `add57742`+, `dc42346`+, `da80400`+ |
| `SUPERSEDED_DESIGN` | `add57742`+ (the V1 instrument design, superseded by V2 — secondary only) |
| `RESEARCH_ONLY` | `347de00`, `daf20c4`, `dc42346`, `16c90d9`, `d713bb8`, `da80400`, `c265ede`, `027917d`, `3945270` |
| `CITY_IMPLEMENTATION` | **NONE OBSERVED.** No commit in this programme implements Capability City. Phase 0 is held pending identity separation (`D-005`), and `da80400` records Stage C as OBSERVED for the governance question only. Stated explicitly so the empty set is not read as an omission |

---

## 3. Referenced refs — remote existence (`git ls-remote --heads --tags origin`, 2026-09-22 11:44 +1000)

| Ref | Type | Exists on remote? | Remote object | Local state |
|---|---|---|---|---|
| `refs/heads/main` | branch | **EXISTS** | `7024203eee3444a0115664de5e3a3d6599d9a800` | primary checkout has a **stale** local `main` at `4da0ed0` (25 behind `origin/main`) |
| `refs/heads/integration/pre-city-baseline` | branch | **EXISTS** | `836b5ed60aa63f3334e6cd08b193113325505880` | local branch present at the same SHA |
| `refs/heads/pre-city-baseline-v1` | branch | **ABSENT** | — | `pre-city-baseline-v1` exists only as a **tag**, never as a branch |
| `refs/tags/pre-city-baseline-v1` | annotated tag | **EXISTS** | tag object `ec92eb9b83c08c84d4b0fb0ce5ba7d2304c1a79e` → commit `7024203eee3444a0115664de5e3a3d6599d9a800` | local annotated tag present, identical object |
| `refs/heads/refactor/capability-city-v1` | branch | **EXISTS** | `da80400891f90591e37860fea3ac3c936ef7d270` | local branch present (currently checked out) |
| `refs/heads/feat/pf020-identity-convergence` | branch | **EXISTS** | `add57742d882349e57f60b8de8f59b68362849c4` | no local branch in `D:\Boss-PreCity-RC` (remote-tracking only); local branch in `D:\Boss-PF020-Live-Acceptance` |
| `refs/heads/test/pf020-runtime-isolation-production-fix-v2` | branch | **EXISTS** | `2f36d99aa77acf23968a0f55432dfb44cb51dbdc` | remote-tracking only in `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance` |
| `refs/heads/fix/runtime-isolation-root-policy-v1` | branch | **EXISTS** | `d9ddb1511adeb61dee21192a683eb7851d3ca556` | remote-tracking only in `D:\Boss-PreCity-RC`; local + checked out in `D:\Boss-PF020-Live-Acceptance` |
| `refs/heads/evolution/acceptance-promotion-identity-20260922002642` | branch | **EXISTS** | `d8fc0fb6579173a7f6200f06a494ddd744175d61` | remote-tracking only in `D:\Boss-PreCity-RC`; local branch checked out in a PF020 linked worktree |
| `refs/heads/evolution/acceptance-promotion-identity-20260922002549` | branch | **ABSENT** | — | local branch **only** in `D:\Boss-PF020-Live-Acceptance` (checked out in a linked worktree) |
| `refs/heads/evolution/acceptance-promotion-identity-20260922010033` | branch | **ABSENT** | — | local branch **only** in `D:\Boss-PF020-Live-Acceptance` (checked out in a linked worktree) |
| `refs/tags/city-start-baseline-v1` | tag | **ABSENT** | — | planned in `D-008` / `GOV-006` to carry the production repair; **does not exist yet** |

---

## 4. Master index — one row per research-significant commit

| # | SHA | Date (committer, +1000) | Category | Reachable | Not in production ancestry? |
|---|---|---|---|---|---|
| 1 | `7d558cb858e61269ddef548bde6ce85796bb871a` | 2026-09-20 14:54:45 | INSTRUMENT + | YES | yes |
| 2 | `4da0ed079c3a59362bc92b15091f7907ef064de7` | 2026-09-20 14:58:21 | PRODUCTION_BASELINE + | YES | no (is production ancestry) |
| 3 | `add57742d882349e57f60b8de8f59b68362849c4` | 2026-09-20 15:20:18 | INSTRUMENT + | YES | yes |
| 4 | `432f8591ebd98a6a0426d99c6dff4732b482d89a` | 2026-09-21 21:14:42 | PRODUCTION_BASELINE | YES | no |
| 5 | `baf4108fe16813533d9879700acc7052f56652ea` | 2026-09-21 21:24:31 | PRODUCTION_BASELINE + | YES | no |
| 6 | `5c06f7eced2eb32e419ad747d732a4ae46beffc1` | 2026-09-21 21:35:54 | FAILED_ATTEMPT + | YES | no |
| 7 | `23e15412f00355fd865432c03ec49210f91f0f33` | 2026-09-21 21:49:09 | PRODUCTION_REPAIR + | YES | no |
| 8 | `c265ede783cf3d2ee4890bb96b80f7d6d4266552` | 2026-09-21 22:10:27 | RESEARCH_ONLY + | YES | no |
| 9 | `027917d2efb64c58a49a29ccedf4cffb9dc9a360` | 2026-09-21 22:28:04 | RESEARCH_ONLY + | YES | no |
| 10 | `394527095390e43d832e60501072c8ecdd5a6a97` | 2026-09-21 22:48:36 | RESEARCH_ONLY + | YES | no |
| 11 | `836b5ed60aa63f3334e6cd08b193113325505880` | 2026-09-21 23:08:56 | PRODUCTION_BASELINE | YES | no |
| 12 | `7024203eee3444a0115664de5e3a3d6599d9a800` | 2026-09-22 06:16:26 | PRODUCTION_BASELINE + | YES | no (tip of `origin/main`) |
| 13 | `347de0011021d7e8b730a733d977d5dcae8e0649` | 2026-09-22 06:18:07 | RESEARCH_ONLY | YES | yes |
| 14 | `daf20c4de5ffe93b7636da398a5c349b818ea395` | 2026-09-22 09:24:16 | RESEARCH_ONLY | YES | yes |
| 15 | `dc423468c14a62f532daf617895ebfe69dd7153e` | 2026-09-22 09:40:50 | RESEARCH_ONLY + | YES | yes |
| 16 | `16c90d9429414df7326a9e1270fd8dac23f6c7de` | 2026-09-22 10:08:47 | RESEARCH_ONLY + | YES | yes |
| 17 | `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1` | 2026-09-22 10:14:48 | RESEARCH_ONLY + | YES | yes |
| 18 | `b0e7da96e98a1af12fd94d28e22d1f2863982626` | 2026-09-22 10:23:35 | PRODUCTION_REPAIR + | YES | yes |
| 19 | `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b` | 2026-09-22 10:25:42 | INSTRUMENT + | YES | yes |
| 20 | `3ce1ef89ea4047f1ed90be91585e6493387de847` | 2026-09-22 10:26:29 | EXPERIMENT + | **YES — local-only, AT RISK** | yes |
| 21 | `d8fc0fb6579173a7f6200f06a494ddd744175d61` | 2026-09-22 10:27:06 | EXPERIMENT + | **YES — single remote ref, AT RISK** | yes |
| 22 | `fc01cca40620cd4f4259691a94b8828c068461b4` | 2026-09-22 11:00:25 | INSTRUMENT + | YES | yes |
| 23 | `16d093d342e0ff22546654d9acfaa417d708a163` | 2026-09-22 11:00:38 | EXPERIMENT + | **YES — local-only, AT RISK** | yes |
| 24 | `2f36d99aa77acf23968a0f55432dfb44cb51dbdc` | 2026-09-22 11:01:13 | INSTRUMENT + | YES | yes |
| 25 | `d9ddb1511adeb61dee21192a683eb7851d3ca556` | 2026-09-22 11:11:00 | PRODUCTION_REPAIR + | YES | yes |
| 26 | `da80400891f90591e37860fea3ac3c936ef7d270` | 2026-09-22 11:11:37 | RESEARCH_ONLY + | YES | yes |

26 rows. "Not in production ancestry" means: not an ancestor of `origin/main`. That is **not** a reachability
problem by itself — see §6.

---

## 5. Per-commit provenance records

Each record carries all eleven required fields. `preserved-at` names the durable ref(s) that hold the object
and the checkout(s) whose object store contains it. Remote branch existence is as measured in §3.

### 5.1 `PRODUCTION_BASELINE`

#### `4da0ed079c3a59362bc92b15091f7907ef064de7`
- **SHA**: `4da0ed079c3a59362bc92b15091f7907ef064de7`
- **branch/ref**: `main` (remote + stale local), `integration/pre-city-baseline`; also contained by every ref built on the baseline
- **date**: 2026-09-20 14:58:21 +1000
- **category**: `PRODUCTION_BASELINE` (secondary: `TEST_EVIDENCE`)
- **production relevance**: last `main` commit before the pre-city promotion; PR #8's `baseRefOid` (`dataset/github/pr8.json:1`); the pre-city start point recorded in the freeze manifest (`pre_city_start_main_sha`)
- **research relevance**: fixes the "before" side of the programme's before/after comparison — the baseline branch is 20 commits ahead and 0 behind this SHA (`RESEARCH_LEDGER.md:59`), so the promotion could be a content-fast-forward and the comparison does not depend on when it landed (`D-002`)
- **bug/finding linkage**: none directly; it is the commit whose required-check declaration was the subject of the PR-gate work immediately before the programme
- **experiment linkage**: `D-001`/`D-002` baseline binding; `dataset/baseline-metadata.json` `pre_city_start_main_sha`
- **superseded-by**: NOT SUPERSEDED — retained as baseline ancestry
- **preserved-at**: `refs/heads/main` (origin), `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; local `main`; object store of `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `432f8591ebd98a6a0426d99c6dff4732b482d89a`
- **SHA**: `432f8591ebd98a6a0426d99c6dff4732b482d89a`
- **branch/ref**: `integration/pre-city-baseline` → reachable from `main` and the tag
- **date**: 2026-09-21 21:14:42 +1000
- **category**: `PRODUCTION_BASELINE`
- **production relevance**: merge ("integrate(runtime-intelligence)") that puts the mature RI plane and the RC1 installer into the pre-city baseline content; second parent `05d63b5` (alien2 line). Its RI imports are the concrete instance of the invisible kernel→feature edge named in `dataset/baseline-metadata.json:41`
- **research relevance**: part of the frozen baseline whose structural facts (187 measured cross-capability edges, 43 kernel→feature edges) are the before-state for RQ5 and for `FINDING-001`
- **bug/finding linkage**: `FINDING-001` (architecture gate blindness) — this merge is what makes the undeclared `electron/bootstrap/persistence.ts:24` → `tenx/runtime-intelligence/live-capture` edge exist in the baseline
- **experiment linkage**: `D-001`, `D-002`; `dataset/baseline-metadata.json` `frozenStructuralFacts`
- **superseded-by**: NOT SUPERSEDED — baseline content
- **preserved-at**: `refs/heads/main`, `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `baf4108fe16813533d9879700acc7052f56652ea`
- **SHA**: `baf4108fe16813533d9879700acc7052f56652ea`
- **branch/ref**: `integration/pre-city-baseline` → reachable from `main` and the tag
- **date**: 2026-09-21 21:24:31 +1000
- **category**: `PRODUCTION_BASELINE` (secondary: `BUG_EVIDENCE`)
- **production relevance**: merge ("integrate(self-systems)") bringing Self Cognition, Self Diagnosis and Self Case Record into the baseline as one stack (second parent `6cc84d2`)
- **research relevance**: **`FIRST_OBSERVED_SHA` for `FINDING-001`** — the pre-city measurement of the architecture gate's blindness was taken on this content (`evidence/BUG_FINDING_LEDGER.md:24`)
- **bug/finding linkage**: `FINDING-001` (`HIDDEN_COUPLING`, gate scans 25 of 594 files, reports `violations: []`)
- **experiment linkage**: `D-001`; `dataset/metrics.json` M-01..M-05; RQ5 comparison arm
- **superseded-by**: NOT SUPERSEDED — baseline content and the RQ5 comparison arm
- **preserved-at**: `refs/heads/main`, `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `836b5ed60aa63f3334e6cd08b193113325505880`
- **SHA**: `836b5ed60aa63f3334e6cd08b193113325505880`
- **branch/ref**: `integration/pre-city-baseline` (tip); contained by `main` and `refactor/capability-city-v1` (branch point); tagged `pre-city-baseline-v1`
- **date**: 2026-09-21 23:08:56 +1000
- **category**: `PRODUCTION_BASELINE`
- **production relevance**: the **verified Pre-City Integration RC** — PR #8 `headRefOid`, the RC content that the Owner promoted. Tree `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5`. Desktop CI run `35603744506` green on this exact SHA (`dataset/baseline-metadata.json:82`); the manifest authored *at* this commit names `3945270` as the last CI-verified SHA because a commit cannot name its own SHA (`PRE_CITY_FREEZE_MANIFEST.json`, `pre_city_rc_sha_note`)
- **research relevance**: the programme's **branch point and frozen before-state** (`RESEARCH_LEDGER.md:27`, `RQ.md`); `git diff 836b5ed origin/main` is empty, so this and the promoted `main` are the same content address
- **bug/finding linkage**: `FINDING-004` (`OBS-GOV-001`) — this is the PR #8 head at which the degenerate code-owner authorization was observed; `FINDING-001`/`FINDING-002` defects are both present in this content by design
- **experiment linkage**: `D-002` (baseline binding), `D-003`, `D-004`; `GOV-001` (`experiments/governance/GOV-001-pr8-observed-failure.md:20`)
- **superseded-by**: `7024203` for the purpose of the `pre-city-baseline-v1` tag binding (byte-identical tree, `git diff` empty). The branch tip of `integration/pre-city-baseline` remains this SHA. NOT superseded as content
- **preserved-at**: `refs/heads/integration/pre-city-baseline` (origin + local), `refs/heads/main`, `refs/heads/refactor/capability-city-v1`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `7024203eee3444a0115664de5e3a3d6599d9a800`
- **SHA**: `7024203eee3444a0115664de5e3a3d6599d9a800`
- **branch/ref**: `main` (tip, and `origin/HEAD`); tagged `pre-city-baseline-v1`; first-parent of every later branch head
- **date**: 2026-09-22 06:16:26 +1000
- **category**: `PRODUCTION_BASELINE` (secondary: `TRUST_EVIDENCE`)
- **production relevance**: merge commit of PR #8 — the pre-city baseline **as actually promoted**. Tree `8e31f066…`, byte-identical to `836b5ed`; `main` is the base for all later repair branches (`d9ddb15`, `d8fc0fb`, the evolution candidates)
- **research relevance**: **deliberately retains the runtime-isolation defect** (`FINDING-002`) and the degenerate-authorization baseline (`FINDING-004`). `D-008` insists this tag stays immutable so the defect remains the authentic historical observation and the future `city-start-baseline-v1` can carry the correction without the patch being credited to the City intervention
- **bug/finding linkage**: `FINDING-004` (`OBS-GOV-001`) merge commit — PR #8 merged with `reviews=[]` while `require_code_owner_review=true`; `FINDING-002` (nested Candidate root) present in this content on purpose
- **experiment linkage**: `D-003`, `D-004`, `D-005`; `GOV-001`; `GOV-006` §1 ("`pre-city-baseline-v1` intentionally continues to contain the defect"); `dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json`
- **superseded-by**: NOT SUPERSEDED — the tag is immutable by decision; superseding content is planned as `city-start-baseline-v1` (tag does **not** exist yet, §3)
- **preserved-at**: `refs/heads/main` (origin), `refs/tags/pre-city-baseline-v1` (annotated `ec92eb9b…`); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

### 5.2 `PRODUCTION_REPAIR`

#### `23e15412f00355fd865432c03ec49210f91f0f33`
- **SHA**: `23e15412f00355fd865432c03ec49210f91f0f33`
- **branch/ref**: `integration/pre-city-baseline` → reachable from `main` and the tag
- **date**: 2026-09-21 21:49:09 +1000
- **category**: `PRODUCTION_REPAIR` (secondary: `TEST_EVIDENCE`)
- **production relevance**: removes seven files from tracking under `artifacts/pre-city/`, a declared `RUNTIME_OWNED_PATH` — restores the workspace-path-ownership invariant that `5c06f7e` broke; keeps `docs/capability-city-principles.md` tracked
- **research relevance**: the acceptance certificate was **measured at this SHA** (`dataset/baseline-metadata.json:73`), Desktop CI run `35596132732` green; the commit itself is the repair of a self-inflicted evidence-handling failure, which is why it appears in the provenance record rather than in the paper's design claims
- **bug/finding linkage**: repair of the `5c06f7e` failure; recorded in `PRE_CITY_FREEZE_MANIFEST.json` as "the tree's runtime-path guard is right and I broke it"
- **experiment linkage**: pre-city baseline CI/acceptance binding (`dataset/baseline-metadata.json` `ciFacts`, `acceptanceFacts`)
- **superseded-by**: NOT SUPERSEDED; selected repair, content carried forward unchanged to `836b5ed`/`7024203`
- **preserved-at**: `refs/heads/main`, `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `b0e7da96e98a1af12fd94d28e22d1f2863982626`
- **SHA**: `b0e7da96e98a1af12fd94d28e22d1f2863982626`
- **branch/ref**: `test/pf020-runtime-isolation-production-fix-v2` (origin); not contained by any other ref
- **date**: 2026-09-22 10:23:35 +1000
- **category**: `PRODUCTION_REPAIR` (secondary: `TEST_EVIDENCE`)
- **production relevance**: **P1** — introduces `electron/stable-candidate/evolution-root-policy.ts` (one shared `resolveEvolutionRoot`) and changes `self-evolution-host.ts` so the Candidate evolution root is structurally outside Stable in every topology; adds `tests/unit/evolution-root-policy.test.ts` and `tests/unit/self-evolution-host-root-geometry.test.ts`. Can be transplanted onto `main` without the PF020-only acceptance machinery (`GOV-005`)
- **research relevance**: the repair whose **absence** made Stage C unmeasurable. `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES` and `READ_ONLY_SHARED_SURFACES` are byte-identical after it — no bypass, exception or special case — which is the evidence that the invariant was not weakened to make the experiment pass
- **bug/finding linkage**: `FINDING-002` **FIX_SHA (P1)**; `FINDING-005` `FIRST_OBSERVED_SHA` (12 failures in the first full-suite run); `FINDING-006` `FIRST_OBSERVED_SHA` (path containment decided by string prefix, corrected before commit)
- **experiment linkage**: `D-008` (Option B authorised); `GOV-004` §7; `GOV-006`; PROD-ROOT-01..07
- **superseded-by**: `fc01cca` (same branch validation fixes touch `evolution-root-policy.ts` and `self-evolution-host.ts`) and `d9ddb15` (main-derived promotable form of the same fix)
- **preserved-at**: `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin, confirmed by `ls-remote`); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `d9ddb1511adeb61dee21192a683eb7851d3ca556`
- **SHA**: `d9ddb1511adeb61dee21192a683eb7851d3ca556`
- **branch/ref**: `fix/runtime-isolation-root-policy-v1` (origin, tip); parent is `7024203`; not contained by any other ref
- **date**: 2026-09-22 11:11:00 +1000
- **category**: `PRODUCTION_REPAIR` (secondary: `TEST_EVIDENCE`)
- **production relevance**: **main-derived** form of the production root-policy repair: same fix as `b0e7da9`, rebased directly onto the promoted baseline; additionally carries the `config/test-catalogue.json` declarations that the catalogue gate requires. This is the form intended for promotion onto `main`
- **research relevance**: the **validated** repair — Desktop CI run `35674821748`, all four jobs success; local unit suite 260 files / 3285 tests / 0 failures (`FINDING-002`, `FINDING-005` `VALIDATED_SHA`). `ROOT_TRUST_SEMANTICS_UNCHANGED`, `bless --check` epoch 24 MATCHES
- **bug/finding linkage**: `FINDING-002` `FIX_SHA`/`VALIDATED_SHA`; `FINDING-005` `VALIDATED_SHA`; `FINDING-006` `VALIDATED_SHA`
- **experiment linkage**: `D-008`; `GOV-006`; intended carrier of the future `city-start-baseline-v1`
- **superseded-by**: NOT SUPERSEDED (branch tip; no later commit in the programme changes it)
- **preserved-at**: `refs/heads/fix/runtime-isolation-root-policy-v1` (origin, confirmed by `ls-remote`); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch, checked out, in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

### 5.3 `INSTRUMENT`

#### `7d558cb858e61269ddef548bde6ce85796bb871a`
- **SHA**: `7d558cb858e61269ddef548bde6ce85796bb871a`
- **branch/ref**: `feat/pf020-identity-convergence` and `test/pf020-runtime-isolation-production-fix-v2` (origin)
- **date**: 2026-09-20 14:54:45 +1000
- **category**: `INSTRUMENT` (secondary: `TRUST_EVIDENCE`; production promotion-path code)
- **production relevance**: converges the promotion path on the existing GitHub App identity — adds `electron/github/github-app-credential-provider.ts`, `electron/self-evolution/remote-promotion.ts`, changes `github-app-auth.ts`, `github-promotion-adapter.ts`, `promotion-controller.ts`, `self-evolution-coordinator.ts`, `self-evolution-host.ts`, `package.json`. Subject carries `(PREPARED)`: prepared, **never merged into `main`**
- **research relevance**: the origin of the live-acceptance harness (`live-promotion-acceptance.ts`, 314 lines added here) whose V1 tip is `add57742`; the identity mechanism Stage C later exercised as `codex-boss[bot]`
- **bug/finding linkage**: related to `FINDING-004` (`OBS-GOV-001`) as the instrument for the identity-separation test; not itself a defect
- **experiment linkage**: `GOV-002` (negative-authority protocol), `GOV-005` (instrument v1 vs v2, which names V1 as `add57742`); `D-006`/`D-009` preconditions
- **superseded-by**: `add57742` (tip of the same lineage); the V1 instrument design is superseded by I1 `cc970fe`
- **preserved-at**: `refs/heads/feat/pf020-identity-convergence`, `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin); remote-tracking refs + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `add57742d882349e57f60b8de8f59b68362849c4`
- **SHA**: `add57742d882349e57f60b8de8f59b68362849c4`
- **branch/ref**: `feat/pf020-identity-convergence` (tip) and `test/pf020-runtime-isolation-production-fix-v2` (origin)
- **date**: 2026-09-20 15:20:18 +1000
- **category**: `INSTRUMENT` (secondary: `FAILED_ATTEMPT`, `BUG_EVIDENCE`, `TRUST_EVIDENCE`, `TEST_EVIDENCE`, `SUPERSEDED_DESIGN`)
- **production relevance**: **none directly** — the commit itself is a test change (`tests/unit/root-trust-authority-lockdown.test.ts`, 7 insertions) so that the guard follows the promotion path it guards rather than one filename. It is nevertheless the tree from which the live-acceptance instrument was run, and the `PF020_TEST_SHA` recorded across the dataset
- **research relevance**: **the original instrument (V1)** and the SHA of Stage C attempt 1. `PF020_TEST_SHA` in `dataset/artifact-manifest.json:13`, `OWNER_MACHINE_IDENTITY_CEREMONY.md:68`, `dataset/governance/pf020-live-acceptance-attempt-1.json:8`, `dataset/governance/pf020-source-verification.json:6`; `GOV-005` `V1_SHA`
- **bug/finding linkage**: `FINDING-002` `FIRST_OBSERVED_SHA` (nested Candidate root, Stage C attempt 1); `FINDING-003` `FIRST_OBSERVED_SHA` (stale singleton report — the D-006 run read a `BLOCKED_EXTERNAL` report left by an earlier attempt)
- **experiment linkage**: `D-006` (attempt 1 failed on its own isolation invariant, `RuntimeIsolationError`), `D-007` (scope determination → `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED`), `GOV-004`, `GOV-005`, `GOV-006` (`SUBJECT_SHA`)
- **superseded-by**: as an **instrument**: `cc970fe` (I1/V2), the version that produced the reported Stage C run. As a **design**: the V1 root-placement and singleton-report design is `SUPERSEDED_DESIGN`; the failed attempt itself is deliberately **not** erased or relabelled
- **preserved-at**: `refs/heads/feat/pf020-identity-convergence`, `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin); remote-tracking refs + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b`
- **SHA**: `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b`
- **branch/ref**: `test/pf020-runtime-isolation-production-fix-v2` (origin); parent `b0e7da9`
- **date**: 2026-09-22 10:25:42 +1000
- **category**: `INSTRUMENT` (secondary: `TEST_EVIDENCE`, `TRUST_EVIDENCE`)
- **production relevance**: consumes the P1 production root policy inside the acceptance (`live-promotion-acceptance.ts`), so the measured geometry is the geometry production resolves; adds attempt-scoped, secret-safe evidence reporting (`live-acceptance-reporting.ts`, `<path>/<runId>.json` + `latest.json`, temp-file + rename) and `tests/unit/live-acceptance-reporting.test.ts`
- **research relevance**: **I1 / V2** — the instrument that produced the Stage C `PASS` measurement. `VALIDATED_SHA` for `FINDING-004` (`OBS-GOV-001`), `FIX_SHA` for `FINDING-003`, `FIX_SHA` component of `FINDING-005`
- **bug/finding linkage**: `FINDING-003` `FIX_SHA` (stale singleton → per-attempt atomic reports); `FINDING-004` `VALIDATED_SHA`; `FINDING-005` `FIX_SHA`
- **experiment linkage**: `D-008` I1; `D-009` (`Date / commit` = this SHA); `GOV-005` (`V2_SHA`, `I1_SHA`); Stage C measurement P1–P8
- **superseded-by**: `fc01cca`, then `2f36d99` (later validation and citation fixes on the same branch). The measured Stage C run was executed from this content plus those fixes — `stage-c-attempt-2-pass-report.json` records `instrumentSha256 = e21ba0db4383afeb09bf827693377d431fa6f95244e3ea602082106e7b183854`
- **preserved-at**: `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `fc01cca40620cd4f4259691a94b8828c068461b4`
- **SHA**: `fc01cca40620cd4f4259691a94b8828c068461b4`
- **branch/ref**: `test/pf020-runtime-isolation-production-fix-v2` (origin); parent `cc970fe`
- **date**: 2026-09-22 11:00:25 +1000
- **category**: `INSTRUMENT` (secondary: `TEST_EVIDENCE`)
- **production relevance**: none new; touches the production file only to keep the shared policy's shape consistent with the instrument and to fix the export surface (`config/test-catalogue.json` +21, `evolution-root-policy.ts`, `self-evolution-host.ts`)
- **research relevance**: validation fixes on the V2 instrument — catalogue declarations, citations, export surface, phase artifact. Part of the chain that made the Stage C instrument pass its own gates without weakening any gate (`FINDING-005`: "fixed by correcting the work")
- **bug/finding linkage**: `FINDING-005` `FIX_SHA` component (derived-artifact drift + policy compliance, not production behaviour)
- **experiment linkage**: `D-008`/`D-009` instrument validation; `GOV-005`
- **superseded-by**: `2f36d99` (citation refinement)
- **preserved-at**: `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `2f36d99aa77acf23968a0f55432dfb44cb51dbdc`
- **SHA**: `2f36d99aa77acf23968a0f55432dfb44cb51dbdc`
- **branch/ref**: `test/pf020-runtime-isolation-production-fix-v2` (origin, tip); parent `fc01cca`
- **date**: 2026-09-22 11:01:13 +1000
- **category**: `INSTRUMENT` (secondary: `TEST_EVIDENCE`)
- **production relevance**: comments only (3 insertions / 3 deletions in two files) — cites a tracked document instead of an untracked one
- **research relevance**: the **instrument V2 tip** and the `VALIDATED_SHA` of `FINDING-003`; the citations gate is a real gate that fired on the work and was satisfied by correcting the citation rather than by relaxing the gate
- **bug/finding linkage**: `FINDING-003` `VALIDATED_SHA`; `FINDING-005` citation-refinement component
- **experiment linkage**: `D-009` instrument provenance; `GOV-005`
- **superseded-by**: NOT SUPERSEDED (branch tip)
- **preserved-at**: `refs/heads/test/pf020-runtime-isolation-production-fix-v2` (origin); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch in `D:\Boss-PF020-Live-Acceptance`
- **currently reachable**: YES

#### `c265ede783cf3d2ee4890bb96b80f7d6d4266552` / `027917d2efb64c58a49a29ccedf4cffb9dc9a360` / `394527095390e43d832e60501072c8ecdd5a6a97` (freeze-record trio)
- **SHA**: `c265ede783cf3d2ee4890bb96b80f7d6d4266552`, `027917d2efb64c58a49a29ccedf4cffb9dc9a360`, `394527095390e43d832e60501072c8ecdd5a6a97`
- **branch/ref**: `integration/pre-city-baseline` → reachable from `main` and `pre-city-baseline-v1`
- **date**: 2026-09-21 22:10:27 +1000 / 22:28:04 +1000 / 22:48:36 +1000
- **category**: `RESEARCH_ONLY` (secondary: `INSTRUMENT`, `TEST_EVIDENCE`)
- **production relevance**: none — each touches only `PRE_CITY_FREEZE_MANIFEST.json`, which no test and no gate reads (`dataset/baseline-metadata.json:74`, `PRE_CITY_FREEZE_MANIFEST.json` `pre_city_rc_sha_note`). This is what licenses treating `23e1541`'s verified tree as the verified tree of the whole RC series
- **research relevance**: the freeze record that binds SHA ↔ CI run ↔ acceptance certificate. `027917d` run `35599708676`, `3945270` run `35601709706` (both green, both manifest-only deltas); `3945270` is the `pre_city_rc_sha` named inside the manifest at `836b5ed`
- **bug/finding linkage**: none; this is the instrument that keeps the CI evidence attached to an exact SHA rather than to a moving branch tip
- **experiment linkage**: `D-002` baseline binding; `dataset/baseline-metadata.json` `ciFacts`; `GOV-001` "Measured-at" provenance
- **superseded-by**: successive revisions of the same file — `c265ede` → `027917d` → `3945270` → `836b5ed`. Each later commit supersedes the earlier manifest **content**; no earlier commit is deleted or rewritten
- **preserved-at**: `refs/heads/main`, `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES (all three)

### 5.4 `BUG_EVIDENCE` / `FAILED_ATTEMPT` / `TEST_EVIDENCE`

#### `5c06f7eced2eb32e419ad747d732a4ae46beffc1`
- **SHA**: `5c06f7eced2eb32e419ad747d732a4ae46beffc1`
- **branch/ref**: `integration/pre-city-baseline` → reachable from `main` and `pre-city-baseline-v1`
- **date**: 2026-09-21 21:35:54 +1000
- **category**: `FAILED_ATTEMPT` (secondary: `BUG_EVIDENCE`, `TEST_EVIDENCE`)
- **production relevance**: **the self-inflicted CI failure.** It tracked eight files under `artifacts/pre-city/` (3869 insertions), and `artifacts/` is a declared `RUNTIME_OWNED_PATH` that must not own tracked files (`tests/unit/workspace-path-ownership.test.ts`). Desktop CI run `35594921583` concluded **failure** at this SHA (`dataset/baseline-metadata.json:83`). Nothing was shipped; the failure was caught by the repository's own guard
- **research relevance**: evidence that the tree's runtime-path guard works, and that the programme's own tooling failed loudly rather than silently. Also the only tracked copy of the seven pre-city deliverable documents (`BRANCH_CENSUS.md`, `CAPABILITY_INVENTORY.md`, `CITY_CLASSIFICATION.md`, `DEPENDENCY_BASELINE.md`, the two integration reports, `STRUCTURAL_HEALTH_BASELINE.md`) — recoverable from this commit even though they are untracked and gitignored on disk today
- **bug/finding linkage**: `BUG_FINDING_LEDGER.md` path note (why the evidence ledgers live under `research/`, not `artifacts/`); the frozen manifest's `note` recording that a tracked report inside `artifacts/pre-city/` "would reintroduce the exact failure repaired in `23e1541`"
- **experiment linkage**: `D-002` baseline provenance; pre-city CI fact set
- **superseded-by**: its **tracked content is reverted** by `23e1541` (the seven `artifacts/pre-city/*` docs are removed from tracking; `docs/capability-city-principles.md` stays). The commit and its failing CI record are retained deliberately
- **preserved-at**: `refs/heads/main`, `refs/heads/integration/pre-city-baseline`, `refs/tags/pre-city-baseline-v1`; object store `D:\Boss-PreCity-RC`; a gitignored working copy of the seven documents also sits in `D:\Boss-PreCity-RC\artifacts\pre-city\`
- **currently reachable**: YES

#### `16c90d9429414df7326a9e1270fd8dac23f6c7de`
- **SHA**: `16c90d9429414df7326a9e1270fd8dac23f6c7de`
- **branch/ref**: `refactor/capability-city-v1` (origin)
- **date**: 2026-09-22 10:08:47 +1000
- **category**: `RESEARCH_ONLY` (secondary: `BUG_EVIDENCE`, `TEST_EVIDENCE`)
- **production relevance**: none — research documents and one dataset file (`dataset/governance/pf020-live-acceptance-attempt-1.json`, 113 insertions); no source path touched
- **research relevance**: records `D-006`: the identity precondition **was** met and the acceptance then failed on its own isolation invariant. Establishes the "same class of defect, opposite failure direction" comparison with `OBS-GOV-001` (`threats-to-validity.md` §16): silent success vs loud refusal
- **bug/finding linkage**: `FINDING-002`/`FINDING-003` failure evidence (attempt-1 report; the stale `BLOCKED_EXTERNAL` singleton still present on disk in the PF020 checkout was read by that run)
- **experiment linkage**: `D-006`; `GOV-004`; Stage C attempt 1 (`NOT YET MEASURED`, terminal state `IDENTITY_SEPARATION_TEST_FAILED_OR_BLOCKED`)
- **superseded-by**: ledger content superseded by `d713bb8`, then `da80400`; the `D-006` record itself is not superseded
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1`
- **SHA**: `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1`
- **branch/ref**: `refactor/capability-city-v1` (origin)
- **date**: 2026-09-22 10:14:48 +1000
- **category**: `RESEARCH_ONLY` (secondary: `BUG_EVIDENCE`)
- **production relevance**: none at this commit — it is a scope determination. Its *content* is production-critical: the caller census and compiled-predicate probe that proved the nested-root defect is drawn by production too (`evolutionRoot` unset → `<userData>/evolution`), which is why no instrument-local patch was allowed
- **research relevance**: `D-007` — an instrument-scoped round that returned `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED`. Authored `GOV-004`; strengthened `threats-to-validity.md`
- **bug/finding linkage**: `FINDING-002` scope evidence (classification `PRODUCTION_AND_INSTRUMENT`); `FINDING-006` rationale
- **experiment linkage**: `D-007`; `GOV-004` (geometry verdict table: PRODUCTION dev REJECT, INSTRUMENT identical REJECT, PRODUCTION packaged ACCEPT, proposed v2 ACCEPT, control REJECT)
- **superseded-by**: ledger content superseded by `da80400`; `D-007` and `GOV-004` are not superseded
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `da80400891f90591e37860fea3ac3c936ef7d270`
- **SHA**: `da80400891f90591e37860fea3ac3c936ef7d270`
- **branch/ref**: `refactor/capability-city-v1` (origin, tip)
- **date**: 2026-09-22 11:11:37 +1000
- **category**: `RESEARCH_ONLY` (secondary: `TRUST_EVIDENCE`, `TEST_EVIDENCE`)
- **production relevance**: none — research documents plus two governance dataset reports; no source path touched
- **research relevance**: records `D-008` (production repair authorised, Option B) and `D-009` (**Stage C OBSERVED**, `PROMOTION_IDENTITY_SEPARATION_PROVEN = YES`), authors `GOV-005` and `GOV-006`, and files `stage-c-attempt-2-preflight-report.json` / `stage-c-attempt-2-pass-report.json`. This is the commit that closes the governance blocker which held Phase 0 (`D-005`)
- **bug/finding linkage**: `FINDING-004` resolution evidence (machine principal acted, could not self-authorize); `FINDING-002` repair disclosure (`GOV-006` §1: the repair must never be counted as Capability City progress)
- **experiment linkage**: `D-008`, `D-009`; `GOV-005`, `GOV-006`; Stage C criteria P1–P8 all observed simultaneously
- **superseded-by**: NOT SUPERSEDED (branch tip). Its measured candidate `d8fc0fb` is superseded-by nothing; PR #9 was closed **unmerged** by design
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

### 5.5 `RESEARCH_ONLY` (city branch, earlier)

#### `347de0011021d7e8b730a733d977d5dcae8e0649`
- **SHA**: `347de0011021d7e8b730a733d977d5dcae8e0649`
- **branch/ref**: `refactor/capability-city-v1` (origin); parent `836b5ed` (branch point)
- **date**: 2026-09-22 06:18:07 +1000
- **category**: `RESEARCH_ONLY`
- **production relevance**: none — created `RESEARCH_LEDGER.md`, `RQ.md`, `threats-to-validity.md`, `dataset/pr8-promotion-identity-collision.json`
- **research relevance**: freezes the research questions before any construction (`D-001`, `D-002`, `D-003`); corrects `D-003`; records the identity-collision observation
- **bug/finding linkage**: `FINDING-004` (`OBS-GOV-001`) first observation record; `FINDING-001` motivation
- **experiment linkage**: `D-003`, `D-005` (Owner ruling recorded on this commit's content); `GOV-001`
- **superseded-by**: ledger content superseded by `daf20c4`, `dc42346`, `16c90d9`, `d713bb8`, `da80400`; `D-001`/`D-002`/the frozen `RQ.md` are not superseded
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `daf20c4de5ffe93b7636da398a5c349b818ea395`
- **SHA**: `daf20c4de5ffe93b7636da398a5c349b818ea395`
- **branch/ref**: `refactor/capability-city-v1` (origin); parent `347de00`
- **date**: 2026-09-22 09:24:16 +1000
- **category**: `RESEARCH_ONLY`
- **production relevance**: none — created `TRUST_GOVERNANCE_FINDING.md`, extended the ledger
- **research relevance**: records the governance failure case and **holds Phase 0** pending identity separation. `dataset/baseline-metadata.json:7` names this commit as `capturedAtCommit.cityBranchCommit` (see §7 note 3)
- **bug/finding linkage**: `FINDING-004` (`OBS-GOV-001`) blocking state `PRE_CITY_PROMOTION_BLOCKED_BY_IDENTITY_SEPARATION`
- **experiment linkage**: `D-003`, `D-005`; `GOV-001`, `GOV-002`
- **superseded-by**: ledger content superseded by `dc42346` et seq.; the Phase-0 hold and `D-005` disposition are not superseded
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

#### `dc423468c14a62f532daf617895ebfe69dd7153e`
- **SHA**: `dc423468c14a62f532daf617895ebfe69dd7153e`
- **branch/ref**: `refactor/capability-city-v1` (origin); parent `daf20c4`
- **date**: 2026-09-22 09:40:50 +1000
- **category**: `RESEARCH_ONLY` (secondary: `TRUST_EVIDENCE`, `INSTRUMENT`)
- **production relevance**: none — 14 files, all under `research/capability-city/`
- **research relevance**: freezes `OBS-GOV-001`, freezes the negative-authority protocol, verifies the PF020 instrument source; **introduces `dataset/baseline-metadata.json`** (the frozen BEFORE-state), `dataset/metrics.json`, `dataset/artifact-manifest.json`, the captured GitHub governance artifacts (`dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json`), `dataset/governance/pf020-source-verification.json`, `dataset/governance/preflight-blocked-external-report.json`, and authors `GOV-001`, `GOV-002`, `GOV-003` plus `OWNER_MACHINE_IDENTITY_CEREMONY.md` and `PAPER_NOTES.md`
- **bug/finding linkage**: `FINDING-004` full evidence set (ruleset `22746755`, `reviews=[]`, `bypass_actors`, `PR8` head/base/merge SHAs)
- **experiment linkage**: `D-006` pre-change evidence; `GOV-001`, `GOV-002`, `GOV-003`
- **superseded-by**: ledger and dataset content superseded by `16c90d9`, `d713bb8`, `da80400`; the frozen protocol `GOV-002` is not superseded
- **preserved-at**: `refs/heads/refactor/capability-city-v1` (origin + local); object store `D:\Boss-PreCity-RC`
- **currently reachable**: YES

### 5.6 `EXPERIMENT` — Stage C candidate commits (instrument-generated)

All three are single commits whose parent is `7024203`, each adding exactly one file,
`electron/credential-boundary/live-acceptance-<runId>.md` (8 insertions), on a branch created by the
live-acceptance instrument. They are the exact SHAs the required checks reported on, so they carry the
experiment's binding between candidate, checks and refusal.

#### `d8fc0fb6579173a7f6200f06a494ddd744175d61` — the Stage C candidate
- **SHA**: `d8fc0fb6579173a7f6200f06a494ddd744175d61`
- **branch/ref**: `evolution/acceptance-promotion-identity-20260922002642` (origin, tip; **the only containing ref**)
- **date**: 2026-09-22 10:27:06 +1000
- **category**: `EXPERIMENT` (secondary: `TEST_EVIDENCE`, `TRUST_EVIDENCE`)
- **production relevance**: **none** — never merged; PR #9 closed **unmerged** after evidence capture. It is deliberately absent from production ancestry (`git merge-base --is-ancestor` against `origin/main` exits 1). This absence is the *point* of the experiment, not a gap
- **research relevance**: the measured Stage C candidate. All four required checks reported `headSha = d8fc0fb…` with `foreignSha: []`, `missing: []`; `promotion` decision `WAITING_FOR_ROOT_OWNER`; `rootOwnerApproval = null`; `main` before == after (`7024203…`). Recorded in `RESEARCH_LEDGER.md:621`, `TRUST_GOVERNANCE_FINDING.md:261`, `GOV-005:102`, `dataset/governance/stage-c-attempt-2-pass-report.json`
- **bug/finding linkage**: `FINDING-004` resolution/validation evidence (`PROMOTION_IDENTITY_SEPARATION_PROVEN = YES`); the candidate touches a Root-Surface path (`electron/credential-boundary/…`), so the authority ceiling was genuinely reached
- **experiment linkage**: `D-009`; `GOV-002` criteria P1–P8; `GOV-005`; runId `acceptance-promotion-identity-20260922002642`
- **superseded-by**: NOT SUPERSEDED
- **preserved-at**: `refs/heads/evolution/acceptance-promotion-identity-20260922002642` (origin, confirmed by `ls-remote`); remote-tracking ref + object store `D:\Boss-PreCity-RC`; local branch checked out in `D:\Boss-PF020-Live-Acceptance` linked worktree; attempt-scoped runtime report `D:\Boss-PF020-Live-Acceptance\runtime-data\.boss\promotion-identity-live-acceptance\acceptance-promotion-identity-20260922002642.json`
- **currently reachable**: **YES — via that single remote branch.** Note honestly: the task brief anticipated this commit might be unreachable. It is **not** unreachable as measured; it is however dependent on one ref that belongs to a **closed** PR, so it is flagged `AT RISK` in §6

#### `3ce1ef89ea4047f1ed90be91585e6493387de847` — V2 preflight candidate
- **SHA**: `3ce1ef89ea4047f1ed90be91585e6493387de847`
- **branch/ref**: `evolution/acceptance-promotion-identity-20260922002549` — **local branch only, in `D:\Boss-PF020-Live-Acceptance`**; **ABSENT on the remote**
- **date**: 2026-09-22 10:26:29 +1000
- **category**: `EXPERIMENT` (secondary: `TEST_EVIDENCE`)
- **production relevance**: none — never merged, not even proposed
- **research relevance**: the candidate named in `D-009`'s pre-change evidence: `PREFLIGHT_PASS identity=codex-boss[bot] rootSource=external-sibling separated=true base=7024203 candidate=3ce1ef89ea40` (`RESEARCH_LEDGER.md:609`). Filed as `dataset/governance/stage-c-attempt-2-preflight-report.json` (state `PREFLIGHT_PASS`, `preflightOnly: true`)
- **bug/finding linkage**: evidence that the repaired root policy made separation genuinely satisfiable (`rootSource=external-sibling`, `separated=true`) — the precondition `FINDING-002` had blocked
- **experiment linkage**: `D-008`/`D-009` preflight; `GOV-005`; runId `acceptance-promotion-identity-20260922002549`
- **superseded-by**: `d8fc0fb` (the full Stage C run that superseded this preflight-only attempt)
- **preserved-at**: `refs/heads/evolution/acceptance-promotion-identity-20260922002549` in `D:\Boss-PF020-Live-Acceptance` + linked worktree `…-evolution-1276cb9e357ea72f\acceptance-promotion-identity-20260922002549\workspace` + attempt-scoped runtime report. **Not** in the `D:\Boss-PreCity-RC` object store (`git cat-file` → `could not get object info`) and **not** on the remote
- **currently reachable**: **YES — local ref only (single clone); `NO` from `D:\Boss-PreCity-RC` and from the remote. AT RISK** (see §6 warning)

#### `16d093d342e0ff22546654d9acfaa417d708a163` — third preflight candidate (uncited)
- **SHA**: `16d093d342e0ff22546654d9acfaa417d708a163`
- **branch/ref**: `evolution/acceptance-promotion-identity-20260922010033` — **local branch only, in `D:\Boss-PF020-Live-Acceptance`**; **ABSENT on the remote**
- **date**: 2026-09-22 11:00:38 +1000
- **category**: `EXPERIMENT` (secondary: `TEST_EVIDENCE`)
- **production relevance**: none
- **research relevance**: an **additional** Stage C preflight attempt (`state: PREFLIGHT_PASS`, `preflightOnly: true`, runId `acceptance-promotion-identity-20260922010033`, runtime report timestamped 2026-09-22T01:00:38Z, i.e. 11:00:38 +1000) executed immediately after the validation fixes `fc01cca`. **No citation for this attempt was found in the tracked research record** (`git grep` over `research/capability-city` for `16d093d` / `20260922010033` returns nothing) → its experimental role is `NOT OBSERVED` in the ledgers. It is included here because it is an instrument-produced candidate SHA in this programme and it is the *least* durable object in the set
- **bug/finding linkage**: `NOT OBSERVED` (no ledger or dataset entry cites it)
- **experiment linkage**: runId `acceptance-promotion-identity-20260922010033`; its report is currently the `latest.json` pointer in the PF020 runtime data root. Whether it formed part of the reported Stage C result: `NOT OBSERVED` — the reported run is `…002642`
- **superseded-by**: `NOT OBSERVED`
- **preserved-at**: `refs/heads/evolution/acceptance-promotion-identity-20260922010033` in `D:\Boss-PF020-Live-Acceptance` + linked worktree `…\acceptance-promotion-identity-20260922010033\workspace` + attempt-scoped runtime report. **Not** in the `D:\Boss-PreCity-RC` object store and **not** on the remote
- **currently reachable**: **YES — local ref only (single clone); `NO` from `D:\Boss-PreCity-RC` and from the remote. AT RISK** (see §6 warning)

---

## 6. Reachability audit

**Rule restated.** Reachable = contained by at least one branch or tag ref, with remote refs confirmed by
`git ls-remote`. Reflog and dangling objects are excluded. A commit may be outside production ancestry and
still be perfectly durable; that is acceptable and is not flagged.

### 6.1 Result table

| # | Commit | Reachable from a durable ref? | Containing ref(s) | Production ancestry (`origin/main`)? | Risk |
|---|---|---|---|---|---|
| 1 | `7d558cb` | YES | `feat/pf020-identity-convergence`, `test/pf020-runtime-isolation-production-fix-v2` (origin) | NO | low |
| 2 | `4da0ed0` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 3 | `add57742` | YES | `feat/pf020-identity-convergence`, `test/pf020-…-v2` (origin) | NO | low |
| 4 | `432f859` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 5 | `baf4108` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 6 | `5c06f7e` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 7 | `23e1541` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 8 | `c265ede` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 9 | `027917d` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 10 | `3945270` | YES | `main`, `integration/pre-city-baseline`, tag | YES | none |
| 11 | `836b5ed` | YES | `integration/pre-city-baseline`, `main`, `refactor/capability-city-v1`, tag | YES | none |
| 12 | `7024203` | YES | `main` (tip), tag `pre-city-baseline-v1` | YES | none |
| 13 | `347de00` | YES | `refactor/capability-city-v1` (origin) | NO | low |
| 14 | `daf20c4` | YES | `refactor/capability-city-v1` (origin) | NO | low |
| 15 | `dc42346` | YES | `refactor/capability-city-v1` (origin) | NO | low |
| 16 | `16c90d9` | YES | `refactor/capability-city-v1` (origin) | NO | low |
| 17 | `d713bb8` | YES | `refactor/capability-city-v1` (origin) | NO | low |
| 18 | `b0e7da9` | YES | `test/pf020-runtime-isolation-production-fix-v2` (origin) | NO | low |
| 19 | `cc970fe` | YES | `test/pf020-runtime-isolation-production-fix-v2` (origin) | NO | low |
| 20 | `3ce1ef89` | YES — **local ref only** | `evolution/acceptance-promotion-identity-20260922002549` in `D:\Boss-PF020-Live-Acceptance` **only** | NO | **AT RISK — single clone, not on remote, absent from the primary checkout** |
| 21 | `d8fc0fb` | YES — **single remote ref** | `evolution/acceptance-promotion-identity-20260922002642` (origin) **only** | NO | **AT RISK — the sole ref belongs to a closed PR (#9); deleting that branch makes it unreachable** |
| 22 | `fc01cca` | YES | `test/pf020-runtime-isolation-production-fix-v2` (origin) | NO | low |
| 23 | `16d093d3` | YES — **local ref only** | `evolution/acceptance-promotion-identity-20260922010033` in `D:\Boss-PF020-Live-Acceptance` **only** | NO | **AT RISK — single clone, not on remote, absent from the primary checkout** |
| 24 | `2f36d99` | YES | `test/pf020-runtime-isolation-production-fix-v2` (origin) | NO | low |
| 25 | `d9ddb15` | YES | `fix/runtime-isolation-root-policy-v1` (origin) | NO | low |
| 26 | `da80400` | YES | `refactor/capability-city-v1` (origin) | NO | low |

**Commits that are NOT reachable: none.** All 26 commits in this ledger are reachable from at least one
durable ref as measured at 2026-09-22 11:44 +1000. The sixteen commits outside production ancestry
(`7d558cb`, `add57742`, `b0e7da9`, `cc970fe`, `fc01cca`, `2f36d99`, `d9ddb15`, the three Stage C candidates,
and the six city-branch research commits) are durable by ref, which is acceptable and is not a defect.

### 6.2 WARNING — commits at risk of becoming unreachable (owner decision required)

> **WARNING — three research-significant commits are single-copy or single-ref dependent. The mission forbids
> relying on reflog or dangling objects, so these need an archival ref created by the owner *before* any branch
> cleanup.**
>
> 1. `3ce1ef89ea4047f1ed90be91585e6493387de847` — reachable **only** from the local branch
>    `evolution/acceptance-promotion-identity-20260922002549` in the clone `D:\Boss-PF020-Live-Acceptance`.
>    It is **not on the remote** (`git ls-remote --heads origin` lists no such branch — verified) and the
>    object is **not present** in `D:\Boss-PreCity-RC` (`git cat-file -t` → `could not get object info`).
>    It is cited in `D-009`'s pre-change evidence as the candidate `3ce1ef89ea40`. If that clone or that
>    local branch is lost, no ref and no remote holds the commit, and it is recoverable only from reflog
>    (forbidden as a provenance basis) until garbage collection.
> 2. `16d093d342e0ff22546654d9acfaa417d708a163` — same situation, via the local branch
>    `evolution/acceptance-promotion-identity-20260922010033` in the same clone. It is not cited in the
>    tracked research record at all (`NOT OBSERVED`), which makes silent loss the likely outcome.
> 3. `d8fc0fb6579173a7f6200f06a494ddd744175d61` — the commit the Stage C `PASS` result is **bound to**. It is
>    reachable **only** through `refs/heads/evolution/acceptance-promotion-identity-20260922002642` on the
>    remote, the head branch of **closed PR #9** (`merged = false`, `D-009` disposition: closed unmerged after
>    evidence capture). Closed-PR branches are exactly the branches an owner tidies up.
>
> **Recommended archival action (owner's decision, not taken in this read-only round):** create an annotated
> tag (for example `research/stage-c-candidates-v1`) that names all three SHAs — a tag can point at each of
> them individually — or push the two local-only branches to the remote. Until one of those exists, the
> Stage C candidate set survives on a single local clone plus one closed-PR branch.
>
> Also noted, and a documentary rather than a commit risk: the evidence ledgers themselves
> (`research/capability-city/evidence/BUG_FINDING_LEDGER.md`, this file) are **untracked** in
> `D:\Boss-PreCity-RC` (`git status` → `?? research/capability-city/evidence/`). This round was read-only for
> everything except this one file, so committing them is left to the owner.
>
> Not a risk: the seven pre-city deliverable documents currently exist only as gitignored files under
> `D:\Boss-PreCity-RC\artifacts\pre-city\`, but their content is recoverable from the reachable commit
> `5c06f7e`. Losing the disk copies does not lose the record.

### 6.3 Checkout-state notes that affect naive reachability checks

* `D:\Boss-PreCity-RC`'s local `main` is **stale** at `4da0ed0` (25 behind `origin/main` = `7024203`). A naive
  `git log main` in that checkout will not show the merge commit even though `origin/main` does.
* `D:\Boss-PreCity-RC` holds remote-tracking refs for all seven relevant remote branches of the PF020 line and
  the city line, so all their objects are present locally there — **except** the two local-only evolution
  candidates (`3ce1ef89`, `16d093d3`), whose objects exist only in the second clone.
* `integration/pre-city-baseline` is an **ancestor** of `origin/main`, so
  `git log origin/main..integration/pre-city-baseline` is empty; the direction that returns the merge is
  `git log integration/pre-city-baseline..origin/main` → `7024203`.
* `refactor/capability-city-v1` contains all six research commits on top of the branch point `836b5ed`, which is
  itself baseline content — so the research branch and the production baseline share history at `836b5ed`.

---

## 7. Documented-provenance inconsistencies observed (recorded, not corrected)

This round was read-only for everything but this file, so the following are logged for the owner rather than
fixed.

1. **`RQ.md` binds the baseline to the pre-promotion SHA.** `RQ.md:3` and `RQ.md:28` state the baseline is
   `pre-city-baseline-v1` = `836b5ed`. The tag as it exists now points at `7024203` (annotated tag object
   `ec92eb9b83c08c84d4b0fb0ce5ba7d2304c1a79e`). The **content** claim is still true (trees byte-identical,
   `git diff 836b5ed 7024203` empty, both `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5`); the **SHA binding** in
   `RQ.md` is stale. `RESEARCH_LEDGER.md:28` and `dataset/baseline-metadata.json:11` already record `7024203`.
2. **The freeze manifest cannot name its own tip, by design.** `PRE_CITY_FREEZE_MANIFEST.json` at `836b5ed`
   names `pre_city_rc_sha = 3945270` and says so explicitly. The later green run on the tip itself
   (`836b5ed`, run `35603744506`) is recorded in `dataset/baseline-metadata.json:82`, i.e. outside the commit
   that could not contain it. Both records agree; neither is wrong.
3. **`capturedAtCommit.cityBranchCommit` does not match the introducing commit.**
   `dataset/baseline-metadata.json:7` says the city-branch capture commit is `daf20c4`, but the file itself was
   introduced by `dc42346` (which is two commits later). `UNKNOWN` which of the two the field is intended to
   mean; flagged as an observed discrepancy, not resolved.
4. **The Stage C candidate is reachable, contrary to the brief's expectation.** The audit request anticipated
   `d8fc0fb…` would be unreachable ("likely NOT reachable"). Measured result: it **is** reachable, via
   `refs/heads/evolution/acceptance-promotion-identity-20260922002642` on the remote, confirmed by
   `git ls-remote` at audit time. It remains outside production ancestry, and it remains single-ref dependent
   (§6.2). No unreachable commit was found in this programme.

---

## 8. What this ledger does not establish

* It does not establish that any ref will still exist later. Reachability is stated **as measured at
  2026-09-22 11:44 +1000** from `D:\Boss-PreCity-RC` and `D:\Boss-PF020-Live-Acceptance`.
* It does not evaluate whether the repairs are correct, only which commit carries them and which ref holds it.
* Author dates, tag creation for future tags (`city-start-baseline-v1`), and PR #9's current server-side state
  beyond the recorded evidence were `NOT OBSERVED` in this round; PR state claims are quoted from the tracked
  research record (`D-009`, `TRUST_GOVERNANCE_FINDING.md`).
* It does not modify, move, tag or promote anything. Nothing was written except this file.
