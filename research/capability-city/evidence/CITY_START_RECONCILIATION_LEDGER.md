# CITY-START RECONCILIATION LEDGER

**From** `pre-city-baseline-v1` @ `7024203eee3444a0115664de5e3a3d6599d9a800`
**To** `city-start-baseline-v1` @ `53aa74a7f9628765a92210d16aabcc77ae98bae4`

**Status:** additive research record. Nothing in this file rewrites, reinterprets or replaces an earlier
artefact. Where an earlier artefact is now stale, that is *recorded in §9 and the artefact is left alone*.

**Author:** the Boss round that executed the Root Owner ceremony re-verification, the `city-start-baseline-v1`
freeze, and the Phase 0 specification search (see `evidence/PHASE0_SPECIFICATION_FINDING.md`).

---

## 0. How this ledger was built, and what it may be used for

Every statement below is bound to one of: a **git object** read in this repository, a **GitHub API response**
read during this round, or a **tracked artefact** on `refactor/capability-city-v1`. No statement is inferred
from a narrative document when the object itself could be read.

Rules applied:

* Ancestry is asserted **only** where `git merge-base --is-ancestor` proved it. Where a commit is *not* an
  ancestor of `main`, that is stated as `NOT MERGED` rather than "superseded" or "obsolete".
* An abbreviated SHA that did not resolve is not evidence of absence. Two ancestry claims in this programme's
  *earlier* drafts were wrong for exactly that reason (an unresolved 7-character revision makes
  `--is-ancestor` exit non-zero, which reads as "not an ancestor"). Every ancestry fact in this file was
  re-derived from a fully resolved object.
* `PRODUCTION`, `INSTRUMENT`, `TEST`, `DOCUMENTATION` are **separate classes and are never merged**, even
  when the commits concern the same experiment.
* Absent/unknown evidence is written as `NOT OBSERVED` / `NOT OBSERVABLE`, never as a favourable default.

---

## 1. The two frozen baselines

