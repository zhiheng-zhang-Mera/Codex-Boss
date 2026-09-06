# Milestone Phase 1 — ResearchService single composition root (§6)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md` §6.
Branch `9-7-milestone`, after Phase 0 (`6f751ce`).

## What changed

- `electron/research/research-service.ts`
  - `ResearchServiceOptions` now accepts per-store durable roots
    (`ledgerRoot`, `protocolsRoot`, `evidenceRoot`, `citationsRoot`), each
    defaulting to `root/<sub>` (backward compatible for every existing caller).
- `electron/main.ts`
  - GUI now instantiates exactly ONE `ResearchService` (milestone §3 target
    tree) owning ledger + protocol manager + evidence graph + citation store +
    autopilot supervisor + structured runtime. All `boss:research-*` IPC
    handlers and the intervention resolver forward to it; the duplicated
    GUI-side composition (RawLedger/ProtocolManager/Supervisor globals) and the
    re-implemented freeze bookkeeping were deleted.
  - Durable locations preserved via per-store roots:
    - ledger files stay `userData/.boss/research/<id>.json`
      (service root = `.boss/research`, ledgerRoot = same);
    - protocols stay `userData/.boss/research-protocols/<id>/protocol.json`;
    - evidence/citations/artifacts/manuscript trees live under `.boss/research`
      (service root), which matches the compile handler's manuscript path.

## Acceptance

`tests/research-service-composition.test.ts` (new, green):
- pre-migration file locations unchanged (ledger `<id>.json`, protocol under
  `research-protocols/<id>/protocol.json`), evidence/citation/snapshot trees
  under the single service root;
- restart on the same roots loads the run, sees the same stores, and resumes
  to the exact pending stage (`LITERATURE_REVIEW`), never SCOPING;
- a service method (freeze) works on the recovered run across the restart.

Regression: research-service/supervisor/levelb/acceptance suites still green;
typecheck green. The milestone E2E stays RED on its intended assertion only.

## Next

Milestone §7/§8 phases (gap-audit items 2+): a real stage executor/conductor
that performs per-stage host work (inspection → literature → hypothesis →
protocol draft/freeze → experiment implementation → real runs with budget guard
→ deterministic analysis → replication → adjudication → citation audit →
manuscript + review → LaTeX compile) and refuses placeholder advancement, then
the fail-closed READY gate, GUI simplification and crash-recovery tests.
