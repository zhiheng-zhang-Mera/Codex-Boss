# 9-6 Research Round 11 — Recorded Runs → Statistics → Claim Verdict

Compact handoff for the round-11 deterministic slice: analyze the real primary-run records that
`PrimaryRunRecorder` (round 10) persisted into the EvidenceGraph into deterministic statistics +
an evidence>vote claim verdict, and make the claim traceable to its runs in the graph.
Branch `9-6-research`.

## Why

Round 10 closed "run a real experiment → persist a protocol-bound PrimaryRunRecord", but the
records then sat unused: nothing computed the plan's Phase 10 statistics from them or decided a
claim with the Phase 8 rule (evidence > vote). This slice connects real recorded runs →
statistics → `adjudicateClaim`, entirely deterministically.

## What was added

- **`electron/research/evidence/run-analysis.ts`** (new)
  - `analyzeRecordedRuns(evidence, researchId, options)` — pulls the recorded runs bound to the
    frozen `protocolHash`, computes descriptive statistics (mean/median/sd, 95% CI) over the
    chosen metric, and adjudicates the claim with `adjudicateClaim`.
  - Fail-closed: no eligible runs → throws (never fabricate statistics); runs under a different
    protocol hash are excluded; `independentReplication` = at least two runs with distinct
    seeds under the same frozen protocol.
  - Traceability: adds `statistic:` + `claim:` nodes and `run → statistic → claim` edges to the
    evidence graph, so a claim is traceable to the real runs that support it.
- **`electron/research/research-service.ts`**
  - `analyzeRuns(id, options)` — same fail-closed rules as `runExperiment`: run must exist,
    protocol frozen, and the analysis protocol hash must match the frozen one.
- **`tests/run-analysis.test.ts`** (new, 5 tests) — deterministic records and *real* node
  subprocesses: two distinct-seed runs + votes → claim adopted (evidence + replication); a
  single run never adopts even with unanimous votes; no eligible runs throws; service
  composition (freeze → run 2 real experiments → analyze adopts); analysis rejected before
  freeze / on mismatched hash.

## Verification

- Targeted: `run-analysis` (5) + `run-recorder` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Statistics are deterministic code over real recorded runs; reviewer votes are injected (the
  live flow gets votes from web-AI reviewers). Real Level-B E2E (web-AI reviewers → RQ →
  experiment design → replication → manuscript) still requires a GUI session; this slice is the
  deterministic core the live flow calls after each experiment run.
- `main.ts` IPC not extended (main owns ledger/protocols/supervisor without an evidence-graph
  instance); a future live executor wires the recorder + analyzer.

## Checkpoint

Commit with: `electron/research/evidence/run-analysis.ts`,
`electron/research/research-service.ts`, `tests/run-analysis.test.ts`, this handoff.
