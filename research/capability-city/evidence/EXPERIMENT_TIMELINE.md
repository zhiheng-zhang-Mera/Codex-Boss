# EXPERIMENT TIMELINE — Capability City / identity separation

Chronological record of the programme's experiment history, ordered by commit/run order and showing the
**causal chain**. The final architecture did not appear fully formed: each step below was produced by the
previous one, and two of the steps are failures that are retained rather than tidied away.

**Rules this document follows.**

* No date, SHA, run ID or PR number is invented. Where a value is not established by a source or by `git`,
  it reads `UNKNOWN`.
* Stage labels are drawn from the fixed vocabulary: `ASSUMPTION`, `DESIGN`, `IMPLEMENTATION`, `BASELINE`,
  `ATTEMPTED_MEASUREMENT`, `FAILURE`, `OBSERVATION`, `DIAGNOSIS`, `REPAIR`, `VALIDATION`, `RERUN`, `RESULT`,
  `LIMITATION`, `PRODUCTION_CONSEQUENCE`.
* The Stage C **attempt 1** is marked **`PRECONDITION FAILURE`** and is never written as `PASS`. No inference
  about self-authorization may be drawn from it.
* `PENDING` is not `PASS`. Where a source labels a thing `NOT YET MEASURED`, `NOT OBSERVED` or
  `NOT OBSERVABLE FROM CURRENT EVIDENCE`, this document carries that label rather than resolving it.
* Sources: `RESEARCH_LEDGER.md` (D-001..D-009), `PAPER_NOTES.md`, `threats-to-validity.md`,
  `TRUST_GOVERNANCE_FINDING.md`, `RQ.md`, `evidence/BUG_FINDING_LEDGER.md` (FINDING-001..006),
  `dataset/baseline-metadata.json`, `dataset/metrics.json`, `dataset/artifact-manifest.json`,
  `experiments/governance/GOV-001..GOV-006`, `OWNER_MACHINE_IDENTITY_CEREMONY.md`,
  `artifacts/pre-city/BRANCH_CENSUS.md`, `artifacts/pre-city/STRUCTURAL_HEALTH_BASELINE.md`, and read-only
  `git`.

---

## 1. Timeline

