# 9-6 Research Progress

Tracks execution of `Update-Plan/codex-boss-9-6-research-plan.md` on branch `9-6-research`
(created from `9-5`, which carries the committed AP01–AP30 v1–v3 pack work).

## Phase 0 — Baseline Freeze (done)

Recorded on 9-5 before branching:

- unit tests: **86 files / 407 tests PASS**
- typecheck (renderer + electron): PASS
- production build: renderer + electron steps PASS individually (`pnpm run build` aggregate
  fails only because the nested `pnpm` invocation cannot resolve through `corepack` here; each
  underlying step is green)
- Direct / Council / Engineering / Recovery acceptance = the vitest suites that cover them
  (delivery-integration, council, engineering-runtime, recovery-closure, launcher) PASS;
  live acceptance scripts (`scripts/acceptance-*.cjs`) require an installed Codex CLI / desktop
  GUI and are exercised in release validation (CI + packaged smoke), as documented in the repo.

Branch `9-6-research` created from `9-5` after the AP pack commits.

## Phase 1 — History archive/delete/duplicate/export (done; split remainder open)

- `StateStore.setConversationArchived` / `deleteConversation` (full cascade incl. ledger purge +
  history cleanup) / `duplicateConversation` (fresh ids); `TaskLedger.purgeTask`;
  `HistoryRepository.exportConversation`; event vocabulary additions.
- IPC/preload/bridge: archive / delete / duplicate / export; renderer `ConversationContextMenu`
  (right-click + `···` share one menu: rename / move / duplicate / export / archive / delete with
  delete confirmation), archived toggle, archived styling.
- Tests: `tests/history.test.ts` 10 tests.
- Open: extraction of the remaining renderer components (HistorySidebar, ConversationTurn,
  ProviderGrid/ProviderPane, LiveTaskProgress, HumanInterventionCard, Composer, SettingsPanel…)
  is being folded into later phases as each new UI lands rather than as a zero-test re-shuffle.

## Phase 2 — 3-AI horizontal layout + auto zoom + provider order (done)

- `src/shared/provider-view-profile.ts`: display profiles, `zoomForPaneWidth` (clamped),
  `ProviderViewSlot` order helpers (pure + tested).
- `electron/provider-views.ts` applies `webContents.setZoomFactor` per pane on every layout;
  renderer count-3 grid is horizontal 1×3 with full-height columns; provider pane order
  persisted (`codex-boss:provider-display-order`) with `‹ ›` controls.
- Tests: `tests/provider-view-profile.test.ts` (4); workflow layout-policy test updated.

## Phase 3 — Live progress (done)

- `src/shared/progress.ts`: ProgressEvent/Status/Source + `ProgressAggregator` (per-task summary,
  bounded detail timeline, round counts).
- `electron/commander/progress-recorder.ts` maps domain events → progress; `boss:progress` IPC +
  bridge; renderer live-progress strip with pulse animation (1.5 s poll).
- Tests: `tests/progress.test.ts` (4).

## Phase 4 — Autopilot + human guidance gate (done)

- `src/shared/intervention.ts`: HumanInterventionRequest + deterministic `decideIntervention`
  (auto-recover list vs must-pause kinds/paid/irreversible; unknown → human).
- `electron/commander/human-guidance-gate.ts`: durable one-active-per-task gate with resolve;
  IPC `boss:active-intervention` / `list-interventions` / `resolve-intervention`.
- Tests: `tests/human-guidance-gate.test.ts` (5).

## Phase 5 — Research IR + supervisor + ledger (core done)

- `src/shared/research-ir.ts`: full ResearchState machine + ResearchIR validation.
- `electron/research/research-ledger.ts` (durable checkpoints/decisions) +
  `research-supervisor.ts` (autopilot stage driver, protocol hash primitive).
- Tests: `tests/research-supervisor.test.ts` (5).

## Phase 6 — Independent research runtime (done)

- `src/shared/research-command.ts` (structured spec + allow-list + fail-closed validation).
- `electron/research/runtime/{process-runner,research-runtime,environment-manager}.ts` —
  structured spawn, concurrency budget, artifact capture, command hashing.
