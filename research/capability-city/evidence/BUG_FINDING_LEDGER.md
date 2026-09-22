# BUG FINDING LEDGER — Capability City

Architecturally meaningful defects and findings, each with the provenance the mission schema requires.
Where a field cannot be established from evidence, it says `UNKNOWN` / `NOT OBSERVED` / `NOT APPLICABLE`
rather than being inferred.

**Path note.** The mission's preferred location was `artifacts/research/`. This repository declares
`artifacts/` as a `RUNTIME_OWNED_PATH` that must never own a tracked file
(`tests/unit/workspace-path-ownership.test.ts`), so these ledgers live under the tracked
`research/capability-city/evidence/` instead. Final paths are recorded in `RESEARCH_REF_MANIFEST.md`.

Machine-readable companion: `bug-finding-ledger.json`.

---

## FINDING-001 — The architecture gate could not observe real source dependencies

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-001 |
| `TITLE` | The architecture ratchet scanned declared modules only, so it was blind to most real dependency edges |
| `DATE_DISCOVERED` | Pre-City Integration RC round (measured), re-verified during the identity-separation round |
| `FIRST_KNOWN_BAD_SHA` | `UNKNOWN` — the limitation is present in `scripts/architecture.cjs` from its introduction; the introducing commit was not bisected |
| `FIRST_OBSERVED_SHA` | `baf4108` (pre-city measurement) |
| `FIX_SHA` | **NOT FIXED** — deliberately out of scope for every round so far. Phase 0 is authorised to repair it. |
| `VALIDATED_SHA` | `NOT APPLICABLE` (no fix yet) |
| `AFFECTED_SUBSYSTEM` | `scripts/architecture.cjs` `collectImports`; the `architecture:ratchet` gate; all architecture reasoning built on it |
| `FAILURE_CLASS` | `HIDDEN_COUPLING` / measurement blindness (fails **open**) |
| `OBSERVED_SYMPTOM` | `pnpm run architecture:ratchet` reports `violations: []` while **43** kernel→feature implementation edges exist |
| `EXPECTED_BEHAVIOR` | A gate that claims to enforce topology should see the real dependency graph |
| `ROOT_CAUSE` | `collectImports` iterates each manifest's `modules:` array and drops any edge whose target is not a declared module. **9 of 27** manifests declare `modules: []`; the other 18 declare only their boot factory. It therefore scans **25 of 594** owned files. |
| `INVALID_ASSUMPTION` | That the manifest declares implementation files. It declares boot contract entries. |
| `DETECTION_MECHANISM` | Independent file-level import scan; counting `modules: []` in `config/capabilities/*.yaml`; reading `collectImports` directly |
| `FAILED_TEST_OR_GATE` | The gate did not fail. It passed while blind — that is the finding. |
| `REPRODUCTION_METHOD` | `pnpm run architecture:ratchet` → `violations: []`; then grep `electron/bootstrap/persistence.ts:24` which imports `tenx`'s `../runtime-intelligence/live-capture` |
| `PRODUCTION_IMPACT` | Architectural decisions were made against a graph containing 3 of 187 measured edges |
| `TRUST_IMPACT` | None directly — but a green architecture gate was cited in acceptance evidence |
| `SAFETY_IMPACT` | Kernel→feature coupling undetected at a claimed boundary |
| `FIX_DESCRIPTION` | Phase 0: scan the real source tree; stop dropping undeclared targets; add falsification self-tests |
| `WHY_POLICY_WAS_NOT_WEAKENED` | The gate was left exactly as-is. It is retained deliberately as the **comparison arm** for RQ5, because the old-vs-new detector comparison is only answerable if the old detector still exists. |
| `BEFORE_RESULT` | 25/594 files scanned; 3 declared edges; 0 violations reported |
| `AFTER_RESULT` | `NOT YET MEASURED` (Phase 0) |
| `RELATED_TESTS` | `tests/unit/platform/*` (test-impact); Phase 0 will add the observatory's own falsification tests |
| `CI_RUNS` | `NOT OBSERVED` |
| `RELATED_PRS` | `NOT APPLICABLE` |
| `RELATED_BRANCHES` | `refactor/capability-city-v1` |
| `RELATED_TAGS` | `pre-city-baseline-v1` (contains the limitation) |
| `RELATED_ARTIFACTS` | `dataset/baseline-metadata.json`, `dataset/metrics.json` (M-01..M-05), `experiments/governance/GOV-004…` |
| `LIMITATIONS` | The 187-edge count is from an independent scan, not from a shipped instrument; alias/computed-path handling was not exhaustively validated |
| `PAPER_USE` | **motivation**, **threat-to-validity**, **experiment** (RQ5 detector comparison) |

