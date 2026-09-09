# Milestone Phase 15/16/17 — GUI normal path + live acceptance (runbook & seams)

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
§19–§34. Branch `9-7-milestone`.

Deterministic CI acceptance (E2E-A) is green: human RQ → `startHumanResearch` →
Start once → zero Step/Resume → READY with paper.tex/paper.pdf and
final-audit.json.passed=true. The remaining phases are **live** items that need
a GUI session with real web/API AIs (and optionally a real TeX engine). This
document is the runbook + the exact seams to plug — no fake coverage.

## Already deterministic (verified by tests, this milestone)

- Human-defined input contract: `src/shared/research-input.ts`
  (`HumanDefinedResearchInput`, `humanResearchToIR`) + `ResearchService
  .startHumanResearch` (§1/§36) — validated fail-closed, RQ immutable anchor,
  provider-policy recorded, provider-call budget enforced by the conductor.
- ResearchService single composition root; runUntilBlocked with cap/block
  semantics + provider recovery hook (§13); fail-closed READY gate (§14).
- Research conductor performing all real stage work (phases 2–12) with typed
  artifacts; no-placeholder advancement; crash-safe re-entry.
- Literature retrieval closure core (§9 module + conductor intake).
- Research role dispatcher (§8) with worker fallback policy.

## Phase 15 — GUI Start-once normal path

Seam to plug (live): a `ResearchSemanticProvider` whose `ask()` is backed by a
`ResearchRoleDispatcher` worker pool wired to `RuntimeRegistry` +
`RoleRouter`/`ProviderAutomation` + `Council` (one worker per research role,
first-available, capability-gated, budget-capped via the conductor's
provider-call guard). Once wired:

1. `boss:research-start` forwards the human-defined input to
   `research.startHumanResearch(...)` (already possible — IPC input shape gains
   `researchQuestion`, `providerPolicy`, `budget.maxProviderCalls`).
2. The GUI normal path calls `boss:research-autopilot` once after Start; the
   run drives itself to READY (or to a genuine `WAITING_FOR_USER` for
   auth/budget/RQ changes only).
3. Step/Resume/freeze controls move behind a Developer/Recovery surface; the
   manual protocol-freeze form is no longer needed on the normal path
   (the conductor freezes after design + host validation + review).

## Phase 16 — GUI live crash/restart acceptance

Procedure (live session, same artifact roots):
1. Start a run with the live provider pool; kill Boss mid-EXPERIMENT_EXECUTION
   (after a run was recorded) or mid-LITERATURE_REVIEW.
2. Restart Boss (same `userData`); the run reloads from the durable ledger.
3. Press the autopilot button; assert: the exact pending stage resumes, no
   duplicate experiment run appears in `research/<id>/evidence/runs/`, and no
   repeated provider prompt appears in the provider-call count / decision log.
The supervisor + conductor idempotency that make this pass are already tested
deterministically (`research-service-composition.test.ts`,
`research-conductor.test.ts`, `research-provider-recovery.test.ts`).

## Phase 17 — Live acceptance (E2E-C) runbook

1. Choose the suggested first research question (§34):
   "Does evidence-weighted adjudication reduce review errors relative to
   majority-vote adjudication on a fixed software-engineering benchmark?"
2. Authorize a workspace that contains the fixed benchmark + implementation.
3. Enter the RQ, workspace, reviewers (web/API AIs) and budget in the GUI.
4. Click Start once. Do NOT click Step/Resume.
5. Observe the run advance through every stage (inspection → literature →
   hypothesis → protocol → implementation → real runs → analysis →
   replication → adjudication → citation → manuscript → LaTeX).
6. Assert the acceptance metrics (§33):
   - Manual Step clicks = 0, Manual Resume clicks = 0,
     Manual internal provider selection = 0;
   - RQ silent mutation = 0; placeholder stage = 0; fabricated run = 0;
     unsupported primary claim = 0;
   - artifacts exist: paper.tex, paper.pdf, protocol.json, experiment logs,
     reproducibility.json, citations.json, final-audit.json;
   - final-audit.json.passed = true; compile audit PASS (real TeX engine) —
     when no engine exists the run stays FAILED with .tex preserved for repair.
7. UI shows [Open PDF] [Open Folder] [Copy PDF Path] [Copy TEX Path]
   (already implemented in the Research view).

## Honest boundary

Everything up to the deterministic CI Definition of Done is implemented and
tested on this branch. Steps 15–17 above are live-session activities that
require real web/API provider sessions and, for compile-PASS, a real TeX
engine; they are documented here rather than faked in unit tests.
