# 9-6 Research Round 10 — Real Experiment → Primary-Run Provenance

Compact handoff for the round-10 deterministic slice: compose the pieces Phases 6 and 10 shipped
separately — a *real* allow-listed experiment run through the structured ResearchRuntime is now
recorded as a protocol-bound `PrimaryRunRecord` in the EvidenceGraph. Branch `9-6-research`.

## Why

Phase 6 shipped `ResearchRuntime` (structured spawn, concurrency budget) and Phase 10 shipped
`EvidenceGraph` + the `PrimaryRunRecord` shape, but nothing connected them: a real experiment
could run, and a run record could be stored, yet no code executed an experiment and produced its
provenance record (protocol hash, git state, command/args, env fingerprint, dependency-lock
hash, seed, input/output/stdout hashes, metrics, duration, hardware, timestamp). The plan
requires every primary experiment run to persist exactly those fields, bound to the frozen
protocol — evidence > vote, no fabricated runs.

## What was added

- **`electron/research/runtime/run-recorder.ts`** (new)
  - `PrimaryRunRecorder(evidence, runtime).run(researchId, options)` — prepares the command
    (validate + executable allow-list), runs it through the `ResearchRuntime`, then captures
    the full provenance record and persists it via `EvidenceGraph.addRun`.
  - Deterministic metrics extraction from `METRICS <json>` output lines (injectable).
  - Fail-closed provenance: a declared input file that is missing throws (never a silent
    record); `probeGit` never throws (no repo → commit "unknown"); dependency-lock hash picks
    the usual lockfiles in `cwd` unless an explicit path is given.
- **`electron/research/research-service.ts`**
  - Optional `runtime` in options; `runExperiment(id, options)` composes freeze → real run:
    rejects when the run is not `PROTOCOL_FROZEN` (Phase 7: no experiment before protocol
    freeze) and when the supplied protocol hash does not match the frozen one (silent-mutation
    guard). Unfrozen/mismatched runs never write evidence.
- **`tests/run-recorder.test.ts`** (new, 5 tests) — real node subprocesses: deterministic
  output/environment fingerprints across identical runs, differing seed → differing output,
  input-file + lockfile hashing, missing-input fail-closed, git probe without a repo, and the
  service composition (freeze → run binds to the frozen hash; reject before freeze / on hash
  mismatch).

## Verification

- Targeted: `run-recorder` (5) + `research-service` (3) + `research-supervisor` (7) +
  `research-runtime` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Real experiments are real subprocesses (no mocks); this slice exercises deterministic
  experiments offline. The live Level-B E2E (web-AI reviewers → RQ → experiment design →
  replication → manuscript) still requires a GUI session with logged-in providers; the recorder
  is the exact seam the live flow uses to persist each primary run against the frozen protocol.
- `main.ts` IPC was not extended: main still owns ledger/protocols/supervisor without an
  evidence-graph instance; wiring the recorder into a future live executor happens there.

## Checkpoint

Commit with: `electron/research/runtime/run-recorder.ts`, `electron/research/research-service.ts`,
`tests/run-recorder.test.ts`, this handoff.
