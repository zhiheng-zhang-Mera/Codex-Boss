# PAPER EVIDENCE LEDGER — Capability City Phase 0

**Status:** append-only in semantic meaning. Historical entries may be annotated or superseded; they are never
rewritten to hide a prior state.

**Scope:** every scientifically useful item from the Capability City programme, with the historical evidence
preserved alongside the Phase 0 measurements. Code may be replaced during development; this ledger retains the
epistemic history.

**Binding specification:** `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md` (spec commit
`76b2f495f57928f34823f6ce17176890963e846e`), issued under the Owner directive
`00926f49e9702d185246699b508aa110b11fd3ccb457beefcf2da1526bc867e9`.

## Field schema (every record uses it)

```text
EVIDENCE_ID · timestamp · source commit/branch/tag/PR/workflow · evidence class · claim being tested
prior assumption · method · observed result · expected result · discrepancy · interpretation
alternative explanation · independently corroborated · reproducible · artifact/file/hash references
paper-use category · limitations · supersedes / superseded_by
```

**Evidence classes** (never collapsed): `HISTORICAL` · `REMOTE_GITHUB` · `LOCAL_REAL_HOST` · `CONTROL` ·
`NEGATIVE_CONTROL` · `FIXTURE` · `SIMULATION` · `FAILURE` · `CORRECTION` · `GOVERNANCE` · `MEASUREMENT` ·
`REPRODUCTION`.

**Experimental-control framing (preserved explicitly):**

```text
legacy ratchet   = control sensor
new Observatory  = experimental sensor
production tree  = same measured object
```

## Historical numbers are historical

The figures `25`, `594`, `187`, `43`, `25-of-27` and `7` are **historical measurements** taken before the
city-start baseline. They are never presented as Phase 0 current measurements. Current measurements are
produced by the Observatory against `53aa74a…` and appear in §C below.

## Where the earlier research apparatus lives

The durable ledgers of the pre-Phase-0 rounds (`RESEARCH_LEDGER.md` D-001..D-009,
`evidence/BUG_FINDING_LEDGER.md`, `evidence/PAPER_EVIDENCE_INDEX.md`, `evidence/COMMIT_PROVENANCE_LEDGER.md`,
`evidence/CITY_START_RECONCILIATION_LEDGER.md`, `experiments/governance/GOV-001..006`) live on
`refactor/capability-city-v1`, tip `3ab37d9f969d97af0bb8170a2517032b447e9ac9`. That branch is **evidence** and is
explicitly not this phase's base. This ledger cross-references it by SHA rather than duplicating it, so there is
one source of truth per item.

---

# §A — Historical evidence (pre-Phase-0)

### H-01 — pre-city baseline

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-01 |
| `timestamp` | commit `2026-09-22T06:16:26+10:00`; PR #8 merged `2026-09-21T20:16:27Z` |
| `source` | tag `pre-city-baseline-v1` (annotated object `ec92eb9b…`) → `7024203eee3444a0115664de5e3a3d6599d9a800`; archival alias `research/pre-city-runtime-isolation-defect-v1` |
| `evidence_class` | `HISTORICAL` |
| `claim` | The authentic pre-city production state, frozen and immutable. |
| `prior assumption` | That a pre-city baseline could be named before the promotion to `main` landed. |
| `method` | Remote tag resolution (`git ls-remote --tags`), object inspection, tree comparison. |
| `observed result` | Tag exists at `7024203…`; tree `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5`, byte-identical to the verified RC `836b5ed`. Never moved, retagged or recreated in any round. |
| `expected result` | A stable control arm for all BEFORE comparisons. |
| `discrepancy` | The tag points at the merge commit `7024203`, while `RQ.md` binds the baseline to the RC commit `836b5ed` (see H-16). |
| `interpretation` | Content identity is what the control arm needs; the tag names the promoted content. |
| `alternative explanation` | None found. |
| `independently corroborated` | Yes — re-resolved from the remote in a later round and again in Phase 0. |
| `reproducible` | Yes: `git ls-remote --tags origin \| Select-String baseline`. |
| `artifact refs` | `research/capability-city/dataset/baseline-metadata.json` (branch `refactor/capability-city-v1`) |
| `paper_use` | baseline, comparison, limitation |
| `limitations` | Its retained defects are deliberate; it must not be "repaired". |
| `supersedes / superseded_by` | superseded_by: none (terminal control). |

