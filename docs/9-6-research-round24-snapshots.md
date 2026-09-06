# 9-6 Research Round 24 — Durable IR + Protocol Snapshots in the Artifact Tree

Compact handoff for the round-24 deterministic slice: the manuscript/audit tree existed, but the
plan's Phase 11 tree also calls for `research-ir.json` and `protocol.json` snapshots beside the
manuscript — nothing materialized them. Branch `9-6-research`.

## Why

A research run's artifact tree should be self-describing: `research/<id>/` already holds
`manuscript/` and `audit/`, but the durable `research-ir.json` (the run's IR, including the
frozen protocol hash) and `protocol.json` (frozen protocol + amendments, never a stub) were only
inside ledger/protocol-manager stores. Exporting them makes the artifact tree portable and
auditable after the fact.

## What was added

- **`electron/research/research-service.ts`**
  - `snapshotArtifacts(id)` — materializes `research/<id>/research-ir.json` from the ledger IR
    and, when the protocol is frozen, `research/<id>/protocol.json` from the protocol store
    (schemaVersion-1 envelope, amendments included); returns the written paths. Unknown id
    throws; unfrozen runs simply have no protocol.json (never a stub).
- **`tests/research-artifact-tree.test.ts`** (extended)
  - after the full offline E2E, `snapshotArtifacts` writes both files beside the manuscript;
    the IR snapshot carries `id` + `protocolHash`, and the protocol snapshot's hash matches the
    frozen hash with zero amendments.

## Verification

- Targeted: `research-artifact-tree` (2) + `research-service` (4) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Deterministic snapshot of durable stores; live Level-B E2E still requires a GUI session.

## Checkpoint

Commit with: `electron/research/research-service.ts`, `tests/research-artifact-tree.test.ts`,
this handoff.
