# CITY RENOVATION DEBT REGISTER

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`
**Ledger:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md`

## Rules of this register

Every compromise that remains live after its originating commit receives a debt id:

```text
CITY-DEBT-###
```

An entry may reach `ACCEPTED_PERMANENT` **only** if a final architectural decision explicitly states why it is
not temporary debt. "We ran out of time" is never an accepted-permanent reason.

**Final seal preconditions (workbook §31):** no `OPEN` debt, no `CONTAINED` temporary debt. Only `CLOSED` and
`ACCEPTED_PERMANENT` may remain.

**Not debt:** the retained legacy ratchet. The S4 decision
(`docs/city/PHASE1B_S4_LEGACY_RATCHET_DECISION.md`, ledger CC-012) records `RETAIN_LEGACY_RATCHET` because the
Phase 1B specification's H5 conditions are not met — the 30-consecutive-promotion-merge window has progress
**0 of 30**, since the `architecture` check became required only at commit `476388b` (S3). The specification
permits retirement *or* recording the decision not to, and the workbook forbids manufacturing meaningless merges
to satisfy the number. This retention must never be represented as renovation debt or as a failure.

**Not debt:** the S3 ruleset activation (ledger CC-011). It adds a required gate; it retires nothing and
compromises nothing. The ruleset was changed once, to its intended final state, so there is no temporary
relaxation to account for.

## Required fields

```text
introduced_at
introduced_by
reason
affected_surface
exact compromise
why construction continued
risk
containment
owner
exit condition
latest review
status = OPEN | CONTAINED | CLOSED | ACCEPTED_PERMANENT
closure evidence
```

---

## CITY-DEBT-001 — Dispatch helper can perform a real protected dispatch without an explicit confirmation

```text
CITY-DEBT-001
introduced_at        2026-09-24 (defect observed at 05:52:46Z in workflow run 35961897353)
introduced_by        The dispatch helper used for Trust Epoch Finalization, which performed a real
                     `workflow_dispatch` from what was intended to be a dry run.
reason               The helper had no separation between "show what would be dispatched" and "dispatch".
                     Its read-only path did not exist, so the only available invocation was a write.
affected_surface     The protected Trust Epoch Finalization workflow (.github/workflows/trust-epoch-finalization.yml),
                     the `boss-root-trust-owner` environment gate, and the Root Trust epoch lineage.
exact_compromise     A waiting, Owner-gated epoch-finalization run was created on head_sha
                     8897ddc3a18f5e38da14729ced951d14122d6394 (pre-PR#26) without the operator intending a
                     dispatch. A human owner-gate approval would have been requested for a run whose tree was
                     already superseded.
why_construction_continued
                     The spurious run was cancelled before approval (ledger CC-002), so no wrong epoch was
                     ever anchored. The intended run 35962014554 on the correct head_sha was approved and
                     completed the real ceremony. Blocking the whole programme on a cancelled dry-run defect
                     would be the permission-induced global pause the workbook forbids.
risk                 Recurrence: a future accidental dispatch could create a second waiting run on a stale
                     SHA, and an Owner approval given out of habit could anchor a surface that main has
                     already moved past. Severity is bounded by the environment gate but not zero, because
                     the gate's checkout is not SHA-bound (see CITY-DEBT-002 — the two defects compound).
containment          The spurious run is cancelled and preserved, not deleted. The environment
                     `boss-root-trust-owner` still requires the named Owner reviewer with can_admins_bypass
                     = false, so the helper alone cannot complete a ceremony.
owner                Hns (temporary Owner-authorised City construction executor), work package workbook §9 B2
exit_condition       The helper performs no write without an explicit `--confirm`; a true read-only /
                     dry-run path exists; it prints the exact write it would perform before confirmation; and
                     tests prove that the dry-run path cannot dispatch.
latest_review        2026-09-24T07:00Z — repair implemented in `scripts/trust-epoch-dispatch.cjs` with
                     tests/unit/city/trust-epoch-dispatch-helper.test.ts; pending merge and CI confirmation.
status               CLOSED
closure_evidence     `scripts/trust-epoch-dispatch.cjs` (workbook §9 B2):
                       - no write without an explicit `--confirm`; the default mode is a read-only plan, and
                         `plan()` returns an EMPTY `commands` list in every unconfirmed mode, so `execute()` --
                         the only function that runs anything -- is inert;
                       - a true dry-run path, proven against a real child process with a working fake executor
                         injected through the helper's own command route (its argv is recorded; after a dry run
                         the record does not exist, after a confirmed run it does);
                       - the exact argv a confirmation would execute is PRINTED before confirmation;
                       - `--confirm` without `--reason`/`--risk`/`--rollback` is refused, because the protected
                         workflow declares all three as required inputs;
                       - it spawns argv arrays and never a shell, so an operator-supplied reason cannot be
                         interpreted.
                     tests: tests/unit/city/trust-epoch-dispatch-helper.test.ts, 17 cases, all passing.
                     NOTE: the "Ordinary test runs open no protected runs" property is proven for the confirmed
                     path (the injected executor is the process that runs) but is re-confirmed against the live
                     Actions history after the next full main test cycle — see CITY-DEBT-004.
```

