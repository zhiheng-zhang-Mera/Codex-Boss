# AP06b — Cheapest-Sufficient Execution (cost model)

Compact handoff for Acceptance Pack **AP06b** (plan AP06 + §13.2 fast/slow path; audit:
cheapest-sufficient = preference + ResourceController score only). Branch `9-4`.

## Why

The intent compiler routes L0 native work without a model, but the planner-facing "cheapest
sufficient" decision was only preference order plus an observed pass-rate score — there was no
cost model that could answer "which supported executor is cheapest for this capability?". This
pack adds the deterministic cost/kind model and capability→kind resolution.

## What was added

- **`src/shared/cheapest-execution.ts`** (new, pure)
  - `ExecutionCostKind = deterministic|api|web|codex` with `COST_ORDER`;
    `CandidateExecution { runtimeId, kind, passRate?, supported }`;
    `chooseCheapestSufficient(input)`:
    - deterministic executor preferred for native/file/computer capabilities;
    - otherwise candidates sorted by cost then pass rate;
    - never picks an unsupported candidate (returns `null` + reason);
    - `resolveCapabilityToKind(capability)` maps free text (read file/computer/web/codex/
      reasoning) to an execution kind or `unknown`.
- **`tests/cheapest-execution.test.ts`** (new, 5 tests) — native→deterministic preference,
  cheapest AI executor, cost-then-pass-rate ordering with unsupported exclusion, no-supported
  → null, capability-kind mapping.

## Verification

- Targeted: `cheapest-execution` (5) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the cost-model seed. Wiring it into RoleRouter/supervisor candidate ordering (and
  resolving `TaskIR.requiredCapabilities` against the capability graph) is the remaining AP06
  half; the current router preference + budget gating stays authoritative until then.
- Pass rates come from `ResourceController.score`; candidates declare `supported` (role
  capability lists today).

## Checkpoint

Commit with: `src/shared/cheapest-execution.ts`, `tests/cheapest-execution.test.ts`.
