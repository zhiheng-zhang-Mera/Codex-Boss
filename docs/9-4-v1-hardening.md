# S5 stable V1.0 hardening

Status: locally accepted for V1.0 release. Remote publication and terminal CI must still match the release commit before the stage is closed.

S4 checkpoint was `f7fdfbde22f0b7e59a0a63cdff620dfe7ca300cb` on `9-4`, with Desktop CI run `33893273495` successful. S5 keeps the Commander, TaskIR, EngineeringRuntime, SemanticRuntime, ledger and runtime architecture and limits changes to reliability, UX, migration, observability, packaging, benchmarks and acceptance.

## Gate F evidence

| Gate | Accepted evidence |
| --- | --- |
| Packaged E2E | External UI automation on the final source build clicked New conversation, created and renamed `Final Package Restored`, closed the process, restarted the same D-drive data root, and observed the same active title and history file. Machine result: `artifacts/final-package-e2e-378d539de23049029a90018a4c1f588f/result.json`. The promoted package is `artifacts/Codex-Boss-1.0.0-1788573653081`; its embedded package metadata is `1.0.0` and its normal-desktop smoke passed at `artifacts/smoke-3d4b26cc1ae941b5a4f41e59b8a33b8b/smoke-result.json`. |
| Live provider matrix | One current, concurrent visible-web task ran against independent ChatGPT, Gemini and Qwen sessions. All three returned exactly `BOSS_S5_MATRIX_OK`, all deterministic reviews passed, the all-provider checkpoint committed, and the FinalResponse bound all three artifact IDs. Result and UI screenshot: `artifacts/live-provider-matrix-7f5e3f6d-2a79-49b0-b01d-a6a6f9edb60f/result.json`. A separate current ChatGPT task completed with one model call, one browser action and zero retries at `artifacts/s5-live-web.json`. |
| Long-horizon benchmark | The live interrupted-response case restored its exact session URL without resend and completed a 60-line answer ending `BOSS_S1_RESUME_OK` at `artifacts/s1/live-recovery.json`. The bounded V1 corpus also contains a real L2 multi-step plan and a real tasks.md engineering modification with host tests. `artifacts/v1-acceptance-audit.json` reports simple 4/4, medium 1/1, complex 1/1 and long-horizon 1/1 against the plan targets. These are bounded observed rates; the report keeps `populationClaim: NOT_ESTABLISHED`. |
| Migration | `AppSnapshot` is schema version 2. Unversioned/v1 state is backed up byte-for-byte before atomic migration; future versions fail closed. The persistent-root migration now covers state, API settings, task context, `.boss` ledger/budget/recovery/resources, `.codex-boss` runtime context and history. It never deletes the source or overwrites a differing destination; conflicts are copied to a D-drive migration backup. The actual LocalAppData migration copied 58 and verified 60 files, including `.boss`, with two differing files preserved for reconciliation at `runtime-data/.codex-boss-data-migration-v1.json`. Browser login storage remains covered by the separately hash-verified profile migration. |
| Resource comparison | The like-for-like live Codex CLI case used one call on the optimized direct path and three calls on the naive always-plan plus two-worker path, a 66.7% reduction, at `artifacts/resource-2888efb0-ec25-4a97-80e5-d2ab4a697daa/result.json`. This establishes the simple-task target for the bounded case; it is not medium/complex population evidence. |
| Stable UX | FinalResponse is the primary answer; review, timeline and execution evidence are expandable. Nine user states do not show completion before a persisted final exists. Users can select direct, automatic, optional Codex or required Codex finalization and retry a required synthesis. Follow-latest scrolling stops when the user reads earlier content. Actual source and packaged history UI clicks passed. |

## Finalization, isolation and observability

Commander owns every completion path. Synthesis uses only `codex:cli` and current-round accepted artifacts, with a 64k source bound and no unrelated memory or web fallback. Optional failure retains the accepted answer; required failure waits and supports persisted retry. Cached synthesis survives restart without another call, late cancellation cannot publish a final, and requested output contracts are rechecked after synthesis. The live required-synthesis case produced exactly `2 + 3 = 5. BOSS_S5_SYNTHESIS_OK` with one model call and reused the same final ID after restart at `artifacts/finalization-f1c4809e-70db-4769-870d-453defbdecd1/result.json`.

Each new internal web worker starts from the configured new-chat URL. Interrupted workers retain their recorded session URL and resume without resend. A per-provider preparation lease prevents concurrent workers from navigating the same provider view. The task timeline projects observed timestamps, step IDs, runtime IDs and evidence references in chronological order; absent budget telemetry stays absent rather than becoming zero.

## Definition of Done audit

| Required path | Evidence |
| --- | --- |
| Read tasks.md, determine complexity and compile TaskIR | The live engineering case read `tasks.md`, produced a validated L2 TaskIR and persisted it in `artifacts/s3/live-web-result.json`. |
| Select branch/worktree and minimum workers | The same case selected branch `codex/a9e5b8f7-7aad-408e-a9e9-f39300662b82` and used one worker. L3 worktree isolation and bounded merge are covered by the merge integration tests. |
| Modify, verify and targeted repair | The live case changed only `sum.cjs`, kept `sum.test.cjs` unchanged, ran real syntax/tests/diff checks and returned host evidence. The full integration suite exercises a real initial test failure followed by one scoped repair. |
| Provider/quota recovery or degradation | Browser crash, session expiry, network outage, quota persistence/failover and killed worker process paths have direct controlled process evidence; successful work is checkpointed and not repeated. |
| Restart continuation | Real live provider session restoration and the controlled Electron restart both resume from persisted checkpoint state and expose a final answer. |
| Merge/final workspace | Parallel worktree changes are hash-bound, serialized into the final workspace and reverified. Branch-isolated medium-risk work remains in the named final branch for review. |
| Evidence and FinalResponse | Completion is blocked without evidence. Current-round artifact IDs bind the evidence bundle and FinalResponse, and the answer appears in the Controller without Capture, Advance, Build Evidence, Codex Review or Continue on the normal path. |

## Final local validation

The final source regression passed 151 tests in 41 files. Renderer and Electron type checks, production build, the controlled benchmark and portable packaging passed. The controlled benchmark retained `NOT_RUN` for machine power loss, broad engineering completion populations and semantic application coverage. The machine-readable V1 evidence audit passed every listed gate while retaining `populationClaim: NOT_ESTABLISHED` and limiting the live provider claim to the three current sessions tested on this machine.

The `1.0.0` package and packaged smoke are complete. Release closure requires: verify the intended Git diff, commit only source/tests/docs/scripts, push `9-4`, compare local and remote SHA, and wait for terminal CI success.
