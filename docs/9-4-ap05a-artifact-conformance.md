# AP05a — Artifact Schema Conformance + Content-Hash Integrity

Compact handoff for Acceptance Pack **AP05a** (plan §4.3 artifact schema + §10 provenance base).
Branch `9-4`.

## Why

`RawArtifact` (the only long-lived artifact record) carried none of the plan's conformance
fields: no `content_hash` on the artifact itself (hashes only existed in
`EvidenceManifestEntry.sha256` computed at bundle time), no producer, version or
classification. Content could mutate between capture and evidence building without any
detection. This pack makes capture produce a self-describing artifact and makes the evidence
engine trust + verify the stored hash fail-closed.

## What was added

- **`src/shared/contracts.ts`** — `ArtifactClassification = "PUBLIC" | "INTERNAL" | "SECRET" |
  "GUARDIAN"`; `RawArtifact` gains additive fields:
  - `version?: 1` (artifact schema version)
  - `contentHash?: string` — sha256 of `content` at capture
  - `producer?: string` — executor id, e.g. `web:chatgpt` or `local:native`
  - `classification?: ArtifactClassification` — defaults `INTERNAL`
  All optional so legacy persisted artifacts and hand-built test fixtures remain valid.
- **`electron/store.ts`**
  - `captureArtifact` computes `contentHash` (sha256 over the actually-stored truncated
    content), sets `producer` from the run transport/provider, `version: 1` and
    `classification: "INTERNAL"`.
  - Exports `sha256Hex` helper.
- **`electron/evidence-engine.ts`**
  - `buildEvidenceBundle` now uses the artifact's stored `contentHash` in the manifest when
    present and **fails closed** (`Artifact content hash mismatch`) when it disagrees with a
    recomputation; legacy artifacts without the field are hashed at bundle time as before.
- **`tests/artifact-conformance.test.ts`** (new, 5 tests) — capture conformance fields,
  local:native producer, persisted round-trip, manifest uses stored hash, mismatch fails
  closed, legacy artifacts still accepted.

## Verification

- Targeted: `artifact-conformance` (5) + `evidence`, `store`, `history`, `delivery-integration` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- `workspace_id` is deliberately not added: the Workspace object (AP01) does not exist yet, and
  `taskId` is the current scoping root.
- Provenance/lineage chain beyond artifact→hash (git commit, input artifact hashes, context
  fingerprint) is the next pack **AP05b reproducibility snapshot**; evidence↔artifact and
  FinalResponse↔artifact links already exist.
- Adapter API version labels (AP02c) remain separate from artifact content hashes.

## Checkpoint

Commit with: `src/shared/contracts.ts`, `electron/store.ts`, `electron/evidence-engine.ts`,
`tests/artifact-conformance.test.ts`.
