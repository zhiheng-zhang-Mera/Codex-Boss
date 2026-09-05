# AP26b — Human Corrections into Self Diagnosis

Compact handoff for Acceptance Pack **AP26b** (plan §26 Self Diagnosis + RFC, human-correction
input). Branch `9-4`.

## Why

AP26a (docs/9-4-ap26a-diagnosis.md) shipped failure clustering + RFC draft building from
telemetry, but plan §26 lists `human corrections` as a first-class input alongside telemetry /
evaluation / experience / failure clusters. Nothing let a human amend an auto-generated RFC —
the system could only ever re-derive the same draft, ignoring what a human already knows.

## What was added

- **`src/shared/correction.ts`** (new, pure)
  - `CorrectableRfcField` = the eight plan §26 text fields (problem, hypothesis,
    candidateFix, expectedBenefit, risk, benchmark, rollback, compatibilityImpact) —
    structured `evidence` deliberately excluded; `isCorrectableField` guard.
  - `RfcCorrection { id, clusterKey, field, correctedValue, note?, correctedAt }` — keyed by
    `${runtimeId}|${reason}` failure cluster.
  - `applyCorrections(draft, corrections)` — immutable: latest correction per field wins by
    `correctedAt`; blank values and non-correctable fields ignored; original draft untouched.
- **`electron/self-engineering/correction-store.ts`** (new)
  - `CorrectionStore(filePath)` — schemaVersion-1 durable append-only log with atomic
    tmp+rename writes; `add` validates (id/clusterKey/field/value/ISO date); `latestFor(clusterKey)`
    returns the newest amendment per field; corrupt file fails closed (throws), malformed rows
    dropped on load; missing file starts empty.
- **`electron/self-engineering/diagnosis.ts`** — `diagnoseTelemetry(store, corrections = [])`
  gains an optional corrections array (non-breaking): when any correction matches the top
  cluster key, the RFC is built then amended via `applyCorrections`, so diagnosis output
  reflects the human-adjusted view.
- **`tests/correction.test.ts`** (new, 6 tests) — correctable-field vocabulary excludes
  evidence; latest-per-field application on a copy (original untouched); blank/non-correctable
  ignored; store persistence + latestFor + durable reload; malformed add + corrupt file
  fail-closed; end-to-end `diagnoseTelemetry` amendment (non-matching corrections ignored,
  no-failure store stays empty).

## Verification

- Targeted: `correction` (6) + `diagnosis` (4) PASS; `diagnoseTelemetry` existing single-arg
  call sites unchanged.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running in background; expected green.

## Boundary notes

- Pure shared model has no node imports; compiles under both tsconfigs.
- Append-only by design (plan §30 audit-log discipline): correction history is preserved for
  replay; `latestFor` collapses to the current human view for consumption.
- Remaining AP26 surface after this pack: wiring `CorrectionStore` into a UI/IPC surface for
  humans to actually submit corrections (main.ts has no correction endpoint yet).

## Checkpoint

Commit with: `src/shared/correction.ts`, `electron/self-engineering/correction-store.ts`,
`electron/self-engineering/diagnosis.ts`, `tests/correction.test.ts`.
