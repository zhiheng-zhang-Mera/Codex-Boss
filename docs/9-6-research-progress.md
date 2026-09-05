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
