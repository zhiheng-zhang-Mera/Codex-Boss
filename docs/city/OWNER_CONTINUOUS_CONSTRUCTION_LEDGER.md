# OWNER CONTINUOUS CONSTRUCTION LEDGER

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` (issued 2026-09-24, Australia/Melbourne)
**Execution role:** Hns acting as the temporary Owner-authorised City construction executor
**Operating mode:** `OWNER_CONTINUOUS_CONSTRUCTION`

## Rules of this ledger

This file is **append-only**.

- An earlier entry is never rewritten, deleted, reordered, or silently corrected.
- A correction is a **new entry** that points back at the entry it corrects (`CORRECTS: CC-###`).
- Every Owner-level intervention, compromise, bypass, workaround, semantic reinterpretation, temporary bridge,
  CI exception, retry, rollback, or governance repair adds an entry.
- Use of escalation level `L4`-`L6` (per workbook §6) is automatically an entry.
- This ledger records **what was done and why the normal path was not used**. It never converts an unexplained
  red into a claimed PASS.

## Entry schema (workbook §4.1)

```text
ENTRY_ID
timestamp_utc
executor
authority_level
main_before
main_after
branch
PR
workflow_run_ids
checks_observed
problem
classification
normal_path
why_normal_path_was_not_used
action_taken
files_or_rules_changed
known_risk
evidence_preserved
rollback
temporary_debt_created
debt_id
exit_condition
closure_status
research_value
```

`authority_level` uses the workbook §6 ladder:

```text
L0 normal machine/App path
L1 retry / repair / alternate non-Owner path
L2 Owner environment approval / review / workflow action
L3 Owner merge bypass
L4 temporary ruleset exception or required-check relaxation
L5 Owner direct governance write / direct protected-file repair
L6 emergency direct-main write
```

---

## CC-001 — Owner construction lease opened; workbook committed as the effective instruction set

```text
ENTRY_ID                    CC-001
timestamp_utc               2026-09-24T06:22:00Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner authority assumed under the workbook lease) — no gate crossed yet
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  79af142b9c0e9f634dc099bd2ad289cff5f31301 (unchanged by this entry)
branch                      docs/city-continuous-construction-audit
PR                          (opened by this entry's branch)
workflow_run_ids            -
checks_observed             not yet run on this branch
problem                     The workbook `OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` was issued only as a local
                            document. Workbook §4 requires the committed GitHub copy to contain the effective
                            instructions actually used, and requires the cloud audit system (workbook, ledger,
                            debt register, incident record) to exist before further construction.
classification              GOVERNANCE / audit-record gap (not a CI defect)
normal_path                 Owner commits the audit corpus through an ordinary reviewed PR.
why_normal_path_was_not_used
                            Not bypassed. This entry IS the normal path, executed by the delegated executor
                            because workbook §0 forbids returning WAITING_FOR_ROOT_OWNER as a terminal state.
action_taken                Committed the workbook verbatim into `docs/city/`, with this ledger, the renovation
                            debt register, and the spurious-dispatch incident record.
files_or_rules_changed      docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (new)
                            docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md (new)
                            docs/city/CITY_RENOVATION_DEBT_REGISTER.md (new)
                            docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md (new)
known_risk                  The workbook grants broad delegated authority; committing it widens what a reader
                            may believe the executor is permitted to do. Mitigated by keeping the permanent
                            authority model stated in the document (§0, §32) and by the final restoration act.
evidence_preserved          Local issuance copy sha256 134db7ac... preserved outside the repository; verbatim
                            copy committed at docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md
rollback                    Revert the docs/city audit commit through a normal reviewed PR.
temporary_debt_created      none
debt_id                     -
exit_condition              n/a
closure_status              CLOSED on merge
research_value              Records that the audit corpus was created before, not after, the construction it
                            audits — a governance precondition rather than retrospective paperwork.
```

---

## CC-002 — Spurious epoch-finalization dispatch detected; cancelled, not approved

```text
ENTRY_ID                    CC-002
timestamp_utc               2026-09-24T06:20:00Z (action) ; dispatch observed at 2026-09-24T05:52:46Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner workflow action: cancel a waiting protected run)
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  79af142b9c0e9f634dc099bd2ad289cff5f31301
branch                      main (workflow_dispatch run target)
PR                          -
workflow_run_ids            35961897353 (spurious, cancelled)
checks_observed             Trust Epoch Finalization #35961897353 = waiting on environment
                            `boss-root-trust-owner` at head_sha 8897ddc3a18f5e38da14729ced951d14122d6394
problem                     A helper intended to be a dry run performed a real `workflow_dispatch` of the
                            protected Trust Epoch Finalization workflow, creating a waiting run on the
                            pre-PR#26 SHA while the intended run was dispatched on the post-PR#26 SHA.
classification              R3-adjacent / operational defect (workbook §5): the artifact is a governance
                            defect in the dispatch helper, not a red code check. Recorded as an incident.
normal_path                 Only an intentional, reason-bearing dispatch of the protected finalization
                            workflow should ever exist; a dry-run helper should write nothing.
why_normal_path_was_not_used
                            The defect had already fired before this entry. The normal path is the repair,
                            which is workbook §9 B2 (helper requires explicit `--confirm`, true read-only
                            dry-run path) and is tracked as debt until done.
action_taken                Cancelled run 35961897353 via the Owner workflow action. Did NOT approve it.
                            Recorded the incident at docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md.
files_or_rules_changed      docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md (new)
known_risk                  Cancelling was itself a decision about a protected, Owner-gated ceremony. It is
                            safe because the run's head_sha (8897ddc3) is the pre-PR#26 tree, which the
                            already-merged main supersedes; approving it would have anchored a stale surface.
evidence_preserved          The Actions run is preserved in GitHub history as `cancelled`; never deleted or
                            hidden. Run id, head SHA, environment, and reviewer requirement are recorded.
rollback                    Not applicable: the run is cancelled and its record is the evidence. It cannot
                            be un-cancelled, and it must not be re-dispatched on a stale SHA.
temporary_debt_created      yes — dispatch-helper hardening not yet implemented
debt_id                     CITY-DEBT-001
exit_condition              Helper performs no write without an explicit `--confirm`; a true read-only
                            dry-run path exists; dry-run is proven incapable of dispatching by test.
closure_status              OPEN (see CITY_DEBT_REGISTER.md)
research_value              A "dry-run" that performs a real protected dispatch is a concrete example of a
                            helper whose name overstates its safety. It is the same failure class the
                            workbook calls a provenance/TOCTOU defect, one level up: intent vs effect.
```

