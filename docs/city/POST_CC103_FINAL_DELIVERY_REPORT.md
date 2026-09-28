# Post-CC103 closeout — final delivery report

> Filled from real measurements at the construction checkpoint `bab3f71` on `city/phase2-closeout-post-cc103`.
> Every field is a real value; `NOT_PERFORMED` and `UNVERIFIED` are used where that is the truth. This report is
> the workbook §20 template, filled in, and it is deliberately **not** a success report.

```text
FINAL_STATUS = NOT_READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

The strict structural targets are unmet and the blocking condition is measured, not asserted. Section
`STRUCTURE` below carries the numbers, paper-ledger §X-4/§X-5/§X-6 carry the experiments that established that no
re-attribution, road declaration or composition-root absorption can move them, and
`docs/city/DIGITAL_CITY_EXTRACTION_MAP.md` §4 carries the phased plan that replaces them.

---

## PAPER

```text
experiment_tag / experiment_sha
    boss-city-cc103-paper-snapshot-v1 -> bedeb8280f4bdb51e54fbead642775b1a32d16b6
    (annotated tag object f0973b59a3b298b68c0b652785719aa71917b9b4; verified at the REMOTE, unchanged)
bundle_tag / bundle_sha
    boss-paper-cc103-bundle-20260928-v1 -> 8df428eaa437a409368401e95194e40266b83080
    (annotated tag object caa4e35d44e233a1867667e8a861f930e3df642b; CREATED this round, did not exist before)
old_records_unchanged
    TRUE, and machine-checked: git diff 8df428e..HEAD --numstat -- docs/research/PAPER_EVIDENCE_LEDGER.md
    reports 287 insertions / 0 deletions, so section A-W is an untouched prefix.
    docs/research/PAPER_SNAPSHOT_CC103.csv and docs/history/BRANCH_ARCHIVE_2026-09-28.md were not modified.
original_failure_and_retry_preserved
    TRUE. git log bedeb828 shows the CC-103 pre-seal commit, both merge commits, the record commit and the
    timestamp-correction commit. CITY-DEBT-006 remains ACCEPTED_PERMANENT in the debt register.
post_freeze_cohort_location
    docs/research/post-cc103/  (EXPERIMENT_INDEX.csv + 14 hashed evidence files + 11 re-derivable tools)
    Index validation: 8 rows x 23 columns, 0 malformed, ALL EVIDENCE HASHES VERIFIED (8/8).
```

## GIT

```text
work_start_sha             8df428eaa437a409368401e95194e40266b83080   (== origin/main at work start; NO drift)
checkpoint_sha             bab3f71   (branch city/phase2-closeout-post-cc103, pushed); TWO A2 boundaries have landed
final_main_sha             NOT ESTABLISHED — main has not moved and this round changed no source file
final_machine_ready_tag    NOT CREATED — it names a final verified main SHA, and there is none
merged_prs                 none (a PR may be opened for review; nothing was merged)
active_branches_remaining  2 remote (main + this branch). The 120+ local `[gone]` branches were NOT touched:
                           they are pre-existing, the workbook says not to re-scan or restore old branches, and
                           deleting them is outside this round's registered surface.
archived_unique_tips       NOT_PERFORMED this round. Already done by PR #141: 39 archived branch tips, each
                           reachable at the remote as both a tag object and a peeled commit (78 refs verified).
