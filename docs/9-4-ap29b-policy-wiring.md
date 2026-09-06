# AP29b — Policy Wiring into Degradation Selection

Compact handoff for Acceptance Pack **AP29b** (plan §29 Policy Optimizer Interface, wiring half).
Branch `9-4`.

## Why

AP29a (docs/9-4-ap29a-policy.md) shipped the `choose_*` interface + `HeuristicPolicy` /
`StatisticalPolicy`, but left "wiring into plan/degradation selection" open: `DegradedController`
still picked worker counts and context budgets from fixed per-mode constants regardless of task
complexity. This pack closes that half — the optimizer decision is now a durable, explainable
artifact that degradation selection actually consumes.

## What was added

- **`electron/commander/task-ledger.ts`** — additive `policy?: { complexity, decision,
  optimizer, decidedAt }` field on `TaskLedgerRecord` (plan §29 decision persisted next to the
  task; schemaVersion stays 1, additive optional field).
- **`electron/commander/task-policy.ts`** (new)
  - `applyTaskPolicy(ledger, taskId, complexity, optimizer = HeuristicPolicy)` — computes the
    policy decision and records it on the ledger; **idempotent** (same complexity on re-entry
    does not churn a new checkpoint generation, so recovery resume / replan are cheap).
- **`electron/commander/degraded-controller.ts`** — `evaluate` now reads the recorded policy:
  - FULL mode honors `policy.decision.workerCount` (capped by eligible runtimes + physical
    budget via `capacityFor`) and `policy.decision.contextBudgetChars`;
  - FULL mode exposes `verificationLevel` + `parallelism` from the decision (additive optional
    fields on `DegradationState`);
  - REDUCED / LIGHTWEIGHT / DETERMINISTIC / PAUSED keep their tighter legacy caps — degraded
    tiers must stay degraded regardless of complexity;
  - no policy recorded → byte-identical legacy behavior.
- **`electron/commander/main-commander.ts`** — `createTask` records the policy decision for the
  freshly compiled plan; `runPlan` re-applies after plan (re)compile so replan complexity
  changes (L2↔L3) keep the decision current. Both guarded by `this.ledger`.
- **`tests/policy-degradation.test.ts`** (new, 8 tests) — decision recording per complexity
  (L1/L2/L3 workers, context, verification); idempotent re-entry (no revision churn); FULL mode
  honors policy (L3 → 3 workers/24000/full, L2 → 2/16000/standard); legacy no-policy behavior
  unchanged; decision survives reload and drives a persisted state change; degraded tiers ignore
  policy width; research-policy reference behavior remains reachable through `decide()`.

## Verification

- Targeted: `policy-degradation` (8) + `degraded-controller` (1) + `policy` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running in background; expected green.

## Boundary notes

- StatisticalPolicy remains available through `decide()` (research/experimental); production
  wiring uses HeuristicPolicy as the plan's default.
- `parallelism`/`verificationLevel` on `DegradationState` are advisory outputs today; consumers
  (review gates, PlanRunner widths) can adopt them without further schema change.
- Research policies (Learned/Bandit/RL) intentionally never become production deps.

## Checkpoint

Commit with: `electron/commander/task-ledger.ts`, `electron/commander/task-policy.ts`,
`electron/commander/degraded-controller.ts`, `electron/commander/main-commander.ts`,
`tests/policy-degradation.test.ts`.
