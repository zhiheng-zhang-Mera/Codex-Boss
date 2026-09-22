# CLAIM–EVIDENCE MATRIX — Capability City

Every candidate paper claim, with its status, evidence, and — most importantly — **what it does not prove**
and the wording that is prohibited. Claims must not be upgraded beyond the actual evidence; narrow
reproducible claims are preferred over broad architectural ones.

Machine-readable companion: `claim-evidence-matrix.json`.

**Status legend:** `SUPPORTED` · `PARTIALLY_SUPPORTED` · `NOT_SUPPORTED` · `NOT_OBSERVABLE`

---

## CLAIM-001 — A manifest-driven architecture gate can be blind to most real dependency edges

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-001 |
| `CLAIM` | In this repository, the `architecture:ratchet` gate reported no violations while the implementation graph contained 43 kernel→feature edges it could not see, because it scanned only manifest-declared modules (25 of 594 owned files; 9 of 27 manifests declare `modules: []`). |
| `STATUS` | **SUPPORTED** |
| `SUPPORTING_EVIDENCE` | `scripts/architecture.cjs` `collectImports` (declared-modules-only iteration + drop-undeclared-target); count of `modules: []` in `config/capabilities/*.yaml` = 9; `pnpm run architecture:ratchet` → `violations: []`; independent scan → 187 cross-capability edges, 43 kernel→feature; concrete invisible edge `electron/bootstrap/persistence.ts:24` → `tenx` `../runtime-intelligence/live-capture` |
| `CONTRADICTING_EVIDENCE` | None found |
| `LIMITING_EVIDENCE` | The 187/43 figures come from an independent scan whose alias and computed-path handling was not exhaustively validated; the scan is not a shipped instrument |
| `SAMPLE_SIZE` | 1 repository, 1 gate implementation |
| `ENVIRONMENT` | Windows, `pnpm` 11.19.0, Node 24, commit `baf4108` / `836b5ed` |
| `EXACT_SHAS` | `baf4108`, `836b5ed`, `7024203` |
| `EXACT_TESTS` | `tests/unit/platform/*` (test-impact); no test asserts the blindness |
| `RELATED_PRS` | — |
| `WHAT_IS_NOT_PROVEN` | That manifest-driven gates are generally blind; that this repo's *other* gates share the flaw; that the 187 count is exact rather than a lower bound |
| `ALLOWED_WORDING` | "In this repository, the declared-graph ratchet reported no violations while 43 kernel→feature implementation edges existed in the measured graph." |
| `PROHIBITED_OVERCLAIM` | "Manifest-driven architecture gates cannot detect dependency violations." (registers a universal from `n = 1`; also `FINDING-001` is a specific implementation's behaviour) |

---

## CLAIM-002 — The isolation invariant detected a defect that the root-placement policy created

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-002 |
| `CLAIM` | Production Self-Evolution could not create a Candidate in development topology because `evolutionRoot` defaulted to `<userData>/evolution`, inside the Stable root; the isolation invariant **refused correctly**, so the defect was in the placement policy and not the invariant. |
| `STATUS` | **SUPPORTED** |
| `SUPPORTING_EVIDENCE` | `self-evolution-host.ts:154` default; `runtime-paths.ts:100` (`userData` = `<installRoot>/runtime-data`); `detectRepositoryRoot` → `stableRoot` = checkout; `runtime-isolation.ts:180`; Stage C attempt-1 error; compiled-predicate probe: production-dev REJECT, instrument REJECT, packaged ACCEPT, external sibling ACCEPT, control REJECT (`GOV-004` §4) |
| `CONTRADICTING_EVIDENCE` | None |
| `LIMITING_EVIDENCE` | Packaged installs were unaffected, so "production was broken" is topology-scoped, not universal |
| `SAMPLE_SIZE` | 2 topologies (development, packaged) |
| `ENVIRONMENT` | Windows, Node 24, `pnpm` 11.19.0 |
| `EXACT_SHAS` | `add57742` (observed), `b0e7da9` (fix), `d9ddb15` (main-derived fix, CI-validated) |
| `EXACT_TESTS` | `tests/unit/evolution-root-policy.test.ts` (8), `tests/unit/self-evolution-host-root-geometry.test.ts` (3) |
| `RELATED_PRS` | #9 (Stage C research), promotion PR (production) |
| `WHAT_IS_NOT_PROVEN` | That the defect affected packaged installs; that any user-visible product behaviour failed; that other root-placement decisions in the repo are correct |
| `ALLOWED_WORDING` | "In development topology, production Self-Evolution could not create a Candidate because the Candidate root resolved inside Stable; the invariant refused correctly and the placement policy was repaired rather than the invariant." |
| `PROHIBITED_OVERCLAIM` | "The runtime-isolation invariant was broken." (the opposite: it worked) · "Production was unsafe." (it failed closed) |

---

## CLAIM-003 — Separating the proposing principal from the authorizing principal changed the promotion outcome

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-003 |
| `CLAIM` | In the controlled Stage C case, separating the Candidate author principal from the Root Owner principal changed the observed promotion path from a **zero-review merge** to `WAITING_FOR_ROOT_OWNER`, while the tested content conditions were held equivalent. |
| `STATUS` | **SUPPORTED** (for the measured case) |
| `SUPPORTING_EVIDENCE` | **PR #8**: author `zhiheng-zhang-Mera`, CODEOWNER `@zhiheng-zhang-Mera`, merger `zhiheng-zhang-Mera`; `reviews: []`, `latestReviews: []`, `reviewDecision: ""`; `require_code_owner_review: true`; `/package.json` correctly matched; all checks green; **merged**. **PR #9**: author `app/codex-boss` (`is_bot: true`), CODEOWNER `@zhiheng-zhang-Mera`; all four required checks `success` on candidate `d8fc0fb65791` (`foreignSha: []`, `missing: []`); outcome and durable state `WAITING_FOR_ROOT_OWNER`; `rootOwnerApproval: null`; PR open; `main` unmoved `7024203`; **not merged** |
| `CONTRADICTING_EVIDENCE` | None found. (An earlier programme inference — "bypass was the only executable path" — was **wrong** and is retained as `D-003` + correction `D-004`.) |
| `LIMITING_EVIDENCE` | `n = 1`; a single governance configuration; the two PRs differ in more than the principal (different change sets — #8 was the pre-city integration, #9 a deliberately inert Root-Surface file), so "held equivalent" refers to the **content conditions** (green required checks on the exact SHA, clean trees), not to identical patches |
| `SAMPLE_SIZE` | `n = 1` controlled case |
| `ENVIRONMENT` | GitHub `Main-Protection` ruleset `22746755`; CODEOWNERS as shipped; Windows CI runners |
| `EXACT_SHAS` | PR #8 head `836b5ed`, merge `7024203`; PR #9 candidate `d8fc0fb65791`; instrument `cc970fe` / V2 tip `2f36d99` |
| `EXACT_TESTS` | `tests/unit/promotion-gate.test.ts`, `tests/unit/root-trust-authority-lockdown.test.ts` (unchanged by this work) |
| `RELATED_PRS` | #8, #9 |
| `WHAT_IS_NOT_PROVEN` | That `app/codex-boss` lacks all repository privilege · that GitHub universally prevents bypass · that CODEOWNERS alone caused the outcome · that all possible actors are blocked · that identity separation is sufficient under every repository condition · any broader security proof · anything beyond this measured case |
| `ALLOWED_WORDING` | "In the controlled Stage C case, separating the Candidate author principal from the Root Owner principal changed the observed promotion path from a zero-review merge case to `WAITING_FOR_ROOT_OWNER`, while the tested content conditions were held equivalent." |
| `PROHIBITED_OVERCLAIM` | "The machine identity has no privileged capability." · "GitHub enforces code-owner review." · "CODEOWNERS prevents unauthorized promotion." · "Boss cannot self-authorize." (unqualified) |

---

## CLAIM-004 — Whether GitHub satisfied or bypassed the code-owner requirement at Stage A

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-004 |
| `CLAIM` | PR #8 merged with `require_code_owner_review: true` and zero reviews. Whether the platform evaluated that requirement as **satisfied** or admitted the Root Owner through the **bypass** path is not determinable from the PR, review and ruleset APIs. |
| `STATUS` | **NOT_OBSERVABLE** (the observable part is SUPPORTED; the mechanism is not observable) |
| `SUPPORTING_EVIDENCE` (observable part) | `reviews: []`, `latestReviews: []`, `reviewDecision: ""`; `require_code_owner_review: true`; ruleset `updated_at` predates the programme; `bypass_actors: [{actor_id 229580437, bypass_mode: always}]`; `current_user_can_bypass: always`; platform refused `Review Can not approve your own pull request`; merge performed by the author principal |
| `CONTRADICTING_EVIDENCE` | None — no API exposes the decision path, and no bypass event is recorded on the PR object |
| `LIMITING_EVIDENCE` | Entirely unobservable from the available APIs |
| `SAMPLE_SIZE` | `n = 1` |
| `ENVIRONMENT` | As above |
| `EXACT_SHAS` | PR #8 head `836b5ed`, merge `7024203` |
| `EXACT_TESTS` | None |
| `RELATED_PRS` | #8 |
| `WHAT_IS_NOT_PROVEN` | The mechanism. **Stated explicitly wherever the question arises.** |
| `ALLOWED_WORDING` | "The observable result was a merge with zero independent reviews, performed by the principal that authored the change and held the sole always-bypass authority. Whether GitHub treated the requirement as satisfied or admitted the bypass actor is **NOT OBSERVABLE FROM CURRENT EVIDENCE**." |
| `PROHIBITED_OVERCLAIM` | "GitHub definitely bypassed code-owner review." (explicitly forbidden by the mission, §3) |
| `OWED` | A separate controlled probe on a throwaway protected branch, to be a **distinct** protocol — never folded into `GOV-002` |

---

## CLAIM-005 — A gate that fires on real work can be satisfied without weakening it

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-005 |
| `CLAIM` | Three existing gates (test catalogue, comment citation, export surface) fired on this programme's own repair work; each was satisfied by correcting the work product, with no threshold raised, baseline relaxed, exception recorded, or gate disabled. |
| `STATUS` | **SUPPORTED** |
| `SUPPORTING_EVIDENCE` | Catalogue drift `+21/−0` then `+14/−0`, regenerated via `scripts/generate-test-catalogue.cjs`; bare citations `1310` vs baseline `1308` → comments re-pointed at the tracked `docs/autonomous-evolution.md`; `Unreachable (5): …EvolutionRootPolicy` → `export` keyword dropped from 6 types + 1 function; final state **0 failures**, 276 suites, 27/27 capabilities |
| `CONTRADICTING_EVIDENCE` | None |
| `LIMITING_EVIDENCE` | `EVOLUTION_ROOT_ENV` remains exported because it is genuinely operator-facing, so "no exports added" would be false — the claim is narrower: no *unnecessary* export was kept |
| `SAMPLE_SIZE` | 3 gates, 1 repair round |
| `ENVIRONMENT` | Windows, Node 24 |
| `EXACT_SHAS` | `b0e7da9` (failing state), `cc970fe`, `2f36d99`, `d9ddb15` (validated) |
| `EXACT_TESTS` | `tests/unit/comment-citation.test.ts`, `tests/unit/export-surface.test.ts`, `tests/unit/platform/test-impact.test.ts` |
| `RELATED_PRS` | promotion PR |
| `WHAT_IS_NOT_PROVEN` | That these gates are generally well-calibrated; that no gate ever produces a false positive |
| `ALLOWED_WORDING` | "The gate fired; the work product was corrected; the gate was not weakened." |
| `PROHIBITED_OVERCLAIM` | "These gates have no false positives." (the export-surface rule behaved as designed and was *not* a false positive — but that is a separate observation, not a general claim) |

---

## CLAIM-006 — Containment must be decided by path containment, not by string prefix

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-006 |
| `CLAIM` | A path-containment assertion that used `startsWith()` reported a false overlap for the sibling directory `<stable>-evolution-<fp>`, which shares a name prefix but is a different directory. The invariant itself used path containment and was correct. |
| `STATUS` | **SUPPORTED** |
| `SUPPORTING_EVIDENCE` | `AssertionError: expected true to be false` on `candidate.layout.root.startsWith(host.stableRoot())`; the corrected assertion uses `verifyRuntimeSeparation(...) === {separated:true, overlaps:[]}` and `path.relative(...).startsWith("..")`; `verifyRuntimeSeparation` is byte-identical throughout |
| `CONTRADICTING_EVIDENCE` | None |
| `LIMITING_EVIDENCE` | The wrong assertion was corrected inside the same uncommitted change, so it was never pushed broken — `FIRST_KNOWN_BAD_SHA = NOT APPLICABLE` |
| `SAMPLE_SIZE` | 1 assertion |
| `ENVIRONMENT` | Windows (where `\` separators and case-insensitivity make prefix reasoning especially unsafe) |
| `EXACT_SHAS` | `b0e7da9` working tree; validated `d9ddb15` |
| `EXACT_TESTS` | `tests/unit/self-evolution-host-root-geometry.test.ts` |
| `RELATED_PRS` | promotion PR |
| `WHAT_IS_NOT_PROVEN` | That prefix-checking is always wrong in every codebase; the claim is about containment decisions |
| `ALLOWED_WORDING` | "Containment must be determined by path containment; a sibling sharing a lexical prefix is a different directory." |
| `PROHIBITED_OVERCLAIM` | "Production separation failed." (it did not; only the assertion did) |

---

## CLAIM-007 — The repair did not make the test easier

| Field | Value |
|---|---|
| `CLAIM_ID` | CLAIM-007 |
| `CLAIM` | The production repair made production satisfy the invariant it already claimed to enforce, and required the acceptance to consume that same policy. The test's difficulty was unchanged. |
| `STATUS` | **SUPPORTED** |
| `SUPPORTING_EVIDENCE` | `verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES`, `READ_ONLY_SHARED_SURFACES` byte-identical; no `allowNestedCandidateForDev`/`skipIsolationCheck`/test-only bypass exists (grep-verified); the acceptance calls the *same* `resolveEvolutionRoot` production uses and records the invariant's own verdict; Stage C still required all four checks green on the exact SHA and still ended at `WAITING_FOR_ROOT_OWNER`; a failed probe fails **closed** |
| `CONTRADICTING_EVIDENCE` | None |
| `LIMITING_EVIDENCE` | Option A (an instrument-only fix) was *rejected precisely because* it would have weakened external validity; the claim rests on that choice having been made and recorded (`GOV-004` §7, `D-008`) |
| `SAMPLE_SIZE` | 1 repair |
| `ENVIRONMENT` | As above |
| `EXACT_SHAS` | `b0e7da9`, `cc970fe`, `d9ddb15` |
| `EXACT_TESTS` | 8 policy + 3 composition + 5 instrument tests; full suite 3285 tests |
| `RELATED_PRS` | promotion PR |
| `WHAT_IS_NOT_PROVEN` | That the *result* would have differed under Option A (never run — correctly, so it remains `DESIGN CLAIM`) |
| `ALLOWED_WORDING` | "The implementation was changed to satisfy the invariant; the invariant and the test conditions were not relaxed." |
| `PROHIBITED_OVERCLAIM` | Any implication that Option A was tried and failed |

---

## Not claimed (recorded so their absence is not read as an oversight)

| Claim that might be tempting | Status |
|---|---|
| Boss can no longer self-authorize under any condition | `NOT_SUPPORTED` — only the tested path was measured |
| `app/codex-boss` has no privileged capability | `NOT_SUPPORTED` — it created a branch, a commit, a push and a Root-Surface PR |
| Identity separation is sufficient for authority separation in general | `NOT_SUPPORTED` — `n = 1`; roles, rulesets and credential scopes all interact |
| The architecture gate is now accurate | `NOT_SUPPORTED` — **not yet repaired**; Phase 0 is authorised to do it |
| Capability City has improved the architecture | `NOT_SUPPORTED` — Phase 0 not started; the runtime-isolation repair is a corrective patch and **must not be counted** as City progress |
| Co-Learning / Judgment Growth progress | `NOT_APPLICABLE` — frozen |
