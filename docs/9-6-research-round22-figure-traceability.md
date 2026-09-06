# 9-6 Research Round 22 — Paper Figures Traceable in the Evidence Graph

Compact handoff for the round-22 deterministic slice: figures written into the manuscript tree
(round 21) were never registered in the evidence graph, so a paper figure had no provenance to
the runs that produced it. Branch `9-6-research`.

## Why

The plan's evidence-graph chain ends at Run → Metric → Statistic → Claim → Figure/Table → Paper
Sentence, and Final Acceptance I requires claims traceable to evidence. Rounds 10–13 made runs,
statistics and claims traceable; round 21 produced figure files but left them unregistered — a
reader could not verify which recorded runs a figure plotted.

## What was added

- **`electron/research/evidence/evidence-graph.ts`**
  - `addFigure(id, figureId, sourceNodeIds, label?)` — registers a `figure:<figureId>` node of
    kind `figure-table` and edges from each source evidence node (the runs it plots) to the
    figure. Idempotent node add + dedup edges.
- **`electron/research/research-service.ts`**
  - `registerFigure(id, figureId, sourceRunIds, label?)` — facade wrapper returning the figure
    node id.
- **`tests/research-artifact-tree.test.ts`** (extended)
  - after the manuscript writes `accuracy.svg`, the figure is registered against the real run
    node ids; asserts the `figure:accuracy` node exists and the graph carries exactly the
    run → figure edges for those runs.

## Verification

- Targeted: `research-artifact-tree` (2) + `graph-claims` (4) + `research-figures` (3) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The figure node is bound to real recorded runs only — never invented. Live Level-B E2E still
  requires a GUI session for web-AI reviewers / replication on the real repo.

## Checkpoint

Commit with: `electron/research/evidence/evidence-graph.ts`,
`electron/research/research-service.ts`, `tests/research-artifact-tree.test.ts`, this handoff.
