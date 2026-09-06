# 9-6 Research Round 33 — Machine-Checkable Research Acceptance Audit

Compact handoff for the round-33 deterministic slice: a script that verifies a research run's
artifact tree against plan Final Acceptance **I (Research Integrity)** + **J (Artifact)**, usable
by the GUI/live session and by vitest offline. Branch `9-6-research`.

## Why

Final Acceptance I/J must be evidenced per run. The deterministic surface already produces every
file (snapshots, manuscript, figures, audit JSONs, evidence graph), but nothing mechanically
asserted the whole set against the plan's integrity flags — the live session had to eyeball the
tree. A deterministic audit script gives the same verdict in the GUI session and in CI.

## What was added

- **`scripts/acceptance-research-audit.cjs`** (new)
  - `node scripts/acceptance-research-audit.cjs <researchRoot> <researchId> [outputPath]`
  - Checks I: `research-ir.json` (id + state), `protocol.json` hash === `ir.protocolHash`,
    `final-audit.passed`, `reproducibility.status === REPRODUCED`, citations audit ok (or
    PENDING when none recorded), and — when runs were recorded — claim + paper-sentence nodes in
    the evidence graph.
  - Checks J: paper.md / paper.tex / references.bib exist; ≥1 figure file; every figure file is
    referenced in paper.md.
  - Exits 0 (PASS) / 1 (FAIL) and writes a JSON report.
- **`tests/research-acceptance-audit.test.ts`** (new, 2 tests)
  - builds a full offline artifact tree (real node runs + analysis + repro audit + citations +
    manuscript + figures + figure/chain/paper registration + snapshots), then runs the script:
    PASS with verified citations; FAIL when an UNSUPPORTED citation is bound (checks I5 + I3
    fail).

## Verification

- Targeted: `research-acceptance-audit` (2) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Live-only inputs (web-AI reviewer evidence, real experiment metrics on the actual repo,
  `paper.pdf` via LaTeX) are recorded by the GUI session; this audit verifies the deterministic
  tree + integrity flags the live flow must produce.

## Checkpoint

Commit with: `scripts/acceptance-research-audit.cjs`, `tests/research-acceptance-audit.test.ts`,
this handoff.
