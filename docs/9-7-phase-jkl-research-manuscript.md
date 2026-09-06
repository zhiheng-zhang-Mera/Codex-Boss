# 9-7 Phase J/K/L — Live Research、Autopilot、Manuscript Compile

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phases J/K/L. Branch `9-7`.

These phases extend the existing 9-6 research core (supervisor/ledger/evidence
graph/manuscript assembler) instead of inventing a parallel stack.

## Phase J — LiveResearchExecutor + role routing + typed artifacts (§27)

- **Shared role/artifact vocabulary (`src/shared/research-roles.ts`)**
  - `ResearchRole` (literature/planner/experiment/coder/analyst/reviewer/
    reporter) + deterministic `roleForStage(stage)` for every research state.
  - `ResearchArtifactKind` (repo-scan…build-artifact) + `artifactKindForStage`.
  - `ResearchStageArtifact` typed record and `stageArtifact()` builder —
    every stage emits a typed artifact (role + kind + evidence refs), never
    prose-only output (§27).
- **`electron/research/live-research-executor.ts`**
  - `LiveResearchExecutor` wraps an inner executor (live web-AI roles in the
    GUI, deterministic pipeline in tests), routes each stage to its role, emits
    a typed artifact per stage, and forwards pause/reviewer gates unchanged.
  - `main.ts` now constructs the research supervisor with
    `LiveResearchExecutor({ inner: new DefaultLevelBExecutor() })`.

## Phase K — Research autopilot runUntilBlocked (§28)

- `ResearchSupervisor.runUntilBlocked(id, {maxSteps})` — keeps stepping until a
  genuine blocking state (WAITING_FOR_USER / WAITING_FOR_PROVIDER /
  RECOVERING), a terminal (READY / FAILED), or the cap. Provider pauses are
  never auto-resumed; a reviewer gate stops the loop at the exact pending stage
  (verified). A stuck/no-advance executor respects the cap (verified).
- IPC `boss:research-autopilot` + `BossBridge.researchAutopilot` +
  renderer “自动推进” button.

## Phase L — LaTeX sections + compile + PDF/TEX path UI (§31/§32/§33)

- **Manuscript assembler fix (§32)** — `assembleLatex` no longer stuffs
  Introduction/Methods/Results/Discussion/Conclusion into the abstract; each
  section renders under its own `\section`, abstract only inside
  `\begin{abstract}` (regression test added).
- **`electron/research/manuscript/latex-compiler.ts` (§31)**
  - `LatexCompiler` auto-detects pdflatex → xelatex → lualatex → tectonic
    (injectable for tests), runs two passes, and writes a durable
    `audit/compile.json` ({status PASS|FAIL, engine, tex, pdf, logTail,
    compiledAt}). Never reports PASS without a real paper.pdf; on engine
    absence or compile failure the .tex is preserved for repair.
- **IPC + UI (§33)** — `boss:research-compile-pdf` returns the audit plus the
  research cache root; Research view shows PDF / TEX / Research cache paths and
  a “编译 PDF” button per run.

## Acceptance / verification

- Typed roles + artifacts for all main states (tests).
- runUntilBlocked: full journey → READY; reviewer gate → WAITING_FOR_PROVIDER
  with pendingStage preserved; cap respected (tests).
- Compiler: no engine → FAIL + .tex kept; PASS only with a real PDF after two
  passes; nonzero exit → FAIL (tests).
- §32 renderer: abstract isolated from sections (test).
- `pnpm run typecheck` — green.
- `pnpm vitest run tests/research-live-jkl.test.ts tests/research-manuscript.test.ts`
  — 14 passed.

## Next

Final: full-suite regression + acceptance review across all phases A–L.
