# INCIDENT — 2026-09-24 — spurious trust-epoch finalization dispatch

**Incident id:** INC-2026-09-24-01
**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Recorded by:** Hns, temporary Owner-authorised City construction executor
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`
**Related ledger entries:** CC-002 (cancellation), CC-003 (intended run approval)
**Related debt:** CITY-DEBT-001 (dispatch helper), CITY-DEBT-002 (floating-main checkout)

This record is **facts only**. Nothing here is deleted, hidden, renamed, or reinterpreted. The Actions run it
describes is preserved in GitHub history as `cancelled` and must never be removed.

---

## 1. What happened

A helper script that was intended to perform a **dry run** performed a **real dispatch** of the protected
`Trust Epoch Finalization` workflow (`workflow_dispatch`).

The result was a second, unintended waiting run of an Owner-gated trust ceremony, dispatched on a commit that
the repository had already superseded by the time the incident was observed.

## 2. Facts

```text
spurious run id          35961897353
spurious run name        Trust Epoch Finalization
spurious run event       workflow_dispatch
spurious run head branch main
spurious run head sha    8897ddc3a18f5e38da14729ced951d14122d6394
spurious run created at  2026-09-24T05:52:46Z
spurious run status      waiting  (on environment boss-root-trust-owner, at observation)

intended run id          35962014554
intended run name        Trust Epoch Finalization
intended run event       workflow_dispatch
intended run head branch main
intended run head sha    79af142b9c0e9f634dc099bd2ad289cff5f31301
intended run created at  2026-09-24T05:54:21Z
intended run status      waiting  (on environment boss-root-trust-owner, at observation)
                         in_progress after Owner-authorised approval (deployment 6631222136)

protected environment    boss-root-trust-owner
environment reviewers    zhiheng-zhang-Mera (User)
can_admins_bypass        false
main at observation      79af142b9c0e9f634dc099bd2ad289cff5f31301 (= the intended run's head_sha)
```

The spurious run's head SHA `8897ddc3...` is the merge commit of PR #25, i.e. the state of `main` **before**
PR #26 (`79af142b`). It is therefore not a typo of the intended SHA: the helper captured a stale value and then
wrote with it.

## 3. No attempt was made to conceal the run

The run was not deleted, not renamed, not hidden, and no attempt was made to make the Actions list appear as if
it had never existed. It is preserved as `cancelled`, which is itself the evidence. Cancellation was chosen over
approval because approving it would have advanced the epoch from a superseded tree.

## 4. Helper hardening that followed

The helper now requires an explicit confirmation before any write, and its dry-run path is intended to be a true
read-only path that prints the exact write it would perform. Workbook §9 B2 makes this a hard requirement with
tests that prove the dry-run path cannot dispatch.

**Status:** NOT YET IMPLEMENTED at the time of this record. Tracked as `CITY-DEBT-001`, `OPEN`. The requirement
is stated here as the intended closure condition, not as an accomplished fact.

## 5. Impact on correctness

```text
Effect on the committed epoch          NONE. The spurious run was cancelled before approval, so it never ran,
                                       never advanced an epoch, and never wrote trust-policy/trust-epoch.json.
Effect on the epoch lineage            NONE. No epoch record, parent hash, or branch was produced by it.
Effect on the intended ceremony        NONE. Run 35962014554 was dispatched independently on the correct SHA
                                       and was approved on its own merits.
```

## 6. Impact on provenance

```text
Effect on provenance                   REAL AND NOT ZERO. Two waiting Owner-gated runs existed simultaneously for
                                       the same ceremony: one on a stale SHA, one on the intended SHA. The
                                       repository's Actions history therefore contains a protected-ceremony run
                                       that corresponds to no intended act. Any later reader must be able to
                                       tell which run was authorised; this record is how.
Compounding defect                    CITY-DEBT-002: because finalization checked out `main` rather than the
                                       dispatch SHA, an approval of the STALE run would have measured and
                                       anchored the CURRENT main while reporting the stale run id — i.e. the two
                                       defects together could have produced a correctly-valued epoch record with
                                       a misleading provenance. The stale run was cancelled precisely to prevent
                                       that.
```

## 7. Cancellation result

```text
action           gh run cancel 35961897353 (Owner workflow action)
result           Request to cancel workflow 35961897353 submitted.
terminal status  cancelled (verified: {"status":"completed","conclusion":"cancelled"})
approved         NO. The environment deployment for the spurious run was never approved.
```

The intended run was then approved separately:

```text
action           POST /repos/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35962014554/pending_deployments
body             environment_ids = [22269167335], state = approved, comment naming the workbook clause,
                 the run id, the head SHA, and the fact that the spurious run was cancelled rather than approved
result           deployment 6631222136 created and approved; job started 2026-09-24T06:20:13Z
```

## 8. Follow-up hardening (required, and tracked)

```text
1. CITY-DEBT-001  helper: no write without an explicit --confirm; true read-only dry-run path; print the exact
                  write before confirmation; tests proving dry-run cannot dispatch.
2. CITY-DEBT-002  finalization: check out ${{ github.sha }} with fetch-depth 0; assert git rev-parse HEAD
                  equals github.sha and github.ref equals refs/heads/main; record dispatch_sha and
                  checked_out_sha in the proposal/handoff and fail closed on disagreement.
3. A counterfactual test: dispatch at SHA A, main becomes SHA B, approval occurs, finalization remains on A.
   The test must fail against the old semantic shape and pass against the repair.
```

## 9. What this incident illustrates

A "dry run" that performs a real protected dispatch is a helper whose name overstates its safety. The failure
mode is not a mistake in the ceremony — the ceremony's gate worked, and nothing was anchored — it is a mismatch
between an action's declared intent and its effect. The same class of mismatch, one level down, is
`CITY-DEBT-002`, where the workflow's declared subject (the dispatch SHA) is not the tree it actually measures.
Both are recorded, and both must be closed rather than explained away.

## 10. Evidence references

```text
spurious run               https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35961897353
intended run               https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35962014554
approving deployment       https://api.github.com/repos/zhiheng-zhang-Mera/Codex-Boss/deployments/6631222136
failing guard (context)    Desktop CI run 35961901372, unit job 107512217870
                           tests/unit/test-layers.test.ts:430 TRUST_EPOCH_ROOT_SURFACE_MISMATCH
workbook clauses           §1 (provenance defect), §4.3 (this record), §8 A2/A3 (cancel/approve), §9 (repair)
ledger entries             docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md CC-002, CC-003, CC-004
debt entries               docs/city/CITY_RENOVATION_DEBT_REGISTER.md CITY-DEBT-001, CITY-DEBT-002
```