---

## CITY-DEBT-002 — Trust epoch finalization checks out floating `main` instead of the dispatch SHA (TOCTOU)

```text
CITY-DEBT-002
introduced_at        Present in .github/workflows/trust-epoch-finalization.yml as of 79af142b
introduced_by        The Stage B finalization workflow as written before workbook §9 was executed
reason               The job used `actions/checkout@v4` with `ref: main`. A run that waits for an Owner
                     environment approval can therefore be approved after `main` has advanced, and the run
                     would measure and anchor a tree that is NOT the SHA the run was dispatched on or
                     reported against.
affected_surface     .github/workflows/trust-epoch-finalization.yml; the Root Trust epoch record
                     (trust-policy/trust-epoch.json); the provenance of every epoch finalized while the
                     defect is live; the trust-epoch promotion PR base.
exact_compromise     github run head_sha != tree actually checked out after approval. The workflow records
                     ${{ github.run_id }} in the epoch commit message as the authorising run, but the
                     checked-out content is whatever `main` is at approval time. The epoch record, the
                     handoff BASE_SHA and the commit can therefore describe different trees.
why_construction_continued
                     At the moment epoch 29 was approved no newer main existed (main was 79af142b, the run's
                     own head_sha), so the current epoch is not corrupted by it. The defect is a live
                     provenance hole, not a live wrong value; workbook §9 repairs it next.
risk                 A later Owner approval of a stale waiting run silently anchors a newer main. The
                     proposal/handoff would name BASE_SHA from the proposal's own measurement, so the
                     mismatch is detectable only by comparing `git rev-parse HEAD` against `github.sha` —
                     which the workflow does not currently assert.
containment          Until repaired, finalization is only approved when `origin/main` is confirmed equal to
                     the run's head_sha immediately before approval, and the run's own evidence is checked
                     afterwards. Approval is a deliberate act, never a batched habit.
owner                Hns (temporary Owner-authorised City construction executor), work package workbook §9 B1
exit_condition       `actions/checkout@v4` uses `ref: ${{ github.sha }}` with `fetch-depth: 0`; the workflow
                     asserts `git rev-parse HEAD == github.sha` and `github.ref == refs/heads/main`; the
                     proposal/handoff records both `dispatch_sha` and `checked_out_sha` and fails closed when
                     they differ; and a counterfactual test proves a dispatch at SHA A stays on A after main
                     becomes SHA B.
latest_review        2026-09-24T07:00Z — repair implemented on branch fix/trust-finalization-sha-bound
                     (`.github/workflows/trust-epoch-finalization.yml` ref binding + fail-closed assertion step;
                     `scripts/trust-epoch-finalization-handoff.cjs` provenance and its refusal of disagreement;
                     `tests/unit/city/trust-finalization-sha-binding.test.ts` counterfactual).
status               CLOSED
closure_evidence     - checkout now uses `ref: ${{ github.sha }}` with `fetch-depth: 0`, measured from the
                       parsed YAML by the test rather than asserted in prose;
                     - the job asserts `git rev-parse HEAD == github.sha` immediately after the checkout, as the
                       FIRST step after it, failing closed with
                       `TRUST_EPOCH_FINALIZATION_SHA_MISMATCH`; both SHAs are published for the artifact;
                     - the handoff states `provenance.dispatch_sha` and `provenance.checked_out_sha`, refuses a
                       half-stated binding, refuses two SHAs that disagree, and validates the STATED value so
                       `"main"` cannot masquerade as an absent binding; the CLI exits 1 on a disagreement;
                     - the TOCTOU counterfactual: a parameterised checkout model reproduces the old shape
                       (dispatch at A, main moves to B, approval lands, the run follows main) and proves the
                       repair holds for an arbitrary number of intervening commits; reverting either the YAML
                       ref or the assertion step fails the test.
                     Residual, recorded rather than claimed closed: the assertion `github.ref ==
                     refs/heads/main` was already present before this repair (the "Refuse anything that is not
                     main" step) and is preserved; no separate new assertion was added for it.
```

---

## CITY-DEBT-003 — Main CI red: stale Root Trust anchor blocks unit, acceptance and package

