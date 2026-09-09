# Milestone Phase 2 — Live research executor: real stage work, no placeholders

Handoff for `Update-Plan/Codex-Boss-Human-RQ-Autonomous-Research-Milestone.md`
§4/§7. Branch `9-7-milestone`, after Phase 1 (`282d6c1`).

## Goal of the phase

Replace placeholder stage behavior with a stage executor/conductor that performs
real per-stage host work (inspection → literature → hypothesis → protocol
draft/review/freeze → experiment implementation → real recorded runs with budget
guard → deterministic analysis → replication → adjudication → citation audit →
manuscript + review → LaTeX compile), persists a typed artifact per stage
(`research/<id>/artifacts/*.json`, §4), and refuses to advance a live run on
placeholders.

## 2a — Stage Artifact Contract persistence (DONE)

- `electron/research/research-service.ts`
  - `saveStageArtifact(id, {stage, summary, evidenceRefs, file?, extra?})` —
    writes a typed artifact (stage + role + kind + stable artifactId + summary +
    evidenceRefs) to `research/<id>/artifacts/<file>.json`. File defaults to the
    stage's artifact kind (`repo-scan.json`, `statistic.json`, …); callers can
    pass milestone file names (`project-inspection.json`, `hypothesis.json`, …).
    Idempotent per file (crash-recovered stage overwrites, never duplicates);
    fail-closed on unknown run ids.
  - `stageArtifacts(id)` / `stageArtifactFor(id, stage)` readers.
- Tests: `tests/research-stage-artifacts.test.ts` (4) — typed fields, explicit
  milestone names + extra payload, idempotent overwrite, fail-closed.

## 2b — Fail-closed advancement contract (DONE)

- `electron/research/research-supervisor.ts`
  - `StageOutcome.fail?: {reason}` — an executor that cannot perform a stage
    (or throws mid-stage) moves the run to FAILED with a recorded decision;
    no executor error or fail outcome can look like a passed gate. Executor
    throws inside `step()` are caught and recorded as `failed:<stage>`.
- `electron/research/default-levelb-executor.ts`
  - Remaining silent "placeholder" pass-throughs removed: every stage this
    executor cannot really perform now pauses honestly (no placeholder
    auto-advance, milestone §7).
- `electron/research/live-research-executor.ts` — forwards the inner
  executor's `fail` outcome (was dropped before).
- Removed the superseded in-memory Level-B pipeline stand-in
  (`electron/research/levelb-pipeline-executor.ts` + its test): it synthesized
  statistics without real recorded runs, which the milestone forbids.
- Tests: `tests/research-supervisor-fail.test.ts` (fail outcome + throw →
  FAILED, terminal).

## 2c — Research conductor: real stage work (DONE, deterministic CI path)

- New `electron/research/research-conductor.ts` (`ResearchConductor` +
  `ResearchSemanticProvider`). One service-bound stage executor performing
  real work per stage, no placeholders:
  - SCOPING anchors the human RQ (immutable); PROJECT_INSPECTION scans the
    workspace; LITERATURE_REVIEW does bounded source intake into the citation
    store with host-side passage location; QUESTION_FORMULATION records the
    hypothesis (never rewrites the RQ); PROTOCOL_DRAFT designs + host-validates
    + freezes the protocol (protocol-review.json, crash-repair edge);
    EXPERIMENT_GENERATION writes the durable experiment-plan.json and checks
    the implementation exists; EXPERIMENT_EXECUTION runs real spawned
    experiments under the frozen hash with an experiment-budget guard,
    skipping already-recorded (experimentId, seed) pairs;
    ANALYSIS computes deterministic statistics; REPLICATION adds
    independent-seed runs and the reproducibility audit; CLAIM_REVIEW
    adjudicates (evidence > vote, dangling-edge check); MANUSCRIPT assembles
    the evidence-bound paper (+figures, repro/citation audits, snapshot);
    CITATION_AUDIT verifies acquired sources (host passage check + verifier
    support; unverified never bind); REPRO_AUDIT requires REPRODUCED;
    BUILD compiles paper.tex → paper.pdf (fail-closed, .tex preserved) and
    checks final-audit.json.passed.
  - Stage artifacts are persisted to `research/<id>/artifacts/*.json` with the
    milestone §4 names (project-inspection.json … finalization.json) and
    re-read after a crash (no repeated provider asks, no duplicate runs).
- `electron/research/research-service.ts` — per-stage artifact readers +
  `artifactDir()`; runExperiment/analyzeRuns guards relaxed from
  "state == PROTOCOL_FROZEN" to the durable frozen-hash invariant so an
  autopilot run may execute experiments after advancing past PROTOCOL_FROZEN.
- Tests: `tests/research-conductor.test.ts` (full journey READY + artifact
  names + single bounded provider asks; crash-restart on same roots never
  duplicates runs/asks; budget exhaustion fails closed; no-real-work stages
  fail, never pass through). `tests/research-supervisor-fail.test.ts`.

## Milestone E2E-A now green

`tests/research-milestone-e2e.test.ts` (deterministic CI path): Start once →
no Step/Resume → READY with `paper.tex`/`paper.pdf`, ≥2 distinct-seed recorded
runs bound to the frozen protocol, `reproducibility.json = REPRODUCED`,
`compile.json = PASS`, `final-audit.json.passed = true`, and the §4 artifact
tree. The honest-stop test (default executor never fabricates progress) stays
green. This reaches the milestone Definition of Done for the deterministic CI
path (§33/§36).

## Next sub-slices

- Live role dispatcher (milestone §8) so semantic stages use
  RuntimeRegistry/RoleRouter/ProviderAutomation instead of a fixture mock;
- live literature retrieval closure (§9) and live provider recovery semantics
  (§19/§20);
- explicit fail-closed READY gate function (§21), GUI simplification (§15) and
  live acceptance (§17, E2E-C).
