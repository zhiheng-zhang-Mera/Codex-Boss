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
occurrence_ten       2026-09-25, PR #87: three failures across TWO runs of ONE commit, in THREE different tests,
                     two of them files this entry did not previously name:
                       run 1  test:postbuild (unit)  tests/unit/platform/durable-event-correctness.test.ts
                                                      "holds every property the 100k scale case holds, at 10k events"
                                                      Test timed out in 60000ms (the case ran 78.8s)
                       run 2  test:slow (unit)       tests/unit/platform/platform-soak.test.ts
                                                      "reports the resource trend, and does not claim a short run
                                                       proves bounded growth"  expected 2 to be greater than 2
                     A PARALLEL run of the same commit was 5/5 green, so this is the family rather than a change:
                     the failures were REPLACED, not reproduced -- the third time that signature has appeared, and
                     now across three files. The condition is therefore stated positively: an environmental budget
                     (a duration) or a host-supplied sample count is being read as a correctness verdict, inside
                     tests that each say in their own words that the quantity is not a property of the platform.
repairs_so_far       Four of the five observed instances are repaired under exit condition (a), named here so the
                     register does not have to be reconstructed from the ledger:
                       CC-055  tests/acceptance/platform-soak-report.test.ts  (the only one INSIDE the Root Trust
                               Surface: the epoch advanced 36 -> 37 in the same commit as the change)
                       CC-054  tests/unit/platform/platform-soak.test.ts      restart-safety (0 > 0)
                       CC-056  tests/unit/platform/platform-soak.test.ts      resource-trend (2 > 2)
                       CC-056  tests/unit/platform/durable-event-correctness.test.ts  60s budget -> 180s
                     Each replaces a host-dependent demand with either an unconditional safety assertion or an
                     explicit NOT_MEASURED absence, so a loaded runner produces an absence of evidence instead of
                     false evidence -- which is exit condition (a) literally.
outstanding_instance tests/unit/root-trust-authority-lockdown.test.ts, "holds no public real-host dispatch surface,
                     and uploads no corpus" -- Test timed out in 120000ms under load. It is NOT a soak assertion, so
                     exit condition (a) does not reach it as written: what is needed is a recorded decision about
                     whether that check's work is too large for the required `unit` lane, which changes what the
                     check proves. Until that decision exists, this entry stays OPEN.
                     REPAIRED (CC-080): the decision was recorded and acted on rather than the budget raised a second
                     time. That case used to read and parse every workflow TWICE -- once for the `runs-on` loop and
                     again for the corpus-upload loop -- so its cost was a property of the repository's workflow set
                     and grew with every workflow added, which is why the group budget had gone 60s -> 120s and
                     still timed out. It now parses once into a map and reads the document from there, and the
                     120s budget is left where it was. The file states this in its own comment: "the fix for a cost
                     that grows with the repository is to do the work once, not to buy more time for doing it
                     twice; raising the budget a second time would have repeated the family's own mistake."
status               CLOSED (CC-080) under exit condition (a), by SWEEPING the family rather than by fixing a list.
                     The register's own `enumeration_is_illustrative` field set the bar: the debt is the positive
                     condition -- "an environmental budget or a host-supplied count read as a correctness verdict"
                     -- and the named instances are examples of it, so closing it required re-reading every such
                     assertion in the soak and lifecycle families against that condition. That sweep was performed
                     and found ONE remaining live site, which is the LAST repair below.
occurrence_twelve   2026-09-27, PR #115 (the CC-079 flatness change, which touches no soak file) -- a SEVENTH
                     instance, and the one that finally closed the entry by being repaired rather than retried:
                       run 36298116240  test:slow  tests/unit/platform/platform-soak.test.ts
                                                     "exercises every stage the book names, without intervention"
                                                     AssertionError: expected 3 to be greater than 5
                     A parallel run of the identical commit was green, and the change under test was a
                     configuration registry that this suite does not read. This is occurrence eleven's sibling in
                     the same case, one assertion further down: `expect(result.samples.length).toBeGreaterThan(5)`.
