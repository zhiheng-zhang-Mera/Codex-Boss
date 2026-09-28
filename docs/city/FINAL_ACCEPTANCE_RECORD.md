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
| Construction checkpoint SHA | `9ce8795` — the first landed A2 boundary (the store stops importing the run-mode policy it never decided). Ledger CC-107. Root Trust epoch 67. |
| Final main SHA | **NOT ESTABLISHED** — `main` has not moved and this round made no code change, see §2.5 |
| Final machine-ready tag | **NOT CREATED** — it names a final verified main SHA, and there is none |
| Paper experiment anchor (F0) | `bedeb8280f4bdb51e54fbead642775b1a32d16b6` — tag `boss-city-cc103-paper-snapshot-v1` |
| Paper material anchor (F1) | `8df428eaa437a409368401e95194e40266b83080` — tag `boss-paper-cc103-bundle-20260928-v1` |

## 2. Machine status (filled by T7)

```text
CITY_MACHINE_ACCEPTANCE   = NOT_READY
STRICT_STRUCTURAL_TARGETS = NOT_MET
STRICT_GATE_RAW_STATUS    = NOT_READY  (22 PASS / 5 OPEN / 7 UNVERIFIED at checkpoint 9ce8795)
```

### 2.0 Why there is no final main SHA, stated plainly