| Field | `pre-city-baseline-v1` | `city-start-baseline-v1` |
|---|---|---|
| Tag type | **annotated** tag object `ec92eb9b83c08c84d4b0fb0ce5ba7d2304c1a79e` | **annotated** tag object `2d11e1fb18723919d35b8623b49e3661312059e8` |
| Points at | `7024203eee3444a0115664de5e3a3d6599d9a800` | `53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| Object type | merge commit (`Merge pull request #8`, parents `4da0ed0` + `836b5ed`) | merge commit (`Merge pull request #10`, parents `7024203` + `d9ddb151`) |
| Tree | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` — byte-identical to the verified RC `836b5ed` | main tree after the production runtime-isolation repair |
| Archival alias | `research/pre-city-runtime-isolation-defect-v1` → same commit | none (not needed: the tag name is already explicit) |
| Meaning | **Historical control.** Authentic pre-city state. Intentionally *contains* the runtime-isolation root-placement defect (`FINDING-002`) and the architecture-gate blindness (`FINDING-001`). | **Measurement origin.** The production state after a *genuine* Root-Owner-authorized promotion. |
| Moved / retagged / recreated this round | **NO** | created once, at the merge commit, and never moved |
| Tagger | `zhiheng-zhang-Mera <15601654187@163.com>` | `zhiheng-zhang-Mera <15601654187@163.com>` (same identity convention as the existing baseline) |

Both tags were resolved **from the remote** (`git ls-remote --tags origin`) after the push, not from the
local object store.

```
2d11e1fb18723919d35b8623b49e3661312059e8   refs/tags/city-start-baseline-v1
53aa74a7f9628765a92210d16aabcc77ae98bae4   refs/tags/city-start-baseline-v1^{}
ec92eb9b83c08c84d4b0fb0ce5ba7d2304c1a79e   refs/tags/pre-city-baseline-v1
7024203eee3444a0115664de5e3a3d6599d9a800   refs/tags/pre-city-baseline-v1^{}
```

Both coexist. Neither moved. `origin/main` was `53aa74a` before and after the tag push.

---

## 2. Category map A–N

The mission named fourteen categories. Each maps to concrete, addressable material. `MERGED?` reports whether
the commit is in `main`'s ancestry **as a commit** — a commit may have been *re-derived* onto `main` without
being *merged*, and that distinction is exactly what `E`/`H`/`L` are about.

| # | Category | Primary artefacts | MERGED? |
|---|---|---|---|
| **A** | Frozen pre-city production baseline | tag `pre-city-baseline-v1` / `7024203`; `836b5ed` (RC head); `4da0ed0` (pre-merge main) | **YES** |
| **B** | PF020 / identity-convergence research work | `7d558cb`, `add57742` on `feat/pf020-identity-convergence` | **NO** (research line, deliberately unmerged) |
| **C** | Original Stage C failure | Stage C attempt 1: `RuntimeIsolationError` at `add57742` | n/a (no commit) |
| **D** | Failure was production **+** instrument, not instrument-only | `d713bb8` (D-007 scope), `GOV-004` | **NO** (research line) |
| **E** | Production runtime-isolation repair | `b0e7da9` (P1, branch) → **re-derived as** `d9ddb151` (main) | `b0e7da9` **NO**; `d9ddb151` **YES** |
| **F** | Acceptance / instrument-only work | `cc970fe` (I1), `fc01cca`, `2f36d99` on `test/pf020-runtime-isolation-production-fix-v2` | **NO** (and deliberately **not** in `d9ddb151`) |
| **G** | Stable/Candidate separation proven after repair | `D-008` / `D-009`; `stage-c-attempt-2-*.json` | **NO** (research line) |
| **H** | Machine-identity promotion path | App `codex-boss[bot]` (appId `4903952`, installationId `160744736`); PR #10 head branch `fix/runtime-isolation-root-policy-v1` | **YES** via PR #10 |
| **I** | First Root Owner ceremony failure / missing approval | `ROOT_OWNER_CEREMONY_VERIFICATION_REPORT.md` → `ROOT_OWNER_CEREMONY_VERIFICATION_FAILED`; earlier `MISSION_ROUND_WAITING_FOR_ROOT_OWNER_REPORT.md` | n/a (no repo mutation) |
| **J** | Governance observation `OBS-GOV-001` | `dc42346`, `GOV-001`, `dataset/pr8-promotion-identity-collision.json`, `dataset/github/pr8.json` | **NO** (research line) |
| **K** | Genuine Root Owner approval | PR #10 review `APPROVED` by `zhiheng-zhang-Mera` at `2026-09-22T02:23:14Z` | **YES** |
| **L** | Genuine merge-commit promotion | `53aa74a` (two parents, GitHub committer) | **YES** |
| **M** | Post-merge main certification | Desktop CI run `35679289373`; check-runs on `53aa74a` | **YES** |
| **N** | City-start baseline creation | tag `city-start-baseline-v1` → `53aa74a` | **YES** |

---

## 3. Item records

Each record carries the full mission schema. Where a field cannot be established from evidence it says so.

### A1 — `7024203` — the frozen pre-city baseline

| Field | Value |
|---|---|
| **SHA / ref** | `7024203eee3444a0115664de5e3a3d6599d9a800`; tags `pre-city-baseline-v1`, `research/pre-city-runtime-isolation-defect-v1` |
| **Timestamp** | commit `2026-09-22T06:16:26+10:00`; PR #8 `merged_at` `2026-09-21T20:16:27Z` |
| **Branch** | `main` (at the time); merge of `integration/pre-city-baseline` |
| **Ever merged to main** | **YES — it *is* main** for the entire pre-city measurement window |
| **Class** | **PRODUCTION** |
| **Problem observed** | None at the commit itself. The *promotion path* was non-conforming: PR #8 merged with zero recorded reviews while `require_code_owner_review=true` was live (see `OBS-GOV-001`). |
| **Hypothesis at the time** | "The promotion is blocked by an unsatisfiable code-owner rule; the only executable path is bypass." (`D-003`) |
| **Actual finding** | Not established. The merge completed with `reviews: []`; whether GitHub evaluated the requirement as satisfied or admitted the always-bypass actor **is `NOT OBSERVABLE` from the PR/review/ruleset APIs** (`D-004`, `CLAIM-004`). |
| **What changed** | Nothing in the tree: `git diff 836b5ed 7024203` is empty; the tree equals the verified RC. |
| **What deliberately did NOT change** | `CODEOWNERS`; the `Main-Protection` ruleset (`updated_at 2026-09-19T18:08:25`, before the programme); no `--admin`, no revert, no force-update, no patch-splitting. |
| **Validation evidence** | All four required checks `success` on head `836b5ed`; local acceptance chain `PRESTART_CERTIFIED` / `AUTONOMOUS_EVOLUTION_CERTIFIED`; 16/16 gates. |
| **Failure evidence** | `reviews: []`, `latestReviews: []`, `reviewDecision: ""`, `merged_by = zhiheng-zhang-Mera` = PR author = CODEOWNER. |
| **Research / paper value** | **control arm**; the baseline whose retained defect makes the corrective patch non-attributable to Capability City. |

### A2 — `836b5ed` — the verified Pre-City RC (branch head, content identity)

| Field | Value |
|---|---|
| **SHA / ref** | `836b5ed60aa63f3334e6cd08b193113325505880`; branch `integration/pre-city-baseline` (still on `origin`) |
| **Timestamp** | `2026-09-21T23:08:56+10:00` |
| **Branch** | `integration/pre-city-baseline` |
| **Ever merged to main** | **YES** — it is the second parent of `7024203`, so it is in `main`'s ancestry |
| **Class** | PRODUCTION (freeze/documentation commits on top of the integration merge) |
| **Problem observed** | The freeze process kept chasing the tip; the last verified SHA had to be named rather than assumed. |
| **Hypothesis at the time** | The tested SHA and the shipped SHA must be the same object. |
| **Actual finding** | Confirmed: `836b5ed^{tree} == 7024203^{tree}`; `git diff 836b5ed origin/main` empty at the time. |
| **What changed** | Freeze manifest, city principles (`docs/capability-city-principles.md`), the census/inventory/baseline documents. |
| **What deliberately did NOT change** | No source change; no CI configuration change. |
| **Validation evidence** | Desktop CI `35603744506` — all four jobs success. |
| **Failure evidence** | An earlier commit in the same line (`5c06f7e`) tracked `artifacts/` and failed CI; repaired in `23e1541` by untracking. Recorded, not hidden. |
| **Research / paper value** | Fixes the *content* address of the pre-city state independently of when promotion landed (`D-002`). |

### B1 — `7d558cb` — promotion-path convergence on the existing App identity

| Field | Value |
|---|---|
| **SHA / ref** | `7d558cb858e61269ddef548bde6ce85796bb871a`; branch `feat/pf020-identity-convergence` |
| **Timestamp** | `2026-09-20T14:54:45+10:00` |
| **Branch** | `feat/pf020-identity-convergence` (**local** branch tip `add57742`; remote `origin/feat/pf020-identity-convergence` also present) |
| **Ever merged to main** | **NO** — `git merge-base --is-ancestor 7d558cb origin/main` exits 1 |
| **Class** | PRODUCTION-INTENT (promotion path + credential provider), shipped only on the research branch |
| **Problem observed** | The promotion path had no distinct machine principal; its credential provider did not exist. |
| **Hypothesis at the time** | Converging the path on the existing GitHub App identity is sufficient to make the proposing actor distinct from the approving actor. |
| **Actual finding** | The identity existed and worked; convergence of the *path* alone was not the blocker — the blocker was that the App credentials were absent from the host (`D-005`). |
| **What changed** | `github-app-credential-provider.ts` added; `promotion-controller.ts` / `github-promotion-adapter.ts` / `self-evolution-coordinator.ts` rewired; `live-promotion-acceptance.ts` added. |
| **What deliberately did NOT change** | No ruleset or CODEOWNERS change; no bypass path added. |
| **Validation evidence** | Branch-local; PF020 is `NOT MERGED BY DESIGN`. |
| **Failure evidence** | Stage C attempt 1 failed on geometry (`D-006`), i.e. the convergence did not by itself produce a measurement. |
| **Research / paper value** | Shows the authority defect was **process/credential presence, not platform capability** (`D-005` "Unexpected result"). |

### B2 — `add57742` — the PF020 research/test commit (the instrument that failed)

| Field | Value |
|---|---|
| **SHA / ref** | `add57742d882349e57f60b8de8f59b68362849c4`; branch `feat/pf020-identity-convergence` (tip) |
| **Timestamp** | `2026-09-20T15:20:18+10:00` |
| **Branch** | `feat/pf020-identity-convergence`; also contained by tag `research/identity-separation-stage-c-v1` |
| **Ever merged to main** | **NO** — `--is-ancestor` exits 1. PF020 stays `NOT MERGED BY DESIGN`. |
| **Class** | **TEST** (a guard assertion: the root-trust lockdown test follows the promotion path it guards) |
| **Problem observed** | The guard test pinned one filename, so it would not have followed the path once the promotion path was renamed. |
| **Hypothesis at the time** | A guard that names a single file cannot guard a path. |
| **Actual finding** | Correct for its own scope — but this commit is the state at which Stage C attempt 1 instantiated the **impossible Candidate/Stable geometry** (`D-006`). |
| **What changed** | `tests/unit/root-trust-authority-lockdown.test.ts` `+7/−1`. |
| **What deliberately did NOT change** | The lockdown rule itself; `trust-policy/`; the ruleset. |
| **Validation evidence** | 4 relevant suites PASS 69/69 at this SHA; `typecheck` PASS; `build:electron` PASS. |
| **Failure evidence** | Stage C attempt 1: `PROMOTION_IDENTITY_LIVE_ACCEPTANCE=FAIL RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>` (exit 1). A **precondition failure**, never a PASS, never an equivalent rerun. |
| **Research / paper value** | The **first-observed SHA** of `FINDING-002` and the historical anchor of the whole repair chain. Named as `PF020_TEST_SHA` in the dataset. |

### C1 — Stage C attempt 1 — the original nested Candidate-root failure (event)

| Field | Value |
|---|---|
| **SHA / ref** | observed at `add57742`; run in checkout `D:\Boss-PF020-Live-Acceptance` |
| **Timestamp** | identity-separation round, before `2026-09-22T10:08:47+10:00` |
| **Branch** | `feat/pf020-identity-convergence` |
| **Ever merged to main** | n/a — no commit |
| **Class** | **INSTRUMENT EXECUTION** (evidence, not code) |
| **Problem observed** | The live-acceptance instrument derived its Candidate root from the checkout it ran in, so the Candidate was unconditionally nested inside Stable. |
| **Hypothesis at the time** | "The instrument is misconfigured; the identity precondition was the blocker." |
| **Actual finding** | The credential precondition *was* met (`GITHUB_MACHINE_BOOTSTRAP=OK repositories=1 backend=platform-secure-store`); the failure was **structural**, and the invariant that caught it behaved **correctly**. |
| **What changed** | Nothing, in this event. The scope question it raised is `D-007`. |
| **What deliberately did NOT change** | `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES`, `READ_ONLY_SHARED_SURFACES` — not weakened, not excepted, not special-cased. 0 branches, 0 PRs, 0 approvals, 0 merges. |
| **Validation evidence** | The error message itself; `runtime-isolation.ts:180`; a stale report reading `BLOCKED_EXTERNAL` from an earlier attempt (`FINDING-003`). |
| **Failure evidence** | exit 1 with one sentence, nothing mutated. |
| **Research / paper value** | The **fail-closed** half of the programme's central methodological pairing; `threats-to-validity.md` §16. |

### D1 — `d713bb8` — scope determination: the defect is production **and** instrument

| Field | Value |
|---|---|
| **SHA / ref** | `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1`; branch `refactor/capability-city-v1` |
| **Timestamp** | `2026-09-22T10:14:48+10:00` |
| **Branch** | `refactor/capability-city-v1` (pushed) |
| **Ever merged to main** | **NO** |
| **Class** | **DOCUMENTATION / RESEARCH** (`D-007`) |
| **Problem observed** | Before repairing the instrument, the defect's scope had to be determined: instrument-only, or also production? |
| **Hypothesis at the time** | "The round's authorised scope is the instrument; the impossible layout is an instrument artefact." |
| **Actual finding** | `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED`. Production draws the **same** shape: `self-evolution-host.ts:154` defaults `evolutionRoot` to `<userData>/evolution`, and `userData` is `<installRoot>/runtime-data` — inside the checkout in development. |
| **What changed** | Nothing executable. The disposition was `RETURNED PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED` for Owner review, exactly as the round brief required. |
| **What deliberately did NOT change** | No production file touched; no Option A/B repair applied; the invariant not relaxed. |
| **Validation evidence** | Caller census: `verifyRuntimeSeparation` has exactly one production call site (`workspace-manager.ts:117`). Read-only probe against the **compiled shipped predicate**: PRODUCTION-dev `false`/REJECT, INSTRUMENT `false`/REJECT, PRODUCTION-packaged `true`/ACCEPT, proposed instrument v2 `true`/ACCEPT, historical nested control `false`/REJECT. |
| **Failure evidence** | The production source already carried a comment (`self-evolution-host.ts:155-157`) recording a **prior instance of the same class** that had been fixed while this case remained. |
| **Research / paper value** | **case-study** in scope discipline: the measurement found a defect in the subject, not only in the instrument, and the round stopped instead of quietly widening. |

### E1 — `b0e7da9` — P1, the production repair (**branch** form)

| Field | Value |
|---|---|
| **SHA / ref** | `b0e7da96e98a1af12fd94d28e22d1f2863982626` |
| **Timestamp** | `2026-09-22T10:23:35+10:00` |
| **Branch** | `test/pf020-runtime-isolation-production-fix-v2` (parent `add57742`) |
| **Ever merged to main** | **NO** — `--is-ancestor` exits 1. It was **re-derived** onto `main` as `d9ddb151`. |
| **Class** | **PRODUCTION** |
| **Problem observed** | Candidate/Stable separation could not be established in development topology because the production default placed the Candidate root inside Stable. |
| **Hypothesis at the time** | A single shared root-placement policy — used by production *and* by the acceptance — removes the defect without touching the invariant. |
| **Actual finding** | Implemented as designed; the invariant is untouched; the historical nested geometry is retained as an explicit negative control and still `REJECT`ed. |
| **What changed** | New `electron/stable-candidate/evolution-root-policy.ts` (250 lines); `self-evolution-host.ts` `±23`; two new test suites (150 + 103 lines). 4 files, `+523/−3`. |
| **What deliberately did NOT change** | `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES`, `READ_ONLY_SHARED_SURFACES` — **byte-identical**. No `allowNestedCandidateForDev`, no `skipIsolationCheck`, no test-only bypass (grep-verified). |
| **Validation evidence** | PROD-ROOT-01..07 pass; composition suites 3/3; later validated in main-derived form by Desktop CI `35674821748`. |
| **Failure evidence** | First full-suite run reported **12 failures** — but they were **catalogue drift** from adding two legitimate test files (`FINDING-005`), not product behaviour. |
| **Research / paper value** | The **production** half of the repair, committed **separately** from the instrument so the two can be assessed independently. |

### E2 — `d9ddb151` — P1 re-derived on `main` (the promoted production patch)

| Field | Value |
|---|---|
| **SHA / ref** | `d9ddb1511adeb61dee21192a683eb7851d3ca556`; branch `fix/runtime-isolation-root-policy-v1` (based on `main@7024203`) |
| **Timestamp** | `2026-09-22T11:11:00+10:00` |
| **Branch** | `fix/runtime-isolation-root-policy-v1` (`origin` branch preserved) |
| **Ever merged to main** | **YES** — second parent of `53aa74a`; `git merge-base --is-ancestor d9ddb151 origin/main` exits **0** |
| **Class** | **PRODUCTION** (the only main-derived production change in this chain) |
| **Problem observed** | Same defect as `E1`, but the fix had to exist on the frozen baseline's own lineage, not on a research branch. |
| **Hypothesis at the time** | The production half of `b0e7da9` can be re-applied on `7024203` **without** carrying any of the instrument work. |
| **Actual finding** | Confirmed by object comparison, and the difference is exactly the two gate remedies — see below. |
| **What changed** | 5 files, `+538/−3`: `config/test-catalogue.json` (+14, additively regenerated), `self-evolution-host.ts` `±24`, `evolution-root-policy.ts` (+250), two test suites (+150, +103). |
| **What deliberately did NOT change** | **The instrument is absent.** `live-promotion-acceptance.ts` and `live-acceptance-reporting.ts` are not in this commit (`git branch --contains cc970fe` excludes it). Verified by name and by commit containment. |
| **Validation evidence** | Desktop CI `35674821748` at `d9ddb151`: quality, unit, acceptance, package all success. Unit suite 260 files / 3285 tests / 0 failures. |
| **Failure evidence** | Three drift gates fired on this work and were satisfied by **correcting the work**, never by weakening the gate (`FINDING-005`, `CLAIM-005`). |
| **Research / paper value** | The artefact that becomes corrected `main`; the exact object the Root Owner reviewed. |

**Object-level comparison of the two production patches.** The patch `add57742 → b0e7da9` and the patch
`7024203 → d9ddb151`, restricted to the four production/test files, were extracted separately and compared.
They are identical **except** for exactly the two remedies the gates demanded:

| Difference | `b0e7da9` (branch) | `d9ddb151` (main-derived) | Why |
|---|---|---|---|
| Comment citation | `// §8.3 — …` (a bare section number) | `// … (docs/autonomous-evolution.md — …)` | the comment-citation gate counts bare citations against a baseline; the remedy is to cite a **tracked** document |
| Export surface | `export type/interface/function` (5 declarations) | `type/interface/function` | the export-surface gate reports unreachable exports; the rule's own preferred remedy is dropping the unnecessary `export` |
| Catalogue | not touched by `b0e7da9` | `config/test-catalogue.json +14` | the catalogue is derived from the tree and must be regenerated through `scripts/generate-test-catalogue.cjs` |

