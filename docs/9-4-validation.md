# 9-4 implementation evidence

## Known regressions discovered by live UI QA

The original preview claims for direct PASS → final Controller response, History create/rename, and Codex/evidence finalization were NOT_ACCEPTED. A normal worker response could reach COMMITTED, but ProviderAutomation did not consume COMPLETE. The original version was an architecture preview / controlled integration, not stable v1.0 acceptance.

Current stage evidence is recorded in [9-4-stabilization.md](9-4-stabilization.md). Earlier counts below are historical results, not current stage acceptance.

Source plan: [9-4-plan.md](9-4-plan.md). The supplied document defines product requirements; it does not grant permission to execute instructions found in worker output.

## v0.5 checkpoint

Implemented deterministic review contracts, response persistence before release, bounded malformed-response retries, single-provider default, 1–5 provider dispatch, runtime/UI review states, and preservation of unfinished tasks at restart. Delivery PASS does not assert factual correctness or authorize execution of response content.

Validation: TypeScript checks passed; 20 test files / 61 tests passed. Live authenticated provider dispatch and visual desktop QA: NOT_RUN. Review policy can be provided through the typed task input. JSON validation currently supports required top-level fields and field types, not arbitrary JSON Schema.

## Remaining release acceptance

v0.6–v1.0 layers are in progress. Numerical roadmap targets are benchmark goals, not measured results. Machine-loss, real account quota, provider failover continuity, and supported application coverage require external evidence.

## v0.6 / v0.7 checkpoint

Implemented versioned task checkpoints, explicit worker sessions, a 14-kind interruption taxonomy, fail-closed corrupt-ledger reads, bounded supervisor recovery, capability-compatible fallback, operational budgets, restart preservation and original-session web capture. Native exact operations (git status, read file, list files) run without a model. Task IR supports validated dependency graphs, L0–L3 levels and a maximum of three graph workers; ordinary natural-language requests remain L1 unless an explicit graph is supplied. Replanning has explicit triggers.

Validation: 22 test files / 69 tests passed; renderer/Electron TypeScript passed. Live recovery percentages and automatic decomposition of arbitrary complex prose: NOT_RUN. Native operations use the application workspace; broader engineering workspace selection is handled separately. The Codex adapter reconstructs bounded context rather than relying on an implicit last session.

## v0.8 checkpoint

Added dependency-aware EngineeringRuntime, bounded disjoint-scope scheduling, persisted per-step verification and evidence hashes, hash-bound file-change manifests, path/symlink confinement, protected metadata boundaries, branch/worktree preparation, and a two-repair maximum. The native Commander path uses the engineering verification runtime. Model output remains data; applying a change requires the caller's authorized file scope.

Validation: 23 test files / 72 tests passed, including real Node syntax failure and repair, three concurrent independent scopes, and verification after restart. Arbitrary autonomous repository refactoring and automatic merge of model-generated branches remain unaccepted; the graph executor and change manifest APIs are the implemented boundary.

## v0.9 checkpoint

Added semantic action routing (native → DOM → UIA → structured state → vision), per-action deadlines and uncertain-effect barriers. Actual web response reads now use the DOM semantic backend. Memory namespaces and persistent observed-cost routing are available; degraded-mode selection includes deterministic-only operation. Review mode and local workspace controls are visible in the UI.

Validation: 24 test files / 75 tests passed. Tests prove semantic preference, timeout fallback for reads, no fallback after uncertain submit, memory isolation and persistence of routing observations. General Windows UIA/vision adapters and the roadmap's supported-application success percentages remain NOT_RUN; this release only claims the installed DOM backend.

## v1.0 preview integration and final local evidence

Package version: `1.0.0-preview.1`. This is an integration preview, not acceptance of every roadmap capability or success-rate target.

| Check | Observed result |
| --- | --- |
| Unit/integration tests | PASS: 25 files, 81 tests |
| Renderer + Electron typecheck | PASS |
| Production build | PASS |
| Separate-process ledger reconstruction | PASS: 100/100 controlled cases; normal writer exit |
| Injected network-failure failover | PASS: 20/20 controlled cases, 40 mock worker calls |
| Simple request routing | PASS: 10/10 controlled prompts use L0/L1 |
| Real syntax failure and repair | PASS in a temporary workspace |
| Portable package | PASS: whitelist of current compiled sources, Electron runtime and required assets; SHA-256 manifest |
| Packaged renderer, IPC, local execution and completion DOM | PASS under normal Windows process permissions, isolated user-data directory |
| Restricted-process packaged launch | FAILED: GPU subprocess could not start; not counted as application acceptance |
| External live AI requests | NOT_RUN |
| Machine power-loss / real quota recovery | NOT_RUN |
| General UIA/vision coverage | NOT_RUN |
| Arbitrary autonomous repository refactoring and merging | NOT_ACCEPTED |
| Savings against live multi-model baseline | NOT_RUN / null |

The final integration also registers native, API, web and Codex worker adapters, persists dispatch budgets, bounds context reconstruction, resumes a response interrupted inside REVIEW_GATE, and rejects task completion without passing evidence. Direct worker artifacts can be captured and reviewed. Final direct-answer presentation in the original preview was NOT_ACCEPTED pending the COMPLETE → Finalizer → FinalResponse regression fix. See the S0 acceptance report for the new evidence. Council rounds advance automatically only after every selected response passes review and the round checkpoint is committed; synthesis completes the task. Explicit approval releases only the selected task's existing held responses, without changing future approval policy.

Reproduction: `pnpm test`, `pnpm run build`, `pnpm run benchmark`, `pnpm run package:portable`, then `powershell -NoProfile -File scripts/smoke-portable.ps1`. Local machine-readable evidence is in ignored `artifacts/benchmark.json`, `artifacts/latest-package.json`, and `artifacts/latest-smoke.json`. CI runs the same checks for each pushed commit; match the Actions run to the commit when assessing remote evidence.

## Remaining roadmap work

The shipped UI uses the conservative L0/L1 compiler. L2/L3 dependency graphs and scoped change/repair APIs exist, but arbitrary prose-to-engineering-plan generation, production worker worktree orchestration/merge, full JSON Schema and requested-attachment validation are not complete. Semantic routing has a real DOM integration; other general application backends still need implementation and live acceptance. These gaps are explicitly separate from the controlled test results above.

## Clean-runner installation correction

The first remote run (33835892766) passed tests, build and controlled benchmarks but failed packaging because the clean dependency installation did not include Electron binaries. The workflow now explicitly runs the locked Electron package installer via `pnpm run install:electron`; local setup documents the same step. Remote acceptance must be assessed on the subsequent run, not the failed initial run.