---

## CC-003 — Intended epoch-29 finalization run approved under the workbook lease

```text
ENTRY_ID                    CC-003
timestamp_utc               2026-09-24T06:20:30Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner environment approval: `boss-root-trust-owner`)
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  79af142b9c0e9f634dc099bd2ad289cff5f31301
branch                      main (run); the run itself produces branch trust-epoch/boss-root-trust-29
PR                          -
workflow_run_ids            35962014554 (approved) ; 35961897353 (cancelled in CC-002)
checks_observed             Trust Epoch Finalization #35962014554 waiting on environment
                            `boss-root-trust-owner`, head_sha 79af142b9c0e9f634dc099bd2ad289cff5f31301,
                            deployment id 6631222136, reviewer zhiheng-zhang-Mera, can_admins_bypass=false
problem                     Root Trust is stale: the committed epoch 28 certifies root surface
                            bb17f834ad818eb2b3e5f7655f316f9650c998702ad1f56f7868df44abdc245a while the live
                            surface is 2abacb6f069b5bf577682294c9b4b4c82f0686ebe7165d9fc5bd4ba8c8aa30d7.
                            Measured independently at 79af142b by `trust-migration-proposal.cjs`:
                            needsMigration=true, changed root-trust file
                            `scripts/architecture-enforcement-baseline.cjs` (from PR #26).
classification              Governance boundary that the workbook converts from a stop into an act (§0, §8 A3)
normal_path                 The protected environment's named reviewer (the Root Owner) approves the
                            deployment, and the workflow advances exactly one epoch.
why_normal_path_was_not_used
                            The normal path WAS used: this is a real environment approval, not a bypass. The
                            only difference from a manual Owner action is that the workbook (§0, §8 A3)
                            states the Owner authorisation in advance, so the executor performs the approval
                            instead of waiting for a separate instruction.
action_taken                POST /actions/runs/35962014554/pending_deployments with state=approved and a
                            comment naming the workbook clause, the run id, the head SHA and the cancelled
                            spurious run. The workflow then measured, advanced, verified with `--check`,
                            committed, and pushed the epoch branch.
files_or_rules_changed      none in the repository by this entry (the workflow writes only
                            trust-policy/trust-epoch.json on its own branch)
known_risk                  Approving a run whose checkout is not SHA-bound (workbook §1, §9) could anchor a
                            newer main than the dispatch SHA. At approval time no newer main existed; the
                            defect is nonetheless live until §9 is executed.
evidence_preserved          Pending-deployment response (deployment 6631222136), run id 35962014554, head_sha
                            79af142b9c0e9f634dc099bd2ad289cff5f31301, local proposal JSON, cancelled run
                            35961897353.
rollback                    A wrong epoch is repaired forward through the governed trust-migration path.
                            The Owner-authorised epoch branch is never force-pushed or rewritten.
temporary_debt_created      no (the underlying TOCTOU defect is already tracked)
debt_id                     CITY-DEBT-002 (TOCTOU / floating-main finalization)
exit_condition              Finalization workflow checks out `${{ github.sha }}` with fetch-depth 0 and
                            asserts `git rev-parse HEAD == github.sha` and `github.ref == refs/heads/main`.
closure_status              OPEN (see CITY_DEBT_REGISTER.md)
research_value              Demonstrates that an Owner gate can be an *act* under a construction lease while
                            still producing a genuine, provenance-bearing ceremony rather than a rubber stamp.
```

---

## CC-004 — Local main CI red classified: R2 city defect with understood repair (stale epoch anchor)

```text
ENTRY_ID                    CC-004
timestamp_utc               2026-09-24T06:24:00Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L0 (classification and evidence capture; no gate crossed)
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  79af142b9c0e9f634dc099bd2ad289cff5f31301
branch                      main
PR                          #26 (already merged; this red is on its merge commit)
workflow_run_ids            35961901372 (Desktop CI, main, failure)
checks_observed             quality      = success
                            architecture = success
                            unit         = FAILURE (1 failed | 3452 passed, 269 files)
                            acceptance   = skipped (blocked by unit)
                            package      = skipped (blocked by unit)
problem                     tests/unit/test-layers.test.ts:430 fails with
                            TRUST_EPOCH_ROOT_SURFACE_MISMATCH: epoch 28 certifies bb17f834... but the
                            surface is 2abacb6f... — the committed trust epoch no longer anchors the live
                            Root Trust Surface after PR #26 changed
                            scripts/architecture-enforcement-baseline.cjs.
classification              R2 — city defect with understood repair (workbook §5). This is the expected,
                            fail-closed red of a stale epoch anchor: the guard is correct and the red is
                            exactly the condition CC-003 authorises repairing.
normal_path                 Land the epoch-29 finalization record through the governed trust-migration path,
                            so the committed epoch anchors the live surface and the guard passes.
why_normal_path_was_not_used
                            The normal path is being used; this entry only classifies the red and refuses the
                            two illegitimate shortcuts — weakening the guard, or hand-editing the epoch file
                            without the Owner-authorised ceremony.
action_taken                Fetched and preserved the failing job log (unit job 107512217870, step
                            "Run pnpm test"); recorded the exact failing assertion and both hashes; did not
                            modify any test, threshold, or baseline.
files_or_rules_changed      none
known_risk                  Main is red and therefore cannot be the final delivery SHA until epoch 29 lands;
                            acceptance and package are skipped downstream, so their status on main is
                            currently UNPROVEN rather than PASS.
evidence_preserved          Run 35961901372; unit job 107512217870; the assertion text with both surface
                            hashes; the local re-measurement at 79af142b via trust-migration-proposal.cjs.
rollback                    n/a (evidence capture only)
temporary_debt_created      no
debt_id                     -
exit_condition              Desktop CI green on main with all five checks emitted and passing.
closure_status              OPEN until epoch 29 is promoted and main CI is green
research_value              A textbook stale-anchor red: the failing artifact is the governance record,
                            not the code; the guard's failure message alone identifies the repair.
```

