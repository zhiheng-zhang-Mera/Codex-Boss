# 9-6 Research Round 14 — Citation Audit in the Manuscript Tree

Compact handoff for the round-14 deterministic slice: give the manuscript audit tree a real
citation audit (Phase 9 rule: primary claims must never bind UNSUPPORTED citations) instead of
the static `{status:"PENDING"}` stub. Branch `9-6-research`.

## Why

The Phase 11 artifact tree carries `audit/citations.json`, but the manuscript assembler always
wrote a PENDING stub regardless of the citation store's verified state — so the hard Phase 9
rule ("AI 推荐某论文 ≠ 已验证"; primary claim must not bind UNSUPPORTED) was never enforced at
manuscript composition. Round 12 added real reproducibility content to the same tree; this round
does the same for citations.

## What was added

- **`src/shared/research-citation.ts`** (pure)
  - `VERIFIED_CITATION_STATUSES` (SOURCE_RETRIEVED/PASSAGE_VERIFIED/CLAIM_SUPPORTED/PARTIAL) and
    `summarizeCitationAudit(records)` → `{ total, perStatus, verified, unsupportedIds, ok }`,
    deterministic.
- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `ManuscriptOptions.citations?: CitationRecord[]` — when supplied, `audit/citations.json`
    gets the real summary, `final-audit.json` carries `citations: { ok, verified,
    unsupported }`, and `passed` requires no UNSUPPORTED citation bound (primary-claim rule).
    When absent the PENDING stub + behavior are preserved (backward compatible).
- **`tests/citation-audit.test.ts`** (new, 3 tests) — verified counting + UNSUPPORTED flagging +
    empty-audit; assembler writes the real audit and flips `final-audit.passed` to false on an
    UNSUPPORTED citation; PENDING stub retained when no records supplied.

## Verification

- Targeted: `citation-audit` (3) + `research-citation` (4) + `research-manuscript` (3) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- A citation's ladder status still comes from the live web-AI verification flow (Phase 9 live
  seam); this slice audits whatever records exist — never fabricates verification. Live
  Level-B E2E still requires a GUI session.

## Checkpoint

Commit with: `src/shared/research-citation.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `tests/citation-audit.test.ts`,
this handoff.
