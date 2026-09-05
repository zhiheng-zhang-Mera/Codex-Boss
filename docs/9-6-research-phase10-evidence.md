# 9-6 Research Phase 10 — Deterministic Statistics + Evidence Graph

Compact handoff for codex-boss-9-6-research-plan.md Phase 10 (§10 core; live E2E wiring deferred).
Branch `9-6-research`.

## Why

Formal research statistics must be produced by deterministic code (raw data → statistics.json →
LLM interpretation), primary findings require original run + independent replication, and every
primary experiment must persist full provenance. None of that existed. This phase ships the
deterministic stats core and the durable evidence graph + run provenance store.

## What was added

- **`src/shared/research-statistics.ts`** (new, pure)
  - `mean/median/standardDeviation/describe`, `confidenceInterval` (normal approx);
  - `mulberry32(seed)` deterministic PRNG, `bootstrapCi` (seedable, reproducible), `effectSize`
    (Cohen's d), `permutationP` (seedable permutation test), `proportion`.
- **`electron/research/evidence/evidence-graph.ts`** (new)
  - `PrimaryRunRecord` (runId, experimentId, protocolHash, git commit + dirty, command/args,
    environment fingerprint, dependency-lock hash, seed, input/output/stdout-stderr hashes,
    metrics, duration, hardware, timestamp);
  - `EvidenceGraph(root)` — durable nodes/edges for the plan chain
    (research-question → hypothesis → protocol → experiment → run → metric → statistic → claim
    → figure-table → paper-sentence), per-run provenance JSON, fail-closed corrupt reads,
    traversal-safe ids.
- **`tests/research-evidence.test.ts`** (new, 5 tests) — stats determinism (mean/median/sd/CI);
  seed-reproducible bootstrap CI; effect size + permutation p-value bounds; run provenance +
  evidence graph persistence; traversal rejection + corrupt-graph fail-closed.

## Verification

- Targeted: `research-evidence` (5) PASS; typecheck PASS.
- Full suite: **92 files / 437 tests PASS** (run after this batch).

## Boundary notes

- Statistics are deterministic and offline; bootstrap/permutation use fixed seeds so any
  replication reproduces identical numbers (raw data → statistics.json → LLM interpretation).
- The EvidenceGraph is storage; Level-B pipeline (Phase 8) will populate it from real
  experiment runs, and the manuscript pipeline (Phase 11) will read claim→sentence edges.

## Checkpoint

Commit with: `src/shared/research-statistics.ts`,
`electron/research/evidence/evidence-graph.ts`, `tests/research-evidence.test.ts`, this handoff.