### H-02 — city-start baseline

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-02 |
| `timestamp` | tag object `2026-09-22T12:41:49+10:00` |
| `source` | tag `city-start-baseline-v1` (annotated object `2d11e1fb…`) → `53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| `evidence_class` | `HISTORICAL` + `REMOTE_GITHUB` |
| `claim` | The production state after a genuine Root-Owner-authorized promotion is the correct measurement origin for Phase 0. |
| `prior assumption` | None; the tag was created only once §0 conditions were verified. |
| `method` | Remote verification of all §0 conditions, then `git tag -a` at the merge commit and `git push`. |
| `observed result` | Tag created at `53aa74a…`; `origin/main` equal to it; tag object `2d11e1fb…`. |
| `expected result` | An immutable measurement origin. |
| `discrepancy` | None. |
| `interpretation` | Phase 0's branch point is this commit. |
| `independently corroborated` | Yes — re-resolved from the remote at the start of each subsequent round. |
| `reproducible` | Yes. |
| `artifact refs` | `research/capability-city/evidence/CITY_START_RECONCILIATION_LEDGER.md` §1, §3 N1 |
| `paper_use` | baseline, method |
| `limitations` | `null` |

### H-03 — PF020 research/test lineage

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-03 |
| `timestamp` | `2026-09-20T14:54:45+10:00` (`7d558cb`), `2026-09-20T15:20:18+10:00` (`add57742`) |
| `source` | branch `feat/pf020-identity-convergence`; `PF020_TEST_SHA = add57742d882349e57f60b8de8f59b68362849c4` |
| `evidence_class` | `HISTORICAL` |
| `claim` | The convergence of the promotion path on an existing App identity was the intended repair for the shared-principal defect. |
| `prior assumption` | That path convergence alone would produce a measurable separation. |
| `method` | Git ancestry (`git merge-base --is-ancestor` with fully resolved SHAs). |
| `observed result` | `add57742` and `7d558cb` are **not** ancestors of `main`; PF020 remains `NOT MERGED BY DESIGN`. |
| `expected result` | The research line stays unmerged while it carries no production change. |
| `discrepancy` | None. |
| `interpretation` | The blocker was credential presence, not platform capability. |
| `independently corroborated` | Yes — ancestry re-derived in the Phase 0 round from full SHAs. |
| `reproducible` | Yes. |
| `artifact refs` | `RESEARCH_LEDGER.md` D-005/D-006; `GOV-005` |
| `paper_use` | motivation, failure-analysis |
| `limitations` | An abbreviated or unresolvable revision makes `--is-ancestor` exit non-zero and reads as "not an ancestor"; only full SHAs are used here. |

### H-04 — production runtime-isolation defect

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-04 |
| `timestamp` | first observed `2026-09-22` (`add57742`); fixed `b0e7da9`, re-derived on main as `d9ddb151` |
| `source` | `FINDING-002`; `b0e7da96e98a1af12fd94d28e22d1f2863982626`; `d9ddb1511adeb61dee21192a683eb7851d3ca556` |
| `evidence_class` | `HISTORICAL` |
| `claim` | Production placed the Candidate runtime tree inside Stable in development topology, so the isolation invariant refused. |
| `prior assumption` | That `<userData>` is outside Stable — true in packaged installs only because of OS layout. |
| `method` | Caller census + read-only probe against the compiled shipped predicate (4 geometries + historical control). |
| `observed result` | production-dev `separated=false` REJECT; instrument REJECT; packaged ACCEPT; proposed external sibling ACCEPT; historical nested control REJECT. |
| `expected result` | The invariant refuses the unsafe geometry. |
| `discrepancy` | Initially classified as instrument-only (`D-006`), corrected to `PRODUCTION_AND_INSTRUMENT` (`D-007`). |
| `interpretation` | The invariant detected the defect; the placement policy created it. Failure was **fail-closed**. |
| `independently corroborated` | Yes (pre-city evidence; re-verified by ancestry and by the repair's CI). |
| `reproducible` | `tests/unit/evolution-root-policy.test.ts` (PROD-ROOT-01..07) at `d9ddb15`. |
| `artifact refs` | `GOV-004`, `GOV-006`, `FINDING-002` |
| `paper_use` | case-study, failure-analysis, design-rationale |
| `limitations` | `n = 1` topology per case; packaged correctness remains path-dependent on where the OS puts application data. |

### H-05 — nested Candidate-root negative control

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-05 |
| `timestamp` | Stage C attempt 1, before `2026-09-22T10:08:47+10:00` |
| `source` | `add57742`; error `RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>` |
| `evidence_class` | `HISTORICAL` + `NEGATIVE_CONTROL` |
| `claim` | The isolation invariant refuses the historical nested geometry. |
| `prior assumption` | That the failing run was an instrument fault. |
| `method` | Run the acceptance preflight; then retain the geometry as an explicit negative control after the repair. |
| `observed result` | The nested geometry is still `REJECT`ed after the repair; the control was not weakened away. |
| `expected result` | `REJECT` before and after. |
| `discrepancy` | None. |
| `interpretation` | A preserved negative control is the evidence that the repair did not simply relax the rule. |
| `independently corroborated` | Yes, by the retained test asserting the historical shape still fails. |
| `reproducible` | Yes. |
| `artifact refs` | `dataset/governance/pf020-live-acceptance-attempt-1.json`; `GOV-004` §4 |
| `paper_use` | negative control, design-rationale |
| `limitations` | `n = 1`. |

### H-06 — D-007 scope determination

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-06 |
| `timestamp` | `2026-09-22T10:14:48+10:00` |
| `source` | `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1` (branch `refactor/capability-city-v1`) |
| `evidence_class` | `HISTORICAL` |
| `claim` | Before repairing the instrument, the defect's scope must be determined. |
| `prior assumption` | That the round's authorised scope (instrument repair) bounded the defect. |
| `method` | Caller census + geometry trace + read-only predicate probe. |
| `observed result` | `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED`. |
| `expected result` | Scope answered by evidence rather than by the round's framing. |
| `discrepancy` | The failure looked like an instrument artefact and was also a production defect. |
| `interpretation` | **Scope discipline**: the round stopped instead of quietly widening to production repair. |
| `independently corroborated` | Yes (pre-city record; consistent with H-04). |
| `reproducible` | Yes — the probe and census are recorded. |
| `artifact refs` | `GOV-004`; ledger §3 D1 |
| `paper_use` | method, failure-analysis |
| `limitations` | `n = 1`. |

### H-07 — OBS-GOV-001

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-07 |
| `timestamp` | frozen `2026-09-22T09:40:50+10:00` (`dc42346`); observed at PR #8 merge `2026-09-21T20:16:27Z` |
| `source` | PR #8, head `836b5ed`, merge `7024203`; ruleset `22746755` |
| `evidence_class` | `HISTORICAL` + `GOVERNANCE` |
| `claim` | `OWNER_BYPASS_USED_BECAUSE_PROMOTION_ACTOR_AND_CODEOWNER_COLLIDED` |
| `prior assumption` | `D-003`: that bypass was the only executable path to promotion. |
| `method` | Read PR/review/ruleset APIs; compare principals. |
| `observed result` | PR #8 merged with `reviews: []` while `require_code_owner_review = true` and `/package.json` was correctly matched; merged by the author principal, which holds the sole always-bypass actor. |
| `expected result` | `approver != author`. |
| `discrepancy` | The inferred mechanism (bypass) is **not observable**; the measured substance is narrower and stronger: no independent approval exists in the record. |
| `interpretation` | A separation-of-duties rule whose actor set has one element is satisfied by nobody. The failure mode is **silent success**, not refusal. |
| `alternative explanation` | The platform may have evaluated the requirement as satisfied; not determinable from the available APIs (`CLAIM-004`, `NOT_OBSERVABLE`). |
| `independently corroborated` | Yes — `pulls/8/reviews` re-read in Phase 0 returns zero. |
| `reproducible` | Yes. |
| `artifact refs` | `GOV-001`; `dataset/github/pr8.json`; `dataset/github/main-protection-ruleset.json` |
| `paper_use` | motivation, case-study, failure-analysis, limitation |
| `limitations` | `n = 1`; no second human reviewer exists in this repository. |

### H-08 — GOV-002 P8 measurement

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-08 |
| `timestamp` | PR #9 created `2026-09-22T00:27:10Z`; candidate `2026-09-22T10:27:06+10:00` |
| `source` | PR #9, candidate `d8fc0fb6579173a7f6200f06a494ddd744175d61`, branch `evolution/acceptance-promotion-identity-20260922002642` |
| `evidence_class` | `HISTORICAL` + `GOVERNANCE` |
| `claim` | `GOV-002` P8 — the candidate was not approved or merged during the Stage C run. |
| `prior assumption` | Frozen in advance as `GOV-002` P1–P8 so the protocol could not be tuned after the fact. |
| `method` | Read the pull-request and review APIs for the exact candidate SHA. |
| `observed result` | `state = closed`, `merged = false`, `pulls/9/reviews` → **zero** reviews. All four required contexts green on that exact SHA. |
| `expected result` | `WAITING_FOR_ROOT_OWNER`, no approval, no merge. |
| `discrepancy` | None. |
| `interpretation` | The machine principal could construct and submit a Root-Surface candidate while the tested promotion mechanism withheld Root Owner authorization — for the boundary actually tested. |
| `independently corroborated` | Yes — re-read from the API in Phase 0, closing the last prose-only criterion. |
| `reproducible` | Yes. |
| `artifact refs` | `dataset/governance/stage-c-attempt-2-pass-report.json`; `TRUST_GOVERNANCE_FINDING.md` §8 |
| `paper_use` | experiment, comparison |
| `limitations` | `n = 1`; one repository, one governance configuration. |

### H-09 — first Root Owner ceremony failure

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-09 |
| `timestamp` | `2026-09-22T02:14:30Z` (report written `12:14:30+10:00`) |
| `source` | runtime report `artifacts/city/reports/ROOT_OWNER_CEREMONY_VERIFICATION_REPORT.md` (gitignored) |
| `evidence_class` | `HISTORICAL` + `FAILURE` |
| `claim` | The ceremony had completed and PR #10 was merged. |
| `prior assumption` | The round premise asserted exactly that. |
| `method` | Read PR #10, its reviews, and the merge endpoint from the remote. |
| `observed result` | At that moment: `state = open`, `merged = false`, `reviews: []`, `origin/main = 7024203`, `/pulls/10/merge` → **404**. |
| `expected result` | `closed`, `merged = true`, an `APPROVED` review. |
| `discrepancy` | Four of seven conditions failed; the premise was false. |
| `interpretation` | **Remote verification caught a false assumption that had been asserted in the round's own opening statement.** The round stopped without creating a tag, editing a document, or beginning reconciliation. |
| `alternative explanation` | Recorded at the time as five possibilities (different PR, comment rather than approval, wrong repository, blocked self-approval, unconfirmed merge) — none asserted. |
| `independently corroborated` | Yes |
| `reproducible` | Yes |
| `artifact refs` | ledger §3 I1 |
| `paper_use` | failure-analysis, method, threats-to-validity |
| `limitations` | The report is gitignored; it is cross-referenced by the tracked ledger. |

### H-10 — genuine Root Owner approval

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-10 |
| `timestamp` | `2026-09-22T02:23:14Z` |
| `source` | PR #10 review, `commit_id = d9ddb151…` |
| `evidence_class` | `REMOTE_GITHUB` + `GOVERNANCE` |
| `claim` | A principal distinct from the PR author authorized the promotion. |
| `prior assumption` | `OBS-GOV-001` had shown that policy-level separation can be degenerate. |
| `method` | Read `pulls/10/reviews`; compare principals; read the live ruleset. |
| `observed result` | `APPROVED` by `zhiheng-zhang-Mera`, 17 seconds before the merge; PR author `codex-boss[bot]`. Ruleset unchanged (`require_code_owner_review = true`, `updated_at 2026-09-19T18:08:25`). No bypass used. |
| `expected result` | An independent approval by the root CODEOWNER. |
| `discrepancy` | None. |
| `interpretation` | `BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF` satisfied **for this boundary, in this case**. |
| `independently corroborated` | Yes |
| `reproducible` | Yes |
| `artifact refs` | `dataset/github/pr10.json` |
| `paper_use` | comparison, governance |
| `limitations` | `n = 1`. |

### H-11 — PR #10 genuine merge

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-11 |
| `timestamp` | `2026-09-22T12:23:30+10:00` (merged `02:23:31Z`) |
| `source` | `53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| `evidence_class` | `REMOTE_GITHUB` + `GOVERNANCE` |
| `claim` | The promotion landed as a genuine merge commit, not a squash and not a pre-computed `test_merge`. |
| `prior assumption` | None. |
| `method` | `git show -s --format='%H%n%P%n%cn'`, `/pulls/10/merge` status, `--is-ancestor`. |
| `observed result` | Parents `7024203` + `d9ddb151`; committer `GitHub <noreply@github.com>`; `/merge` → `HTTP/2.0 204 No Content`; `d9ddb151` is an ancestor of `main` (exit 0). GitHub's `test_merge` `c4dfb4cb…` was explicitly rejected as evidence. |
| `expected result` | A two-parent merge commit on `main`. |
| `discrepancy` | None. |
| `interpretation` | The production state after genuine authorization is the Phase 0 measurement origin. |
| `independently corroborated` | Yes |
| `reproducible` | Yes |
| `artifact refs` | ledger §3 L1 |
| `paper_use` | production consequence, governance |
| `limitations` | Commit author metadata is the human git identity while the PR author is the App: metadata authorship is not a principal claim. |

