# FINAL ACCEPTANCE RECORD — post-CC103 strict city closeout

> **Status of this file.**
> `OWNER_ACCEPTANCE = PENDING`. The human-signature fields below are deliberately **empty**. Nothing in this file
> may be read as a human confirmation, and no field may be pre-filled with `ACCEPTED`.
>
> This record is created by task T1 (the E5 existence requirement) and is completed by task T7. Its machine
> fields are filled only from real, re-runnable measurements at a named SHA.

## 1. Identity

| Field | Value |
|---|---|
| Mission | `POST_CC103_STRICT_CITY_CLOSEOUT` |
| Repository | `zhiheng-zhang-Mera/Codex-Boss` |
| Work branch | `city/phase2-closeout-post-cc103` |
| Work-start SHA (= F1) | `8df428eaa437a409368401e95194e40266b83080` |
| Final main SHA | *TBD in T7 — the record is committed before the tag that names it, so it cannot name its own commit* |
| Final machine-ready tag | *TBD in T7 (proposed: `boss-city-machine-ready-post-cc103-v1`; on a name collision increment, never move)* |
| Paper experiment anchor (F0) | `bedeb8280f4bdb51e54fbead642775b1a32d16b6` — tag `boss-city-cc103-paper-snapshot-v1` |
| Paper material anchor (F1) | `8df428eaa437a409368401e95194e40266b83080` — tag `boss-paper-cc103-bundle-20260928-v1` |

## 2. Machine status (filled by T7)

```text
CITY_MACHINE_ACCEPTANCE   = PENDING
STRICT_STRUCTURAL_TARGETS = PENDING
STRICT_GATE_RAW_STATUS    = PENDING
```

### 2.1 Structural targets

| Metric | Work-start value | Target | Final value |
|---|---:|---:|---:|
| kernel → feature file edges | 49 | 0 | PENDING |
| kernel → feature distinct pairs | 16 | 0 | PENDING |
| mutual capability pairs | 31 | 0 | PENDING |
| largest strongly connected component | 18 / 29 nodes | ≤ 1 | PENDING |
| `MIGRATION_IN_PROGRESS` plots | 21 | 0 | PENDING |
| `UNSAFE_GAP` plots | 0 | 0 | PENDING |
| confirmed cross-domain private-state accesses | 0 | 0 | PENDING |
| multi-writer candidates | 0 | 0 | PENDING |
| road outgoing edges | 0 | 0 | PENDING |
| expired temporary bridges | 0 | 0 | PENDING |
| `MACHINE_RATCHET` principles | 2 (15.1, 15.7) | 0 | PENDING |
| `NOT_GUARDED` principles | 0 | 0 | PENDING |
| Core budget result | HOLDS; unexcused growth 0 | HOLDS | PENDING |

### 2.2 Hosted checks on the final main SHA

| Job | Required | Recorded |
|---|---|---|
| `quality` | completed / success | PENDING |
| `unit` | completed / success | PENDING |
| `acceptance` | completed / success | PENDING |
| `package` | completed / success | PENDING |
| `architecture` | completed / success | PENDING |

The run ID, per-job ID, attempt and subject SHA go in §2.4. A green PR merge-ref run is **not** a substitute for a
green run on the final `main` SHA, and successes from different attempts are never stitched into one run.

### 2.3 Root trust

```text
root_epoch = PENDING
acceptance-evolution-bless.cjs --check = PENDING
```

### 2.4 Evidence index

```text
final_hosted_run_id   = PENDING
final_main_sha        = PENDING
post_freeze_cohort    = docs/research/post-cc103/EXPERIMENT_INDEX.csv
strict_gate_raw       = PENDING (E1/E4 are expected to be the only remaining non-PASS items)
remaining_unverified  = PENDING
```

## 3. Integrity attestations (E1 / E4) — machine-derived part

The strict gate cannot prove from a working tree that (E1) every compromise is in the ledger, or that (E4) no
historical failure was erased. It can, however, check the *reachability and prefix* half, which is what this
round records before any human reads the result.

