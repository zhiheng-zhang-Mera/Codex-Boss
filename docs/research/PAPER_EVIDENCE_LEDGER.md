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

# §F — Phase 1A evidence (this phase)

## Hand-off note — where the ceremony record lives

The Root Owner ceremony record (`P0-17`) was committed to the **Phase 0 branch** at
`328537e13f060349e587a6fdf674e03e39a2de61`, because `main` is protected and this programme does not bypass
protection, and because the immutable tag had to point at the merge commit `66440c1d…` rather than at a later
commit. The Phase 1A branch is cut from that tag, so its ledger does not contain `P0-17` by inheritance. This
section carries the ceremony forward so the promoted baseline's ledger is complete, and states plainly that the
Phase 0 branch holds the authoritative copy. The Phase 0 branch receives no further ledger commits; this is the
hand-off.

## P0-17 (carried forward from `328537e`) — GOVERNANCE: the Root Owner ceremony completed

`GOVERNANCE` + `REMOTE_GITHUB`. Each step independently re-measured from the remote on resumption:

| Step | Measured |
|---|---|
| Machine identity created the promotion request | PR **#11**, author `codex-boss[bot]`, head `9274dad…`, base `53aa74a…`, `reviews: 0` at creation |
| Machine stopped at the authorization boundary | no approval, no merge, no bypass, no admin override, no protection or `CODEOWNERS` change |
| Root Owner independently approved | `APPROVED` by **`zhiheng-zhang-Mera`** at `2026-09-22T07:24:38Z` against commit `9274dad…` |
| Root Owner merged | `merged = true`, `merged_at 2026-09-22T07:24:56Z`, `merged_by zhiheng-zhang-Mera`; `GET /pulls/11/merge` → `HTTP/2.0 204 No Content` |
| Candidate head ancestry verified | `git merge-base --is-ancestor 9274dad… 66440c1d…` → exit 0 |
| `main` moved to a genuine merge commit | `66440c1d…`, parents `53aa74a…` + `9274dad…`, committer `GitHub <noreply@github.com>` |
| The merge introduced no unmeasured content | merge tree `799619c5…` == the certified head tree, as predicted in advance |
| Post-merge CI | run **`35699482212`**, event `push`, `head_sha = 66440c1d…`, completed/success; `quality`, `unit`, `acceptance`, `package` all success on that SHA |
| Root Trust on promoted `main` | epoch **24** `MATCHES`, 63 files, aggregate `6eaf71e9…d457` |

**`prepare != authorize`** — the machine could request promotion and could not authorize it; a distinct human
principal did. This is the measured counterpart to `OBS-GOV-001`, where author, CODEOWNER and merger were one
principal and the promotion completed with zero reviews; the difference is **principal separation**, not the
check set, since both had four green required contexts on the exact candidate SHA.
**`technical acceptance != production promotion`** — Phase 0 passed twenty-five acceptance criteria at
`6bf354d` and was still not promoted. A green board is not an authorization.

## C2-TAG-FREEZE — Phase 0 is closed and immutably tagged

`GOVERNANCE` · commit/tag target `66440c1d360362a0bba38332d385feed41b64acb`. The annotated tag
**`city-phase0-observatory-v1`** was created at the promoted `main` commit and resolved again **from the
remote**: tag object `24bc1b9145cff314b389a373bf355390f55cd5cf` → commit `66440c1d…`. It was absent before
creation, so this is a creation rather than an idempotent pass, and no existing tag was moved. Three tags now
coexist and none moved: `pre-city-baseline-v1` → `7024203…` (never moved), `city-start-baseline-v1` →
`53aa74a…` (never moved), `city-phase0-observatory-v1` → `66440c1d…`.

```text
PHASE0_TECHNICAL_ACCEPTANCE = PASS
PHASE0_ROOT_OWNER_PROMOTION = VERIFIED
PHASE0_POST_MERGE_CI        = PASS
PHASE0_IMMUTABLE_TAG        = FROZEN
PHASE0                      = CLOSED
```

**Immutable from here.** The Phase 0 spec, the Phase 0 acceptance record, the historical Phase 0 measurements,
the old failure records, `COR-1`/`COR-2` and the negative-result records are not modified again. Later
interpretation problems may only be appended as corrections.

## C3-SPEC — the Phase 1A specification, committed alone

`DOCUMENTATION`. `PHASE1A_SPEC_COMMIT = 335bf5b3a094557627eaf5d5657ae6c931f6b351` —
`docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md`, 371 lines, **one file and no implementation code**,
which is what the mission requires of the first Phase 1A commit. The branch is cut from the frozen tag, so the
branch point resolves to `66440c1d…` and not to the old Phase 0 branch tip or the research branch.

The specification fixes the parts the mission left to the implementation and that the acceptance criteria will
be checked against: the baseline schema and its series/parent-hash promotion rule; the four unresolved-reference
classes and their policies; the identity-level grandfathering rule and the reintroduction-is-new rule; the
authorization test for cross-capability edges (capability `A` may import `B` only where `A` declares a
`requires`/`optional` reference that `B` provides); `NOT_YET_ENFORCED` for defect classes Phase 1A does not
model; and the rule that a sensor failure must never produce `PASS`.

---

# §G — Phase 1A checkpoints

| Checkpoint | State |
|---|---|
| `C2` Phase 0 genuine promotion + immutable tag | **COMPLETE** (records above) |
| `C3` Phase 1A spec | **COMPLETE** (record above) |
| `C4` sensor qualification | **COMPLETE** — Q-01..Q-07 PASS, Q-08 MEASURED, unexplained disagreements 0 |
| `C5` qualification failures / corrections | **COMPLETE** — two failures, both in the harness's own expectations |
| `C6` grandfathered baseline | **COMPLETE** — `config/architecture-enforcement-baseline.json` v1, identity-level, reproducible |
| `C7` enforcement policy | **COMPLETE** — E-01..E-10 implemented; ENF-01..ENF-18 green |
| `C8` shadow enforcement | **COMPLETE** — real tree: shadow PASS, enforce PASS, 0 new regressions |
| `C9` controlled regressions | **COMPLETE** — 9/9 injections produce the expected machine code |
| `C10` full regressions | **COMPLETE** — every required tier and gate green on the real host |
| `C11` hosted branch CI | **COMPLETE** — run `35703938755` on the branch tip, four jobs success |
| `C12` Phase 1A promotion request | **COMPLETE** — PR #12 opened by the machine identity; stopped at the Owner boundary |

## C12 — PHASE 1A PROMOTION REQUEST, and the second authorization boundary

`GOVERNANCE` + `REMOTE_GITHUB`. PR **#12** (`dev/city-phase1a-enforcement-convergence` → `main`) was opened by
the Boss GitHub App installation identity `app/codex-boss`, after the candidate SHA was re-read and compared with
the CI-verified tip **before** the request was made.

**Observed:** `state = open`, author **`codex-boss[bot]`**, head `40d0f7d…`, base `66440c1d…`,
`mergeable = true`, **`merge_state = blocked`**, `merged = false`, **`reviews = 0`**, 13 files `+10653 / −5`;
`main` before == after (`66440c1d…`). No approval, no merge, no bypass, no admin override, no protection or
`CODEOWNERS` change.

**Interpretation:** the Phase 0 ceremony repeated on a second, larger change, and with the same result —
*prepare != authorize*. The machine principal could qualify a sensor, freeze a baseline, build a policy and
request promotion, and could not authorize any of it. The request also states explicitly what it does **not**
do: it does **not** activate the new gate in `.github/workflows/ci.yml`, it does **not** repair inherited
architecture, and hosted enforcement activation remains a separate Root Owner act (Phase 1B).

```text
PHASE0 = PROMOTED_AND_FROZEN
SENSOR = ENFORCEMENT_QUALIFIED
GRANDFATHERED_DEBT_BASELINE = FROZEN
PROSPECTIVE_ENFORCEMENT = QUALIFIED
HOSTED_REQUIRED_GATE = LEGACY
PAPER_EVIDENCE = CONTINUOUSLY_PRESERVED
PHASE1B = NOT_STARTED
ARCHITECTURE_MIGRATION = NOT_STARTED

FINAL_STATUS = WAITING_FOR_ROOT_OWNER_PHASE1A_PROMOTION
```

## C10 — FULL REGRESSIONS

`MEASUREMENT` + `REAL_HOST`. Everything the repository requires, run on the Mech host at the implementation
commit, with nothing else competing for the machine:

| Suite / gate | Result |
|---|---|
| `typecheck` (three projects) | PASS |
| tracked-secret scan | PASS — 1304 files |
| `state:probe` | PASS |
| test catalogue | current at **278 suites**, 27/27 capabilities |
| `architecture:ratchet` | PASS, `violations: []` |
| Root Trust | epoch 24 `MATCHES`, 63 files, aggregate `6eaf71e9…d457` |
| `architecture:observe` | PASS — 612 files, 1671 edges |
| `architecture:qualify` | PASS — `ALLOWED_TO_PROCEED: true` |
| `architecture:enforce:shadow` / `architecture:enforce` | PASS both |
| `build` | PASS |
| **unit tier** | **262 files / 3321 tests / 0 failures** |
| postbuild tier | 8 files / 119 tests / 0 failures |
| slow tier | 4 files / 35 tests / 0 failures |

**A gate fired on this phase's own work, and the work was corrected rather than the gate.** The first unit-tier
run reported two failures in `tests/unit/comment-citation.test.ts`: a new comment in
`scripts/architecture-enforcement.cjs` cited a section number without naming a document that exists in the
repository, so bare section citations rose 1308 → 1309 and the per-file debt check failed. The remedy was the
gate's own preferred one — **state the rule instead** — and the comment was rewritten. The baseline number was
not raised, no exception was recorded and no gate was disabled. This is the Phase 1A instance of the pattern
`FINDING-005` recorded for Phase 0: the gate fired, the work product was corrected, the gate was not weakened.

## C11 — HOSTED BRANCH CI

`REMOTE_GITHUB`. Desktop CI run **`35703938755`**, event `push`, `head_sha` = the branch tip, `completed` /
`success`: `quality`, `unit`, `package` and `acceptance` all `completed` / `success`. The `unit` job is the one
that builds and runs the three tiers, so this is hosted evidence that the new suites, the catalogue and the new
commands behave the same way on a clean checkout as they do on the Mech host.

```text
ENFORCEMENT_ENGINE   = QUALIFIED_CANDIDATE
HOSTED_REQUIRED_GATE = LEGACY
```

Unit tests exercise the engine **on this branch**. That is not hosted-gate activation, and it must not be
reported as such: turning the enforcer into a required hosted gate is a separate municipal-law / Root-Trust act
(Phase 1B) which this round neither performs nor requests.

### C11 addendum — a transient hosted-runner failure, and the evidence that it was transient

The first hosted attempt on the final tip (`f30f86d7061f67cfa76eec02c4417f0509494102`) **failed**. Recorded in
full rather than re-run into silence:

| Observation | Detail |
|---|---|
| Failing run | `35707095128`, event `pull_request`, job `unit` |
| Failing step | `pnpm run test:postbuild` — `pnpm test` before it **succeeded** |
| Symptom 1 | `tests/acceptance/platform-soak-report.test.ts:76` — `expected 2 to be greater than 3`: a 0.25-minute soak with a 250 ms interval produced **2 samples** where it should produce dozens |
| Symptom 2 | two 60-second test timeouts (`closure-terminal-logic.test.ts`, `root-trust-authority-lockdown.test.ts`) in suites this phase did not touch |
| Commit delta on that SHA | **two markdown documents** — the ledger and the acceptance record |

**Evidence that it was the runner, not the change**, gathered before any remedy was applied:

1. **The same SHA passed on another runner.** Run `35707090892`, event `push`, same commit, same workflow:
   `quality`, `unit`, `package`, `acceptance` all `success`.
2. **The failing tier passed locally twice**, 8 files / 119 tests / 0 failures, in ~59 s.
3. **The two previous tips passed the same tier in CI** (`35703938755`, `35705467524`).
4. **The failure signature is throughput**, not correctness: samples starved and per-test ceilings crossed,
   which is what a throttled hosted runner produces and what a code change does not.

**Remedy and outcome.** The failed job was re-run once (`--failed`) as the standard remedy for a transient runner
failure — not an approval, not a merge, not a protection change, and not a weakened check. Attempt 2 completed
**success**: `quality`, `unit`, `acceptance`, `package` all green. All eight check-runs on the tip are now
`success`.

**Recorded as a threat to validity rather than as noise.** A grading pipeline whose postbuild tier can fail on
runner throughput means a red result is not by itself evidence about the change, and a green one is not by itself
evidence about the runner. The discriminator used here — a second runner on the identical SHA — is the cheapest
honest test, and it required no weakening of any gate.

**The head advanced after this record was written**, by the commit that carries it. That is disclosed rather than
left implicit: the SHA above is the one whose CI results are reported in this row, and the record commit's own run
is reported in the final report.

## C6 — GRANDFATHERED BASELINE: identity, not counts

`MEASUREMENT`. `config/architecture-enforcement-baseline.json`, schema `city-architecture-enforcement-baseline/1`,
**version 1**, `baseline_hash 30c82a5c…` → regenerated to **`b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e`**
once the series fields were added. It binds: `source_commit`, sensor spec + implementation SHA-256 + scan-set
hash, the ownership of **every** tracked source file by identity (612 entries), **every** resolved internal edge
by identity (1671 entries), the retired-edge series, the unresolved references with both the Phase 0 reason string
and the new classification, the generation command and reason, and `not_yet_enforced`.

```text
MEANS          THESE RELATIONS EXISTED BEFORE ENFORCEMENT
DOES NOT MEAN  THESE RELATIONS ARE HEALTHY
```

**Identity is the ratchet; counts are summaries.** A count-only baseline would have passed the round's own
`EXP-09` attack, in which one grandfathered edge is removed and one undeclared-endpoint edge is added so that the
total is unchanged.

Unresolved classification at generation: `NON_SOURCE_ASSET 1` (the Phase 0 stylesheet), `SOURCE_TARGET_MISSING 0`,
`UNSUPPORTED_SOURCE_RESOLUTION 0`, `OTHER_UNKNOWN 0`. Phase 0's own reason string (`non-source-extension`) is
preserved beside the classification rather than rewritten.

**Two provenance traps were found here and are recorded as failures rather than smoothed over:**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| B-1 | `--check` reported a false mismatch immediately after a successful generation | the check recomputed the series identity (version, parent) from the file it was checking, and a regeneration bumps both by design, so the comparison could never succeed | series identity is now an **input** held fixed in check mode; the measured content is what is recomputed |
| B-2 | `--check` would have started failing at the next commit | `source_commit` is part of the content, so committing the baseline moved it | provenance is now an input too; `--check` holds the recorded commit and verifies content identity, which is the property actually worth asserting |
| B-3 | the first regeneration produced `baseline_version 2` whose parent was a version 1 that had **never been committed** | a baseline chain must begin at an accepted state; a scratch file is not one | deleted and regenerated as version 1 with no parent |
| B-4 | after `git checkout`, `--check` failed again on an unchanged tree | git checks the file out with **CRLF** (`core.autocrlf=true`, no `.gitattributes`) while the generator writes **LF**, so a raw text comparison can never match on this platform — the *same* CRLF trap the Phase 0 record already documents for the pre-city freeze manifest | comparison is normalised, and an independent canonical-hash comparison is reported beside it; `hash_matches` is immune to line endings by construction |
| B-5 | running the generator casually bumped the series to version 2 during what was meant to be an artifact refresh | regeneration *is* a deliberate act — the command exists for it, `--check` exists for the other purpose — and the operator used the wrong one | reverted with `git checkout`; the committed baseline is version 1 again, and the episode is recorded as a usage error rather than a code defect |

**B-1 through B-5 share one shape**, and it is the same shape as `COR-1`, the qualification harness at C5, and
the experiments at C9: **the apparatus was wrong and the measured object was right.** Four independent instances
in two phases is no longer a coincidence to note in passing; it is a repeated property of building measurement
infrastructure, and it is the strongest argument in this record for the rule that a failing check should first be
suspected of being the failure.

**A fifth instance, at C10:** the comment-citation gate fired on this phase's own source. The remedy was the
gate's preferred one — state the rule instead — and it is counted here rather than filed separately, because the
lesson is identical: the failing check was right and the work was wrong.

## C7 — POLICY: one evaluator, two modes

`MEASUREMENT` + `FIXTURE`. `scripts/architecture-enforcement.cjs` implements E-01..E-10 with machine codes, and
`architecture:enforce:shadow` / `architecture:enforce` are the canonical entry points. `architecture:ratchet`
remains the untouched legacy control and is **not** replaced.

```text
shadow  -> policy violation reported, exit 0
enforce -> policy violation reported, exit non-zero
engine error -> non-zero in BOTH
```

The findings list is produced by one function in both modes, which is what makes **ENF-12** (identical findings)
a real check rather than a coincidence. E-07's authorization test is operationalised from the repository's own
declarations: capability `A` may import `B` only where `A` declares a `requires`/`optional` reference that `B`
provides. E-09 fails closed on a read failure, a parse issue, a silent skip, an unsupported resolution or an
unknown classification. E-10 emits `NOT_YET_ENFORCED` for the five defect classes Phase 1A does not model.

