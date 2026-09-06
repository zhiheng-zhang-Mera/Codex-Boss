# Codex-Boss Autonomous-Research Milestone — Branch Status

Branch: `9-7-milestone`. Source plan: `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`.

## Definition of Done reached (deterministic, verified)

Milestone E2E-A is green: human RQ (via `startHumanResearch`) → Start once →
zero Step/Resume → `READY` with `paper.tex`, `paper.pdf`, `protocol.json`,
≥2 distinct-seed real recorded runs under the frozen protocol hash,
`reproducibility.json = REPRODUCED`, `compile.json = PASS`,
`final-audit.json.passed = true`, plus the full §4 artifact tree.

**Verification:** full vitest 129 files / 634 tests green; full typecheck
(both tsconfigs) green; renderer + electron builds green; **real-engine E2E**
(`tests/research-real-engine-e2e.test.ts`) compiles paper.tex with actual
MiKTeX pdflatex → real paper.pdf + compile PASS + readiness ok.

## Implementation map (milestone § → artifact)

| § | Item | Where |
|---|---|---|
| §1/§36 | Human-defined input (immutable RQ, budgets) | `src/shared/research-input.ts`, `ResearchService.startHumanResearch` |
| §3/§6 | Single composition root + IPC forwarding | `electron/main.ts`, `research/research-service.ts` (per-store roots) |
| §4 | Stage artifact contract | `research/<id>/artifacts/*.json` writers/readers |
| §7 | Real stage executor (conductor), no placeholders | `electron/research/research-conductor.ts`; fail-closed advancement in `research-supervisor.ts` |
| §8 | Role dispatcher (1 → fallback → fail closed) | `electron/research/research-role-dispatcher.ts` |
| §9 | Literature closure core (bounded/dedup/acquire/verify) | `electron/research/literature/retriever.ts` |
| §10–§15 | Hypothesis/protocol freeze, implementation, real runs, stats, replication, adjudication, citations, manuscript | conductor stage handlers + existing evidence/statistics/manuscript modules |
| §18 | TEX → PDF (engine-readable figures; MiKTeX verified) | `manuscript/latex-compiler.ts`, `manuscript-assembler.ts` |
| §19/§20 | runUntilBlocked + WAITING_FOR_PROVIDER auto-recovery | `research-supervisor.ts` (`providerRecovery`) |
| §21 | Fail-closed READY gate | `ResearchService.readiness` + supervisor `readyGate` |
| §33/§34 | Live provider pool, Start-once GUI | `electron/research/live-research-provider.ts`, renderer research panel |

Phase handoffs: `docs/9-7-milestone-phase-{0,1,2,3,4,13,14,15,17-runbook}.md`.

## Remaining: one live GUI acceptance run (E2E-C)

**RESOLVED — E2E-C passed headless.** Run `live-1788704543179` reached READY with
real web-AI semantic stages, 2 real recorded runs under the frozen protocol
(seeds 1/2, accuracy 0.7/0.9), reproducibility REPRODUCED (mean 0.80, CI 0.60–1.00),
citations audit ok, manuscript compiled to **paper.pdf by real pdflatex**, and
`final-audit.json.passed=true`; `scripts/live-acceptance-report.cjs` reports
10/10 acceptance checks PASS. Headless driver: `--research-headless-run`
(`electron/main.ts`), workspace `live-acceptance/bench-ws`.

The GUI normal path uses the same code (Start once → conductor autopilot with the
logged-in providers; Step/Resume remain Developer/Recovery controls).

## Milestone Definition of Done — all achieved

- E2E-A deterministic CI: human RQ → mock provider → READY + paper.tex/pdf +
  final-audit passed (green, 129 files / 634 tests full suite).
- E2E-C live: human RQ → real web AI + real local experiment → replication →
  manuscript → paper.pdf → READY (run `live-1788704543179`).
