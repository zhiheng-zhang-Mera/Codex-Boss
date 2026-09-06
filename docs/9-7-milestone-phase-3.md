# Milestone Phase 3 — Research role dispatcher (§8)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md` §8.
Branch `9-7-milestone` (after phases 0/1/2/13/14 in this milestone series).

## What changed

- New `electron/research/research-role-dispatcher.ts`:
  - `ResearchRoleWorker` — semantic worker declaring the research roles it can
    answer (reuses the shared role vocabulary, one source of truth).
  - `workersForRole(workers, role)` — pure, stable selection.
  - `ResearchRoleDispatcher` — routes a stage's semantic ask to the workers
    owning the stage's role, with the §8 escalation policy:
    1 worker → host validation (parseable JSON) → PASS continue; on an
    unresolved answer the next role-capable worker is tried; when every worker
    fails the ask throws (fail closed — the conductor turns that into a FAILED
    run, never a fabricated answer). Attempts are bounded to one per worker.
  - `providerFor()` adapts the dispatcher to the conductor's
    `ResearchSemanticProvider`, so the deterministic conductor and the future
    live GUI path share one semantic interface.
  - `isValidJsonText` — host validation (JSON only, no prose-only pass).

## Acceptance

`tests/research-role-dispatcher.test.ts` (5 tests): role routing by stage;
fallback to a second worker on host-validation failure with attempt log;
fail-closed when no worker owns the role; bounded attempts when all workers
fail; JSON-only validation.

## Live seam (documented, not faked)

The deterministic dispatcher takes plain worker objects. In the GUI session the
worker pool is intended to be backed by `RuntimeRegistry` +
`RoleRouter`/`ProviderAutomation` + `Council` adapters (one worker per research
role, first-available, capability-gated) — no second provider-automation system
is built here; the adapter layer plugs the existing automation in behind the
`ResearchRoleWorker` interface. This seam is exercised in a live session
(E2E-C), matching the milestone's own live-vs-deterministic boundary.