```

## STRUCTURE

Measured at the work-start SHA and re-verified at the checkpoint; **this round removed no dependency**, so the
work-start values ARE the checkpoint values.

```text
kernel_to_feature_file_edges = 47   (target 0)      NOT MET   [work start 49; A2-1 and A2-4 retired one edge each]
kernel_to_feature_pairs      = 16   (target 0)      NOT MET
mutual_capability_pairs      = 31   (target 0)      NOT MET
largest_scc_size             = 18 of 29 nodes (target <= 1)   NOT MET
migration_in_progress        = 21   (target 0)      NOT MET
private_state_accesses       = 0    (target 0)      MET
multi_writer_candidates      = 0    (target 0)      MET  (detector meaning unchanged)
road_outgoing                = 0    (target 0)      MET
unsafe_gaps                  = 0    (target 0)      MET
expired_bridges              = 0    (target 0)      MET
machine_ratchet_principles   = 2 [15.1, 15.7] (target 0)      NOT MET
not_guarded_principles       = 0    (target 0)      MET
core_budget_result           = HOLDS; unexcused growth 0; Core 115 files   MET
```

**Why these five are one body of work.** 15.1 is ratcheted because the kernel→feature count is above zero; 15.7
because the mutual-pair and SCC counts are; and each `MIGRATION_IN_PROGRESS` plot's declared exit condition is
exactly those counts reaching zero. So there are five names for one migration.

**What was measured instead of attempted blindly** (`docs/research/post-cc103/evidence/`, all hashed):

```text
corrected binding classification   30 RUNTIME / 18 IMPORT-POSITION over 48 statements  (refutes CC-101's 42/7)
re-homing leverage                 0 of 200 single-file moves reduce the largest SCC; best breaks 4 of 36 pairs
SCC removal cost                   strongest single pair removal: 18 -> 17; 337 edges over 60 pairs -> only 10
ownership-class hypothesis         25 src/shared entries moved -> mutual 31 -> 23 but SCC unchanged; ratchet exit 1
largest-hub hypothesis             boot-module.ts to composition_root -> mutual 31 -> 49, SCC 18 -> 28; exit 1
```

Both class hypotheses were **tested and reverted byte-for-byte**, and both were refused by the repository's own
ratchet. That is the evidence behind "no shortcut", and its strongest form: a real, motivated attempt, not a
fixture.

## VERIFICATION

```text
local_targeted_results
    pnpm test (unit tier) at the work-start SHA: 284 files / 3678 tests passed, exit 0.
    Eight city validators re-run at the checkpoint, all exit 0.
real_runtime_and_replacement_evidence
    NOT_PERFORMED this round: no boundary was changed, so there is no old->new->rollback->recovery path to
    prove. The existing replacement lifecycle evidence (one instance RETIRED with evidence at every state)
    is unchanged and is not re-claimed as new.
root_trust_epoch / MATCHES
    epoch 68 (boss-root-trust-68) MATCHES the live surface — real run, exit 0. Advanced twice this round: 66 -> 67
    by A2-1 and 67 -> 68 by A2-4, both because config/architecture-enforcement-baseline.json is a declared Root
    Trust Surface path and the frozen identity genuinely changed (one edge retired each time, internal_edges
    1656 -> 1655 -> 1654). Each ceremony regenerated a candidate, recorded it as an ACCEPTED series entry naming
    the retired edge, asserted the tracked file matched the series head, then advanced.
final_hosted_run_id
    NOT ESTABLISHED for a final main SHA. Branch evidence: run 36432693238 @ 4ed0f44 produced all five jobs
    completed/success (quality 108962644082, architecture 108962644520, unit 108962991894,
    acceptance 108966737507, package 108966737660). Recorded as what it is: a check that this round's
    documentation changed nothing CI can see — NOT a final-main acceptance.
per_job_name / job_id / subject_sha / attempt / conclusion
    as above; no attempt is stitched across commits and no PR merge-ref run is presented as a main run.
strict_gate_raw_status
    NOT_READY: 22 PASS / 5 OPEN / 7 UNVERIFIED at checkpoint bab3f71 on a clean tree
    open       = S2, S3, S4, S10, S14
    unverified = G2, G3 (hosted ruleset reads), E1, E4 (human integrity half), F1, F2, F4 (need a final SHA)
remaining_unverified_ids_and_reasons
    G2/G3  the live ruleset is not readable from the tree; requires --hosted, not new architecture work
    E1/E4  the machine-checkable half is VERIFIED (section 3 of FINAL_ACCEPTANCE_RECORD.md); completeness and
           non-erasure are human claims because the counterfactual is not in the tree
    F1/F2/F4  no final main SHA exists, so no final-main run or Root Trust check on it can be named
```

## PRE_EXTRACTION

```text
completed_in_repo_boundaries
    6 entries in docs/city/DIGITAL_CITY_EXTRACTION_MAP.md, each with the workbook's full schema
    (B-01 persistence, B-02 runtime platform, B-03 providers, B-04 state-core, B-05 the tenx ledgers,
    B-06 the shared DTO surface). Status IN_PROGRESS for the four kernels and the shared surface; the map's
    section 4 sequences the work in four phases.
unchanged_boss_default_runtime
    NO LONGER TRIVIALLY TRUE, and that is the point of this round: A2-1 changed electron/store.ts, added one
    test, lowered two ratchet values, accepted enforcement baseline v21 and advanced the Root Trust epoch to 67.
    The earlier 33-file documentation-only checkpoint still exists as a299d6b for anyone who wants to see the
    round's analysis with no source change; the delivery is now measured at 9ce8795 instead.
deferred_optional_boundaries_and_reasons
    DEFERRED: every extra pre-decoupling. The workbook caps optional pilots at two and makes zero acceptable;
    with the strict targets unmet, an optional pilot would be scope growth, and section 4.1 grades new work
    against closing a real failing item first.
extraction_map_path
    docs/city/DIGITAL_CITY_EXTRACTION_MAP.md
new_services = 0
cross_repo_runtime_dependencies_added = 0
```

## EVIDENCE_AND_AUTHORITY

```text
experiment_index_path
    docs/research/post-cc103/EXPERIMENT_INDEX.csv  (8 rows, 23 columns, 0 malformed, hashes verified)
durable_raw_evidence_locations
    docs/research/post-cc103/evidence/ (14 files, each SHA-256 recorded and re-verified) and
    docs/research/post-cc103/tools/ (11 re-runnable readers; no instrument was replaced)
preserved_failures / corrections / reverts
    preserved: CC-101's wrong 42/7 split (kept in the ledger, then refuted by X-3, per the append-only rule)
    corrected: the experiment index's four mis-aligned rows (every row parsed as 23 fields while the columns
               were shifted; the defect was found by reading the parsed cells, not by counting them)
    reverted: two ownership-class experiments, each byte-for-byte, each re-verified against the baseline
