# AP14a — Resource Model + Physical Backpressure

Compact handoff for Acceptance Pack **AP14a** (plan §14 resource-aware parallelism + §13.7
backpressure; audit: width 1–3 + degradation exist, no resource model API). Branch `9-4`.

## Why

The plan wants the scheduler to consider logical task capacity and physical resource capacity
together (CPU/RAM/browser slots …), with backpressure instead of a free-running worker pool.
Concurrency today is decided by `degradation` (1 or min(3, eligible)) without a physical budget.
This pack adds the deterministic capacity gate and capability matrix, and enforces the physical
cap in `DegradedController` when a budget is supplied (default keeps current behavior).

## What was added

- **`src/shared/resource-model.ts`** (new, pure)
  - `PhysicalBudget { workers, memoryMb?, browserSlots? }`; `ResourceDemand`; `capacityFor`
    returns `allowedWorkers` + a clear reason (`unlimited`/`logical_cap`/`physical_cap`/
    `no_workers`).
  - `workerCapabilityMatrix(workers)` → counts of model/browser/native-only workers.
- **`electron/commander/degraded-controller.ts`**
  - Accepts an optional `PhysicalBudget`; FULL-mode concurrency is further bounded by
    `capacityFor` and the reason mentions "physical budget caps workers". No budget supplied =
    previous behavior (tests prove both paths).
- **`tests/resource-model.test.ts`** (new, 5 tests) — physical/logical/unlimited/no-workers
  cases, capability matrix, and DegradedController backpressure (none / capped / single-worker
  unaffected).

## Verification

- Targeted: `resource-model` (5) + `degraded-controller` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Only a `workers` physical budget is wired so far; memoryMb/browserSlots are reserved on the
  type for later integration with real host capacity probes. `Dynamic 1/3/5` worker-count policy
  selection is the remaining AP14 half.

## Checkpoint

Commit with: `src/shared/resource-model.ts`, `electron/commander/degraded-controller.ts`,
`tests/resource-model.test.ts`.
