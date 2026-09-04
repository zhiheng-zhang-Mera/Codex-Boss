# 9-4 implementation evidence

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
