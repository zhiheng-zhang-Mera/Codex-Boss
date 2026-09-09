# 9-6 Research Round 20 — Deterministic references.bib from Verified Citations

Compact handoff for the round-20 deterministic slice: `references.bib` was always a stub header
even when verified citations existed; the bibliography is now generated deterministically from
citation records (Phase 9/11) — never from AI-suggested titles alone. Branch `9-6-research`.

## Why

The Phase 9 rule is that "AI suggests a paper" ≠ "citation verified". The audit tree already
distinguished verified vs UNSUPPORTED/CONTRADICTED records (rounds 14/18), but the manuscript's
`references.bib` was written as a constant `% References for <title>` regardless of the citation
store — a suggested-but-unverified paper could silently appear in (or be omitted from) the paper
without any deterministic rule.

## What was added

- **`src/shared/research-bibliography.ts`** (new, pure)
  - `bibliographyEntries(records)` — emits a BibTeX `@misc` entry only for records whose status
    is SOURCE_RETRIEVED / PASSAGE_VERIFIED / CLAIM_SUPPORTED / PARTIAL (source actually
    acquired, not contradicting); UNSUPPORTED / METADATA_ONLY / CONTRADICTED records never
    produce an entry. Keys are sanitized for BibTeX; braces/`$` are escaped.
  - `referencesBib(records)` — header + entries (deterministic).
- **`electron/research/manuscript/manuscript-assembler.ts`**
  - When `options.citations` is supplied, `references.bib` is generated from verified records;
    otherwise the stub header is preserved (backward compatible).
- **`tests/citation-audit.test.ts`** (+2 tests)
  - bibliography emits entries only for verified non-contradicting records (with authors, venue,
    url, escaped title, sanitized key);
  - `references.bib` written from verified records into the manuscript tree; stub header when no
    records supplied.

## Verification

- Targeted: `citation-audit` (6) + `research-manuscript` (3) + `research-artifact-tree` (2)
  PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Citation statuses still come from the live web-AI verification flow; this slice makes the
  paper's reference list truthful about which records were actually verified.

## Checkpoint

Commit with: `src/shared/research-bibliography.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `tests/citation-audit.test.ts`,
this handoff.
