# 9-6 Research — ResearchService Facade + Deterministic Level-B Pipeline

Compact handoff for the research-mode glue between Phases 5–11 (research-service) and the
deterministic Phase 8→10 offline pipeline (levelb-pipeline-executor). Branch `9-6-research`.

## Why

Each research phase shipped a module (ledger, supervisor, protocol manager, evidence graph,
manuscript assembler, statistics) but nothing composed them, and there was no offline driver to
prove the phases interoperate. This adds one facade object (used by GUI IPC and tests) and a
deterministic Level-B pipeline executor that can run an *honest* end-to-end journey to real
statistics/evidence without web-AI (web-AI is only required for reviewer-gated stages).

## What was added

- **`electron/research/research-service.ts`** (new)
  - `ResearchService({root, executor})` composes `ResearchLedger` (ledger/), `ProtocolManager`
    (protocols/), `EvidenceGraph` (evidence/) and the `ResearchSupervisor` under one root.
  - `start/status/step/wait/fail/freeze/recordRun/hashProtocol/manuscript` — freeze() moves the
    run to PROTOCOL_FROZEN and records the canonical hash on the IR; manuscript() delegates to
    the Phase 11 assembler.
- **`electron/research/levelb-pipeline-executor.ts`** (new)
  - `LevelBPipelineExecutor({metricValues, votes, requiredVotes?})` — PROJECT_INSPECTION uses the
    real DefaultLevelBExecutor repo scan; EXPERIMENT_EXECUTION computes a deterministic
    statistic + runs `adjudicateClaim` (evidence>vote) from injected reviewer votes; ANALYSIS
    computes effect size + permutation p (seeded). RQ/literature/manuscript stages remain
    reviewer-gated and never fabricate evidence.
  - `researchServiceWithPipeline(root, runInput)` convenience factory.
- **`tests/research-service.test.ts`** (new, 3 tests) — offline autopilot journey
  (start → real repo inspection → reviewer-gated stage flagged honestly); protocol freeze moves
  to PROTOCOL_FROZEN + hash recorded + fail path; evidence-graph run + hash helper.
- **`tests/levelb-pipeline.test.ts`** (new, 2 tests) — deterministic pipeline reaches
  experiment/statistics/analysis decisions with `stat:` evidence; reviewer-gated stages surface
  the need instead of fabricating evidence.

## Verification

- Targeted: `research-service` (3) + `levelb-pipeline` (2) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The live web-AI Level-B flow (real reviewers → RQ → experiment implementation/execution →
  replication → manuscript) still requires a GUI session with logged-in providers; the
  service + deterministic executor give the offline half and the exact composition the live
  flow will use. Real experiments are never replaced by mocks.

## Checkpoint

Commit with: `electron/research/research-service.ts`,
`electron/research/levelb-pipeline-executor.ts`, `tests/research-service.test.ts`,
`tests/levelb-pipeline.test.ts`, this handoff.