- Tests: `tests/research-runtime.test.ts` (5, real node subprocesses).

## Phase 7 — Protocol freeze + amendment (done)

- `src/shared/research-protocol.ts` (frozen vs auto-fixable fields, silent-mutation guard) +
  `electron/research/protocol-manager.ts` (durable freeze + amendments bound to frozen hash).
- Tests: `tests/research-protocol.test.ts` (3).

## Phase 8 — Level-B selection + evidence>vote (core done)

- `src/shared/research-levelb.ts` (falsifiable RQ selection),
  `src/shared/research-adjudicate.ts` (evidence > vote: stats + independent replication required;
  votes never adopt evidence-less claims).
- Tests: `tests/research-levelb.test.ts` (5).
- Live Level-B E2E on Codex-Boss itself (real repo inspection + web-AI reviewers + real
  experiments) is a GUI/live run — see docs/9-6-research-phase8-levelb.md.

## Phase 9 — Literature / citation core (done)

- `src/shared/research-citation.ts` (verification ladder + UNSUPPORTED primary-claim guard) +
  `electron/research/literature/source-store.ts` (durable citations + content-addressed source
  cache).
- Tests: `tests/research-citation.test.ts` (4).

## Phase 10 — Statistics + evidence graph (done)

- `src/shared/research-statistics.ts` (mean/median/sd/CI, seeded bootstrap CI, Cohen's d,
  permutation p) + `electron/research/evidence/evidence-graph.ts` (provenance records + graph
  nodes/edges).
- Tests: `tests/research-evidence.test.ts` (5).

## Phase 11 — Manuscript pipeline (core done)

- `src/shared/research-manuscript.ts` (sections, evidence-scoped briefs, evidence-check) +
  `electron/research/manuscript/manuscript-assembler.ts` (section pipeline with injected writer,
  paper.md/tex/bib + audit tree).
- Tests: `tests/research-manuscript.test.ts` (3).

## Phase 12 — Level-A (pending)

Requires Level-B stability + live runs; the Level-A auto-RQ pipeline builds on Phases 5–11
cores plus live web-AI novelty review.

## Phase 12 — Level-A planning core (done; live execution pending)

- `src/shared/research-levela.ts`: `ProjectSignals`, `noveltyReview` (overlap with existing
  tested modules + falsifiability + test-harness presence), `levelAGate` (novelty/feasibility
  ≥ 2.0), `buildExperimentSpec` (primary metric + ≥2 replication runs) + validation.
- `electron/research/levela-planner.ts`: `LevelAPlanner.plan(goal, workspace)` — project
  inspection → injected web-AI proposals → falsifiable RQ selection (Phase 8) → novelty gate →
  replicable primary experiment spec (deterministic plan; live execution never mocked).
- Tests: `tests/levela-planner.test.ts` (4).

## ResearchService facade + deterministic Level-B pipeline (round 5)

- `electron/research/research-service.ts`: single facade composing ledger + supervisor +
  protocol manager + evidence graph + manuscript assembler under one root (freeze moves run to
  PROTOCOL_FROZEN and records the hash).
- `electron/research/levelb-pipeline-executor.ts`: deterministic Level-B executor that reaches
  real statistics + evidence>vote adjudication offline (repo inspection + seeded stats +
  injected reviewer votes); RQ/literature/manuscript stages stay reviewer-gated, never
  fabricated.
- Tests: `research-service` (3) + `levelb-pipeline` (2).
- IPC `boss:research-wait` — pauses a research run (WAITING_FOR_USER) and raises a
  HumanInterventionRequest so the guidance card can collect the decision; typecheck + targeted
  tests green.

## Round 6 — research runs observable/resumable

- `ResearchLedger.list()` (newest-first, corrupt-file-tolerant) + IPC/bridge
  `boss:research-list`; renderer Research view lists existing runs (goal/state/time) with a
  "查看" action that reopens a run into the status + advance control.
- Tests: `research-ledger-list` (1).

## Round 8 — Honest reviewer-gate pauses (done)

- `ResearchIR.pendingStage` (resume-into-stage on a gate pause) + ledger `pauseAt` +
  advance-clears-pending; supervisor `step()` no longer runs control states and honors
  `StageOutcome.pause` (park at WAITING_FOR_PROVIDER, never advance); `resume()` returns to the
  exact pending stage instead of restarting from SCOPING.
