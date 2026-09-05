# 9-6 Research Round 31 — Complete the Evidence Chain (Question → … → Experiment)

Compact handoff for the round-31 deterministic slice: the evidence graph's head nodes were never
materialized — `addRun` wrote `experiment:<id> → run:<id>` edges but no `experiment:` node
existed, and there were no research-question / hypothesis / protocol anchors, so edges dangled
and the plan chain (Question → Hypothesis → Protocol → Experiment → Run → …) was incomplete.
Branch `9-6-research`.

## Why

Final Acceptance I requires claims traceable to evidence through the full chain. Rounds 11–28
made run → statistic → claim → figure → paper links traceable; the head of the chain
(question/hypothesis/protocol/experiment) was referenced by edges but never created as nodes,
leaving dangling references and an untraceable start of the graph.

## What was added

- **`electron/research/evidence/evidence-graph.ts`**
  - `syncChain(id, { questions, hypotheses, protocolHash, experimentIds })` — idempotently
    creates `question:q<i>`, `hypothesis:h<i>`, `protocol:<hash16>`, `experiment:<exp>` nodes
    and the question → hypothesis → protocol → experiment edges (deduped), so no edge dangles.
- **`electron/research/research-service.ts`**
  - `syncEvidenceChain(id)` facade derived from the ledger IR (researchQuestions + hypotheses +
    protocolHash) and recorded run experiment ids.
- **`tests/research-artifact-tree.test.ts`** (extended) — after freeze + real runs + figure
    registration, `syncEvidenceChain` runs and **every edge target exists** (no dangling nodes);
    the protocol + experiment nodes and protocol → experiment edge are asserted.
- **`tests/research-evidence.test.ts`** (+1 test) — full head-chain unit test: all edge targets
    exist, node kinds correct, and a second sync is idempotent (no duplicate nodes/edges).

## Verification

- Targeted: `research-artifact-tree` (2) + `research-evidence` (7) + `graph-claims` (4) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Deterministic graph materialization from durable IR/runs; live Level-B E2E still requires a
  GUI session for web-AI reviewers / real replication.

## Checkpoint

Commit with: `electron/research/evidence/evidence-graph.ts`,
`electron/research/research-service.ts`, `tests/research-evidence.test.ts`,
`tests/research-artifact-tree.test.ts`, this handoff.
