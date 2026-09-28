# CC-103 paper freeze: the two anchors, the material carrier, and the post-freeze cohort

> **What this record is.** The freeze boundary for the CC-103 paper evidence. It names the two immutable
> references, the file that carries each one, and the rule that separates data produced *before* the freeze
> from data produced *after* it. It is not an experimental result and it is not a new acceptance decision.
>
> Written 2026-09-28 (Australia/Melbourne) under `docs/city/POST_CC103_CITY_CLOSEOUT_WORKBOOK.md` task T1.
> Machine log times are UTC; no timestamp in this file was estimated by hand.

## 1. The two anchors

| Anchor | Reference | Object | What it pins |
|---|---|---|---|
| **F0** experiment / acceptance snapshot | `bedeb8280f4bdb51e54fbead642775b1a32d16b6` | annotated tag `boss-city-cc103-paper-snapshot-v1` (tag object `f0973b59a3b298b68c0b652785719aa71917b9b4`) | The CC-103 experiments, the first failing acceptance attempt, the permitted second attempt, and the accepted CC-103 conclusions. |
| **F1** material carrier | `8df428eaa437a409368401e95194e40266b83080` | annotated tag `boss-paper-cc103-bundle-20260928-v1` (tag object `caa4e35d44e233a1867667e8a861f930e3df642b`) | The papers' *material* surface at freeze time: `docs/research/PAPER_EVIDENCE_LEDGER.md` §A–§W, `docs/research/PAPER_SNAPSHOT_CC103.csv`, the branch archive table, and the citation bridge. |

Both tags were verified **at the remote**, not only locally:

```text
git ls-remote --tags origin 'refs/tags/boss-city-cc103-paper-snapshot-v1*'
  f0973b59a3b298b68c0b652785719aa71917b9b4  refs/tags/boss-city-cc103-paper-snapshot-v1
  bedeb8280f4bdb51e54fbead642775b1a32d16b6  refs/tags/boss-city-cc103-paper-snapshot-v1^{}

git ls-remote --tags origin 'refs/tags/boss-paper-cc103-bundle-20260928-v1*'
  caa4e35d44e233a1867667e8a861f930e3df642b  refs/tags/boss-paper-cc103-bundle-20260928-v1
  8df428eaa437a409368401e95194e40266b83080  refs/tags/boss-paper-cc103-bundle-20260928-v1^{}
```

**The annotation of F1 says what it is and what it is not:**

> CC-103 paper material carrier freeze; experiment remains bedeb828; strict full city NOT_READY; no new
> experimental acceptance.

A tag is an immutable *convention* in this programme, not a claim that Git makes it unforgeable against a
holder of write access. The full commit SHA is carried alongside every tag reference for exactly that reason.
No tag was moved, recreated, or deleted: F1 did not exist on the remote before this task and was created once.

## 2. Work-start baseline

`origin/main` at work start was `8df428eaa437a409368401e95194e40266b83080` — identical to F1, so **no
drift occurred at the signing point** and no reconciliation was needed. Section 6.3's drift procedure was
checked and did not apply.

```text
ACTUAL_WORK_START_SHA = 8df428eaa437a409368401e95194e40266b83080
WORK_BRANCH           = city/phase2-closeout-post-cc103
```

The working tree at start carried no uncommitted changes (`git status --short` was empty), so nothing had to
be preserved before branching. No `reset`, `clean`, or `checkout --` was run against it.

## 3. The pre-existing evidence that was NOT touched

| Artefact | Commit that introduced it | Treatment |
|---|---|---|
| `docs/research/PAPER_EVIDENCE_LEDGER.md` §A–§W | carried by F0/F1 | **read-only.** New findings are appended in a new section; no old line was rewritten. |
| `docs/research/PAPER_SNAPSHOT_CC103.csv` (39 rows × 12 columns) | PR #141 | **read-only.** Corrections, if any, are appended as new rows pointing at the old one. |
| `docs/history/BRANCH_ARCHIVE_2026-09-28.md` | PR #141 (`9156f17f909b254984697c5be355ddf6a3e06e65`) | **referenced, not re-run.** The 152-branch cleanup is history; the branches are not restored. |
| The one retired-branch citation | PR #142 (merge = F1) | **read-only.** The bridge is part of F1's material surface. |
| `CITY-DEBT-006 = ACCEPTED_PERMANENT` | CC-103 | **retained.** See §5. |

## 4. The three data cohorts

```text
CC103_ORIGINAL             the CC-103 experiments, including the first FAILED acceptance attempt and the
                           permitted second attempt. Anchored at F0. Never re-written, never re-labelled.

CC103_RETROSPECTIVE_INDEX  old data re-extracted or re-indexed ON TOP OF F1 (the CSV, the §A–§W ledger).
                           Explicitly NOT new experiments.

POST_CC103_CONTINUATION    everything this closeout produces: new runs, migrations, structural measurements
                           and verification. An independent cohort, anchored at the T7 machine-ready tag.
                           Index: docs/research/post-cc103/EXPERIMENT_INDEX.csv
```

The cohort boundaries are what let a later paper cite a post-freeze number without implying it was measured at
F0. **The rule that makes the boundary load-bearing:**

> A system that passes a test *after* a repair is not evidence that the pre-repair system passed. Old evidence
> is not retroactively strengthened by new repairs, and the same SHA re-run is not a new independent sample.

## 5. What the freeze deliberately does NOT say

- It does **not** say the strict city targets were met at F0/F1. They were not: `kernel -> feature` file edges
  were 49, mutual capability pairs 31, largest SCC 18 of 29 nodes, and 21 plots were `MIGRATION_IN_PROGRESS`.
  The recorded strict result was `21 PASS / 6 OPEN / 7 UNVERIFIED`, and `MIGRATION_IN_PROGRESS`/`OPEN` was the
  honest state. F1 freezes the *material*, not a claim of structural completion.
- It does **not** convert `CITY-DEBT-006 = ACCEPTED_PERMANENT` into a blanket excuse. That acceptance covers
  the specific, fingerprinted CC-103 acceptance flake. A later acceptance failure is a new failure until it is
  shown to be the same one.
- It does **not** promise that `main` stops moving. The freeze lives in F0/F1; `main` may advance behind
  reviewed merges without weakening either anchor.

## 6. Paper-reference hygiene

`MAIN_PAPER_REFERENCE = FORBIDDEN_AS_A_FLOATING_REF`. A citation in the paper must name F0 or F1 (or a later
machine-ready tag) by SHA, never `main`. This is why F1 exists as an annotated tag with an explicit "material
carrier, not experimental acceptance" annotation: it is the address a paper can cite for *the material surface*
without implying that the material's commit was itself an experimental acceptance.

## 7. Where the post-freeze data lives

```text
docs/research/post-cc103/EXPERIMENT_INDEX.csv     one row per real run attempt
docs/research/post-cc103/evidence/                filtered raw/normalised JSON, hashes, trimmed logs
docs/city/POST_CC103_CLOSEOUT_STATE.json          the overwritable latest construction checkpoint
docs/city/DIGITAL_CITY_EXTRACTION_MAP.md          the in-repo boundary map for a future extraction
docs/city/FINAL_ACCEPTANCE_RECORD.md              the machine delivery record; the human fields stay PENDING
```

Full test logs are kept outside the repository in the round's registered off-repo working directory
(`D:\Codex-Boss-Offrepo\post-cc103\`), so the final tree cannot be made dirty by debug output. Only the
filtered, permanent evidence is committed, each with a SHA-256.