---

## FINDING-002 — Production placed the Candidate runtime tree inside Stable

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-002 |
| `TITLE` | `evolutionRoot` defaulted to `<userData>/evolution`, which is inside the Stable root in development |
| `DATE_DISCOVERED` | Identity-separation round, Stage C attempt 1 |
| `FIRST_KNOWN_BAD_SHA` | `UNKNOWN` — introduced with the original `<userData>/evolution` default; the introducing commit was not bisected. The comment at `self-evolution-host.ts:155-157` records a **prior instance of the same class** (governance under `evolutionRoot`), which was fixed while this case remained. |
| `FIRST_OBSERVED_SHA` | `add57742d882349e57f60b8de8f59b68362849c4` (Stage C attempt 1) |
| `FIX_SHA` | `b0e7da96e98a1af12fd94d28e22d1f2863982626` (P1) · main-derived `d9ddb1511adeb61dee21192a683eb7851d3ca556` |
| `VALIDATED_SHA` | `d9ddb15` — Desktop CI run **35674821748**, all four jobs success |
| `AFFECTED_SUBSYSTEM` | `electron/self-evolution/self-evolution-host.ts`; Candidate/Stable runtime isolation; production Self-Evolution in development topology |
| `FAILURE_CLASS` | Wrong root-placement policy (the invariant itself fails **closed**) |
| `OBSERVED_SYMPTOM` | `RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>` |
| `EXPECTED_BEHAVIOR` | The Candidate evolution root is structurally disjoint from the Stable root before Candidate creation |
| `ROOT_CAUSE` | `stableRoot = detectRepositoryRoot(appPath)` = the checkout; `userData` = `<installRoot>/runtime-data` = inside the checkout in development; `evolutionRoot = <userData>/evolution`. Nested. |
| `INVALID_ASSUMPTION` | That `<userData>` is outside Stable. True in packaged installs only because `%LOCALAPPDATA%` happens to sit elsewhere — a property of the OS layout, not of the module. |
| `DETECTION_MECHANISM` | `verifyRuntimeSeparation` (`runtime-isolation.ts:174-182`), which refused correctly. **The invariant detected the defect; the policy created it.** |
| `FAILED_TEST_OR_GATE` | Stage C attempt 1 preflight — a failing **precondition**, not a failed authorization test |
| `REPRODUCTION_METHOD` | `resolveEvolutionRoot({stableRoot: <checkout>, userData: <checkout>/runtime-data})` under the old default, or `evolutionLayout(<checkout>/runtime-data/evolution, runId, sha)` → `verifyRuntimeSeparation(...).separated === false` |
| `PRODUCTION_IMPACT` | Production Self-Evolution could not create a Candidate at all in development topology; packaged installs were unaffected |
| `TRUST_IMPACT` | None — no rule was weakened; the refusal was correct |
| `SAFETY_IMPACT` | The isolation invariant held. The failure was fail-closed. |
| `FIX_DESCRIPTION` | One shared `resolveEvolutionRoot` policy: explicit override (verified, unsafe ⇒ hard error) → `<userData>/evolution` when genuinely external → fingerprint-keyed sibling of Stable → OS temp root → **throw**. Accepted and honoured by both production and the acceptance. |
| `WHY_POLICY_WAS_NOT_WEAKENED` | `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES` and `READ_ONLY_SHARED_SURFACES` are **byte-identical**. No `allowNestedCandidateForDev`, no `skipIsolationCheck`, no test-only bypass, no special case. The original refusal is preserved as proof the invariant worked. |
| `BEFORE_RESULT` | candidate root inside stable root → `REJECT` |
| `AFTER_RESULT` | `rootSource=external-sibling`, `separated=true`, `overlaps=[]`; a real `createCandidateWorkspace` succeeds in development topology |
| `RELATED_TESTS` | `tests/unit/evolution-root-policy.test.ts` (PROD-ROOT-01..07 + historical-shape negative control), `tests/unit/self-evolution-host-root-geometry.test.ts` |
| `CI_RUNS` | `35674821748` (all four success) |
| `RELATED_PRS` | `#9` is **Stage C research evidence**, not the promotion; the promotion PR is separate |
| `RELATED_BRANCHES` | `fix/runtime-isolation-root-policy-v1`, `test/pf020-runtime-isolation-production-fix-v2`, `feat/pf020-identity-convergence` |
| `RELATED_TAGS` | `pre-city-baseline-v1` **intentionally retains this defect** as the historical control |
| `RELATED_ARTIFACTS` | `dataset/governance/pf020-live-acceptance-attempt-1.json`, `experiments/governance/GOV-004…`, `GOV-006…` |
| `LIMITATIONS` | `n = 1` topology per case; packaged correctness remains path-dependent on where the OS puts application data |
| `PAPER_USE` | **case-study**, **design-rationale**, **architecture**, **comparison**, **failure-analysis**, **limitation** |