`tests/unit/city/architecture-enforcement.test.ts` — **21 tests, all green**, driving the shipped command with
injected inputs: ENF-01..ENF-18 plus the engine-error case.

## C8 — SHADOW TRIAL on the real tree

`MEASUREMENT` + `SHADOW_ENFORCEMENT`. On the exact Phase 1A baseline, all four roles were run:

| Sensor | Result |
|---|---|
| `architecture:ratchet` (legacy control) | exit 0, `pass = true`, **0 violations** |
| `architecture:observe` (truth) | 612 files, **1671** internal edges, 587 undeclared, semantic hash recorded |
| `architecture:enforce:shadow` | **PASS**, exit 0, no engine error |
| `architecture:enforce` | **PASS**, exit 0 — every inherited relation is grandfathered |

```text
findings_total 1677 = PASS_AS_GRANDFATHERED 1671 + NOT_YET_ENFORCED 5 + NON_SOURCE_ASSET 1
violations 0 · engine_errors 0 · NEW_REGRESSIONS 0
```

The inherited tree passes enforcement **while every grandfathered relation remains labelled as debt**, which is
the distinction the round exists to establish: `GRANDFATHERED != HEALTHY`.

## C9 — CONTROLLED REGRESSIONS: nine injections, nine expected codes

`POLICY_EXPERIMENT` + `REAL_HOST`. `scripts/architecture-phase1a-experiments.cjs`, isolated fixtures only.

| ID | Injection | Expected code | Shadow | Enforce | Rollback |
|---|---|---|---|---|---|
| EXP-01 | new undeclared source | `NEW_UNDECLARED_SOURCE` | exit 0 | non-zero | RESTORED |
| EXP-02 | declared → undeclared edge | `NEW_EDGE_UNDECLARED_ENDPOINT` | exit 0 | non-zero | RESTORED |
| EXP-03 | undeclared → declared edge | `NEW_EDGE_UNDECLARED_ENDPOINT` | exit 0 | non-zero | RESTORED |
| EXP-04 | undeclared → undeclared edge | `NEW_EDGE_UNDECLARED_ENDPOINT` | exit 0 | non-zero | RESTORED |
| EXP-05 | unauthorized cross-capability edge | `NEW_UNDECLARED_CROSS_CAPABILITY_EDGE` | exit 0 | non-zero | RESTORED |
| EXP-06 | ownership conflict | `OWNERSHIP_CONFLICT` | exit 0 | non-zero | RESTORED |
| EXP-07 | missing source target | `UNRESOLVED_SOURCE_TARGET_MISSING` | exit 0 | non-zero | RESTORED |
| EXP-08 | instrument failure | `SENSOR_INCOMPLETE` | exit 0 | non-zero | RESTORED |
| EXP-09 | raw-count compensation attack | `NEW_EDGE_UNDECLARED_ENDPOINT` | exit 0 | non-zero | RESTORED |

**9 of 9 passed**, every expected machine code observed, every rollback restored to the pre-mutation semantic
hash. Production architecture was never mutated: every injection is a temporary directory.

**A failure was found here too, and it is the kind this round is for.** The *first* run reported
`expected_codes_present 9/9` **and** `rollbacks_restored 0`, so all nine experiments were marked failed. The
rollback arm was hashing the **baseline** and comparing it with the **unmutated measurement** — two different
object shapes, so equality was impossible and the pass criterion could never be met. The fix is recorded in the
script beside the code. The lesson is worth keeping: the *machine codes* were right and the *harness's own
bookkeeping* was wrong, exactly as in `COR-1` and in the qualification harness at C5.

Two further construction defects were falsified by the tests rather than by review and are retained in place: the
enforcement suite initially read its assertions from the command's compact stdout summary instead of the artifact
the command writes (15 spurious failures), and the baseline series had to be reset from a bumped version 2 — whose
parent was an uncommitted work-in-progress file — back to a clean version 1, because a baseline chain must start
from an *accepted* state and not from a scratch file.

## C4 — SENSOR QUALIFICATION: the Phase 0 sensor is fit to carry a policy

`MEASUREMENT` + `FIXTURE`. Script: `scripts/architecture-observatory-qualification.cjs`; artifacts
`sensor-qualification.json` and `sensor-qualification-report.md`. Measurement acceptance is a weaker claim than
enforcement acceptance — a false **negative** would silently bless a regression and a false **positive** would
fail honest work — so the harness is deliberately adversarial.

| Gate | Result | Substance |
|---|---|---|
| Q-01 production corpus integrity | **PASS** | 612 scanned files, **612 instrumented read calls**, 0 read failures, 0 parse issues, **0 silent skips** |
| Q-02 adversarial syntax corpus | **PASS** | 14 of 14 **hand-labelled** cases: nested templates, a dynamic import inside a template hole, regex vs division, TSX self-closing/closing tags, JSX attributes, comments/strings/template text carrying import-like text, multiline and type-only imports, `export-from`, dynamic import, `require` including a non-call member access, Unicode identifiers, escaped strings and templates, dedup, and a negative control |
| Q-03 seeded mutation battery | **PASS** | **520 of 520** deterministic seeded cases across add / remove / duplicate / change-form and seven noise-only kinds, each asserting the **exact** `(from,to)` edge set |
| Q-04 independent disagreement detector | **PASS** | `BOTH` 1565 · `OBSERVER_ONLY` 106 · **`CROSSCHECK_ONLY` 0** · **unexplained disagreements 0** |
| Q-05 determinism | **PASS** | 5 consecutive real-tree runs, **1** unique semantic hash |
| Q-06 path/platform resolution | **PASS** | 19 cases — separators, `.js → .ts`, index, TSX/JSX, dot-segment normalisation, case preservation |
| Q-07 scope honesty | **PASS** | 8 assertions; the sensor's own `scripts/**` implementation, the tests, the manifests and `*.d.ts` are all outside the scan set |
| Q-08 resource measurement | **MEASURED** | wall time, output bytes and cheap memory metrics, **no invented threshold** |

**The result that matters most is `CROSSCHECK_ONLY = 0`.** That is the direction that would indicate a sensor
**false negative** — debt enforcement could never see — and the independent detector found none. The 106
`OBSERVER_ONLY` edges are the known, previously-recorded limit of the conservative regex (multi-line
import/export statements), and they are carried verbatim in the artifact rather than summarised away.

## C5 — QUALIFICATION FAILURES: the test was wrong, the sensor was right

`CORRECTION`. The **first** run returned `Q-01..Q-05 PASS`, **`Q-06 FAIL (2 cases)`**, `Q-07 PASS`,
`Q-08 MEASURED`, `ALLOWED_TO_PROCEED = false`. Every failing case was inspected verbatim rather than the
harness being adjusted until green:

| Case | Expected | Observed | Root cause |
|---|---|---|---|
| `./casename` | `null` | `unresolved:no-tracked-candidate` | the case encoded a `null` expectation instead of the resolver's documented unresolved outcome — a malformed expectation |
| `src/shared/shared-thing` | internal | `external` | the Phase 0 specification makes the bare-specifier rule **exact-match only**; an extensionless bare name is an external package specifier. The harness asserted extension-trying for bare specifiers, which the frozen sensor deliberately does not do |

**Both failures were defects in the test, not the sensor.** No sensor bug was found, so no Phase 0 semantic
control needed re-running and no correction to Phase 0 itself is owed. Both expectations were corrected **in the
harness source, carrying the word `CORRECTED` and the reason**, and a third case was added asserting the
exact-match rule from the other side (`src/shared/shared-thing.ts` is internal). The second run passed all eight
gates.

This is the qualification analogue of `COR-1`: the instrument was right and the expectation imposed on it was
wrong. Retaining the falsification inside the test file, rather than only here, is the point — a reader of the
tests sees that the harness has itself been falsified once.

---

# Reproduction

```powershell
git fetch --all --tags
git rev-parse city-start-baseline-v1^{commit}        # 53aa74a7f9628765a92210d16aabcc77ae98bae4
git rev-parse pre-city-baseline-v1^{commit}          # 7024203eee3444a0115664de5e3a3d6599d9a800
git rev-parse city-phase0-observatory-v1^{commit}    # 66440c1d360362a0bba38332d385feed41b64acb
node scripts/acceptance-evolution-bless.cjs --check  # needs dist-electron built from this tree
pnpm run architecture:ratchet                        # the control sensor, unchanged
pnpm run architecture:observe                        # the truth sensor
pnpm run architecture:enforce:shadow                 # prospective policy, report-only
pnpm run architecture:enforce                        # prospective policy, failing
git rev-parse city-phase1a-enforcement-v1^{commit}   # 5c1cc264448d979969595139ee8b27d7195216d1
```

---

# §H — Phase 1A promotion ceremony and freeze (appended after the fact)

**Provenance of this section, stated before its content.** It is appended to the same authoritative ledger —
not a second history system — from the branch `dev/city-phase1b-hosted-enforcement`, cut from the frozen tag
`city-phase1a-enforcement-v1`. Nothing above this line is modified, deleted or "corrected", including the
`FINAL_STATUS = WAITING_FOR_ROOT_OWNER_PHASE1A_PROMOTION` block that closes `C12`. That value was true when it
was written — the machine had opened the request and stopped at the Owner boundary — and it is preserved
exactly as written.

```text
PAST_REPORT = TRUE_AT_THE_TIME
NEW_RECORD  = SUBSEQUENT_STATE_TRANSITION
```

The same reason as `P0-17` applies to where this record lives: `main` is protected, and this programme does
not bypass protection. The freeze record therefore travels on the phase branch that will be promoted next,
and the authoritative copy of the ceremony remains this ledger.

## C13 — GOVERNANCE: the Root Owner promoted the Phase 1A candidate

`GOVERNANCE` + `REMOTE_GITHUB`. Each value below was re-measured from the remote in this round; none is
inherited from the request that preceded it.

| Field | Measured |
|---|---|
| PR | **#12**, `dev/city-phase1a-enforcement-convergence` → `main`, author **`codex-boss[bot]`**, opened `2026-09-22T08:50:35Z` |
| Request-time head | `40d0f7d099d63d74515c50a010de1d4da9294d97` — the SHA the promotion request bound, and the SHA recorded in `artifacts/city/phase1/phase1a-promotion-pr.json` |
| Candidate head **as merged** | `993d1e21cb4a08407588841ae39872aa469d61f6` — the head advanced twice after the request (`40d0f7d` → `f30f86d` at `08:51:22Z` → `993d1e2` at `09:27:29Z`), each step an evidence or ledger commit |
| Base | `main` @ `66440c1d360362a0bba38332d385feed41b64acb` |
| Owner review | `APPROVED`, review id `5276944387`, reviewer **`zhiheng-zhang-Mera`**, submitted `2026-09-22T10:41:34Z`, `commit_id 993d1e21…` |
| Merge | `merged = true`, `merged_at 2026-09-22T10:41:46Z`, `merged_by zhiheng-zhang-Mera` |
| Approval precedes merge by | **12 s**, and the approved commit is the actual merged tip (the last head push preceded the approval by 74 minutes) |
| Merge SHA | `5c1cc264448d979969595139ee8b27d7195216d1` |
| Merge parents | parent 1 `66440c1d360362a0bba38332d385feed41b64acb`; parent 2 `993d1e21cb4a08407588841ae39872aa469d61f6` |
| Merge tree | `3ca3372d3ccf2be9adc3b0a9bf0cbcc736717953` — **identical to the certified candidate tree**, so the merge introduced no conflict resolution and no unmeasured content |
| Merge-base | `66440c1d…` (= parent 1), so the merge is content-additive over the certified candidate |
| GitHub signature | `verification.verified = true`, reason `valid`, committer `GitHub <noreply@github.com>` |
| File delta | **13 files**, `+10720 / −5` |

`prepare != authorize` holds again, on a second and much larger change: the machine opened the request and
could not approve or merge it, and a distinct human principal did both.

**A precision the request artifact does not carry, recorded rather than smoothed.** The promotion request
bound `40d0f7d`; the Owner approved and merged `993d1e2`. Both are true statements about different moments,
and the difference is two evidence commits pushed after the request. A later reader comparing the request
artifact with the merge would otherwise see a mismatch that is not one.

## C14 — POST-MERGE HOSTED CI: four required contexts, one SHA

`REMOTE_GITHUB`. Desktop CI run **`35717399512`**, event `push`, `head_branch main`,
`head_sha 5c1cc264448d979969595139ee8b27d7195216d1`, `completed` / `success`, started `10:41:49Z`, finished
`10:58:12Z`.

| Job | Result | Window |
|---|---|---|
| `quality` | success | `10:41:52Z` → `10:42:32Z` |
| `unit` | success | `10:42:36Z` → `10:51:37Z` |
| `acceptance` | success | `10:51:41Z` → `10:58:11Z` |
| `package` | success | `10:51:40Z` → `10:52:30Z` |

All four ran on the merge SHA itself, and all four are the contexts the `Main-Protection` ruleset requires
(`integration_id 15368`), so the promotion is certified by the same checks that gate every future merge.

**Hosted enforcement was not activated by the promotion**, measured rather than asserted:
`.github/workflows/ci.yml` is byte-identical at `66440c1d…` and `5c1cc26…`
(blob `ff344cc08e50e5a0a9de576f0b86d6004fb6bab5`), and `architecture:enforce`, `architecture:enforce:shadow`,
`architecture:observe` and `architecture:qualify` appear in **no** workflow file. The legacy architecture gate
is enforced only as the step `pnpm run architecture:ratchet` **inside** the required `quality` job; there is no
separate architecture check. Architecture migration is not started.

```text
PHASE1A                = PROMOTED
PROSPECTIVE_ENFORCEMENT = PROMOTED
PROMOTION              != HOSTED_GATE_ACTIVATION
HOSTED_REQUIRED_GATE   = LEGACY
ARCHITECTURE_MIGRATION = NOT_STARTED
```

## C15 — TAG FREEZE: `city-phase1a-enforcement-v1` (annotated, unmoved)

`GOVERNANCE`. The tag was absent from the remote before this round, so this is a creation and not an
idempotent pass; no existing tag was moved, and `city-phase0-observatory-v1` was re-resolved and is unchanged.

| Field | Measured from the remote |
|---|---|
| Tag | `city-phase1a-enforcement-v1` |
| Tag object | `884227cb3e77f209b58ea071a64dfbaeacba9fda`, `objecttype = tag` (annotated) |
| Tag target | `5c1cc264448d979969595139ee8b27d7195216d1`, `targettype = commit` |
| Peeled remote ref | `refs/tags/city-phase1a-enforcement-v1^{}` → `5c1cc26…` |
| Target is an ancestor of `main` | yes (`git merge-base --is-ancestor`, exit 0), and equals `origin/main` exactly |
| Phase 0 tag | `city-phase0-observatory-v1` → object `24bc1b9145cff314b389a373bf355390f55cd5cf` → `66440c1d…`, an ancestor of the new target, unmoved |
| No force, no move, no delete-and-recreate | confirmed: one creation push, `* [new tag]` |

## C16 — FREEZE VERIFICATION on the promoted `main` (local real host)

`MEASUREMENT` + `REAL_HOST`. Re-executed non-destructively against the frozen commit, on the Mech host, with
nothing else competing for the machine. The hosted runs at C14 are the hosted half of this evidence; this is
the local half.

| Check | Result |
|---|---|
| worktree | clean; `main` @ `5c1cc264448d979969595139ee8b27d7195216d1` == `origin/main` |
| tag resolution | annotated, target `5c1cc26…`, ancestor of `main` (C15) |
| Root Trust | epoch **24** (`boss-root-trust-24`) `MATCHES`; 63 files; aggregate `6eaf71e9…d457` |
| baseline currency | `--check` → `identical: true`, `hash_matches: true`, version 1, 612 files, 1671 edges, hash `b211c052…9f4e` |
| legacy control | `architecture:ratchet` → PASS, `violations: []` |
| truth sensor | `architecture:observe` → PASS, 1671 observer-only edges, 587 undeclared, semantic hash `21eac0cb…8381` |
| shadow policy | `architecture:enforce:shadow` → PASS, `findings 1677 = 1671 + 5 + 1`, violations 0, engine errors 0 |
| enforce policy | `architecture:enforce` → PASS, exit 0, identical summary |
| test catalogue | current at **278 suites** |
| default unit tier | **262 files / 3321 tests / 0 failures**, exit 0, 209 s |
| slow tier | **4 files / 35 tests / 0 failures**, exit 0, 196 s |
| `ci.yml` still not an enforcement gate | blob unchanged (C14) |

**Apparatus note, recorded rather than absorbed.** `pnpm` is not installed on this host (only `node` and
`corepack`), so the tiers were invoked through the repository's own local binaries with exactly the commands
`pnpm test` and `pnpm run test:slow` resolve to. The measured object is unchanged; the invocation path differs.
A later reader reproducing these rows from the acceptance record's `pnpm` commands will need the same
substitution on this host.

