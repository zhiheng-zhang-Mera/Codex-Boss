# Milestone Phase 15 — GUI normal path: Start-once under the live conductor

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
§7/§15/§20/§22. Branch `9-7-milestone`. User confirmed wiring: conductor +
live role-worker pool, 1 primary + 1 backup per stage (§8 default policy).

## What changed

- New `electron/research/live-research-provider.ts`:
  - `createLiveResearchProvider({openProviderIds, execute, maxWorkers?})` — a
    `ResearchSemanticProvider` whose ask() is served by the logged-in web-AI
    pool: ONE primary worker; when its answer fails host JSON validation the
    NEXT provider is the backup (§8 escalation); all fail → throw (conductor
    fails the run — never a fabricated answer).
  - Stable deterministic jobId per (researchId, stage, role) so a
    crash-restart never re-submits the same provider prompt (§22 replaySafe).
  - Cache-friendly stable prompt prefix (milestone §27).
- `electron/main.ts`:
  - The GUI research executor is now the **research conductor** driven by the
    live provider pool (open provider windows at ask time; no window open →
    the run fails closed with an explicit reason instead of a silent pause).
  - `boss:research-start` accepts the milestone §1 human input
    (`researchQuestion`, `hypothesis`, `providerPolicy`, `maxProviderCalls`,
    budgets) and routes through `startHumanResearch` (immutable RQ anchor).
- Renderer (`src/renderer/main.tsx`): Start is once → it submits the RQ and
  immediately drives the autopilot to READY / a genuine block. Step/Resume/
  freeze remain available below as Developer/Recovery controls.
- Shared contract `researchStart` updated accordingly.

## Verification

- `tests/research-live-provider.test.ts` (5): one primary worker on valid JSON;
  backup escalation on invalid primary; fail closed with no open provider;
  fail closed (bounded 2) when all workers fail; deterministic prompt prefix.
- Full typecheck (both tsconfigs) green; renderer + electron builds green.

## Live acceptance (needs one GUI run)

1. Restart Boss from this branch so it loads the new `dist` (main + renderer).
2. Ensure ≥1 provider window is open (all 5 logged in is fine).
3. Enter the RQ (§34 suggested), workspace (fixed benchmark + implementation),
   keep AUTOPILOT, press the research Start button once.
4. The run drives itself: inspection → literature (web AI, 1 provider + backup)
   → hypothesis → protocol freeze → real local experiment runs → statistics →
   replication → adjudication → citation → manuscript → LaTeX compile.
5. Expected: READY, `runtime-data/.boss/research/<id>/manuscript/paper.tex`
   and `paper.pdf`, `final-audit.json.passed=true`. LaTeX compile PASS requires
   a TeX engine on PATH; without one the run FAILS at BUILD with .tex preserved
   (fail-closed by design).
