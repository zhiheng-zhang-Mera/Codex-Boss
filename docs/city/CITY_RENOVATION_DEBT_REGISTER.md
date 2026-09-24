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

**Not debt:** the retained legacy ratchet. Workbook §13 records `RETAIN_LEGACY_RATCHET` as an explicit S4
Owner decision permitted by the Phase 1B specification because the organic H5 window (30 real promotion merges
after `architecture` is required) has not been earned. It must never be represented as renovation debt or as a
failure.

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
latest_review        2026-09-24T06:20Z — defect confirmed from run 35961897353 and the workbook §9 B2 requirement.
status               OPEN
closure_evidence     (pending)
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
latest_review        2026-09-24T06:25Z — reproduced by reading the workflow's checkout step and confirmed
                     against workbook §1 and §9.
status               OPEN
closure_evidence     (pending)
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
latest_review        2026-09-24T06:24Z — failing job 107512217870 fetched; assertion text and both surface
                     hashes recorded in ledger CC-004.
status               OPEN (repair in flight)
closure_evidence     (pending)
```

---

## Register summary

```text
CITY-DEBT-001  dispatch helper can dispatch without --confirm                  OPEN
CITY-DEBT-002  finalization checkout is floating main, not the dispatch SHA    OPEN
CITY-DEBT-003  main CI red from the stale epoch 28 anchor                      OPEN (repair in flight)
```

```text
OPEN              3
CONTAINED         0
CLOSED            0
ACCEPTED_PERMANENT 0
```

**Status of this register:** OPEN — final seal requires zero OPEN and zero CONTAINED entries (workbook §31).