---

## FINDING-003 — The acceptance report was a stale singleton

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-003 (`STALE_SINGLETON_REPORT_HAZARD`) |
| `TITLE` | A failed attempt could leave the previous attempt's report on disk, and be read as its result |
| `DATE_DISCOVERED` | Identity-separation round, while diagnosing Stage C attempt 1 |
| `FIRST_KNOWN_BAD_SHA` | `UNKNOWN` — present from the instrument's introduction (the report path and its single success-path write) |
| `FIRST_OBSERVED_SHA` | `add57742d882349e57f60b8de8f59b68362849c4` |
| `FIX_SHA` | `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b` (I1) |
| `VALIDATED_SHA` | `2f36d99aa77acf23968a0f55432dfb44cb51dbdc` (instrument V2 tip) |
| `AFFECTED_SUBSYSTEM` | `electron/self-evolution/live-promotion-acceptance.ts`; acceptance evidence integrity |
| `FAILURE_CLASS` | Evidence-integrity defect (attribution loss), **not** an authority defect |
| `OBSERVED_SYMPTOM` | `promotion-identity-live-acceptance.json` read `BLOCKED_EXTERNAL` (an older attempt) while the current attempt had failed with `RuntimeIsolationError` |
| `EXPECTED_BEHAVIOR` | Every attempt is uniquely attributable; no old result can masquerade as a newer one |
| `ROOT_CAUSE` | One fixed report path, written only on the success/preflight-success path. An exception before `writeReport` left the previous attempt's file untouched. |
| `INVALID_ASSUMPTION` | That a single latest-report file is sufficient evidence. Without attempt identity it cannot distinguish "this run" from "last run". |
| `DETECTION_MECHANISM` | Comparing the on-disk report against the current run's own stdout |
| `FAILED_TEST_OR_GATE` | None at the time; a regression test now exists |
| `REPRODUCTION_METHOD` | Write attempt 1 (`BLOCKED_EXTERNAL`), then throw before `writeReport` on attempt 2 → the file still describes attempt 1 |
| `PRODUCTION_IMPACT` | None on product behaviour; it could have corrupted the **research record** |
| `TRUST_IMPACT` | Could have made a failed run look like a different run's outcome — a provenance risk in trust-adjacent evidence |
| `SAFETY_IMPACT` | None |
| `FIX_DESCRIPTION` | Reports are attempt-scoped: `<runId>.json` written atomically (temp + rename) plus `latest.json` rewritten on **every** attempt, including one that throws immediately. Each report carries `runId`, `attemptStartedAt`, `instrumentFile`, instrument `sha256`, `preflightOnly`, `commitSha`, repository and base branch. A report failing its leakage gate is **refused** (nothing written). A write failure is a value, never a throw. |
| `WHY_POLICY_WAS_NOT_WEAKENED` | The leakage gate was not relaxed; it was made stricter and non-throwing. No evidence requirement was removed. |
| `BEFORE_RESULT` | 1 fixed path; stale content survivable |
| `AFTER_RESULT` | attempt-scoped + `latest.json`; regression test proves attempt 2 is reported, not attempt 1 |
| `RELATED_TESTS` | `tests/unit/live-acceptance-reporting.test.ts` (5 tests) |
| `CI_RUNS` | `NOT OBSERVED` for this specific fix (the instrument is not exercised by Desktop CI) |
| `RELATED_PRS` | `#9` (Stage C) |
| `RELATED_BRANCHES` | `test/pf020-runtime-isolation-production-fix-v2` |
| `RELATED_TAGS` | none |
| `RELATED_ARTIFACTS` | `dataset/governance/pf020-live-acceptance-attempt-1.json`, `stage-c-attempt-2-*.json`, `GOV-005…` |
| `LIMITATIONS` | The instrument is not run by CI, so its correctness rests on unit tests and manual runs |
| `PAPER_USE` | **case-study**, **threat-to-validity**, **experiment** (evidence integrity) |

