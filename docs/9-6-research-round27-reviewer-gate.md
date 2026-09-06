# 9-6 Research Round 27 — Reviewer Gate in the Manuscript Pipeline

Compact handoff for the round-27 deterministic slice: the manuscript model declares a REVIEWED
status + `reviewerNotes`, but the assembler never ran a reviewer stage — the plan's Phase 11
pipeline (brief → draft → reviewer → evidence check → revision) skipped review entirely.
Branch `9-6-research`.

## Why

Phase 11 requires each section to pass draft → reviewer → evidence check → revision. The shared
model carried `SectionStatus.REVIEWED` and `SectionDraft.reviewerNotes`, but
`assembleManuscript` only wrote a draft and evidence-checked it — reviewer notes were always
empty and REVIEWED unreachable, so nothing prevented an unreviewed section from being REVISED.

## What was added

- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `SectionReviewer` interface + `ManuscriptOptions.reviewer?` — per-section reviewer called
    after each draft; `approved:false` adds notes and forces another revision (bounded by
    maxRevisions), `approved:true` proceeds to the evidence check. Section status is `REVISED`
    only when the reviewer approved (or is absent) AND the evidence check cleared;
    `reviewerNotes` are recorded on the section. Backward compatible when no reviewer is
    supplied.
- **`tests/research-manuscript.test.ts`** (+1 test)
  - deterministic reviewer rejects the first two drafts of `results` (notes recorded, final
    draft is rev 2) while approved sections keep a single revision; final audit still passes.

## Verification

- Targeted: `research-manuscript` (4) + `citation-audit` (6) + `research-artifact-tree` (2)
  PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- A live reviewer (web-AI) is a GUI/live seam; the deterministic reviewer in tests exercises the
  exact gate the live flow uses.

## Checkpoint

Commit with: `electron/research/manuscript/manuscript-assembler.ts`,
`tests/research-manuscript.test.ts`, this handoff.