- `DefaultLevelBExecutor` pauses at reviewer-gated stages (literature/RQ/design/analysis/
  manuscript); `LevelBPipelineExecutor` flags the same gates as its injected-reviewer offline
  stand-in and only proceeds there because reviewers are injected — no fabricated evidence.
- Tests: `research-supervisor` (7) + `research-service` (3) + `levelb-executor` (2) +
  `levelb-pipeline` (2) green; handoff `docs/9-6-research-round8-gate-pause.md`.

## Round 9 — Resume control for paused research runs (done)

- `BossBridge.researchResume(id)` + IPC `boss:research-resume` (publishes HUMAN_APPROVED on a
  real resume) + preload bridge; Research view shows "恢复研究（回到待办阶段）" for runs parked
  at WAITING_FOR_PROVIDER / WAITING_FOR_USER / RECOVERING instead of a no-op step button.
- typecheck + build:renderer + build:electron PASS; handoff `docs/9-6-research-round9-resume-ipc.md`.

## Round 10 — Real experiment → primary-run provenance (done)

- `electron/research/runtime/run-recorder.ts`: `PrimaryRunRecorder` composes a real
  allow-listed `ResearchRuntime` run into a protocol-bound `PrimaryRunRecord` persisted via the
  EvidenceGraph (git state, command/args, env fingerprint, lock hash, seed, input/output/stdout
  hashes, metrics, duration, hardware); deterministic `METRICS <json>` parsing; fail-closed on
  missing declared inputs.
- `ResearchService.runExperiment` — freeze → real run: rejects unfrozen runs and mismatched
  protocol hashes (Phase 7 silent-mutation guard); no evidence written on rejection.
- Tests: `run-recorder` (5, real node subprocesses) + `research-service` (3) +
  `research-supervisor` (7) + `research-runtime` (5) green; handoff
  `docs/9-6-research-round10-run-recorder.md`.

## Round 11 — Recorded runs → statistics → claim verdict (done)

- `electron/research/evidence/run-analysis.ts`: `analyzeRecordedRuns` computes deterministic
  stats (mean/median/sd/CI) over real recorded runs bound to the frozen protocol and
  adjudicates the claim (evidence > vote); independent replication = ≥2 distinct-seed runs;
  adds run → statistic → claim nodes/edges to the evidence graph; throws when no eligible runs.
- `ResearchService.analyzeRuns` — freeze/hash fail-closed guards mirror runExperiment.
- Tests: `run-analysis` (5, incl. real node experiments) + `run-recorder` (5) green; handoff
  `docs/9-6-research-round11-run-analysis.md`.

## Round 12 — Reproducibility audit for real recorded runs (done)

- `electron/research/evidence/repro-audit.ts`: `buildReproducibilityAudit` — REPRODUCED only
  when the round-11 analysis adopted the claim with evidence AND ≥2 distinct-seed runs under
  the same frozen protocol; precise reason otherwise.
- Manuscript assembler writes real `audit/reproducibility.json` (+ `final-audit.json`
  reproducibility flag) when supplied, PENDING stub otherwise; `ResearchService.reproducibility`.
- Tests: `repro-audit` (4) + `run-analysis` (5) + `research-manuscript` (3) green; handoff
  `docs/9-6-research-round12-repro-audit.md`.

## Round 13 — Manuscript claims derived from the evidence graph (done)

- `electron/research/evidence/graph-claims.ts`: `deriveManuscriptClaims` walks claim nodes and
  binds each to upstream evidence-kind nodes (run/statistic/metric/…) via BFS — a manuscript
  only asserts claims recorded by the analyzer, traceable to evidence by construction;
  `ResearchService.manuscriptClaims(id)`.
- Tests: `graph-claims` (4, incl. live freeze→run→analyze→derive) green; handoff
  `docs/9-6-research-round13-graph-claims.md`.

## Round 14 — Citation audit in the manuscript tree (done)

- `summarizeCitationAudit(records)` (shared) — verified counts + UNSUPPORTED flagging
  (primary-claim rule: no UNSUPPORTED citation may back a primary claim).