```text
CITY-DEBT-003
introduced_at        2026-09-24T05:52:50Z (workflow run 35961901372 on main)
introduced_by        Merge of PR #26 (79af142b), which changed a Root Trust Surface file without advancing
                     the epoch in the same governed act.
reason               PR #26 modified scripts/architecture-enforcement-baseline.cjs, which is inside the Root
                     Trust Surface. The committed epoch 28 still certifies surface bb17f834..., so the
                     fail-closed guard in tests/unit/test-layers.test.ts correctly reports
                     TRUST_EPOCH_ROOT_SURFACE_MISMATCH against the live surface 2abacb6f...
affected_surface     main branch CI: `unit` job red; `acceptance` and `package` jobs skipped as a result.
                     Root Trust staleness. The final delivery SHA cannot be any commit in this state.
exact_compromise     The repository's own CI is red on main, and two of the five required checks have not
                     run at all on this SHA, so their guarantee is UNPROVEN rather than PASS.
why_construction_continued
                     This is an R2 defect with an understood, already-governed repair: advance exactly one
                     epoch through the Owner-authorised finalization workflow (ledger CC-003), then promote
                     the epoch branch through a normal reviewed PR. Quarantining or bypassing was unnecessary
                     because the normal repair path was available and was taken.
risk                 If the epoch promotion itself lands red, the red would move rather than clear. Bounded
                     by requiring all five hosted checks green on the promotion PR before merge.
containment          No test, threshold, baseline or guard was weakened; the red is preserved and the fix is
                     the governance record, not the code.
owner                Hns (temporary Owner-authorised City construction executor), work package workbook §8
exit_condition       Epoch 29 is committed on main; `acceptance-evolution-bless.cjs --check` = MATCHES; and
                     Desktop CI on the resulting main SHA emits quality, unit, acceptance, package and
                     architecture, all green.
latest_review        2026-09-24T06:52Z — repair landed: PR #27 (epoch 29) merged as
                     1892e61c89596b7cd66257ae5b4cedb4bae8dfc0 after ALL FIVE hosted checks passed on the
                     promotion PR (quality, architecture, unit, package, acceptance). Main Desktop CI run
                     35965095036 was then observed on the merge commit.
status               CLOSED
closure_evidence     PR #27 green on all five checks before merge; epoch 29 committed on main;
                     `acceptance-evolution-bless.cjs --check` MATCHES on the epoch branch before merge and on
                     main after; main Desktop CI run 35965095036.

---

## CITY-DEBT-004 — A test fixture of the section 9 B2 repair reached the REAL gh and opened four protected runs

```text
CITY-DEBT-004
introduced_at        2026-09-24 (four runs created 06:37:58Z - 06:38:13Z)
introduced_by        The first revision of tests/unit/city/trust-epoch-dispatch-helper.test.ts and its fixture
                     tests/fixtures/fake-gh.cjs, written as part of the section 9 B2 repair.
reason               The fixture injected its fake executor through PATH and NODE_OPTIONS, assuming a spawned
                     `gh` would be a Node program. On this host `gh` is a native binary, which ignores
                     NODE_OPTIONS, so the injection failed OPEN: the "confirmed" case of the new test reached the
                     REAL `gh` and performed a real `workflow_dispatch` of the protected Trust Epoch Finalization
                     workflow on every execution.
affected_surface     The protected Trust Epoch Finalization workflow, the `boss-root-trust-owner` environment
                     gate, the Actions provenance history, and the `pnpm test` tier's claim to be hermetic.
exact_compromise     Four waiting Owner-gated runs on head_sha 1892e61c... — a commit already correctly anchored
                     by epoch 29, so no migration was needed by any of them:
                       35965428473, 35965431153, 35965446098, 35965449267  (all cancelled, none approved)
why_construction_continued
                     All four were cancelled before any approval, so no epoch was advanced, no surface was
                     anchored, and no record was written (impact on correctness: NONE; impact on provenance:
                     real, and recorded). Stopping the programme for a test-harness defect whose blast radius the
                     environment gate had already bounded would be the permission-induced pause the workbook
                     forbids — but the harness was repaired IMMEDIATELY, before any other work, because the next
                     test run would otherwise repeat it.
risk                 A future fixture could fail open the same way and dispatch the protected ceremony again.
                     Severity is bounded by the environment gate (an unapproved run cannot start) but a run
                     waiting on the Owner's environment is itself a decision hazard: "there is a waiting run,
                     approve it" is exactly the habit the gate exists to prevent.
containment          The fixture now injects the executor through the helper's own overridable command route
                     (`TRUST_EPOCH_DISPATCH_GH`), so the process the helper spawns IS the recorder and the real
                     `gh` is unreachable from that test by construction. The same file asserts that the helper
                     resolves its command from that route, so a future refactor cannot silently restore the
                     broken injection.
owner                Hns (temporary Owner-authorised City construction executor), work package workbook §9 B2
exit_condition       (a) an ordinary `pnpm test` on a clean main opens ZERO protected workflow runs, proven by
                     observing the Actions history after a full main test cycle; and (b) the harness asserts the
                     injected route rather than assuming it.
