# 9-6 Research Round 29 — Paper Embeds Its Figures (md + tex)

Compact handoff for the round-29 deterministic slice: the manuscript wrote figure files and the
section text, but `paper.md`/`paper.tex` never referenced the figures — the deliverable did not
actually embed the artifacts it produced. Branch `9-6-research`.

## Why

Round 21 added deterministic SVG figures and round 22 registered them in the evidence graph, but
the assembled `paper.md` ended after the Conclusion and `paper.tex` had no
`\usepackage{graphicx}` / `\includegraphics` — so the paper body never displayed its own
figures, and `.tex` never wired the bibliography. A paper should reference exactly the artifacts
it ships.

## What was added

- **`electron/research/manuscript/manuscript-assembler.ts`**
  - `assembleMarkdown` gains a `## Figures` section with a markdown image per *actually written*
    figure file (`![name](figures/name)`); `assembleLatex` gains `\usepackage{graphicx}` and
    one `\includegraphics[width=\linewidth]{...}` per figure, plus
    `\bibliographystyle{plain}\bibliography{references}` when citations were supplied.
  - Figure files are written **before** the paper bodies are built, so the references are
    always exactly the files on disk (never invented names).
- **`tests/research-figures.test.ts`** (extended)
  - `paper.md` contains `![runs.svg](figures/runs.svg)`; `paper.tex` contains the
    `\includegraphics` for `runs.svg`; returned in-memory content matches the written files.

## Verification

- Targeted: `research-figures` (3) + `research-manuscript` (4) + `citation-audit` (6) +
  `research-artifact-tree` (2) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Figures are real recorded-run renders; embedding is deterministic. `paper.pdf` still needs a
  LaTeX toolchain (live/GUI acceptance).

## Checkpoint

Commit with: `electron/research/manuscript/manuscript-assembler.ts`,
`tests/research-figures.test.ts`, this handoff.