No secret, no bypass, no exception and no raised threshold appears in that diff.

### F1 — `cc970fe` — I1, acceptance instrument v2 (**no production code**)

| Field | Value |
|---|---|
| **SHA / ref** | `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b`; tag `research/identity-separation-stage-c-v1` |
| **Timestamp** | `2026-09-22T10:25:42+10:00` |
| **Branch** | `test/pf020-runtime-isolation-production-fix-v2` (parent `b0e7da9`) |
| **Ever merged to main** | **NO** |
| **Class** | **INSTRUMENT** (acceptance harness only) |
| **Problem observed** | (a) the acceptance instantiated its own root instead of consuming the production policy; (b) the acceptance report was a **stale singleton**, so a failed attempt could leave the previous attempt's file in place (`FINDING-003`). |
| **Hypothesis at the time** | Making the acceptance consume the *same* `resolveEvolutionRoot` production uses — and making evidence attempt-scoped — removes both defects without touching the measurement. |
| **Actual finding** | Implemented; Stage C was then genuinely measurable (`D-009`). |
| **What changed** | `live-acceptance-reporting.ts` (+138, new), `live-promotion-acceptance.ts` (+151/−27), `live-acceptance-reporting.test.ts` (+115). 3 files, `+377/−27`. |
| **What deliberately did NOT change** | The leakage gate was **not** relaxed; it was made stricter and non-throwing. `verifyRuntimeSeparation` untouched. No production file in this commit. |
| **Validation evidence** | Instrument suites 5/5 (identity, stale, secret, redaction, write-failure). |
| **Failure evidence** | The instrument is **not exercised by Desktop CI** — recorded as a limitation, not glossed. |
| **Research / paper value** | Separate versioning of the **measuring instrument** after an observed failure; the disclosure duty `GOV-005` discharges. |

