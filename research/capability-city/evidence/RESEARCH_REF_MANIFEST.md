# RESEARCH REF MANIFEST — Capability City

Durable refs and tracked research artifacts, so that historical evidence is reachable **through Git and
tracked documentation**, never through reflog or dangling objects.

**Path note.** The mission's preferred location was `artifacts/research/`. This repository declares
`artifacts/` as a `RUNTIME_OWNED_PATH` that must never own a tracked file
(`tests/unit/workspace-path-ownership.test.ts`), so these ledgers live under the **tracked**
`research/capability-city/` tree instead. Final paths are listed below.

---

## 1. Durable refs — baselines and tags

| Ref | Type | Target | Meaning |
|---|---|---|---|
| `pre-city-baseline-v1` | annotated tag | `7024203eee3444a0115664de5e3a3d6599d9a800` | **Immutable research control.** The authentic Pre-City state, which **intentionally retains** the runtime-isolation defect (FINDING-002) and the architecture-gate blindness (FINDING-001). Never moved, never retagged, never repaired in place. |
| `research/pre-city-runtime-isolation-defect-v1` | annotated tag | `7024203…` | Explicit archival alias naming the defect control, so the defect is findable by name as well as by baseline. |
| `research/identity-separation-stage-c-v1` | annotated tag | `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b` (I1) | Archival ref for the identity-separation Stage C line and the instrument-v2 boundary. |
| `city-start-baseline-v1` | annotated tag | **NOT CREATED** | Must point at the corrected `main` **after** legitimate promotion. Deliberately absent: the promotion is awaiting Root Owner review, and tagging an unpromoted or experimental commit is forbidden. |

## 2. Durable refs — branches holding research evidence

All verified present on `origin` via `git ls-remote --heads origin`.

