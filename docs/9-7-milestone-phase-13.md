# Milestone Phase 13 — WAITING_FOR_PROVIDER auto-recovery (§19/§20)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
§19/§20. Branch `9-7-milestone`.

## What changed

`electron/research/research-supervisor.ts`:
- `SupervisorOptions.providerRecovery({id, record}) → "resume" | "stay"`.
- `runUntilBlocked` no longer treats `WAITING_FOR_PROVIDER` as a mandatory
  manual-Resume stop when a recovery hook is configured: recovered → auto-
  resume the exact pending stage and keep driving; still unavailable → the run
  stays parked (`WAITING_FOR_PROVIDER` remains a genuine block). Auth/budget
  escalation is the caller's job (it moves the run to `WAITING_FOR_USER` or
  `FAILED`), and `runUntilBlocked` never auto-resumes past those.

Without the hook the previous behavior is unchanged (provider pauses stay
blocking) — verified by the existing live-jkl autopilot suite.

## Acceptance

`tests/research-provider-recovery.test.ts` (4 tests): no hook → genuine block;
recovered provider → auto-resume to the pending stage and READY with zero
manual `resume()`; still-unavailable provider → parked; auth escalation →
`WAITING_FOR_USER` never auto-resumed.

## Boundary

The recovery *strategy* (which provider to retry, when to switch, when auth is
required) belongs to the live provider pool adapter (live seam, E2E-C). The
supervisor semantics are deterministic and tested here.
