# AP20 — Hybrid Storage + Knowledge Governance

Compact handoff for Acceptance Pack **AP20** (plan §23/AP20 Hybrid Storage + Knowledge
Governance; audit: net-new v3, AP10a local backend + §15 reserved fields existed). Branch `9-5`.

## Why

AP10a shipped the local catalog with reserved trust/validity/conflict fields, but the v3
governance half was never activated: no conflict resolution, trust scoring, aging, cross-domain
association, auto-ingestion rules, and no hybrid LocalHot/LocalWarm/EncryptedCold placement.
This pack activates the pure governance core and a tiered durable store on top of the reserved
§15 fields — no knowledge schema migration required (plan §15 goal).

## What was added

- **`src/shared/knowledge-governance.ts`** (new, pure)
  - `StorageTier` (LocalHot/LocalWarm/EncryptedCold), `decideIngestion()` (ADD / SUPERSEDE /
    DUPLICATE / REJECT with explicit supersede target and content dedupe);
  - `resolveConflictGroup()` — conflict-group resolution: explicit supersede wins, else trust
    then recency; exact ties surface `unresolved: true` for a human (never silently picks);
  - `scoreTrust()` + `trustFromScore()` — deterministic source + observed-outcome scoring;
  - `agingState()` (VALID / EXPIRED / NEVER_VALID) and `placementFor()` (hot → warm → cold by
    age/sensitivity/expiry);
  - `associateAcrossDomains()` — deterministic cross-domain association edges (bounded per entry).
- **`electron/knowledge/knowledge-governance-store.ts`** (new)
  - `KnowledgeGovernanceStore(directory, sensitive?)` — schemaVersion-1 tiered catalog
    (`hot.json`/`warm.json`/`cold.json`), atomic writes, fail-closed corrupt tier load.
  - `ingest(entry)` runs §20 auto-ingestion then places; `put` places (sensitive → cold archive);
    `retrieve` merges hot+warm only (cold stays archive); `list(tier?)`;
    `resolveConflict(groupId)` archives losers to the cold tier.
- **`tests/knowledge-governance.test.ts`** (new, 8 tests) — ingestion decisions; conflict
  resolution incl. explicit supersede + tie→unresolved; trust scoring; aging + cross-domain
  association; placement across all three tiers; store ingest/supersede + persistence across
  reload; conflict archival to cold; corrupt-tier fail-closed.

## Verification

- Targeted: `knowledge-governance` (8) + `knowledge` (7) + `context-manager` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Cloud/NAS/object-store backends stay injected interfaces (offline deterministic core; the plan
  treats them as optional). EncryptedCold is a local archive tier today — adopting the §28
  SecretVault cipher backend for cold files is the follow-up security seam.
- The local `KnowledgeStore` (AP10a) remains the compatible flat backend; the governance store
  is the v3 tiered surface built on the same reserved schema.

## Checkpoint

Commit with: `src/shared/knowledge-governance.ts`,
`electron/knowledge/knowledge-governance-store.ts`, `tests/knowledge-governance.test.ts`,
this handoff.