---

## FINDING-004 — A CODEOWNER requirement was satisfiable in form while degenerate in substance

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-004 (`OBS-GOV-001`) |
| `TITLE` | Promotion actor and Root CODEOWNER were one principal, so an independent authorization was impossible |
| `DATE_DISCOVERED` | Pre-City promotion round |
| `FIRST_KNOWN_BAD_SHA` | `NOT APPLICABLE` — a platform configuration, not a code state |
| `FIRST_OBSERVED_SHA` | PR **#8**, head `836b5ed60aa63f3334e6cd08b193113325505880`, merge `7024203eee3444a0115664de5e3a3d6599d9a800` |
| `FIX_SHA` | `NOT APPLICABLE` — resolved by **configuring a separate machine principal**, not by a code change |
| `VALIDATED_SHA` | `cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b` (instrument V2, which performed the Stage C measurement) |
| `AFFECTED_SUBSYSTEM` | GitHub governance: `Main-Protection` ruleset `22746755` + `.github/CODEOWNERS`; the promotion path |
| `FAILURE_CLASS` | Separation-of-duties degeneracy; fails **open** (silent success) |
| `OBSERVED_SYMPTOM` | PR #8 merged with **zero** reviews, by the same principal that authored it and that held the sole always-bypass authority |
| `EXPECTED_BEHAVIOR` | `approver != author` |
| `ROOT_CAUSE` | author = `zhiheng-zhang-Mera`; CODEOWNER = `@zhiheng-zhang-Mera`; merging actor = `zhiheng-zhang-Mera` (with `bypass_mode: always`). The platform refused the only action that would have created independence: `Review Can not approve your own pull request`. |
| `INVALID_ASSUMPTION` | That an enabled requirement (`require_code_owner_review: true`) implies an exercised one. A requirement whose actor set has one element is satisfied by nobody. |
| `DETECTION_MECHANISM` | Reading PR/review/ruleset APIs and comparing principals |
| `FAILED_TEST_OR_GATE` | None fired. The requirement was live and the protected path correctly matched — the gate did not fail, which is the finding. |
| `REPRODUCTION_METHOD` | `gh pr view 8 --json author,reviews,latestReviews,mergeDecision` → `reviews: []`; `gh api repos/…/rulesets/22746755` → `require_code_owner_review: true`, `bypass_actors: [always]` |
| `PRODUCTION_IMPACT` | A Root-Surface-affecting promotion landed with a non-conforming authorization path |
| `TRUST_IMPACT` | **Direct.** `BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF` was not satisfied at the identity layer |
| `SAFETY_IMPACT` | The content was unaffected (tree byte-identical to the verified candidate); the **authorization** was |
| `FIX_DESCRIPTION` | Provision the Boss machine identity (GitHub App). Stage C then measured `app/codex-boss` opening PR #9 with all four checks green and the promotion stopping at `WAITING_FOR_ROOT_OWNER`. |
| `WHY_POLICY_WAS_NOT_WEAKENED` | CODEOWNERS and the ruleset are **unchanged**. No bypass was used (`--admin` was available and refused). No patch-splitting to route around review. The repair was to add a distinct principal, not to relax the rule. |
| `BEFORE_RESULT` | PR #8: identical principals → **merged**, zero reviews |
| `AFTER_RESULT` | PR #9: distinct principals → **not merged**, `WAITING_FOR_ROOT_OWNER`, `rootOwnerApproval: null` |
| `RELATED_TESTS` | `tests/unit/promotion-gate.test.ts`, `tests/unit/root-trust-authority-lockdown.test.ts` (unchanged) |
| `CI_RUNS` | Stage C candidate `d8fc0fb65791`: all four required checks success (`foreignSha: []`, `missing: []`) |
| `RELATED_PRS` | #8 (failure case), #9 (successful measurement) |
| `RELATED_BRANCHES` | `integration/pre-city-baseline`, `evolution/acceptance-promotion-identity-20260922002642` |
| `RELATED_TAGS` | `pre-city-baseline-v1` |
| `RELATED_ARTIFACTS` | `dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json`, `experiments/governance/GOV-001…`, `GOV-003…`, `TRUST_GOVERNANCE_FINDING.md` |
| `LIMITATIONS` | `n = 1`. **NOT OBSERVABLE**: whether GitHub satisfied the review requirement or admitted the bypass actor. No claim that the machine identity lacks privilege, that GitHub universally prevents bypass, or that CODEOWNERS alone caused the result. |
| `PAPER_USE` | **motivation**, **case-study**, **comparison**, **failure-analysis**, **design-rationale**, **limitation** |

