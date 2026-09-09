# Codex-Boss Autonomous-Research Milestone — Gap Audit

Source plan: `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
Audited branch: `9-7-milestone` at `061d228` (baseline `9-7`), 2026.
Method: read-only code inspection + baseline typecheck (`EXIT 0`) and research-focused
test run (17 files / 85 tests passed). Statuses are verified against the code, not inferred.

Legend: `REUSE` = shipped by 9-6/9-7 and usable as-is; `PARTIAL` = exists but does not yet
satisfy the milestone; `GAP` = missing and in scope of this milestone.

---

## A. What is already reusable (do not rewrite)

| Piece | Where | Milestone § |
|---|---|---|
| ResearchIR + deterministic state machine | `src/shared/research-ir.ts` | §1/§2 |
| Durable ledger (v1 envelope, decisions, checkpoint, revision) | `electron/research/research-ledger.ts` | §2 |
| Protocol freeze / canonical hash / amendment | `electron/research/protocol-manager.ts`, `src/shared/research-protocol.ts`, `research-supervisor.protocolHash` | §2/§10 |
| ResearchSupervisor (step/advance/pause/resume/fail) | `electron/research/research-supervisor.ts` | §2 |
| ResearchService facade composing ledger/protocols/evidence/citations/supervisor/runtime | `electron/research/research-service.ts` | §2/§3 |
| PrimaryRunRecorder + provenance record | `electron/research/runtime/run-recorder.ts` + `evidence/evidence-graph.ts` | §12 |
| ResearchRuntime (structured, allow-listed, concurrent budget) | `electron/research/runtime/*` | §12 |
| Deterministic statistics + CI + effect size + permutation p | `src/shared/research-statistics.ts` | §13 |
| Recorded-run analysis → stats + evidence>vote verdict | `electron/research/evidence/run-analysis.ts` | §13/§15 |
| Reproducibility audit (REPRODUCED only on ≥2 distinct seeds + adopted) | `electron/research/evidence/repro-audit.ts` | §14 |
| Evidence graph chain (RQ→Hypothesis→Protocol→Experiment→Run→Stat→Claim→Figure→Paper) | `electron/research/evidence/evidence-graph.ts`, `graph-claims.ts` | §15 |
| Citation verification ladder + source cache store | `src/shared/research-citation.ts`, `electron/research/literature/source-store.ts` | §16 |
| Manuscript assembler: paper.md/.tex/.bib, figures, citations/repro/final audits | `electron/research/manuscript/manuscript-assembler.ts` | §17/§18 |
| LaTeX compiler (engine detect, 2 passes, compile.json, fail-closed) | `electron/research/manuscript/latex-compiler.ts` | §18 |
| LiveResearchExecutor + research role/artifact vocabulary | `electron/research/live-research-executor.ts`, `src/shared/research-roles.ts` | §7 |
| runUntilBlocked autopilot + IPC + renderer buttons | `research-supervisor.ts`, `electron/main.ts`, renderer | §19 |
| Repo inspection | `electron/engineering/repo-inspector.ts` via DefaultLevelBExecutor | §2 |
| Acceptance audit script (deterministic artifact tree checks) | `scripts/acceptance-research-audit.cjs` | §33 |

## B. Per-milestone gap map (recommended development order §31)

### 0 — Failing E2E acceptance
- `REUSE` research service/runtime/executor + manuscript + audit exist as building blocks.
- `GAP` There is no single-call journey "human RQ → Start once → (no Step/Resume) →
  READY + `paper.tex` + `paper.pdf` + `final-audit.json.passed=true`". Today an autopilot
  run with the default executor stops at the first reviewer gate
  (`WAITING_FOR_PROVIDER`, pendingStage `LITERATURE_REVIEW`) and a READY run cannot be
  produced by one API call. → Phase 0 test `tests/research-milestone-e2e.test.ts` (red).

### 1 — ResearchService single composition root (§6)
- `REUSE` `ResearchService` already composes ledger/protocols/evidence/citations/
  supervisor/runtime under one root.
- `GAP` `electron/main.ts` does **not** use it: it instantiates `ResearchLedger`,
  `ProtocolManager`, `ResearchSupervisor` globals and every `boss:research-*` IPC handler
  talks to those globals directly; `boss:research-protocol-freeze` re-implements the
  freeze/IR-hash bookkeeping the service already owns (`main.ts:421-437`).
- Required: per-store root overrides on `ResearchServiceOptions` so existing durable
  locations (`userData/.boss/research/<id>.json`, `userData/.boss/research-protocols/…`)
  keep working (9-6 runs recoverable); single service instance in main.ts; all IPC forward
  to it. GUI still drives the same file roots after restart → exact pending stage.
- **Status: DONE (Phase 1, `docs/9-7-milestone-phase-1.md`).** Per-store roots added;
  main.ts uses one ResearchService; `boss:research-*` forwards to it; legacy file locations
  preserved and restart-to-pending-stage covered by `tests/research-service-composition.test.ts`.

### 2 — LiveResearchExecutor + no-placeholder advancement (§7/§31)
- `REUSE` LiveResearchExecutor routes stage→role and emits typed stage artifacts in memory.
- `GAP` Stage work is delegated to `DefaultLevelBExecutor`, which pauses on reviewer-gated
  stages and **no-ops (placeholder) through** protocol/runtime/audit/build stages; the
  supervisor cannot tell a placeholder from real work, so a supervisor journey may reach
  READY with zero real artifacts (see `tests/research-live-jkl.test.ts` stub journey).
- Required: supervisor-side guard + executor contract that refuses placeholder advancement
  and (in the live path) dispatches stage work to a real per-role worker.
- **Status: DONE for the deterministic path (Phase 2, `docs/9-7-milestone-phase-2.md`).**
  Supervisor fail-closed contract (`StageOutcome.fail`, throws → FAILED); DefaultLevelBExecutor
  pauses instead of placeholder-advancing; the research conductor (`electron/research/
  research-conductor.ts`) performs real per-stage host work with durable typed artifacts and
  refuses no-real-work stages; E2E-A (human RQ → mock provider → READY + paper.tex/pdf +
  final-audit passed) is green. Remaining: live role dispatcher / provider-backed semantic
  work (item 3) and an explicit READY-gate function (item 14).

### 3 — Research role dispatcher (§8)
- `REUSE` `RuntimeRegistry`/`RoleRouter`/`ProviderAutomation`/`Council`, role vocabulary.
- `GAP` No `ResearchRoleDispatcher` maps research roles to those runtimes/providers for
  the live journey; the reviewer-gated pause is not answered by an automatic role worker.
- **Status: deterministic core DONE (Phase 3, `docs/9-7-milestone-phase-3.md`).**
  `electron/research/research-role-dispatcher.ts` routes stage asks to role-capable
  workers with §8 escalation (1 worker → host validation → fallback → fail closed,
  bounded); adapts to the conductor's `ResearchSemanticProvider`. Live RuntimeRegistry/
  ProviderAutomation-backed worker pool is a documented seam for the GUI session (E2E-C).

### 4 — Literature retrieval closure (§9)
- `REUSE` `CitationSourceStore` (records + content-addressed source cache) and the
  verification ladder in `research-citation.ts`.
- `GAP` No `retriever.ts` / `query-planner.ts` / `metadata-verifier.ts`; no bounded
  query→candidate→dedup→acquisition→CitationSourceStore loop; live literature stage is a
  pause gate.
- **Status: deterministic core DONE (Phase 4, `docs/9-7-milestone-phase-4.md`).**
  `electron/research/literature/retriever.ts`: bounded per-pass query planning, DOI/title
  dedup, acquisition into CitationSourceStore with host metadata/passage verification,
  no AI-title-only evidence, candidate budget truncation. The deterministic conductor's
  LITERATURE stage performs the same closed intake; real web/endpoint acquisition remains
  a live-adapter seam (never a placeholder).

### 5 — Hypothesis + experiment plan + protocol freeze (§10)
- `REUSE` protocol schema/freeze/amendment; Level-A planner (question candidate/falsifiable).
- `GAP` Normal journey leaves `IR.researchQuestions`/`hypotheses` empty (GUI start passes
  none); QUESTION_FORMULATION/PROTOCOL_DRAFT stages produce no IR update, no typed
  hypothesis.json/experiment-plan.json/protocol-review.json artifacts, and no automatic
  freeze. Human RQ immutability is not anchored in the IR during a normal GUI journey.

### 6 — Experiment implementation (§11)
- `REUSE` allow-listed command spec + runtime; repo inspection.
- `GAP` No `research/<id>/experiments/{src,configs,runs,logs}` materialization, no
  coder→patch→build→test flow, no fail-closed implementation checks (build fail, baseline
  missing, protocol hash mismatch, primary-metric tampering) as an automatic stage.

### 7 — Real experiment execution (§12)
- `REUSE` `ResearchService.runExperiment` (frozen-hash binding, recorder, provenance),
  `ResearchRuntime`.
- `GAP` Nothing in the stage journey calls it; EXPERIMENT_EXECUTION is a placeholder or a
  pause. Budget guard (remaining experiment/runtime/provider budget before each run) does
  not exist (`scope.budget` only has maxExperiments/maxSteps).

### 8 — Deterministic analysis first (§13)
- `REUSE` `analyzeRecordedRuns` (raw runs → host stats → verdict), shared statistics.
- `GAP` Not bound into ANALYSIS stage of an automatic journey; no `analysis.json`/claim
  verdict artifact emitted to `artifacts/`.

### 9 — Replication (§14)
- `REUSE` independent-runs model (distinct seeds, same protocol hash), repro-audit.
- `GAP` Not wired as a stage (REPLICATION placeholder); conflict preservation exists only
  as adjudication logic, no automatic "keep conflict" path in an automatic run.

### 10 — Evidence adjudication (§15)
- `REUSE` `run-analysis` verdict (evidence > vote), claim nodes/edges, repro-audit.
- `GAP` No claim-verdicts artifact; CLAIM_REVIEW pause/no-op in the normal journey.

### 11 — Citation verification closure (§16)
- `REUSE` ladder + source store + `summarizeCitationAudit`, citations.json written by the
  assembler; `verifySource` derives SOURCE_RETRIEVED from cached sources.
- `GAP` No automatic citation-audit stage that gathers verified citations, and no rule
  that an UNSUPPORTED primary claim blocks final manuscript (gate exists in assembler only
  when records are passed, but nothing enforces it during an automatic run).

### 12 — Manuscript finalizer + TEX/PDF (§17/§18)
- `REUSE` `assembleManuscript` + `LatexCompiler` + per-section reviewer interface; UI shows
  PDF/TEX paths + compile button; compile.json written.
- `GAP` MANUSCRIPT/BUILD stages are placeholders; no automatic writer/reviewer, no
  automatic compile as part of reaching READY, no `final-audit.json.passed` gate that
  includes paper.pdf existence.

### 13 — runUntilBlocked semantics (§19/§20)
- `REUSE` runUntilBlocked loop with cap + genuine block stop; WAITING_FOR_PROVIDER park.
- `GAP` No `automaticProviderRecovery` for WAITING_FOR_PROVIDER (milestone: recovered →
  auto resume / fallback provider → switch / auth → WAITING_FOR_USER / budget → FAILED);
  Step/Resume remain the only exit from WAITING_FOR_PROVIDER today.
- **Status: DONE (Phase 13, `docs/9-7-milestone-phase-13.md`).** `providerRecovery`
  hook auto-resumes the exact pending stage when the provider recovered; still-blocked
  stays parked; auth/budget escalation remains caller-side (`WAITING_FOR_USER`/FAILED
  never auto-resumed). Live provider-pool strategy is a GUI-session seam.

### 14 — Fail-closed READY gate (§21)
- `GAP` No READY gate. Supervisor advances BUILD→READY unconditionally (research-ir state
  machine), regardless of §21 checklist (protocol frozen, hash match, real recorded runs,
  deterministic stats, replication audit, no dangling claim edges, citation audit ok,
  manuscript review, paper.tex + paper.pdf, compile PASS, final-audit passed).
- **Status: DONE (Phase 14, `docs/9-7-milestone-phase-14.md`).** `ResearchService.readiness`
  implements the §21 checklist over the durable tree; the supervisor's `readyGate` blocks
  READY (→ FAILED with recorded reasons) unless the tree passes. E2E asserts
  readiness ok after the conductor journey and fail-closed on tampering.

### 15 — GUI simplification (§20/§31)
- `REUSE` Research view shows status/freeze-form/step/resume/autopilot/compile + run list.
- `GAP` Protocol freeze is a manual form; Step/Resume are the only way past gates. Normal
  path must become Start-once; Step/Resume move to Developer/Recovery-only.
- **Status: WIRING DONE; live run pending (Phase 15, `docs/9-7-milestone-phase-15.md`).**
  GUI research executor is the live conductor (web-provider role pool, 1 primary + backup,
  replaySafe jobIds); `boss:research-start` accepts the §1 human RQ input; renderer Start
  is once → autopilot to READY/block; Step/Resume/freeze remain as Developer/Recovery
  controls. Needs one GUI live run (restart Boss) for E2E-C.

### 16 — Crash/restart recovery (§22)
- `REUSE` durable ledger/checkpoints, pendingStage, resume; recovery tests exist elsewhere.
- `GAP` No research-specific crash test: kill mid-stage → restart → exact pending stage,
  no duplicate experiment/provider prompt. Idempotency keys (researchId+stage+protocolHash+
  artifactHash) not implemented.
- **Status: DETERMINISTIC COVERAGE DONE; GUI live pending.** Restart-to-exact-pending-stage
  covered (`research-service-composition.test.ts`), mid-stage crash re-entry never
  duplicates runs/provider asks (`research-conductor.test.ts`), provider-recovery semantics
  (`research-provider-recovery.test.ts`), live provider stable jobIds (no re-submission,
  `research-live-provider.test.ts`). Live GUI kill/restart run remains for E2E-C.

### 17 — Live acceptance (§33/§34)
- `GAP` Zero-manual-click live run to paper.tex/pdf with real web/API AI + real local
  experiment is not possible yet (everything above).
- **Status: DONE (E2E-C headless live run).** `live-1788704543179`: human RQ (§34) → CLI
  Start (zero GUI Step/Resume) → READY with real web AI semantic stages (chatgpt/gemini/
  qwen), 2 real recorded runs (seeds 1/2, acc 0.7/0.9, bound to frozen protocol hash
  `43425379…`), reproducibility REPRODUCED (mean 0.80, CI 0.60–1.00), citations audit ok,
  manuscript + **paper.pdf (85 KB, real pdflatex)**, final-audit.passed=true, 15 typed
  stage artifacts, readiness ok. Evidence: `runtime-data\.boss\research\live-1788704543179\`,
  `scripts/live-acceptance-report.cjs live-1788704543179` → 10/10 checks PASS.
  Headless driver: `--research-headless-run` (main.ts).

## C. First implementation slices (order)

1. Phase 0 — failing E2E acceptance (`tests/research-milestone-e2e.test.ts`) + this audit
   as the red baseline.
2. Phase 1 — `ResearchService` as the single GUI composition root (per-store root
   overrides + `main.ts` forwarding), keeping 9-6 durable locations.
3. Phase 2+ — stage executor/conductor that performs real per-stage host work (inspection,
   literature, hypothesis/RQ freeze into IR, protocol draft+review+freeze, experiment
   implementation, real runs with budget guard, deterministic analysis, replication,
   adjudication, citation audit, manuscript + review, compile) and refuses placeholder
   advancement; then the fail-closed READY gate; GUI simplification; recovery tests.

Kept deliberately compact per milestone §29/§30 output discipline.