| Branch | Tip | Holds | Status |
|---|---|---|---|
| `main` | `7024203…` | production | unchanged during this round |
| `integration/pre-city-baseline` | `836b5ed` | the Pre-City RC line (ancestor of `main`) | PRESERVED |
| `fix/runtime-isolation-root-policy-v1` | `d9ddb15` | main-derived production repair | PRESERVED · promotion PR head |
| `test/pf020-runtime-isolation-production-fix-v2` | `2f36d99` | P1 + I1 + validation fixes (instrument V2 line) | PRESERVED |
| `feat/pf020-identity-convergence` | `add57742` | the original instrument; Stage C attempt-1 precondition failure | PRESERVED · **NOT MERGED BY DESIGN** |
| `refactor/capability-city-v1` | see §4 | the research line (ledgers, GOV-001..006, dataset) | PRESERVED |
| `evolution/acceptance-promotion-identity-20260922002549` | `3ce1ef89` | Stage C preflight candidate (rootSource=external-sibling) | **PUSHED THIS ROUND** — was single-copy |
| `evolution/acceptance-promotion-identity-20260922010033` | `16d093d3` | Stage C preflight candidate | **PUSHED THIS ROUND** — was single-copy |
| `evolution/acceptance-promotion-identity-20260922002642` | `d8fc0fb` | **the measured Stage C candidate** (PR #9, `WAITING_FOR_ROOT_OWNER`) | PRESERVED |

### Preservation action taken this round

The commit-provenance audit found that `3ce1ef89` and `16d093d3` existed **only** as local branches in
`D:\Boss-PF020-Live-Acceptance`: absent from the remote and absent from the other checkout's object store —
**single-copy, and one `git gc` from unreachable**. Both were pushed to `origin` and are now reachable from
durable refs. `d8fc0fb` was reachable only via the closed PR #9's head branch, which has now been made
explicit by the `research/identity-separation-stage-c-v1` tag pointing at the instrument that produced it.

**No branch was deleted.** **No tag was moved.** **No history was rewritten.**

## 3. Reachability audit

| Question | Answer |
|---|---|
| Research-significant commits recorded | 26 |
| Unreachable commits | **NONE** |
| Reachable but single-ref (at risk, now mitigated) | 3 Stage C candidates → all now durable on `origin` |
| Commits outside production ancestry | 16 — this is **acceptable by design**; a commit need not be in production ancestry to be durably preserved |
| Reliance on reflog or dangling objects | **none** |
| Local `main` in `D:\Boss-PreCity-RC` | stale at `4da0ed0` (25 behind `origin/main`) — a checkout-state caveat for naive reachability checks, **not** a provenance defect |

## 4. Tracked research artifacts (final paths)

All under `research/capability-city/` on `refactor/capability-city-v1`.

| Artifact | Role |
|---|---|
| `RESEARCH_LEDGER.md` | decision ledger D-001..D-009 |
| `PAPER_NOTES.md` | paper notes; four chronological stages; negative results N-1..N-14 |
| `RQ.md` | frozen research questions RQ1–RQ5 (frozen before construction) |
| `threats-to-validity.md` | threats §1–§19 |
| `TRUST_GOVERNANCE_FINDING.md` | governance finding and the measured resolution |
| `OWNER_MACHINE_IDENTITY_CEREMONY.md` | Owner ceremony runbook (no secrets) |
| `evidence/BUG_FINDING_LEDGER.md` | FINDING-001..006, full mission schema |
| `evidence/EXPERIMENT_TIMELINE.md` | 32-row chronological timeline + causal chain |
| `evidence/CLAIM_EVIDENCE_MATRIX.md` | CLAIM-001..007 with prohibited overclaims |
| `evidence/COMMIT_PROVENANCE_LEDGER.md` | 26 commits × 11 required fields + reachability audit |
| `evidence/RESEARCH_REF_MANIFEST.md` | **this file** |
| `evidence/PAPER_EVIDENCE_INDEX.md` | index of the 19 mission-listed high-value evidence items |
| `dataset/baseline-metadata.json` | frozen BEFORE-state metadata |
| `dataset/metrics.json` | M-01..M-25 + negative-result schema |
| `dataset/artifact-manifest.json` | sha256 content binding for every artifact |
| `dataset/github/pr8.json`, `main-protection-ruleset.json` | raw platform evidence |
| `dataset/governance/*.json` | Stage B report, Stage C attempt-1, attempt-2 preflight + PASS reports, PF020 source verification |
| `experiments/governance/GOV-001..GOV-006*.md` | observed failure, frozen protocol, C1/C2 separation, scope determination, instrument diff, production repair |

## 5. Documented provenance discrepancies — recorded, not silently "fixed"

The commit-provenance audit found two internal inconsistencies. They are **recorded here rather than
quietly edited**, because a silent correction would itself be a provenance defect.

| # | Discrepancy | Substance | Disposition |
|---|---|---|---|
| D-1 | `RQ.md:3` and `:28` bind `pre-city-baseline-v1` to `836b5ed`, but the tag now points at `7024203`. | The **content is byte-identical** — `836b5ed^{tree} == pre-city-baseline-v1^{tree} == 8e31f066…`, and `git diff 836b5ed origin/main` is empty. `836b5ed` is the verified RC commit; `7024203` is its merge commit, which the tag was created from. | Recorded. The authoritative statement is `dataset/baseline-metadata.json`, which names both (`pre_city_baseline_v1_tag = 7024203…`, `verified_rc_commit = 836b5ed…`). No edit to `RQ.md`: rewording a frozen research question's provenance line after the fact is exactly the kind of retrospective tidying this programme forbids. |
| D-2 | `dataset/baseline-metadata.json:7` records `capturedAtCommit.cityBranchCommit = daf20c4`, but the file was introduced at `dc42346`. | The metadata was authored while `daf20c4` was the tip and committed one commit earlier. | Recorded. The substantive content (SHAs, counts, trust state) is unaffected; the field is a commit-stamp, not evidence. |
| D-3 | An earlier round's `paper/PAPER_NOTES`-style narrative (now `README`-free) described Stage C as "NOT YET MEASURED" while a **third** candidate (`16d093d3`) already existed from a preflight rerun. | The preflight candidate was never a measurement and no claim was ever based on it. | Recorded in `COMMIT_PROVENANCE_LEDGER.md`; the candidate is now durably preserved. Stage C classification is unchanged: attempt 1 = `PRECONDITION FAILURE`, attempt 2 = the measurement. |

## 6. What must never be relied upon

```
reflog
dangling objects
SHA text in Markdown with no reachable ref
a single-copy local branch
a closed PR's head branch as the sole reference
```

Every item above has been replaced with a durable ref or a tracked artifact.

## 7. Reproduce

```
git fetch --all --tags --prune
git tag -l "pre-city-*" "research/*" "city-start-*"
git ls-remote --heads origin | Select-String "fix/runtime-isolation|test/pf020|refactor/capability-city|evolution/acceptance-promotion"
git cat-file -e 7024203eee3444a0115664de5e3a3d6599d9a800     # defect control
git cat-file -e 3ce1ef89ea4047f1ed90be91585e6493387de847     # Stage C preflight candidate
git cat-file -e 16d093d342e0ff22546654d9acfaa417d708a163     # Stage C preflight candidate
git cat-file -e d8fc0fb6579173a7f6200f06a494ddd744175d61     # measured Stage C candidate
```