### H-12 — post-merge CI run 35679289373

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-12 |
| `timestamp` | `2026-09-22T02:23:33Z` → `02:39:42Z` |
| `source` | Desktop CI run `35679289373` on `53aa74a…` |
| `evidence_class` | `REMOTE_GITHUB` + `MEASUREMENT` |
| `claim` | The promoted production state is certified on its own merge SHA. |
| `prior assumption` | A green run on the candidate SHA does not certify `main`. |
| `method` | Read both the commit check-runs API and the workflow-jobs API for the merge SHA. |
| `observed result` | `quality`, `unit`, `acceptance`, `package` all `completed`/`success` with `head_sha = 53aa74a…`; `foreignSha = []`, `missing = []`. |
| `expected result` | Four required contexts green on the merge SHA. |
| `discrepancy` | None. A green run whose `head_sha` is `d9ddb15…` or `7024203…` was **not** counted. |
| `interpretation` | The one ceremony condition not independently observable by the external verifier is now observed directly. |
| `independently corroborated` | Yes — re-read in Phase 0. |
| `reproducible` | Yes |
| `artifact refs` | `dataset/city-start-baseline.json` `post_merge_certification` |
| `paper_use` | method, reproducibility |
| `limitations` | Hosted-runner CI, not a qualification host. |

### H-13 — Root Trust epoch 24 and aggregate digest

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-13 |
| `timestamp` | epoch record `created_at 2026-09-20T01:11:00.836Z`; re-measured in Phase 0 |
| `source` | `trust-policy/trust-epoch.json`; surface measured from `53aa74a…` |
| `evidence_class` | `MEASUREMENT` + `LOCAL_REAL_HOST` |
| `claim` | The Root Trust Surface is unmodified by the promotion. |
| `prior assumption` | None. |
| `method` | `corepack pnpm run build:electron` then `node scripts/acceptance-evolution-bless.cjs --check`. |
| `observed result` | epoch `24` (`boss-root-trust-24`) **MATCHES**; **63** files; aggregate `6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457`; `epoch_hash 33beb302…`; `parent_epoch_hash 2b1a0336…`. |
| `expected result` | `MATCHES`, 63 files, the same aggregate recorded in `baseline-metadata.json`. |
| `discrepancy` | The previously published value was truncated to `6eaf71e9…`; the full digest is recorded here. |
| `interpretation` | The promotion changed no Root Trust Surface file. |
| `independently corroborated` | Yes — recomputed from the tree on every check, not read from a file. |
| `reproducible` | Yes |
| `artifact refs` | `dataset/city-start-baseline.json` `root_trust` |
| `paper_use` | governance, reproducibility |
| `limitations` | None material. |

