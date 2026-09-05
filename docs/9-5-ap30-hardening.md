# AP30 — Full-System Hardening Matrix

Compact handoff for Acceptance Pack **AP30** (plan §30 Full-System Hardening; audit: controlled
suites covered some recovery/restart/crash paths, the plan's matrix was NOT_RUN). Branch `9-5`.

## Why

Plan §30 lists ~25 failure scenarios (provider outage … long-running soak) but the repo had no
explicit matrix: coverage was implicit in the vitest suite, live-only rows were a vague "NOT_RUN",
and no deterministic in-process runner produced an evidence report. This pack makes the matrix
explicit — every scenario names its coverage device, in-process rows are probed against the real
modules, live rows carry a documented reason.

## What was added

- **`src/shared/hardening-matrix.ts`** (new, pure)
  - `HARDENING_SCENARIOS` — the §30 list with `coverage: unit|integration|live` and the specific
    test suites that exercise each row; live rows (Blender crash, Unreal crash, soak) carry the
    reason they are not run per-commit.
  - `HardeningRow/HardeningReport`, `summarizeHardening(results)` (PASS/FAIL/NOT_RUN totals),
    `inProcessScenarioIds()`.
- **`electron/hardening/hardening-runner.ts`** (new)
  - `runHardeningMatrix(probes, reportFile?)` — runs deterministic rows through caller/injected
    fail-closed probes against the real modules and writes a schemaVersion-1 evidence report;
    missing/live rows → NOT_RUN.
  - `loadHardeningReport(file)` fail-closed reader.
- **`tests/hardening-matrix.test.ts`** (new, 4 tests) — vocabulary completeness + live-row
  reasons; summarization + NOT_RUN accounting; real-module probes (Guardian denial, secret
  sanitization, adapter version mismatch, software lease conflict, circuit breaker OPEN) with a
  persisted evidence report; deterministic-subset id list.

## Verification

- Targeted: `hardening-matrix` (4) PASS; typecheck PASS.
- Full suite: run with the final batch before landing.

## Boundary notes

- In-process probes exercise the deterministic modules (guardian, secret-scan, compatibility,
  software-lease, circuit-breaker). Live-only rows are intentionally NOT_RUN in CI with explicit
  reasons; the acceptance scripts (`acceptance-*.cjs`) and packaged smoke remain the live
  devices for those scenarios.
- Adopting `runHardeningMatrix` in a maintenance IPC / CI evidence step is the follow-up wiring
  seam; the report format is stable so any runner can consume it.

## Checkpoint

Commit with: `src/shared/hardening-matrix.ts`, `electron/hardening/hardening-runner.ts`,
`tests/hardening-matrix.test.ts`, this handoff.
