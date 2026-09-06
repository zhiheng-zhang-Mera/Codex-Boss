# 9-6 Research Round 15 — Offline Artifact-Tree E2E + Clean Claim Node Ids

Compact handoff for the round-15 deterministic slice: prove the whole offline composition —
freeze → real experiment runs → analysis → reproducibility audit → citation audit → graph-derived
claims → manuscript tree — in one end-to-end test, and normalize evidence-graph claim node ids
(no more double `claim:` prefix). Branch `9-6-research`.

## Why

Rounds 10–14 each closed one composition seam, but nothing proved the seams work *together*:
starting one research run, freezing its protocol, running two real experiments, analyzing them,
auditing reproducibility and citations, deriving manuscript claims from the graph, and writing
the plan's artifact tree (`paper.md`/`paper.tex`/`references.bib` + `audit/citations.json` +
`audit/reproducibility.json` + `audit/final-audit.json`) with truthful integrity flags. Also,
`analyzeRecordedRuns` wrote claim node ids like `claim:claim:accuracy` (double prefix) because it
prefixed an already-prefixed claim id.

## What was added

- **`electron/research/research-service.ts`**
  - `ResearchService` now also owns a durable `CitationSourceStore` (`root/citations`), so a
    full run composes citations from the store.
- **`electron/research/evidence/run-analysis.ts`**
  - Claim node ids are namespaced exactly once: the claim node id equals the claim id when
    already prefixed (`claim:accuracy`), otherwise it is prefixed once; the statistic node id
    stays `stat:<claimId>` (matching pipeline `stat:claim:pipeline` evidence refs).
- **`tests/research-artifact-tree.test.ts`** (new, 2 tests) — full offline artifact-tree E2E with
  real node subprocesses:
  1. freeze → 2 real runs → analysis adopted → reproducibility REPRODUCED → citation store with
     one verified + one UNSUPPORTED → manuscript derived from graph → tree written, and
     `final-audit.passed` fails closed because an UNSUPPORTED citation is bound;
  2. integrity passes end-to-end when every citation verifies (`passed: true`,
     `citations.ok: true`).
- Updated expectations in `run-analysis`, `graph-claims` tests for the clean claim node id.

## Verification

- Targeted: `research-artifact-tree` (2) + `run-analysis` (5) + `graph-claims` (4) +
  `repro-audit` (4) + `citation-audit` (3) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- This is the deterministic offline composition; live Level-B E2E (web-AI reviewers → RQ →
  experiment implementation → replication on the real repo → `paper.pdf`) still requires a GUI
  session. The offline tree is produced from real recorded runs — never mocks.

## Checkpoint

Commit with: `electron/research/research-service.ts`,
`electron/research/evidence/run-analysis.ts`, `tests/research-artifact-tree.test.ts`,
`tests/run-analysis.test.ts`, `tests/graph-claims.test.ts`, this handoff.