---

## CC-005 — Epoch-28 surface change accepted as a legitimate declared relation, not grandfathered debt

```text
ENTRY_ID                    CC-005
timestamp_utc               2026-09-24T06:25:00Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L0 (classification) with L2 applied in CC-003
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  79af142b9c0e9f634dc099bd2ad289cff5f31301
branch                      main
PR                          #26
workflow_run_ids            -
checks_observed             -
problem                     The Root Trust Surface changed between epoch 28 and PR #26 by exactly one file,
                            `scripts/architecture-enforcement-baseline.cjs`, which PR #26 modified to split
                            baseline INTEGRITY from candidate-tree IDENTITY. Workbook §24 requires the change
                            to be classified as retired debt, a new legitimate declared relation, or new
                            grandfathered debt — and forbids silently adding a new violation to make CI green.
classification              New legitimate declared relation (workbook §24): the file is already inside the
                            Root Trust Surface, so no surface membership was widened; the file's content
                            changed under an already-declared protection.
normal_path                 Advance exactly one epoch so the owner-authorised record re-anchors the changed
                            surface.
why_normal_path_was_not_used
                            Not bypassed; the epoch advance is that normal path.
action_taken                Recorded the classification. Explicitly did NOT add any new path to the Root Trust
                            Surface declaration, and did not mark the change as grandfathered debt.
files_or_rules_changed      none
known_risk                  A reader could mistake an epoch advance for laundering a surface widening. The
                            distinction is measured, not asserted: changedRootTrustFiles lists exactly one
                            already-declared file and the declaration itself is byte-stable
                            (declarationRewrittenIdentically=true).
evidence_preserved          trust-migration-proposal.json for 79af142b (surface 2abacb6f..., fileCount 74,
                            changedRootTrustFiles=[scripts/architecture-enforcement-baseline.cjs]).
rollback                    n/a
temporary_debt_created      no
debt_id                     -
exit_condition              n/a
closure_status              CLOSED
research_value              Distinguishes "the epoch moved because a protected file changed" from "the epoch
                            moved because the protection was weakened" — the two look similar in a diff and
                            require measurement to separate.
```

---

## CC-006 — Epoch 29 promoted and merged; main restored to green

```text
ENTRY_ID                    CC-006
timestamp_utc               2026-09-24T06:33:49Z (merge) ; 2026-09-24T06:52Z (recorded)
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner environment approval in CC-003) — the merge itself was NORMAL
main_before                 79af142b9c0e9f634dc099bd2ad289cff5f31301
main_after                  1892e61c89596b7cd66257ae5b4cedb4bae8dfc0
branch                      trust-epoch/boss-root-trust-29
PR                          #27
workflow_run_ids            35962014554 (finalization, success) ; 35964121701 (promotion PR Desktop CI, success)
                            ; 35965095036 (main Desktop CI after merge) ; 35961901372 (the red this repairs)
checks_observed             ON THE PROMOTION PR: quality=pass, architecture=pass, unit=pass (8m16s),
                            package=pass, acceptance=pass — ALL FIVE GREEN before merge
                            ON THE RESULTING MAIN: quality=success, architecture=success, unit=success,
                            package and acceptance run after
problem                     Committed epoch 28 no longer anchored the live Root Trust Surface after PR #26, so
                            main's `unit` job failed with TRUST_EPOCH_ROOT_SURFACE_MISMATCH and `acceptance`
                            and `package` were skipped (CITY-DEBT-003, ledger CC-004).
classification              R2 — city defect with understood repair (workbook §5)
normal_path                 Produce the epoch-29 record through the Owner-authorised finalization workflow, open
                            the promotion PR, prove all five hosted checks green, merge normally.
why_normal_path_was_not_used
                            The normal path WAS used in full. NO BYPASS WAS NEEDED: the promotion PR was green on
                            all five checks, because the epoch branch's tree makes the guard pass — the red existed
                            only on main, where the epoch record was stale.
action_taken                Merged PR #27 as a history-preserving merge commit. Verified the epoch branch was
                            based on the then-current main (no rebase, no drift), that its diff was exactly
                            trust-policy/trust-epoch.json, and that the candidate epoch derived from live state
                            (29, not hard-coded) with parent_epoch_hash = epoch 28's hash.
files_or_rules_changed      trust-policy/trust-epoch.json (via PR #27)
known_risk                  Between PR #26 and this merge, main carried a correctly red fail-closed guard and
                            two unproven checks (acceptance, package were SKIPPED, not passing). That window is
                            closed by this merge; the unproven-ness is recorded rather than glossed.
evidence_preserved          Run ids above; PR #27 body; the failing unit job 107512217870 from run 35961901372;
                            cancelled spurious run 35961897353; the local `--check` on the epoch branch before
                            merge (74 files, aggregate 2abacb6f..., MATCHES).
rollback                    A wrong epoch is repaired forward through the governed trust-migration path. The
                            Owner-authorised epoch branch is never force-pushed or rewritten.
temporary_debt_created      no
debt_id                     CITY-DEBT-003 (CLOSED by this entry — see the register)
exit_condition              Epoch 29 on main; `--check` MATCHES; five hosted checks green on the merge commit.
closure_status              CLOSED
research_value              An epoch promotion can be fully green on its own PR while the branch it repairs is
                            red: the guard fails on the stale record, not on the new one. "Main is red" and "the
                            repair PR is red" are different facts, and conflating them is how a bypass gets used
                            where none was needed.
```

