# 9-6 Research Round 21 — Deterministic Paper Figures from Real Runs

Compact handoff for the round-21 deterministic slice: the plan's artifact tree
(`figures/`, Final Acceptance J) was only ever created as an empty directory — no figure file
was generated. This slice adds a deterministic SVG figure builder whose input is the real
recorded run metrics, and writes supplied figures into `manuscript/figures/`.
Branch `9-6-research`.

## Why

The manuscript assembler wrote paper.md / paper.tex / references.bib and the audit tree, but
`figures/` stayed empty: a paper's figures must be reproducible artifacts traceable to the exact
recorded runs, produced deterministically (no LLM, no randomness, same input → same bytes).

## What was added

- **`src/shared/research-figures.ts`** (new, pure)
  - `metricFigureSvg(bars, options)` — deterministic SVG bar chart (bounded rows/labels,
    escaped user text, explicit width/height/title/y-axis label);
  - `figureForRuns(title, values)` convenience returning `{ name, svg }`.
- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `ManuscriptOptions.figures?: Array<{ name, svg }>`; each is written to
    `manuscript/figures/<name>` (name sanitized) and returned in `ManuscriptOutput.figures`;
    absent → `figures: []` (backward compatible).
- **`tests/research-figures.test.ts`** (new, 3 tests) — byte-identical SVG for identical input,
    escaped user-controlled text, figure writing + empty-by-default.
- **`tests/research-artifact-tree.test.ts`** (extended) — the full offline E2E now builds a
    figure from the **real recorded run metrics** and asserts it lands in
    `manuscript/figures/accuracy.svg` with the run labels.

## Verification

- Targeted: `research-figures` (3) + `research-artifact-tree` (2) + `research-manuscript` (3)
  PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Figures are rendered from recorded runs only — never invented. Live Level-B E2E still
  requires a GUI session for web-AI reviewers / replication on the real repo.

## Checkpoint

Commit with: `src/shared/research-figures.ts`,
`electron/research/manuscript/manuscript-assembler.ts`, `tests/research-figures.test.ts`,
`tests/research-artifact-tree.test.ts`, this handoff.