### H-14 — COR-1: the programme corrected its own over-generalisation

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-14 |
| `timestamp` | published `2026-09-22T12:46:10+10:00` (`60408b7`/`5a61d73`); corrected `662ca42`; corroborated `73faefe` |
| `source` | `research/capability-city/evidence/PHASE0_SPECIFICATION_FINDING.md` |
| `evidence_class` | `CORRECTION` |
| `claim` | *"At `city-start-baseline-v1` there is no city plan at all."* |
| `prior assumption` | That a zero-hit grep for `observatory` on `main` licensed a claim about the whole city plan. |
| `method` | Re-ran the sweep with `git grep -l "Capability City" HEAD`. |
| `observed result` | **2 files** carry city material: `docs/capability-city-principles.md` and `PRE_CITY_FREEZE_MANIFEST.json`. |
| `expected result` | The published claim was broader than its evidence. |
| `discrepancy` | A narrow negative result was generalised into a broad one. |
| `interpretation` | **The programme committed the exact failure class it studies**: a measurement narrower than the claim drawn from it. Corrected by annotating in place and recording the cause, never by rewriting. |
| `alternative explanation` | None; the falsifying grep is decisive. |
| `independently corroborated` | Yes — the two files' presence and the blob digest were verified. |
| `reproducible` | Yes |
| `artifact refs` | `PHASE0_SPECIFICATION_FINDING.md` §0; ledger §7b |
| `paper_use` | corrections / epistemic updates, method |
| `limitations` | The original sentence is deliberately left standing, so a careless reader could still meet it — the correction marker is the mitigation. |

### H-15 — D-4: the on-baseline freeze manifest records a pre-promotion plan

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-15 |
| `timestamp` | recorded `77533fa`; manifest finalised `2026-09-21T23:08:56+10:00` (`836b5ed`) |
| `source` | `PRE_CITY_FREEZE_MANIFEST.json` — **tracked in the baseline** |
| `evidence_class` | `HISTORICAL` + `CORRECTION` |
| `claim` | The frozen manifest describes the state at the RC. |
| `prior assumption` | None; the staleness was found by inspection. |
| `method` | Compare the manifest's fields against the post-promotion reality; measure the content relation between the SHAs it names. |
| `observed result` | `promotion_decision.rc_merged_to_main: false`, `pr_created: false`, `final_main_sha: null` ("main is UNMOVED at 4da0ed0"), `tag.status: TAG_READY_NOT_CREATED`, and `tag.target_sha = 23e1541` while the tag points at `7024203`. `git diff 23e1541 7024203` = the manifest alone (+469/−0); the manifest's own `acceptance_verified_tree_sha` equals the measured `23e1541` tree `ca291874…`. |
| `expected result` | A frozen pre-promotion plan, superseded by its own execution. |
| `discrepancy` | `tag.target_sha` names `23e1541`; the manifest's own rule (*a tag never points at a commit that was not promoted*) made `7024203` correct after the merge. |
| `interpretation` | Third discrepancy of one shape, after `RQ.md` D-1 and `baseline-metadata.json` D-2 — and the first found in an on-baseline tracked document. Recorded, not edited. |
| `alternative explanation` | The field could be a drafting error rather than staleness; the surrounding `reason_not_created` text supports staleness. |
| `independently corroborated` | Yes — the manifest's CI claims were separately re-verified. |
| `reproducible` | Yes |
| `artifact refs` | ledger §7a; `dataset/city-start-baseline.json` `documented_provenance_discrepancies` |
| `paper_use` | reproducibility, limitations |
| `limitations` | None material. |

### H-16 — RQ.md D-1 discrepancy

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-16 |
| `timestamp` | recorded `2026-09-22` (research branch) |
| `source` | `research/capability-city/RQ.md:3` and `:28`; register in `evidence/RESEARCH_REF_MANIFEST.md` §5 |
| `evidence_class` | `HISTORICAL` |
| `claim` | `RQ.md` binds `pre-city-baseline-v1` to `836b5ed`, while the tag points at `7024203`. |
| `prior assumption` | None. |
| `method` | Compare the frozen text against the tag's actual target; compare trees. |
| `observed result` | The content is byte-identical (`836b5ed^{tree} == 7024203^{tree} == 8e31f066…`), so the divergence is in the binding text, not the content. |
| `expected result` | A frozen research question's provenance line stays as written. |
| `discrepancy` | Yes — recorded rather than corrected. |
| `interpretation` | **A discrepancy that actually occurred is evidence.** The record is made legible, not consistent. |
| `alternative explanation` | The line may have meant "the RC commit that defines the content". |
| `independently corroborated` | Yes — trees compared in Phase 0. |
| `reproducible` | Yes |
| `artifact refs` | `RESEARCH_REF_MANIFEST.md` §5 |
| `paper_use` | reproducibility, limitations |
| `limitations` | None material. |

### H-17 — the legacy architecture ratchet's blind spot

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-17 |
| `timestamp` | discovered in the Pre-City RC round; re-confirmed in Phase 0 |
| `source` | `scripts/architecture.cjs` `collectImports` (declared-modules-only iteration; drops any edge whose target is not a declared module) |
| `evidence_class` | `HISTORICAL` + `CONTROL` |
| `claim` | The gate reasons over a manifest-declared subset, not the real source graph. |
| `prior assumption` | That a manifest's `modules` list declares implementation files. |
| `method` | Read `collectImports`; count `modules: []`; run `architecture:ratchet`. |
| `observed result` | `architecture:ratchet` reports `violations: []` while the declared set is a small fraction of tracked source. |
| `expected result` | A gate that claims to enforce topology should see the real dependency graph. |
| `discrepancy` | **The gate did not fail; it passed while blind.** That is the finding. |
| `interpretation` | The instrument must be repaired before structural refactoring; Phase 0 repairs the measurement layer, not the architecture. |
| `alternative explanation` | The gate may be intentionally a boot-contract check; the finding is that it is *cited* as a topology gate. |
| `independently corroborated` | Yes — counts re-derived in Phase 0 from the same declarations. |
| `reproducible` | Yes |
| `artifact refs` | `FINDING-001`; `dataset/metrics.json` `instruments.legacyManifestGate` |
| `paper_use` | motivation, measurement blind spot |
| `limitations` | The historical 187/43 figures came from an independent scan whose alias handling was not exhaustively validated. |