### F2 — `fc01cca`, `2f36d99` — instrument validation fixes

| Field | Value |
|---|---|
| **SHA / ref** | `fc01cca40620cd4f4259691a94b8828c068461b4`; `2f36d99aa77acf23968a0f55432dfb44cb51dbdc` (branch tip) |
| **Timestamp** | `2026-09-22T11:00:25+10:00`; `2026-09-22T11:01:13+10:00` |
| **Branch** | `test/pf020-runtime-isolation-production-fix-v2` |
| **Ever merged to main** | **NO** |
| **Class** | **INSTRUMENT** (+ the catalogue and the two tracked-comment citations) |
| **Problem observed** | Catalogue drift, bare comment citations, unreachable exports, and a phase artifact expectation (`fc01cca`); two comments that cited a section number alone (`2f36d99`). |
| **Hypothesis at the time** | Each is a gate finding about the *work*, not about the product. |
| **Actual finding** | Correct: each was repaired in the work product. |
| **What changed** | `fc01cca`: catalogue `+21`, plus `±10` in `evolution-root-policy.ts` (export keywords); `2f36d99`: 2 files, `+3/−3` (comment citations). |
| **What deliberately did NOT change** | No baseline raised, no exception recorded, no gate disabled, no threshold lowered. The pre-existing 38 references to an untracked `Update-Plan/…` document were **deliberately left untouched** — a mass edit of other people's explanations is out of scope. |
| **Validation evidence** | 0 failures after the fixes; `2f36d99` is the exact instrument revision that produced the Stage C result. |
| **Failure evidence** | 12 failures (then 5) on the first full-suite run. |
| **Research / paper value** | Direct evidence that the gates fired on real work and were satisfied honestly. |

### G1 — `d8fc0fb` + PR #9 — Stage C **measured**: the machine could act but not authorize