## C17 — FAILURE + HOSTED_PARITY: the tag push re-ran the whole gate, and the slow tier failed on the second runner

`FAILURE` + `HOSTED_PARITY` + `GOVERNANCE`. Recorded in full, because the interesting part is not the failure.

Pushing the annotated tag triggered `Desktop CI` a second time on the same commit — `.github/workflows/ci.yml`
declares `on: push` with no branch or tag filter, so an administrative freeze act schedules the full four-job
gate. Run **`35731576930`**, event `push`, `head_branch city-phase1a-enforcement-v1`,
`head_sha 5c1cc26…`, conclusion **failure**.

| Job | Result on the same SHA |
|---|---|
| `quality` | success (`13:08:53Z` → `13:09:36Z`) |
| `unit` | **failure** (`13:09:39Z` → `13:18:12Z`) |
| `acceptance` | skipped |
| `package` | skipped |

The failing assertion is `tests/unit/platform/platform-soak.test.ts:201` —
`expect(result.totals.recoveredCircuits).toBeGreaterThan(0)` → `AssertionError: expected 0 to be greater than 0`
— in the slow tier, in the suite that runs the whole platform soak. It is the same *shape* as the C11
addendum's transient: a timing-window assertion in a soak suite, starved on a hosted runner, in a suite this
programme did not touch.

**The discriminator, gathered before any conclusion:**

1. **The same SHA passed this exact tier on another runner.** Run `35717399512`, runner `GitHub Actions
   1000001524`, `unit` success — including this test.
2. **The same frozen tree passes locally.** The slow tier on the real host: 4 files / 35 tests / 0 failures,
   `distinguishes a recovered provider from a crash loop` green in 15.3 s. The default tier: 3321/3321.
3. **The failure is a throughput signature, not a correctness signature**: a circuit that should have opened
   and recovered had not yet recovered inside the observed window, and the file itself ran for 128 s.

**The decision, and why.** The failed job was **not** re-run. The C11 addendum re-ran its transient because a
retry was the cheapest way to obtain a second runner's verdict; here a second runner's verdict already exists
on the identical SHA, so a re-run would buy no new information while replacing a visible red result with a
green one. A transient is recorded as-is and retry history is not hidden. The red run stands, is named here,
and the Owner may re-run it — that too would be recorded.

**The governance consequence is the durable part, and it is not about this test.** On the frozen SHA the
`unit` context now exists twice, with opposite conclusions and zero content difference:

```text
run 35717399512  push -> main                              unit = success
run 35731576930  push -> tag city-phase1a-enforcement-v1   unit = failure
```

So *"check X succeeded on SHA Y"* is not a certifying statement. A certification must name the **run**: check
name, SHA, run id, conclusion. Phase 1B inherits this as a specification requirement rather than rediscovering
it, and the ledger records it here as a measured property of the apparatus — the same family as the C11
addendum, one level up.

## C18 — PHASE 1B SPECIFICATION: one commit, spec only, cut from the frozen tag

`DOCUMENTATION`. Branch `dev/city-phase1b-hosted-enforcement`, cut from `city-phase1a-enforcement-v1`, with
branch point measured at `5c1cc264448d979969595139ee8b27d7195216d1` and equal to the tag target.

```text
PHASE1B_SPEC_COMMIT = 49ef99a
PHASE1B_SPEC_PATH   = docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md
FILES_CHANGED       = 1   (the specification, and nothing else)
SPEC_ONLY           = TRUE
IMPLEMENTATION      = 0
```

The specification contains no workflow change, no package script, no test, no `CODEOWNERS` change, no ruleset
change, no Root Trust mutation and no production code. It fixes the parts a later implementation may not
re-decide: which of the four roles enters hosted CI and how (a separate `architecture` job with its own check
identity, not a step inside the already-required `quality` check); the activation preconditions and which of
them are Owner ceremonies; the fail-closed table and the rule that an engine failure is never a skip;
`GRANDFATHERED != HEALTHY` with the no-washing rules; baseline-evolution governance; four hosted rollout
stages with entry and exit conditions; the measured required-check identity; the Root Trust surface and epoch
mechanics; emergency rollback; the Owner boundary; and acceptance criteria `PB-AC-01..20`.

**Two defects are written into it with their evidence rather than as principles**, both measured this round:

| Defect | Measured at this freeze |
|---|---|
| the baseline-laundering path is available to an autonomous actor | the plain invocation of `scripts/architecture-enforcement-baseline.cjs` regenerates the tracked baseline and records the current tree as grandfathered, bumping `baseline_version` and adopting the previous hash as parent; `--reason` has a default; nothing in any workflow or tier runs `--check`; and `--check` proves only self-consistency, which a regenerated baseline satisfies by construction |
| the gate's own machinery is not Owner-bound | `config/architecture-enforcement-baseline.json`, `scripts/architecture-enforcement.cjs`, `scripts/architecture-enforcement-baseline.cjs`, `scripts/architecture-observatory.cjs` and `scripts/architecture.cjs` all classify `AUTONOMOUS_MUTABLE` under the repository's own authority classifier, and none appears in `CODEOWNERS` — while `.github/workflows/ci.yml` and `trust-policy/**` are already `ROOT_TRUST_SURFACE` |

The second is the more consequential: a required gate assembled from autonomously mutable parts is
enforceable but not Owner-bound, because the machine could edit the judge.

## §H — checkpoint table

| Checkpoint | State |
|---|---|
| `C13` Phase 1A promotion ceremony | **COMPLETE** — approved `10:41:34Z`, merged `10:41:46Z`, merge `5c1cc26…` |
| `C14` post-merge hosted CI | **PASS** — run `35717399512`, four required contexts success on the merge SHA |
| `C15` Phase 1A immutable tag | **FROZEN** — annotated `884227cb…` → `5c1cc26…`, absent before, unmoved |
| `C16` freeze verification | **PASS** — local real host, all rows above |
| `C17` tag-push rerun | **FAILURE recorded** — run `35731576930`, `unit` red on the same SHA; classified hosted-runner timing flake with the discriminator shown; not re-run |
| `C18` Phase 1B specification | **COMMITTED** — `49ef99a`, one file, spec only |
| Phase 1A promotion verified | **YES** |
| Phase 1A history | **APPEND-ONLY** — no earlier record modified |
| Phase 1B implementation | **NOT_STARTED** |
| Architecture migration | **NOT_STARTED** |

```text
PHASE0 = PROMOTED_AND_FROZEN
PHASE1A = PROMOTED_AND_FROZEN

SENSOR = ENFORCEMENT_QUALIFIED
GRANDFATHERED_DEBT_BASELINE = FROZEN
PROSPECTIVE_ENFORCEMENT = PROMOTED_NOT_HOSTED

HOSTED_REQUIRED_GATE = LEGACY

PHASE1B_SPEC = READY
PHASE1B_IMPLEMENTATION = NOT_STARTED
ARCHITECTURE_MIGRATION = NOT_STARTED

FINAL_STATUS = PHASE1A_FROZEN_PHASE1B_SPEC_READY
```

**The C12 block above is not superseded — it is dated.** It recorded a true state at `08:50Z`; this section
records the state after `10:41:46Z`. Both remain, in order, because the transition between them is the
evidence.

---

# §I — Phase 1B-A governance foundation (this phase)

**Scope of this phase, stated as two questions rather than as a feature list:**

```text
CAN THE JUDGE MODIFY ITSELF?        previously YES (AUTONOMOUS_MUTABLE)   -> now OWNER-GATED
CAN THE MACHINE LAUNDER THE BASELINE?  previously YES (regenerate and commit) -> now CLOSED mechanically
```

Nothing else was attempted. The hosted architecture job was **not** added, no required check was activated, the
ruleset was **not** touched, `ci.yml` was **not** modified, and no architecture was migrated.

## I-1 — AUTHORITY_BOUNDARY: the measured starting state, with the repository's own classifier

`MEASUREMENT`. Before this phase, every part of the enforcement apparatus was autonomously mutable. Measured
with the repository's own compiled classifier (`classifyAuthorityPath` / `classifySurface`, built from the tree
at `2f915ec`), not argued from the file layout:

| Path | was | is now |
|---|---|---|
| `config/architecture-enforcement-baseline.json` | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture-enforcement.cjs` | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture-enforcement-baseline.cjs` | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture-observatory.cjs` | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture.cjs` (legacy sensor) | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `config/architecture-baseline.json` (legacy baseline) | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture-baseline.cjs` (its only writer) | `PRODUCT_SURFACE` / `AUTONOMOUS_MUTABLE` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |
| `scripts/architecture-baseline-series.cjs` (authorization) | did not exist | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` |

**The negative control is part of the claim.** The same measurement, same classifier, after the change:
`config/capabilities/*` and `scripts/architecture-observatory-qualification.cjs` remain `PRODUCT_SURFACE` /
`AUTONOMOUS_MUTABLE`, and `docs/**` remains writable by the machine. A boundary that swallowed the repository
would be as useless as one that protected nothing, so the suite asserts both directions
(`tests/unit/city/architecture-governance-boundary.test.ts`).

**The two boundaries had to move together, and the first attempt only moved one.** The host guard unions the
compiled manifest with `.github/CODEOWNERS`; a path protected in only one of them is protected only on the
paths that happen to consult that half. Both were extended with the same nine entries, and the suite asserts
each path through **both** matchers — the compiled manifest *and* the real `CODEOWNERS` parsed with GitHub's
matching rules.

## I-2 — BASELINE_LAUNDERING: the closure, and what it now costs to launder

`POLICY_EXPERIMENT` + `FINDING`. The attack, and the eight ways it was tried:

```text
BEFORE:  CI fails on new debt -> run `architecture:enforce:baseline` (no reason needed)
         -> the current tree is recorded as grandfathered, version bumped, parent adopted
         -> commit -> CI passes.   Nothing in any workflow or tier ever ran `--check`.
```

The closure is **not** a new check. It is that the tracked baseline can no longer be written by a naked
invocation at all:

| Invocation | Before | After (measured) |
|---|---|---|
| `architecture:enforce:baseline` (no arguments) | rewrote the tracked baseline, defaulting the reason | **exit 2**, "a reason is required"; the tracked file is untouched |
| `--reason "update"` | accepted | **exit 2**, placeholder refused |
| `--reason "<real text>"` | rewrote the tracked baseline | writes a **candidate** under `artifacts/city/phase1/`, `governs: false` |
| `--out <path>` | wrote elsewhere (tests) | candidate semantics, unchanged for the existing suite |
| `--accept` | did not exist | writes the tracked baseline **only if** an ACCEPTED series entry already names the exact `(version, parent, hash)`; otherwise `BASELINE_SERIES_UNAUTHORISED`, `written: false` |
| `--check` | self-consistency only | self-consistency **and** authorization, reported as two separate fields |
| `architecture:enforce` (both modes) | enforced whatever baseline it read | refuses an unauthorized baseline with `BASELINE_SERIES_UNAUTHORISED`, non-zero in **both** modes |

**The measured refusal, verbatim from the probe run** (a no-op regeneration of an unchanged tree, which is the
weakest possible form of the attack):

```text
state: BASELINE_ACCEPTANCE_REFUSED
baseline_version: 2   parent_baseline_hash: b211c052…9f4e   baseline_hash: 9ba4561793a0…
codes: [BASELINE_SERIES_UNAUTHORISED]
written: false
"the tracked baseline was not touched"
```

A regeneration that changes nothing still cannot become governing without an Owner-reviewed series entry.
`BASELINE_SERIES_UNAUTHORISED` is an `ENGINE_ERROR`, not a policy violation: a gate that cannot establish what
governs must not report a verdict about the change.

**The fixture seam is one-directional, and that was a design decision with a measured consequence.** The
governing path refuses `--authorizations` outright. Had it honoured the override, any caller could satisfy the
check with a series of its own choosing. The cost of closing it is that both fixture harnesses must declare
their own series explicitly — `tests/unit/city/architecture-enforcement.test.ts` (21 ENF tests, all still
green) and the C9 battery (`scripts/architecture-phase1a-experiments.cjs`, **9/9** injections still producing
their expected codes, 9/9 rollbacks restored). Tests that inject state now say so.

## I-3 — FAILURE + CORRECTION: the head rule was wrong, and the test that caught it was mine

`FAILURE` + `CORRECTION`. The first `assessAcceptance` required the committed baseline to equal the **head of
the accepted series**. But authorization must exist *before* acceptance, so at the moment of acceptance the
series already contains the candidate's entry and the candidate **is** the head; the state it builds on is its
**parent** entry. As written, acceptance was impossible — every acceptance would have been refused with
`BASELINE_HEAD_NOT_TRACKED`.

The failure was caught by the suite's own positive control (`control: a properly authorized, monotone evolution
IS accepted`), which failed while all eight attack cases passed. That asymmetry is the lesson: a suite made only
of attacks is satisfied by a rule that refuses everything.

This is the **sixth instance** of the pattern this programme keeps meeting — `COR-1`, the C5 qualification
harness, the C9 rollback arm, `B-1..B-5`, the C10 citation gate — and it is the first one in which the
apparatus was a *governance rule* rather than a measurement: **the apparatus was wrong and the measured object
was right**, again, and again the remedy was to correct the apparatus rather than the expectation.

## I-4 — FAILURE: an assertion that could not be true, for a reason worth knowing

`FAILURE` + `MEASUREMENT`. The boundary suite first asserted that each judge path is matched by a
`CODEOWNERS` pattern by inspecting `assessProtectedPaths(...).hits` for `source === "codeowners"`. That
assertion **cannot** hold for a path the compiled manifest also protects: `assessProtectedPaths` returns after
the first matching rule (`// one rule per path is enough evidence`) and the manifest is compiled first, so
`source` is always `"immutable-manifest"` for exactly the paths that are protected by both halves.

The remedy was not to weaken the check but to test the half it was actually about: the real
`.github/CODEOWNERS` is now parsed and matched with the same `codeownersPatternToRegExp` compiler the guard
uses, and each judge path must be matched **either** by a line naming it exactly **or** by a pre-existing
directory rule (`/trust-policy/`). A blanket `/scripts/` or `/config/` rule fails the assertion, which is what
keeps the block from quietly becoming a directory sweep.

## I-5 — CORRECTION: the citation gate fired on this phase's own comment

`CORRECTION`. `tests/unit/comment-citation.test.ts` failed with
`scripts/architecture-baseline-series.cjs: 1 (baseline 0)` and `bare section citations: 1309 (baseline 1308)` —
a new comment of mine cited "§7.1/§7.2" without naming a document. The baseline was **not** raised and the gate
was **not** touched; the comment was rewritten to name
`docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md` and its section in words. Second instance of the C10 pattern in
this programme: the gate was right and the work was wrong.

## I-6 — GOVERNANCE: the machine derived the next epoch and did not write it

`GOVERNANCE` + `AUTHORITY_BOUNDARY`. Extending the Root Trust Surface necessarily moved the aggregate:

```text
before : epoch 24 certifies 6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457  (63 files)
after  : live surface        37c98265224877d404f52a6016862cede85b5c7c4a0c864a664eb52fbf6b7741  (72 files)
verdict: TRUST_EPOCH_ROOT_SURFACE_MISMATCH
```

The machine then did exactly what the lockdown permits and no more:

| Act | Performed? | Evidence |
|---|---|---|
| measure the live surface and the drift | **yes** | `acceptance-evolution-bless.cjs --check` → mismatch, exit 1 |
| write a Stage A proposal | **yes** | `trust-migration-proposal.cjs` → `needsMigration=true`, `authorized=false`, candidate epoch **25**, parent `33beb3028f3e7c334e9ea5441fd5397a232cbbf788eae1d0482c45fe2f66593d` |
| leave the committed epoch byte-identical | **yes** | the proposal wrote `artifacts/**` only; `git status trust-policy/trust-epoch.json` empty |
| derive the candidate epoch in a test | **yes** | `advanceTrustEpoch` is pure; the suite asserts `trust_epoch 25`, `parent_epoch_hash == epoch 24's hash`, and that the candidate **does** anchor the extended surface |
| run `--advance` | **no** | `tests/unit/root-trust-authority-lockdown.test.ts` case 2: an autonomous actor finalizing a trust epoch is `DENY` |
| approve the environment / merge | **no** | Owner-only, and not attempted |

**The sequencing constraint that makes this a two-act ceremony, measured this round.** A candidate could not
simply be committed alongside the surface change, because the only mechanism that advances an epoch under
external authority (`.github/workflows/trust-epoch-finalization.yml`) is `workflow_dispatch` on
`refs/heads/main` and measures **main's** surface — so it cannot anchor a branch. The Owner's path is therefore:
merge the surface extension (whose epoch-anchor checks are red *by design*, see I-7), then dispatch the
finalization, which opens the epoch PR, then merge that.

## I-7 — The expected-red set, named before the hosted run

`MEASUREMENT` + `HOSTED_PARITY`. Because the epoch is deliberately stale, exactly two existing assertions about
the *current* state of the repository fail, both for the same designed reason and neither a regression:

| Check | Assertion | Measured |
|---|---|---|
| unit (default tier) | `tests/unit/test-layers.test.ts` — "keeps the graduation gate in push CI and the committed epoch anchored to the live surface" | **1 failed / 3359 passed / 264 files** |
| postbuild tier | `tests/unit/root-trust-authority-lockdown.test.ts` — "does not change the epoch when the committed one already anchors the surface" | **1 failed / 119 passed / 8 files** |

Both are `TRUST_EPOCH_ROOT_SURFACE_MISMATCH` / `currentEpochAnchorsLiveSurface: false`. They turn green when
the Owner advances the epoch; they are the *reason* the ceremony exists rather than an obstacle to it. The
phase does **not** depend on pretending they are green, and neither they nor the threshold behind them were
modified.

Every other gate measured green on this tree: `typecheck` (three projects), tracked-secret scan (1311 files),
`state:probe`, test catalogue (280 suites, 27/27 capabilities), `architecture:ratchet` (`violations: []`),
`architecture:observe` (612 scanned files, 1671 edges), `architecture:enforcement --check` (self-consistent
**and** authorized), `architecture:enforce:shadow` and `architecture:enforce` (PASS, findings 1677, violations
0), the C9 battery 9/9, ENF-01..ENF-18 21/21, and the two new governance suites 22/22 and 16/16.

## I-8 — MEASUREMENT: what the two hashes are sensitive to

`MEASUREMENT`. Recorded because both numbers get cited as evidence and they do not move together:

```text
editing scripts/architecture-baseline-series.cjs   -> Root Trust aggregate b1e8a5ca… -> 37c98265…  (72 files)
adding two ordinary unit-test files                -> observatory semantic_hash 21eac0cb… -> ac115cc8…
                                                   -> accepted baseline: unchanged (612 files / 1671 edges)
```

The observatory's semantic hash covers the tracked-file inventory, so any new tracked file moves it. The
enforcement baseline covers the **scan set** and the resolved graph, so it does not. That asymmetry is
load-bearing: a baseline that moved whenever an unrelated file was added would be unusable as a ratchet, and a
semantic hash that did not move would not be a hash of the measurement.

## I-9 — DEFECT recorded and NOT fixed: the documented generation mode resets the epoch chain

`FINDING`. `tests/acceptance/autonomous-evolution-trust.test.ts` documents
`BOSS_GENERATE_EVOLUTION_TRUST=1` as the way to re-bless the committed trust data. Its `writeTrustPolicyData`
builds the epoch with `advanceTrustEpoch({ previous: null, … })` — a **genesis** epoch, `trust_epoch: 1`, no
parent. Running the documented generation mode after any epoch history exists would replace epoch 24 with epoch
1 and break the append-only chain.

This phase therefore regenerated **only** the declaration mirror, from the module's own
`declaredRootTrustSurface()`, and did not run the generation mode. Fixing the generation mode is a change to a
Root Trust test file and would itself need an epoch, so it is a separate governance act; it is recorded here
rather than repaired inside a phase whose subject was a different boundary.

## I-10 — HISTORY: the Phase 1A flake record is untouched, and this phase does not depend on it

`REPRODUCTION` + `FAILURE` (carried forward). Run `35731576930` (the tag push of
`city-phase1a-enforcement-v1`, `unit` red in the slow tier on the frozen SHA) remains in the record at `C17`,
unmodified. Nothing in this phase deleted it, re-ran it into green, quarantined `platform-soak.test.ts`, or
weakened a threshold. `PHASE1B-A` does not depend on that run never having happened: the laundering closure and
the authority boundary are properties of the tree, and the epoch ceremony is a property of the surface hash.

## I-11 — GOVERNANCE: commit provenance changes from here

`GOVERNANCE`. From this phase's construction commits onward, the implementation commits carry an explicit
**machine/developer** author rather than the local git identity that resembles the Root Owner's own hand:

```text
IMPLEMENTATION AUTHOR = Codex-Boss (machine/developer identity)
PR OPENER            = the machine identity, or — where that credential is not provisioned — recorded as such
ROOT OWNER REVIEW    = zhiheng-zhang-Mera
ROOT OWNER MERGE     = zhiheng-zhang-Mera
```

The boundary that matters is unchanged and is not the author field: authorization still comes from the
**credential** that opens and pushes, the **Owner review** on the protected paths, and the **ceremony** that
advances the epoch. Commit metadata is attribution, not authority — which is exactly why the change is
cosmetic and why it is recorded instead of being presented as a control.

## I-12 — checkpoint table

| Checkpoint | State |
|---|---|
| `1B-A.1` baseline laundering closed | **COMPLETE** — candidate/accepted split, reason required, `--accept` gated by a pre-existing series entry |
| `1B-A.2` series authorization | **IMPLEMENTED** — `trust-policy/architecture-enforcement-baselines.json`, v1 bootstrapped from the PR #12 promotion |
| `1B-A.3` judge Owner-bound | **CANDIDATE** — nine paths in the classifier, the compiled manifest and `CODEOWNERS`; tests green |
| `1B-A.4` Root Trust Surface extended | **COMPLETE** — 63 → 72 files, aggregate `6eaf71e9…` → `37c98265…` |
| `1B-A.5` epoch | **WAITING_FOR_OWNER** — candidate epoch 25 prepared, parent `33beb302…`, committed epoch untouched |
| `1B-A.6` adversarial suites | **GREEN** — A1..A8 (22 tests), B1..B9/C1..C4/negative control (16 tests) |
| `1B-A.7` hosted architecture job | **NOT ADDED** |
| `1B-A.8` ruleset / `ci.yml` | **UNCHANGED** |
| `1B-A.9` architecture migration | **NOT_STARTED** |

```text
PHASE1B_A = GOVERNANCE_FOUNDATION_CANDIDATE

BASELINE_LAUNDERING = CLOSED
JUDGE_SELF_MODIFICATION = OWNER_GATED
BASELINE_SERIES = OWNER_AUTHORISED (v1)

ROOT_TRUST_SURFACE_EXTENSION = PREPARED
ROOT_TRUST_EPOCH_CANDIDATE = READY (epoch 25, parent 33beb302…)
ROOT_TRUST_EPOCH = WAITING_FOR_OWNER_FINALIZATION

HOSTED_ARCHITECTURE_JOB = NOT_STARTED
HOSTED_REQUIRED_GATE = LEGACY
ARCHITECTURE_MIGRATION = NOT_STARTED

FINAL_STATUS = WAITING_FOR_ROOT_OWNER_TRUST_EPOCH_CEREMONY
```

## I-13 — HOSTED_PARITY: the prediction, and what the hosted run actually said

`HOSTED_PARITY` + `MEASUREMENT`. The prediction in I-7 was written **before** the push, so the comparison is
evidence rather than narration. Desktop CI run **`35743903897`**, event `push`, `head_sha 69b8aac…`:

| Job | Result | Detail |
|---|---|---|
| `quality` | **success** | typecheck (three projects), secret scan, `architecture:ratchet`, `state:probe` |
| `unit` | **failure** | the single failing assertion is `tests/unit/test-layers.test.ts:430` — the epoch anchor |
| `package` | skipped | `needs: unit` |
| `acceptance` | skipped | `needs: unit` |

**Prediction versus measurement, stated rather than reconciled:** I-7 predicted *two* red assertions (one in the
default tier, one in the postbuild tier) and the hosted run surfaced **one**, because the workflow runs
`pnpm test`, `pnpm run test:postbuild` and `pnpm run test:slow` as sequential steps and a failing step stops the
job. The postbuild failure is therefore real but **not observable in this run**; it was observed locally
(`1 failed / 119 passed`). Both are the same assertion of the same fact — `TRUST_EPOCH_ROOT_SURFACE_MISMATCH` —
and both clear when the epoch is advanced.

**What the hosted run does and does not establish.** It establishes that the only thing standing between this
branch and a green chain is the epoch ceremony: `quality` is green on the real runner, and the failing
assertion is the invariant the ceremony exists to satisfy, not a defect this phase introduced. It does **not**
establish that `acceptance` and `package` would be green, because `needs: unit` skipped them; that remains an
inference from the local battery (slow tier 35/35 green, `package` independent of the trust epoch), and it is
labelled as an inference.

**The red result is left standing, in the same spirit as C17.** Nothing was re-run to turn it green, no
threshold was lowered, and no test was quarantined. A run that says "the epoch does not anchor this surface" is
the run this phase intended to produce, and the Owner's ceremony is what changes it.

## I-14 — FINDING: the Owner's own finalization workflow cannot commit its proposal artifact

`FINDING` + `FAILURE` (found while preparing the ceremony, recorded rather than repaired). Phase 1B-A ends at
the epoch boundary, so the path the Owner will take out of that boundary was checked — and one step of it does
not work as written.

`.github/workflows/trust-epoch-finalization.yml`, Stage B, contains:

```powershell
git add trust-policy/trust-epoch.json artifacts/platform-foundation/trust/trust-migration-proposal.json
```

`artifacts/` is gitignored in this repository (`.gitignore:23`), so `git add` refuses that pathspec. Measured in
a scratch repository carrying the same `.gitignore`:

```text
$ git add tracked.json artifacts/platform-foundation/trust/trust-migration-proposal.json
The following paths are ignored by one of your .gitignore files:
artifacts
hint: Use -f if you really want to add them.
exit 1        (tracked.json staged; the ignored path not staged)
```

Two consequences, and the second is the one that matters:

1. The proposal artifact — the machine-readable record of *why this epoch was advanced*, which the workflow's
   own comment calls the thing the finalization run uploads as evidence — is never committed by that step. It
   survives only as a workflow artifact upload.
2. Whether the step **fails** or merely reports an error depends on the runner's native-command error
   preference (`$PSNativeCommandUseErrorActionPreference` behaviour differs across PowerShell versions). With
   `shell: pwsh` and a terminating preference, the script stops before `git commit`, and the finalization
   cannot complete at all; without it, the epoch still commits and the step is merely noisy. That ambiguity is
   itself the defect: a governance step whose success depends on a shell preference is not a step a Root Owner
   should have to debug during a ceremony.

**Not repaired here, deliberately.** The file is a governance workflow whose owner is the Root Owner, and the
mission for this phase ends at the epoch boundary rather than inside the ceremony. The remedy is one line —
drop the ignored path from `git add`, or add it with `-f` — and it is the Owner's act to make it. It is
recorded here because Part E asks for exactly this class of discovery: a constraint in the trust machinery that
was not visible from the specification and would otherwise have been found by the Owner at the moment they
tried to use it.

**The alternative route is unaffected, and is the one the repository's own `ci.yml` comment describes.**
`node scripts/acceptance-evolution-bless.cjs --advance` establishes the next epoch from the measured live
surface; committed **together with** the surface change, it is the cadence the `ci.yml` comment attributes to
epochs 11 and 13, and it needs no workflow at all. It is a Root Owner act: the lockdown's case 2 makes an
autonomous actor running `--advance` a `DENY`, which is precisely why this phase prepared the epoch and stopped.

---

# §J — Phase 1B-A freeze, and the governance exception that promoted it (Mission-4C, Part A)

**Scope of this section.** Part A of Mission-4C has two acts and no others: re-measure the promoted state from
GitHub and the local repository, and freeze it. It adds no workflow, no script and no test. Nothing in §I is
superseded; this section records what the promotion itself did, and it is appended rather than woven into §I
because §I recorded a *candidate* and this records a *promotion*.

## J-1 — `MEASUREMENT` + `REMOTE_GITHUB`: the promoted state, re-measured before any mutation

Every row below was read from GitHub or the local repository on this round, **not** carried forward from §I. The
point of re-measuring is that a freeze tag on an unverified SHA freezes a claim rather than a state.

| Fact | Measured value | How |
|---|---|---|
| `origin/main` | `b5b511d750f11a7573b24e7b04c545b44d73b3da` | `git rev-parse origin/main` after `git fetch origin --prune --tags` |
| PR #13 state | `MERGED` | `gh pr view 13` |
| PR #13 merge commit | `b5b511d750f11a7573b24e7b04c545b44d73b3da` | `gh pr view 13 --json mergeCommit` |
| PR #13 head | `9e22604b5ead8382ac3719f48c6803e8051c41ce` | `gh pr view 13 --json headRefOid` |
| PR #13 author | `zhiheng-zhang-Mera` | `gh pr view 13 --json author` |
| PR #13 merged by | `zhiheng-zhang-Mera`, `2026-09-23T00:18:56Z` | `gh pr view 13 --json mergedBy,mergedAt` |
| merge parents | `5c1cc264448d979969595139ee8b27d7195216d1`, `9e22604b5ead8382ac3719f48c6803e8051c41ce` | `git rev-list --parents -n 1 b5b511d…` |
| parent count | 2 (a real merge, not a squash or a fast-forward) | same |
| merge commit message | `Merge pull request #13 …` + `This is a governance exception merge, opened and bypass authorized by owner` | `git log -1 --format=%B b5b511d…` |
| post-merge CI run | `35801514014`, event `push`, head `b5b511d…`, `completed/success` | `gh run view 35801514014` |
| `quality` | success | `gh run view 35801514014 --json jobs` |
| `unit` | success | same |
| `acceptance` | success | same |
| `package` | success | same |
| Root Trust epoch | `25`, `MATCHES` the live surface, aggregate `37c98265224877d404f52a6016862cede85b5c7c4a0c864a664eb52fbf6b7741`, 72 files | `node scripts/acceptance-evolution-bless.cjs --check` |
| baseline series v1 | `BASELINE_SERIES_AUTHORISED`, `authorized: true` | `node scripts/architecture-baseline-series.cjs --check` |
| accepted baseline hash | `b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e`, version 1, null parent | both commands above |
| baseline self-consistency | `identical: true`, `hash_matches: true`, `self_consistent: true`, 612 tracked source files, 1671 internal edges | `node scripts/architecture-enforcement-baseline.cjs --check` |
| ruleset `22746755` (`Main-Protection`) required contexts | `quality`, `unit`, `acceptance`, `package` | `gh api repos/…/rulesets/22746755` |

No row differed from the mission's starting assumptions, so Part A was not blocked by an evidence mismatch.

```text
PART_A_EVIDENCE_MISMATCH = NONE
PHASE1B_A_PROMOTION = VERIFIED_FROM_GITHUB
POST_MERGE_CERTIFYING_RUN = 35801514014
```

## J-2 — `GOVERNANCE_EXCEPTION`: PR #13 was merged inside the self-review deadlock, and that is the evidence

`AUTHORITY_BOUNDARY` + `GOVERNANCE_EXCEPTION`. PR #13 was authored by `zhiheng-zhang-Mera`, and
`zhiheng-zhang-Mera` is the **sole CODEOWNER** of every path the PR touched (`.github/workflows/**`,
`/config/architecture-*.json`, `/scripts/architecture-*.cjs`, `trust-policy/**`). GitHub does not count the
author's own approval, so a normal code-owner approval **could not exist** for this change set: a second
identity that is authorized to approve those paths does not exist in this repository.

This is recorded as **governance evidence**, not as approval evidence, and specifically not as an ordinary
code-owner approval. It is the same class of fact as the C17 flake and the I-14 workflow defect: a real
constraint of the trust machinery, written down rather than smoothed over.

```text
PR = 13
PR_AUTHOR = zhiheng-zhang-Mera
PR_HEAD = 9e22604b5ead8382ac3719f48c6803e8051c41ce
MERGE_SHA = b5b511d750f11a7573b24e7b04c545b44d73b3da
POST_MERGE_CI_RUN = 35801514014
POST_MERGE_CI = ALL_GREEN

ROOT_TRUST_EPOCH = 25
GOVERNANCE_EXCEPTION = YES
EXCEPTION_REASON =
PR author and sole CODEOWNER were the same Root Owner identity,
so a normal code-owner approval could not exist.

BYPASS = OWNER_EXPLICIT
TECHNICAL_CHECKS = GREEN_BEFORE_MERGE
MERGE_COMMIT_MESSAGE_DISCLOSED_EXCEPTION = YES

EVIDENCE_CLASSES = GOVERNANCE, AUTHORITY_BOUNDARY, GOVERNANCE_EXCEPTION, REMOTE_GITHUB, REPRODUCTION
```

**What the technical checks did and did not establish.** `35799674081` (`push`) and `35799678505`
(`pull_request`) both succeeded on the PR head `9e22604b…`, the merge parents are the expected two, and
`35801514014` succeeded on the merge SHA with all four required contexts green. So the merge was green *before*
it landed and *after* it landed. What none of that establishes is an independent human approval: the four
required contexts and the author's Owner authority are the same identity, which is exactly why this row is
labelled an exception. **A green run does not turn an exception into a precedent**, and this record must not be
relabelled later as ordinary code-owner approval.

**This exception is not a route for the next mission.** §18 of the Mission-4C brief forbids repeating it
silently: an Operator-authored governance PR is only acceptable when no machine/App identity exists on the host,
and when it is used it has to be declared as an exception again, from measurement, at the time.