### H-18 — historical 25 / 594 scan observation

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-18 |
| `timestamp` | Pre-City RC round (historical) |
| `source` | `dataset/baseline-metadata.json` `frozenStructuralFacts` (`filesScannedByExistingGate: 25`, `ownedSourceFiles: 594`) |
| `evidence_class` | `HISTORICAL` |
| `claim` | The legacy gate scanned 25 of 594 owned source files. |
| `prior assumption` | None. |
| `method` | Manifest `modules` enumeration; independent file census. |
| `observed result` | Recorded historically. **Not** re-measured here as a historical reproduction. |
| `expected result` | Historical comparison data only. |
| `discrepancy` | The 594 figure used a broader, path-attributed notion of ownership than this phase's declaration-based `declared_owned_files` (spec §6). |
| `interpretation` | These numbers must not be treated as current measurements or as acceptance truth. |
| `alternative explanation` | None. |
| `independently corroborated` | **Partially** — the 25-file declared set is re-derivable from `config/capabilities/**` in this phase; the 594 figure is not re-derived here. |
| `reproducible` | Partially |
| `artifact refs` | `baseline-metadata.json`; spec §6 |
| `paper_use` | baselines, limitations |
| `limitations` | Different ownership definition from this phase's; labelled historical. |

### H-19 — historical 187-edge observation

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-19 |
| `timestamp` | Pre-City RC round (historical) |
| `source` | `dataset/metrics.json` M-04 baseline `187`; `dataset/baseline-metadata.json` `measuredFileLevelCrossCapabilityEdges: 187` |
| `evidence_class` | `HISTORICAL` |
| `claim` | 187 real file-level cross-capability import edges existed against 3 declared edges. |
| `prior assumption` | None. |
| `method` | Independent file-level import scan (not a shipped instrument). |
| `observed result` | Recorded historically. |
| `expected result` | Historical comparison data only. |
| `discrepancy` | Produced by an independent scan whose alias/computed-path handling was not exhaustively validated; Phase 0 measures the same class of quantity with a different, specified instrument. |
| `interpretation` | If Phase 0's count differs, that is a **difference between instruments and definitions**, not necessarily a change in the tree. |
| `alternative explanation` | Alias handling and edge-deduplication rules differ between the historical scan and the Phase 0 Observatory. |
| `independently corroborated` | **No** in this phase (out of scope to reproduce). |
| `reproducible` | No (the original scan script is not on this branch). |
| `artifact refs` | `dataset/metrics.json` M-04 |
| `paper_use` | baselines, limitations |
| `limitations` | Not re-measured; **must not** be presented as a Phase 0 result. |

### H-20 — historical 43 two-cycle observation

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-20 |
| `timestamp` | Pre-City RC round (historical) |
| `source` | `dataset/metrics.json` M-07 baseline `{ capability_2_cycles: 43, largest_scc: 25, of_total: 27 }` |
| `evidence_class` | `HISTORICAL` |
| `claim` | 43 capability-level 2-cycles existed in the real implementation graph. |
| `prior assumption` | None. |
| `method` | Independent scan. |
| `observed result` | Recorded historically. |
| `expected result` | Historical comparison data only. |
| `discrepancy` | Same instrument/provenance caveat as H-19. |
| `interpretation` | Cycle analysis is not a Phase 0 deliverable; Phase 0 measures files, edges and ownership. |
| `alternative explanation` | Cycle counting depends on the edge set and on graph granularity. |
| `independently corroborated` | No |
| `reproducible` | No |
| `artifact refs` | `dataset/metrics.json` M-07 |
| `paper_use` | baselines |
| `limitations` | Historical only. |

### H-21 — historical 25-of-27 SCC observation

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-21 |
| `timestamp` | Pre-City RC round (historical) |
| `source` | `dataset/metrics.json` M-07 (`largest_scc: 25`, `of_total: 27`) |
| `evidence_class` | `HISTORICAL` |
| `claim` | One strongly connected component contained 25 of the 27 capabilities. |
| `prior assumption` | None. |
| `observed result` | Recorded historically. |
| `expected result` | Historical comparison data only. |
| `discrepancy` | Same caveat as H-19/H-20. |
| `interpretation` | Supports the case for measuring before refactoring; not a Phase 0 deliverable. |
| `independently corroborated` | No |
| `reproducible` | No |
| `artifact refs` | `dataset/metrics.json` M-07 |
| `paper_use` | motivation |
| `limitations` | Historical only. |

### H-22 — historical 7 cross-domain private-state observations

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-22 |
| `timestamp` | Pre-City RC round (historical) |
| `source` | `dataset/metrics.json` M-08 baseline `7`; `docs/capability-city-principles.md` §15.7 |
| `evidence_class` | `HISTORICAL` |
| `claim` | 7 places where a module reads or writes another domain's private state. |
| `prior assumption` | None. |
| `method` | Manual/assisted inspection, recorded in the pre-city baselines. |
| `observed result` | Recorded historically; the on-baseline principles document repeats the measured starting point. |
| `expected result` | Historical comparison data only. |
| `discrepancy` | The Phase 0 Observatory measures **import edges**, not state access; it cannot confirm or refute this count. |
| `interpretation` | Outside Phase 0's measurement surface; recorded so its absence is not read as an oversight. |
| `alternative explanation` | None. |
| `independently corroborated` | No (different measurement surface). |
| `reproducible` | No |
| `artifact refs` | `dataset/metrics.json` M-08; `docs/capability-city-principles.md` §15.7 |
| `paper_use` | motivation, limitations |
| `limitations` | Not measurable by a source-import Observatory. |

### H-23 — the manifest-only / undeclared-target dropping mechanism

| Field | Value |
|---|---|
| `EVIDENCE_ID` | H-23 |
| `timestamp` | introduced with `scripts/architecture.cjs`; measured in Phase 0 |
| `source` | `scripts/architecture.cjs` `collectImports` — `if (!target \|\| !moduleOwners[target]) continue;` |
| `evidence_class` | `HISTORICAL` + `CONTROL` |
| `claim` | The legacy instrument drops every resolved edge whose target is not a declared module. |
| `prior assumption` | None. |
| `method` | Read the source; then re-derive the rule's counts in the Phase 0 comparison arm. |
| `observed result` | Two independent reductions: only declared modules are read at all, and edges to undeclared targets are discarded. |
| `expected result` | The mechanism explains both halves of the blind spot. |
| `discrepancy` | FINDING-001's remedy wording (*stop dropping undeclared targets*) could be read as authorising a change to the legacy gate; the Owner directive resolves it: drop them nowhere in the new sensor, and change the legacy gate in no phase here. |
| `interpretation` | This is the precise mechanism the Phase 0 Observatory must not reproduce. |
| `independently corroborated` | Yes — re-read from source in Phase 0; counts re-derived. |
| `reproducible` | Yes |
| `artifact refs` | `FINDING-001`; spec §5, §7 |
| `paper_use` | measurement blind spot, method |
| `limitations` | The legacy rule is re-derived, not exported by the instrument; the re-derivation is labelled as such. |