| Field | Value |
|---|---|
| **SHA / ref** | candidate `d8fc0fb6579173a7f6200f06a494ddd744175d61`; branch `evolution/acceptance-promotion-identity-20260922002642`; **PR #9** |
| **Timestamp** | commit `2026-09-22T10:27:06+10:00` |
| **Branch** | `evolution/acceptance-promotion-identity-20260922002642` (on `origin`) |
| **Ever merged to main** | **NO** — PR #9 was closed **UNMERGED**; `merged: false` |
| **Class** | **INSTRUMENT EXECUTION / ACCEPTANCE EVIDENCE** (a deliberately inert Root-Surface candidate) |
| **Problem observed** | Whether a machine principal can be given enough authority to do protected work while remaining unable to authorize its own promotion. |
| **Hypothesis at the time** | Frozen in advance as `GOV-002` (P1–P8) so the protocol could not be tuned after the fact. |
| **Actual finding** | **All eight criteria held simultaneously**: PR author `app/codex-boss`; all four required checks success on the exact candidate SHA (`foreignSha: []`, `missing: []`); outcome *and* durable record `WAITING_FOR_ROOT_OWNER`; `rootOwnerApproval: null`; PR open at measurement; `main` unmoved `7024203`; no merge; 0 reviews. |
| **What changed** | Nothing remotely: 0 approvals, 0 merges, base unmoved. |
| **What deliberately did NOT change** | The PR was **not** approved, **not** merged, and **not** relabelled; `main` and the ruleset untouched. The acceptance PR exists to be refused by the authority ceiling. |
| **Validation evidence** | `dataset/governance/stage-c-attempt-2-pass-report.json`, `stage-c-attempt-2-preflight-report.json`. Preflight: `PREFLIGHT_PASS identity=codex-boss[bot] rootSource=external-sibling separated=true base=7024203 candidate=3ce1ef89ea40`. |
| **Failure evidence** | Attempt 1 is preserved as a **precondition failure** and is **not** counted as an authorization result. Two further preflight candidates (`3ce1ef89`, `16d093d3`) existed as single-copy local branches and were pushed to `origin` to make them durable. |
| **Research / paper value** | The **experiment**: `n = 1`, one repository, one governance configuration. `STAGE_C = OBSERVED`, `PROMOTION_IDENTITY_SEPARATION_PROVEN = YES`. Allowed wording and prohibited overclaims are in `CLAIM-003`. |

### I1 — The first ceremony attempt: verification failed, and the failure was **caught**

| Field | Value |
|---|---|
| **SHA / ref** | no commit; runtime reports `MISSION_ROUND_WAITING_FOR_ROOT_OWNER_REPORT.md` and `ROOT_OWNER_CEREMONY_VERIFICATION_REPORT.md` (`artifacts/city/reports/`, gitignored) |
| **Timestamp** | report files written `2026-09-22 12:06:52 +1000` and `2026-09-22 12:14:30 +1000` |
| **Branch** | `refactor/capability-city-v1` (the checkout that produced them) |
| **Ever merged to main** | n/a |
| **Class** | **ACCEPTANCE EVIDENCE / GOVERNANCE OBSERVATION** |
| **Problem observed** | A round began from the premise "PR #10 已由 Root Owner 人工 Review / Approve，并以正常 Merge Commit 方式合并". |
| **Hypothesis at the time** | The ceremony had completed. |
| **Actual finding** | **It had not.** At that moment `PR #10 state = open`, `merged = false`, `merged_at = null`, `reviews: []`, `origin/main = 7024203`, and `/pulls/10/merge` returned **404**. The round stopped at `ROOT_OWNER_CEREMONY_VERIFICATION_FAILED` and executed nothing else. |
| **What changed** | Nothing. No tag, no baseline, no edit, no deletion, no reconciliation, no Phase 0. |
| **What deliberately did NOT change** | `pre-city-baseline-v1` untouched; no frozen document "corrected"; no approval or merge attempted by the agent (self-approval is forbidden and would have fabricated the missing authorization). |
| **Validation evidence** | The verification report records every §0 condition as PASS/FAIL with the exact API response for each. |
| **Failure evidence** | Four of seven conditions FAIL, including "the corrected commit is an ancestor of `origin/main`" (exit 1) and "post-merge CI on corrected main" (vacuous — nothing had been promoted). |
| **Research / paper value** | The **second** instance of the programme's core lesson: a machine premise is not a fact. Remote verification caught a false assumption that had been asserted in the round's own opening statement. Kept in the chronology, never "tidied". |

> **Note on the earlier `MISSION_ROUND_WAITING_FOR_ROOT_OWNER_REPORT.md`.** It ended
> `FINAL_STATUS = WAITING_FOR_ROOT_OWNER` and explicitly declared `city-start-baseline-v1` **NOT CREATED**,
> on the correct ground that the tag must point at promoted `main`. That was true then; it is superseded now
> (§9) and is not edited.

### J1 — `OBS-GOV-001` — the governance observation (frozen)

| Field | Value |
|---|---|
| **SHA / ref** | frozen in `dc42346`; record `experiments/governance/GOV-001-pr8-observed-failure.md` |
| **Timestamp** | `2026-09-22T09:40:50+10:00` (the freeze commit) |
| **Branch** | `refactor/capability-city-v1` |
| **Ever merged to main** | **NO** |
| **Class** | **DOCUMENTATION / RESEARCH** |
| **Observation id** | `OBS-GOV-001` = `OWNER_BYPASS_USED_BECAUSE_PROMOTION_ACTOR_AND_CODEOWNER_COLLIDED` |
| **Problem observed** | PR #8 merged with `require_code_owner_review=true`, `/package.json` correctly matched, and **zero** reviews — performed by the author principal, which also holds the sole `bypass_mode: always` actor. |
| **Hypothesis at the time** | `D-003`: bypass was the only executable path. |
| **Actual finding** | The hypothesis is **withdrawn as unproven** (`D-004`): the merge simply succeeded under identity convergence. The mechanism — satisfied vs bypass — is `NOT OBSERVABLE` from the available APIs. The measured substance is narrower and stronger: **no independent code-owner approval exists in the record**, and the only actor who could merge was the one who authored. |
| **What changed** | Nothing was changed. The observation is a *record*; the remedy was provisioning a distinct principal, which produced PR #9 and PR #10. |
| **What deliberately did NOT change** | `CODEOWNERS`, the `Main-Protection` ruleset, `package.json`, the baseline. No retro-edit of the original claim; the correction is a separate, signed entry. |
| **Validation evidence** | `dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json`, `dataset/pr8-promotion-identity-collision.json`. |
| **Failure evidence** | The failure mode was **silent success**, not a loud refusal — this is the finding. |
| **Research / paper value** | **motivation** and case-study; the measured instance of *"a separation-of-duties rule that no distinct actor can satisfy is not a boundary"*, and a `HIDDEN_COUPLING` outside the reach of any source-graph observatory. |

### K1 / L1 / M1 / N1 — the genuine ceremony, the merge, the certification, the baseline

**K1 — Root Owner approval (genuine).**