---

## CC-007 — Owner continuous construction is itself capable of a spurious protected dispatch

```text
ENTRY_ID                    CC-007
timestamp_utc               2026-09-24T06:38:13Z (last of four) ; recorded 2026-09-24T06:55Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner workflow action: cancel four waiting protected runs)
main_before                 1892e61c89596b7cd66257ae5b4cedb4bae8dfc0
main_after                  1892e61c89596b7cd66257ae5b4cedb4bae8dfc0
branch                      main (workflow_dispatch runs)
PR                          -
workflow_run_ids            35965428473, 35965431153, 35965446098, 35965449267 — all Trust Epoch Finalization,
                            all workflow_dispatch, all head_sha 1892e61c..., all CANCELLED, none approved
checks_observed             Four waiting runs on the protected environment `boss-root-trust-owner`, created
                            06:37:58Z, 06:38:00Z, 06:38:11Z, 06:38:13Z — i.e. within 15 seconds, on a commit that
                            was already correctly anchored by epoch 29.
problem                     Four spurious dispatches of the protected ceremony, in a burst, from a commit that
                            needed no migration. The immediate cause is recorded below; the general cause is
                            that nothing in the construction workflow made "did I just open a protected run by
                            accident?" a question the executor was forced to ask.
classification              R3-adjacent operational defect (workbook §5): a governance artifact, not a code
                            check. Recorded as an incident and a debt. This is the SECOND occurrence of the
                            same failure class as CITY-DEBT-001.
normal_path                 The protected ceremony is dispatched deliberately, once, with a stated reason/risk/
                            rollback, and is either the intended epoch advance or nothing at all.
why_normal_path_was_not_used
                            The dispatches had already happened by the time they were observed. The normal path
                            is the repair: no write without an explicit confirmation (the helper in §9 B2) and
                            the elimination of the automatable route that produced the burst.
action_taken                Cancelled all four runs. Did NOT approve any of them — approving one would have
                            advanced an epoch from a commit that was already anchored, producing a
                            NO_MIGRATION no-op at best and a spurious ceremony record at worst.
                            Then found and FIXED the cause: a test fixture of this very repair was injecting its
                            fake executor through PATH and NODE_OPTIONS, and the real `gh` on this host is a
                            native binary that ignores NODE_OPTIONS, so the "confirmed" case of the new
                            dispatch-helper test reached the REAL gh and dispatched the protected workflow four
                            times. The fixture now injects the executor through the helper's own command
                            override, so the real `gh` is unreachable from that test by construction.
files_or_rules_changed      tests/fixtures/fake-gh.cjs (new, then corrected)
                            tests/unit/city/trust-epoch-dispatch-helper.test.ts (new, then corrected)
known_risk                  The corrective change is itself a test harness; if it regresses, a future test run
                            could again open protected runs. Contained by making injection explicit and by the
                            assertion that the helper resolves its command from the overridable route.
evidence_preserved          The four runs are preserved as `cancelled` and are never deleted or hidden. Their
                            run ids, SHA, environment, timestamps and the cancelling decision are recorded here
                            and in docs/city/incidents/2026-09-24-repeated-spurious-epoch-dispatch.md.
rollback                    Not applicable: cancelled runs are the evidence and must not be re-dispatched.
temporary_debt_created      yes
debt_id                     CITY-DEBT-004
exit_condition              The corrective injection is on main; a full `pnpm test` on a clean main opens no
                            protected run; and the dispatch helper requires an explicit confirmation for every
                            write.
closure_status              OPEN (see CITY_DEBT_REGISTER.md) — the harness repair is committed, the
                            "no protected run is opened by an ordinary test run" check is still to be proven on
                            main after the next test cycle.
research_value              A test fixture that can reach the real system is not a test. The defect is the
                            same one as the original incident, one level down: an artifact whose declared
                            intent ("a fake executor") and effect ("the real executor") disagreed, and the
                            disagreement was invisible because the injection path silently did nothing.
```

---

## CC-008 — Trust-finalization provenance repaired, dispatch helper created, TOCTOU counterfactual pinned

