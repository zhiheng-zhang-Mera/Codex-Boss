# 9-6 Research Round 12 — Reproducibility Audit for Real Recorded Runs

Compact handoff for the round-12 deterministic slice: turn the round-11 recorded-run analysis
into the plan's reproducibility audit and let the manuscript assembler write real
`audit/reproducibility.json` + `final-audit.json` content instead of a static PENDING stub.
Branch `9-6-research`.

## Why

The plan's Final Acceptance I (Research Integrity) requires "reproducibility audit PASS", and
the Phase 11 artifact tree carries `audit/reproducibility.json`. The manuscript assembler
previously wrote a hard-coded `{status:"PENDING"}` stub for it. Now that rounds 10–11 produce
real recorded runs and a deterministic evidence>vote analysis, the reproducibility audit can be
computed deterministically: a primary finding is REPRODUCED only when the claim was adopted on
real evidence (statistic supported) **and** independent replication exists (≥2 distinct-seed
runs under the same frozen protocol).

## What was added

- **`electron/research/evidence/repro-audit.ts`** (new)
  - `ReproducibilityAudit { claimId, status: REPRODUCED | NOT_REPRODUCED | PENDING,
    protocolHash, runsAnalyzed, distinctSeeds, mean, ci, reason, at }`.
  - `buildReproducibilityAudit(analysis, at?)` — deterministic verdict over a round-11
    `RunAnalysisResult`: REPRODUCED only when `independentReplication && verdict.adopted`;
    NOT_REPRODUCED with a precise reason otherwise.
- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `ManuscriptOptions.reproducibility?` — when supplied, `audit/reproducibility.json` gets the
    real audit and `final-audit.json` includes `reproducibility`; when absent it still writes the
    PENDING stub (backward compatible, no fabricated audit).
- **`electron/research/research-service.ts`**
  - `reproducibility(id, options)` — runs the fail-closed `analyzeRuns` (frozen protocol,
    matching hash) and returns the audit.
- **`tests/repro-audit.test.ts`** (new, 4 tests) — REPRODUCED only with evidence + independent
  replication (incl. CI + seed counts); NOT_REPRODUCED on a single run or opposed votes;
  manuscript writes the real audit + final-audit flag; PENDING stub preserved when not supplied.

## Verification

- Targeted: `repro-audit` (4) + `run-analysis` (5) + `research-manuscript` (3) PASS; typecheck
  PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The audit is deterministic code over real recorded runs + injected reviewer votes; live
  Level-B E2E (web-AI reviewers → RQ → experiment design → replication → manuscript) still
  requires a GUI session. This slice makes the manuscript audit tree truthful about what the
  recorded evidence actually shows.
- `main.ts` IPC not extended; a future live executor wires recorder + analyzer + audit.

## Checkpoint

Commit with: `electron/research/evidence/repro-audit.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `electron/research/research-service.ts`,
`tests/repro-audit.test.ts`, this handoff.
