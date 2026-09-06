# Milestone Phase 0 — Baseline + failing acceptance E2E

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md` §5
(and §32 E2E-A). Branch `9-7-milestone`.

## What was done

- Created branch `9-7-milestone` from `9-7` baseline SHA `061d228`.
- Baseline verified before any change:
  - `pnpm run typecheck` — exit 0 (both tsconfigs).
  - Research-focused suites: 17 files / 85 tests passed
    (ledger/citation/supervisor/evidence/protocol/manuscript/repro/live-jkl/service/
    levelb/runtime/graph-claims/run-analysis/artifact-tree/acceptance-audit/run-recorder).
- Gap audit written: `docs/research-milestone-gap-audit.md` (milestone § → reuse/partial/gap).
- Failing acceptance E2E written: `tests/research-milestone-e2e.test.ts`.

## The failing E2E (red by design)

`tests/research-milestone-e2e.test.ts` encodes E2E-A (milestone §32/§33/§36):

1. Human-defined falsifiable RQ + authorized workspace + budget → `start()` ONCE.
2. Test never calls Step/Resume (zero manual progression).
3. Asserts READY and the final artifact set:
   `paper.tex`, `paper.pdf`, `references.bib`, ≥1 figure, `protocol.json`
   (hash == IR), ≥2 real recorded runs with distinct seeds bound to the frozen
   protocol, `reproducibility.json.status === "REPRODUCED"`,
   `audit/compile.json.status === "PASS"`, `final-audit.json.passed === true`.

With the 9-7 baseline executor the autopilot stops honestly at the first
reviewer gate (`WAITING_FOR_PROVIDER`, pending `LITERATURE_REVIEW`) — the second
test asserts exactly this fail-closed behavior and passes. The first test is RED:
READY + artifacts are unreachable until the milestone stage executor does real
per-stage work under a fail-closed READY gate (phases 2–14).

## Next (recommended order §31)

1. `docs/research-milestone-gap-audit.md` item 1 — ResearchService single GUI
   composition root (main.ts forwarding, per-store roots, 9-6 runs recoverable).
2. Item 2+ — real stage executor/conductor, then the READY gate, GUI simplification,
   recovery tests, live acceptance.
