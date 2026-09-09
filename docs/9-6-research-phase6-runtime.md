# 9-6 Research Phase 6 — Independent Research Runtime

Compact handoff for codex-boss-9-6-research-plan.md Phase 6 (§6). Branch `9-6-research`.

## Why

Real research experiments/analysis must run on the local machine with a **structured** command
contract (never `shell:true` with a model-generated string), bounded output, cancellation,
concurrency limits and artifact capture. The existing EngineeringRuntime stays untouched; this
phase adds the separate research runtime under `electron/research/runtime/`.

## What was added

- **`src/shared/research-command.ts`** (new, pure)
  - `ResearchCommandSpec { executable, args, cwd, purpose (EXPERIMENT|ANALYSIS|TEST|BUILD|
    DATA_PROCESSING), timeoutMs, expectedOutputs?, environment? }`;
    `validateCommandSpec` fail-closed (bare executable, no shell metacharacters, bounded args);
    `executableAllowed` against an allow-list (python/node/npm/pnpm/git/pytest/tsx/npx,
    Windows `.exe` tolerant).
- **`electron/research/runtime/process-runner.ts`** (new)
  - `runStructuredProcess(spec, signal?)` — `spawn(executable, args)` with explicit cwd, bounded
    stdout/stderr capture (2 MB/1 MB), AbortSignal cancellation, timeout, expected-marker
    verification; returns `ProcessResult {code, output, timedOut, cancelled, passed, durationMs}`.
- **`electron/research/runtime/research-runtime.ts`** (new)
  - `ResearchRuntime({maxConcurrent})` — purpose-routed facade with an active-process budget
    (default 2, max 8) so a research model cannot exhaust the machine; `stats()`.
- **`electron/research/runtime/environment-manager.ts`** (new)
  - `prepareResearchCommand(spec)` (validate + allow-list, throws before any spawn),
    `captureResearchArtifact(directory, name, content)` (bounded hashed evidence file),
    `hashCommandSpec(spec)` for reproducible run identity.
- **`tests/research-runtime.test.ts`** (new, 5 tests) — spec validation + shell/metacharacter +
  allow-list rejection; deterministic command hashing + artifact capture; real structured node
  subprocess PASS with expected markers; missing marker fails; concurrency budget denies a
  second run while one is active.

## Verification

- Targeted: `research-runtime` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Executables outside the allow-list fail before spawn — the research model can only run tools
  the workspace authorizes. Purpose routing and evidence hashing are Phase 10's base.
- `experiment-runner`/`analysis-runner`/`resource-limiter`/`artifact-capture` split modules from
  the plan are represented by the purpose tag, concurrency budget and capture helpers above;
  additional thin wrappers can be added without changing the contract.

## Checkpoint

Commit with: `src/shared/research-command.ts`, `electron/research/runtime/process-runner.ts`,
`electron/research/runtime/research-runtime.ts`,
`electron/research/runtime/environment-manager.ts`, `tests/research-runtime.test.ts`,
this handoff.