---

# §B — Corrections register

| `CORRECTION_ID` | Original claim | Evidence that falsified or weakened it | Corrected claim | Historical text left intact? | Downstream consequences |
|---|---|---|---|---|---|
| `COR-1` | "At `city-start-baseline-v1` there is no city plan at all." | `git grep -l "Capability City" HEAD` → 2 tracked files | The baseline carries the city principles and the pre-city freeze manifest; what is absent is the research apparatus and any Phase 0 scope-with-criteria document | **Yes** — annotated in place and left standing | The Phase 0 specification's candidate list is stronger; the earlier stop remains correct |
| `COR-2` | An implicit assumption carried while drafting this phase: that the historical counts (25 / 594 / 187 / 43 / 25-of-27 / 7) could be read beside the Phase 0 counts as comparable quantities | Inspection of what each figure measured: `187` counted cross-**capability** edges under a broader path-attributed ownership notion, while Phase 0 counts all resolved internal source edges under declaration-based ownership; `43` and `25-of-27` are cycle measures Phase 0 does not compute; `7` is a state-access measure a source-import observatory cannot see | The historical and current figures are **not comparable**; they are labelled HISTORICAL wherever they appear, and the only historical figure that reproduces exactly is the 25-file declared scan set | **Yes** — the historical text is untouched; the new specification and dataset state the distinction explicitly | Recorded as negative result `N-03` / `P0-10` rather than reconciled by adjusting either number |

---

# §C — Phase 0 evidence (this phase)

Measured on the real Mech host at implementation commit
`6bf354dda3324efeb1bf01421abaad6b6ca2d97`, against the branch point
`53aa74a7f9628765a92210d16aabcc77ae98bae4` (`city-start-baseline-v1`), under the specification committed at
`76b2f495f57928f34823f6ce17176890963e846e`.

The structured records are `artifacts/city/phase0/paper-evidence.json` (records `P0-01`..`P0-14`); the tracked
acceptance record is `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_ACCEPTANCE.md`; the human-readable index is
`artifacts/city/phase0/paper-evidence-index.md`. This section is the ledger's own summary of them, so the
durable record does not depend on the gitignored runtime directory.

## P0-01 — the scan set is derived from Git, not from the declarations it audits

`MEASUREMENT` · `LOCAL_REAL_HOST`. **Prior assumption:** the manifest-declared module list defines what an
architecture instrument may see. **Method:** `git ls-files` restricted to `electron/**` and `src/**`, `.ts`
`.tsx` `.js` `.jsx` `.cjs` `.mjs`, `*.d.ts` excluded; ownership read separately. **Observed:** 1296 tracked
files in the repository, **612 tracked source files scanned**, against **25** declared modules and 27 manifests.
**Discrepancy:** none — the scan set is 24.5x the declared set. **Interpretation:** manifest membership is
metadata about a measured file, not permission to see it. **Reproducible:** yes.

## P0-02 — explicit ownership covers a small minority of the source

`MEASUREMENT`. **Observed:** **25 declared-owned files, 587 UNDECLARED**, 0 ownership conflicts, 0 declared
modules missing from the tracked set. **Discrepancy:** the definition is deliberately narrower than the
historical `594` figure, which used a path-attributed notion of ownership. **Interpretation:** the declarations
are incomplete as a description of the tree; Phase 0 measures that and does not repair it.

## P0-03 — every resolved internal edge is retained

`MEASUREMENT`. **Observed:** **1671 internal edges** across 612 files, 489 with at least one reference.
Edge classes: `DECLARED_TO_DECLARED` 0 · `DECLARED_TO_UNDECLARED` 146 · `UNDECLARED_TO_DECLARED` 25 ·
`UNDECLARED_TO_UNDECLARED` 1500. Edge endpoints 171 declared / 3171 undeclared. Forms: `static-import` 1601 ·
`dynamic-import` 75 · `export-from` 16 · `require` 3 · `side-effect-import` 0. **Interpretation:** the graph the
legacy gate cannot see is 1671 edges wide. **Limitation:** edge existence is a source-level fact; no runtime
dependency is claimed.

## P0-04 — the control arm, on the same tree

`CONTROL`. **Method:** the unmodified `scripts/architecture.cjs` executed as a subprocess (`LEGACY_CLI`), plus a
labelled re-derivation of its documented visibility rule over the identical scan set
(`LEGACY_RULE_REDERIVATION`). **Observed:** ratchet exit 0, `pass = true`, **0 violations**, 3 declared
capability edges, metrics unchanged; the re-derived rule reads **25** files, produces **145** internal edge
records, and retains **0** of them after the undeclared-target filter. **Observer-only edges: 1671.**
**Discrepancy:** the historical `3` was a count of *declared capability refs*, not of import edges; on the
current tree the legacy rule retains **zero** import edges, because no declared module imports another declared
module. **Interpretation:** the blind spot is not a gap; it is the whole graph, while the control sensor reports
a clean ratchet.

## P0-05 — known-positive control

`CONTROL`. **Method:** resolve the actual current target from source at run time, never from a hard-coded path.
**Observed:** `electron/bootstrap/persistence.ts` (declared owner `persistence`) imports
`../runtime-intelligence/live-capture` → `electron/runtime-intelligence/live-capture.ts`, whose owner is
`UNDECLARED`; the legacy rule **would drop this edge**; the dependency was **not** modified. **Discrepancy:** the
pre-city evidence described it as `tenx`-owned; that description is historical comparison data only.
**Interpretation:** the documented blind spot reproduces on the current tree.

## P0-06 — the six required falsification classes

`FIXTURE` + `NEGATIVE_CONTROL`. All six **PASS** (OBS-01 manifest independence; OBS-02 undeclared target
preservation; OBS-03 false-import negative control; OBS-04 supported forms, one edge per `(from,to)`;
OBS-05 mutation sensitivity; OBS-06 determinism). They run through the same production code path and are also
asserted by `tests/unit/city/architecture-observatory.test.ts`, which drives the shipped command rather than a
copy of it. **Limitation:** fixtures are synthetic by construction; the non-synthetic half is the real-tree
structural assertions in the regression suite.

