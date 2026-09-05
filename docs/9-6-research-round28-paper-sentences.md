# 9-6 Research Round 28 — Paper Sentences Traceable to Claims + Figures

Compact handoff for the round-28 deterministic slice: the evidence chain's terminal node kind
`paper-sentence` was never created — no code recorded that a manuscript section asserts a claim,
so traceability stopped at Claim/Figure. Branch `9-6-research`.

## Why

The plan's evidence chain ends at … Claim → Figure/Table → **Paper Sentence**, and Final
Acceptance I requires claims traceable to evidence. Rounds 10–22 made runs, statistics, claims
and figures traceable; the final hop — a paper section's statements bound to the claim and
figure nodes it asserts — was missing, so nothing linked the finished manuscript back to its
evidence.

## What was added

- **`electron/research/evidence/evidence-graph.ts`**
  - `addPaperSection(id, sectionId, { claimNodeIds, figureNodeIds }, label?)` — registers a
    `paper:<sectionId>` node of kind `paper-sentence` and edges from each claim/figure node the
    section asserts to it.
- **`electron/research/research-service.ts`**
  - `registerPaperSection(...)` facade wrapper returning the paper node id.
- **`tests/research-artifact-tree.test.ts`** (extended)
  - after manuscript assembly + figure registration, records `paper:abstract` and
    `paper:results` bound to `claim:accuracy` (+ `figure:accuracy` for results); asserts the
    node kinds and claim/figure → paper edges.

## Verification

- Targeted: `research-artifact-tree` (2) + `graph-claims` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Paper sections are recorded deterministically after assembly — never invented. Live Level-B
  E2E still requires a GUI session.

## Checkpoint

Commit with: `electron/research/evidence/evidence-graph.ts`,
`electron/research/research-service.ts`, `tests/research-artifact-tree.test.ts`, this handoff.