---

## FINDING-005 — Three drift gates fired on the repair itself, and were fixed by correcting the work

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-005 (three related incidents) |
| `TITLE` | Test-catalogue drift, bare comment citations, and unnecessary exports — all caught by existing gates |
| `DATE_DISCOVERED` | Repair round |
| `FIRST_KNOWN_BAD_SHA` | `b0e7da9` (P1, which added two test files without regenerating the catalogue) |
| `FIRST_OBSERVED_SHA` | `b0e7da9` — first full-suite run reported **12 failures** |
| `FIX_SHA` | `cc970fe` (I1) + the main-derived `d9ddb15`; citation refinement `2f36d99` |
| `VALIDATED_SHA` | `d9ddb15` — unit suite **260 files / 3285 tests / 0 failures**; CI `35674821748` all four success |
| `AFFECTED_SUBSYSTEM` | `config/test-catalogue.json`; comment-citation gate; export-surface gate |
| `FAILURE_CLASS` | Derived-artifact drift + policy-compliance, **not** production-behaviour defects |
| `OBSERVED_SYMPTOM` | (a) `test catalogue has drifted from the tree`; (b) `bare section citations: 1310 (baseline 1308)`; (c) `Unreachable (5): … evolution-root-policy.ts` |
| `EXPECTED_BEHAVIOR` | Adding tests updates the catalogue; new comments name a tracked document; exports are reachable or internal |
| `ROOT_CAUSE` | (a) the catalogue is derived from the tree and was not regenerated; (b) two new comments cited `§8.3`/`§8` alone; (c) six types and one function were exported though only used inside their module |
| `INVALID_ASSUMPTION` | That new tests need no catalogue update, and that a section number is a sufficient citation |
| `DETECTION_MECHANISM` | The three gates, all pre-existing |
| `FAILED_TEST_OR_GATE` | `test-impact`, `comment-citation`, `export-surface` |
| `REPRODUCTION_METHOD` | Add a test file without regenerating → `node scripts/generate-test-catalogue.cjs --check` exits 1; run the two unit gates |
| `PRODUCTION_IMPACT` | None — no product behaviour was wrong |
| `TRUST_IMPACT` | None |
| `SAFETY_IMPACT` | None |
| `FIX_DESCRIPTION` | (a) regenerate through the intended mechanism: **+21 / −0**, 241 suites, 27/27 capabilities; (b) cite `docs/autonomous-evolution.md`, a **tracked** document; (c) drop the unnecessary `export` keyword — the rule's own preferred remedy over recording an exception |
| `WHY_POLICY_WAS_NOT_WEAKENED` | No baseline was raised, no exception recorded, no gate disabled, no threshold lowered. `EVOLUTION_ROOT_ENV` stays exported because it is genuinely operator-facing. |
| `BEFORE_RESULT` | 12 failures (then 5 after the catalogue fix) |
| `AFTER_RESULT` | 0 failures; catalogue current at 276 suites on the main-derived branch |
| `RELATED_TESTS` | `tests/unit/comment-citation.test.ts`, `tests/unit/export-surface.test.ts`, `tests/unit/platform/test-impact.test.ts` |
| `CI_RUNS` | `35674821748` |
| `RELATED_PRS` | promotion PR (pending) |
| `RELATED_BRANCHES` | `fix/runtime-isolation-root-policy-v1`, `test/pf020-runtime-isolation-production-fix-v2` |
| `RELATED_TAGS` | none |
| `RELATED_ARTIFACTS` | `EXPERIMENT_TIMELINE.md` entries for the repair |
| `LIMITATIONS` | The catalogue is machine-generated, so its diff is evidence of drift, not of judgement |
| `PAPER_USE` | **failure-analysis**, **design-rationale** (gates that fired on real work and were not weakened) |