## P0-07 — determinism on the real tree

`REPRODUCTION`. Two full runs at the same clean commit produced the identical semantic hash
`0c36a2643d5ef6c343b4533f8c3950ef0e19b0af32ddd83fe3903b5a090115b0` (2117 ms first run). Volatile metadata
(timestamp, duration, host) is excluded from the semantic payload; keys are canonicalised. **Limitation:** the
payload includes the tracked-file total, so the hash also moves when the repository gains or loses any tracked
file.

## P0-08 — the regex cross-check, and what it caught

`NEGATIVE_CONTROL`. A conservative regex of the legacy shape was applied to the **same** 612-file scan set and
compared pair-by-pair with the lexer: **regex 1565, lexer 1671, regex-only 0, lexer-only 106**. A
newline-tolerant variant of the same regex recovers 1670 of the 1671; the single residual is a dynamic import
the regex mis-parses because an earlier `import` keyword lets it cross statement boundaries.
**Interpretation:** the disagreement is a limitation of the regex method (multi-line import/export statements),
not a defect in the lexer — and `regex-only = 0` is the property that would have indicated a lexer miss. This
cross-check is what caught failed attempt F-03.

## P0-09 — the historical 25-file figure reproduces exactly

`REPRODUCTION`. **Observed:** `legacy_scanned_files = 25`, `declared_modules_total = 25`, none absent from the
tracked set. **Interpretation:** this half of the historical observation reproduces; the `594` half used a
different ownership definition and is not reproduced here.

## P0-10 — the historical structural figures do NOT reproduce (negative result)

`NEGATIVE_CONTROL`. The historical `187`, `43`, `25-of-27` and `7` are **not** reproduced and are **not
comparable**: `187` counted cross-*capability* edges under a broader ownership notion while Phase 0 counts all
resolved internal source edges under declaration-based ownership; `43` and `25-of-27` are graph-cycle measures
Phase 0 does not compute; `7` is a state-access measure a source-import observatory cannot see. **This is
recorded as a negative result rather than silently reconciled**, and no reader may read a change between the
historical and current numbers.

## P0-11 — unresolved references are reported, not discarded

`MEASUREMENT`. **Observed:** 1 unresolved relative reference — `src/renderer/main.tsx` → `./styles.css`,
reason `non-source-extension`. **Interpretation:** a stylesheet is not a source module, so it is reported with
its reason rather than dropped or miscounted.

## P0-12 — the trust boundary is untouched

`GOVERNANCE`. Root Trust epoch **24** (`boss-root-trust-24`) **MATCHES** on this branch; 63 surface files;
aggregate `6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457`. `scripts/architecture.cjs`,
`config/architecture-baseline.json` and `config/capabilities/**` are byte-identical to the city-start baseline.
**Limitation:** `package.json` gains one script and is a CODEOWNERS-protected path; this branch is not merged.

## P0-13 — required regression suites

`MEASUREMENT`. typecheck PASS · security scan PASS (1296 files) · architecture ratchet PASS
(`violations: []`) · state probe PASS · test catalogue current at 277 suites · **unit tier 261 files / 3300
tests / 0 failures** · postbuild tier 8 / 119 / 0 · slow tier 4 / 35 / 0. **Hosted CI:** Desktop CI run
`35689642769` on `6bf354d` — `quality`, `unit`, `package`, `acceptance` all success. The spec commit's own run
`35688213411` was also green.

**Discrepancy, retained.** A first unit-tier run reported one failure:
`tests/unit/runtime-intelligence/replay-corpus-io.test.ts` timed out at 60000 ms while heavy commands ran
concurrently. Re-run in isolation it passed in **585 ms**, and the full tier re-run on an idle machine passed
**3300/3300**. Recorded rather than dropped; a genuine intermittent defect in that suite cannot be excluded
from a single observation, but it is unrelated to Phase 0's files.

## P0-14 — the syntactic mix of the tree, measured

`MEASUREMENT`. `static-import` 1601 · `dynamic-import` 75 · `export-from` 16 · `require` 3 ·
`side-effect-import` 0; 17 distinct external packages over 493 occurrences. **Discrepancy:**
`side-effect-import` is 0 on the real tree — the only such import is the stylesheet counted under P0-11 — and
all three `require` edges sit in one file. Every supported form is still exercised by fixtures (OBS-04), so the
zero is a measurement and not a gap in the observer.

---

## P0-15 — GOVERNANCE: the machine principal requested the promotion and could not authorize it

`GOVERNANCE`. **Question:** can the machine principal prepare and request the Phase 0 promotion while
remaining unable to authorize it? **Method:** the Boss GitHub App installation identity (appId `4903952`,
installationId `160744736`, encrypted vault, no plaintext PEM) opened a pull request from
`dev/city-phase0-architecture-observatory` to `main` through the sanctioned promotion adapter, which forbids
ruleset and branch-protection endpoints by construction; the head SHA was re-read and compared with the
P0-verified SHA **before** the PR was created; reviews, merge state and the base branch were read back
afterwards.

**Observed:** PR **#11** — `state = open`, author **`codex-boss[bot]`**, head `b52bcbba…`, base `53aa74a…`,
`mergeable = true`, `merge_state = blocked`, `merged = false`, **`reviews = 0`**, 8 files changed (+3222/−0);
`main` before == after (`53aa74a…`, `mainUnmoved = true`). No approval, no merge, no bypass, no admin override,
no protection or `CODEOWNERS` change.

**Expected:** the machine opens the PR; the Root Owner remains the only principal able to approve and merge;
`main` is unmoved; reviews stay at zero. **Discrepancy:** none — `merge_state = blocked` on the required
code-owner review is the intended ceiling, not a failure.

**Interpretation:** in this measured case the machine principal could construct and submit a promotion request
while the protected-branch policy withheld authorization from it: *prepare != authorize*, for the boundary
actually tested. It is the operationally distinct counterpart to `OBS-GOV-001` and to the Stage C measurement
at PR #9. **Alternative explanations:** `n = 1`, one repository, one ruleset configuration; the ceiling is
enforced by the composition of policy and principals rather than being an intrinsic property of the identity.
**Limitations:** no claim is made that the machine principal lacks privilege in general, nor that the platform
universally enforces code-owner review.

**Artifact refs:** `artifacts/city/phase1/phase0-promotion-pr.json`,
`artifacts/city/phase1/create-phase0-promotion-pr.cjs`, `artifacts/city/phase1/paper-evidence.ndjson`.

**Note on the head SHA.** The PR was opened at `b52bcbba…`, the SHA this record's P0-16 re-verification and
the P0 battery measured. This governance record is itself a later, documentation-only commit on the same
branch, so it advances the PR head. The measured candidate therefore remains `b52bcbba…` — whose hosted CI
(`35690756693`) and local battery are green — and the added commit changes no measurement, no policy and no
source file. Recorded rather than left implicit, because "which commit did you actually measure" is exactly the
question the earlier promotion rounds got wrong.

