# 9-6 Research Phase 7 — Research Protocol Freeze + Amendment

Compact handoff for codex-boss-9-6-research-plan.md Phase 7 (§7). Branch `9-6-research`.

## Why

Experiments must never start against a mutable protocol. The plan requires freezing
`research/protocol.json` by SHA-256 → PROTOCOL_FROZEN, allowing silent auto-fixes only for
mechanical fields (syntax/path/environment/package/runtime error), and forcing an explicit
`protocol-amendment-<n>.json` for any scientific change (hypothesis / primary metric / baseline /
sample definition / exclusion rule / evaluation criterion).

## What was added

- **`src/shared/research-protocol.ts`** (new, pure)
  - `ResearchProtocol` with the scientific core + mechanical fields;
    `AUTO_FIXABLE_FIELDS` vs `FROZEN_FIELDS` (exactly the plan lists);
  - `canonicalStableProtocol` (sorted-key JSON), `hashProtocol(protocol, hash)`,
    `scientificCore(protocol)`, `diffProtocol(original, candidate)` →
    `{silentChange, changedFrozen, changedMechanical}` — the silent-mutation guard;
  - `ProtocolAmendment` + `validateAmendment` fail-closed.
- **`electron/research/protocol-manager.ts`** (new)
  - `ProtocolManager(directory)` — freeze per research id (canonical SHA-256, double-freeze
    rejected), durable `load`, `amend(id, changes)` producing
    `protocol-amendment-<n>.json` entries bound to the frozen hash, `amendments(id)`.
- **`tests/research-protocol.test.ts`** (new, 3 tests) — stable hash across identical content +
    double-freeze rejection; mechanical changes not flagged but hypothesis change is, explicit
    amendment carries the frozen hash and the frozen hash never changes; amendment validation
    (non-frozen field + empty changes rejected).

## Verification

- Targeted: `research-protocol` (3) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The freeze guard is pure: diffing the current protocol against `scientificCore(original)`
  returns the changed frozen fields so the supervisor can refuse silent mutation and route the
  change to an amendment.
- Amendment approval (approved flag) is set at record time here; wiring into the Phase 4 human
  gate for scientific changes is the remaining adoption step (protocol freezes also move the run
  to PROTOCOL_FROZEN via the Phase 5 supervisor).

## Checkpoint

Commit with: `src/shared/research-protocol.ts`, `electron/research/protocol-manager.ts`,
`tests/research-protocol.test.ts`, this handoff.
