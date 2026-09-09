# AP12a — Microtask DAG + Recursive Decomposition (seed)

Compact handoff for Acceptance Pack **AP12a** (plan AP12 / §13 incremental; audit: single-level
TaskIR step DAG exists, no microtask recursion). Branch `9-4`.

## Why

The plan wants Goal → Task → Subtask → Microtask → Acceptance Unit decomposition with ready/
blocked scheduling. The repo has a single-level TaskIR step graph; this pack adds the
deterministic microtask model and the canonical read → propose → verify expansion for an edit
step, validated against the existing TaskIR graph rules so the EngineeringRuntime can consume it
unchanged later.

## What was added

- **`src/shared/microtask.ts`** (new, pure)
  - `MicrotaskKind = read|propose|verify|join`; `Microtask { id, kind, parentStepId,
    description, dependencies, requiredFiles }`.
  - `decomposeStep(step, {splitJoin?, maxFilesPerProposal?})` — expands an edit step into
    `read_i → propose_i` per bounded file chunk plus a final `verify` (and optional `join`).
  - `readyMicrotasks(micro, completed)` — incremental ready set.
  - `validateMicrotasks(micro)` — duplicate ids, missing dependencies, file-scope budget and
    full TaskIR `validateGraph` compatibility (microtask ids stay TaskIR-valid).
- **`tests/microtask.test.ts`** (new, 4 tests) — canonical read→propose→verify expansion,
  chunking wide file scopes, incremental ready-set computation, invalid DAG rejection.

## Verification

- Targeted: `microtask` (4) + `intent-compiler` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the decomposition model/seed; wiring the expanded micro-DAG into
  `EngineeringRuntime`/`PlanRunner` execution (and persisted microtask jobs in the ledger) is the
  remaining AP12 half.
- Only worker/edit steps decompose today; native and verify steps are already atomic.

## Checkpoint

Commit with: `src/shared/microtask.ts`, `tests/microtask.test.ts`.