## P0-16 — REPRODUCTION: the accepted candidate was re-verified before the request was made

`REPRODUCTION`. The branch point (`53aa74a…`, equal to `city-start-baseline-v1`), the branch tip
(`b52bcbba…`) and a clean worktree were re-read; the observatory (612 files, 1671 edges, 587 undeclared), the
six self-tests, the known-positive control, the legacy ratchet (`pass = true`) and Root Trust (epoch 24
`MATCHES`) were re-run; typecheck, the tracked-secret scan (1297 files), the state probe, the catalogue check,
the build, and the unit (261 files / 3300 tests / 0 failures), postbuild (8 / 119 / 0) and slow (4 / 35 / 0)
tiers all passed on the real host.

**Discrepancy:** none. **The candidate was not altered to make promotion easier** — no measurement, policy or
source file changed between acceptance and this request. **Limitation:** the re-run is on the same host as the
original measurement, so it tests reproducibility of the procedure, not independence of the observer.

---

# §D — Negative results register

| ID | Claim | Result | Class | Retained |
|---|---|---|---|---|
| N-01 | Side-effect imports are a meaningful part of the internal graph | **0** `side-effect-import` edges; the only such import is a stylesheet, reported as an unresolved non-source reference | `NO_IMPROVEMENT` | yes |
| N-02 | The legacy visibility rule retains some of the real import graph | It retains **none**: 145 internal edge records, 0 visible after the undeclared-target filter | `MIXED_RESULT` | yes |
| N-03 | Phase 0 reproduces the historical structural figures (187 / 43 / 25-of-27 / 7) | **Not reproduced**; different quantities, different instrument; out of phase scope | `INCONCLUSIVE` | yes |
| N-04 | The conservative regex and the lexer agree on the same scan set | They do **not**: 106 lexer-only, 0 regex-only; a newline-tolerant variant recovers 1670 of 1671 — a regex limitation | `MIXED_RESULT` | yes |
| N-05 | A capability-level import graph exists to be reported | **0** capability-level edges: `DECLARED_TO_DECLARED = 0`, i.e. no declared module imports another declared module | `NO_IMPROVEMENT` | yes |
| N-06 | The historical description of the persistence dependency still matches the source | It does not: the current specifier is `../runtime-intelligence/live-capture` and the target is `UNDECLARED`. The dependency itself is present and observable | `REGRESSION` | yes |
| N-07 | The required regression suites pass | One unit-tier test timed out under concurrent host load; it passed in isolation in 585 ms and the idle re-run passed 3300/3300 | `INCONCLUSIVE` | yes |

---

# §E — Failed attempts register

| ID | Attempted | Why it appeared reasonable | How it failed | Falsifying evidence | What changed |
|---|---|---|---|---|---|
| F-01 | Use the TypeScript compiler API for AST parsing, as the specification prefers | `typescript` is already a dependency and the repository typechecks with it; AST parsing removes the whole class of lexical false positives | `typescript@7.0.2` is the native port: its package root resolves to `lib/version.cjs` and exports only `version` / `versionMajorMinor`; `ts.createSourceFile` does not exist | A direct `require` of the package and an enumeration of its exports | Investigated the unstable namespaces before abandoning the route |
| F-02 | Use `typescript/unstable/ast` or `unstable/sync` as the parser | Those subpaths expose 409 and 44 symbols, including `SyntaxKind` and `ScriptKind`, which look like the classic surface | `unstable/ast` has no parse entry point (type guards, a factory and a scanner only), and its scanner returned the same `FirstToken` with empty token text for an entire sample; `unstable/sync` exposes project/file APIs and needs a native server | A token dump from a sixteen-line sample plus an enumeration of both namespaces | Recorded the incompatibility; no third-party parser exists in this lockfile, so a self-contained lexer plus token-level recogniser was written and the deviation recorded |
| F-03 | Track template-literal hole depth in a single shared variable | A hole closes at the brace depth recorded when it opened, so one variable looked sufficient | Nested template literals overwrote it: the outer hole's closing brace stopped being recognised, a later real backtick opened a phantom template, 655–1098 character spans of real source were consumed as template text, and **three genuine `require()` edges were lost** in `electron/host/host-observer-collector.ts` | The regex cross-check reported `regex_only = 3` — the exact signature of a lexer miss — and a token dump showed zero `require` tokens in a file containing three | The expected brace depth is recorded **per hole frame**; edges moved 1668 → 1671 and `regex_only` fell to 0 |
| F-04 | Decide regex-versus-division with a deny-list of expression-closing punctuators | `/` after `)` `]` or `}` is division; everywhere else it may open a regex | In TSX, `>` also closes a tag: the `/` in `<div />` and `</div>` was read as a regex start, ran to end of line, and produced **302 spurious `unterminated-regex` issues across twelve renderer files**, plus two unterminated-string and two unrecognized-character issues downstream of the same cause | The issue breakdown by kind and file, all concentrated in `src/renderer/**` | Replaced the deny-list with an explicit **allow-list** of punctuators after which a regex may legally start, removing `>` and `<`. Parse issues fell to **0** with the measured edge set **unchanged at 1671** — the evidence that the defect was in reporting, not in measurement |
| F-05 | Pass an absolute `--out` directory to a helper that joined it onto the repository root | `path.join` is the natural way to build artifact paths | `path.join` does not reset on an absolute segment, so it produced a path that exists nowhere and the observatory threw while writing artifacts | The artifact-writing regression test failed with a stack pointing at `writeJson` | An absolute `--out` is honoured as given; a relative one is resolved against the root, with the displayed path kept repository-relative |

**Nothing here was a published error.** F-03, F-04 and F-05 were caught before the implementation commit, by
evidence rather than by review — the cross-check, the issue breakdown, and the regression suite respectively.
They are retained because the epistemic history is the research asset, not the final diff.

**Two defects reached a draft of this ledger itself and are corrected in section B:** `COR-2` (treating the
historical counts as comparable to Phase 0's) and, before it, `COR-1`.


---

# Reproduction

```powershell
git fetch --all --tags
git rev-parse city-start-baseline-v1^{commit}      # 53aa74a7f9628765a92210d16aabcc77ae98bae4
git rev-parse pre-city-baseline-v1^{commit}        # 7024203eee3444a0115664de5e3a3d6599d9a800
node scripts/acceptance-evolution-bless.cjs --check # needs dist-electron built from this tree
pnpm run architecture:ratchet                       # the control sensor, unchanged
pnpm run architecture:observe                       # the experimental sensor
```
