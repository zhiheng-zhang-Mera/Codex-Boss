# AP03b — Runtime Circuit Breaker (CLOSED / OPEN / HALF_OPEN)

Compact handoff for Acceptance Pack **AP03b** (plan §9 "Cancellation / Timeout / Circuit
Breaker"; v1 exit: *provider-specific failure does not kill BOSS*). Branch `9-4`.

## Why

The plan mandates provider health with `CLOSED / OPEN / HALF_OPEN` and a circuit breaker
tripped by consecutive failures, and forbids infinite retry / a bad provider dragging the whole
system. Before this pack the repo only had one-shot budget/health isolation
(`BudgetManager` EXHAUSTED/LOW, `RuntimeRegistry` availability, `RoleRouter` filtering) and no
breaker anywhere. This pack adds the missing half of AP03 (the ledger/checkpoint/recovery half
already PASS).

## What was added

- **`electron/commander/circuit-breaker.ts`** (new)
  - Per-runtime state machine `CLOSED → OPEN → HALF_OPEN` with `failureThreshold`
    (default 3 consecutive provider-technical failures), `cooldownMs` (default 60s), injectable
    clock for deterministic tests.
  - `observeSuccess` resets; `observeFailure` counts and trips; after cooldown the state is
    derived `HALF_OPEN` and `admit()` allows exactly one probe (bounded concurrent probes).
  - `providerTechnicalInterruption(kind)` classifies which interruption kinds count
    (NETWORK_FAILURE / PROVIDER_5XX / TOOL_TIMEOUT / BROWSER_CRASH / PROCESS_CRASH /
    RESOURCE_EXHAUSTED). User/auth/quota/rate-limit and unknown states do **not** trip it.
  - Optional durable persistence `{schemaVersion: 1, records[]}` via `durable-json`, fail-closed
    on corrupt/future-version files.
- **`electron/commander/execution-supervisor.ts`**
  - Accepts an optional `CircuitBreaker`.
  - `isOpen()` filters broken providers out of compatible candidates; `admit()` gates dispatch
    (HALF_OPEN probe limit); outcomes feed `observeSuccess` / `observeFailure` /
    `cancelProbe` (user cancellation and non-technical states free the probe without tripping).
- **`electron/commander/main-commander.ts`** — optional `breaker` constructor param, passed into
  the supervisor (no behavior change when absent).
- **`electron/main.ts`** — instantiates the breaker at
  `<userData>/.boss/circuit-breaker.json` and wires it into the commander.
- **`tests/circuit-breaker.test.ts`** (new) — 8 tests: threshold trip, success reset, cooldown →
  HALF_OPEN single probe, probe-failure reopen, persistence + fail-closed, interruption
  classification, and ExecutionSupervisor integration (OPEN runtime skipped; probe outcome
  reopens/closes).

## Verification

- Targeted: `circuit-breaker`, `execution-supervisor`, `recovery-closure`, `role-router`,
  `degraded-controller` — PASS.
- Full suite: **42 files / 159 tests PASS** (was 41 files / 151).
- `tsc -p tsconfig.electron.json` and `tsc -p tsconfig.json` — PASS.

## Boundary notes (not in this pack)

- The breaker guards the **supervisor role-dispatch path** (API/Codex/web worker role execution,
  plans, council, final synthesis). Web automation's visible-session send path keeps its own
  BudgetManager/WebRecovery handling; a future pack can route its outcomes through the same
  breaker instance.
- State-name contracts `WAITING_PROVIDER / PAUSED_PROVIDER` (AP03a) remain queued.
- No UI/RuntimeStatusView exposure of breaker state yet; runtime availability continues to come
  from `RuntimeRegistry` health + `store.observeRuntimeFailure`.

## Checkpoint

Commit with: `electron/commander/circuit-breaker.ts`, `execution-supervisor.ts`,
`main-commander.ts`, `main.ts`, `tests/circuit-breaker.test.ts`.
