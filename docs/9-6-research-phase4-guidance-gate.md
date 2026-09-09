# 9-6 Research Phase 4 — Autopilot + Human Guidance Gate

Compact handoff for codex-boss-9-6-research-plan.md Phase 4 (§4). Branch `9-6-research`.

## Why

Long research/work tasks must auto-continue (no meaningless "Continue?"), and pause **only** for
genuine user decisions (§4.1 auto-recover list vs §4.2 must-pause list). No durable
intervention object or pause gate existed. This phase ships the model, the deterministic
decider, and a durable gate with IPC so the research runtime (Phase 5+) can raise / resolve
pauses with checkpoint-resume semantics.

## What was added

- **`src/shared/intervention.ts`** (new, pure)
  - `HumanInterventionRequest { id, taskId, kind, question, options?, blockingStepId,
    contextSummary, createdAt, answer?, resolvedAt? }` + `validateInterventionRequest`
    fail-closed; `interventionKey(taskId, kind)`.
  - `decideIntervention({kind?, reason, isPaidResource?, isIrreversible?})` → AUTO_RECOVER /
    REQUIRES_USER. Auto-recover only for the §4.1 reason list; user-decision kinds, paid
    resources and irreversible actions always pause (§4.2); unknown reasons fail closed to
    REQUIRES_USER.
- **`electron/commander/human-guidance-gate.ts`** (new)
  - `HumanGuidanceGate(file?)` — durable v1 store, one active intervention per task,
    `raise`/`activeFor`/`resolve`/`list`, fail-closed corrupt load (an unresolved pause never
    silently disappears).
- **`electron/main.ts` / preload / contracts** — module-level gate at
  `.boss/interventions.json`; IPC `boss:active-intervention`, `boss:list-interventions`,
  `boss:resolve-intervention`.
- **`tests/human-guidance-gate.test.ts`** (new, 5 tests) — decider (auto-recover reasons,
  user kinds/paid/irreversible, unknown→human), validation fail-closed, raise-one-active,
  resolve + durability across reload, fail-closed corrupt store.

## Verification

- Targeted: `human-guidance-gate` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Pausing behaviour (flush checkpoint/artifacts → WAITING_FOR_USER → beep/notification →
  resume) will be wired by the research supervisor in Phase 5; the durable gate and IPC surface
  are the state half and are ready to be called from any runtime.
- The classifier list mirrors §4.1/§4.2 exactly; adding future auto-recover reasons is a pure
  list change.

## Checkpoint

Commit with: `src/shared/intervention.ts`, `electron/commander/human-guidance-gate.ts`,
`electron/main.ts`, `electron/preload.ts`, `src/shared/contracts.ts`,
`tests/human-guidance-gate.test.ts`, this handoff.