last_repair          tests/unit/platform/platform-soak.test.ts, "exercises every stage the book names, without
                     intervention" -- `samples.length > 5` became a `> 1` floor plus a NOT_MEASURED report, which
                     is the shape the OTHER THREE sites in this same file and tier already use for this exact
                     condition: `cycles > 5` above it, `steady.length > 2` below it, and
                     tests/acceptance/platform-soak-report.test.ts's `report.samples > 3`. The floor is `> 1`
                     because that file already settled on exactly that number for exactly this quantity ("a report
                     carrying N sample(s) is not a soak run"), so the two tiers now agree rather than each
                     inventing a threshold. Measured context for why the count is a host measurement: the case
                     asks for a 25 ms interval over a 5 s run, which is ~200 samples if the sampler were
                     time-driven, and a loaded runner produced THREE -- the sampler advances between cycles and a
                     cycle is the costly unit. Nothing that is a property of the platform was relaxed: no
                     allowance, bound or ceiling moved, and the trend case below still refuses to compute a slope
                     from fewer than three steady points.
sweep                Every expectation in the soak and lifecycle families that reads a host-supplied quantity was
                     re-read against the positive condition. The families are platform-soak.test.ts,
                     platform-soak-report.test.ts, soak.test.ts, host-soak-harness.test.ts, data-lifecycle-report
                     .test.ts, session-lifecycle.test.ts, knowledge-lifecycle.test.ts, context-lifecycle.test.ts
                     and replacement-lifecycle.test.ts. Findings: (1) ONE live site, repaired above. (2) Every
                     remaining host-quantity assertion in platform-soak.test.ts either carries a NOT_MEASURED guard
                     already or asserts a property of the run rather than of the host --
                     `elapsedMs >= auditSeconds * 1000` is a property of the SOAK CONTRACT (the runner is asked for
                     a duration and must serve it), and `recoveredTransactions === cycles` is an identity between
                     two measured totals, not a threshold. (3)
                     tests/unit/host-soak-harness.test.ts asserts against SYNTHETIC sample arrays built inside the
                     case, so it is deterministic by construction and cannot be host-sensitive. (4)
                     tests/acceptance/platform-soak-report.test.ts still contains one `expect(report.samples)
                     .toBeGreaterThan(3)` in the report-SHAPE case, and it is deliberately left: that case runs a
                     fixed `--minutes 0.25 --interval 250`, which is fifteen seconds at four samples per second,
                     so ~60 samples are produced by the interval and not by the host. The sibling case that DID
                     fail on a loaded runner already carries both the weaker floor and the NOT_MEASURED report.
enumeration_is_illustrative
                     The six instances above and this seventh are examples, not the debt. The debt is the
                     condition stated in occurrence_ten: an environmental budget or a host-supplied count read
                     as a correctness verdict. It was CLOSED on the `sweep` field above -- and that closure was
                     INCOMPLETE, see occurrence_thirteen.
occurrence_thirteen  2026-09-27, PR #135 (a DOCS-ONLY change that no soak file reads) -- a SEVENTH instance in the
                     same file the sweep had already repaired twice, and the one that shows the sweep was not
                     thorough:
                       run 36325568489  test:slow  tests/unit/platform/platform-soak.test.ts
                                                     "exercises every stage the book names, without intervention"
                                                     AssertionError: expected 1000 to be greater than 1000
                     `expect(result.totals.stateWrites).toBeGreaterThan(1_000)` and the identical assertion on
                     `eventsAppended` are PER-CYCLE counts inside a fixed wall-clock budget, so they scale with
                     how many cycles the host finished -- the same condition as `cycles` and `samples.length`
                     above, in the same case, six lines below a repair. The CC-080 sweep looked for
                     host-supplied counts and named this assertion's siblings but MISSED these two, so the
                     closure's claim that the condition had been swept was too strong.
                     REPAIRED: both floors are now 1 (work of that kind happened at all, which is the
                     stage-coverage property the case is named for) with a NOT_MEASURED report above 1000, the
                     same shape as every other repair in this entry. No allowance, bound or ceiling moved.
                     LESSON RECORDED: the sweep was performed by reading assertions for the CONDITION, and a
                     numeric floor of 1000 does not look like a host count until a host supplies exactly 1000.
                     The durable fix is that the condition is now stated in the file at the repaired site, so
                     the next reader meets the reasoning rather than the number.
status_correction    The `status` field above says CLOSED by sweep. That remains the right STATUS -- the
                     condition is now repaired everywhere it was found, twice over -- but the EVIDENCE for it
                     was weaker than claimed, and occurrence_thirteen is the counter-example. A future sweep of
                     this family should search for numeric thresholds on per-cycle totals, not for the phrase
                     "host", because the assertions that fail are written as ordinary floors.
enumeration_is_illustrative_v2
                     The condition, not the list, is still the debt: an environmental budget or a host-supplied
                     count read as a correctness verdict. Thirteen occurrences have now been found in the soak
                     and lifecycle families, and every one was repaired by the same shape -- a positive floor
                     that asserts the stage happened, plus a NOT_MEASURED report for the magnitude.
occurrence_eleven   2026-09-25, PR #88 (docs-only) -- a SIXTH instance appeared while this entry was being
                     rewritten, in a file already repaired twice:
                       run 36186092756  test:slow  tests/unit/platform/platform-soak.test.ts
                                                      "exercises every stage the book names, without intervention"
                                                      AssertionError: expected 3 to be greater than 5
                     A parallel run of the identical commit was 5/5 green again, and the change under test was
                     documentation that no test reads. This is the strongest evidence in this entry that the
                     enumeration above is ILLUSTRATIVE and not the family: the register was made accurate and
                     went stale within the same round, which is precisely why the condition is now stated
                     positively rather than as a list of assertions. A future reader should treat the positive
                     statement as the debt and the list as examples of it.
                     The repair is the same shape as CC-056's: `cycles > 5` is a host-supplied count inside a
                     test about which STAGES ran, not how many cycles a loaded runner could fit into the run.
enumeration_is_illustrative_closure
                     The five instances above and the sixth and seventh are examples, not the debt. The debt is the
                     condition stated in occurrence_ten: an environmental budget or a host-supplied count read
                     as a correctness verdict. Closing it required either every such assertion in the soak and
                     lifecycle families to be re-read against that condition -- which is a sweep of the family,
                     not a list of fixes -- or the quarantine in exit condition (b). THE SWEEP WAS DONE (CC-080),
                     which is why this entry is CLOSED: see `sweep` above for the families read, the one live
                     site it found, and the four findings that decided the rest were not host-sensitive. The
                     quarantine was NOT taken, because the sweep produced a repair for the only remaining site.
occurrence_fourteen  2026-09-27, main@bf45476bb111602efe0c1811bf86d1b9aaf0da18 (workflow run 36331698636, job
                     `unit`, step `pnpm run test:slow`) -- an EIGHTH instance, and the one that took the tracked
                     main red:
                       tests/unit/platform/platform-soak.test.ts
                       "distinguishes a recovered provider from a crash loop"  (line 325)
                       AssertionError: a provider degraded and no circuit ever recovered:
                                       expected 0 to be greater than 0
                     The same commit's `pnpm test` (the default tier, 283 files / 3668 tests) and its
                     `test:postbuild` were GREEN; the red is only in `test:slow`, which runs this file under
                     five-way parallel load. The predicate was the sibling of the two occurrence_thirteen
                     repairs: it read `degradedProviders > 0` as an observation of a crash loop, but the engine
                     records the recovery on the cycle AFTER the degradation (`failing = cycle % 3 === 0`, and
                     the recovery at `cycle % 3 === 1`), so a run whose wall-clock budget expires on a
                     degradation cycle reports `degradedProviders > 0` with `recoveredCircuits = 0` and has
                     observed nothing.
                     MEASURED on the construction host: a 300 ms budget produced exactly that signature
                     (`cycles = 3`, sequence `1:d0/r0/c0 2:d0/r0/c0 3:d1/r0/c0`, `degraded=1 recoveredProviders=0
                     recoveredCircuits=0 opens={"alpha":1}`), and a 400 ms budget produced the next cycle
                     (`4:d0/r1/c1`) with both counters. So the signature locates the run precisely:
                     `recoveredCircuits = 0` WITH `degradedProviders > 0` is possible ONLY when the last
                     completed cycle is the first degradation cycle.
                     REPAIRED (CC-103 section 1): the recovery claim is now derived from the per-cycle sequence
                     -- measurable only when a degradation cycle exists AND at least one later cycle completed --
                     and reported NOT_MEASURED otherwise. Both sites in the file call ONE helper
                     (`recoveryObservationWindow`), so the predicate is not duplicated beside the test. An
                     opportunity that existed and produced no recovery still FAILS, and the independent
                     `reported unrecovered opens <= 1` assertion is unchanged.
sweep_claim_correction
                     The `sweep` field above and `enumeration_is_illustrative_closure` claimed the CC-080 sweep
                     had found this family. occurrence_thirteen showed it had not, and occurrence_fourteen is a
                     second counter-example measured on main. The sweep's stated search was for an assertion
                     reading a host-supplied COUNT; this one read a host-supplied count of CYCLES to decide
                     whether an OBSERVATION had happened at all, which is the same condition one level up.
                     CORRECTED: the CC-080 sweep was NOT exhaustive, and this entry's closure rests on the
                     condition being repaired everywhere it has been FOUND -- four times in this one file -- not
                     on a proof that no site remained. No further repository-wide archaeology is performed
                     (CC-103 section 1 forbids it); the counter-example is recorded here instead. The `status`
                     field is unchanged: the condition is repaired at every known site.
```

---


```text
CITY-DEBT-006
introduced_at        2026-09-26 (observed on PR #96, commit d3c05c8, job 108317260596)
introduced_by        Not introduced by a change: the desktop smoke suite and its readiness waits predate this
                     work, and the PR under test modified one test file in tests/unit that the desktop suite does
                     not load. What is new is the OBSERVATION that a SECOND, unrelated family can take a required
                     check down, and that its failure mode is a restarted application rather than a loaded runner.
reason               The `acceptance` job runs `acceptance:desktop-workbook`, which launches the real Electron
                     application. One run of the commit failed:
                       [desktop-smoke] FAIL the restarted app serves the theme panel from the real UI
                                       -- expected true, observed false
                       [desktop-smoke] totals: PASS 62 ...
                     (the rest of the totals line wrapped in the captured log and is deliberately not
                     reproduced rather than guessed at)
                     A PARALLEL run of the identical commit passed the same suite, and a re-run of the failed job
                     passed, so the mechanism is readiness after a RESTART rather than a defect in the panel.
affected_surface     The `acceptance` required check DIRECTLY -- not through `unit` as CITY-DEBT-005 is -- so a
                     red here blocks the merge gate without skipping any other check.
relationship_to_005  Same CLASS (a required check failing for a reason other than the property it tests) but NOT
                     the same family: different suite, different mechanism (application restart readiness rather
                     than host load), different failure text. Recorded separately because section 31 enumerates
                     every CITY-DEBT-* and a merged entry would hide WHICH suite is failing.
not_a_security_event No protected run, no environment approval, no epoch movement and no bypass are involved. Both
                     the failing run and the green parallel run are preserved in Actions history.
exit_condition       Either (a) the desktop smoke suite states what it must observe after a restart and reports
                     NOT_MEASURED rather than failing when the application has not yet served the panel -- so a
                     slow restart produces an absence of evidence instead of false evidence -- or (b) the suite is
                     quarantined to an evidence lane whose result is recorded as evidence rather than required.
exit_condition_a_is_foreclosed
                     A DECISION was attempted and the tree itself refused it (CC-081). Exit condition (a) CANNOT be
                     implemented on this suite while the desktop black-box contract stands, and the reason is a
                     property of the contract rather than of this debt: `validateDesktopBlackBoxReport` in
                     src/shared/acceptance-evidence.ts accepts only three verdicts --
                       if (record.verdict !== "PASS" && record.verdict !== "FAIL" && record.verdict !== "NOT_RUN")
                     -- so a fourth verdict "NOT_MEASURED" is recorded as RESULT_VERDICT_INVALID and the whole
                     report is refused. Even if the verdict passed that check, two further rules in the same
                     function reject the absence: every REQUIRED id must have verdict PASS
                     (REQUIRED_ID_NOT_PASS), and the totals must satisfy pass + fail + notRun === results
                     (TOTALS_SUM_MISMATCH), so an unmeasured requirement can be neither non-PASS nor excluded
                     from the sum. The exit condition's own phrasing -- "a slow restart produces an absence of
                     evidence instead of false evidence" -- is therefore INCOMPATIBLE with the contract this
                     suite is scored by, and the contract is hostile-accepted on purpose: it is the mechanism
                     that makes the strongest evidence in the repository unfakeable.
what_that_leaves     Exit condition (b), the quarantine, is the ONLY remaining path, and it is a larger decision
                     than a repair: the desktop smoke suite IS the evidence the black-box contract attests, so a
                     lane that records its result "as evidence rather than as required" changes what the required
                     `acceptance` check proves -- which is exactly what this entry says must be DECIDED rather
                     than assumed. That decision belongs with the Owner or with a round that can carry a trust
                     change, not with a repair round.
attempt_record       The attempted implementation was REVERTED in full and no tracked file changed: the harness was
                     to record a readiness exhaustion as an explicit absence, with a fourth verdict, a
                     `notMeasured` count and a non-blocking gate path. It was withdrawn the moment the shared
                     validator showed that the absence it produces is precisely what the contract refuses. The
                     attempt is recorded because "we decided (a) is impossible" is only trustworthy if it is
                     visible that (a) was tried.
owner_disposition    ACCEPTED_PERMANENT under workbook section 31 (CC-103 D3). The desktop black-box contract
                     remains STRICT, the restart-readiness flake is accepted as permanent CI/environmental debt,
                     and a final checkpoint is valid only when the exact immutable final main SHA obtains a
                     successful hosted `acceptance` job -- with one re-run permitted on that same SHA, both runs
                     preserved, and a second failure treated as a real blocker rather than retried indefinitely.
                     NEITHER exit condition was performed: (a) was foreclosed by the contract itself and (b), the
                     quarantine, was NOT taken. No test was quarantined, no `NOT_MEASURED` verdict was added to
                     the hostile desktop evidence contract, and `acceptance` remains required hosted evidence.
                     This is a new Owner disposition under section 31, not a repair, and it does not claim the
                     flake is gone. See docs/city/PHASE2_MINIMUM_HUMAN_ACCEPTANCE_DECISION.md.
status               ACCEPTED_PERMANENT
```

---

```text
CITY-DEBT-001  dispatch helper can dispatch without --confirm                  CLOSED
CITY-DEBT-002  finalization checkout is floating main, not the dispatch SHA    CLOSED
CITY-DEBT-003  main CI red from the stale epoch 28 anchor                      CLOSED
CITY-DEBT-004  test fixture reached the real gh and opened four protected runs CLOSED
CITY-DEBT-005  the soak suites fail non-deterministically under hosted load    CLOSED
CITY-DEBT-006  the desktop smoke suite fails after an application restart      ACCEPTED_PERMANENT
```

```text
OPEN               0
CONTAINED          0
CLOSED             5   (CITY-DEBT-001, -002, -003, -004, -005)
ACCEPTED_PERMANENT 1   (CITY-DEBT-006)
```

**Status of this register:** NO OPEN and NO CONTAINED entry; one ACCEPTED_PERMANENT disposition (CITY-DEBT-006, CC-103
D3). This is **not** the final debt review: Phase 2 (workbook §15–§23) has not started, and it is expected to create new
`CITY-DEBT-*` entries for every temporary bridge and every baseline change it needs. The earlier text here claimed "no
OPEN and no CONTAINED entry", which was true when written and was left stale by later additions, and a later revision
said "TWO OPEN entries" beside a table that listed one -- both corrected rather than deleted, because a register that
overstates its own closure is the one artifact a final review cannot afford to trust. ACCEPTED_PERMANENT is a
disposition, not a repair: it records that the Owner decided the residual risk is permanent and bounded, and it does not
claim the restart flake was fixed. Final seal requires the register to close at zero OPEN and zero CONTAINED **at that
time** (workbook §31).