```text
ENTRY_ID                    CC-008
timestamp_utc               2026-09-24T07:05Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L0 for the repair itself; L3 Owner merge bypass is required and is stated below
main_before                 1892e61c89596b7cd66257ae5b4cedb4bae8dfc0
main_after                  (pending merge)
branch                      fix/trust-finalization-sha-bound
PR                          #29
workflow_run_ids            (pending)
checks_observed             (pending)
problem                     Three related defects, all of one class — an artifact whose declared intent and its
                            effect can disagree:
                              CITY-DEBT-002  finalization checked out floating `main`, so an Owner approval of a
                                             waiting run could anchor a tree the run was never dispatched for;
                              CITY-DEBT-001  the dispatch helper had no read-only path, so the only invocation
                                             that existed was a write;
                              CITY-DEBT-004  the TEST FIXTURE written to prove the second one injected its fake
                                             executor through PATH/NODE_OPTIONS, which the real `gh` (a native
                                             binary) ignores, so the injection failed open and opened four
                                             protected runs.
classification              R3 — governance/gate defect (workbook §5), repaired in place.
normal_path                 Land the repair through a reviewed PR, then advance the epoch it moves.
why_normal_path_was_not_used
                            The normal path IS used for the repair. The merge needs an Owner bypass at L3, and
                            only for the `unit` check, because:
                              - `scripts/trust-epoch-finalization-handoff.cjs` is Root Trust Surface, so this PR
                                moves the surface aggregate 2abacb6f... -> e0da26e1...;
                              - the fail-closed guard therefore reports TRUST_EPOCH_ROOT_SURFACE_MISMATCH on the
                                PR head, which is CORRECT — the committed record is legitimately stale;
                              - an epoch cannot be advanced FOR a branch: `--advance` is authorised only through
                                the protected workflow, and that workflow is `refs/heads/main`-only.
                            The red is stated in the PR body BEFORE it is observed, with BYPASS_USED,
                            BYPASS_LEVEL, BLOCKING_CHECKS, EXPECTED_RED, UNEXPECTED_RED and FOLLOWUP filled in
                            (workbook §26).
action_taken                - workflow: `ref: ${{ github.sha }}` + fetch-depth 0, and a fail-closed assertion step
                              as the first step after the checkout
                              (TRUST_EPOCH_FINALIZATION_SHA_MISMATCH), publishing both SHAs;
                            - handoff: `provenance.dispatch_sha` / `provenance.checked_out_sha`, refusal of a
                              half-stated binding, refusal of two SHAs that disagree, validated on the STATED
                              value so `"main"` cannot look like an absent binding;
                            - CLI: `--dispatch-sha` / `--checked-out-sha`, exit 1 on disagreement;
                            - NEW `scripts/trust-epoch-dispatch.cjs`: no write without `--confirm`, true dry run,
                              exact argv printed first, argv arrays and never a shell;
                            - NEW TOCTOU counterfactual (14 cases) and dry-run-cannot-dispatch proof (17 cases);
                            - the harness injection defect (CITY-DEBT-004) repaired in the same commit.
files_or_rules_changed      .github/workflows/trust-epoch-finalization.yml
                            scripts/trust-epoch-finalization-handoff.cjs          (Root Trust Surface)
                            scripts/trust-epoch-finalize-handoff.cjs
                            scripts/trust-epoch-dispatch.cjs                      (new)
                            tests/unit/city/trust-finalization-sha-binding.test.ts (new)
                            tests/unit/city/trust-epoch-dispatch-helper.test.ts    (new)
                            tests/fixtures/fake-gh.cjs                             (new)
known_risk                  The bypass merge puts a RED `unit` on main until epoch 30 anchors the new surface.
                            Bounded by performing the epoch-30 ceremony immediately and requiring all five hosted
                            checks green on the resulting main before any further construction.
evidence_preserved          PR #29 body (including the pre-stated expected red and the bypass statement); the four
                            cancelled spurious runs from CC-007; the failing guard's own message; 63 unit cases
                            passing locally; CITY-DEBT-004's incident record.
rollback                    Revert PR #29 through a normal reviewed PR. The provenance fields are optional as a
                            pair, so a revert restores the previous accepting behaviour; the epoch-30 advance is
                            repaired forward and its branch is never force-pushed.
temporary_debt_created      no new debt; CITY-DEBT-003 is the existing tracker for the expected-red construct
debt_id                     CITY-DEBT-001 (CLOSED), CITY-DEBT-002 (CLOSED), CITY-DEBT-004 (CONTAINED; repair here)
exit_condition              PR #29 merged; epoch 30 advanced and promoted; main green on all five checks;
                            `acceptance-evolution-bless.cjs --check` = MATCHES on main.
closure_status              OPEN — the merge and the epoch-30 ceremony are the remaining steps
research_value              The same defect appeared three times at three levels: a workflow's declared subject vs
                            the tree it measures, a helper's declared intent vs its effect, and a fixture's
                            declared fake vs the real executor it actually reached. Recorded as one class rather
                            than as three unrelated bugs.
```

---

## CC-009 — Epoch 30 finalization; the first ceremony run through the repaired, SHA-bound path