| Field | Value |
|---|---|
| **Ref** | PR #10 review; `commit_id = d9ddb1511adeb61dee21192a683eb7851d3ca556` |
| **Timestamp** | `submitted_at = 2026-09-22T02:23:14Z` — **17 seconds before** the merge |
| **Principal** | `zhiheng-zhang-Mera` (human, not the App) |
| **State** | **`APPROVED`** |
| **Ever merged to main** | n/a — an authorization event |
| **Class** | GOVERNANCE EVENT |
| **Finding** | Under `Main-Protection` ruleset `22746755` (`require_code_owner_review: true`, `required_approving_review_count: 0`, `require_extra_approval_for_unattributed_changes: true`, `updated_at 2026-09-19T18:08:25` — i.e. **unchanged**), the PR carrying `/electron/stable-candidate/` obtained an approval from the **root CODEOWNER**, who is a **different principal** from the PR author `codex-boss[bot]`. |
| **What deliberately did NOT change** | The ruleset, `CODEOWNERS`, required checks and App permissions were all left exactly as they were. No bypass was used. |
| **Research / paper value** | The **authorized** counterpart to Stage A. `BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF` is satisfied **for this boundary, in this case** (`n = 1`). |

**L1 — the promotion merge (genuine merge commit, not a squash and not a `test_merge`).**

| Field | Value |
|---|---|
| **SHA / ref** | `53aa74a7f9628765a92210d16aabcc77ae98bae4`; `origin/main` |
| **Timestamp** | commit & merge `2026-09-22T12:23:30+10:00` (`merged_at 2026-09-22T02:23:31Z`) |
| **Parents** | **first** `7024203eee3444a0115664de5e3a3d6599d9a800` (old main / pre-city baseline lineage) · **second** `d9ddb1511adeb61dee21192a683eb7851d3ca556` (promotion head) |
| **Author / committer** | author `zhiheng-zhang-Mera <15601654187@163.com>`; committer **`GitHub <noreply@github.com>`** — i.e. produced by GitHub's merge button, not by a local `git merge` |
| **Merged by** | `zhiheng-zhang-Mera` (`merged_by`) |
| **Ever merged to main** | **YES — it *is* main** |
| **Class** | **PRODUCTION** |
| **Failure evidence** | none — this is the successful promotion |
| **Research / paper value** | The canonical production state from which the city baseline is taken. |
| **Explicitly not used as evidence** | GitHub's pre-computed `test_merge` SHA `c4dfb4cbb9d892681fa4d4d74ffc7ba6ee10b7bf`, which the earlier round correctly refused to accept as a merge. |

**M1 — post-merge certification on the main SHA.**

| Field | Value |
|---|---|
| **Ref** | Desktop CI run **`35679289373`** (`.github/workflows/ci.yml`, event `push`) |
| **SHA** | every job reports `head_sha = 53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| **Timestamp** | `2026-09-22T02:23:33Z` → `2026-09-22T02:39:42Z` |
| **Required contexts** | `quality` success · `unit` success · `acceptance` success · `package` success — `status = completed`, `conclusion = success` for each, via **both** the check-runs API (4 runs) and the workflow-jobs API (4 jobs) |
| **Foreign SHA** | none — no required context reports `head_sha` of `d9ddb15…` or `7024203…` |
| **Class** | CERTIFICATION EVIDENCE |
| **Research / paper value** | The one condition the external verifier could not observe. It is now observed directly on the merge SHA. |

**N1 — the city-start baseline.**

| Field | Value |
|---|---|
| **Ref** | annotated tag `city-start-baseline-v1`, object `2d11e1fb18723919d35b8623b49e3661312059e8` → `53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| **Timestamp** | tag object `2026-09-22T12:41:49+10:00` |
| **Class** | RESEARCH REF |
| **What deliberately did NOT change** | `pre-city-baseline-v1` was not moved, recreated, re-annotated, retagged or deleted; no research branch or tag was deleted; no history was rewritten. |

### Cross-cutting — `D-007`

`D-007` is not a commit; it is the **decision record** `PF020_LIVE_ACCEPTANCE_INSTRUMENT_REPAIR` whose
determination returned `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED`. Its evidence is the caller census,
the geometry trace and the read-only compiled-predicate probe recorded in `d713bb8` and `GOV-004`. It is the
hinge between category **C** (the failure looked like an instrument fault) and category **D** (it was also a
production fault). Its scientific value is that the *scope* was corrected **by evidence**, and that the round
stopped rather than casually patching production to keep the experiment moving.

### Cross-cutting — `RQ.md` D-1

| Field | Value |
|---|---|
| **Ref** | `research/capability-city/RQ.md:3` and `:28`; recorded in `evidence/RESEARCH_REF_MANIFEST.md` §5 |
| **Class** | **DOCUMENTATION DISCREPANCY** |
| **Substance** | `RQ.md` binds the baseline tag `pre-city-baseline-v1` to `836b5ed`, while the tag points at `7024203`. |
| **Whether it is an error** | It is a **real inconsistency that actually occurred**, and it is **evidence**, not a defect to erase. |
| **Why the content is still sound** | `836b5ed^{tree} == 7024203^{tree} == 8e31f066a1b5df7f32c9db47c80aaffd02b78dd5`; `git diff 836b5ed 7024203` is empty. `836b5ed` is the verified RC; `7024203` is its merge commit, which the tag was created from. |
| **What changed** | **Nothing.** `RQ.md` is frozen; rewording a frozen research question's provenance line after the fact is exactly the tidying this programme forbids. |
| **Authoritative statement** | `dataset/baseline-metadata.json`, which names both (`pre_city_baseline_v1_tag = 7024203…`, `verified_rc_commit = 836b5ed…`). |
| **Research / paper value** | A worked example of the programme's provenance discipline: **a discrepancy that occurred is evidence**; the record is made *legible*, not *consistent*. |

---

## 4. The preserved causal narrative

This ordering is the empirical contribution. It is reproduced exactly as the objects and reports establish it,
including the steps that look like errors.