## J-3 — `REPRODUCTION`: the freeze tag, its target, and the second run it caused

`MEASUREMENT`. The tag was created **only after** every row of J-1 matched, and it points at the **promoted
merge commit** rather than at a later evidence commit, so the tag identifies the promoted state and not the
record of having promoted it.

```text
FREEZE_TAG = city-phase1b-a-governance-foundation-v1
ANNOTATED_TAG = YES
TAG_OBJECT = 5d1cd9e7e0fed2d35adfda49e01542c9dc0ff385
TAG_TARGET = b5b511d750f11a7573b24e7b04c545b44d73b3da
FORCE_MOVE = NO
TAG_ABSENT_BEFORE = YES   (measured locally and at origin, both empty)
PEELED_TARGET_AFTER_FETCH = b5b511d750f11a7573b24e7b04c545b44d73b3da
```

After the push, `git fetch origin --tags` was re-run and the peeled remote target was read back from
`git ls-remote`, which is what makes "the remote tag is annotated and points at the merge" a measurement rather
than an assumption about what the push did.

**`on: push` has no tag filter, so the tag push started a second Desktop CI run on the same SHA.** This was
predicted by the brief and is recorded rather than suppressed:

| Run | Event | Trigger | Head SHA | Status |
|---|---|---|---|---|
| `35801514014` | `push` | the PR #13 merge | `b5b511d7…` | **success — this is the certifying run** |
| `35803359214` | `push` | the freeze tag | `b5b511d7…` | recorded in J-4 |

**Certification stays explicitly tied to `35801514014`.** The tag-push run may not be substituted for it, and
its result may not be hidden if it is red.

## J-4 — the tag-push run, recorded as it actually finished

`MEASUREMENT`. The tag-push run `35803359214` was **watched to completion** and its real conclusion is recorded
below. It is not a certification and it was not re-run to obtain green.

| Job | Result |
|---|---|
| `quality` | success |
| `unit` | success |
| `package` | success |
| `acceptance` | success |

```text
TAG_PUSH_RUN = 35803359214
TAG_PUSH_EVENT = push
TAG_PUSH_HEAD_SHA = b5b511d750f11a7573b24e7b04c545b44d73b3da
TAG_PUSH_CONCLUSION = completed/success   (all four jobs green)
CERTIFYING_RUN = 35801514014   (different run, same SHA)
```

**Two green runs on one SHA, and only one of them certifies.** The tag push re-ran Desktop CI on
`b5b511d7…`, the same commit `35801514014` certified, and it also came back green. That result is recorded
because it was produced, and it is explicitly **not** promoted into a second certification: the phase-1B-A
promotion was certified by the post-merge run, and a tag-triggered run that happens to agree does not
retroactively become the evidence for the merge. It also shows the tag push is not free — `on: push` has no tag
filter, so every Phase freeze will cost a full CI run on an already-certified SHA. That is a cost, not a defect,
and it is left as it is rather than "fixed" by adding a tag filter to the workflow in this mission, which would
itself be a Root Trust change requiring its own epoch.

## J-5 — checkpoint table

| Checkpoint | State |
|---|---|
| `4C-A1` re-measure promoted state | **PASS** — GitHub and local agree on every row of J-1 |
| `4C-A2` governance exception preserved | **RECORDED** — J-2, append-only, labelled an exception |
| `4C-A3` immutable freeze tag | **FROZEN** — annotated `5d1cd9e7…` → `b5b511d7…`, absent before, unmoved |
| `4C-A4` post-merge certifying run | **PASS** — `35801514014`, four contexts green |
| `4C-A5` tag-push trigger | **RECORDED** — `35803359214`, tied to no certification |
| `4C-A6` prior history rewritten | **NO** — every record above this line is unchanged |

```text
PHASE0 = PROMOTED_AND_FROZEN
PHASE1A = PROMOTED_AND_FROZEN
PHASE1B_A = PROMOTED_AND_FROZEN

PHASE1B_A_FREEZE_TAG = city-phase1b-a-governance-foundation-v1
PHASE1B_A_MERGE_SHA = b5b511d750f11a7573b24e7b04c545b44d73b3da
POST_MERGE_CERTIFYING_RUN = 35801514014

ROOT_TRUST_EPOCH = 25
ROOT_TRUST_SURFACE = MATCHED

HOSTED_ARCHITECTURE_JOB = NOT_STARTED
HOSTED_REQUIRED_GATE = LEGACY
ARCHITECTURE_MIGRATION = NOT_STARTED

LEDGER_APPEND_ONLY = YES
```

Part A stops here. Part B (the hosted shadow deployment) continues in §K on the branch
`dev/city-phase1b-hosted-shadow`, branched from this tag.

---

# §K — Phase 1B-B hosted shadow (Mission-4C, Part B)

**Scope of this phase, stated as one question.** The Phase 1B specification fixes four roles and four rollout
stages. Phase 1B-A made the judge Owner-bound and closed the laundering path, but the judge was still **not
hosted**: `architecture:enforce`, `architecture:enforce:shadow`, `architecture:observe` and `architecture:qualify`
appeared in no workflow file. This phase answers one question and stops:

```text
DOES THE QUALIFIED ENFORCER BEHAVE AS SPECIFIED WHEN IT RUNS ON GITHUB-HOSTED CI,
BEFORE IT IS ALLOWED TO BLOCK ANYTHING?
```

Stage S1 only. The job is **not** required, the ruleset is **not** touched, the legacy ratchet is **not** removed,
no architecture is migrated, and **no epoch is advanced**. The epoch is deliberately left stale and the candidate
is prepared.

## K-1 — `HOSTED_SHADOW`: the job, and the four ways a check can silently disappear

`IMPLEMENTATION` + `MEASUREMENT`. `.github/workflows/ci.yml` gains one job, `architecture`, placed after
`quality`. Its exact identity is part of the governance contract, because stage S3 is a ruleset edit that will
name this context and nothing else.

| Property | Value | Why it is not negotiable |
|---|---|---|
| job id / check name | `architecture` | the name S3 will reference; a rename is an unmet required check |
| `runs-on` | `windows-latest` | the repository's other jobs run on the hosted Windows runner |
| `needs:` | **none** | a `needs:` lets the check vanish from the UI whenever an earlier job fails |
| `paths:` | **none** | a filter makes the check absent on most commits |
| `branches:` | **none** | same |
| `if:` | **none** | a conditional job reports nothing instead of failing |
| required by ruleset | **NO** | activation is S3, an Owner act |
| artifact | `artifacts/city/phase1/architecture-enforcement-shadow.json` + `architecture-shadow-metadata.json` | narrow generated evidence, not a corpus root |

The execution order is the specification's seven steps, and the order is asserted rather than the set:
checkout → pnpm → node → `install:electron` → `build` → baseline-series → baseline `--check` → shadow →
hosted runner → evidence assertions → artifact upload.

**`architecture:enforce:baseline -- --check` in the hosted job is the row the spec marked "must be added to the
hosted gate — today nothing runs `--check`."** It now runs on every push and pull request.

Measured on the real tree, before and after (`pnpm run architecture:enforce:baseline:series`,
`... :baseline -- --check`):

```text
state = BASELINE_SERIES_AUTHORISED          authorized = true
triple = (1, null, b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e)
identical = true    hash_matches = true    self_consistent = true    series_authorized = true
tracked_source_files = 612    internal_edges = 1671
problems = []
```

## K-2 — `HOSTED_SHADOW`: `SHADOW != IGNORE_ERRORS`, and the one gap that made it necessary

`IMPLEMENTATION` + `FINDING`. The engine already draws the shadow/enforce line: policy violation → exit 0 in
shadow, engine error → non-zero in both. That contract is right for the engine and **is not sufficient for the
hosted gate**, and the reason is a measured property of the engine rather than a matter of taste:

`scripts/architecture-enforcement.cjs` classifies an incomplete sensor as `severity: VIOLATION` — `E-09`, three
rows of it (`read_failures`, `parse_issues`, `silent_skips`) — so the engine's shadow mode **exits 0** on an
incomplete sensor. Measured directly, with a fixture, through the shipped command:

```text
node scripts/architecture-enforcement.cjs --mode shadow ... --measurement <read_failure fixture>
  verdict = POLICY_VIOLATION      exit = 0      findings include SENSOR_INCOMPLETE
```

A hosted shadow job built only on the engine's exit code would therefore report **green** while its sensor could
not read a file. The Phase 1B specification's fail-closed table (section 5) lists that condition as **must
FAIL**, and rule 1 says why: *a gate that turns "I could not look" into "nothing to report" is the failure mode
this whole phase exists to prevent.*

The resolution is `scripts/architecture-shadow-hosted.cjs`, which orchestrates the three logical checks and
draws the line **on finding codes rather than on the engine's exit code**:

| Condition | Engine's own classification | Hosted consequence |
|---|---|---|
| ordinary policy violation (`NEW_EDGE_UNDECLARED_ENDPOINT`, `REINTRODUCED_DEBT`, ...) | VIOLATION | reported, hosted job **exits 0** |
| `SENSOR_INCOMPLETE` (read failure / parse issue / silent skip) | VIOLATION | hosted job **FAILS** |
| `UNRESOLVED_SOURCE_TARGET_MISSING`, `UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION`, `UNRESOLVED_OTHER_UNKNOWN` | VIOLATION | hosted job **FAILS** (fail-closed by design) |
| `OWNERSHIP_CONFLICT` | VIOLATION | hosted job **FAILS** (governance ambiguity, not a policy opinion) |
| `ENGINE_ERROR` | ENGINE_ERROR | hosted job **FAILS** |
| `BASELINE_SERIES_*`, `BASELINE_HASH_*`, `BASELINE_*_MISMATCH`, `BASELINE_HEAD_NOT_TRACKED` | engine refusal | hosted job **FAILS** |
| baseline not self-consistent | engine exit | hosted job **FAILS** |

The engine itself is **not modified** by this phase. Its shadow contract is correct for a local report-only run;
the hosted elevation is the hosted runner's business, which is why the runner records both the engine's verdict
and the hosted verdict side by side in the evidence instead of overwriting one with the other.

## K-3 — `FAILURE` + `CORRECTION`: the evidence that contradicted its own verdict

`FAILURE` (found by the adversarial suite, recorded rather than quietly repaired) + `CORRECTION`.

The first revision of the hosted runner recorded its engine errors from
`findings.filter(severity === "ENGINE_ERROR")`. That is the same conflation K-2 describes, one level down: an
escalated `SENSOR_INCOMPLETE` carries `severity: VIOLATION`, so it never entered that list. The consequence was
an artifact that **failed the job while publishing `engine_error_count: 0`** — evidence contradicting the verdict
it accompanied, and a reader could not have told an unreadable baseline from an incomplete sensor.

The case that caught it is now `S3`/`S3b` in `tests/unit/city/architecture-hosted-shadow.test.ts`:

```text
FAIL  S3 an engine error fails the hosted job
AssertionError: expected 0 to be greater than 0        (engine_error_count)
```

The repair gathers the record from **both** places an engine error can appear — the orchestrator's own refusals
(unreadable baseline, non-self-consistent baseline, unauthorized series, unusable measurement), each tagged
`origin: "orchestrator"`, and the engine-reported conditions this file escalates, tagged
`origin: "engine_finding_escalated"` — and counts both. `S3b` is the regression guard: a silent skip must appear
in `engine_error_records` as `SENSOR_INCOMPLETE` **and** must not be counted as a policy violation.

This is the second time in this phase family that the same shape of defect appeared — §I-14 recorded a governance
step whose success depended on a shell preference, and C17 a hosted flake — and it is recorded for the same
reason: a governance artifact that reports a number inconsistent with its own outcome is worse than a missing one,
because it is believed.

## K-3b — `FAILURE` + `CORRECTION`: two more, found by the battery rather than by a test of mine

`FAILURE` + `CORRECTION` (both found by running the repository's own guards against the new work; both are real,
neither was waived).

**(1) The new comments leaned on section numbers a reader could not look up.**
`tests/unit/comment-citation.test.ts` refused them:

```text
FAIL  no file has more bare section citations than it is recorded with
      scripts/architecture-shadow-hosted.cjs: 2 (baseline 0)
FAIL  the recorded debt only shrinks
      bare section citations: 1310 (baseline 1308)
```

The guard freezes a real debt — 1308 comments in this repository cite section numbers of supplied plan documents
that are **not tracked here** — and requires new code to state the rule or name a tracked document. The new
scripts cited "section 5" and "section 8" bare. Repaired by naming the document:
`docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §5` / `§8`. The count fell back to the frozen baseline, so
`tests/fixtures/comment-citation-baseline.json` was **not** edited — the debt did not grow, which is what that
file exists to detect.

**(2) The promotion gate's drift guard encoded an assumption that this phase makes false.**
`tests/unit/promotion-gate.test.ts` asserted that `REQUIRED_PROMOTION_CHECKS` (the four contexts the promotion
path demands) equals **every job id in `ci.yml`**:

```text
FAIL  declares the required checks from one source, and says where they come from
      expected [ 'acceptance', 'package', 'quality', 'unit' ]
      to deeply equal [ 'acceptance', 'architecture', 'package', 'quality', 'unit' ]
```

That equality held only while every job in the workflow happened to be required. It is not a law: it is a
coincidence that stage S1 deliberately ends. **The tempting repairs were both wrong.** Adding `architecture` to
`REQUIRED_PROMOTION_CHECKS` would have made the new check required by the autonomous promotion path — an
activation this mission forbids (§20) arriving through a test fixture rather than through a ruleset, which is the
worse of the two ways for it to arrive. Deleting the assertion would have removed a real guard. The third option
is the one taken: assert the property that is actually true and load-bearing **for every required context** — each
one is produced by a real job; each one appears in the ruleset contract the repository states in
`.github/CODEOWNERS`; the declaration names nothing the ruleset does not require; and the new shadow job exists,
is **not** in the declaration, and is **not** in the ruleset contract. `src/shared/promotion-checks.ts` gained the
same distinction in prose, because that file's header asserted the old equality as a contract.

Neither file is Root Trust Surface (`PRODUCT_SURFACE` and `VERIFICATION_SURFACE` respectively), so this is an
ordinary engineering repair rather than an Owner act — but it is recorded because it is the phase's most
instructive near-miss: **a green test is not evidence that the contract it encodes is the right contract.**

## K-3c — `REPRODUCTION`: a hosted-local flake, recorded rather than re-run into silence

`FAILURE` + `MEASUREMENT`. The first full local unit run reported 5 failures. One of them was not about this
phase's contract at all:

```text
FAIL  tests/unit/runtime-intelligence/replay-corpus-io.test.ts > … > exports a real corpus with records
      Error: Test timed out in 60000ms.
```

It was produced while three other heavy suites (unit, postbuild and slow tiers) were running concurrently on the
same host — the runner was saturated. Run **alone**, the same file is green:

```text
tests/unit/runtime-intelligence/replay-corpus-io.test.ts   33 tests passed   (7.4s)
```

Both runs are recorded, per §15 ("if a failure is retried, both attempts remain in the record"). No timeout was
raised, no test was quarantined, and the file was not touched. Classified **host-contention flake**, with the
discriminator shown (green in isolation, red only under concurrent load), which is the same classification C17
used for a hosted runner and the same discipline: the flake is named, not hidden, and not "fixed" by weakening it.

## K-4 — `HOSTED_PARITY`: parity by identity, and the trap a count would have walked into

`IMPLEMENTATION` + `MEASUREMENT`. `scripts/architecture-findings-parity.cjs` compares two shadow evaluations over
finding **identity** — `code`, `subject`, `severity`, `policy_class`, and a sha256 of the finding's `detail` — and
computes a deterministic semantic digest over the normalized **multiset** (`city-architecture-findings-digest/1`,
sha256 over a canonical, sorted, fixed-key-order rendering). Ordering is normalized away deliberately: the digest
is over the multiset, so a permutation compares equal and a substitution does not.

Measured on the frozen tree, two independent governing runs (`dev/city-phase1b-hosted-shadow`, accepted baseline
v1, 1677 findings):

```text
LOCAL_FINDINGS_HASH  = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HOSTED_FINDINGS_HASH = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HASHES_EQUAL = true      COUNTS_EQUAL = true      state = HOSTED_LOCAL_PARITY
```

**Why a count is not the claim, demonstrated rather than asserted** (`P3`): take the 1677 normalized findings,
change **one** finding's `subject`, leave the count at 1677. The comparator returns
`COUNTS_EQUAL = true`, `HASHES_EQUAL = false`, `parity = false`, exit 1, and names the one finding on each side.
A count-based parity check would have called that a pass.

And a comparison that **cannot** be made is not a pass (`P3b`): an unreadable input, or an input that carries
neither `findings` nor `findings_normalized`, exits **2** with `PARITY_NOT_MEASURED`. "I could not compare" and
"they agree" are different statements, and the tool refuses to conflate them.

### K-4b — `FAILURE` + `CORRECTION`: the identity was lossy, and the first version of this section overstated it