human_intervention_count_during_construction
    1 — the approval-policy change to "never" announced at the start of the session. It is counted because it is
    a real human act; it authorised no construction step, and every measurement and commit above ran without it.
delegated_owner_action_count
    0 — no Owner bypass, no epoch ceremony, no ruleset edit, no environment approval was needed or performed.
    Tags and branch pushes used the existing authenticated client under the standing lease.
temporary_governance_changes_restored
    NONE CREATED. No ruleset, workflow, environment or Root Trust change was made, so there is nothing to
    restore. Root Trust is at epoch 66, MATCHES, unchanged.
autonomous_mutation_lease_closed_pending_owner_acceptance
    TRUE — no further autonomous mutation is pending. Nothing is queued, no branch is scheduled for merge, and
    the two experiments that touched a tracked file were reverted and verified.
```

## OWNER

```text
remaining_session = one
```

**The single Owner session is NOT yet the remaining step, and this report does not offer it.** Five machine
blockers stand between here and `READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE`. Presenting a build for a one-look
acceptance while those stand would be the same masking as `--attest`, which was deliberately not used.

When the strict targets are met, the prepared session is:

```text
exact_program_entry
    TO BE PREPARED AT THAT POINT: a built/packaged Boss, a dedicated demo workspace containing no private data,
    one local and free repeatable engineering task, a written old-vs-new behaviour comparison, the machine
    evidence, and the stated limits — so the Owner installs nothing, resolves no permission and copies no
    long command.
acceptance_target_sha_or_tag
    TO BE NAMED AT THAT POINT (the final main SHA and the machine-ready tag created in T7).
acceptance = PENDING
    Confirmed-at, target SHA/tag, verbatim quote and accept/defect fields stay EMPTY in
    docs/city/FINAL_ACCEPTANCE_RECORD.md until a human actually does it.
```

## The one architectural decision the next round needs from the Owner

Phase A of the extraction map cannot start without it, and it is a policy choice rather than a measurement:

```text
A1  give the shared contracts a home the kernel owns (a foundation surface, or the consuming kernel), which
    requires deliberately widening the kernel file set because the ratchet floors `files_owned`; or
A2  remove the kernel's NEED for them — the kernel stops deciding task/status policy that it currently
    validates (`isConversationPolicy`, `isVerificationContract`, `isRunMode`, `reviewResponse`), and the
    capability that owns the policy does it.

A2 is the architecturally correct answer and the larger change; A1 is mechanical and has to be argued against
the ratchet's own anti-gaming intent rather than around it.
```