```text
ENTRY_ID                    CC-009
timestamp_utc               2026-09-24T07:28:32Z (run success) ; 2026-09-24T07:45Z (merged) ; recorded 07:52Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L2 (Owner environment approval) + L3 for the merge that preceded it (CC-008)
main_before                 09e68cd (docs corpus) -> 5c589e4 (the repair, unit RED)
main_after                  90c5e4832ba87cd48fa107625e31746bfad5b20b
branch                      trust-epoch/boss-root-trust-30
PR                          #29 (the repair, merged with the documented bypass) ; #30 (the epoch record)
workflow_run_ids            35969656991 (finalization, success) ; 35969635809 (Desktop CI on 5c589e4, unit FAIL)
                            ; 35971361792 (Desktop CI on 90c5e48, ALL FIVE GREEN)
checks_observed             ON PR #30: quality=pass, architecture=pass, unit=pass (9m19s), package=pass,
                            acceptance=pass (4m40s) — all five green
                            ON MAIN 90c5e48: architecture, quality, unit, package, acceptance = all success
problem                     The §9 provenance repair changes `scripts/trust-epoch-finalization-handoff.cjs`, which
                            is Root Trust Surface, so the surface aggregate moved
                            2abacb6f... -> f6e811d6... (74 files, no path added or removed) and epoch 29 stopped
                            anchoring it. Main was therefore correctly RED between the repair's merge and this
                            epoch's promotion.
classification              R2 — city defect with understood repair (workbook §5); R3 for the PR-head red
                            (a gate that cannot be repaired by the branch it blocks).
normal_path                 Run the protected finalization ceremony for the new main SHA, promote the epoch
                            branch through a normal reviewed PR, merge when all five checks are green.
why_normal_path_was_not_used
                            The normal path WAS used for the epoch itself. What needed a decision was the REPAIR's
                            merge (CC-008, L3, unit only) — because an epoch cannot be advanced FOR a branch:
                            `--advance` is authorised only through the protected workflow, and that workflow is
                            `refs/heads/main`-only. The red was stated in PR #29's body before it was observed.
action_taken                - merged PR #29 with the documented L3 bypass after confirming that its ONLY red was
                              the expected `unit` epoch guard (270 passed, 1 failed: TRUST_EPOCH_ROOT_SURFACE_MISMATCH);
                            - dispatched epoch 30 through the NEW helper `scripts/trust-epoch-dispatch.cjs
                              --confirm`, so the dispatch itself printed the exact argv and refused to run without
                              the confirmation, the reason, the risk and the rollback;
                            - approved deployment 6632502688 for run 35969656991;
                            - promoted the epoch record in PR #30, required ALL FIVE checks green, merged normally.
files_or_rules_changed      trust-policy/trust-epoch.json (epoch 30)
known_risk                  Expressed and bounded in CC-008; realised only as the intended red window, which
                            lasted from 07:26Z (merge) to ~07:45Z (epoch-30 merge).
evidence_preserved          Run 35969656991's log proving the new assertion ran LIVE: DISPATCH_SHA and
                            CHECKED_OUT_SHA both 5c589e4aa487313c4b8f44bd0682092ec1aac424, i.e. SHA-BOUND — the
                            first epoch finalized through the repaired path. PR #29 and #30 bodies. The epoch branch
                            at 0184008c3f97a29c72669b3cf86cf4258d70bb9c. Main CI run 35971361792.
rollback                    Repair forward. The epoch branch is never force-pushed, rebased or deleted.
temporary_debt_created      no
debt_id                     CITY-DEBT-001, -002 CLOSED with this entry; CITY-DEBT-004 remains CONTAINED
exit_condition              Epoch 30 on main; `acceptance-evolution-bless.cjs --check` = MATCHES; the five hosted
                            checks green on the resulting main SHA.
closure_status              CLOSED
research_value              THE LIVE PROOF OF THE REPAIR. The epoch-29 ceremony was approved under the old shape
                            (floating `main`); the epoch-30 ceremony ran under the new one and its own log states
                            that the checked-out commit equalled the dispatch SHA. Two consecutive ceremonies, one
                            before and one after the repair, with the same workflow file name — which is exactly the
                            kind of before/after pair the TOCTOU counterfactual predicted and no unit test could
                            produce.
```

---

## CC-010 — Main restored to all-five-green; the Owner directive's binding condition is met

```text
ENTRY_ID                    CC-010
timestamp_utc               2026-09-24T07:48Z (run success) ; recorded 07:52Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L0 (verification)
main_before                 5c589e4aa487313c4b8f44bd0682092ec1aac424  (unit RED)
main_after                  90c5e4832ba87cd48fa107625e31746bfad5b20b  (ALL FIVE GREEN)
branch                      main
PR                          #27, #28, #29, #30
workflow_run_ids            35971361792  Desktop CI on 90c5e4832ba87cd48fa107625e31746bfad5b20b
checks_observed             architecture = success
                            quality      = success
                            unit         = success
                            package      = success
                            acceptance   = success
problem                     The Owner directive for this programme states that the final acceptance condition is
                            that the submitted cloud branch CI must be ALL GREEN. Before this entry, main had been
                            red since PR #26 (epoch 28 stale), and two of the five checks had been SKIPPED rather
                            than passing on every commit in between.
classification              Verification of a binding acceptance condition (not a defect)
normal_path                 Read the hosted checks on the final main SHA; confirm locally that the committed epoch
                            anchors the live surface and the tree is clean.
why_normal_path_was_not_used
                            Not applicable — this is the normal path.
action_taken                Verified from GitHub that run 35971361792 reports all five jobs `success` on
                            90c5e4832ba87cd48fa107625e31746bfad5b20b; verified locally on a clean checkout of that
                            SHA that `acceptance-evolution-bless.cjs --check` reports
                            "epoch 30 (boss-root-trust-30) MATCHES the live surface" (74 files, aggregate
                            f6e811d6...); verified `git status` is clean.
files_or_rules_changed      none
known_risk                  "All green" is a property of ONE SHA. Any later commit must re-earn it; this entry
                            does not transfer.
evidence_preserved          Run 35971361792 (conclusion success, five jobs success); the local `--check` output;
                            root trust surface 74 files / aggregate f6e811d6...
rollback                    n/a
temporary_debt_created      no
debt_id                     -
exit_condition              n/a — satisfied
closure_status              CLOSED
research_value              A red that persisted across four merges (PR #26's epoch staleness through PR #29's
                            surface move) was cleared by one governed ceremony plus one reviewed promotion, with no
                            test, threshold or baseline weakened, and with every intermediate red classified and
                            preserved.
```

---

## CC-011 — Stage E: S3 ruleset activation — `architecture` becomes a required status check