- Manuscript assembler writes real `audit/citations.json` + `final-audit.json` citations gate
  when records are supplied; PENDING stub preserved otherwise.
- Tests: `citation-audit` (3) + `research-citation` (4) + `research-manuscript` (3) green;
  handoff `docs/9-6-research-round14-citation-audit.md`.

## Round 15 — Offline artifact-tree E2E + clean claim node ids (done)

- `ResearchService` owns a durable `CitationSourceStore`; claim node ids normalized (no
  `claim:claim:` double prefix) in `analyzeRecordedRuns`.
- `tests/research-artifact-tree.test.ts` (2): full offline E2E — freeze → real runs → analysis
  → repro audit → citation audit → graph-derived claims → manuscript tree
  (`paper.md/.tex/.bib` + `audit/citations|reproducibility|final-audit.json`) with truthful
  integrity flags (passes when all citations verify, fails closed on UNSUPPORTED).
- Tests: `research-artifact-tree` (2) + `run-analysis` (5) + `graph-claims` (4) +
  `repro-audit` (4) + `citation-audit` (3) green; handoff
  `docs/9-6-research-round15-artifact-tree.md`.

## Round 16 — Pending-stage hygiene + GUI freeze consistency (done)

- Ledger `setState` clears `pendingStage` on main/terminal transitions (freeze/fail) but keeps
  it across control-state waits; main.ts `boss:research-protocol-freeze` mirrors
  `ResearchService.freeze` (records ir.protocolHash + moves to PROTOCOL_FROZEN).
- Tests: `research-supervisor` (8) + `research-service` (3) green; handoff
  `docs/9-6-research-round16-pending-hygiene.md`.

## Round 17 — Amendment facade on ResearchService (done)

- `ResearchService.amend(id, amendment)` — fail-closed (run must exist + be PROTOCOL_FROZEN
  before an amendment is accepted); bound to the frozen hash, never changes it; `amendments(id)`
  passthrough.
- Tests: `research-service` (4) + `research-protocol` (3) green; handoff
  `docs/9-6-research-round17-amend-facade.md`.

## Round 18 — CONTRADICTED citations block primary claims (done)

- Citation audit `ok` now false on UNSUPPORTED **or** CONTRADICTED; audit JSONs carry
  `contradicted` ids and `final-audit.passed` fails on a contradicting source.
- Tests: `citation-audit` (4) + `research-citation` (4) + `research-artifact-tree` (2) green;
  handoff `docs/9-6-research-round18-contradicted-citations.md`.

## Round 19 — Failed runs are never evidence (done)

- `PrimaryRunRecord.passed?` persisted by the recorder from the real process result; analysis
  excludes `passed:false` runs (crashed runs that printed METRICS never fabricate statistics);
  only-failed runs throw. Legacy records remain eligible.
- Tests: `run-recorder` (6) + `run-analysis` (6) + `repro-audit` (4) green; handoff
  `docs/9-6-research-round19-failed-runs.md`.

## Round 20 — Deterministic references.bib from verified citations (done)

- `src/shared/research-bibliography.ts`: BibTeX entries only for verified non-contradicting
  records (SOURCE_RETRIEVED/PASSAGE_VERIFIED/CLAIM_SUPPORTED/PARTIAL); assembler writes
  `references.bib` from citations when supplied, stub otherwise.
- Tests: `citation-audit` (6) + `research-manuscript` (3) + `research-artifact-tree` (2) green;
  handoff `docs/9-6-research-round20-bibliography.md`.

## Round 21 — Deterministic paper figures from real runs (done)

- `src/shared/research-figures.ts`: deterministic SVG metric chart; assembler writes supplied
  figures into `manuscript/figures/` (sanitized names) and reports them.
- Tests: `research-figures` (3) + `research-artifact-tree` (2, now generates a figure from real
  run metrics) + `research-manuscript` (3) green; handoff
  `docs/9-6-research-round21-figures.md`.

## Round 22 — Paper figures traceable in the evidence graph (done)

- `EvidenceGraph.addFigure` registers `figure:<id>` (kind figure-table) bound to its source
  run/evidence nodes; `ResearchService.registerFigure` facade.