---

## FINDING-006 — A path-containment assertion was decided by string prefix

| Field | Value |
|---|---|
| `FINDING_ID` | FINDING-006 |
| `TITLE` | `startsWith()` reported a false overlap for a sibling directory sharing a name prefix |
| `DATE_DISCOVERED` | Repair round, first run of the composition suite |
| `FIRST_KNOWN_BAD_SHA` | **The assertion never existed in production.** It was introduced and corrected inside the same uncommitted change. `FIRST_KNOWN_BAD_SHA = NOT APPLICABLE`; the assertion was never pushed in a broken state. |
| `FIRST_OBSERVED_SHA` | `b0e7da9` working tree (pre-commit) |
| `FIX_SHA` | Same commit (`b0e7da9`) — corrected before it was ever committed |
| `VALIDATED_SHA` | `d9ddb15` |
| `AFFECTED_SUBSYSTEM` | `tests/unit/self-evolution-host-root-geometry.test.ts` (assertion only) |
| `FAILURE_CLASS` | Incorrect test assertion — **not** a production separation failure |
| `OBSERVED_SYMPTOM` | `AssertionError: expected true to be false` on `candidate.layout.root.startsWith(host.stableRoot())` |
| `EXPECTED_BEHAVIOR` | Containment is determined by path containment, not lexical prefix |
| `ROOT_CAUSE` | The sibling is `<parent>/<name>-evolution-<fp>`, which **string**-starts with `<parent>/<name>`. That is a different directory. |
| `INVALID_ASSUMPTION` | That a shared string prefix implies containment |
| `DETECTION_MECHANISM` | The assertion itself failed, which is what forced the correct reasoning |
| `FAILED_TEST_OR_GATE` | the new composition test |
| `REPRODUCTION_METHOD` | Compare `startsWith` against `verifyRuntimeSeparation`/`path.relative` for `<stable>` vs `<stable>-evolution-<fp>` |
| `PRODUCTION_IMPACT` | None |
| `TRUST_IMPACT` | None |
| `SAFETY_IMPACT` | None — and notably the invariant used the correct rule all along |
| `FIX_DESCRIPTION` | The assertion now uses `verifyRuntimeSeparation(...) === {separated:true, overlaps:[]}` plus `path.relative(...).startsWith("..")`, and records why string prefixing is wrong |
| `WHY_POLICY_WAS_NOT_WEAKENED` | The **code** was not changed; only the wrong assertion was. `verifyRuntimeSeparation` is untouched. |
| `BEFORE_RESULT` | assertion false-failed |
| `AFTER_RESULT` | assertion passes and documents the rule |
| `RELATED_TESTS` | `tests/unit/self-evolution-host-root-geometry.test.ts` |
| `CI_RUNS` | `35674821748` |
| `RELATED_PRS` | promotion PR (pending) |
| `RELATED_BRANCHES` | `fix/runtime-isolation-root-policy-v1` |
| `RELATED_TAGS` | none |
| `RELATED_ARTIFACTS` | `GOV-006…` ("one assertion was wrong, not the code") |
| `LIMITATIONS` | None material |
| `PAPER_USE` | **case-study**, **design-rationale** — direct evidence for *why* a path-containment predicate exists rather than a prefix check |

---

*Not indexed here as product defects:* the Stage C attempt-1 **precondition failure** is a manifestation of
FINDING-002 (and is preserved as an attempt, not relabelled); the earlier **self-inflicted
`artifacts/`-tracking CI failure** (`5c06f7e` → repaired in `23e1541`) is recorded in
`PRE_CITY_FREEZE_MANIFEST.json` and `EXPERIMENT_TIMELINE.md`, and is deliberately **not** an
architecture finding.
