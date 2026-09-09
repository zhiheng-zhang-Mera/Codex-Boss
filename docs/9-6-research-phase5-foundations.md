# 9-6 Research Phase 5 — Research Mode Foundations (IR + Supervisor + Ledger)

Compact handoff for codex-boss-9-6-research-plan.md Phase 5 (research mode基础) + Phase 7
protocol-freeze primitives (front-loaded). Branch `9-6-research`.

## Why

Research mode has no state model, no durable run record, no autopilot stage driver. Phase 5 needs
the top-level state machine (SCOPING → … → READY with RECOVERING/WAITING_*/FAILED), a ResearchIR
scaffold, and an autopilot supervisor that walks stages while recording decisions — with an
immutable protocol hash at freeze points so later phases cannot silently mutate hypotheses.

## What was added

- **`src/shared/research-ir.ts`** (new, pure)
  - `ResearchState` (16 main states + RECOVERING/WAITING_FOR_PROVIDER/WAITING_FOR_USER/FAILED);
    `RESEARCH_MAIN_STATES`; deterministic `RESEARCH_NEXT` successors;
    `nextResearchState(current, allowControl?)` — control states only resume explicitly.
  - `ResearchScope { workspace, allowedDomains, reviewers, autonomy, budget }` + `ResearchIR
    {schemaVersion, id, goal, scope, state, protocolHash?, researchQuestions, hypotheses,…}`;
    `validateResearchIR` fail-closed.
- **`electron/research/research-ledger.ts`** (new)
  - `ResearchLedger(root)` — v1 envelope per run at `.boss/research/<id>.json`: durable
    `create/checkpoint/load/advance/setState/appendDecision` with atomic writes, revision
    monotonicity and fail-closed reads.
- **`electron/research/research-supervisor.ts`** (new)
  - `ResearchSupervisor({executor, ledger})` — autopilot stage driver:
    `start(ir)` → SCOPING, `step(id)` runs the current stage through an injected executor then
    advances via the deterministic successor, appending a DecisionArtifact per stage;
    `wait(id, WAITING_FOR_USER|WAITING_FOR_PROVIDER, reason)` and `fail(id, reason)`.
  - `protocolHash(protocol)` — order-independent canonical JSON hash (Phase 7 freeze primitive).
- **`tests/research-supervisor.test.ts`** (new, 5 tests) — full state-chain walk; IR validation
  fail-closed; durable ledger checkpoint + decision append + autopilot advance; control waits +
  resume across reload; stable protocol hash independent of key order.

## Verification

- Targeted: `research-supervisor` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Executors are injected: real web-AI reviewers / repo inspection wire in at Phase 8 (Level-B
  E2E); this phase locks the state machine + durability so those phases have a stable spine.
- `WAITING_FOR_PROVIDER`/`WAITING_FOR_USER` resume only through an explicit call, matching the
  Phase 4 human-guidance gate.
- The top-level Chat|Work|Research nav + Research inputs are renderer work; the ResearchIR and
  supervisor carry their state server-side (IPC surface to add with the UI).

## Checkpoint

Commit with: `src/shared/research-ir.ts`, `electron/research/research-ledger.ts`,
`electron/research/research-supervisor.ts`, `tests/research-supervisor.test.ts`, this handoff.