`FAILURE` (found in adversarial review, not by the author) + `CORRECTION`. The claim above — "a substitution does
not [compare equal]" — **was false for one finding family when it was first written**, and it is corrected here
rather than quietly repaired.

The engine emits every `SENSOR_INCOMPLETE` finding with `subject: "sensor"` and puts everything that distinguishes
them in `detail` (`scripts/architecture-enforcement.cjs`, the three `E-09` rows). The first revision of
`normalizeFinding` used `code` + `subject` + `severity` + `policy_class` and **dropped `detail`**, so:

```text
normalize("1 read failure(s): a.ts")   = {code: SENSOR_INCOMPLETE, severity: VIOLATION, subject: sensor, policy_class: FAIL_CLOSED}
normalize("3 silently skipped file(s)") = {code: SENSOR_INCOMPLETE, severity: VIOLATION, subject: sensor, policy_class: FAIL_CLOSED}
IDENTICAL = true      same digest = true      compareFindings(...).parity = true
```

Two genuinely different finding sets normalised to one value, produced one digest, and were reported as **parity**.
A second, related defect sat beside it: the digest hashed the multiset while `compareFindings` de-duplicated
through a `Map`, so one occurrence of a finding and three occurrences of it produced the **same** parity verdict
but **different** `findings_semantic_hash` — two different quantities published under one name.

Both are repaired, and the repairs are guarded rather than described:

1. `detail_digest` (sha256 of `detail`) is part of the normalized identity, so the identity is injective. The
   detail *text* is still not carried, because it contains file paths and a bounded artifact should not grow with
   the corpus; the full `detail` remains in `architecture-enforcement-shadow.json` for a reader.
2. `compareFindings` is a **multiset** comparison, matching the digest, so `parity` and
   `findings_semantic_hash` can no longer disagree about the same input pair.
3. `P4` and `P5` are the regression guards, driven through the shipped module, and both fail against the previous
   revision.

**The published digest therefore changed** — `8142122c…` before the repair, `db536b06…` after — while the
**findings did not**: `1677 = 1671 PASS_AS_GRANDFATHERED + 5 NOT_YET_ENFORCED + 1 NON_SOURCE_ASSET`, unchanged, and
the live tree has no duplicate normalized entries. A digest is a function of the representation; changing the
identity representation changes the digest and changes nothing about the measurement. The hosted artifact quoted
in K-9 predates the repair and is labelled as such; a re-run on the repaired runner produces `db536b06…`.

**This is the second time in this phase that a green artifact was believed over a defect**, and the lesson is the
one the audit drew: a parity mechanism is evidence only if its identity is lossless, and a lossy identity fails
*silently in the direction of agreement*, which is the worst direction for a governance check.

The identity the mission asks for is also measured against the engine directly, on this tree:

```text
architecture:enforce:shadow  verdict PASS  findings_total 1677  violations 0  engine_errors 0
architecture:enforce         verdict PASS  findings_total 1677  violations 0  engine_errors 0
shadow_enforce_same_evaluator = true
```

1677 = 1671 `PASS_AS_GRANDFATHERED` + 5 `NOT_YET_ENFORCED` + 1 `NON_SOURCE_ASSET`, which is exactly the count the
Phase 1A freeze recorded. The hosted runner reproduces it, because it runs the same evaluator over the same
measurement rather than a parallel implementation.

## K-5 — `AUTHORITY_BOUNDARY`: protecting a workflow while leaving its code unprotected is no protection

`FINDING` + `CORRECTION`. `.github/CODEOWNERS` already protected `.github/workflows/`, `/package.json` and the
eight Phase 1B-A judge paths. The `architecture` job it now protects invokes **`scripts/architecture-shadow-hosted.cjs`**,
which was **not** protected: an actor able to edit that script could change what the hosted check concludes
without touching one Owner-reviewed byte — the hosted verdict, the fail-closed code list and the published digest
all live in it. `scripts/architecture-findings-parity.cjs` is the same shape of hole one step further out: it
decides when two findings sets are called equal.

Both are now Owner-reviewed, with the reasoning written into the file so a later reader can see it is a review
boundary and **not** a Root Trust Surface extension:

```text
/scripts/architecture-shadow-hosted.cjs    @zhiheng-zhang-Mera
/scripts/architecture-findings-parity.cjs  @zhiheng-zhang-Mera
```

Neither file is in `ROOT_TRUST_SURFACE` (`trust-policy/root-trust-surface.json` still declares 30 paths) and
neither moves the epoch aggregate, which is why this is a CODEOWNERS change and not an epoch event:
`tests/unit/owner-authority.test.ts` and `architecture-governance-boundary.test.ts` both still pass, and the
surface aggregate is unchanged by it at **72 files**.

## K-6 — `NEGATIVE_CONTROL`: nothing unrelated became architecture-governance-dependent

`MEASUREMENT`. Stated as falsifiable facts about the workflow and the tracked files, not as intent:

| Claim | Measured |
|---|---|
| the legacy ratchet is still required | `architecture:ratchet` still runs as a step in the `quality` job, and the job is unchanged |
| the legacy ratchet was not weakened | `package.json#architecture:ratchet` is still `node scripts/architecture.cjs ratchet` |
| no ordinary job depends on the new one | `quality`/`unit`/`acceptance`/`package` carry no `architecture` in `needs:` and do not run the shadow runner |
| the new job depends on nothing | `architecture` has no `needs:`, so it cannot be suppressed by another job's failure |
| the accepted baseline series was not widened | v1 only, hash `b211c052…`, byte-identical |
| a second accepted baseline was not added | `accepted` has exactly one entry |
| the ratchet's own baseline was not regenerated | `config/architecture-baseline.json` untouched by this phase |

`pnpm run architecture:ratchet` → `violations: []`, exit 0. `pnpm run architecture:observe` → semantic hash
`a9ba58ba0ae8fea081f54d0b009d70329cd46e2e07fc8a2faeecc21c05ac22b4`, exit 0.

## K-7 — `ROOT_TRUST_MIGRATION_PREPARATION`: epoch 26 is prepared, and epoch 26 is NOT written

`MEASUREMENT`. `.github/workflows/ci.yml` is Root Trust Surface, so this phase's workflow change necessarily
moves the surface aggregate. That is expected, is not hidden, and is not repaired by this phase.

```text
BEFORE (the frozen promoted commit b5b511d7…)
  ROOT_TRUST_EPOCH = 25          root_contract_version = boss-root-trust-25
  ROOT_TRUST_SURFACE = 72 files  aggregate = 37c98265224877d404f52a6016862cede85b5c7c4a0c864a664eb52fbf6b7741
  bless --check = MATCHES

AFTER (the candidate branch, ci.yml changed, epoch untouched)
  ROOT_TRUST_EPOCH = 25          (UNCHANGED — deliberately stale)
  LIVE_SURFACE = CHANGED         aggregate = fe3a6e87becb010fdc5c2e77c4d4222e9271e6cabed131b082b582bec3ce7ba6
  ROOT_TRUST_SURFACE = 72 files  (the new files are CODEOWNERS-protected, NOT Root Trust Surface)
  TRUST_EPOCH_CHECK = MISMATCH
  bless --check = FAIL  (TRUST_EPOCH_ROOT_SURFACE_MISMATCH)
```

The Stage A tooling (`scripts/trust-migration-proposal.cjs`, autonomous, writes only under the gitignored
`artifacts/`) produced the candidate:

```text
stage = STAGE_A_AUTONOMOUS_PROPOSAL        authorized = false        needsMigration = true
current_epoch    = 25 (boss-root-trust-25), surface 37c98265…
candidate_epoch  = 26 (boss-root-trust-26), surface fe3a6e87…
candidate.parent_epoch_hash = eb2f9b1b4116576c35db718f442fe975c595b9ee85196a5abb0c1234673d4f68   (epoch 25's hash)
changedRootTrustFiles = [".github/workflows/ci.yml"]
reason   = "Phase 1B-B hosted shadow adds the non-required architecture CI job"
risk     = "Hosted shadow instrumentation changes governance machinery but does not activate a required gate"
rollback = "Revert the hosted-shadow workflow change; keep ruleset unchanged; preserve all evidence"
```

**`--advance` was NOT run. Epoch 26 was NOT written.** `trust-policy/trust-epoch.json` is byte-identical to the
promoted commit's copy and still records epoch 25 anchoring the pre-change surface. The proposal is a REQUEST;
`authorized: false` is its own statement that this machine may prepare a migration and may not perform one. The
known-broken `trust-epoch-finalization.yml` path (§I-14) was **not** used, not repaired, and remains a separate
governance issue.

**Two failures are expected on this candidate and are not defects of this phase.** They share one cause — the
epoch is deliberately stale — and both clear when the Owner's ceremony writes epoch 26:

```text
EXPECTED_1  node scripts/acceptance-evolution-bless.cjs --check
            FAIL  TRUST_EPOCH_ROOT_SURFACE_MISMATCH   (epoch 25 certifies 37c98265…, surface is fe3a6e87…)
EXPECTED_2  tests/unit/root-trust-authority-lockdown.test.ts
            "does not change the epoch when the committed one already anchors the surface"
            proposal.surface.currentEpochAnchorsLiveSurface === false
```

Both are the invariant the ceremony exists to satisfy, not a regression this phase introduced. Every other
failure in the battery is a real failure; only these two are expected.

## K-8 — the validation battery, and the tag-push run

`MEASUREMENT`. Recorded as it finished, including the runs that are not green.

| Check | Result |
|---|---|
| `typecheck` (three projects) | exit 0 |
| tracked-secret scan | `TRACKED_SECRET_SCAN=PASS files=1315` (one more than before this phase: the new test helper) |
| state probe | exit 0 |
| test catalogue check | exit 0 — 281 suites, after the new suite gained its curated entry (see below) |
| `architecture:ratchet` | exit 0, `violations: []` |
| `architecture:observe` | exit 0, semantic hash `a9ba58ba…` |
| `architecture:enforce:baseline:series` | exit 0, `BASELINE_SERIES_AUTHORISED` |
| `architecture:enforce:baseline -- --check` | exit 0, `self_consistent` + `series_authorized` |
| `architecture:enforce:shadow` | exit 0, PASS, 1677 findings, 0 violations |
| `architecture:enforce` | exit 0, PASS, 1677 findings, 0 violations |
| Root Trust `--check` | **FAIL — EXPECTED** (K-7, `EXPECTED_1`) |
| new suite `tests/unit/city/architecture-hosted-shadow.test.ts` | **34 tests, all green** — 28 as first written, plus 6 added by the adversarial review (`S7`, `S8`, `S9`, `P4`, `P5`, and the `continue-on-error` guard) |
| unit tier / postbuild / slow | **unit 265 files, 3392 passed, exactly 1 failed** — `test-layers.test.ts`, `EXPECTED_1`; **postbuild 8 files, 118 passed, exactly 1 failed** — `root-trust-authority-lockdown.test.ts`, `EXPECTED_2`; **slow 4 files, 35/35 passed** |
| ruleset `22746755` before / after | `quality`, `unit`, `acceptance`, `package` — **UNCHANGED**; `architecture` NOT added |
| tag-push CI run `35803359214` | `completed/success` — `quality`, `unit`, `package`, `acceptance` **all green on `b5b511d7…`**. A second green run on the SAME SHA as the certifying run `35801514014`; recorded in J-3/J-4, not substituted for it, and not treated as a fresh certification |

**A third `FAILURE` was found by this battery, not by a test:** `node scripts/generate-test-catalogue.cjs --check`
refused the new suite with *"imports no capability module and has no curated entry"*. The catalogue is a
governance artifact — a suite that is in no tier and covers no capability is a suite nobody can account for — so
the suite gained a curated entry naming its capability (`runtime`) and its obligation, and
`config/test-catalogue.json` was regenerated. Recorded because the check did its job rather than being a
formality.

## K-9 — hosted observation, and what this mission may and may not conclude

`MEASUREMENT`. The candidate branch is pushed and the `push` event is observed on the real GitHub-hosted
runner. **The PR event does not exist**, because no pull request was opened — see K-10, which is the identity
boundary rather than an omission.

```text
PUSH_RUN_ID = 35805180887        (first hosted observation, on 9916647)
PUSH_RUN_2_ID = 35805647014      (on the ledger-finalisation commit 82a2966)
PUSH_RUN_3_ID = 35806819965      (on the corrected commit f389209)
PUSH_RUN_4_ID = 35807269888      (on 4e98c7f — the head this record stops at)
PUSH_EVENT = push
HEAD_UNDER_OBSERVATION = 4e98c7fe733b0e583374c29ad9a314a452e9b549
PUSH_RUN_CONCLUSION = completed/failure  (all four: `unit` red on the EXPECTED epoch anchor; `architecture` green)
  quality       success
  architecture  success      <-- the new check, on the hosted runner, separately, all four times
  unit          failure      <-- EXPECTED: tests/unit/test-layers.test.ts:430, the epoch anchor (K-7 EXPECTED_1)
  acceptance    skipped      (needs: unit)
  package       skipped      (needs: unit)

ARCHITECTURE_JOB_ID = 107004291479
ARCHITECTURE_JOB_CONCLUSION = completed/success
ARCHITECTURE_JOB_RUNNER = GitHub Actions 1000001561   (a real hosted runner, not this host)

PR_RUN_ID = NOT_APPLICABLE   (no PR opened; see K-10)
```

**The `architecture` check appears SEPARATELY, which is the point of the migration.** All thirteen of its steps
ran and passed on the hosted runner, in the specified order:

```text
 2 actions/checkout@v4                                  success
 3 pnpm/action-setup@v4                                 success
 4 actions/setup-node@v4                                success
 5 pnpm install --frozen-lockfile                       success
 6 pnpm run install:electron                            success
 7 pnpm run build                                       success
 8 pnpm run architecture:enforce:baseline:series        success
 9 pnpm run architecture:enforce:baseline -- --check    success
10 pnpm run architecture:enforce:shadow                 success
11 node scripts/architecture-shadow-hosted.cjs          success
12 Architecture shadow evidence is present and complete success
13 actions/upload-artifact@v4                           success
```

**The hosted evidence artifact, read back from the run** (`gh run download 35805180887 --name
architecture-shadow`) rather than from this host's copy:

```text
artifact            = architecture-shadow (id 10727212130)
schema              = city-phase1b-hosted-architecture-shadow/1
fixture_mode        = false
commit_sha          = 9916647c9fc3bd1b8d4ac173fe4e32f5e2860d8c
workflow_run_id     = 35805180887        workflow_run_attempt = 1
event               = push               job = architecture        runner_os = Windows
shadow_verdict      = PASS               engine_verdict = PASS
engine_error_count  = 0                  machinery_failure_count = 0
policy_violation_count = 0               new_regressions = 0
findings_count      = 1677               findings_semantic_hash = 8142122c9bd0b38d3f65e73829809e83b706bbfff5eb2ee4e245fc93f4eda41c
findings_by_policy_class = {POLICY_VIOLATION: 0, FAIL_CLOSED: 0, INFORMATIONAL: 1677}
baseline_version    = 1                  baseline_hash = b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e
baseline_series_status = AUTHORISED      baseline_self_consistent = true
root_trust_epoch    = 25                 root_trust_surface_hash = 37c98265224877d404f52a6016862cede85b5c7c4a0c864a664eb52fbf6b7741
not_yet_enforced    = 5 classes published
```

**Every field above is from the artifact as published, including its digest `8142122c…`, which is the digest the
runner produced BEFORE the K-4b identity repair.** That repair changed the identity representation and therefore
the digest value (`8142122c…` → `db536b06…`) while changing nothing about the measurement: the same 1677 findings,
the same `{0, 0, 1677}` classes, the same five unmodelled classes, the same baseline and epoch. The artifact is
quoted as it was, not re-labelled with the new digest it does not contain — an artifact is evidence of the run that
produced it and nothing else.

**Parity, measured between the hosted artifact and a local run of the same commit** — not asserted from a
constant, and not from the same artifact read twice:

```text
HOSTED_FINDINGS_HASH = 8142122c9bd0b38d3f65e73829809e83b706bbfff5eb2ee4e245fc93f4eda41c   (published artifact, pre-repair identity)
LOCAL_FINDINGS_HASH  = 8142122c9bd0b38d3f65e73829809e83b706bbfff5eb2ee4e245fc93f4eda41c   (local run, pre-repair identity)
HASHES_EQUAL = true      COUNTS_EQUAL = true (1677)      state = HOSTED_LOCAL_PARITY
```

Both sides of that comparison were produced by the **pre-repair** runner, which is why they agree; the repair
changes both sides identically. On the repaired runner the same comparison yields `db536b06…` on both sides, and
`P3c` asserts that equality rather than this transcript.

**A second, third and fourth hosted observation, on later commits** — the ledger is not allowed to go stale, and
each push is its own run:

```text
RUN 35807269888   push   4e98c7fe733b0e583374c29ad9a314a452e9b549   architecture = completed/success
   overall run conclusion = failure   (unit: the same expected epoch anchor; acceptance/package skipped)
RUN 35806819965   push   f389209a1012c1955831ecb12a774f3bb7ec9f4e   architecture = completed/success
   artifact: sha f389209a, hosted true / GitHub Actions (measured), verdict PASS, findings 1677
             hash db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba   <-- the REPAIRED identity
             baseline_self_consistency_status VERIFIED, not_yet_enforced_status READABLE (5)
             series AUTHORISED, epoch 25, engine_errors 0, machinery_failure_count 0
   overall run conclusion = failure   (unit: the same expected epoch anchor; acceptance/package skipped)
RUN 35805647014   push   82a2966a7e95a0bad10a01d429ae9e517433ff2c   architecture = completed/success
   artifact: sha 82a2966a, verdict PASS, findings 1677, hash 8142122c… (pre-repair identity), epoch 25, engine_errors 0
   overall run conclusion = failure   (unit: the same expected epoch anchor; acceptance/package skipped)
RUN 35805180887   push   9916647c9fc3bd1b8d4ac173fe4e32f5e2860d8c   architecture = completed/success
```

**The repaired runner is confirmed on the real hosted runner, not only locally.** Run `35806819965`'s artifact
carries `hosted: true` with `provider: GitHub Actions` **measured** from the workflow environment (defect 4 of
K-10b), `baseline_self_consistency_status: VERIFIED` (a real check rather than a fabricated pass), and
`not_yet_enforced_status: READABLE` with the five classes (a real read rather than the module default). Parity
between that artifact and a local run of the same commit:

```text
LOCAL_FINDINGS_HASH  = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HOSTED_FINDINGS_HASH = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HASHES_EQUAL = true   COUNTS_EQUAL = true (1677)   multiplicity_differences = []   state = HOSTED_LOCAL_PARITY
```

```text
HOSTED_ARCHITECTURE_RUNS_OBSERVED = 4 consecutive, all `architecture` green on a real hosted runner
HOSTED_SHADOW_SOAK_COMPLETE = NO   (the spec's S1 exit condition is >= 20 consecutive runs; this is not that)
BRANCH_HEAD_OBSERVED = 4e98c7fe733b0e583374c29ad9a314a452e9b549
```

**A note on how this record terminates.** Each push to the branch starts a new hosted run, so a ledger commit that
records the run of the commit before it is always one behind — recording run N changes the head and invites run
N+1. Rather than chase that recursion, the record stops here: the head under observation is
`4e98c7fe…`, its own `architecture` result is recorded above, and any later push carries documentation only.
A reader who needs the current head's result should read the run list rather than this file, and the mission's
report names the SHA it stopped at.

The hosted run's overall conclusion is `failure`, and that is the **expected** failure rather than a defect of
this phase: `unit` is red on `tests/unit/test-layers.test.ts:430`, the epoch anchor, which is `EXPECTED_1` of K-7
and clears when the Owner's ceremony writes epoch 26. `acceptance` and `package` are `skipped` because they
declare `needs: unit` — which is precisely why the `architecture` job was given **no** `needs:` in the first
place: had it depended on `unit`, it would have been **skipped in this very run** and the deployment would have
had no evidence at all. The design decision and the run agree, and the run is the reason the decision is now
evidence rather than an argument.

**What this section may not conclude.** It does not claim the soak is complete: the Phase 1B specification's S1
exit condition is **≥ 20 consecutive PR/push `architecture` runs** in which shadow and local agree,
`engine_errors` is 0, and count differences are explained by the change. One deployment is not twenty runs, and
the mission says so explicitly. It also does not claim the hosted gate would block anything correctly *in
production*, because it is not required and has therefore never blocked anything — which is what stages S2 and S3
exist to establish, and neither is this mission.

```text
HOSTED_SHADOW_DEPLOYED = YES            (three push events; `architecture` green on a real hosted runner each time;
                                         artifact published; parity measured against the published artifact)
HOSTED_SHADOW_SOAK_COMPLETE = NO        (>= 20 consecutive runs not reached)
HOSTED_REQUIRED_GATE = LEGACY
HOSTED_ENFORCE_VISIBLE = NOT_STARTED
```

## K-10 — `AUTHORITY_BOUNDARY`: the PR identity, measured, and the stop it forces

`MEASUREMENT`. Mission §18 makes the PR path conditional on an actual machine credential, and this host was
measured rather than assumed:

| Probe | Result |
|---|---|
| `gh auth status` | `zhiheng-zhang-Mera` — the **Root Owner**, not a machine/App identity |
| `.boss/github-machine-identity.json` in the data root | **absent** (`runtime-data/.boss/` holds no identity config) |
| `.boss/secret-vault.json` (the App private key store) | **absent** — searched the data root and the machine |
| `.codex-boss/config/github-machine-identity.example.json` | `enabled: false` — an example, not a configuration |
| `CODEX_BOSS_GITHUB_TOKEN` / `BOSS_GITHUB_TOKEN` | unset |
| `artifacts/acceptance/BOSS_MACHINE_IDENTITY_PROMOTION_CONVERGENCE_REPORT.md` §7 | `NOT_OBSERVABLE_IN_JOB` — *"the GitHub machine identity is not installed in this host's data root, so the promotion path has no credential to act with"*, `BLOCKED_EXTERNAL` |

```text
MACHINE_IDENTITY_AVAILABLE = NO
```

Opening the PR would therefore mean opening a second **Owner-authored** governance PR and walking back into the
PR #13 self-review deadlock that §J-2 records as an exception. Mission §18 forbids doing that silently, so the
branch is pushed and the PR is **not** opened:

```text
FINAL_STATUS = WAITING_FOR_MACHINE_IDENTITY_OR_OWNER_PR_EXCEPTION_DECISION
```

The alternative — the Owner opening it, or an Owner decision to accept the exception again — is the Owner's call
and is recorded as such rather than presumed.

## K-10b — `CORRECTION`: six defects found by adversarial review, and what each one actually was

`FAILURE` + `CORRECTION`. An independent adversarial pass was run against the committed work, briefed to find
violations rather than to agree. It found **no violation of the mission's forbidden list and no breach of the stop
boundary**, and it found six real defects. All six are repaired, and each repair has a guard that fails against the
previous revision. They are recorded here because a phase that reports only its successes is not evidence.

| # | Defect | Why it mattered | Repair + guard |
|---|---|---|---|
| 1 | the parity identity dropped `detail`, so the `SENSOR_INCOMPLETE` family collapsed to one value and two different finding sets compared as **parity** | a governance comparison that fails **toward agreement** is worse than no comparison | `detail_digest` in the identity; multiset comparison; `P4`/`P5` (K-4b) |
| 2 | `compareFindings` de-duplicated while the digest hashed the multiset, so one copy and three copies gave the same `parity` but different hashes | one name, two quantities — and the CI evidence step reads one while the report prints the other | same repair; `P5` |
| 3 | `not_yet_enforced` was written `baseline?.not_yet_enforced ?? NOT_YET_ENFORCED`, and the fallback is byte-identical to the committed baseline's five | the spec's rule that an EMPTY list and an UNREAD list must be distinguishable (§5 rule 2) was **unmet in mechanism**, and the hosted job's own assertion was dead code | three states (`READABLE` / `READABLE_EMPTY` / `FIELD_ABSENT`), `null` plus a named engine error when unread; `S7` |
| 4 | `hosted: true` was a constant, so a purely local run published an artifact that declared itself hosted | **this section's own K-4 originally cited a `HOSTED_FINDINGS_HASH` before any hosted run existed** — the overclaim was downstream of this defect | `hostedEnvironment()` measures the workflow variables; `hosted_provider` and the raw variables are published; `S8` |
| 5 | fixture mode published `baseline_self_consistent: true` for a check it never ran | a fabricated pass that also satisfies the hosted job's evidence assertion | skipped checks are `null` with status `NOT_MEASURED_FIXTURE_SEAM`; `S9` |
| 6 | three assertions were **vacuous**: the corpus-root guard could not see `with.path` at all (the step type did not declare `with`), the `not_yet_enforced` length assertion was satisfied by defect 3's fallback, and H7's credential-less branch asserted a tautology | a guard that cannot fail is not a guard, and it reads as coverage | `with` is parsed and the guard inspects real pathspecs; `S7` removes the fallback; H7's branch re-asserts the in-repository contract and announces the non-measurement; `continue-on-error` is now asserted across **every** workflow |

Two further weaknesses the review named are recorded rather than repaired here, because repairing them is not this
phase's business:

- **The `promotion-gate` drift guard was relaxed in the same change it would have caught** (K-3b). The old form
  asserted `REQUIRED_PROMOTION_CHECKS === every job id in ci.yml`, which this phase makes false by adding a
  NON-required job; the new form asserts "every required context is produced and is named in the ruleset contract
  CODEOWNERS states, and the shadow job is in neither". The review's fair criticism is that the guard's authority
  for *what is required* is now a hand-maintained comment, and the "no extra job" direction is gone. The live
  ruleset is a platform fact and cannot be read from a unit test; the honest position is that this guard is weaker
  than it was, deliberately, because the property it encoded is no longer true.
- **Parity is not wired into a CI job.** By construction the CI job *is* the hosted run, so there is no second
  machine to compare against inside CI; the tool is exercised by tests and manually. Recorded as a limitation.
- **`app/codex-boss` has authored and merged earlier PRs.** K-10's `MACHINE_IDENTITY_AVAILABLE = NO` is therefore
  narrower than its heading: what was measured is that **no machine/App credential is installed on this host**
  (no identity config, no vault, no bot login, no token). A machine identity has existed for other rounds; it is
  simply not present here, which is the condition §18 makes the PR path depend on.

## K-11 — the terminal state of this phase
```text
PHASE0 = PROMOTED_AND_FROZEN
PHASE1A = PROMOTED_AND_FROZEN
PHASE1B_A = PROMOTED_AND_FROZEN

PHASE1B_B_HOSTED_SHADOW = DEPLOYMENT_CANDIDATE

HOSTED_ARCHITECTURE_JOB = PRESENT
HOSTED_ARCHITECTURE_JOB_REQUIRED = NO

HOSTED_ENFORCE_VISIBLE = NOT_STARTED
HOSTED_REQUIRED_GATE = LEGACY
RULESET = UNCHANGED
LEGACY_RATCHET = REQUIRED_AND_UNCHANGED

ROOT_TRUST_EPOCH = 25_STALE_BY_EXPECTED_WORKFLOW_CHANGE
ROOT_TRUST_EPOCH_CANDIDATE = 26_READY
ROOT_TRUST_EPOCH_26_WRITTEN = NO

ARCHITECTURE_MIGRATION = NOT_STARTED
BASELINE_WIDENED = NO

HOSTED_SHADOW_SOAK_COMPLETE = NO   (the >= 20 consecutive runs condition is not claimed)

LEDGER_APPEND_ONLY = YES
OLD_HISTORY_REWRITTEN = NO
IMMUTABLE_TAG_MOVED = NO
FORCE_PUSH = NO
```

The stop boundary is respected in full: no required check activated, no ruleset mutation, no epoch write, no
`--advance`, no baseline widening, no baseline v2, no legacy ratchet retirement, no architecture migration, no
immutable-tag movement, no history rewrite, no hidden retry and no threshold weakened.

---

# §L — CORRECTION: the "34 tests green" figure was LOCAL evidence, and the hosted runner disproved it

**This section is an appended correction. Nothing above it is edited, deleted or reworded** — in particular §K-4b,
§K-10b, the pre-repair digest `8142122c…` and the original overclaim all remain exactly as they were written. The
point of this section is that the *old claim stays visible* and the correction sits beside it, rather than the
history being tidied into "we never said anything wrong".

## L-1 — `FAILURE`: the first real `pull_request` run of PR #14 found two defects in this phase's own test file

`FAILURE` + `MEASUREMENT`. Mission-4C Part B reported, in §K-8, that the new suite was **"34 tests, all green"**,
and reported the candidate's only expected failures as the two epoch-anchored ones. **That was a local
measurement, and it was not true of the hosted runner.**

PR #14 was opened by the Codex-Boss App machine identity and its first real `pull_request` Desktop CI run
(`35811655716`, head `74b8a3f8…`) produced:

```text
Test Files  2 failed | 263 passed (265)
Tests       3 failed | 3383 passed (3386)
```

| # | Failing case | Assertion | Real cause |
|---|---|---|---|
| 1 | `tests/unit/test-layers.test.ts:430` | `TRUST_EPOCH_ROOT_SURFACE_MISMATCH` | **expected** Root Trust staleness |
| 2 | `architecture-hosted-shadow.test.ts` → `S8` | `a local run declared itself hosted: expected true to be false` | **test defect** |
| 3 | `architecture-hosted-shadow.test.ts` → frozen-commit byte guard | `git could not read … at the frozen commit: expected 128 to be +0` | **test defect** |

## L-2 — the two defects, stated as what they actually were

`FINDING` + `CORRECTION`. **Both are defects in the TESTS and in the EVIDENCE, not in the hosted-shadow engine.**

**Defect 1 — `S8` asserted a premise about its own environment.** `S8` called the governing runner with no
environment and then required `hosted === false`. That holds only when the *test process* is local. The hosted
`unit` runner exports `GITHUB_ACTIONS=true` (and `CI`, `GITHUB_SHA`, `GITHUB_RUN_ID`, …), the child inherited it,
and the production runner **correctly** measured `hosted: true`. Production was right; the test's premise was
wrong. The failure message — *"a local run declared itself hosted"* — named the production behaviour rather than
the test's false assumption, which is itself part of why this was not caught locally.

**Defect 2 — the frozen-commit byte guard assumed history the checkout does not have.** The guard compares a
guarded file's current bytes with its bytes at the immutable Phase 1B-A freeze commit `b5b511d7…`, via
`git show <sha>:<path>`. `actions/checkout@v4` defaults to `fetch-depth: 1`, so on the hosted runner that commit
is absent and `git show` exits **128**. The guard therefore failed for a reason unrelated to the property it
guards. Worse: on the hosted runner the assertion was **not guarding anything at all** — it was reporting a git
error as a baseline mismatch.

**Classification.** These are `TEST/EVIDENCE DEFECTS`, **not** production architecture-shadow engine defects.
Recorded explicitly because two tempting mis-readings both exist: the failure message looks like a provenance
bug, and a red guard looks like the baseline it guards has moved. Neither was true.

**What did not fail, and is the thing that matters most here.** The `architecture` job itself remained
**SUCCESS** on the same hosted run — 1677 findings, 0 engine errors — and `quality` passed. The hosted shadow
deployment the phase claims was unaffected by either defect.

```text
PR                          = #14
OLD_CANDIDATE               = 74b8a3f81ccab8f713bb246a529b0c48a20112fb
HOSTED_PULL_REQUEST_RUN     = 35811655716
ARCHITECTURE_JOB_ON_THAT_RUN = SUCCESS (1677 findings, 0 engine errors)
CLASSIFICATION              = TEST/EVIDENCE DEFECTS (not production engine defects)
```

## L-3 — `CORRECTION`: what the earlier green count was, and was not

`CORRECTION`. §K-8's **"34 tests, all green"** statement is, and always was, **LOCAL evidence only**. It is
**not** proof that the suite passed on a hosted `unit` runner, and the first hosted run showed that it did not.
The same applies to §K-8's summary of the tier results and to the §K-9 claim that the only expected failures were
the two epoch-anchored ones: on the hosted runner there was **one additional failing test file**, this phase's
own.

What the ledger keeps, deliberately:

```text
OLD_CLAIM_PRESERVED        = YES  (K-8's "34 tests, all green" is unchanged and still readable as written)
CORRECTION_APPENDED        = YES  (this section)
OLD_RECORDS_MODIFIED       = NO
LEDGER_HISTORY_REWRITTEN   = NO
```

**The general lesson, recorded because this is the second time this phase family has learned it.** §K-3 recorded
an artifact that contradicted its own verdict; §K-4b recorded a parity identity that failed toward agreement.
This is the third variant of the same shape: **a green local run was quoted as coverage of a runner it never
executed on.** "It passes here" and "it passes there" are different measurements, and only the second is evidence
about CI. A test that depends on the environment it runs in must *control* that environment, or it is measuring
the developer's laptop and reporting it as the pipeline.

## L-4 — `CORRECTION`: the repair, and the proof it is not a papering-over

`CORRECTION` + `REPRODUCTION`. Repaired in the appended repair commit on this branch (`test(city): make
hosted-shadow guards CI-valid`), recorded with its real SHA in §L-5 and §L-7 below.

1. **`S8` now controls its premise.** `runGoverning` takes an explicit `env` seam. The LOCAL case is driven with
   `localSimulationEnv()`, which copies `process.env` and deletes **exactly** the variables the production runner
   declares it reads (`HOSTED_ENVIRONMENT_VARIABLES`, exported from the runner so the test cannot clear a
   different set from the one production reads). The HOSTED case is driven with `hostedSimulationEnv()`, which
   sets the GitHub Actions variables explicitly. Both directions are asserted, plus the measured `hosted` flag in
   both shadow artifacts.
