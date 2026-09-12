# checkpoint-1 §29 — Execution Planner (CP7)

Plan of record: `Update-Plan/checkpoint-1.md` §29 — plan output is an
**Execution DAG** whose nodes carry nine required fields (§29.1), independent work
runs in parallel while dependent work stays ordered (§29.2), and concurrency is
derived from the host rather than hardcoded (§29.3).

Status: implemented inside the real WorkBook dispatch, accepted by
`pnpm run acceptance:plan` (also a CI step), regression green.

## What was built

`src/shared/execution-planner.ts` (pure):

- **§29.1** nodes derived from the §28 requirements graph: functional/deliverable
  requirements → `IMPLEMENT`; prohibition/constraint/acceptance/visual →
  `VERIFY`; optional → a node that never gates anything. Every node carries
  `objective`, `requirements`, `inputs`, `scope`, `allowed_files`,
  `expected_outputs`, `verification` (gate + real host commands + the §28.4
  evidence kinds), `dependencies` and `rollback`.
- **File scope is fail-closed.** `resolveAllowedFiles` matches the requirement's
  scope against the files the host actually observed; a scope that matches
  nothing leaves `allowed_files` empty, sets `unbounded_scope` and records a
  diagnostic — the worker gets no write permission instead of the repository.
- **§29.2** waves = longest-path level over the node DAG; `plan_parallelism` and
  `scheduleExecution({completed, running})` both respect the adaptive limit, and
  a dependency is never scheduled in the same wave as its dependent.
- **§29.3** `decideConcurrency` derives the level (1..8) from CPU cores, free
  memory, GPU presence, available/rate-limited providers, active tasks, load
  average and power state, returning the input snapshot and the reasons with the
  decision. The scheduling path contains no constant.

Wiring: the CP3 world model now also produces a `PlanContext` (real files, test
files, entry points, build tools, host commands, plus a live resource snapshot
built in `electron/main.ts` from `os` and the provider/account/run state).
`workbook-dispatch` plans right after the requirements graph and records the DAG
as `task.workbookDispatch.execution_plan`.

## Acceptance

`pnpm run acceptance:plan` drives the REAL `runWorkDispatch` with a real
workspace and a real WorkBook — P-01..P-06, 52 observations, all PASS:

| Item | What it proves |
| --- | --- |
| P-01 | the durable task carries a versioned plan; only goal/dependency requirements lack a node of their own, and that is reported |
| P-02 | all nine §29.1 fields on every node, with real allowed files (`src/gateway.ts`) and no node handed the whole repo |
| P-03 | verification depends on implementation, sits in a later wave, and only the implementable node starts first |
| P-04 | waves never contain a node that depends on another node in the same wave; scheduling respects the limit |
| P-05 | resource-derived concurrency: a big idle host > a constrained one, one usable provider bounds it, 1..8, self-explaining |
| P-06 | an unresolvable scope grants nothing (`unbounded_scope` + diagnostic) rather than widening |

Observed plan on the acceptance fixture: 2 nodes, 2 waves, concurrency 3
(`cpu 8 cores and 8192 MiB free ⇒ 7; 3 provider(s), 0 rate-limited ⇒ 3`).

## Honest limitations

- **Nodes are not yet bound to real evidence.** §29's fields are planned; the
  loop that *runs* a node and verifies its files is CP8.
- **Waves are ordered, but the parallel executor is not built.** `scheduleExecution`
  returns what may start; nothing dispatches two nodes concurrently yet (CP8).
- **`gpu_available` is always false today** — the host has no GPU probe wired, so
  the GPU branch only affects the recorded reason, not the level.
- **Scope matching is lexical.** A scope whose wording shares no token with any
  file path stays unbounded; the diagnostic makes that visible instead of
  guessing.
- **Rollback is expressed, not exercised.** The plan names the command and the
  files; the Git checkpoint that backs it is CP13.
- Recorded late: CP7's code, tests, gate and regression landed in the same commit
  as this document's first version, but the document itself was written in the
  following round (the CP7 commit therefore carried no docs entry).
