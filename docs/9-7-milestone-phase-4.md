# Milestone Phase 4 — Literature retrieval closure (§9)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md` §9.
Branch `9-7-milestone`.

## What changed

- New `electron/research/literature/retriever.ts` (deterministic core of §9):
  - `planLiteratureQueries(rq, hypothesis?, pass)` — bounded queries; Pass 1 is
    the default, Pass 2 (context/novelty) and Pass 3 (reviewer-identified gap)
    only run when explicitly requested. No infinite literature hunt is
    expressible.
  - `dedupeLiteratureCandidates(candidates)` — DOI → sourceRef → title-hash
    dedup before acquisition.
  - `retrieveLiterature({researchId, rq, hypothesis?, pass?}, {store, search,
    acquire})` — bounded candidate search → dedup → per-candidate source
    acquisition → CitationSourceStore (record + content-addressed source) →
    host metadata/passage verification ladder. A failed acquisition leaves no
    source record — an AI title alone can never enter the verified set.
  - `MAX_PASS_SOURCES` budget (≤10) with candidate truncation reported.

## Acceptance

`tests/research-literature-retriever.test.ts` (5 tests): per-pass bounded
queries; DOI/title dedup; acquisition into the store with host-side passage
verification (PASSAGE_VERIFIED, support deferred to the verifier role) plus
failed acquisitions reported; no acquisition → nothing stored above
UNSUPPORTED (nothing at all); candidate budget truncation.

## Integration seam (live)

The deterministic conductor's LITERATURE_REVIEW stage already performs the same
bounded intake into the CitationSourceStore (its fixture provider carries
candidate + acquired text; the live adapter will implement `search`/`acquire`
against real literature/web endpoints and feed the retriever above). The
retriever module is the shared host core both paths use; real endpoint
acquisition stays a GUI-session/live item (matching the milestone's own
live-vs-deterministic boundary), never a placeholder.
