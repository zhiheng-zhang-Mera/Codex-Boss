# 9-6 Research Phase 9 — Literature / Citation Verification Core

Compact handoff for codex-boss-9-6-research-plan.md Phase 9 (§9 core). Branch `9-6-research`.

## Why

An AI recommending a paper is not a verified citation. The plan mandates a strict ladder
(source acquired → metadata verified → relevant passage located → claim relation verified) and
forbids UNSUPPORTED citations from backing primary claims. This phase ships the pure status
machine + durable source store; live literature retrieval plugs into `saveSource`/`verify`.

## What was added

- **`src/shared/research-citation.ts`** (new, pure)
  - `CitationStatus` ladder (UNSUPPORTED → METADATA_ONLY → SOURCE_RETRIEVED →
    PASSAGE_VERIFIED → CLAIM_SUPPORTED, plus PARTIAL / CONTRADICTED);
  - `CitationRecord` (+`validateCitationRecord` fail-closed),
    `verifyCitation(evidence)` deterministic ladder function,
    `primaryClaimSupported(records)` — rejects primary claims bound to UNSUPPORTED citations.
- **`electron/research/literature/source-store.ts`** (new)
  - `CitationSourceStore(root)` — durable v1 citations per research root; `put`/`verify`
    (records status + reason + passages), `saveSource(ref, text)` content-addressed source
    cache with sha256, `loadSource(ref)`, `list`/`statuses`; fail-closed corrupt reads.
- **`tests/research-citation.test.ts`** (new, 4 tests) — ladder reachability from evidence;
  primary-claim UNSUPPORTED guard + validation fail-closed; persisted ladder progress + source
  cache across reload; unknown-verify rejection + corrupt-store fail-closed.

## Verification

- Targeted: `research-citation` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Retrieval/citation-engine live wiring (fetching the DOI/URL, verifying metadata against
  publisher APIs) is intentionally external; this store and verifier are the durable half and
  the manuscript audit (Phase 11) consumes `primaryClaimSupported`.
- Passages are bounded (≤50 × ≤4k chars) so a source store never balloons.

## Checkpoint

Commit with: `src/shared/research-citation.ts`,
`electron/research/literature/source-store.ts`, `tests/research-citation.test.ts`, this handoff.
