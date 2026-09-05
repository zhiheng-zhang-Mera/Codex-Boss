# 9-6 Research Round 17 — Amendment Facade on ResearchService

Compact handoff for the round-17 deterministic slice: protocol amendments (Phase 7) were only
reachable through the raw `ProtocolManager` (`service.protocols`), bypassing the facade's
fail-closed guards — a caller could attempt an amendment on an unfrozen or unknown run directly
against the store. Branch `9-6-research`.

## Why

ResearchService.freeze already records the frozen hash and moves the run to PROTOCOL_FROZEN, and
ProtocolManager.amend binds amendments to the frozen hash — but the service never exposed a
guarded amend path. Callers of the facade had to reach into `service.protocols.amend`, where the
only guard was "protocol exists", not "run is frozen". Phase 7's rule (silent scientific
mutation is forbidden; changes need an amendment bound to the frozen hash) should hold uniformly
through the facade used by GUI/live wiring.

## What was added

- **`electron/research/research-service.ts`**
  - `amend(id, amendment)` — fail-closed: run must exist and be `PROTOCOL_FROZEN` (with the
    hash recorded) before an amendment is accepted; delegates to `ProtocolManager.amend` so the
    amendment stays bound to the frozen hash. An amendment never changes the hash experiments
    bind to.
  - `amendments(id)` passthrough.
- **`tests/research-service.test.ts`** (+1 test)
  - amendment before freeze throws (no silent scientific change); after freeze the amendment is
    bound to the frozen hash and listed; the frozen protocol hash is unchanged; unknown id
    throws.

## Verification

- Targeted: `research-service` (4) + `research-protocol` (3) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Amendments still require a live/GUI decision flow to approve; this slice enforces the
  facade-level guard that the protocol is actually frozen first.

## Checkpoint

Commit with: `electron/research/research-service.ts`, `tests/research-service.test.ts`,
this handoff.