This round changed **no source file**. Its commits are the freeze surface, the T2 measurements, the T4 hypothesis
test and the phased plan — all documentation, evidence and analysis. The five hosted jobs are therefore green *by
construction* on this branch, because the code is byte-identical to `main`, and reporting them as proof of a
delivered architecture would be exactly the substitution the workbook forbids ("do not pass off a PR merge-ref
success as the final main success").

The five jobs **did** run on this branch's first commit (`4ed0f44`, run `36432693238`): `quality`, `architecture`,
`unit`, `acceptance` and `package` all `completed/success`, with job ids `108962644082`, `108962644520`,
`108962991894`, `108966737507` and `108966737660`. They are recorded here as **what they are**: a check that this
round's documentation changed nothing that CI can see. They are **not** a final-main acceptance, and F1 remains the
last commit whose five jobs were verified on `main` itself.

### 2.1 Structural targets

This round changed no source file, so every structural value is the work-start value. They are recorded as measured
rather than as `PENDING`, because `PENDING` would suggest a measurement is still coming when in fact none is owed by
this round:

| Metric | Work-start = checkpoint value | Target | Met? |
|---|---:|---:|---|
| kernel → feature file edges | 49 → **48** (A2-1, CC-107) | 0 | **NO** |
| kernel → feature distinct pairs | 16 | 0 | **NO** |
| mutual capability pairs | 31 | 0 | **NO** |
| largest strongly connected component | 18 / 29 nodes | ≤ 1 | **NO** |
| `MIGRATION_IN_PROGRESS` plots | 21 | 0 | **NO** |
| `UNSAFE_GAP` plots | 0 | 0 | yes |
| confirmed cross-domain private-state accesses | 0 | 0 | yes |
| multi-writer candidates | 0 | 0 | yes |
| road outgoing edges | 0 | 0 | yes |
| expired temporary bridges | 0 | 0 | yes |
| `MACHINE_RATCHET` principles | 2 (15.1, 15.7) | 0 | **NO** |
| `NOT_GUARDED` principles | 0 | 0 | yes |
| Core budget result | HOLDS; unexcused growth 0 | HOLDS | yes |

Every **NO** above is a consequence of the three counts beneath it: 15.1 is ratcheted because the kernel → feature
count is above zero, and 15.7 because the mutual-pair and SCC counts are. `MIGRATION_IN_PROGRESS` is not separately
actionable — each plot's declared exit condition is exactly those counts reaching zero.

### 2.2 Hosted checks on the final main SHA

| Job | Required | On a final main SHA |
|---|---|---|
| `quality` | completed / success | **NOT RUN** — no final main SHA exists |
| `unit` | completed / success | **NOT RUN** |
| `acceptance` | completed / success | **NOT RUN** |
| `package` | completed / success | **NOT RUN** |
| `architecture` | completed / success | **NOT RUN** |

The run ID, per-job ID, attempt and subject SHA go in §2.4. A green PR merge-ref run is **not** a substitute for a
green run on the final `main` SHA, and successes from different attempts are never stitched into one run.

### 2.3 Root trust

```text
root_epoch = 67 (boss-root-trust-67) / MATCHES -- ADVANCED from 66 by the A2-1 ceremony
acceptance-evolution-bless.cjs --check = exit 0 (the committed epoch matches the live surface)
```

The trust surface was not touched this round — no source file changed — so no ceremony was due and none was
performed. The `MATCHES` result is a real run of the gate, not an assumption.

### 2.4 Evidence index

```text
final_hosted_run_id   = NOT ESTABLISHED (no final main run exists)
final_main_sha        = NOT ESTABLISHED
branch_checkpoint_sha = 9ce8795
branch_ci_run         = 36432693238 (4ed0f44) -- all five jobs completed/success
post_freeze_cohort    = docs/research/post-cc103/EXPERIMENT_INDEX.csv
strict_gate_raw       = NOT_READY: 20 PASS / 7 OPEN / 7 UNVERIFIED
remaining_open        = S2 (48), S3 (31), S4 (18), S10 (21), S14 (15.1, 15.7)
remaining_unverified  = G2, G3, E1, E4, F1, F2, F4  (G2/G3 are the hosted-ruleset reads; F1/F2/F4 need a final SHA;
                        E1/E4's machine half is VERIFIED in section 3 and only the human half remains)
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
| §A–§W is an untouched prefix | `git diff 8df428e… --numstat -- docs/research/PAPER_EVIDENCE_LEDGER.md` | `219 0` — **219 insertions, 0 deletions**. The new sections are appended; no old line was modified. |
| retired branch tips are reachable | `git ls-remote --tags origin`, filtered to `archive/branch-tip-20260928` | 39 archived tips, each resolved to both its tag object and its peeled commit (78 refs). |
| the CC-103 attempt history survives | `git log --oneline -6 bedeb828…` | the `feat(city)` pre-seal commit, both merge commits, the record commit and the timestamp-correction commit are all present. |
| debt retention | `docs/city/CITY_RENOVATION_DEBT_REGISTER.md` | `CITY-DEBT-006  the desktop smoke suite fails after an application restart  ACCEPTED_PERMANENT`; the register's own tally line reads `ACCEPTED_PERMANENT 1`. |
| evidence hashes | SHA-256 of every file under `docs/research/post-cc103/evidence/` against the values in `EXPERIMENT_INDEX.csv` | 14 files, hashes recorded per row. |

Two of these deserve an explicit limit, because a machine result is easy to over-read:

- `219 0` proves the old section is a **prefix** of the new file. It does **not** prove that the prefix is *complete*
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
BOSS_STANDALONE_RUNTIME                = preserved (no source file changed; the branch differs from main in
                                         documentation, evidence and analysis only)
PAPER_OLD_DATA                         = IMMUTABLE (ledger A-W diff is 219 insertions / 0 deletions)
HISTORY_REWRITE                        = none
MOVE_EXISTING_EVIDENCE_TAG             = none (F0 untouched; F1 created once on a SHA that had no such tag)
TEMPORARY_RUNTIME_PRIVILEGE_EXPANSION  = NONE CREATED (nothing to restore, so T8's restitution step is a no-op)
REMAINING_MACHINE_BLOCKERS             = 5 (S2, S3, S4, S10, S14 -- one body of work)
REMAINING_HUMAN_SESSIONS               = 1 (unspent)
```

### 4.1 The one experiment that touched a tracked file

The ownership hypothesis (paper-ledger §X-5) temporarily edited `config/capability-modules.json` and was reverted
from a byte copy taken beforehand, then re-verified against the ratchet (`edges 49 / pairs 16 / mutual 31 / scc 18 /
files 594` — the work-start baseline exactly). Nothing from that experiment is committed. It is recorded because
"we did not take the shortcut" is only worth anything if the shortcut was actually tried and refused; the ratchet's
own exit code and three anti-gaming problems are the evidence.

## 5. Human acceptance — NOT YET PERFORMED

```text
OWNER_ACCEPTANCE                = PENDING
confirmed_at_local              =
confirmed_target_sha_or_tag     =
verbatim_or_link                =
accepted_or_specific_defect     =
```

### 5.1 Why the Owner session is NOT the remaining step, and must not be offered as if it were

The workbook's single Owner session assumes exactly one thing is left: a machine-ready build whose only outstanding
item is a human look. That is not this round's state, so offering the session would be a false hand-off.

```text
REMAINING_MACHINE_BLOCKERS = 5     (S2, S3, S4, S10, S14 -- all one body of work, see POST_CC103_CLOSEOUT_STATE.json)
REMAINING_HUMAN_SESSIONS   = 1     (unchanged: the session is still owed, it is simply not yet the only thing owed)
FINAL_STATUS               = NOT READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

The blocker is measured, not asserted: the strict structural targets need **hundreds of real inter-capability
dependency removals** inside `electron/**`. Three independent measurements and one gate run establish that no
attribution, road declaration, `import type`, dynamic import, event bus or composition-root absorption can move them
— the strongest single available action is worth one node out of an eighteen-node component, and the gate refused the
one shortcut that was actually attempted. See paper-ledger §X-4 and §X-5, and
`docs/city/DIGITAL_CITY_EXTRACTION_MAP.md` §4 for the phased plan that replaces them.

Telling the Owner "the machine is ready, please look once" would be precisely the `--attest`-style masking the
workbook forbids. The honest hand-off is: **the machine is not ready, here is the measured reason, here is the plan,
and the human session stays unspent.**

The single Owner session remains as the workbook defines it — three observations in one sitting: open the delivered
Boss and confirm the main surface loads without a permission loop; run one local, free, repeatable engineering demo
task and look at its status/result/evidence; and read this summary plus the stated limits and give one acceptance or
one specific non-conformance. It is described here for completeness and is **not** being requested now.

Until every machine condition above is PASS:

```text
FINAL_STATUS = NOT_READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

`CAPABILITY_CITY_CONSTRUCTION_COMPLETE` is not reported, and no executor-run step in this round is described as the
Owner's own test.

