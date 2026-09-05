# AP29a — Policy Optimizer Interface

Compact handoff for Acceptance Pack **AP29a** (plan §29 Policy Optimizer Interface). Branch `9-4`.

## Why

Production policy was a static `runtime-policy.json` plus hard-coded degradation heuristics; the
plan requires a unified policy interface (`choose_worker / choose_worker_count /
choose_context_budget / choose_decomposition_depth / choose_verification_level /
choose_parallelism`) with heuristic and statistical policies shipping as production defaults
and learned/bandit/RL policies reserved for research — never production dependencies.

## What was added

- **`src/shared/policy.ts`** (new, pure)
  - `PolicyContext { complexity L0–L3, runtimeStats[], physicalWorkers?, nativeAvailable }`;
    `PolicyDecision`; `PolicyOptimizer` interface with the plan's six `choose_*` methods and a
    `decide(context, optimizer)` helper.
  - `HeuristicPolicy` — deterministic: workers by complexity (L0/L1=1, L2=2, L3=3) capped by
    physical budget; context budget 4k/8k/16k/24k; depth 0/1/1/2; verification fast/standard/
    full; parallelism mirrors worker count.
  - `StatisticalPolicy` — same structure but verification escalates to full for L3 only when a
    credible (≥ `minSamples`) best-pass-rate runtime exists.
- **`tests/policy.test.ts`** (new, 3 tests) — unified decide() contract, heuristic complexity +
    physical cap, statistical preference behavior.

## Verification

- Targeted: `policy` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Interface + two production policies only. Learned/Bandit/RL policies are explicitly not part
  of the shipped surface (plan: research implementations never become production deps).
- Wiring `PolicyOptimizer` into PlanCompiler/degradation selection is the remaining AP29 half;
  today `runtime-policy.json` + DegradedController remain authoritative.

## Checkpoint

Commit with: `src/shared/policy.ts`, `tests/policy.test.ts`.