- Tests: `research-artifact-tree` (2, asserts run→figure edges) + `graph-claims` (4) +
  `research-figures` (3) green; handoff `docs/9-6-research-round22-figure-traceability.md`.

## Round 23 — Paired permutation test + doc reconcile (done)

- `permutationP(..., { paired: true })` now runs a sign-flip test over within-pair differences
  (equal length required, NaN otherwise); unpaired path unchanged; STRUCTURE research inventory
  reconciled through round 22.
- Tests: `research-evidence` (6) + `research-manuscript` (3) green; handoff
  `docs/9-6-research-round23-paired-stats.md`.

## Round 24 — Durable IR + protocol snapshots in the artifact tree (done)

- `ResearchService.snapshotArtifacts(id)` writes `research/<id>/research-ir.json` and (when
  frozen) `protocol.json` beside the manuscript/audit tree.
- Tests: `research-artifact-tree` (2) + `research-service` (4) green; handoff
  `docs/9-6-research-round24-snapshots.md`.

## Round 25 — Remove stale researchOutputDir stub (done)

- Deleted the unused `researchOutputDir` helper whose `<dir>/<id>/research/…` layout
  contradicted the real artifact tree (`<dir>/<id>/research-ir.json|protocol.json|manuscript/|
  audit/`); executor logic unchanged.
- Tests: `levelb-executor` (2) + `research-service` (4) + `research-artifact-tree` (2) green;
  handoff `docs/9-6-research-round25-cleanup.md`.

## Round 26 — Level-A plan starts a durable research run (done)

- `ResearchService.startLevelA` seeds the run IR with the selected falsifiable question +
  hypothesis (validateLevelAPlan fail-closed); protocol never invented at start.
- Tests: `research-service` (5) + `levela-planner` (4) green; handoff
  `docs/9-6-research-round26-levela-start.md`.

## Round 27 — Reviewer gate in the manuscript pipeline (done)

- Assembler accepts a `SectionReviewer`; a section is REVISED only after reviewer approval (or
  absent) AND evidence check; reviewer notes recorded. Backward compatible.
- Tests: `research-manuscript` (4) + `citation-audit` (6) + `research-artifact-tree` (2) green;
  handoff `docs/9-6-research-round27-reviewer-gate.md`.

## Open / next

- **Live Final Acceptance (GUI/tools; never replaced by mocks):** Level-A / Level-B E2E on
  Codex-Boss itself (real repo + logged-in web-AI reviewers + real experiments + statistics +
  independent replication + manuscript `paper.pdf`), Chat/Work/Direct/Council/Engineering/
  Recovery manual acceptance, packaged-portable smoke, Blender/Unreal live sessions.
- Renderer pure structural split of legacy inline sections (HistorySidebar, ConversationTurn,
  ProviderGrid/ProviderPane, Composer, SettingsPanel) is intentionally deferred: main.tsx is
  functional and the components that enable later phases already exist; restructuring only for
  file size has no renderer test harness and would trade working UI for cosmetic structure.
- Full verification gate after each further slice: `pnpm run typecheck` + `pnpm test` +
  `pnpm run build:renderer`/`build:electron`.

## Round 3 additions (research-mode surface)

- main.ts IPC + bridge: `boss:research-start` / `research-status` / `research-step` /
  `research-protocol-freeze` backed by the durable `ResearchLedger`, `ProtocolManager` and a
  `ResearchSupervisor` with the `DefaultLevelBExecutor` (real bounded repo inspection for
  PROJECT_INSPECTION; reviewer-gated stages honestly flagged, never fabricating evidence).
- Renderer top nav `Chat | Work | Research` + research launcher (goal / workspace / autonomy,
  reviewers = open web AIs) and a 推进下一阶段 control.
- `HumanInterventionCard` + `ResearchProgress` renderer components; intervention polling +
  resolution wired to the guidance gate.
- Docs: README 9-6 section, STRUCTURE.md research-mode inventory, `docs/9-6-validation.md`
  (verified vs NOT_RUN), this progress file.
- Verification: full suite **97 files / 456 tests PASS**, typecheck + renderer build PASS.
