# 9-6 Research Round 23 — Paired Permutation Test + Doc Reconcile

Compact handoff for the round-23 deterministic slice: the statistics API documented a `paired`
permutation option that was never implemented (it silently ran the unpaired test), and STRUCTURE
still described the research inventory only through round 12. Branch `9-6-research`.

## Why

Phase 10 requires paired/unpaired comparison support. `permutationP(left, right, { paired })`
accepted the flag but ignored it — a caller asking for a paired analysis got the unpaired
result, which is wrong for within-subject designs. Additionally the plan requires README /
STRUCTURE to record the actual implementation boundary, and the research inventory in
STRUCTURE.md lagged rounds 13–22 (run-analysis, repro audit, graph claims, citation
audit/bibliography, figures, figure traceability, amendment facade).

## What was added

- **`src/shared/research-statistics.ts`**
  - `permutationPairedP` — sign-flip permutation over within-pair differences (seedable,
    deterministic); `permutationP` now honors `paired: true` (equal-length required, NaN
    otherwise, fail closed). The unpaired path is unchanged.
- **`tests/research-evidence.test.ts`** (+1 test)
  - paired offset → low p (deterministic seed), reproducible; no-offset → high p; unequal
    lengths with paired → NaN; `proportion` helper (incl. divide-by-zero NaN).
- **`STRUCTURE.md`**
  - Research inventory reconciled through round 22 (all new shared + electron/research
    modules, figure/run traceability, resume control, amendment facade, round handoffs).

## Verification

- Targeted: `research-evidence` (6) + `research-manuscript` (3) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Statistics remain deterministic code; live Level-B E2E still requires a GUI session.

## Checkpoint

Commit with: `src/shared/research-statistics.ts`, `tests/research-evidence.test.ts`,
`STRUCTURE.md`, this handoff.
