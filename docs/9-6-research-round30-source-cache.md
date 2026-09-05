# 9-6 Research Round 30 — Source Acquisition Derived from the Citation Cache

Compact handoff for the round-30 deterministic slice: the citation store verified records from
caller-supplied evidence, but never derived `sourceAcquired` from its own content-addressed
source cache — a saved source could not advance a record past UNSUPPORTED without re-stating it.
Branch `9-6-research`.

## Why

Phase 9's ladder: source acquired → metadata verified → passage located → claim relation
verified. The store already saves acquired sources content-addressed (`saveSource`), yet
`verify()` required the caller to repeat `sourceAcquired: true` — so a cached source was not
itself evidence. This slice makes acquisition derive deterministically from the cache while
keeping passage support caller evidence (a cached file alone never fabricates claim support).

## What was added

- **`electron/research/literature/source-store.ts`**
  - `verifySource(id, evidence)` — resolves `sourceAcquired` from the store's own cache
    (`record.sourceRef` saved via `saveSource`), then runs the ladder. No cached source → can
    reach at most METADATA_ONLY (never fabricated acquisition).
- **`electron/research/research-service.ts`**
  - `verifyCitation(id, evidence)` facade delegating to `verifySource` (fail-closed on unknown
    ids).
- **`tests/research-citation.test.ts`** (+1 test) — cached source + metadata → SOURCE_RETRIEVED,
    with passage → CLAIM_SUPPORTED; uncached ref stays METADATA_ONLY; status persisted.
- **`tests/research-service.test.ts`** (+1 test) — cache-derived verification through the
    service; unknown id throws.

## Verification

- Targeted: `research-citation` (5) + `research-service` (6) + `citation-audit` (6) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Passage location/support still requires live reviewers; the cache determines acquisition
  deterministically.

## Checkpoint

Commit with: `electron/research/literature/source-store.ts`,
`electron/research/research-service.ts`, `tests/research-citation.test.ts`,
`tests/research-service.test.ts`, this handoff.
