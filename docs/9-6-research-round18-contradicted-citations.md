# 9-6 Research Round 18 — CONTRADICTED Citations Block Primary Claims

Compact handoff for the round-18 deterministic slice: the citation audit (round 14) flagged
UNSUPPORTED citations but silently ignored CONTRADICTED ones, even though the Phase 9 model says
a source that contradicts the claim must never back a primary claim. Branch `9-6-research`.

## Why

`summarizeCitationAudit` returned `ok: true` as long as no citation was UNSUPPORTED — a
CONTRADICTED citation (source acquired, passage located, but the source contradicts the claim)
passed the audit, and the manuscript `final-audit.passed` stayed true with a contradicting
source bound. Research Integrity requires citations to be audited; contradicting evidence must
fail the gate, not silently pass.

## What was added

- **`src/shared/research-citation.ts`**
  - `CitationAuditSummary` gains `contradictedIds`; `ok` is now false when any citation is
    UNSUPPORTED **or** CONTRADICTED; `verified` counts only the verified-statuses set (a
    CONTRADICTED record was never counted as verified, but previously didn't fail the gate).
- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `audit/citations.json` + `final-audit.json` now include `contradicted` ids alongside
    `unsupported`, so a contradicting source is visible in the audit tree and flips
    `final-audit.passed` to false.
- **`tests/citation-audit.test.ts`** (+1 test, extended) — CONTRADICTED is flagged in
  `contradictedIds`, `ok` is false for a contradicting citation; assembler fails the final audit
  and records the contradicted id.

## Verification

- Targeted: `citation-audit` (4) + `research-citation` (4) + `research-artifact-tree` (2) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Citation statuses still come from the live web-AI verification flow (Phase 9 live seam); this
  slice makes the deterministic audit treat contradicting evidence as a hard fail.

## Checkpoint

Commit with: `src/shared/research-citation.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `tests/citation-audit.test.ts`,
this handoff.
