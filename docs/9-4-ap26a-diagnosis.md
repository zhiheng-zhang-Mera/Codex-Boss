# AP26a — Self-Diagnosis + RFC (seed)

Compact handoff for Acceptance Pack **AP26a** (plan AP26 Self Diagnosis + RFC). Branch `9-4`.

## Why

The plan wants problems surfaced from telemetry/evaluation/experience/failure clusters as
structured RFCs (Problem/Evidence/Hypothesis/Candidate Fix/Benefit/Risk/Benchmark/Rollback/
Compatibility). The repo's 14-kind interruption taxonomy was the seed; the AP16a Performance DB
now gives it durable failure records to cluster.

## What was added

- **`src/shared/self-diagnosis.ts`** (new, pure)
  - `normalizeReason(message)` groups free-text failures into stable clusters
    (timeout/network/quota/rate-limit/auth/crash/invalid-output/unknown).
  - `clusterFailures(records)` clusters FAILED telemetry by runtime + reason, ranked by count
    with bounded sample task ids.
  - `RfcDraft` + `buildRfc(cluster)` producing the plan's RFC section structure.
- **`electron/self-engineering/diagnosis.ts`** (new)
  - `diagnoseTelemetry(store)` — reads the TelemetryStore and returns `{ clusters, topRfc? }`
    for the highest-count failure cluster (empty when healthy).
- **`tests/diagnosis.test.ts`** (new, 4 tests) — reason normalization, clustering/ranking,
  RFC structure, telemetry-driven diagnosis incl. empty healthy store.

## Verification

- Targeted: `diagnosis` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- RFCs are drafts for human/Self-Modification review — nothing auto-applies a fix. Evidence
  links to task ids; the AP05b reproduction snapshot is the replay handle (join is future
  wiring). Human-correction ingestion (experience feedback) is the remaining AP26 half.

## Checkpoint

Commit with: `src/shared/self-diagnosis.ts`, `electron/self-engineering/diagnosis.ts`,
`tests/diagnosis.test.ts`.
