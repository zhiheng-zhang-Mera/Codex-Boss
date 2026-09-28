# Phase A decision: A2 — remove the kernel's need for the shared contracts

**Decided by the Owner, 2026-09-28 (Australia/Melbourne). Recorded in full in
`docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md` CC-106.**

## The choice

Of the two routes in §4 Phase A, **A2 is chosen**: the kernel stops *needing* the `src/shared/**` contracts that
currently turn its imports into inversions, rather than those contracts being re-homed into a class the kernel owns.

## Why

A1's entire argument would be an argument *with* the ratchet's anti-gaming rule. That rule floors `files_owned` and
`capability_edges` precisely so a file cannot be moved between owner classes to make an inversion look repaired, and
CC-104 measured both floors firing on exactly that attempt (paper-ledger §X-5: 25 files moved, `owned files` 574 <
594, `edges to roads` 74 < 75, `capability edges` 177 < 197, ratchet exit 1). A1 could only proceed as a recorded
exception to a rule whose purpose it shares.

A2 needs no exception. It changes what the kernel **does**, and the edge disappears because the dependency itself
disappears. It is the larger change, and that is acknowledged rather than minimised; it is also testable behaviour by
behaviour, and each behaviour it moves has an owner who should have had it.

## What A2 means, per edge class

The kernel's need is 30 runtime import statements, not one thing. Each reduces to one of three moves:

| Move | Applies to | Rule |
|---|---|---|
| **(i) The kernel stops deciding** | `electron/store.ts` validating `isConversationPolicy`, `isVerificationContract`, `isRunMode`, and applying `reviewResponse` / `defaultReviewPolicy` | A store decides what to keep, not what a valid task policy is. The guard moves to where the value is produced; the store accepts an already-validated value. The **type stays where its owner declares it** — the store is a consumer of the task domain, not a second declaration of it. |
| **(ii) The utility moves to the kernel, the owner keeps calling it** | `currentFinalResponse`, `canonicalRealPathOrNormalized`, `applyStateStorageBudget` | Pure functions over data the kernel already holds. The feature's edge becomes feature → kernel, which is the allowed direction, and nothing is hidden because the file's owner genuinely changes. |
| **(iii) The side effect leaves the kernel** | `electron/state-core/platform-soak.ts` | A soak test instrument inside a kernel capability that drives `knowledge` retention and `status` soak bounds. A test instrument is not Core behaviour; it belongs with the acceptance surface that owns the bounds it applies. |

## What A2 forbids

**A2 is not "delete the guard".** A behaviour that stops being validated is a behaviour that changed, and the
workbook forbids weakening a semantic standard to make a count fall. Every move therefore needs:

1. a **boundary test** at the place that now owns the guard, and
2. evidence that the **guard still fires** on a bad value.

## The consequence that governs the critical path

`config/architecture-enforcement-baseline.json` is listed in `trust-policy/root-trust-surface.json` (32 declared
paths). The architecture ratchet records every `kernel-imports-feature` and `feature-imports-undeclared-surface`
violation, so removing a kernel → feature edge and re-pointing its consumers **will** change that file's contents and
therefore its surface hash.

The existing exact-SHA ceremony is the sanctioned route and **no new ceremony is invented**:
`scripts/acceptance-evolution-bless.cjs` (then `--advance` in the same commit, as the CI note beside
`acceptance:autonomous-evolution` requires).

This is written **before the first edit**, so the ceremony is planned rather than discovered at a red CI job.

## Sequencing

```text
A2-1  electron/store.ts: relocate the four guards to their producers, add a boundary test for each
A2-2  move the pure utilities (currentFinalResponse, canonicalRealPathOrNormalized, applyStateStorageBudget)
      into the kernel and re-point their callers
A2-3  move electron/state-core/platform-soak.ts out of the kernel capability
A2-4  re-measure S2/S3/S4, run the Root Trust ceremony once for the accumulated baseline change, run the L2
      checkpoint, then continue into Phases B-D of section 4
```

Each step is independently revertible and each ends with the affected suites and the ratchet re-run.
