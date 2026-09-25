# Phase 2 — Bridge Expiry

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` — section 30 (*final-city acceptance
suite*, which names a **bridge expiry validator**), section 15 (the eight required fields, and *"a bridge without an
exit condition is not allowed"*), section 33 (*"no expired temporary bridge remains"*).
**Machine-checked by:** `scripts/bridge-expiry-validator.cjs`, plus the seal gate in `scripts/city-flatness-validator.cjs`.
**Verified by:** `tests/unit/city/bridge-expiry-validator.test.ts`.
**Ledger:** `CC-041`.

## 1. Why this existed as a requirement and not as a check

A temporary bridge is the one legitimate repair in section 15's list that is **designed to expire**, which makes it the
one most likely to become permanent. Section 15 requires eight fields per bridge and forbids a bridge without an exit
condition; section 33 puts an un-retired bridge in the completion checklist; section 30 names the validator. None of
it existed: the flatness registry checked only that a bridge is named by a plot and that its record and test files
exist. So two failures were invisible —

- a bridge **past its deadline**, and
- a bridge whose code had already been **deleted** while the declaration stayed.

## 2. What is checked, and why each check can be falsified

| # | check |
| --- | --- |
| 1 | the eight fields of section 15 are present and substantive |
| 2 | `deadline_phase` names a **declared stage** or the seal — an unrecognised deadline is not a deadline |
| 3 | the bridge's `literal` source text is **still present exactly once** in its source file |
| 4 | the bridge is still declared by at least one plot (no orphan declaration) |
| 5 | the deadline phase is resolved from **measurements**, not prose |
| 6 | a bridge whose deadline phase is **COMPLETE** is **EXPIRED**, which is a failure |

**Check 3 is the one that makes the declaration falsifiable against the tree.** `P2A-BRIDGE-01` declares
`export type { ProviderId } from "./provider-contracts";`, and the validator asserts that this exact statement appears
in `src/shared/contracts.ts` **once**. Zero occurrences means the bridge was removed and the record is stale; more
than one means the "bridge" is not one statement and its exit condition does not describe it.

**Check 5 is what makes check 6 mean anything.** A stage carries no typed measurement any more (section 3), only
`trackedBy` (the artifact holding the number) and `decidedBy` (the keys that decide its exit condition). The validator
resolves them live from the instruments. A stage that declares no `decidedBy`, or whose keys cannot be resolved,
reads **`UNRESOLVED`** and a bridge due before it **fails closed** — because an unmeasurable deadline that reads as
"not yet due" is exactly how a bridge outlives its phase.

## 3. The stale copies this removed

All three stages carried a typed measurement until this stage:

```text
"73 edges over 25 pairs"                         (live: 62 over 23)
"38 mutual pairs; one SCC holding 20 of 28 nodes" (live: 34 mutual pairs; 29 nodes)
"5 accesses over 3 pairs, all into persistence's `tasks` namespace"  (live: 5 -- still correct)
```

The first two went stale the moment `P2-E` lowered the real numbers. This is the **second** instance of the same
defect — `CC-039` found it in the enforcement matrix's prose, and the lesson recorded there was that a
machine-checked artifact protects exactly the fields the machine checks. Rather than update the strings, the copies
are **gone**: `city-flatness-validator.cjs` now **fails** if a stage carries a `measured` field, so a duplicate of a
number cannot come back. The number lives in the artifact named by `trackedBy`, and the live value is printed by the
validator.

## 4. The seal gate hole this closed

`--seal` read the **plot** states. Had every plot ever been moved to `FLAT` while a bridge was still declared, the
seal would have passed with a live temporary bridge in the tree. The gate now refuses while **any** bridge is
declared, independently of the plots:

```text
[flatness] VERDICT=SEAL_BLOCKED
  - 22 plot(s) are in a seal-blocking state: attachments(MIGRATION_IN_PROGRESS), ...
  - 1 temporary bridge(s) are still declared (P2A-BRIDGE-01): a bridge is retired before the seal, not at it
```

## 5. The one live bridge, as measured

```text
[bridge]   phase P2-B: IN_PROGRESS  (p2b:kernelToFeatureFileEdges=62<=0)
[bridge]   phase P2-C: IN_PROGRESS  (p2b:mutualCapabilityPairs=34<=0, p2b:largestSccSize=20<=1)
[bridge]   phase P2-D: IN_PROGRESS  (p2d:confirmedAccesses=5<=0)
[bridge]   P2A-BRIDGE-01  deadline "before the Phase 2 seal"  PENDING_SEAL  declaration 1 occurrence(s)
[bridge] VERDICT=HOLDS
```

`P2A-BRIDGE-01` re-exports one symbol from `src/shared/contracts.ts` to `src/shared/provider-contracts.ts`, because
five `tests/acceptance/**` suites import `ProviderId` from `./contracts` and that glob is Root Trust Surface. Its exit
condition is to delete the re-export and re-point those five imports **in a commit that is already moving the Root
Trust Surface for another reason** — so it is retired by piggy-backing on a ceremony that has to happen anyway, not by
spending one of its own.

## 6. Rollback

Delete `scripts/bridge-expiry-validator.cjs`, its test and this document; remove the `decidedBy` and `literal` fields
and restore the `measured` strings; revert the two rules in `city-flatness-validator.cjs`; revert the catalogue entry.
