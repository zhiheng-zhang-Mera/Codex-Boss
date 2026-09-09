# 9-6 Research Round 25 — Remove Stale researchOutputDir Stub

Compact handoff for the round-25 cleanup slice: `researchOutputDir` (default-levelb-executor.ts)
created a stale `<dir>/<id>/research/{literature,experiments,analysis,evidence,...}` stub whose
layout contradicted the actual artifact tree used since rounds 15–24 (`<dir>/<id>/` with
`research-ir.json`, `protocol.json`, `manuscript/`, `audit/`, `figures/`), and nothing called it.
Branch `9-6-research`.

## Why

Two competing "output tree" shapes existed: the dead `researchOutputDir` helper nested folders
under an extra `research/` level, while every real writer (`snapshotArtifacts`, the manuscript
assembler, figure registration) writes directly under `research/<id>/`. Dead, contradictory code
invites future misuse; the round-24 snapshots already provide the durable IR/protocol files the
stub only pretended to scaffold.

## What was added

- **`electron/research/default-levelb-executor.ts`**
  - Removed the unused `researchOutputDir` export and its now-unneeded `path` import. The
    reviewer-gated executor logic is unchanged.

## Verification

- Targeted: `levelb-executor` (2) + `research-service` (4) + `research-artifact-tree` (2) PASS;
  typecheck PASS.
- Full suite: run with the batch before landing.

## Checkpoint

Commit with: `electron/research/default-levelb-executor.ts`, this handoff.