```text
ENTRY_ID                    CC-011
timestamp_utc               2026-09-24T08:24:14Z (ruleset write) ; 08:33Z (merged) ; recorded 08:40Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L5 (Owner direct governance write — a ruleset edit), plus a normal L0 merge
main_before                 476388bd90a11f460f3afcee8781d9fc4ff1c699
main_after                  e121d84 (Merge pull request #32)
branch                      governance/s3-architecture-required
PR                          #32
workflow_run_ids            35975193561 and 35975223095 (Desktop CI on the PR head, both all-five green)
checks_observed             quality=pass, architecture=pass, unit=pass, package=pass, acceptance=pass
problem                     The hosted architecture enforcer has been emitted since S1 and run in the real
                            governing mode since S2, but was deliberately NOT required: workbook §12 / spec S3.
                            Until it is required, the enforcement is visible policy advice rather than
                            enforcement, and the workbook's completion definition ("architecture is a required
                            status check") cannot hold.
classification              R3 resolved as a governance act (workbook §5/§12), not a defect
normal_path                 Owner edits `Main-Protection` so required status checks become quality, unit,
                            acceptance, package, architecture, pinned to the GitHub Actions integration id
                            15368, with strict policy preserved; then the repository-side records are updated to
                            agree.
why_normal_path_was_not_used
                            Not applicable — this IS the normal path, performed by the delegated executor under
                            the workbook's construction lease (§0, §12).
action_taken                RULESET (the platform fact):
                              snapshot before: sha256 6377b2ab… of the read, updated_at
                                2026-09-19T18:08:25.639+10:00, 4 contexts
                              PUT /rulesets/22746755 with the full rule array, adding context `architecture`
                                (integration_id 15368)
                              read back after: sha256 04ee3b51…, updated_at 2026-09-24T18:24:14.722+10:00,
                                5 contexts, strict=true, rules set unchanged
                                 (deletion, non_fast_forward, creation, required_status_checks, pull_request),
                                bypass_actors unchanged (Owner only, bypass_mode always)
                            REPOSITORY (PR #32), so the three records cannot drift:
                              src/shared/promotion-checks.ts: REQUIRED_PROMOTION_CHECKS gains "architecture"
                              .github/CODEOWNERS: the contract line names all five, with the reason recorded
                              three test cases INVERTED rather than deleted:
                                tests/unit/promotion-gate.test.ts
                                tests/unit/city/architecture-hosted-shadow.test.ts (H7 + the job-identity case)
                                tests/unit/city/architecture-s2-hosted-enforce.test.ts (1/12)
files_or_rules_changed      PLATFORM: Main-Protection ruleset id 22746755 (one context added; nothing else)
                            REPO: src/shared/promotion-checks.ts, .github/CODEOWNERS, the three test files above
known_risk                  Adding a required context can block every future merge if the check is unreliable.
                            Bounded by the S1/S2 evidence trail: the check has been emitted on every push and
                            pull_request since S1 with no paths/branches filter, no `if:`, no `needs:`, and its
                            parity (ENF-12) and engine-error behaviour are pinned by tests. A required check that
                            could vanish is the specific failure mode guarded against: nothing gates on it.
evidence_preserved          Both ruleset reads (before/after JSON, sha256 6377b2ab… and 04ee3b51…) preserved out
                            of band; the live-probe line measured after the write
                            (H7_LIVE_RULESET = LIVE_MEASURED ruleset_id=22746755
                             required=quality,unit,acceptance,package,architecture architecture_required=true
                             elapsed_ms=644); PR #32 body with the same before/after table.
rollback                    Remove the `architecture` context from the ruleset (a second L5 act) AND revert
                            PR #32. Both are needed: reverting only the repository side leaves the three records
                            disagreeing; reverting only the ruleset leaves the declaration and CODEOWNERS
                            claiming a requirement the platform no longer imposes. That drift is now itself
                            caught by tests, which is why the activation is durable.
temporary_debt_created      no — the ruleset was changed once, to its intended final state; no relaxation was
                            made and none remains
debt_id                     -
exit_condition              architecture is required; architecture is emitted by the workflow; the integration id
                            matches; strict mode remains enabled; no required check was removed; the legacy
                            ratchet still runs in the required quality job; the bypass actor set did not expand;
                            and a benign PR proves a normal green architecture check satisfies the context.
closure_status              CLOSED — verified by the read-back above and by PR #32 merging with all five green
research_value              The interesting part is not the edit but the GUARDS: three test cases existed whose
                            whole purpose was to assert "emitted but NOT required", and they were correct for
                            two stages. Activating the gate therefore required INVERTING them rather than
                            deleting them — so the activation cannot be silently reverted by an ordinary code
                            change, and the invariant that a workflow cannot make a check required survives the
                            transition.
```

---

## CC-012 — Stage F: S4 decision recorded — `RETAIN_LEGACY_RATCHET`