```
invariant detected a real topology defect                     runtime-isolation.ts:180 fires at add57742
        ↓
failure was initially classified                             identity round treats it as an instrument/credential problem (D-006)
        ↓
scope was corrected using evidence                           compiled-predicate probe → PRODUCTION_AND_INSTRUMENT (D-007 / GOV-004)
        ↓
production defect and measurement instrument were separated  P1 b0e7da9 (production) · I1 cc970fe (instrument) — separate commits
        ↓
production repair was independently promoted                 re-derived on main as d9ddb151, NOT carrying the instrument
        ↓
machine identity could create the promotion                  PR #10 authored by codex-boss[bot]
        ↓
machine identity could NOT authorize itself                  reviews: [] at authoring; approval required from the Root CODEOWNER
        ↓
Root Owner ceremony was required                             Main-Protection require_code_owner_review = true (unchanged)
        ↓
first ceremony remained incomplete                           ROOT_OWNER_CEREMONY_VERIFICATION_FAILED — premises asserted, remote disagreed
        ↓
remote verification caught the false assumption              /pulls/10/merge → 404; main unmoved at 7024203; nothing executed
        ↓
real human/root approval + merge occurred                    APPROVED 02:23:14Z → merge commit 53aa74a 02:23:31Z (0 bypass)
        ↓
post-merge production state becomes city-start baseline       four required checks green ON 53aa74a; tag city-start-baseline-v1 → 53aa74a
```

An interleaved governance thread runs through it and is **not** a detour: `OBS-GOV-001` (a rule satisfiable in
form while degenerate in substance, failing **open**) and `D-006` (a rule that could not be satisfied by the
configuration, failing **closed**) are the same class with opposite failure directions. The dangerous one is
the open one.

---

## 5. §0 ceremony verification, executed this round

Read from GitHub and from the local object store; nothing was taken on trust from a narrative document.

| # | Condition | Required | Observed | Verdict |
|---|---|---|---|---|
| 1 | PR #10 state | `closed` | `closed` | ✅ |
| 2 | PR #10 merged | `true` | `true`, `merged_at 2026-09-22T02:23:31Z`, `merged_by zhiheng-zhang-Mera` | ✅ |
| 3 | PR #10 head | `d9ddb151…` | `d9ddb1511adeb61dee21192a683eb7851d3ca556` | ✅ |
| 4 | PR #10 author | App identity | `codex-boss[bot]` (`"is_bot": true`) | ✅ |
| 5 | Review | `APPROVED` by the Root Owner | `APPROVED` by `zhiheng-zhang-Mera`, `commit_id = d9ddb151…` | ✅ |
| 6 | `origin/main` | `53aa74a…` | `53aa74a7f9628765a92210d16aabcc77ae98bae4` | ✅ |
| 7 | Head is an ancestor of main | exit 0 | `git merge-base --is-ancestor d9ddb151 origin/main` → **0** | ✅ |
| 8 | Genuine merge commit | two parents | `%P = 7024203 d9ddb151`; committer `GitHub <noreply@github.com>` | ✅ |
| 9 | Post-merge CI on the **main** SHA | 4 contexts green | run `35679289373`: `quality`, `unit`, `acceptance`, `package` = completed/success, `head_sha = 53aa74a…` | ✅ |
| 10 | Root Trust invariant | epoch 24, `MATCHES` | epoch 24 (`boss-root-trust-24`) **MATCHES**; 63 files; aggregate `6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457` | ✅ |

The merge endpoint was probed directly and returned **`HTTP/2.0 204 No Content`** — the definitive
"this pull request has been merged" answer, as opposed to the `404` the earlier round correctly recorded.

**Full Root Trust digest (not truncated).** The previously published value was truncated to `6eaf71e9…`. The
complete measured value, re-measured this round against a `dist-electron` **rebuilt from the frozen baseline
tree** (`corepack pnpm run build:electron` at `53aa74a`, exit 0), is:

```
rootSurfaceHash = 6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457
rootSurfaceFiles = 63
trustEpoch = 24 · rootContractVersion = boss-root-trust-24
epochHash = 33beb3028f3e7c334e9ea5441fd5397a232cbbf788eae1d0482c45fe2f66593d
parentEpochHash = 2b1a0336a39aab5e7a2f85b4752672af1c918cc484b6af3b7bbfc0c8a115324e
```

It is identical to the value recorded in `dataset/baseline-metadata.json`, i.e. the promotion changed no
Root Trust Surface file. That equality is a **measured** fact, not an assumption: the surface is recomputed
from the tree on every check.

---

## 6. Negative space — what deliberately did NOT change

Recorded so that silence is not read as an omission.

```
pre-city-baseline-v1 (tag object ec92eb9b…)      NOT moved · NOT recreated · NOT re-annotated · NOT deleted
history                                          NOT rewritten · NOT rebased · NOT squashed · NOT force-pushed
research branches and tags                       NONE deleted (8 research branches + 30 tags = 39 tag ref lines, re-verified on origin)
frozen reports                                   NOT retroactively edited
RQ.md D-1                                        NOT "fixed"
artifacts/                                       NOT tracked (tests/unit/workspace-path-ownership.test.ts is right)
CODEOWNERS / Main-Protection ruleset             NOT changed (ruleset updated_at 2026-09-19T18:08:25, pre-programme)
Root Trust Surface                               NOT modified (63 files, aggregate unchanged, epoch 24 MATCHES)
trust-policy/ · credential-boundary/ · promotion-gate/   NOT touched this round
required checks                                  NOT weakened; the declaration still matches ci.yml
PF020                                            still NOT MERGED BY DESIGN
Phase 1 / migration / Kernelization              NOT started
```

---

## 7. Statements in earlier artefacts that are now superseded — recorded, **not edited**

The programme's own precedent (`RQ.md` D-1, `baseline-metadata.json` D-2) is: a stale statement is recorded
and left in place, and the authoritative statement lives elsewhere. That precedent is applied here.

| Earlier statement | Where | Was it true then? | Status now |
|---|---|---|---|
| `city-start-baseline-v1` — annotated tag — **NOT CREATED** | `evidence/RESEARCH_REF_MANIFEST.md` §1 | **Yes.** The promotion had not landed, and §16 forbade tagging an unpromoted commit. | **SUPERSEDED** by this round. The tag now exists at `53aa74a` (annotated object `2d11e1fb…`). The manifest line is **not** edited. |
| `main = 7024203…` / `unchanged during this round` | `RESEARCH_REF_MANIFEST.md` §2 | Yes | Superseded: `main = 53aa74a…` |
| `PROMOTION_IDENTITY_SEPARATION_PROVEN = false`, `stageC = NOT YET MEASURED` | `dataset/baseline-metadata.json` `governanceState` (captured at `daf20c4`) | Yes | Superseded by `D-009` (Stage C `OBSERVED`). The JSON is a **frozen BEFORE-state capture** and is deliberately not recomputed. |
| `FIX_SHA = NOT FIXED` for the architecture gate (`FINDING-001`) | `evidence/BUG_FINDING_LEDGER.md` | Yes | **Still true.** Phase 0 is authorised to repair it and has not run. |
| "Phase 0 begins on `refactor/capability-city-v1`" | `OWNER_MACHINE_IDENTITY_CEREMONY.md` §"After the ceremony" step 6 | Yes, as written | **Conflicts** with this round's requirement that the Phase 0 branch base resolve to `53aa74a`; the city branch's base is `836b5ed`. Recorded as an ambiguity in `evidence/PHASE0_SPECIFICATION_FINDING.md`. |

