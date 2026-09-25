# Phase 2 — P2-H: the Core Growth Ban

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`, section 22, principle **15.9**.
**Machine-checked by:** `scripts/core-budget-validator.cjs` over `config/core-budget.json`.
**Verified by:** `tests/unit/city/core-budget-validator.test.ts`.
**Ledger:** `CC-035`.

## 1. What section 22 asks for

Three things, in order:

1. *"Measure the city-phase starting Core/foundation surface using a stable classification."*
2. *"Create a machine-enforced budget."*
3. Final acceptance: `Core size <= Phase 2 starting Core size` — **unless every increase has a separate
   Owner-approved architecture exception.**

and two rules that decide whether the budget means anything:

- *"shared road != automatic Core"* — shared infrastructure does not become Core by being shared;
- *"An exception does not silently redefine the baseline."*

## 2. The stable classification, and why this one

> **Core** = a capability whose manifest declares `kind: kernel`. The composition root is measured on its own line
> and is never folded into the capability total.

`kind` already exists and is already what the P2-B/P2-C ratchet measures `kernel → feature` edges against, so this
is not a second opinion about the tree — it is the same opinion. The composition root is kept separate precisely
because section 22 forbids treating shared machinery as automatic Core: folding `electron/main.ts` and
`electron/preload.ts` into the total would be the first step of the drift the rule exists to prevent.

## 3. The starting surface, as measured

| quantity | value |
| --- | --- |
| Core capabilities | **4** — `persistence`, `providers`, `runtime`, `state-core` |
| Core owned files | **115** (`persistence` 13, `providers` 51, `runtime` 36, `state-core` 15) |
| composition-root files (separate line) | **2** |
| capability-owned files (floor) | 596 |
| scanned source files (floor) | 614 |
| declared manifests (floor) | 27 |

Measured by `node scripts/core-budget-validator.cjs --measure`, which resolves the ownership map's **patterns** to
**files** through the closure validator's own scan set and `ownsPath` rule.

**Why the size is in files and not patterns.** The first measurement of this artifact counted the ownership map's
entries and produced `271` — a number that looks like a size and is not one, because the map stores 271 patterns
that expand to 596 owned files. The recorded number is in the same currency the P2-B/P2-C ratchet already uses.

**Why the four are pinned by name.** A count would still read four if a kernel lost its `kind` and some unrelated
capability gained one: the budget would hold while the foundation had been swapped underneath it. This is the
lesson of ledger `CC-032` applied to a budget — a total cannot tell you that its members changed.

## 4. What the budget enforces

| # | rule |
| --- | --- |
| 1 | each pinned Core name must still be Core, so a kernel cannot leave the budget by losing its `kind` |
| 2 | a capability that is Core now but was not at the start must be covered by an exception **naming it** |
| 3 | Core owned files must not exceed the starting count plus the allowances of approved exceptions |
| 4 | the composition root is a ceiling of its own |
| 5 | capability-owned files, scanned source files and the manifest count are **floors** — a smaller Core that comes from a smaller measurement is not a smaller Core |
| 6 | an exception must enumerate its identity, answer section 22's four questions, carry a debt id and an exit condition, name an Owner authorization, and be recorded in the construction ledger |
| 7 | the starting measurement cites the ledger entry that recorded it |

**The ceiling does not ratchet down.** Section 22's acceptance is against the **starting** surface, not against the
best surface reached later, so a fall in Core does not buy budget for a future rise. A rolling ceiling would turn a
temporary improvement into spendable allowance, which is the count compensation section 24 refuses: removing one old
edge does not license adding another.

**An exception is not a comment.** It must answer section 22's four questions — *why an existing road or
foundation element cannot carry it; why it is not a building; what invariant only Core can hold; what breaks if it
remains outside Core* — with a positive file allowance, a debt id, an exit condition, an Owner authorization, and an
**append-only** ledger record naming both the exception and the entry. It does not touch the starting block.

## 5. The honest reading

Core is **inside its budget**: growth `0`, unexcused growth `0`, no exceptions recorded.

What is proved today is the **ban**, not the exception path. There is no exception in the artifact, so the
Owner-approval mechanism has never been used on a real increase and is exercised only on fixtures. The artifact
says this rather than implying a governance mechanism has been used, and the enforcement matrix carries the same
sentence in the `15.9` row.

## 6. Rollback

Delete `config/core-budget.json`, `scripts/core-budget-validator.cjs`, its test and this document; revert the
`15.9` row in `config/principle-enforcement.json` to `NOT_GUARDED`; regenerate the catalogue. Nothing else reads
them.