2. **The frozen-commit guard was given the history it inspects.** `.github/workflows/ci.yml` now checks out the
   `unit` job with `fetch-depth: 0`. The guard still performs a real `git show <frozen-sha>:<path>` byte
   comparison; it was **not** converted to an expected-hash constant, which would have been satisfiable by
   editing the constant in the same change it exists to catch.

**What the repair deliberately did NOT do**, because each of these would have made the test green by removing the
thing being tested: it did not change `scripts/architecture-shadow-hosted.cjs` provenance detection, did not
hardcode `hosted = false`, did not special-case `NODE_ENV=test`, did not skip `S8` on CI, did not add
`if (!process.env.CI)`, and did not suppress the assertion. The production runner still measures the environment
it is given — proven by running it with `GITHUB_ACTIONS=true` in the environment, where it reports
`hosted: true / provider: "GitHub Actions"` and preserves the commit and run metadata.

**Both defects are falsified by re-running the suite in the environment that broke it.** With
`GITHUB_ACTIONS=true`, `CI=true`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_JOB=unit`, `GITHUB_EVENT_NAME=pull_request`
and the `RUNNER_*` variables all set in the shell, the amended suite passes **34/34** — where the previous
revision failed `S8` on exactly those variables.

The `fetch-depth: 0` requirement is itself now pinned by an assertion in the same suite, so removing it fails
with a statement of what broke instead of an opaque exit 128 two hundred lines away — and a `git cat-file -e`
probe turns "the frozen commit is not in this checkout" into an explicit diagnosis rather than letting a git
error masquerade as a baseline mismatch.

## L-5 — the repair commit, exactly

```text
PR                  = #14
OLD_PR_HEAD         = 74b8a3f81ccab8f713bb246a529b0c48a20112fb
REPAIR_COMMIT       = bcf5a3365f6a628ef7d388304b6b9f1ac25cfe04
NEW_PR_HEAD         = bcf5a3365f6a628ef7d388304b6b9f1ac25cfe04
PUSH_DISTANCE       = 74b8a3f..bcf5a33   (fast-forward; the old candidate is an ANCESTOR of the new head)
AMEND_REBASE_RESET_FORCE_PUSH = NONE
OLD_CANDIDATE_RETAINED_AS_EVIDENCE = YES  (74b8a3f and run 35811655716 are negative evidence and are not deleted)
FILES_CHANGED       = .github/workflows/ci.yml
                      docs/research/PAPER_EVIDENCE_LEDGER.md
                      scripts/architecture-shadow-hosted.cjs   (export-only; no semantic change)
                      tests/unit/city/architecture-hosted-shadow.test.ts
                      tests/unit/city/helpers/phase1b-scripts.ts
```

`PR_HEAD_SHA_AFTER_PUSH = bcf5a33…` and `PR_AUTHOR = codex-boss[bot] (Bot)` — PR #14 moved to the new head
naturally, with its authorship unchanged. No new PR was opened and the old one was not closed.

`.github/workflows/ci.yml` is Root Trust Surface, so the `fetch-depth` change moves the candidate surface again.
**No epoch was advanced**; the epoch-26 candidate was re-measured against the new candidate head, and the previous
proposal is not authorization for the new surface. The old candidate surface hash no longer authorizes the new
head — which is the intended behaviour, not a problem to be worked around.

## L-6 — `FAILURE` + `CORRECTION`: the soak count was over-reported for the same reason

`CORRECTION`. §K-9 recorded **`HOSTED_ARCHITECTURE_RUNS_OBSERVED = 6 consecutive, all green`**. Those runs did
genuinely happen on a real hosted runner and the `architecture` job genuinely succeeded in each — but "the
architecture job succeeded" is not by itself the S1 exit condition, which also requires that shadow and local
agree on `new_regressions`, that `engine_errors` is 0, that provenance is genuine GitHub Actions, and that the
baseline checks are valid **for the commit being counted**. Counting them as a continuous S1 soak series without
re-validating each run against the spec is the same error as L-3: inheriting a favourable number instead of
measuring it.

The runs are therefore split, and the classification is by validation rather than by count:

```text
PRE_REPAIR_HOSTED_RUNS    = 6   (35803359214 was a TAG-push run of the Phase 1B-A freeze, a different phase;
                                 35805180887, 35805647014, 35806819965, 35807269888, 35807684348 are Phase
                                 1B-B push runs on the hosted runner, `architecture` green in each)
                                 -> retained as HOSTED-SHADOW EXISTENCE EVIDENCE, not inherited as soak credit
CURRENT_HEAD_HOSTED_RUNS  = measured on NEW_PR_HEAD after the repair (see §L-7)
```

`HOSTED_SHADOW_CONSECUTIVE_VALID_RUNS` is reported for the repaired head only, and no old run is relabelled,
duplicated or counted twice to approach 20.

## L-7 — `MEASUREMENT` on the repaired head

`MEASUREMENT`. Both event types were re-run on `NEW_PR_HEAD` and every result below is bound to that SHA.

| Run | Event | Head | `quality` | `architecture` | `unit` | `package` | `acceptance` |
|---|---|---|---|---|---|---|---|
| `35813798522` | `push` | `bcf5a33…` | success | **success** | failure | skipped | skipped |
| `35813801516` | `pull_request` | `bcf5a33…` | success | **success** | failure | skipped | skipped |

```text
NEW_PR_HEAD                  = bcf5a3365f6a628ef7d388304b6b9f1ac25cfe04
PUSH_RUN                     = 35813798522
PR_RUN                       = 35813801516
ARCHITECTURE_JOB             = completed/success on both (runners 1000001586, 1000001588)
ARCHITECTURE_REQUIRED        = NO
UNIT_RESULT                  = 1 failed | 264 passed (265)
CONTENT_FAILURES             = 0        <-- S8 and the frozen-commit guard both pass on the hosted runner now
ROOT_TRUST_STALENESS_FAILURES = 1       <-- test-layers.test.ts:430, TRUST_EPOCH_ROOT_SURFACE_MISMATCH
```

**The two content failures are gone on the very environment that produced them.** The hosted `unit` log now shows
exactly one failing file (`tests/unit/test-layers.test.ts:430`) and one failing case, with the epoch message. The
repair did not merely move the failure: `S8` passes under inherited `GITHUB_ACTIONS=true`, and the frozen-commit
byte comparison resolves `b5b511d7…` because the `unit` job now checks out full history.

**One detail worth recording, because it affects how "same commit" is read.** On a `pull_request` event GitHub
Actions checks out the PR **merge** commit, not the branch head. The artifact from run `35813801516` therefore
carries `commit_sha = 644e1d4f4790b9bffbdd8a71ca2e698b0b7294f2`, whose parents are verified to be exactly
`b5b511d7…` (main) and `bcf5a33…` (the PR head):

```text
644e1d4f… = Merge bcf5a3365f6a628ef7d388304b6b9f1ac25cfe04 into b5b511d750f11a7573b24e7b04c545b44d73b3da
parents   = [b5b511d750f11a7573b24e7b04c545b44d73b3da, bcf5a3365f6a628ef7d388304b6b9f1ac25cfe04]
```

Because main is an ancestor of the head, the merge tree is identical to the head tree, so the measurement is the
new head's. Stated explicitly rather than glossed, because "the artifact says a different SHA" is exactly the kind
of discrepancy that should be explained, not ignored.

### Same-commit hosted/local parity, re-measured for `NEW_PR_HEAD`

The old SHA's parity hash is **not** reused; this comparison is between a local run of `bcf5a33…` and the artifact
the hosted `pull_request` run actually published:

```text
LOCAL_FINDINGS_HASH  = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HOSTED_FINDINGS_HASH = db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
HASHES_EQUAL = true    COUNTS_EQUAL = true (1677)    multiplicity_differences = []    state = HOSTED_LOCAL_PARITY
PARITY_FOR_NEW_HEAD = YES
```

Hosted provenance on that run, measured rather than inherited:

```text
hosted = true    hosted_provider = "GitHub Actions"    runner_os = Windows
shadow_verdict = PASS    engine_verdict = PASS    engine_error_count = 0
findings_count = 1677    machinery_failure_count = 0    policy_violation_count = 0
baseline_series_status = AUTHORISED    baseline_self_consistency_status = VERIFIED
not_yet_enforced_status = READABLE (5 classes)    root_trust_epoch = 25
```

### Soak accounting — re-derived, not inherited

Each candidate run is classified against the S1 exit condition rather than counted because the `architecture` job
was green. The pre-repair runs established that the hosted **deployment** exists and behaves; they are not inherited
as soak credit for the repaired head.

```text
PRE_REPAIR_HOSTED_RUNS (existence evidence, NOT soak credit for the new head)
  35805180887  push  9916647   architecture SUCCESS
  35805647014  push  82a2966   architecture SUCCESS
  35806819965  push  f389209   architecture SUCCESS
  35807269888  push  4e98c7f   architecture SUCCESS
  35807684348  push  74b8a3f   architecture SUCCESS
  35811655716  pull_request  74b8a3f   architecture SUCCESS  (the run that found the two test defects)

CURRENT_HEAD_HOSTED_RUNS (validated against the S1 conditions on NEW_PR_HEAD)
  35813798522  push          bcf5a33   architecture SUCCESS, 0 engine errors, provenance genuine
  35813801516  pull_request  bcf5a33   architecture SUCCESS, parity measured, 0 engine errors

HOSTED_SHADOW_CONSECUTIVE_VALID_RUNS = 2   (counted only where provenance and parity were re-verified)
HOSTED_SHADOW_REQUIRED_RUNS = 20
HOSTED_SHADOW_SOAK_COMPLETE = NO
```

No run was relabelled, duplicated, or counted twice to approach 20. The pre-repair runs remain in the record as
hosted-shadow evidence, which is what they are.

---

# §M — the epoch-26 ceremony, and the three guards it correctly falsified

**This section is appended. Nothing above it is edited, deleted or reworded.**

## M-1 — `GOVERNANCE`: the Owner's ceremony completed, and the machine opened the PR

`MEASUREMENT`. The Root Owner approved the protected `boss-root-trust-owner` environment and the Trust Epoch
Finalization workflow ran. Everything the mission asked to be re-measured was re-measured from GitHub and from a
**clean worktree**, not from the authoring workflow's working tree.

```text
FINALIZATION_RUN = 35816107209
FINALIZATION_FAILURE_CLASS = PR_CREATION_NOT_PERMITTED_FOR_GITHUB_TOKEN   (the ONLY failing step)
   "GitHub Actions is not permitted to create or approve pull requests (createPR)"
   Stage A proposal / Stage B --advance / Stage B --check = SUCCESS, SUCCESS, SUCCESS
   Actions permissions were NOT weakened to work around it

MAIN_SHA     = adf92b619aa83b398a857ac8d2039fd6cc1eb0d9   (= merge of PR #14)
EPOCH_BRANCH = trust-epoch/boss-root-trust-26
EPOCH_COMMIT = aaa3d3732f3d0f899c67ced9be47ee975566f3cb
DIVERGENCE   = 1 ahead, 0 behind
FILES_CHANGED = trust-policy/trust-epoch.json   (and nothing else)

trust_epoch           = 26
root_contract_version = boss-root-trust-26
root_surface_hash     = 0c139bd5bb4750febda923582bf0266fe0753502e2b8dbd4ad740ab4a38826bf
parent_epoch_hash     = eb2f9b1b4116576c35db718f442fe975c595b9ee85196a5abb0c1234673d4f68
epoch_hash            = 85f1c49b772d33a5c05127723bc6653603b92572e18ee4ecbcc1a553e17996d9
```

Every value matches what the workflow reported. Epoch 25's `epoch_hash` `eb2f9b1b…` is exactly the candidate's
`parent_epoch_hash`, so the chain is intact.

## M-2 — `REPRODUCTION`: the clean checkout, and the `root-trust-surface.json` question resolved

`REPRODUCTION`. Run in a clean `git worktree` at `aaa3d373…`, outside the long-lived checkout:

```text
$ node scripts/acceptance-evolution-bless.cjs --check
[bless] root trust surface: 72 files, aggregate 0c139bd5bb4750febda923582bf0266fe0753502e2b8dbd4ad740ab4a38826bf
[bless] repository: HEAD @ aaa3d3732f3d0f899c67ced9be47ee975566f3cb
[bless] epoch 26 (boss-root-trust-26) MATCHES the live surface
EPOCH26_CLEAN_CHECK = PASS
```

**The `M trust-policy/root-trust-surface.json` line in the finalization log was a working-tree artifact, not a
content change, and the branch is NOT incomplete.** Measured by comparing committed blobs:

```text
main       trust-policy/root-trust-surface.json  blob 03d61f0dcfa10aad21283b3d5911e85268343a38
epoch-26   trust-policy/root-trust-surface.json  blob 03d61f0dcfa10aad21283b3d5911e85268343a38
BYTE-IDENTICAL = true        CRLF count = 0 on both
```

The mechanism is the one §L already documented for the same file: git checks it out with CRLF on Windows
(`core.autocrlf`) while the tool writes LF, so the file shows as modified in the working tree and commits
unchanged. The decisive evidence is the check itself — `--check` passes against the **committed** tree and reports
the declared aggregate, which it could not do if the declared surface were missing from the branch.

## M-3 — `FAILURE`: the ceremony falsified three of this phase's own guards, correctly

`FAILURE` (a real, unexpected failure — recorded rather than repaired) + `MEASUREMENT`. PR #15's `pull_request`
run `35817027430` on `aaa3d373…`:

| Job | Result |
|---|---|
| `quality` | **success** |
| `architecture` | **success** (not required) |
| `unit` | **failure** — `tests/unit/city/architecture-hosted-shadow.test.ts`, 3 cases |
| `acceptance` | **skipped** (`needs: unit`) |
| `package` | **skipped** (`needs: unit`) |

```text
Test Files  1 failed | 264 passed (265)
× S6 the accepted baseline tree in GOVERNING mode is a hosted PASS with the frozen finding count
× the accepted baseline series and the accepted baseline are byte-identical to the frozen commit
× the mission's stop boundary was respected: no epoch was advanced

AssertionError: expected 26 to be 25
AssertionError: trust-policy/trust-epoch.json differs from the frozen commit; this phase must not change it
AssertionError: epoch 26 was written; that is the Owner ceremony this mission must not perform: expected 26 to be 25
```

**These are not defects of the epoch branch, and they are not a regression in the hosted-shadow engine.** All
three are assertions added by Phase 1B-B that pin the **pre-ceremony** state explicitly:

| Pin | What it asserts | Where |
|---|---|---|
| `trust-epoch.json` byte-identical to the freeze commit `b5b511d7…` | the epoch is still 25 | §L-4's own guard |
| `root_trust_epoch === 25` | no ceremony has run | `S6` |
| `trust_epoch === 25` ("no epoch was advanced") | the machine did not advance it | negative control |

At epoch 26 every one of them is **supposed** to be false. They passed while the candidate was deliberately stale
at epoch 25 — that is precisely what `EXPECTED_1`/`EXPECTED_2` in §K-7 recorded — and they fail now because the
ceremony did what it exists to do.

**The self-criticism, stated plainly.** §L-4 replaced a guard that could be satisfied by editing a constant with
one that compares against immutable history. That was the right direction, but it left the guard **over-fitted to
the epoch in force at the time**: it hardcodes "epoch 25" and "byte-identical to `b5b511d7`", so the very
ceremony the governance process requires to happen will always break it. A guard that must be rewritten by each
epoch advance is not measuring the property it claims to measure — "the machine must not advance the epoch
unilaterally" is a statement about *who* advanced it, not about the number staying 25 forever.

The repair belongs to the Phase 1B-B line (make the pins express the invariant rather than the epoch number), and
**not** to this finalization branch. PR #15 was therefore left exactly as the workflow authored it: no commit, no
amendment, no branch mutation. The unexpected failure is reported to the Owner rather than repaired, per the
handoff's Part 5 instruction.

```text
PR = 15
PR_AUTHOR = codex-boss[bot] (Bot, id 327719386)
PR_HEAD_SHA = aaa3d3732f3d0f899c67ced9be47ee975566f3cb
PR_BASE_SHA = adf92b619aa83b398a857ac8d2039fd6cc1eb0d9
PR_RUN = 35817027430
QUALITY = success    ARCHITECTURE = success    ARCHITECTURE_REQUIRED = NO
UNIT = failure (3 epoch-25 over-pins)    ACCEPTANCE = skipped    PACKAGE = skipped
EPOCH_READVANCED = NO    RULESET_CHANGED = NO    BASELINE_WIDENED = NO
OWNER_CREDENTIAL_USED_FOR_PR = NO
```

## M-4 — what this records about the process

Two things worth keeping, both of which are the same lesson §L-3 already learned once:

1. **A guard is only as good as the state it is allowed to assume.** §L-4's frozen-commit comparison made the
   *evidence* stronger and the *assumption* narrower at the same time, and the narrowing is what failed here.
2. **The expected-red set has to be re-derived at every governance transition.** §K-7 named the epoch-staleness
   failures for the *pre-ceremony* candidate. After the ceremony, the expected-red set is different — and this
   ledger entry, not the green count, is where that gets recorded.