The distinction between *superseded* and *wrong* matters: none of the statements above was false when written.

---

## 7b. Correction register — errors found in this round's own earlier artefacts

A later commit in the same programme re-ran the Phase 0 specification sweep and found an error in an artefact
this round produced. It is recorded here rather than quietly repaired, for the same reason `RQ.md` D-1 is
recorded rather than edited.

| # | Artefact | Claim as first published | Status | Disposition |
|---|---|---|---|---|
| **COR-1** | `evidence/PHASE0_SPECIFICATION_FINDING.md`, commits `60408b7` / `5a61d73`, §2 blockquote | *"At `city-start-baseline-v1` / current `main` (`53aa74a`) there is no city plan at all. … The entire Capability City plan … live[s] only on `refactor/capability-city-v1`."* | **WRONG — an overstatement.** Two tracked files in the frozen baseline carry city material: `docs/capability-city-principles.md` (introduced `5c06f7e`, frozen `c265ede`, byte-identical to the research-branch copy) and `PRE_CITY_FREEZE_MANIFEST.json` (introduced `c265ede`). | A `§0 CORRECTION` block was **added** to the finding, the offending sentence was **annotated in place and left standing**, and candidates C1/C8 are now marked **ON BASELINE**. The conclusion is unchanged. |
| **COR-1 cause** | method error, not a typo | The sweep ran `git grep -l -i "observatory" origin/main` (correctly **0 files**) and drew a conclusion about the *whole* city plan from it. `git grep -l "Capability City" HEAD` returns **2 files**. A narrow negative result was generalised into a broad one. | Recorded here because the same failure mode — *a measurement narrower than the claim drawn from it* — is the programme's own subject, and this is an instance of it committed by the programme itself. |

**Effect on this ledger.** None material: this ledger already recorded `docs/capability-city-principles.md`
and `PRE_CITY_FREEZE_MANIFEST.json` among the artefacts of `5c06f7e`/`c265ede` and already recorded that
`836b5ed` (and therefore both files) is in `main`'s ancestry (§3 A2). The error was confined to the companion
finding document.

### COR-1 corroboration — the two on-baseline artefacts are content-verified

The corrected claim was itself checked against a binding rather than asserted:

| Check | Result |
|---|---|
| `git cat-file blob HEAD:docs/capability-city-principles.md` sha256 | `20288eaa479e4aaeaaf962f8e5ba2691785888dc28977738ad592a70511e524e` |
| `PRE_CITY_FREEZE_MANIFEST.json` → `deliverable_hashes["docs/capability-city-principles.md"].sha256` | `20288eaa479e4aaeaaf962f8e5ba2691785888dc28977738ad592a70511e524e` (**equal**) |
| `git diff HEAD origin/refactor/capability-city-v1 -- docs/capability-city-principles.md` | empty (the research-branch copy is the same blob) |
| `git ls-tree -r --name-only HEAD -- research` | **empty — the whole `research/` tree is absent from the baseline** |
| `HEAD:research/capability-city/{RQ.md,RESEARCH_LEDGER.md,dataset/metrics.json}` | all absent from `main` |

**Note for future readers, recorded so it is not mistaken for a provenance defect.** The manifest binds the
**git blob**, which is LF. This Windows checkout has `core.autocrlf=true` and no `.gitattributes`, so a raw
hash of the working-tree file differs — `42e6a62e772b4f4964e86473121bb481dbf22e3490c6c3c9538b7b2c33ac97ae`,
with 336 CRLF sequences — and normalises back to `20288eaa…` exactly. **A raw-hash mismatch on this file is a
line-ending artefact, not a content change.** Verify against the blob (`git cat-file blob`), not the file on
disk.

---

## 8. What this round did **not** do

```
city-start-baseline-v1           CREATED at 53aa74a (annotated) and pushed
Phase 0 implementation           NOT STARTED — the authoritative specification could not be resolved;
                                 see evidence/PHASE0_SPECIFICATION_FINDING.md
Phase 0 branch                   NOT created
Phase 1 / migration              NOT started
Reconciliation of refactor/capability-city-v1 onto the new baseline
                                 NOT performed — it is a branch-level act, not a documentation act, and was
                                 not authorised by this round's brief
self-approval / admin override   NOT attempted
```

---

## 9. Reproduce

```powershell
# 1. ceremony
gh api repos/zhiheng-zhang-Mera/Codex-Boss/pulls/10             # state=closed, merged=true, head=d9ddb151
gh api repos/zhiheng-zhang-Mera/Codex-Boss/pulls/10/reviews     # >=1 APPROVED by zhiheng-zhang-Mera
gh api -i repos/zhiheng-zhang-Mera/Codex-Boss/pulls/10/merge    # HTTP/2.0 204 No Content
git ls-remote origin refs/heads/main                            # 53aa74a7f9628765a92210d16aabcc77ae98bae4
git merge-base --is-ancestor d9ddb1511adeb61dee21192a683eb7851d3ca556 origin/main ; $LASTEXITCODE   # 0

# 2. merge topology
git show -s --format="%H%n%P%n%cn <%ce>" 53aa74a7f9628765a92210d16aabcc77ae98bae4
#   parents: 7024203... d9ddb151...   committer: GitHub <noreply@github.com>

# 3. post-merge CI on the main SHA
gh api 'repos/zhiheng-zhang-Mera/Codex-Boss/commits/53aa74a7f9628765a92210d16aabcc77ae98bae4/check-runs?per_page=100' `
  --jq '.check_runs[] | [.name,.status,.conclusion,.head_sha] | @tsv'
#   acceptance completed success 53aa74a...   package completed success 53aa74a...
#   unit       completed success 53aa74a...   quality completed success 53aa74a...

# 4. root trust (needs dist-electron built from this tree)
corepack pnpm run build:electron
node scripts/acceptance-evolution-bless.cjs --check
#   [bless] root trust surface: 63 files, aggregate 6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457
#   [bless] epoch 24 (boss-root-trust-24) MATCHES the live surface

# 5. both baselines coexist, neither moved
git ls-remote --tags origin | Select-String "baseline"

# 6. the production/instrument separation
git show --stat d9ddb1511adeb61dee21192a683eb7851d3ca556    # 5 files, no instrument
git show --stat cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b    # instrument only
git merge-base --is-ancestor cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b origin/main ; $LASTEXITCODE   # 1
```