```text
ENTRY_ID                    CC-012
timestamp_utc               2026-09-24T08:40Z
executor                    Hns (temporary Owner-authorised City construction executor)
authority_level             L0 (an explicit decision, recorded; no gate crossed)
main_before                 e121d84 (Merge pull request #32)
main_after                  e121d84 (unchanged by this entry)
branch                      docs/s3-activation-and-s4-decision
PR                          (this record's PR)
workflow_run_ids            -
checks_observed             -
problem                     Stage S4 requires a decision: retire `pnpm run architecture:ratchet` from the
                            required `quality` job, or keep it and record the decision not to. The Phase 1B
                            specification permits retirement only when all four H5 conditions hold.
classification              Explicit S4 Owner decision (workbook §13) — NOT debt, NOT a failure, NOT unfinished
                            work
normal_path                 Measure H5's four conditions against the live repository and record the decision.
why_normal_path_was_not_used
                            Not applicable — this is the normal path.
action_taken                Measured H5 and recorded RETAIN_LEGACY_RATCHET in
                            docs/city/PHASE1B_S4_LEGACY_RATCHET_DECISION.md, with the failing condition named:
                            the 30-consecutive-promotion-merge window has progress 0 of 30, because the S3
                            activation is live only from 476388b onward. Condition 2 (a class-by-class superset
                            mapping with a named proof per legacy detection class) is also unmet. The workbook's
                            own instruction — "Do not create meaningless PRs merely to satisfy this number" —
                            rules out manufacturing the window, so the ratchet is retained.
files_or_rules_changed      docs/city/PHASE1B_S4_LEGACY_RATCHET_DECISION.md (new)
known_risk                  A retained redundant gate costs a step in the required `quality` job, and a future
                            reader could mistake the retention for an oversight. Mitigated by the decision
                            document stating the four conditions that would change it, and by this entry.
evidence_preserved          The H5 condition table with the measured value per condition; the Phase 1B spec
                            line 166 (the "or keep it and record the decision not to" alternative); the S3
                            activation timestamp that starts the window.
rollback                    A later Owner act may retire the ratchet once H5 holds, with its own evidence
                            record, taken separately from any activation (H5 condition 4).
temporary_debt_created      NO — deliberately. This is a decision, not a compromise, and it must never appear
                            in the debt register.
debt_id                     -
exit_condition              n/a — the decision is the deliverable
closure_status              CLOSED
research_value              A specification that offers "do it, or record why not" is only honest if the second
                            branch is used when the evidence is absent. The measurable content here is that the
                            window's progress is 0 of 30, not "not yet enough": the number cannot move until the
                            gate it depends on has been required for a while, so the decision is forced rather
                            than chosen.
```

---

## Stage status at CC-012

```text
WORKBOOK STAGE                                        STATE
§4   cloud audit corpus                               LANDED (PR #28)
§8   epoch 29 closed and promoted                     DONE (PR #27, all five checks green)
§9   trust-finalization provenance repair (B1/B2/B3)  LANDED (PR #29) — proven live by CC-009
§9   Root Trust handling (B4)                         DONE — epoch 30 (PR #30)
§12  S3 ruleset activation (Stage E)                  DONE (PR #32, ruleset id 22746755, 5 contexts)
§13  S4 decision: RETAIN_LEGACY_RATCHET (Stage F)     DONE (CC-012 + decision document)
§14  Phase 2 spec + frozen starting measurement       LANDED (frozen at 5ade1cd)
§10  hosted negative control + evidence tag           NOT STARTED
§11  S2 exit certification                            NOT STARTED
§15-§23 Phase 2 P2-A .. P2-I                          NOT STARTED (spec, acceptance and two analyses ready)
§30  final acceptance suite                           NOT REACHED
§31  final debt review                                NOT REACHED (0 OPEN / 0 CONTAINED today)
§32  final governance restoration                     NOT REACHED
```

Note on §11: S2 exit certification is NOT STARTED and is deliberately not claimed. The workbook makes S2 exit
conditional on the hosted negative control (§10), which has not been run. The S3 activation landed first because
the workbook treats it as an independent governance act (§12) — but that ordering does not certify S2, and this
table says so.

---

## Stage status at CC-010 (superseded by CC-012, retained for the history)

```text
WORKBOOK STAGE                                        STATE
§4   cloud audit corpus                               LANDED (PR #28)
§8   epoch 29 closed and promoted                     DONE (PR #27, all five checks green)
§9   trust-finalization provenance repair (B1)        LANDED (PR #29) — proven live by CC-009
§9   dispatch-helper hardening (B2)                   LANDED (PR #29)
§9   TOCTOU counterfactual (B3)                       LANDED (PR #29, 14 cases)
§9   Root Trust handling (B4)                         DONE — epoch 30 (PR #30)
§14  Phase 2 spec + frozen starting measurement       LANDED (PR #28, frozen at 5ade1cd)
§10  hosted negative control + evidence tag           NOT STARTED
§11  S2 exit certification                            NOT STARTED
§12  S3 ruleset activation                            NOT STARTED
§13  S4 RETAIN_LEGACY_RATCHET decision                NOT STARTED
§15-§23 Phase 2 P2-A .. P2-I                          NOT STARTED (spec and acceptance landed)
§30  final acceptance suite                           NOT REACHED
§31  final debt review                                NOT REACHED (CITY-DEBT-004 CONTAINED)
§32  final governance restoration                     NOT REACHED
```

---

## Pending entries (will be appended as the stages complete)

The following workbook stages are known to be outstanding. Each will produce its own entry; none is claimed as
done here:

```text
CC-006  epoch 29 promoted and merged (workbook §8 A4/A5)                          -> CLOSED
CC-007  four spurious finalization dispatches, cancelled                          -> recorded
CC-008  trust-finalization provenance repair, dispatch helper, TOCTOU test         -> CLOSED (PR #29)
CC-009  epoch 30 finalization; first SHA-bound ceremony; main restored             -> CLOSED
CC-010  all-five-green verified on main 90c5e48                                    -> CLOSED
CC-0xx  docs/city audit corpus merged (workbook §4)                               -> DONE (PR #28)
CC-0xx  hosted negative control + evidence tag (§10)
CC-0xx  S2 exit certification (§11)
CC-0xx  S3 ruleset activation — architecture becomes required (§12)
CC-0xx  S4 decision recorded: RETAIN_LEGACY_RATCHET (§13)
CC-0xx  Phase 2 P2-A truthful capability map and closure validator (§15)
CC-0xx  Phase 2 P2-B..P2-I (§16-§23)
CC-0xx  final acceptance suite green on the final main SHA (§30)
CC-0xx  final debt review, all debt CLOSED or ACCEPTED_PERMANENT (§31)
CC-0xx  final governance restoration (§32)
CC-0xx  OWNER_CONTINUOUS_CONSTRUCTION = CLOSED (§32)
```

**Status of this ledger:** OPEN — construction in progress. This ledger is closed only at final seal.
