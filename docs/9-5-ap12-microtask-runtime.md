# AP12 — Recursive Microtask Runtime Wiring (seam)

Compact handoff closing the remaining AP12 seam (plan AP12 / §13; audit: microtask model +
decomposition seed existed, runtime wiring absent). Branch `9-5`.

## Why

AP12a shipped the deterministic microtask model (read → propose → verify, ready-set,
`validateMicrotasks`) but nothing executed it — `EngineeringRuntime` only ran single-level TaskIR
steps. Plan AP12 requires recursive decomposition where a step expands into a bounded micro-DAG
with durable, restart-safe execution. This pack wires the micro-DAG runtime and exposes it to
step execution through the executor contract.

## What was added

- **`src/shared/microtask.ts`** (extended, pure)
  - `singleMicrotask(step)` — canonical read → propose → verify expansion for a single file
    group (used by the runtime wiring path).
- **`electron/engineering/microtask-runtime.ts`** (new)
  - `MicrotaskRuntime.runStep(taskId, step, microtasks, executor)` — durable ready-set execution
    of a step's micro-DAG: persisted DAG marker `graph_<stepId>_microtask` + per-microtask jobs
    `graph_<stepId>_microtask_<microtaskId>`, fingerprint-keyed reuse, **revalidation of
    persisted evidence before skipping**, `GraphDeferred` → WAITING, deadlock/failure fail-closed.
  - `GraphDeferred` re-exported (isolated module).
  - `MicrotaskRuntime.evidence()` — sha256 per-microtask evidence for §10 provenance.
- **`electron/engineering/engineering-runtime.ts`** (wired, default unchanged)
  - `GraphExecutor` gains optional `microtasks?: { decompose(step), execute(microtask),
    verify(microtask, output) }`. When an executor declares it and `decompose` returns a DAG,
    the step runs through `MicrotaskRuntime` and its output is the joined microtask outputs;
    executors without `microtasks` keep the exact single-step path (no regression).
- **`tests/microtask-runtime.test.ts`** (new, 4 tests) — single-scope decomposition; durable
  micro-DAG execution with per-microtask job persistence and restart reuse (revalidate, not
  re-execute); changed-DAG fail-closed + failure propagation; `EngineeringRuntime` microtask-mode
  end-to-end with reuse across re-runs.

## Verification

- Targeted: `microtask-runtime` (4) + `engineering-runtime` (3) + `microtask` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The wiring is opt-in: an executor that does not declare `microtasks` behaves byte-identically,
  so existing single-step plan execution and tests are unaffected.
- Ledger records are created when absent (mirroring `EngineeringRuntime`); the outer
  `graph_<stepId>` job (TaskStep fingerprint) and the inner `_microtask` scope are deliberately
  separate keys to avoid DAG-fingerprint collisions.
- Deeper Goal→Task→Subtask recursion (whole-plan expansion) remains a caller concern: this pack
  provides the runtime for one expanded step; `PlanRunner`/commander may decompose more steps.

## Checkpoint

Commit with: `src/shared/microtask.ts`, `electron/engineering/microtask-runtime.ts`,
`electron/engineering/engineering-runtime.ts`, `tests/microtask-runtime.test.ts`, this handoff.
