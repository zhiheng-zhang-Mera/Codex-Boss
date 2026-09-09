# AP08b — Evaluation Suite Core + Golden Task Format + Baseline Metric Store

Compact handoff for Acceptance Pack **AP08b** (plan §8 evaluation + §12 framework; v1-exit
"simple ≥95% / medium ≥85%" measurability). Branch `9-4`.

## Why

The audits found no evaluation device: only `scripts/benchmark.cjs` writes a controlled probe
to `artifacts/benchmark.json`, with `engineeringCompletionRates: "NOT_RUN"`. The plan requires
a golden-task format, a persistent baseline metric store and a runner so exit targets are
measured rather than asserted.

## What was added

- **`src/shared/evaluation.ts`** (new, pure)
  - `GoldenTask { id, name, complexity: simple|medium|complex, prompt, expectedContains }`;
    `EvaluationRecord` (per-task observable metrics: status/modelCalls/estimatedTokens/
    workerCalls/retries/latency/humanIntervention/sideEffects).
  - `EXIT_TARGETS = { simple: 0.95, medium: 0.85, complex: 0.7 }`;
    `summarizeBaseline(records)` → per-complexity pass/run/rate + `meetsExitTarget`;
    `NOT_RUN` excluded from the denominator.
- **`electron/evaluation/evaluation-store.ts`** (new)
  - `EvaluationStore` — schemaVersion-1 persisted JSON (`load/record/records/baseline/
    targets`); latest record per golden id so the baseline stays deterministic and bounded;
    fail-closed on corrupt files.
  - `runDeterministicGolden(store, golden, fixture?)` — runs a simple **L0 native** golden via
    the existing `compileIntent` + `executeNative` path (no model), records PASS/FAIL; a
    non-deterministic (AI) golden is recorded `NOT_RUN` instead of being faked.
- **`tests/evaluation.test.ts`** (new, 5 tests) — latest-record-per-golden + persisted
  baseline, fail-closed corrupt store, summary semantics (mixed/empty/NOT_RUN), real native
  golden PASS with zero model calls, AI golden → NOT_RUN.

## Verification

- Targeted: `evaluation` (5) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Medium/complex AI goldens are NOT_RUN by design here; running them requires a live provider
  matrix (the WebRecovery/AI harness fixtures) and stays outside the deterministic unit suite.
  The suite core + store makes the exit targets measurable — population evidence remains a
  manual/live step, consistent with the repo's honest `NOT_RUN` conventions.
- The store is file-scoped to its constructor path; wiring into app startup persistence
  (`.boss/evaluation.json`) and a CI/acceptance runner is follow-up.

## Checkpoint

Commit with: `src/shared/evaluation.ts`, `electron/evaluation/evaluation-store.ts`,
`tests/evaluation.test.ts`.
