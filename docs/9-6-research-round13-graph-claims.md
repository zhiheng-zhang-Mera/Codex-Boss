# 9-6 Research Round 13 — Manuscript Claims Derived from the Evidence Graph

Compact handoff for the round-13 deterministic slice: derive the manuscript `claims`/`evidenceIds`
wiring from the evidence graph's real claim + statistic nodes, so a manuscript only asserts
claims that exist in the graph and every claim is bound to the evidence nodes upstream of it —
by construction, never hand-wired. Branch `9-6-research`.

## Why

The rounds 11–12 analysis writes `claim:` + `stat:` nodes and `run → statistic → claim` edges
into the evidence graph, and the reproducibility audit confirms the primary finding. But the
manuscript pipeline still received hand-written `claims`/`evidenceIds` arrays. Deriving them
from the graph closes "claims traceable to evidence" (Final Acceptance I) at the composition
layer and keeps evidence>vote honest: a claim cannot be asserted in a manuscript unless the
analyzer actually recorded it.

## What was added

- **`electron/research/evidence/graph-claims.ts`** (new)
  - `deriveManuscriptClaims(graph)` — BFS upstream from every `claim:` node, collecting only
    evidence-kind node ids (`run`/`statistic`/`metric`/`figure-table`/`paper-sentence`), never
    hypotheses/RQs/protocols; returns `{ claims: [{id, evidenceIds}], evidenceIds }` in graph
    order. Pure + deterministic; empty/claim-less graphs return empty arrays.
  - `manuscriptClaimsFromGraph(evidence, researchId)` convenience over a live graph.
- **`electron/research/research-service.ts`**
  - `manuscriptClaims(id)` — exposes the derivation so GUI IPC / a future live flow can feed a
    graph-derived manuscript.
- **`tests/graph-claims.test.ts`** (new, 4 tests) — claim → upstream evidence binding (incl.
  unbound claims → `[]`); derived claims flow through `buildSectionBriefs` + `evidenceCheckDraft`
  (real evidence passes, invented ids fail); empty/claim-less graphs; live integration where
  freeze → 2 real runs → analyze → `manuscriptClaims` returns the claim bound to ≥2 runs +
  statistic, with every derived evidence id verified present in the graph.

## Verification

- Targeted: `graph-claims` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Claim node ids carry the analyzer's `claim:<claimId>` prefix (analyzer is called with a
  `claim:…` id); the derivation returns the graph node id verbatim, so callers map
  `claimsToSections` with those ids.
- Live Level-B E2E still requires a GUI session; this slice makes the deterministic manuscript
  composition truthful about what recorded evidence actually supports.

## Checkpoint

Commit with: `electron/research/evidence/graph-claims.ts`,
`electron/research/research-service.ts`, `tests/graph-claims.test.ts`, this handoff.
