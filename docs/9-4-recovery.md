# S1 recovery closure

S0 was published as 3c308b3; Desktop CI 33841986205 completed successfully before this stage began.

Runtime budgets now persist observed levels, reset deadlines, failure counts and last success. Retry deadlines are durable queue entries with bounded attempts; startup reconstructs due work. Web recovery restores the same saved session for capture, blocks ambiguous prior sends, and stops polling during waits. Session URLs and health update in the ledger. API Retry-After survives into supervisor recovery. API/CLI jobs resume their saved identity; compatible fallback preserves completed work and uncertain side effects still require reconciliation. Paused recovery is visible in the Controller.

## Acceptance evidence

- UNIT / CONTROLLED_INTEGRATION: 93 tests passed in 27 files. Focused final recovery/API checks also passed. Typecheck, production build and the controlled benchmark passed.
- Actual loopback HTTP: injected 429 with Retry-After, reconstructed recovery scheduler, success after deadline. Exactly two HTTP requests; another completed-job read did not dispatch. This is controlled integration, not a commercial API acceptance claim.
- LIVE_PROVIDER CLI: actual Codex CLI returned BOSS_CLI_RECOVERY_OK. Combined CLI/HTTP evidence: artifacts/recovery-3a5c8140-23f5-4382-8836-509f6706b349/result.json.
- LIVE_PROVIDER Web: ChatGPT request 35394a62-0f43-442a-a8f7-585cea75171a. Closed the visible provider view after its session URL was persisted. The timer reopened the original session and captured BOSS_S1_RESUME_OK as a FinalResponse automatically. Ledger: one model call, one session. Evidence: artifacts/s1/live-recovery.json and live-uia.txt.
- Restart: persisted final answer and active conversation restored in the real desktop on S1 startup. Queue/session restart behavior is additionally covered by controlled tests.
- PACKAGED_E2E: PASS. artifacts/smoke-eb99453615a747d580e984f54ebfcd66/smoke-result.json confirms renderer, real native IPC execution and FinalResponse presentation.

Limits: live interruption was provider-view closure, not machine power loss; quota tests used injected faults, not deliberate exhaustion of a paid account. Third-party authenticated API coverage is not claimed. The remaining S2–S5 gates are still required for stable v1.0.
