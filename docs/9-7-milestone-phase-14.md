# Milestone Phase 14 — Fail-closed READY gate (§21)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
§21. Branch `9-7-milestone`.

## What changed

- `electron/research/research-service.ts`:
  - `readiness(id): {ok, reasons}` — the fail-closed checklist over the durable
    artifact tree: human RQ anchored and unchanged; protocol frozen with
    matching IR/store hashes + protocol.json snapshot; ≥2 real recorded runs
    with ≥2 distinct seeds all bound to the frozen hash (primary-runs artifact
    required); deterministic analysis artifact; replication + reproducibility
    REPRODUCED; claim verdict SUPPORTED; citation audit ok; manuscript review
    passed + paper.md/.tex/.bib + figure present; compile audit PASS + real
    paper.pdf; final-audit.json.passed === true; no dangling claim edges in the
    evidence graph.
  - The service wires this gate into its supervisor so READY is only reachable
    when the artifact tree satisfies the checklist.
- `electron/research/research-supervisor.ts`: optional `readyGate` consulted
  when a step would advance into READY; rejection → run FAILED with the
  recorded reasons (state machine alone can never mark a run READY).

## Acceptance

- `tests/research-supervisor-fail.test.ts` (§21 describe): gate rejection blocks
  READY → FAILED with `failed:READY` decision; gate pass → READY.
- `tests/research-milestone-e2e.test.ts`: after the conductor journey,
  `service.readiness(id).ok === true`; tampering with `audit/compile.json` +
  `paper.pdf` flips readiness false with a compile reason (fail-closed gate).

## Note

The BUILD stage of the research conductor already fails the run when LaTeX or
the final audit fails; the READY gate is the independent final authority over
the durable tree, so no executor can fake a pass (§21 "仅状态机走到最后不算
READY").
