# 9-6 Research Phase 11 — Manuscript Pipeline Core

Compact handoff for codex-boss-9-6-research-plan.md Phase 11 (§11 core). Branch `9-6-research`.

## Why

Papers must never be written in a single prompt. The plan requires a section pipeline
(Evidence Graph → section brief → draft → reviewer → evidence check → revision) that produces
paper.md / paper.tex / references.bib / figures/ and an audit folder, and Research Mode runs to
READY automatically (external submission/publish still human-authorized).

## What was added

- **`src/shared/research-manuscript.ts`** (new, pure)
  - `ManuscriptSection` (abstract…conclusion) + `MANUSCRIPT_SECTIONS`, `SectionStatus`,
    `SectionDraft`, `ManuscriptPlan {claimsToSections}` (+validation),
    `buildSectionBriefs(plan, claims)` → per-section claim/evidence-scoped briefs,
    `evidenceCheckDraft(draft, availableEvidenceIds)` — a section may only assert evidence that
    exists in the Evidence Graph (reference syntax `@evidence-id`), returning the missing ids.
- **`electron/research/manuscript/manuscript-assembler.ts`** (new)
  - `assembleManuscript(directory, options)` — runs the section pipeline with an injected
    `SectionWriter` (live model in production, deterministic fake in tests), bounding revisions
    per section; evidence-check failures annotate the draft instead of silently dropping the
    assertion; writes `research/<id>/manuscript/{paper.md,paper.tex,references.bib,figures/}`
    and `audit/{citations.json,reproducibility.json,final-audit.json}`; returns structured
    `ManuscriptOutput` with per-section status.
- **`tests/research-manuscript.test.ts`** (new, 3 tests) — evidence-scoped briefs + plan
  validation; evidence-check PASS/FAIL incl. out-of-scope references; assembler writes the
  complete tree (paper.md/paper.tex/references.bib/figures + audit) with a clean final audit.

## Verification

- Targeted: `research-manuscript` (3) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The writer is injected: the live section reviewer/reviser (web-AI + evidence check) is the
  adoption seam; the deterministic frame (briefs, revision bound, evidence check, output tree)
  is what this phase locks in.
- `references.bib`/citation audit content is currently scaffold (PENDING) — Phase 9's verified
  CitationSourceStore is the intended source; figures/ is prepared for Phase 10 statistics
  outputs. `paper.pdf` generation needs a LaTeX toolchain and stays a build-time step.

## Checkpoint

Commit with: `src/shared/research-manuscript.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `tests/research-manuscript.test.ts`,
this handoff.