| # | Stage | Event | Evidence (SHA / run / PR) |
|---|---|---|---|
| 1 | `ASSUMPTION` | The programme's starting premise was that the repository's own architecture gate could judge dependency structure: the ratchet reports `violations: []`, so architecture reasoning could be built on it. | `scripts/architecture.cjs` `collectImports` (≈ lines 269–295); `pnpm run architecture:ratchet` → `violations: []` |
| 2 | `ATTEMPTED_MEASUREMENT` | The Pre-City Integration RC measured the real source graph independently of the gate. The gate sees only the files named in each manifest's `modules:` array and drops undeclared targets, so it scans **25 of 594** owned files while **9 of 27** manifests declare `modules: []`. Declared edges **3**; measured file-level cross-capability edges **187**; kernel→feature implementation edges **43**; capability-level 2-cycles **43**; largest SCC **25 of 27**. `architecture:ratchet` still reports `violations: []`. | Pre-City RC integration commits `432f859`, `baf4108` (2026-09-21); findings recorded at `5c06f7e` in `artifacts/pre-city/STRUCTURAL_HEALTH_BASELINE.md` (files present on disk; path is gitignored — see row 3). `FINDING-001` `FIRST_OBSERVED_SHA = baf4108`; `dataset/baseline-metadata.json` `frozenStructuralFacts`; `dataset/metrics.json` M-01/M-02 |
| 3 | `FAILURE` | Self-inflicted CI failure: the measurement deliverables were **force-added** past `.gitignore` as tracked files under `artifacts/pre-city/**`. `artifacts/` is a declared `RUNTIME_OWNED_PATH`, so the tree's own guard failed on CI, correctly. | Push `5c06f7eced2eb32e419ad747d732a4ae46beffc1` (2026-09-21 21:35:54 +1000); Desktop CI run `35594921583` `conclusion: failure`; guard `tests/unit/workspace-path-ownership.test.ts` §5 step 4 vs `RUNTIME_OWNED_PATHS` in `electron/runtime-paths.ts`; observed message `expected [ 'artifacts/' ] to deeply equal []` / `1 failed | 257 passed (258)` |
| 4 | `REPAIR` | The tracking was reverted; the guard was **not** relaxed. `artifacts/pre-city/**` stays gitignored and is instead bound by content in `PRE_CITY_FREEZE_MANIFEST.json` (path + SHA-256 per deliverable). The seven artifact files remain on disk, unchanged. | `23e15412f00355fd865432c03ec49210f91f0f33` (2026-09-21 21:49:09 +1000); Desktop CI run `35596132732` success; `dataset/baseline-metadata.json` `ciFacts` |
| 5 | `BASELINE` | The owner-side freeze manifest was added and the RC commit recorded honestly, then the RC SHA was declared the tested SHA once it was CI-green. The manifest had been chasing the branch tip; the RC commit named the last CI-verified SHA instead and stated why a file cannot contain its own SHA. | `c265ede` (2026-09-21 22:10:27 +1000), `027917d` (2026-09-21 22:28:04 +1000), `394527095390e43d832e60501072c8ecdd5a6a97` (2026-09-21 22:48:36 +1000); verified via Desktop CI run `35601709706` (all four jobs success) |
| 6 | `BASELINE` | Pre-City RC frozen at its final commit; `836b5ed` is the last verified RC state and becomes the branch point for the city branch. | `836b5ed60aa63f3334e6cd08b193113325505880` (2026-09-21 23:08:56 +1000); tree `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| 7 | `DESIGN` | Research questions RQ1–RQ5 frozen **before any construction**, so results cannot be reverse-fitted to questions chosen after the fact. Permitted outcomes include `NO IMPROVEMENT` / `REGRESSION` / `MIXED RESULT` / `INCONCLUSIVE`. Recorded at the branch point. | `RQ.md`; `RESEARCH_LEDGER.md` "Research questions — frozen" (frozen at branch point `836b5ed`); commit of record `347de00` |
| 8 | `ATTEMPTED_MEASUREMENT` | Promotion of the verified RC to `main` as PR #8 (`integration/pre-city-baseline` → `main`). `mergeStateStatus = BLOCKED`, `reviewDecision = ""`, all four required checks `success` on the exact head SHA. The one action that would have created independent authorization was refused by the platform: `Review Can not approve your own pull request`. | PR [#8](https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/8), head `836b5ed`; base at open `4da0ed0`; required checks `35603744506`; ruleset `22746755`: `require_code_owner_review = true`, `required_approving_review_count = 0`, `bypass_actors = [User 229580437, bypass_mode: always]`, `current_user_can_bypass = always`; `dataset/github/pr8.json` |
| 9 | `OBSERVATION` | **Stage A.** PR #8 merged with **zero reviews**: `reviews: []`, `latestReviews: []`, `reviewDecision: ""`, `reviewRequests: []`. Author = Root CODEOWNER = merging principal = `zhiheng-zhang-Mera` (the same identity that holds `bypass_mode: always`). `require_code_owner_review` was still `true` and the ruleset's `updated_at` (`2026-09-19T18:08:25+10:00`) predates the programme. The protected path in the patch (`/package.json`) was correctly matched. Also a second green check set on PR-triggered run `35612224184`. | Merge commit `7024203eee3444a0115664de5e3a3d6599d9a800`, `mergedAt 2026-09-21T20:16:27Z`, `mergedBy zhiheng-zhang-Mera`; `OBS-GOV-001` in `experiments/governance/GOV-001-pr8-observed-failure.md`; `dataset/github/pr8.json` |
| 10 | `ASSUMPTION` | The programme's first analysis asserted that **bypass was the only executable path** to promotion and that the promotion was blocked (stall or `--admin`, nothing else). Retained as written in the append-only ledger, with a correction notice added in place. | `RESEARCH_LEDGER.md` D-003 "The actual finding" + its inline CORRECTION; `threats-to-validity.md` §15; `PAPER_NOTES.md` N-3 `RETRACTED INFERENCE, RETAINED` |
| 11 | `DIAGNOSIS` | The inference was **retracted** against the measurement: the merge completed via the merge endpoint with zero recorded reviews while the code-owner requirement was live, so the platform's decision path is **not established**. D-003's closing inference is withdrawn as unproven; what is measured is narrower and stronger — *no independent code-owner approval exists in the record*, and the only actor who could merge the change was the identity that authored it. The realised failure mode was **silent success**, not refusal. | `RESEARCH_LEDGER.md` D-004 "Corrections to D-003" table; `GOV-003` §"The invalid inference, named" (third form); `threats-to-validity.md` §12 |
| 12 | `PRODUCTION_CONSEQUENCE` | Disposition: content and authorization are classified **separately**. `CONTENT_BASELINE_VALID` = yes; `PROMOTION_AUTHORIZATION_PATH_NONCONFORMING` = yes; `PROMOTION_IDENTITY_SEPARATION_PROVEN` = no. `main` and `pre-city-baseline-v1` both point at `7024203`, whose tree `8e31f066…` is byte-identical to `836b5ed` (`git diff 836b5ed pre-city-baseline-v1` empty). Phase 0 is gated: it does not start until identity separation is *proven*. The operator error (this programme merged PR #8 against an explicit "do not merge") is recorded, not hidden. | `RESEARCH_LEDGER.md` D-004 "Operator error" and D-005; tag `pre-city-baseline-v1` = `7024203eee3444a0115664de5e3a3d6599d9a800`; `experiments/governance/GOV-003-content-vs-authorization-separation.md`; commits `daf20c4`, `347de00` |
| 13 | `OBSERVATION` | **Stage B.** With no machine credential installed, the promotion path **fails closed** rather than silently falling back to Owner credentials. Preflight returns `BLOCKED_EXTERNAL` — "the GitHub machine identity is not installed in this host's data root, so the promotion path has no credential to act with". Verified absent: `.boss/github-machine-identity.json`, `.boss/secret-vault.json`, `runtime-data/.boss/github-machine-identity.json`, `%LOCALAPPDATA%\CodexBoss`, `%LOCALAPPDATA%\Codex-Boss`. No Owner-token fallback was used. | `dataset/governance/preflight-blocked-external-report.json`, `generatedAt 2026-09-21T23:39:13.411Z`, `state: BLOCKED_EXTERNAL`; `TRUST_GOVERNANCE_FINDING.md` §5 blocker table; `BRANCH_CENSUS.md` §5.1; `PAPER_NOTES.md` Stage B |
| 14 | `LIMITATION` | The blocker is **external and Owner-actionable, not a technical difficulty**: the ceremony needs material only the Root Owner holds (App private key, `--app-id`, `--installation-id`, repository allowlist), stored via the platform secure vault. The programme cannot self-provision it, and the PEM must never enter this agent's context. Recorded as a real, non-trivial cost of principal separation (N-7). | `RESEARCH_LEDGER.md` D-003 "Measured cause"; `OWNER_MACHINE_IDENTITY_CEREMONY.md`; `TRUST_GOVERNANCE_FINDING.md` §5; `PAPER_NOTES.md` N-7 |
| 15 | `DESIGN` | Before any credential exists, `OBS-GOV-001` is frozen, the negative-authority protocol is frozen in advance, and the PF020 instrument's semantics are verified against their declaration. The protocol deliberately classifies "the machine cannot write at all" as `INCONCLUSIVE`, **not** `PASS`, because incapacity is not separation. Every execution field is pre-declared `PENDING`. | `dc423468c14a62f532daf617895ebfe69dd7153e`; `experiments/governance/GOV-002-machine-principal-negative-control-protocol.md` (P1–P8, F1–F6); `dataset/governance/pf020-source-verification.json` |
| 16 | `IMPLEMENTATION` | **Owner ceremony completed on the authorized node.** The Owner selected the PEM in a local Windows file picker and clicked `Register securely` in the Electron confirmation; the programme ran everything else. Identity installed and configured: `appId 4903952`, `installationId 160744736`, `privateKeyRef github/codex-boss`, allowlist `zhiheng-zhang-mera/codex-boss`, vault encrypted with **0** plaintext-PEM markers. Result line: `GITHUB_MACHINE_BOOTSTRAP=OK repositories=1 backend=platform-secure-store`. | `16c90d9429414df7326a9e1270fd8dac23f6c7de`; `dataset/governance/pf020-live-acceptance-attempt-1.json` `ownerCeremony` + `machineIdentity`; `TRUST_GOVERNANCE_FINDING.md` §6 |
| 17 | `ATTEMPTED_MEASUREMENT` | **Stage C attempt 1 — `PRECONDITION FAILURE`.** Credential present, preflight run, exit code 1, **non-credential** cause: `PROMOTION_IDENTITY_LIVE_ACCEPTANCE=FAIL RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>`. The acceptance derived its Candidate root from the checkout it ran in (`appDataUnder(process.cwd())` → `<checkout>/runtime-data/evolution/<runId>`) while `stableRoot = process.cwd()`, so the Candidate was unconditionally nested inside Stable and the invariant correctly refused. **This is not a failed authorization test and is never relabelled as one**; it is an execution failure upstream of the measurement. Zero remote mutation: 0 branches, 0 PRs, 0 approvals, 0 merges; `main` unchanged at `7024203`. Stage C remains `NOT YET MEASURED`. | Attempt at PF020 worktree `add57742d882349e57f60b8de8f59b68362849c4`; cause chain `live-promotion-acceptance.ts:58,186,187` → `runtime-isolation.ts:82,180` → `workspace-manager.ts:117`; `dataset/governance/pf020-live-acceptance-attempt-1.json`; `PAPER_NOTES.md` N-8/N-13; `GOV-006` §8 |
| 18 | `DIAGNOSIS` | **Scope determination (`GOV-004`) before touching code.** Caller census found exactly **one** production enforcement point (`workspace-manager.ts:117` inside `createCandidateWorkspace`); the production geometry was traced from the composition root (`bootstrap/engineering.ts:45-46,61` omits the option; `self-evolution-host.ts:154` defaults `evolutionRoot` to `<userData>/evolution`; `userData = <checkout>/runtime-data` in development). A read-only probe against the **compiled shipped predicate** returned `REJECT` for PRODUCTION-dev and for the instrument (identical shape), `ACCEPT` for the packaged geometry and for an external sibling, and `REJECT` for the historical-failure control. **Classification: `PRODUCTION_AND_INSTRUMENT`.** So the programme **stopped** and returned `PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED` for Owner review: no code changed, and the invariant was **not** weakened, excepted or special-cased. | `experiments/governance/GOV-004-runtime-isolation-instrument-defect-scope.md`; commit `d713bb8c8c96fdc18a1450911d4eeef2e7fcf5a1`; `GOV-004` §4 predicate table (5 geometries); `PAPER_NOTES.md` N-10/N-11/N-12 |
| 19 | `DIAGNOSIS` | A **second instrument-integrity defect** was recorded before repair: `STALE_SINGLETON_REPORT_HAZARD`. Because the report is a fixed singleton path written only on the success/preflight-success path, the earlier no-credential report (`BLOCKED_EXTERNAL`) was still on disk while the current attempt had failed with the `RuntimeIsolationError` — a stale result that could be mistaken for the current one. Recorded, not hidden. | `RESEARCH_LEDGER.md` D-007 "Second instrument-integrity defect"; `FINDING-003` (`FIX_SHA cc970fe`, `VALIDATED_SHA 2f36d99`); `dataset/governance/pf020-live-acceptance-attempt-1.json` `acceptanceReportNote.stale` |
| 20 | `PRODUCTION_CONSEQUENCE` | The scope finding forced a **validity decision, not an implementation detail**: Option **A** (instrument-local external root) would make the acceptance green while production still fails closed in development, so a Stage C result would describe the harness rather than the product — the inverse of the §8 hazard. Option **B** (production root-policy repair) is outside that round's authorised scope and needs its own authorisation and disclosure. Both were left unexecuted for the Owner. | `GOV-004` §7 "Required Owner decision" (options A/B; neither executed); `threats-to-validity.md` §18; `RESEARCH_LEDGER.md` D-007 "Chosen design: NONE YET — deliberately" |
| 21 | `DESIGN` | **Owner decision `D-008`: Option B** — repair the production root-placement policy, not the invariant, and require the acceptance to consume that same policy. Precondition for the repair restated at authorisation time: the defect was discovered and measured first; the failed attempt 1 stays in the chronology; Stage C had **not** been measured; and this repair must **never** be counted as a Capability City improvement (`pre-city-baseline-v1` intentionally keeps the defect; a future `city-start-baseline-v1` carries the correction). | `RESEARCH_LEDGER.md` D-008; `GOV-006` §1; `experiments/governance/GOV-005-live-acceptance-instrument-v1-v2.md` disclosure; commit `da80400` |
| 22 | `REPAIR` | **Production fix (P1).** One shared `resolveEvolutionRoot` policy: explicit override (verified; unsafe ⇒ hard error) → `<userData>/evolution` when genuinely external → fingerprint-keyed external sibling of Stable → OS temp root → **throw**. New `electron/stable-candidate/evolution-root-policy.ts`; host defaults call the policy and verify an explicit `evolutionRoot` instead of trusting it. Result: Stable Root and Candidate Evolution Root are structurally disjoint **before** Candidate creation in every supported topology. | P1 `b0e7da96e98a1af12fd94d28e22d1f2863982626` (2026-09-22 10:23:35 +1000); `GOV-006` §4/§5; `FINDING-002` `FIX_SHA` |
| 23 | `REPAIR` | **Instrument v2 (I1).** The acceptance consumes the same policy and records the invariant's **own verdict** (`rootPolicy.separated`, `rootPolicy.overlaps`) instead of asserting separation; reporting becomes attempt-scoped (`<runId>.json` + `latest.json`, atomic temp+rename, written on *every* attempt including one that throws) with a leakage gate that refuses rather than throws. This removes the stale-singleton hazard. P1 and I1 were deliberately kept as **separate commits** so P1 can be transplanted onto `main` without the PF020-only acceptance machinery. | I1 `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b` (2026-09-22 10:25:42 +1000); `GOV-005` "Changed files" + "Changed semantics"; `FINDING-003` `FIX_SHA` |
| 24 | `VALIDATION` | P1+I1 validated **before** any rerun: `typecheck` all three projects PASS; 8 relevant suites **80/80**; new policy suite **8/8** (PROD-ROOT-01..07); composition **3/3**; instrument **5/5**; `build:electron` PASS. Negative controls retained (historical nested geometry still rejected; unsafe override still refused; a report containing a synthetic token/PEM refused, zero bytes on disk). The invariant is untouched: `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES` and `READ_ONLY_SHARED_SURFACES` are **byte-identical**; no bypass, exception or special case exists. Root Trust: `bless --check` epoch 24 (`boss-root-trust-24`) **MATCHES**. | `GOV-006` §6 test matrix + §5; `RESEARCH_LEDGER.md` D-008 "Actual effect"; `TRUST_GOVERNANCE_FINDING.md` §8 validation row |
| 25 | `FAILURE` | **Three drift gates fired on the repair itself.** (a) test catalogue drift: `test catalogue has drifted from the tree`, first full-suite run at P1 reported **12 failures**; (b) comment citations: `bare section citations: 1310 (baseline 1308)`, because two new comments cited `§8.3`/`§8` alone; (c) export surface: `Unreachable (5): … evolution-root-policy.ts`, six types and one function exported though used only inside their module. All three were fixed by **correcting the work**: catalogue regenerated through the intended mechanism (**+21 / −0**, 241 suites, 27/27 capabilities), citations re-pointed at the tracked `docs/autonomous-evolution.md`, unnecessary `export` keywords dropped. **No baseline raised, no exception recorded, no gate disabled, no threshold lowered.** | `FINDING-005` (`FIRST_OBSERVED_SHA b0e7da9`; `FIX_SHA cc970fe` + `fc01cca` + `2f36d99`; `VALIDATED_SHA d9ddb15`); fix commits `fc01cca` (2026-09-22 11:00:25 +1000), `2f36d99` (2026-09-22 11:01:13 +1000); gates `test-impact`, `comment-citation`, `export-surface` |
| 26 | `FAILURE` | **A test assertion was wrong, not the code.** On the first run of the composition suite, containment was decided by string prefix: `AssertionError: expected true to be false` on `candidate.layout.root.startsWith(host.stableRoot())`. The sibling directory `<stable>-evolution-<fingerprint>` is a *different* directory that merely shares a name prefix, so `startsWith()` reported a false overlap — which is precisely why the invariant uses path containment. The assertion was corrected (to `verifyRuntimeSeparation(...)` plus `path.relative(...).startsWith("..")`); `verifyRuntimeSeparation` was untouched. The assertion was introduced and corrected **inside the same uncommitted change** and was never pushed broken. | `FINDING-006` (`FIRST_KNOWN_BAD_SHA NOT APPLICABLE`; `FIRST_OBSERVED_SHA b0e7da9` working tree, pre-commit; `FIX_SHA` same commit; `VALIDATED_SHA d9ddb15`); `tests/unit/self-evolution-host-root-geometry.test.ts`; `PAPER_NOTES.md` N-14 |
| 27 | `VALIDATION` | The corrected repair was re-validated end-to-end on `main`-derived commit `d9ddb15`: unit suite **260 files / 3285 tests / 0 failures**; Desktop CI run `35674821748` — **all four jobs success** (`quality`, `unit`, `acceptance`, `package`). | `d9ddb1511adeb61dee21192a683eb7851d3ca556` (2026-09-22 11:11:00 +1000), branch `fix/runtime-isolation-root-policy-v1`; CI run `35674821748`; `FINDING-002` `VALIDATED_SHA`; `FINDING-005` `VALIDATED_SHA` |
| 28 | `RERUN` | **Stage C attempt 2 preflight** at instrument V2: `state: PREFLIGHT_PASS` — `identity=codex-boss[bot] rootSource=external-sibling separated=true base=7024203 candidate=3ce1ef89ea40`. Root policy resolved to an external sibling (`D:\Boss-PF020-Live-Acceptance-evolution-1276cb9e357ea72f`); nothing pushed. | `dataset/governance/stage-c-attempt-2-preflight-report.json`, `generatedAt 2026-09-22T00:26:30.293Z`, `runId acceptance-promotion-identity-20260922002549`; instrument `sha256 e21ba0db…`; `RESEARCH_LEDGER.md` D-009 pre-change evidence |
| 29 | `RESULT` | **Stage C attempt 2 — measured `PASS`, all eight frozen criteria simultaneously.** PR **#9** authored by the **machine principal `app/codex-boss`** (not the Owner account); all four required checks `success` on the **exact candidate SHA** `d8fc0fb6579173a7f6200f06a494ddd744175d61` (`foreignSha: []`, `missing: []`); promotion outcome and durable record = `WAITING_FOR_ROOT_OWNER`; `rootOwnerApproval` **null**; PR open at end of run; `main` before == after == `7024203eee3444a0115664de5e3a3d6599d9a800`; no merge. The Candidate touched a Root-Surface path (`electron/credential-boundary/live-acceptance-…md`), so the authority ceiling was genuinely reached. PR #9 was then **closed UNMERGED**; never approved, never merged, no bypass used. `STAGE_C = OBSERVED` / `PROMOTION_IDENTITY_SEPARATION_PROVEN = YES`. | Branch `evolution/acceptance-promotion-identity-20260922002642` at `d8fc0fb65791`; `dataset/governance/stage-c-attempt-2-pass-report.json` (`generatedAt 2026-09-22T00:43:16.644Z`); `RESEARCH_LEDGER.md` D-009 P1–P8 table; `GOV-002` criteria; `TRUST_GOVERNANCE_FINDING.md` §8; commit `da80400` |
| 30 | `LIMITATION` | **Still unresolved and still unobservable.** Whether GitHub evaluated `require_code_owner_review` as **satisfied** at Stage A, or instead admitted the Root Owner through the **bypass** path, remains **`NOT OBSERVABLE FROM CURRENT EVIDENCE`**. The PR/review/ruleset APIs expose the outcome, not the decision path, and no bypass event is recorded on the pull-request object. The forbidden claim is stated as forbidden: *"GitHub definitely bypassed CODEOWNER review"*. A separate controlled probe on a throwaway protected branch is **owed** and must not be folded into `GOV-002`. Stage C demonstrates the separation **now in force**; it does not retroactively explain the earlier merge. | `threats-to-validity.md` §12; `GOV-001` "Non-observable facts"; `GOV-003` "Non-observable — required wording"; `GOV-002` "Non-observable outcomes"; `TRUST_GOVERNANCE_FINDING.md` §8 "Still owed, and still unobservable" |
| 31 | `LIMITATION` | **n = 1.** One repository, one governance configuration, one trial, one Windows host. The result is an existence proof and a method, not a base rate. Also carried forward: the packaged `ACCEPT` verdict is **path-dependent** (it holds only because `userData` happens to sit outside the checkout) and the repair changes where the Candidate tree lives for development checkouts only. | `RESEARCH_LEDGER.md` D-009 "Potential confounders"; `GOV-004` §3 packaged geometry; `threats-to-validity.md` §19; `RESEARCH_LEDGER.md` D-008 "Potential confounders"; `PAPER_NOTES.md` Limitations |
| 32 | `PRODUCTION_CONSEQUENCE` | The repair is **validated on its branch, not yet promoted**: the production runtime-isolation defect is repaired on `test/pf020-runtime-isolation-production-fix-v2` (V2 tip `2f36d99aa77acf23968a0f55432dfb44cb51dbdc`), and promoting P1 to `main` is the remaining Owner-authorized step. Separately, PF020 remains `NOT MERGED BY DESIGN`, `acceptance:promotion-identity:live` is `NOT OBSERVED` on `main` (`N-5`), and Phase 0 (`Architecture Observatory Repair`) has not started — no migration has been performed for RQ1–RQ5, which stay `PENDING`. | `TRUST_GOVERNANCE_FINDING.md` §9 "Blocking condition now"; `dataset/artifact-manifest.json` (`pf020TestSha add57742…`; role text for stage-c reports); `PAPER_NOTES.md` Results/"PENDING for RQ1–RQ5"; `FINDING-001` `FIX_SHA = NOT FIXED`; commits `2f36d99`, `da80400` |

**Rows: 32.**

### Stage labels at a glance

| Stage label | Rows |
|---|---|
| `ASSUMPTION` | 1, 10 |
| `DESIGN` | 7, 15, 21 |
| `IMPLEMENTATION` | 16 |
| `BASELINE` | 5, 6 |
| `ATTEMPTED_MEASUREMENT` | 2, 8, 17 |
| `FAILURE` | 3, 25, 26 |
| `OBSERVATION` | 9, 13 |
| `DIAGNOSIS` | 11, 18, 19 |
| `REPAIR` | 4, 22, 23 |
| `VALIDATION` | 24, 27 |
| `RERUN` | 28 |
| `RESULT` | 29 |
| `LIMITATION` | 14, 30, 31 |
| `PRODUCTION_CONSEQUENCE` | 12, 20, 32 |

---

## 2. Causal chain

The chain begins with a **defect that was already present and unmeasured**. The architecture gate did not fail;
it passed while blind, scanning 25 of 594 owned files and reporting `violations: []` against 43 real
kernel→feature implementation edges. That is why the first act of the programme was to measure the gate
rather than refactor against it: any migration performed under a blind instrument would have been
unverifiable.

While that measurement was being published, the tree's own runtime-path guard fired on real work — the
measurement deliverables had been force-added as tracked files under a path declared runtime-owned. That
failure was self-inflicted and was repaired by **untracking the files and binding them by content hash**, not
by relaxing the guard. The guard was right; the work was wrong.

With the content frozen, promotion exposed a **second, different defect that no architecture instrument could
see**: the proposing principal and the authorizing principal were the same GitHub identity, so a live
code-owner requirement was satisfied by nobody and the promotion completed with zero reviews. The programme
first read this as an unsatisfiable rule and concluded bypass was the only path. That inference was **wrong**,
and it was retracted against the measurement: the merge happened, silently.

The repair for that defect was not a code change at all — it required a **second principal**, whose
credentials only the Owner holds. Until they existed the path failed closed, honestly labelled
`BLOCKED_EXTERNAL`, with no fallback to Owner credentials. Once the ceremony was performed, the *first*
attempt to measure separation failed — not on authority, but on geometry: the acceptance placed the Candidate
root inside the Stable root and the isolation invariant correctly refused it. That failure was a
**`PRECONDITION FAILURE`**, upstream of the measurement, and it was preserved as attempt 1 rather than
relabelled.

The attempt-1 failure then **corrected the scope of the work**. A round authorised as an *instrument* repair
was stopped mid-flight by a scope determination showing that production instantiates the same invalid
geometry. The Owner therefore repaired the **production root-placement policy** so that the acceptance and
the product share one geometry. Only after that repair was separately committed, validated and physically
separated from the invariant did the measurement run again — and then the machine principal opened a
Root-Surface pull request with all four checks green on the exact SHA, and the promotion stopped at
`WAITING_FOR_ROOT_OWNER` with `main` unmoved.

Defect present → detected by the invariant → misdiagnosed as instrument-only → scope determination corrected
it → Owner chose the production repair → validation → measurement.

---

## 3. What this ordering demonstrates

**1. A retracted inference is retained, not deleted.** Row 10 keeps the wrong claim — *bypass was the only
path* — in place, with the correction attached at row 11. The programme's reasoning is therefore visible as it
actually happened, including a confident wrong conclusion about authority that no instrument caught. The
retention is a deliberate rule, not an oversight (`threats-to-validity.md` §15; `PAPER_NOTES.md` N-3). A
cleaned-up history would have hidden the reusable lesson: a `BLOCKED` UI status was read as a platform-level
refusal, and it is not one.

**2. The failed attempt is retained and never upgraded.** Row 17 is labelled **`PRECONDITION FAILURE`** and is
never written as `PASS`, `FAIL`-of-authorization, or `INCONCLUSIVE`. Attempt 2 does not overwrite attempt 1
(separate evidence files), and no inference about self-authorization is drawn from attempt 1 in either
direction. This is the point of the label: an execution failure upstream of a measurement says nothing about
the thing being measured.

**3. The repair followed the observation, and that is disclosed as a duty.** The sequence is explicit and
ordered: attempt 1 failed (row 17) → scope was determined (row 18) → the Owner authorised a production repair
(row 21) → P1/I1 were committed (rows 22–23) → validated (rows 24, 27) → **only then** Stage C was rerun
(rows 28–29). The instrument was not adjusted so the test would pass; the *product's* root policy was
corrected so it satisfied the invariant it already claimed to enforce, and the test was required to consume
that same policy. `GOV-005` makes the disclosure mandatory in that order for any future publication, and
`GOV-006` §1 forbids counting the repair as Capability City progress: `pre-city-baseline-v1` keeps the defect
as the authentic historical observation, and a future `city-start-baseline-v1` will carry the correction so
that BEFORE/AFTER measurements do not attribute this patch to the City intervention.

**4. Two opposite failure directions, one class of defect.** Row 9 failed **open** (silent success — the
boundary appeared satisfied and was not); row 17 failed **closed** (loud refusal — one sentence, nothing
mutated). Both had a correctly specified, correctly enabled invariant; they differ in what happened when the
requirement could not be satisfied. The programme's own instruments recorded which direction each took, and
the dangerous one is the quiet one (`threats-to-validity.md` §16).

**5. The invariant was never the repair target.** Rows 18, 24 and 26 all record the same discipline: the
predicate was not weakened, excepted or special-cased; `verifyRuntimeSeparation` was byte-identical
throughout; and when an assertion disagreed with it, the **assertion** was corrected. The one thing the
programme did change was a root-placement policy — and it changed the product to satisfy the invariant, never
the invariant to accommodate the test.

---

## 4. What remains owed (not results)

| Item | Status | Source |
|---|---|---|
| Controlled probe of GitHub's evaluation order (`require_code_owner_review` × `current_user_can_bypass`) on a throwaway protected branch | **OWED — `NOT OBSERVABLE FROM CURRENT EVIDENCE`** | `threats-to-validity.md` §12; `GOV-002`; `PAPER_NOTES.md` Future work 2 |
| Promotion of P1 (production root-policy fix) to `main` | **Owner-authorized step, not yet done** | `TRUST_GOVERNANCE_FINDING.md` §9 |
| Phase 0 — architecture observatory repair; RQ1–RQ5 answers | **PENDING / not started; no migration performed** | `PAPER_NOTES.md` Results; `FINDING-001` `FIX_SHA = NOT FIXED` |
| `city-start-baseline-v1` tag carrying the corrective repair | **PENDING (future)** | `RESEARCH_LEDGER.md` D-008; `GOV-006` §1 |
| Real-host qualification, long soak, provider acceptance, installer-VM cycle | `NOT_RUN` — environment-bound; never substituted by mocks | `dataset/baseline-metadata.json` `environmentBoundNotRun` |