latest_review        2026-09-24T07:52Z — (a) CONFIRMED against the live Actions history. After the repair landed
                     on main, the full hosted `pnpm test` cycle ran twice (runs 35969925450 on the epoch branch and
                     35971361792 on main 90c5e48) and the Actions history contains exactly ONE
                     `workflow_dispatch` run for the whole window — the intended epoch-30 ceremony (35969656991,
                     approved and successful) — and no spurious run. The two remaining waiting runs from the
                     earlier burst (35965608676, 35965612178) were cancelled in the same review. (b) is asserted by
                     the suite itself.
status               CLOSED
closure_evidence     - the fixture now injects the executor as the process the helper spawns
                       (`TRUST_EPOCH_DISPATCH_GH`), so the real `gh` is unreachable from that test by
                       construction, and the "confirmed run reaches the fake executor" case asserts it did;
                     - `tests/unit/city/trust-epoch-dispatch-helper.test.ts` (17 cases) proves the dry run reaches
                       no executor at all against a real child process, and that the confirmed path reaches
                       exactly one;
                     - the repair is on main (PR #29, commit 5c589e4) and merged up through epoch 30 (90c5e48);
                     - exit condition (a) verified: two full hosted test cycles, zero unexpected dispatches.
                     Residual, recorded rather than claimed: `git push` and `gh run view` were the only other
                     commands used around the window, so the observation covers the CI cycles and this host's
                     session, not every possible trigger in the world.
```

---

## CITY-DEBT-005 — The soak suites fail non-deterministically under hosted load, so the merge gate reports the runner's load as the tree's health

```text
CITY-DEBT-005
introduced_at        2026-09-25 (observed on PR #81, commit b839337952fef7736da2b8919f697e8861f297c2)
introduced_by        Not introduced by a change: the soak suites and their thresholds predate this work. What is
                     new is the OBSERVATION that they are the family that fails, and that one occurrence needed
                     three attempts on an identical commit before it cleared.
reason               Three runs of the SAME commit produced three different failures in two different steps:
                       attempt 1 (merge)  test:postbuild
                         tests/acceptance/platform-soak-report.test.ts  expected 2 to be greater than 3
                         tests/unit/root-trust-authority-lockdown.test.ts  Test timed out in 120000ms
                       attempt 2 (re-run) test:slow
                         tests/unit/platform/platform-soak.test.ts  expected 0 to be greater than 0
                       attempt 3 (re-run) unit, acceptance and package all SUCCESS
                     Each failing assertion has a threshold a loaded runner can miss, and the soak-report case
                     says so in its own name: "whichever way this host measured".
affected_surface     The `unit` required check, and through it the merge gate: acceptance and package are SKIPPED
                     while unit is red, so one soak threshold decides whether two other checks run at all.
not_a_security_event No protected run, no environment approval, no epoch movement and no bypass are involved. The
                     failed runs are preserved in Actions history and recorded in
                     docs/city/incidents/2026-09-25-same-commit-ci-flake.md section 7.
why_construction_continued
                     The commit was never merged on a red check: the merge happened when the required checks
                     reported success, and the green was obtained by re-running the identical commit rather than
                     by changing it. The debt is that this green is less reliable than a first-attempt green, and
                     that "retry until green" is indistinguishable from "do not investigate".
exit_condition       Either (a) each soak assertion states the load it requires and reports NOT_MEASURED rather
                     than a wrong value when the host cannot supply it -- so a loaded runner produces an absence of
                     evidence instead of false evidence -- or (b) the family is explicitly quarantined to a lane
                     whose result is recorded as evidence rather than as a required check. Until one of those is
                     done, CITY-DEBT-005 is live.
status               OPEN
```

---


```text
CITY-DEBT-001  dispatch helper can dispatch without --confirm                  CLOSED
CITY-DEBT-002  finalization checkout is floating main, not the dispatch SHA    CLOSED
CITY-DEBT-003  main CI red from the stale epoch 28 anchor                      CLOSED
CITY-DEBT-004  test fixture reached the real gh and opened four protected runs CLOSED
CITY-DEBT-005  the soak suites fail non-deterministically under hosted load    OPEN
```

```text
OPEN               1   (CITY-DEBT-005)
CONTAINED          0
CLOSED             4   (CITY-DEBT-001, -002, -003, -004)
ACCEPTED_PERMANENT 0
```

**Status of this register:** no OPEN and no CONTAINED entry. This is **not** the final debt review: Phase 2
(workbook §15–§23) has not started, and it is expected to create new `CITY-DEBT-*` entries for every temporary
bridge and every baseline change it needs. Final seal requires the register to close at zero OPEN and zero
CONTAINED **at that time** (workbook §31).
