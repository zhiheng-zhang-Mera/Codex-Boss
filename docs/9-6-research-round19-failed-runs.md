# 9-6 Research Round 19 — Failed Runs Are Never Evidence

Compact handoff for the round-19 deterministic slice: `PrimaryRunRecorder` knew whether a real
process passed, but `PrimaryRunRecord` never stored it — a crashed experiment that still printed
a METRICS line was recorded and later counted by the round-11 analysis as if it were evidence.
Branch `9-6-research`.

## Why

Evidence > vote requires real experiments. A process that exits non-zero (or misses its expected
outputs) after printing a `METRICS` line must not contribute statistics: the recorder's returned
`passed` flag was dropped at persistence time, so `analyzeRecordedRuns` had no way to tell a
successful run from a crashed one. This is a fabricated-evidence hole, exactly what the plan
forbids.

## What was added

- **`electron/research/evidence/evidence-graph.ts`**
  - `PrimaryRunRecord.passed?: boolean` — true when the process exited 0 and produced its
    expected outputs; absent for legacy records (treated as eligible, matching prior behavior).
- **`electron/research/runtime/run-recorder.ts`**
  - Persists `passed` from the actual process result.
- **`electron/research/evidence/run-analysis.ts`**
  - `analyzeRecordedRuns` excludes runs with `passed === false` before computing statistics; if
    only failed runs exist for the metric, it throws (never fabricate statistics).
- **`tests/run-recorder.test.ts`** (+1) — real passing run records `passed: true`; a real run
  that exits 1 after printing METRICS is recorded with `passed: false` and persists.
- **`tests/run-analysis.test.ts`** (+1) — a failed run alongside a good one is excluded (no
  independent replication → not adopted); only-failed runs throw.

## Verification

- Targeted: `run-recorder` (6) + `run-analysis` (6) + `repro-audit` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Legacy run records without `passed` remain eligible (backward compatible). Live Level-B E2E
  still requires a GUI session; this slice keeps the deterministic evidence path honest about
  failed experiments.

## Checkpoint

Commit with: `electron/research/evidence/evidence-graph.ts`,
`electron/research/runtime/run-recorder.ts`, `electron/research/evidence/run-analysis.ts`,
`tests/run-recorder.test.ts`, `tests/run-analysis.test.ts`, this handoff.