```text
old ledger §A–§W preserved as a prefix                 = VERIFIED (2026-09-28)
retired branch tips reachable through archive tags     = VERIFIED (2026-09-28)
CC-103 first FAILED acceptance attempt preserved       = VERIFIED (2026-09-28)
CC-103 second (permitted) attempt preserved            = VERIFIED (2026-09-28)
CITY-DEBT-006 = ACCEPTED_PERMANENT retained            = VERIFIED (2026-09-28)
new evidence hashes match the index                    = VERIFIED (2026-09-28)
```

Each `VERIFIED` above is a machine-checkable statement, and here is the check that produced it rather than a claim:

| Statement | How it was checked | Result |
|---|---|---|
| §A–§W is an untouched prefix | `git diff 8df428e… --numstat -- docs/research/PAPER_EVIDENCE_LEDGER.md` | `153 0` — **153 insertions, 0 deletions**. The new section is appended; no old line was modified. |
| retired branch tips are reachable | `git ls-remote --tags origin`, filtered to `archive/branch-tip-20260928` | 39 archived tips, each resolved to both its tag object and its peeled commit (78 refs). |
| the CC-103 attempt history survives | `git log --oneline -6 bedeb828…` | the `feat(city)` pre-seal commit, both merge commits, the record commit and the timestamp-correction commit are all present. |
| debt retention | `docs/city/CITY_RENOVATION_DEBT_REGISTER.md` | `CITY-DEBT-006  the desktop smoke suite fails after an application restart  ACCEPTED_PERMANENT`; the register's own tally line reads `ACCEPTED_PERMANENT 1`. |
| evidence hashes | SHA-256 of every file under `docs/research/post-cc103/evidence/` against the values in `EXPERIMENT_INDEX.csv` | 11 files, hashes recorded per row. |

Two of these deserve an explicit limit, because a machine result is easy to over-read:

- `153 0` proves the old section is a **prefix** of the new file. It does **not** prove that the prefix is *complete*
  relative to some earlier state — a line deleted and an identical line re-added elsewhere would not be visible here.
  Completeness is the human claim in §3's closing paragraph.
- `ACCEPTED_PERMANENT` proves the **classification** is still recorded. It does not extend that acceptance to any
  later failure: a fresh acceptance red is a new failure until it is shown to be the same fingerprint.


The remaining, human-only part is stated plainly rather than implied:

> A machine can show that the recorded objects exist and that the ledger's old section is still a prefix of the
> file. A machine cannot show that *nothing was erased* or that *every* compromise was disclosed, because the
> counterfactual is not in the tree. Those two are the integrity claims a human confirms or refuses; they are not
> something `--attest` may wave through before that happens.

## 4. Constraints observed

```text
NEW_RUNTIME_SERVICE                    = 0
CROSS_REPO_RUNTIME_DEPENDENCIES_ADDED  = 0
BOSS_STANDALONE_RUNTIME                = preserved (verified in T7)
PAPER_OLD_DATA                         = IMMUTABLE
HISTORY_REWRITE                        = none
MOVE_EXISTING_EVIDENCE_TAG             = none
TEMPORARY_RUNTIME_PRIVILEGE_EXPANSION  = PENDING (restored in T8)
REMAINING_MACHINE_BLOCKERS             = PENDING
REMAINING_HUMAN_SESSIONS               = 1
```

## 5. Human acceptance — NOT YET PERFORMED

```text
OWNER_ACCEPTANCE                = PENDING
confirmed_at_local              =
confirmed_target_sha_or_tag     =
verbatim_or_link                =
accepted_or_specific_defect     =
```

The single Owner session (workbook §17) is three observations in one sitting: open the delivered Boss and confirm
the main surface loads without a permission loop; run one local, free, repeatable engineering demo task and look
at its status/result/evidence; and read this machine summary plus the stated limits and give one acceptance or one
specific non-conformance. It does **not** claim to cover every provider, network path or multi-device case, and it
does not re-test parts this round never touched.

Until that session happens:

```text
FINAL_STATUS = READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE   (only once every machine condition above is PASS)
```

`CAPABILITY_CITY_CONSTRUCTION_COMPLETE` is not reported before the human confirmation, and no executor-run step in
this round is ever described as the Owner's own test.
